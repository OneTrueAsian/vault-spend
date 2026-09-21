//! Wraps the database key (DEK) under a key derived from a password or recovery code
//! (plan v2 section 4.1). XChaCha20-Poly1305 with a fresh random nonce; the associated data
//! binds the wrap to its protection id, format version, slot type and KDF settings.
use super::{ProtectionError, random_bytes};
use chacha20poly1305::{
    Key, XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use zeroize::Zeroizing;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Wrapped {
    pub nonce: [u8; 24],
    pub ciphertext: Vec<u8>,
}

/// A fresh random 32-byte database key.
pub fn generate_dek() -> Zeroizing<[u8; 32]> {
    Zeroizing::new(random_bytes::<32>())
}

pub fn wrap_dek(kek: &[u8; 32], dek: &[u8; 32], aad: &[u8]) -> Wrapped {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(kek));
    let nonce = random_bytes::<24>();
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: dek, aad })
        .expect("encrypting 32 bytes cannot fail");
    Wrapped { nonce, ciphertext }
}

/// Every failure is `WrongPasswordOrTampered`: a wrong key, a moved wrap and a modified wrap
/// look the same on purpose.
pub fn unwrap_dek(kek: &[u8; 32], wrapped: &Wrapped, aad: &[u8]) -> Result<Zeroizing<[u8; 32]>, ProtectionError> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(kek));
    let plain = Zeroizing::new(
        cipher
            .decrypt(
                XNonce::from_slice(&wrapped.nonce),
                Payload {
                    msg: &wrapped.ciphertext,
                    aad,
                },
            )
            .map_err(|_| ProtectionError::WrongPasswordOrTampered)?,
    );
    let bytes: [u8; 32] = plain.as_slice().try_into().map_err(|_| ProtectionError::WrongPasswordOrTampered)?;
    Ok(Zeroizing::new(bytes))
}
#[cfg(test)]
mod tests {
    use super::*;

    const KEK: [u8; 32] = [3u8; 32];
    const AAD: &[u8] = b"vaultspend-key-v1|1|password|abc";

    #[test]
    fn a_wrapped_key_unwraps_to_the_same_key() {
        let dek = generate_dek();

        let wrapped = wrap_dek(&KEK, &dek, AAD);

        assert_eq!(wrapped.ciphertext.len(), 32 + 16, "32 key bytes plus the 16-byte tag");
        assert_eq!(*unwrap_dek(&KEK, &wrapped, AAD).unwrap(), *dek);
    }

    #[test]
    fn two_wraps_of_the_same_key_differ() {
        let dek = generate_dek();
        let (a, b) = (wrap_dek(&KEK, &dek, AAD), wrap_dek(&KEK, &dek, AAD));
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.ciphertext, b.ciphertext);
    }

    #[test]
    fn generated_keys_are_not_constant() {
        assert_ne!(*generate_dek(), *generate_dek());
    }

    #[test]
    fn a_wrong_key_encryption_key_fails_generically() {
        let wrapped = wrap_dek(&KEK, &generate_dek(), AAD);
        assert_eq!(
            unwrap_dek(&[4u8; 32], &wrapped, AAD).err(),
            Some(ProtectionError::WrongPasswordOrTampered)
        );
    }

    #[test]
    fn a_different_context_fails_so_a_wrap_cannot_be_moved() {
        let wrapped = wrap_dek(&KEK, &generate_dek(), AAD);
        assert_eq!(
            unwrap_dek(&KEK, &wrapped, b"vaultspend-key-v1|1|password|OTHER-PROFILE").err(),
            Some(ProtectionError::WrongPasswordOrTampered)
        );
    }

    #[test]
    fn a_modified_nonce_or_ciphertext_fails() {
        let wrapped = wrap_dek(&KEK, &generate_dek(), AAD);

        let mut bad_nonce = Wrapped {
            nonce: wrapped.nonce,
            ciphertext: wrapped.ciphertext.clone(),
        };
        bad_nonce.nonce[0] ^= 1;
        let mut bad_text = Wrapped {
            nonce: wrapped.nonce,
            ciphertext: wrapped.ciphertext.clone(),
        };
        bad_text.ciphertext[5] ^= 1;
        let short = Wrapped {
            nonce: wrapped.nonce,
            ciphertext: wrapped.ciphertext[..20].to_vec(),
        };

        for tampered in [bad_nonce, bad_text, short] {
            assert_eq!(unwrap_dek(&KEK, &tampered, AAD).err(), Some(ProtectionError::WrongPasswordOrTampered));
        }
    }
}
