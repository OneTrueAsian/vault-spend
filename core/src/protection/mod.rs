//! Per-profile password protection: key derivation, key wrapping, recovery codes and the
//! key file. Pure library code with no Tauri or UI dependency. Design: plan v2 sections
//! 4.1 and 4.3.
pub mod kdf;
pub mod recovery;
pub mod wrap;

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtectionError {
    /// A wrong password, a wrong recovery code or a modified key file. Deliberately one case:
    /// the caller must not be able to tell them apart.
    WrongPasswordOrTampered,
    KdfOutOfBounds(String),
    MalformedKeyFile(String),
    UnsupportedVersion(u32),
    InvalidRecoveryCode,
    Io(String),
}

impl fmt::Display for ProtectionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProtectionError::WrongPasswordOrTampered => write!(f, "That password didn't work."),
            ProtectionError::KdfOutOfBounds(why) => write!(f, "The protection settings are out of range: {why}"),
            ProtectionError::MalformedKeyFile(why) => write!(f, "The protection information can't be read: {why}"),
            ProtectionError::UnsupportedVersion(v) => {
                write!(f, "This profile was protected by a newer Vault Spend (format {v}). Update Vault Spend.")
            }
            ProtectionError::InvalidRecoveryCode => write!(f, "That recovery key isn't valid."),
            ProtectionError::Io(why) => write!(f, "{why}"),
        }
    }
}

impl std::error::Error for ProtectionError {}

/// Cryptographically random bytes from the operating system.
pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    getrandom::getrandom(&mut out).expect("the operating system's random source must be available");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_bytes_are_not_constant() {
        assert_ne!(random_bytes::<32>(), random_bytes::<32>());
    }

    #[test]
    fn the_wrong_password_message_does_not_say_why() {
        assert_eq!(ProtectionError::WrongPasswordOrTampered.to_string(), "That password didn't work.");
    }
}
