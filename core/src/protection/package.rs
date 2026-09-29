//! The portable `.vaultspend` directory package for a protected profile.
//! It contains this manifest, an encrypted database, and that database's key file.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

pub const PACKAGE_FORMAT: u32 = 1;
pub const MANIFEST_FILENAME: &str = "manifest.json";
pub const DATABASE_FILENAME: &str = "vaultspend.db";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackageManifest {
    pub format: u32,
    pub profile_name: String,
    pub protection_format: u32,
    pub app_version: String,
    pub schema_user_version: i64,
    pub database_sha256: String,
    pub exported_at: String,
}

impl PackageManifest {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("a manifest always serializes")
    }

    pub fn from_json(json: &str) -> Result<PackageManifest, String> {
        serde_json::from_str(json).map_err(|e| format!("this package's manifest is damaged: {e}"))
    }
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_manifest_round_trips_through_json() {
        let manifest = PackageManifest {
            format: PACKAGE_FORMAT,
            profile_name: "Sam".to_string(),
            protection_format: 1,
            app_version: "1.2.8".to_string(),
            schema_user_version: 7,
            database_sha256: "abc123".to_string(),
            exported_at: "2026-09-24T09:00:00Z".to_string(),
        };

        assert_eq!(PackageManifest::from_json(&manifest.to_json()).unwrap(), manifest);
    }

    #[test]
    fn a_damaged_manifest_is_refused_with_a_readable_error() {
        assert!(PackageManifest::from_json("not json").is_err());
    }

    #[test]
    fn file_hash_is_stable_and_sensitive_to_content() {
        let path = std::env::temp_dir().join(format!("vaultspend-package-hash-{}", std::process::id()));
        std::fs::write(&path, b"abc").unwrap();
        assert_eq!(
            sha256_file(&path).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        std::fs::write(&path, b"abcd").unwrap();
        assert_ne!(
            sha256_file(&path).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let _ = std::fs::remove_file(path);
    }
}
