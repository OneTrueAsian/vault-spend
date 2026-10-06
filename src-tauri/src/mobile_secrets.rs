//! Installation-local secrets. No plaintext fallback and no financial database dependency.
use std::path::PathBuf;
use zeroize::Zeroizing;

pub trait SecretStore: Send + Sync {
    fn lock(&self) -> Option<std::sync::MutexGuard<'_, ()>> {
        None
    }
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String>;
    fn write(&self, bytes: &[u8]) -> Result<(), String>;
}
#[derive(Clone)]
pub struct OsSecrets {
    path: PathBuf,
    lock: std::sync::Arc<std::sync::Mutex<()>>,
}
impl OsSecrets {
    fn marker(&self) -> PathBuf {
        self.path.with_extension("identity-created")
    }
    fn mark_created(&self) -> Result<(), String> {
        if !self.marker().exists() {
            budget_core::fsutil::write_atomic(&self.marker(), b"1").map_err(|_| FAILURE.to_string())?;
        }
        Ok(())
    }
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: std::sync::Arc::new(std::sync::Mutex::new(())),
        }
    }
}
const FAILURE: &str = "Mobile certificate protection is unavailable. Saved keys were not replaced; mobile access remains stopped.";

#[cfg(windows)]
fn dpapi(bytes: &[u8], protect: bool) -> Result<Zeroizing<Vec<u8>>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len().try_into().map_err(|_| FAILURE)?,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let entropy = b"Vault Spend mobile certificate bundle v1";
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: entropy.len() as u32,
        pbData: entropy.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // Input slices remain alive; Windows allocates the output with LocalAlloc. Never use
    // CRYPTPROTECT_LOCAL_MACHINE: protection belongs to the current OS account.
    unsafe {
        let result = if protect {
            CryptProtectData(
                &input,
                windows::core::PCWSTR::null(),
                Some(&entropy),
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        };
        result.map_err(|_| FAILURE.to_string())?;
        let slice = std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize);
        let value = Zeroizing::new(slice.to_vec());
        use zeroize::Zeroize;
        slice.zeroize();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(value)
    }
}
impl SecretStore for OsSecrets {
    fn lock(&self) -> Option<std::sync::MutexGuard<'_, ()>> {
        Some(self.lock.lock().unwrap_or_else(|p| p.into_inner()))
    }
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        #[cfg(windows)]
        {
            let file = match std::fs::File::open(&self.path) {
                Ok(file) => file,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return if self.marker().exists() { Err(FAILURE.into()) } else { Ok(None) },
                Err(_) => return Err(FAILURE.into()),
            };
            use std::io::Read;
            let mut bytes = Vec::new();
            file.take(65537).read_to_end(&mut bytes).map_err(|_| FAILURE)?;
            if bytes.len() > 65536 {
                return Err(FAILURE.into());
            }
            let plain = dpapi(&bytes, false)?;
            self.mark_created()?;
            Ok(Some(plain))
        }
        #[cfg(target_os = "macos")]
        {
            use sha2::{Digest, Sha256};
            let name = format!("{:x}", Sha256::digest(self.path.to_string_lossy().as_bytes()));
            let entry = keyring::Entry::new("com.joeyf.vaultspend.mobile", &name).map_err(|_| FAILURE)?;
            match entry.get_secret() {
                Ok(bytes) if bytes.len() <= 65536 => {
                    self.mark_created()?;
                    Ok(Some(Zeroizing::new(bytes)))
                }
                Err(keyring::Error::NoEntry) => {
                    if self.marker().exists() {
                        Err(FAILURE.into())
                    } else {
                        Ok(None)
                    }
                }
                _ => Err(FAILURE.into()),
            }
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = &self.path;
            Err(FAILURE.into())
        }
    }
    fn write(&self, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > 65536 {
            return Err(FAILURE.into());
        }
        #[cfg(windows)]
        {
            let protected = dpapi(bytes, true)?;
            self.mark_created()?;
            budget_core::fsutil::write_atomic(&self.path, &protected).map_err(|_| FAILURE.to_string())
        }
        #[cfg(target_os = "macos")]
        {
            use sha2::{Digest, Sha256};
            let name = format!("{:x}", Sha256::digest(self.path.to_string_lossy().as_bytes()));
            self.mark_created()?;
            keyring::Entry::new("com.joeyf.vaultspend.mobile", &name)
                .and_then(|entry| entry.set_secret(bytes))
                .map_err(|_| FAILURE.to_string())
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            Err(FAILURE.into())
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn native_current_user_protection_roundtrips_and_detects_corruption() {
        let value = b"synthetic certificate private key";
        let protected = dpapi(value, true).unwrap();
        assert!(!protected.windows(value.len()).any(|w| w == value));
        assert_eq!(dpapi(&protected, false).unwrap().as_slice(), value);
        let mut corrupt = protected.to_vec();
        corrupt[20] ^= 1;
        assert!(dpapi(&corrupt, false).is_err());
    }
}
