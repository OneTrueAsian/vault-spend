//! The whole Phase A story through the public API: protect a database, restart, unlock with the
//! password or the recovery code, and rotate the key. Uses cheap KDF settings for speed.
use budget_core::protection::ProtectionError;
use budget_core::protection::kdf::KdfParams;
use budget_core::protection::keyfile::{KeyFile, create_protection, key_file_path_for};
use budget_core::protection::recovery::RecoveryCode;
use budget_core::store::{DatabaseKey, Store, StoreOpenError};
use std::path::PathBuf;

const NOW: &str = "2026-09-21T12:00:00Z";
const FAST: KdfParams = KdfParams::FAST_FOR_TESTS;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("vaultspend-roundtrip-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn protect_restart_unlock_recover_and_rotate() {
    let dir = temp_dir("story");
    let (plain_path, protected_path) = (dir.join("vaultspend.db"), dir.join("vaultspend-protected.db"));
    let plain = Store::open(&plain_path).unwrap();
    plain.create_category("Groceries", None).unwrap();

    // Turn protection on: a key file, an encrypted copy, and a copy that checks out.
    let protection = create_protection("a long enough password", &FAST, NOW).unwrap();
    plain.export_encrypted_copy(&protected_path, protection.dek.as_bytes()).unwrap();
    plain.verify_copy(&protected_path, DatabaseKey::Raw(protection.dek.as_bytes())).unwrap();
    let key_path = key_file_path_for(&protected_path);
    protection.key_file.write_to(&key_path).unwrap();
    let recovery_text = protection.recovery_code.display();
    drop(protection);

    // "Restart": everything comes back from disk and the typed secrets only.
    let key_file = KeyFile::read(&key_path).unwrap();
    assert_eq!(
        key_file.unlock_with_password("wrong password").err(),
        Some(ProtectionError::WrongPasswordOrTampered)
    );
    let dek = key_file.unlock_with_password("a long enough password").unwrap();
    let unlocked = Store::open_with_key(&protected_path, DatabaseKey::Raw(dek.as_bytes())).unwrap();
    assert!(unlocked.list_categories().unwrap().contains(&"Groceries".to_string()));

    // Forgot the password: the recovery code opens the same data.
    let by_recovery = key_file
        .unlock_with_recovery(&RecoveryCode::parse(&recovery_text.to_lowercase()).unwrap())
        .unwrap();
    assert_eq!(by_recovery.as_bytes(), dek.as_bytes());

    // Change the password: a brand-new key and recovery code, the data re-encrypted into a new file.
    let rotated = create_protection("a different password", &FAST, NOW).unwrap();
    let rotated_path = dir.join("vaultspend-protected-2.db");
    unlocked.export_encrypted_copy(&rotated_path, rotated.dek.as_bytes()).unwrap();
    unlocked.verify_copy(&rotated_path, DatabaseKey::Raw(rotated.dek.as_bytes())).unwrap();
    assert!(matches!(
        Store::open_with_key(&rotated_path, DatabaseKey::Raw(dek.as_bytes())),
        Err(StoreOpenError::NotADatabaseOrWrongKey)
    ));
    let reopened = Store::open_with_key(&rotated_path, DatabaseKey::Raw(rotated.dek.as_bytes())).unwrap();
    assert!(reopened.list_categories().unwrap().contains(&"Groceries".to_string()));
    assert!(
        rotated.key_file.unlock_with_password("a long enough password").is_err(),
        "the old password does not open the new key file"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
