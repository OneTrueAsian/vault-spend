use super::*;

fn protected_store_for_package_test(dir: &std::path::Path, password: &str) -> (Store, std::path::PathBuf) {
    use budget_core::protection::{kdf::KdfParams, keyfile};
    use budget_core::store::DatabaseKey;

    let plain_path = dir.join("plain.db");
    let protected_path = dir.join("protected.db");
    let plain = Store::open(&plain_path).unwrap();
    let protection = keyfile::create_protection(password, &KdfParams::FAST_FOR_TESTS, "2026-09-23T00:00:00Z").unwrap();
    plain.export_encrypted_copy(&protected_path, protection.dek.as_bytes()).unwrap();
    protection.key_file.write_to(&keyfile::key_file_path_for(&protected_path)).unwrap();
    (
        Store::open_with_key(&protected_path, DatabaseKey::Raw(protection.dek.as_bytes())).unwrap(),
        protected_path,
    )
}

#[test]
fn exporting_a_protected_profile_writes_a_complete_package() {
    let dir = std::env::temp_dir().join(format!("vaultspend-package-export-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let (store, source_path) = protected_store_for_package_test(&dir, "package password");
    let destination = dir.join("Sam.vaultspend");

    export_protected_package(&destination, "Sam", &source_path, &store, "2026-09-24T09:00:00Z").unwrap();

    let database_path = destination.join(budget_core::protection::package::DATABASE_FILENAME);
    let manifest = budget_core::protection::PackageManifest::from_json(
        &std::fs::read_to_string(destination.join(budget_core::protection::package::MANIFEST_FILENAME)).unwrap(),
    )
    .unwrap();
    assert_eq!(manifest.profile_name, "Sam");
    assert_eq!(manifest.protection_format, 1);
    assert_eq!(
        manifest.database_sha256,
        budget_core::protection::package::sha256_file(&database_path).unwrap()
    );
    assert!(budget_core::protection::keyfile::key_file_path_for(&database_path).exists());
    assert!(budget_core::store::file_looks_encrypted(&database_path).unwrap());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn importing_a_protected_package_requires_its_password_and_intact_database() {
    let dir = std::env::temp_dir().join(format!("vaultspend-package-import-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let (store, source_path) = protected_store_for_package_test(&dir, "package password");
    let package = dir.join("Sam.vaultspend");
    export_protected_package(&package, "Sam", &source_path, &store, "2026-09-24T09:00:00Z").unwrap();

    let sessions = crate::protection::session::Sessions::new();
    assert!(validate_protected_package(&package, "wrong password", &sessions).is_err());
    assert!(validate_protected_package(&package, "package password", &sessions).is_ok());
    std::fs::write(package.join(budget_core::protection::package::DATABASE_FILENAME), b"damaged").unwrap();
    assert!(validate_protected_package(&package, "package password", &sessions)
        .err()
        .unwrap()
        .contains("doesn't match"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn relocating_an_encrypted_database_copies_its_key_file() {
    use budget_core::protection::{kdf::KdfParams, keyfile};
    use budget_core::store::DatabaseKey;

    let dir = std::env::temp_dir().join(format!("vaultspend-relocate-protected-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let source_path = dir.join("source.db");
    let destination_path = dir.join("moved").join("vaultspend.db");
    std::fs::create_dir_all(destination_path.parent().unwrap()).unwrap();
    let plain = Store::open(dir.join("plain.db")).unwrap();
    let protection = keyfile::create_protection("same password", &KdfParams::FAST_FOR_TESTS, "2026-09-23T00:00:00Z").unwrap();
    plain.export_encrypted_copy(&source_path, protection.dek.as_bytes()).unwrap();
    protection.key_file.write_to(&keyfile::key_file_path_for(&source_path)).unwrap();
    let encrypted = Store::open_with_key(&source_path, DatabaseKey::Raw(protection.dek.as_bytes())).unwrap();

    copy_database_for_relocation(&encrypted, &source_path, &destination_path).unwrap();

    let copied_key = keyfile::KeyFile::read(&keyfile::key_file_path_for(&destination_path)).unwrap();
    let copied_dek = copied_key.unlock_with_password("same password").unwrap();
    assert!(Store::open_with_key(&destination_path, DatabaseKey::Raw(copied_dek.as_bytes())).is_ok());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_relocation_key_file_failure_is_plain_and_removes_the_new_database() {
    use budget_core::protection::{kdf::KdfParams, keyfile};
    use budget_core::store::DatabaseKey;

    let dir = std::env::temp_dir().join(format!("vaultspend-relocate-keyfail-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let source_path = dir.join("source.db");
    let destination_path = dir.join("moved").join("vaultspend.db");
    std::fs::create_dir_all(destination_path.parent().unwrap()).unwrap();
    let plain = Store::open(dir.join("plain.db")).unwrap();
    let protection = keyfile::create_protection("same password", &KdfParams::FAST_FOR_TESTS, "2026-09-23T00:00:00Z").unwrap();
    plain.export_encrypted_copy(&source_path, protection.dek.as_bytes()).unwrap();
    protection.key_file.write_to(&keyfile::key_file_path_for(&source_path)).unwrap();
    let encrypted = Store::open_with_key(&source_path, DatabaseKey::Raw(protection.dek.as_bytes())).unwrap();
    std::fs::create_dir(keyfile::key_file_path_for(&destination_path)).unwrap();

    let error = copy_database_for_relocation(&encrypted, &source_path, &destination_path).unwrap_err();

    assert_eq!(error, PROFILE_KEY_FILE_FAILED);
    assert!(!destination_path.exists(), "the new database file must be removed");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_export_key_file_failure_is_plain_and_leaves_no_package() {
    let dir = std::env::temp_dir().join(format!("vaultspend-export-keyfail-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let (store, source_path) = protected_store_for_package_test(&dir, "pw");
    std::fs::remove_file(budget_core::protection::keyfile::key_file_path_for(&source_path)).unwrap();
    let package = dir.join("package");

    let error = export_protected_package(&package, "Sam", &source_path, &store, "2026-09-24T09:00:00Z").unwrap_err();

    assert_eq!(error, PROFILE_EXPORT_KEY_FILE_FAILED);
    assert!(!package.exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_relocation_key_file_failure_removes_a_partial_destination_key_file() {
    use budget_core::protection::{kdf::KdfParams, keyfile};
    use budget_core::store::DatabaseKey;

    let dir = std::env::temp_dir().join(format!("vaultspend-relocate-partialkey-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let source_path = dir.join("source.db");
    let destination_path = dir.join("moved").join("vaultspend.db");
    std::fs::create_dir_all(destination_path.parent().unwrap()).unwrap();
    let plain = Store::open(dir.join("plain.db")).unwrap();
    let protection = keyfile::create_protection("pw", &KdfParams::FAST_FOR_TESTS, "2026-09-23T00:00:00Z").unwrap();
    plain.export_encrypted_copy(&source_path, protection.dek.as_bytes()).unwrap();
    // The source key is missing and a half-written destination key is lying there.
    std::fs::write(keyfile::key_file_path_for(&destination_path), b"partial").unwrap();
    let encrypted = Store::open_with_key(&source_path, DatabaseKey::Raw(protection.dek.as_bytes())).unwrap();

    let error = copy_database_for_relocation(&encrypted, &source_path, &destination_path).unwrap_err();

    assert_eq!(error, PROFILE_KEY_FILE_FAILED);
    assert!(!keyfile::key_file_path_for(&destination_path).exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_relocation_data_copy_failure_is_plain_and_leaves_no_new_database() {
    let dir = std::env::temp_dir().join(format!("vaultspend-relocate-copyfail-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let store = Store::open(dir.join("live.db")).unwrap();
    let destination = dir.join("missing-folder").join("vaultspend.db");

    let error = copy_database_for_relocation(&store, &dir.join("live.db"), &destination).unwrap_err();

    assert_eq!(error, PROFILE_COPY_FAILED);
    assert!(!destination.exists());
    let _ = std::fs::remove_dir_all(&dir);
}
