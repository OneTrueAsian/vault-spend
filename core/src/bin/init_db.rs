// Headless schema/migration initializer for E2E test fixtures (see
// e2e/lib/seed.mjs). Calls the exact same `Store::open` migration path the
// real app and every Rust test already use, then exits immediately — no
// need to launch the full Tauri app and sleep for an arbitrary "probably
// done by now" duration just to get a fresh, migrated vaultspend.db.
//
// `init_db <dir> --protect` instead turns an already-seeded practice database into a password-protected
// one through the app's own protection code (e2e/lib/practice-data, the "Locked" profile). The password
// comes from VAULTSPEND_PRACTICE_PASSWORD so it never appears on a command line; the recovery key is
// printed once on stdout for the caller to write into the practice README.
use std::path::{Path, PathBuf};

use budget_core::protection::kdf::KdfParams;
use budget_core::protection::keyfile::{create_protection, key_file_path_for};
use budget_core::store::Store;

fn main() {
    let dir = PathBuf::from(std::env::args().nth(1).expect("usage: init_db <dir> [--protect]"));
    let db_path = dir.join("vaultspend.db");
    if std::env::args().nth(2).as_deref() == Some("--protect") {
        let password = std::env::var("VAULTSPEND_PRACTICE_PASSWORD").expect("VAULTSPEND_PRACTICE_PASSWORD is not set");
        let recovery = protect(&db_path, &dir.join("vaultspend-protected.db"), &password, &KdfParams::PRODUCTION);
        println!("{recovery}");
        return;
    }
    Store::open(&db_path).expect("failed to initialize database");
}

/// Writes an encrypted copy of `plain` to `dest` plus its key file, then deletes `plain`. Returns the recovery key.
fn protect(plain: &Path, dest: &Path, password: &str, params: &KdfParams) -> String {
    let store = Store::open(plain).expect("failed to open the practice database");
    let now = chrono::Utc::now().to_rfc3339();
    let protection = create_protection(password, params, &now).expect("failed to create protection");
    store.export_encrypted_copy(dest, protection.dek.as_bytes()).expect("failed to write the protected copy");
    protection.key_file.write_to(&key_file_path_for(dest)).expect("failed to write the key file");
    drop(store);
    std::fs::remove_file(plain).expect("failed to remove the plaintext copy");
    protection.recovery_code.display()
}

#[cfg(test)]
mod tests {
    use super::*;
    use budget_core::protection::keyfile::KeyFile;
    use budget_core::store::DatabaseKey;

    #[test]
    fn protected_practice_copy_opens_with_its_password_and_leaves_no_plaintext() {
        let dir = std::env::temp_dir().join(format!("vs-init-db-protect-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let plain = dir.join("vaultspend.db");
        Store::open(&plain).unwrap().create_family_member("Locked practice").unwrap();
        let dest = dir.join("vaultspend-protected.db");

        let recovery = protect(&plain, &dest, "practice password 1", &KdfParams::FAST_FOR_TESTS);

        assert!(!plain.exists());
        for sidecar in ["vaultspend.db-wal", "vaultspend.db-shm"] {
            assert!(!dir.join(sidecar).exists(), "{sidecar} left behind");
        }
        assert!(!recovery.is_empty());
        let key_file = KeyFile::read(&key_file_path_for(&dest)).unwrap();
        assert!(key_file.unlock_with_password("wrong").is_err());
        let key = key_file.unlock_with_password("practice password 1").unwrap();
        let opened = Store::open_with_key(&dest, DatabaseKey::Raw(key.as_bytes())).unwrap();
        let names: Vec<String> = opened.list_family_members().unwrap().into_iter().map(|m| m.name).collect();
        assert_eq!(names, ["Locked practice"]);
        drop(opened);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
