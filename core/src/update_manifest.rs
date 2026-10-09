//! Signed installer metadata. Trust keys are supplied by the app, never by a release response.
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};

pub const MAX_MANIFEST_BYTES: usize = 16 * 1024;
pub const MAX_INSTALLER_BYTES: u64 = 512 * 1024 * 1024;
pub const REPOSITORY: &str = "OneTrueAsian/vault-spend";

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UpdateManifest {
    pub format: u32,
    pub repository: String,
    pub version: String,
    pub target: String,
    pub filename: String,
    pub size: u64,
    pub sha256: String,
}

pub struct TrustedUpdateKey<'a> {
    pub id: &'a str,
    pub public_key: &'a [u8; 32],
}

/// Verifies the exact bounded UTF-8 bytes; callers must not reserialize them before verification.
pub fn verify_manifest(
    bytes: &[u8],
    signature: &[u8],
    key_id: &str,
    keys: &[TrustedUpdateKey<'_>],
    target: &str,
    current_version: &str,
) -> Result<UpdateManifest, &'static str> {
    if bytes.is_empty() || bytes.len() > MAX_MANIFEST_BYTES {
        return Err("The update manifest has an invalid size.");
    }
    let mut matches = keys.iter().filter(|key| key.id == key_id);
    let key = matches.next().ok_or("The update signing key is not trusted.")?;
    if matches.next().is_some() {
        return Err("The update signing key is ambiguous.");
    }
    UnparsedPublicKey::new(&ED25519, key.public_key)
        .verify(bytes, signature)
        .map_err(|_| "The update signature could not be verified.")?;
    let manifest: UpdateManifest = serde_json::from_slice(bytes).map_err(|_| "The update manifest is invalid.")?;
    if manifest.format != 1 || manifest.repository != REPOSITORY || manifest.target != target {
        return Err("The update does not match this app or platform.");
    }
    let current = stable_version(current_version).ok_or("The installed version is invalid.")?;
    let newer = stable_version(&manifest.version).ok_or("The update version is invalid.")?;
    if newer <= current {
        return Err("The update is not newer than the installed version.");
    }
    let prefix = format!("Vault.Spend_{}", manifest.version);
    let filenames = match target {
        "windows-x86_64" => vec![format!("{prefix}_x64-setup.exe"), format!("{prefix}_x64_en-US.msi")],
        "macos-universal" => vec![format!("{prefix}_universal.dmg")],
        _ => return Err("The update platform is not supported."),
    };
    if !filenames.contains(&manifest.filename) || manifest.size == 0 || manifest.size > MAX_INSTALLER_BYTES || !valid_digest(&manifest.sha256) {
        return Err("The update installer metadata is invalid.");
    }
    Ok(manifest)
}

/// Must be called again on staged bytes immediately before a future installer-open action.
pub fn verify_installer(manifest: &UpdateManifest, bytes: &[u8]) -> Result<(), &'static str> {
    if manifest.size == 0 || manifest.size > MAX_INSTALLER_BYTES || bytes.len() as u64 != manifest.size || !valid_digest(&manifest.sha256) {
        return Err("The update installer size does not match its signed manifest.");
    }
    if format!("{:x}", Sha256::digest(bytes)) != manifest.sha256 {
        return Err("The update installer does not match its signed manifest.");
    }
    Ok(())
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn stable_version(value: &str) -> Option<[u32; 3]> {
    let mut parts = value.split('.');
    let mut parsed = [0; 3];
    for part in &mut parsed {
        let raw = parts.next()?;
        if raw.is_empty() || !raw.bytes().all(|byte| byte.is_ascii_digit()) || (raw.len() > 1 && raw.starts_with('0')) {
            return None;
        }
        *part = raw.parse().ok()?;
    }
    if parts.next().is_some() {
        return None;
    }
    Some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};
    use sha2::{Digest, Sha256};

    // Publicly known disposable unit-test seed; never a production publisher identity.
    fn signer() -> Ed25519KeyPair {
        Ed25519KeyPair::from_seed_unchecked(&[7; 32]).unwrap()
    }

    fn payload() -> serde_json::Value {
        serde_json::json!({
            "format": 1, "repository": REPOSITORY, "version": "1.4.0",
            "target": "windows-x86_64", "filename": "Vault.Spend_1.4.0_x64-setup.exe",
            "size": 5, "sha256": format!("{:x}", Sha256::digest(b"inert"))
        })
    }

    fn check(bytes: &[u8], signature: &[u8], key_id: &str, target: &str, current: &str) -> Result<UpdateManifest, &'static str> {
        let signer = signer();
        let public: [u8; 32] = signer.public_key().as_ref().try_into().unwrap();
        verify_manifest(
            bytes,
            signature,
            key_id,
            &[TrustedUpdateKey {
                id: "fixture",
                public_key: &public,
            }],
            target,
            current,
        )
    }

    fn signed(value: serde_json::Value) -> Result<UpdateManifest, &'static str> {
        let bytes = serde_json::to_vec(&value).unwrap();
        check(&bytes, signer().sign(&bytes).as_ref(), "fixture", "windows-x86_64", "1.3.0")
    }

    #[test]
    fn accepts_authentic_matching_newer_release_and_inert_installer() {
        let manifest = signed(payload()).unwrap();
        assert_eq!(manifest.version, "1.4.0");
        verify_installer(&manifest, b"inert").unwrap();
    }

    #[test]
    fn rejects_payload_changes_wrong_signatures_and_unknown_keys() {
        let bytes = serde_json::to_vec(&payload()).unwrap();
        let signature = signer().sign(&bytes);
        let mut changed = bytes.clone();
        changed.push(b' ');
        assert!(check(&changed, signature.as_ref(), "fixture", "windows-x86_64", "1.3.0").is_err());
        assert!(check(&bytes, &[0; 64], "fixture", "windows-x86_64", "1.3.0").is_err());
        assert!(check(&bytes, signature.as_ref(), "unknown", "windows-x86_64", "1.3.0").is_err());
        assert!(verify_manifest(&bytes, signature.as_ref(), "fixture", &[], "windows-x86_64", "1.3.0").is_err());
    }

    #[test]
    fn rejects_signed_metadata_for_wrong_product_target_or_old_version() {
        for (field, value) in [
            ("repository", "another/project"),
            ("target", "macos-universal"),
            ("version", "1.3.0"),
            ("version", "1.2.9"),
            ("version", "1.4.0-beta"),
            ("version", "01.4.0"),
            ("version", "1.4"),
        ] {
            let mut data = payload();
            data[field] = value.into();
            assert!(signed(data).is_err(), "{field}={value}");
        }
    }

    #[test]
    fn rejects_unsafe_names_invalid_digests_sizes_and_formats() {
        for filename in [
            "../evil.exe",
            "C:\\evil.exe",
            "other.exe",
            "Vault.Spend_1.3.0_x64-setup.exe",
            "Vault.Spend_1.4.0_x64-setup.exe ",
        ] {
            let mut data = payload();
            data["filename"] = filename.into();
            assert!(signed(data).is_err(), "{filename}");
        }
        for digest in ["0", "z".repeat(64).as_str(), "A".repeat(64).as_str()] {
            let mut data = payload();
            data["sha256"] = digest.into();
            assert!(signed(data).is_err());
        }
        for size in [0, MAX_INSTALLER_BYTES + 1] {
            let mut data = payload();
            data["size"] = size.into();
            assert!(signed(data).is_err());
        }
        let mut data = payload();
        data["format"] = 2.into();
        assert!(signed(data).is_err());
    }

    #[test]
    fn rejects_unknown_or_duplicate_json_fields_and_oversized_metadata() {
        let mut data = payload();
        data["extra"] = true.into();
        assert!(signed(data).is_err());
        let valid = serde_json::to_string(&payload()).unwrap();
        let duplicate = valid.replacen('{', "{\"format\":1,", 1);
        let bytes = duplicate.as_bytes();
        assert!(check(bytes, signer().sign(bytes).as_ref(), "fixture", "windows-x86_64", "1.3.0").is_err());
        let bytes = vec![b' '; MAX_MANIFEST_BYTES + 1];
        assert!(check(&bytes, signer().sign(&bytes).as_ref(), "fixture", "windows-x86_64", "1.3.0").is_err());
    }

    #[test]
    fn rejects_changed_installer_content_and_size() {
        let manifest = signed(payload()).unwrap();
        assert!(verify_installer(&manifest, b"other").is_err());
        assert!(verify_installer(&manifest, b"inert extra").is_err());
    }

    #[test]
    fn accepts_supported_platform_and_package_shapes() {
        for (target, filename) in [
            ("windows-x86_64", "Vault.Spend_1.4.0_x64_en-US.msi"),
            ("macos-universal", "Vault.Spend_1.4.0_universal.dmg"),
        ] {
            let mut data = payload();
            data["target"] = target.into();
            data["filename"] = filename.into();
            let bytes = serde_json::to_vec(&data).unwrap();
            check(&bytes, signer().sign(&bytes).as_ref(), "fixture", target, "1.3.0").unwrap();
        }
    }
}
