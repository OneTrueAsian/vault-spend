//! The key file: everything needed to turn a password (or recovery code) back into the database
//! key. It sits beside every encrypted database and backup (plan v2 section 4.3) and holds only
//! wrapped keys, never a password, a recovery code or an unwrapped key.
use super::kdf::{KdfParams, derive_kek, validate_salt};
use super::recovery::RecoveryCode;
use super::wrap::{Wrapped, generate_dek, unwrap_dek, wrap_dek};
use super::{ProtectionError, random_bytes};
use crate::fsutil::write_atomic;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

pub const FORMAT: u32 = 1;
const ALG: &str = "argon2id";
const WRAPPED_KEY_LEN: usize = 32 + 16;
const PASSWORD_SLOT: &str = "password";
const RECOVERY_SLOT: &str = "recovery";

/// The database key, in memory only. Zeroized when dropped.
pub struct UnlockedKey(Zeroizing<[u8; 32]>);

impl UnlockedKey {
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

pub struct NewProtection {
    pub key_file: KeyFile,
    pub dek: UnlockedKey,
    pub recovery_code: RecoveryCode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeySlot {
    pub alg: String,
    #[serde(flatten)]
    pub kdf: KdfParams,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyFile {
    pub format: u32,
    pub protection_id: String,
    pub created_at: String,
    pub password_changed_at: String,
    pub password_slot: KeySlot,
    pub recovery_slot: KeySlot,
}

fn normalize_password(password: &str) -> Zeroizing<Vec<u8>> {
    let normalized: Zeroizing<String> = Zeroizing::new(password.nfc().collect());
    Zeroizing::new(normalized.as_bytes().to_vec())
}

/// Binds a wrap to its protection id, format, slot type and KDF settings.
fn aad(protection_id: &str, slot: &str, kdf: &KdfParams) -> Vec<u8> {
    format!("vaultspend-key|{FORMAT}|{slot}|{protection_id}|{}", kdf.label()).into_bytes()
}

fn make_slot(secret: &[u8], dek: &[u8; 32], protection_id: &str, slot: &str, params: &KdfParams) -> Result<KeySlot, ProtectionError> {
    let salt = random_bytes::<16>();
    let kek = derive_kek(secret, &salt, params)?;
    let wrapped = wrap_dek(&kek, dek, &aad(protection_id, slot, params));
    Ok(KeySlot {
        alg: ALG.to_string(),
        kdf: *params,
        salt: B64.encode(salt),
        nonce: B64.encode(wrapped.nonce),
        ciphertext: B64.encode(&wrapped.ciphertext),
    })
}

fn malformed(why: &str) -> ProtectionError {
    ProtectionError::MalformedKeyFile(why.to_string())
}

fn decode(field: &str, what: &str) -> Result<Vec<u8>, ProtectionError> {
    B64.decode(field).map_err(|_| malformed(&format!("{what} is not valid base64")))
}

/// Checks one slot's shape and bounds, and returns its decoded salt and wrap.
fn check_slot(slot: &KeySlot, which: &str) -> Result<(Vec<u8>, Wrapped), ProtectionError> {
    if slot.alg != ALG {
        return Err(malformed(&format!("the {which} slot uses an unknown algorithm")));
    }
    slot.kdf.validate()?;
    let salt = decode(&slot.salt, "the salt")?;
    validate_salt(&salt)?;
    let nonce: [u8; 24] = decode(&slot.nonce, "the nonce")?
        .try_into()
        .map_err(|_| malformed("the nonce has the wrong length"))?;
    let ciphertext = decode(&slot.ciphertext, "the wrapped key")?;
    if ciphertext.len() != WRAPPED_KEY_LEN {
        return Err(malformed("the wrapped key has the wrong length"));
    }
    Ok((salt, Wrapped { nonce, ciphertext }))
}

fn open_slot(slot: &KeySlot, secret: &[u8], protection_id: &str, which: &str) -> Result<UnlockedKey, ProtectionError> {
    let (salt, wrapped) = check_slot(slot, which)?;
    let kek = derive_kek(secret, &salt, &slot.kdf)?;
    Ok(UnlockedKey(unwrap_dek(&kek, &wrapped, &aad(protection_id, which, &slot.kdf))?))
}

fn is_protection_id(id: &str) -> bool {
    id.len() == 32 && id.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

/// Starts protecting a profile: a new database key, a new protection id, a password slot and a
/// recovery slot. The caller shows `recovery_code` once and encrypts the database with `dek`.
pub fn create_protection(password: &str, params: &KdfParams, now: &str) -> Result<NewProtection, ProtectionError> {
    let dek = generate_dek();
    let protection_id: String = random_bytes::<16>().iter().map(|b| format!("{b:02x}")).collect();
    let recovery_code = RecoveryCode::generate();
    let password_slot = make_slot(&normalize_password(password), &dek, &protection_id, PASSWORD_SLOT, params)?;
    let recovery_slot = make_slot(recovery_code.secret_bytes(), &dek, &protection_id, RECOVERY_SLOT, params)?;
    Ok(NewProtection {
        key_file: KeyFile {
            format: FORMAT,
            protection_id,
            created_at: now.to_string(),
            password_changed_at: now.to_string(),
            password_slot,
            recovery_slot,
        },
        dek: UnlockedKey(dek),
        recovery_code,
    })
}

impl KeyFile {
    pub fn unlock_with_password(&self, password: &str) -> Result<UnlockedKey, ProtectionError> {
        open_slot(&self.password_slot, &normalize_password(password), &self.protection_id, PASSWORD_SLOT)
    }

    pub fn unlock_with_recovery(&self, code: &RecoveryCode) -> Result<UnlockedKey, ProtectionError> {
        open_slot(&self.recovery_slot, code.secret_bytes(), &self.protection_id, RECOVERY_SLOT)
    }

    /// Replaces only the recovery slot (same database key); the old code stops working.
    pub fn regenerate_recovery(&self, dek: &UnlockedKey, params: &KdfParams) -> Result<(KeyFile, RecoveryCode), ProtectionError> {
        let code = RecoveryCode::generate();
        let mut renewed = self.clone();
        renewed.recovery_slot = make_slot(code.secret_bytes(), dek.as_bytes(), &self.protection_id, RECOVERY_SLOT, params)?;
        Ok((renewed, code))
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("a key file always serializes")
    }

    pub fn from_json(json: &str) -> Result<KeyFile, ProtectionError> {
        let value: serde_json::Value = serde_json::from_str(json).map_err(|e| ProtectionError::MalformedKeyFile(e.to_string()))?;
        // Read the version first: a newer format may not fit this struct at all.
        let format = value
            .get("format")
            .and_then(|f| f.as_u64())
            .ok_or_else(|| malformed("there is no format number"))?;
        if format != u64::from(FORMAT) {
            return Err(ProtectionError::UnsupportedVersion(u32::try_from(format).unwrap_or(u32::MAX)));
        }
        let file: KeyFile = serde_json::from_value(value).map_err(|e| ProtectionError::MalformedKeyFile(e.to_string()))?;
        if !is_protection_id(&file.protection_id) {
            return Err(malformed("the protection id is not valid"));
        }
        check_slot(&file.password_slot, PASSWORD_SLOT)?;
        check_slot(&file.recovery_slot, RECOVERY_SLOT)?;
        Ok(file)
    }

    pub fn write_to(&self, path: &Path) -> Result<(), ProtectionError> {
        write_atomic(path, self.to_json().as_bytes()).map_err(|e| ProtectionError::Io(e.to_string()))
    }

    pub fn read(path: &Path) -> Result<KeyFile, ProtectionError> {
        let text = std::fs::read_to_string(path).map_err(|e| ProtectionError::Io(e.to_string()))?;
        KeyFile::from_json(&text)
    }
}

/// `vaultspend-protected.db` gets `vaultspend-protected.db.key` beside it.
pub fn key_file_path_for(db_path: &Path) -> PathBuf {
    let mut name = db_path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".key");
    db_path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = "2026-09-21T12:00:00Z";
    const FAST: KdfParams = KdfParams::FAST_FOR_TESTS;

    fn create(password: &str) -> NewProtection {
        create_protection(password, &FAST, NOW).unwrap()
    }

    #[test]
    fn the_password_and_the_recovery_code_open_the_same_key() {
        let protection = create("correct horse battery");

        let by_password = protection.key_file.unlock_with_password("correct horse battery").unwrap();
        let by_recovery = protection.key_file.unlock_with_recovery(&protection.recovery_code).unwrap();

        assert_eq!(by_password.as_bytes(), protection.dek.as_bytes());
        assert_eq!(by_recovery.as_bytes(), protection.dek.as_bytes());
    }

    #[test]
    fn a_wrong_password_or_recovery_code_fails_with_the_one_generic_error() {
        let protection = create("right password");

        assert_eq!(
            protection.key_file.unlock_with_password("wrong").err(),
            Some(ProtectionError::WrongPasswordOrTampered)
        );
        assert_eq!(
            protection.key_file.unlock_with_recovery(&RecoveryCode::generate()).err(),
            Some(ProtectionError::WrongPasswordOrTampered)
        );
    }

    #[test]
    fn passwords_are_nfc_normalized_so_the_same_text_always_unlocks() {
        let composed = "caf\u{00e9}"; // é as one character
        let decomposed = "cafe\u{0301}"; // e followed by a combining accent
        let protection = create(composed);

        assert!(protection.key_file.unlock_with_password(decomposed).is_ok());
    }

    #[test]
    fn passwords_are_not_trimmed_or_case_folded() {
        let protection = create("  Secret  ");

        assert!(protection.key_file.unlock_with_password("  Secret  ").is_ok());
        assert!(protection.key_file.unlock_with_password("Secret").is_err());
        assert!(protection.key_file.unlock_with_password("  secret  ").is_err());
    }

    #[test]
    fn every_protection_has_its_own_id_salt_and_key() {
        let (a, b) = (create("same password"), create("same password"));

        assert_ne!(a.key_file.protection_id, b.key_file.protection_id);
        assert_ne!(a.dek.as_bytes(), b.dek.as_bytes());
        assert_ne!(a.key_file.password_slot.salt, b.key_file.password_slot.salt);
        assert_eq!(a.key_file.protection_id.len(), 32);
        assert!(a.key_file.protection_id.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)));
    }

    #[test]
    fn the_json_round_trips_and_holds_no_secret() {
        let protection = create("correct horse battery");

        let json = protection.key_file.to_json();

        assert_eq!(KeyFile::from_json(&json).unwrap(), protection.key_file);
        assert!(json.contains("argon2id"));
        assert!(!json.contains("correct horse"));
        assert!(!json.contains(std::str::from_utf8(protection.recovery_code.secret_bytes()).unwrap()));
        assert!(!json.contains(&B64.encode(protection.dek.as_bytes())));
    }

    #[test]
    fn a_wrap_cannot_be_moved_to_another_protection() {
        let (a, b) = (create("password a"), create("password b"));

        let mut slot_moved = a.key_file.clone();
        slot_moved.password_slot = b.key_file.password_slot.clone();
        let mut id_moved = a.key_file.clone();
        id_moved.protection_id = b.key_file.protection_id.clone();

        assert!(slot_moved.unlock_with_password("password b").is_err());
        assert!(id_moved.unlock_with_password("password a").is_err());
    }

    #[test]
    fn changing_the_kdf_settings_in_a_slot_breaks_the_unlock() {
        let protection = create("password");
        let mut tampered = protection.key_file.clone();
        tampered.password_slot.kdf.t += 1; // still inside the bounds

        assert_eq!(
            tampered.unlock_with_password("password").err(),
            Some(ProtectionError::WrongPasswordOrTampered)
        );
    }

    #[test]
    fn a_newer_format_is_refused_with_an_upgrade_error() {
        let json = create("pw").key_file.to_json().replace("\"format\": 1", "\"format\": 2");

        assert_eq!(KeyFile::from_json(&json).err(), Some(ProtectionError::UnsupportedVersion(2)));
    }

    #[test]
    fn settings_outside_the_bounds_are_refused_when_a_file_is_loaded() {
        let mut file = create("pw").key_file;
        file.password_slot.kdf.m_kib = 4_000_000;

        assert!(matches!(
            KeyFile::from_json(&file.to_json()).err(),
            Some(ProtectionError::KdfOutOfBounds(_))
        ));
    }

    #[test]
    fn malformed_files_are_refused_with_a_readable_error() {
        let good = create("pw").key_file;
        let mut bad_base64 = good.clone();
        bad_base64.password_slot.salt = "***not base64***".into();
        let mut bad_nonce = good.clone();
        bad_nonce.recovery_slot.nonce = B64.encode([0u8; 5]);
        let mut bad_id = good.clone();
        bad_id.protection_id = "not-a-protection-id".into();
        let mut bad_alg = good.clone();
        bad_alg.password_slot.alg = "scrypt".into();
        let mut short_wrap = good.clone();
        short_wrap.password_slot.ciphertext = B64.encode([0u8; 10]);

        for json in [
            String::from("not json at all"),
            String::from("{}"),
            bad_base64.to_json(),
            bad_nonce.to_json(),
            bad_id.to_json(),
            bad_alg.to_json(),
            short_wrap.to_json(),
        ] {
            assert!(
                matches!(KeyFile::from_json(&json).err(), Some(ProtectionError::MalformedKeyFile(_))),
                "{json}"
            );
        }
    }

    #[test]
    fn regenerating_the_recovery_key_replaces_only_the_recovery_slot() {
        let protection = create("password");

        let (renewed, new_code) = protection.key_file.regenerate_recovery(&protection.dek, &FAST).unwrap();

        assert_eq!(renewed.protection_id, protection.key_file.protection_id);
        assert_eq!(renewed.password_slot, protection.key_file.password_slot);
        assert_eq!(renewed.unlock_with_recovery(&new_code).unwrap().as_bytes(), protection.dek.as_bytes());
        assert!(
            renewed.unlock_with_recovery(&protection.recovery_code).is_err(),
            "the old code must stop working"
        );
        assert!(renewed.unlock_with_password("password").is_ok());
    }

    #[test]
    fn the_key_file_lives_beside_its_database_and_survives_a_write_and_read() {
        let dir = std::env::temp_dir().join(format!("vaultspend-keyfile-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("vaultspend-protected.db");
        let path = key_file_path_for(&db);
        let protection = create("password");

        protection.key_file.write_to(&path).unwrap();

        assert_eq!(path.file_name().unwrap(), "vaultspend-protected.db.key");
        assert_eq!(KeyFile::read(&path).unwrap(), protection.key_file);
        assert!(matches!(KeyFile::read(&dir.join("missing.key")).err(), Some(ProtectionError::Io(_))));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
