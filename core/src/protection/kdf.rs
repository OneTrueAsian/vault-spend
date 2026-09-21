//! Password to key derivation. Fixed settings, stored with every key slot so they can be
//! raised later (plan v2 section 4.1).
use super::ProtectionError;
use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

const MAX_M_KIB: u32 = 256 * 1024;
const MAX_T: u32 = 10;
const MAX_P: u32 = 8;
const MIN_SALT_LEN: usize = 16;
const MAX_SALT_LEN: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParams {
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
}

impl KdfParams {
    /// What every real key file is written with: 64 MiB, 3 passes, 1 lane.
    pub const PRODUCTION: KdfParams = KdfParams {
        m_kib: 64 * 1024,
        t: 3,
        p: 1,
    };
    /// Cheap settings for tests and debug e2e builds only. Never used to protect real data.
    pub const FAST_FOR_TESTS: KdfParams = KdfParams { m_kib: 64, t: 1, p: 1 };

    /// Bounds that protect against a modified key file demanding unbounded memory or time.
    /// They do not depend on the computer.
    pub fn validate(&self) -> Result<(), ProtectionError> {
        let ok = self.t >= 1 && self.p >= 1 && self.m_kib >= 8 * self.p && self.m_kib <= MAX_M_KIB && self.t <= MAX_T && self.p <= MAX_P;
        if ok {
            Ok(())
        } else {
            Err(ProtectionError::KdfOutOfBounds(self.label()))
        }
    }

    pub fn label(&self) -> String {
        format!("argon2id:m={},t={},p={}", self.m_kib, self.t, self.p)
    }

    pub fn is_production_strength(&self) -> bool {
        self.m_kib >= Self::PRODUCTION.m_kib && self.t >= Self::PRODUCTION.t
    }
}

pub fn validate_salt(salt: &[u8]) -> Result<(), ProtectionError> {
    if (MIN_SALT_LEN..=MAX_SALT_LEN).contains(&salt.len()) {
        Ok(())
    } else {
        Err(ProtectionError::KdfOutOfBounds(format!("salt of {} bytes", salt.len())))
    }
}

/// Derives the 32-byte key-encryption key from a password (or recovery code) and a salt.
pub fn derive_kek(secret: &[u8], salt: &[u8], params: &KdfParams) -> Result<Zeroizing<[u8; 32]>, ProtectionError> {
    params.validate()?;
    validate_salt(salt)?;
    let argon2_params = Params::new(params.m_kib, params.t, params.p, Some(32)).map_err(|e| ProtectionError::KdfOutOfBounds(e.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon2_params);
    let mut out = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(secret, salt, out.as_mut_slice())
        .map_err(|e| ProtectionError::KdfOutOfBounds(e.to_string()))?;
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_settings_are_the_documented_ones() {
        assert_eq!(KdfParams::PRODUCTION, KdfParams { m_kib: 65_536, t: 3, p: 1 });
        assert!(KdfParams::PRODUCTION.is_production_strength());
        assert!(!KdfParams::FAST_FOR_TESTS.is_production_strength());
        assert_eq!(KdfParams::PRODUCTION.label(), "argon2id:m=65536,t=3,p=1");
    }

    #[test]
    fn bounds_accept_production_and_test_settings() {
        assert!(KdfParams::PRODUCTION.validate().is_ok());
        assert!(KdfParams::FAST_FOR_TESTS.validate().is_ok());
        assert!(KdfParams { m_kib: 262_144, t: 10, p: 8 }.validate().is_ok());
    }

    #[test]
    fn bounds_reject_resource_abuse_and_nonsense() {
        for bad in [
            KdfParams { m_kib: 262_145, t: 3, p: 1 },
            KdfParams { m_kib: 65_536, t: 11, p: 1 },
            KdfParams { m_kib: 65_536, t: 3, p: 9 },
            KdfParams { m_kib: 65_536, t: 0, p: 1 },
            KdfParams { m_kib: 65_536, t: 3, p: 0 },
            KdfParams { m_kib: 7, t: 3, p: 1 },
        ] {
            assert!(matches!(bad.validate(), Err(ProtectionError::KdfOutOfBounds(_))), "{bad:?}");
        }
    }

    #[test]
    fn salt_length_is_bounded() {
        assert!(validate_salt(&[0u8; 16]).is_ok());
        assert!(validate_salt(&[0u8; 64]).is_ok());
        assert!(validate_salt(&[0u8; 15]).is_err());
        assert!(validate_salt(&[0u8; 65]).is_err());
    }

    #[test]
    fn the_same_inputs_give_the_same_key_and_any_change_gives_another() {
        let salt = [7u8; 16];
        let base = derive_kek(b"correct horse", &salt, &KdfParams::FAST_FOR_TESTS).unwrap();

        assert_eq!(*base, *derive_kek(b"correct horse", &salt, &KdfParams::FAST_FOR_TESTS).unwrap());
        assert_ne!(*base, *derive_kek(b"correct horsf", &salt, &KdfParams::FAST_FOR_TESTS).unwrap());
        assert_ne!(*base, *derive_kek(b"correct horse", &[8u8; 16], &KdfParams::FAST_FOR_TESTS).unwrap());
    }

    #[test]
    fn a_settings_change_gives_another_key() {
        let salt = [7u8; 16];
        let a = derive_kek(b"pw", &salt, &KdfParams { m_kib: 64, t: 1, p: 1 }).unwrap();
        let b = derive_kek(b"pw", &salt, &KdfParams { m_kib: 64, t: 2, p: 1 }).unwrap();
        assert_ne!(*a, *b);
    }

    #[test]
    fn out_of_bounds_settings_are_refused_before_any_work() {
        let result = derive_kek(
            b"pw",
            &[0u8; 16],
            &KdfParams {
                m_kib: 4_000_000,
                t: 3,
                p: 1,
            },
        );
        assert!(matches!(result, Err(ProtectionError::KdfOutOfBounds(_))));
    }

    #[test]
    fn production_cost_stays_usable_in_test_builds() {
        // Guards the opt-level override for argon2 in the root Cargo.toml: without it this takes
        // tens of seconds in a debug build, and every unlock would too.
        let started = std::time::Instant::now();
        derive_kek(b"pw", &[1u8; 16], &KdfParams::PRODUCTION).unwrap();
        assert!(started.elapsed() < std::time::Duration::from_secs(5), "took {:?}", started.elapsed());
    }
}
