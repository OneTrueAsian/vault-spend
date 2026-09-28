//! Password changes for an already-protected profile. A rotation creates a new DEK, encrypted
//! live database, password/recovery wrappers, and re-encrypted primary backups before committing
//! the profile path. A journal makes pre-commit work disposable and post-commit work resumable.
use crate::{backups, config, profiles};
use budget_core::fsutil::write_atomic;
use budget_core::protection::kdf::KdfParams;
use budget_core::protection::keyfile::{self, KeyFile};
use budget_core::protection::recovery::RecoveryCode;
use budget_core::store::{DatabaseKey, Store};
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const ROTATION_JOURNAL_FILENAME: &str = "protection-rotation-journal.json";
const REMOVAL_JOURNAL_FILENAME: &str = "protection-removal-journal.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RotationJournal {
    format: u32,
    profile_id: String,
    old_db_path: String,
    old_key_path: String,
    target_db_path: String,
    target_key_path: String,
    staged_backup_filenames: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemovalJournal {
    format: u32,
    profile_id: String,
    old_db_path: String,
    old_key_path: String,
    target_db_path: String,
}

fn removal_journal_path_for(config_path: &Path) -> PathBuf {
    config_path.parent().unwrap_or_else(|| Path::new(".")).join(REMOVAL_JOURNAL_FILENAME)
}

fn write_removal_journal(config_path: &Path, journal: &RemovalJournal) -> Result<(), String> {
    let json = serde_json::to_string_pretty(journal).expect("RemovalJournal always serializes");
    write_atomic(&removal_journal_path_for(config_path), json.as_bytes()).map_err(|e| e.to_string())
}

fn unique_plaintext_path(source_db_path: &Path) -> PathBuf {
    let dir = source_db_path.parent().unwrap_or_else(|| Path::new("."));
    for number in 1.. {
        let candidate = if number == 1 {
            dir.join("vaultspend.db")
        } else {
            dir.join(format!("vaultspend-{number}.db"))
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

fn rotation_journal_path_for(config_path: &Path) -> PathBuf {
    config_path.parent().unwrap_or_else(|| Path::new(".")).join(ROTATION_JOURNAL_FILENAME)
}

fn write_rotation_journal(config_path: &Path, journal: &RotationJournal) -> Result<(), String> {
    let json = serde_json::to_string_pretty(journal).expect("RotationJournal always serializes");
    write_atomic(&rotation_journal_path_for(config_path), json.as_bytes()).map_err(|e| e.to_string())
}

fn staging_dir_for(protected_backups_dir: &Path) -> PathBuf {
    protected_backups_dir.join(".rotate-staging")
}

fn unique_protected_path(source_db_path: &Path) -> PathBuf {
    let dir = source_db_path.parent().unwrap_or_else(|| Path::new("."));
    let base = dir.join("vaultspend-protected.db");
    if !base.exists() {
        return base;
    }
    let mut n = 2;
    loop {
        let candidate = dir.join(format!("vaultspend-protected-{n}.db"));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

enum Proof<'a> {
    Password(&'a str),
    Recovery(&'a RecoveryCode),
}

fn proof_error(proof: &Proof<'_>) -> String {
    match proof {
        Proof::Password(_) => "That password didn't work.".to_string(),
        Proof::Recovery(_) => "That recovery key didn't work.".to_string(),
    }
}

fn replace_from_staging(staged: &Path, destination: &Path) -> Result<(), String> {
    if !staged.exists() {
        return Ok(());
    }
    if destination.exists() {
        std::fs::remove_file(destination).map_err(|e| format!("couldn't replace {}: {e}", destination.display()))?;
    }
    std::fs::rename(staged, destination).map_err(|e| format!("couldn't install {}: {e}", destination.display()))
}

fn finish_rotation(config_path: &Path, journal: &RotationJournal) -> Result<(), String> {
    let target_db_path = Path::new(&journal.target_db_path);
    let protected_backups_dir = backups::backups_dir_for(target_db_path, true);
    let staging_dir = staging_dir_for(&protected_backups_dir);
    for filename in &journal.staged_backup_filenames {
        let staged_db = staging_dir.join(filename);
        let staged_key = keyfile::key_file_path_for(&staged_db);
        let final_db = protected_backups_dir.join(filename);
        let final_key = keyfile::key_file_path_for(&final_db);
        // These are deliberately independent. If the process dies between them, startup sees the
        // journal and moves whichever staged half remains before any profile is opened.
        replace_from_staging(&staged_db, &final_db)?;
        replace_from_staging(&staged_key, &final_key)?;
    }
    let _ = std::fs::remove_dir(&staging_dir);
    config::write_db_location_config(config_path, target_db_path).map_err(|e| e.to_string())?;
    Ok(())
}

fn retire_committed_rotation(config_path: &Path, journal: &RotationJournal) -> Result<(), String> {
    finish_rotation(config_path, journal)?;
    if Path::new(&journal.old_db_path).exists() {
        std::fs::remove_file(&journal.old_db_path).map_err(|e| format!("couldn't remove the old encrypted database: {e}"))?;
    }
    if Path::new(&journal.old_key_path).exists() {
        std::fs::remove_file(&journal.old_key_path).map_err(|e| format!("couldn't remove the old key file: {e}"))?;
    }
    std::fs::remove_file(rotation_journal_path_for(config_path)).map_err(|e| e.to_string())
}

#[allow(clippy::too_many_arguments)]
fn rotate_dek(
    config_path: &Path,
    profile_id: &str,
    live_db_path: &Path,
    store: &Store,
    proof: Proof<'_>,
    new_password: &str,
    recovery_code: RecoveryCode,
    now: NaiveDateTime,
) -> Result<(KeyFile, RecoveryCode, PathBuf), String> {
    let old_key_path = keyfile::key_file_path_for(live_db_path);
    let old_key_file = KeyFile::read(&old_key_path).map_err(|e| e.to_string())?;
    match &proof {
        Proof::Password(password) => old_key_file.unlock_with_password(password),
        Proof::Recovery(code) => old_key_file.unlock_with_recovery(code),
    }
    .map_err(|_| proof_error(&proof))?;

    let protection = keyfile::create_protection_with_recovery(new_password, recovery_code, &KdfParams::PRODUCTION, &now.and_utc().to_rfc3339())
        .map_err(|e| e.to_string())?;
    let target_db_path = unique_protected_path(live_db_path);
    let target_key_path = keyfile::key_file_path_for(&target_db_path);
    let protected_backups_dir = backups::backups_dir_for(live_db_path, true);
    let staging_dir = staging_dir_for(&protected_backups_dir);
    let mut journal = RotationJournal {
        format: 1,
        profile_id: profile_id.to_string(),
        old_db_path: live_db_path.display().to_string(),
        old_key_path: old_key_path.display().to_string(),
        target_db_path: target_db_path.display().to_string(),
        target_key_path: target_key_path.display().to_string(),
        staged_backup_filenames: Vec::new(),
    };

    crate::protection_transition::debug_failpoint("rotation_before_journal");
    write_rotation_journal(config_path, &journal)?;
    store
        .export_encrypted_copy(&target_db_path, protection.dek.as_bytes())
        .map_err(|e| e.to_string())?;
    store
        .verify_copy(&target_db_path, DatabaseKey::Raw(protection.dek.as_bytes()))
        .map_err(|e| e.to_string())?;
    protection.key_file.write_to(&target_key_path).map_err(|e| e.to_string())?;
    crate::protection_transition::debug_failpoint("rotation_after_export");

    if protected_backups_dir.exists() {
        std::fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;
        let old_dek = store
            .db_key_bytes()
            .ok_or_else(|| "This profile is not password protected.".to_string())?;
        for info in backups::list_backups(&protected_backups_dir, true)? {
            let source_backup = protected_backups_dir.join(&info.filename);
            let staged_backup = staging_dir.join(&info.filename);
            let historical = Store::open_with_key(&source_backup, DatabaseKey::Raw(old_dek))
                .map_err(|e| format!("{}: couldn't open this backup: {e}", info.filename))?;
            historical
                .export_encrypted_copy(&staged_backup, protection.dek.as_bytes())
                .map_err(|e| format!("{}: {e}", info.filename))?;
            historical
                .verify_copy(&staged_backup, DatabaseKey::Raw(protection.dek.as_bytes()))
                .map_err(|e| format!("{}: {e}", info.filename))?;
            protection
                .key_file
                .write_to(&keyfile::key_file_path_for(&staged_backup))
                .map_err(|e| e.to_string())?;
            journal.staged_backup_filenames.push(info.filename);
            write_rotation_journal(config_path, &journal)?;
        }
    }
    crate::protection_transition::debug_failpoint("rotation_after_staging");

    profiles::update_active_db_path(config_path, live_db_path, &target_db_path)?;
    crate::protection_transition::debug_failpoint("rotation_after_registry_write");
    finish_rotation(config_path, &journal)?;
    Ok((protection.key_file, protection.recovery_code, target_db_path))
}

/// Finishes retirement after the caller has hot-swapped away from the old live SQLite connection.
pub fn complete_committed_rotation(config_path: &Path) -> Result<(), String> {
    let journal_path = rotation_journal_path_for(config_path);
    let text = std::fs::read_to_string(&journal_path).map_err(|e| e.to_string())?;
    let journal: RotationJournal = serde_json::from_str(&text).map_err(|e| format!("the rotation journal is damaged: {e}"))?;
    retire_committed_rotation(config_path, &journal)
}

pub fn recover_interrupted_rotation(config_path: &Path) -> Result<(), String> {
    let journal_path = rotation_journal_path_for(config_path);
    let text = match std::fs::read_to_string(&journal_path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    let journal: RotationJournal = serde_json::from_str(&text).map_err(|e| format!("the rotation journal is damaged: {e}"))?;
    let committed = profiles::registered_profiles_strict(config_path)
        .map_err(|problem| problem.reason)?
        .into_iter()
        .any(|profile| profile.id == journal.profile_id && profile.db_path == Path::new(&journal.target_db_path));
    if committed {
        return retire_committed_rotation(config_path, &journal);
    } else {
        let _ = std::fs::remove_file(&journal.target_db_path);
        let _ = std::fs::remove_file(&journal.target_key_path);
        let protected_backups_dir = backups::backups_dir_for(Path::new(&journal.old_db_path), true);
        let _ = std::fs::remove_dir_all(staging_dir_for(&protected_backups_dir));
    }
    std::fs::remove_file(journal_path).map_err(|e| e.to_string())
}

fn retire_committed_removal(config_path: &Path, journal: &RemovalJournal) -> Result<(), String> {
    let _ = std::fs::remove_file(&journal.old_db_path);
    let _ = std::fs::remove_file(&journal.old_key_path);
    config::write_db_location_config(config_path, Path::new(&journal.target_db_path)).map_err(|e| e.to_string())?;
    std::fs::remove_file(removal_journal_path_for(config_path)).map_err(|e| e.to_string())
}

pub fn complete_committed_removal(config_path: &Path) -> Result<(), String> {
    let text = std::fs::read_to_string(removal_journal_path_for(config_path)).map_err(|e| e.to_string())?;
    let journal: RemovalJournal = serde_json::from_str(&text).map_err(|e| format!("the removal journal is damaged: {e}"))?;
    retire_committed_removal(config_path, &journal)
}

pub fn recover_interrupted_removal(config_path: &Path) -> Result<(), String> {
    let journal_path = removal_journal_path_for(config_path);
    let text = match std::fs::read_to_string(&journal_path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let journal: RemovalJournal = serde_json::from_str(&text).map_err(|e| format!("the removal journal is damaged: {e}"))?;
    let committed = profiles::registered_profiles_strict(config_path)
        .map_err(|problem| problem.reason)?
        .into_iter()
        .any(|profile| profile.id == journal.profile_id && profile.db_path == Path::new(&journal.target_db_path));
    if committed {
        retire_committed_removal(config_path, &journal)
    } else {
        let _ = std::fs::remove_file(&journal.target_db_path);
        std::fs::remove_file(journal_path).map_err(|e| e.to_string())
    }
}

pub fn remove_protection(
    config_path: &Path,
    profile_id: &str,
    live_db_path: &Path,
    store: &Store,
    current_password: &str,
    now: NaiveDateTime,
) -> Result<PathBuf, String> {
    let old_key_path = keyfile::key_file_path_for(live_db_path);
    KeyFile::read(&old_key_path)
        .map_err(|e| e.to_string())?
        .unlock_with_password(current_password)
        .map_err(|_| "That password didn't work.".to_string())?;
    let protected_backups_dir = backups::backups_dir_for(live_db_path, true);
    backups::create_backup(store, live_db_path, &protected_backups_dir, None, now)?;
    let target_db_path = unique_plaintext_path(live_db_path);
    let journal = RemovalJournal {
        format: 1,
        profile_id: profile_id.to_string(),
        old_db_path: live_db_path.display().to_string(),
        old_key_path: old_key_path.display().to_string(),
        target_db_path: target_db_path.display().to_string(),
    };
    write_removal_journal(config_path, &journal)?;
    store.export_plaintext_copy(&target_db_path).map_err(|e| e.to_string())?;
    store.verify_copy(&target_db_path, DatabaseKey::Plaintext)?;
    crate::protection_transition::debug_failpoint("removal_after_export");
    profiles::commit_protection_removal(config_path, live_db_path, profile_id, &target_db_path)?;
    config::write_db_location_config(config_path, &target_db_path).map_err(|e| e.to_string())?;
    crate::protection_transition::debug_failpoint("removal_after_registry_write");
    Ok(target_db_path)
}

#[allow(dead_code)] // exercised directly by this file's own unit tests; the command layer uses rotate_password_with_recovery
pub fn rotate_password(
    config_path: &Path,
    profile_id: &str,
    live_db_path: &Path,
    store: &Store,
    current_password: &str,
    new_password: &str,
    now: NaiveDateTime,
) -> Result<(KeyFile, RecoveryCode, PathBuf), String> {
    rotate_dek(
        config_path,
        profile_id,
        live_db_path,
        store,
        Proof::Password(current_password),
        new_password,
        RecoveryCode::generate(),
        now,
    )
}

/// Recovers access to a locked, protected profile with its recovery code, then immediately sets a
/// new password through the same rotation `rotate_password` uses — the recovery code itself is
/// then retired (a fresh one is issued), exactly like a normal password change. Plan v2 §4.8.
#[allow(dead_code)] // exercised directly by this file's own unit tests; the command layer uses recover_password_with_recovery
pub fn recover_password(
    config_path: &Path,
    profile_id: &str,
    live_db_path: &Path,
    store: &Store,
    recovery_code: &RecoveryCode,
    new_password: &str,
    now: NaiveDateTime,
) -> Result<(KeyFile, RecoveryCode, PathBuf), String> {
    rotate_dek(config_path, profile_id, live_db_path, store, Proof::Recovery(recovery_code), new_password, RecoveryCode::generate(), now)
}

/// `recover_password`'s code-identity-safe sibling: the caller supplies the exact new recovery code
/// its own save-confirmation challenge displayed, so the code shown to the person and the code
/// actually committed can never diverge — the same fix `rotate_password_with_recovery` applies for
/// change password.
#[allow(clippy::too_many_arguments)]
pub fn recover_password_with_recovery(
    config_path: &Path,
    profile_id: &str,
    live_db_path: &Path,
    store: &Store,
    recovery_code: &RecoveryCode,
    new_password: &str,
    new_recovery_code: RecoveryCode,
    now: NaiveDateTime,
) -> Result<(KeyFile, RecoveryCode, PathBuf), String> {
    rotate_dek(config_path, profile_id, live_db_path, store, Proof::Recovery(recovery_code), new_password, new_recovery_code, now)
}

#[allow(clippy::too_many_arguments)]
pub fn rotate_password_with_recovery(
    config_path: &Path,
    profile_id: &str,
    live_db_path: &Path,
    store: &Store,
    current_password: &str,
    new_password: &str,
    recovery_code: RecoveryCode,
    now: NaiveDateTime,
) -> Result<(KeyFile, RecoveryCode, PathBuf), String> {
    rotate_dek(
        config_path,
        profile_id,
        live_db_path,
        store,
        Proof::Password(current_password),
        new_password,
        recovery_code,
        now,
    )
}

/// Replaces only the recovery slot in the live key file. The current password proves authority and
/// unwraps the existing DEK; the database, password slot, and backups are not changed. The caller
/// supplies the code that its save-confirmation challenge displayed, so UI and disk cannot diverge.
pub fn regenerate_recovery_with_code(live_db_path: &Path, current_password: &str, recovery_code: RecoveryCode) -> Result<KeyFile, String> {
    let key_path = keyfile::key_file_path_for(live_db_path);
    let key_file = KeyFile::read(&key_path).map_err(|e| e.to_string())?;
    let dek = key_file
        .unlock_with_password(current_password)
        .map_err(|_| "That password didn't work.".to_string())?;
    let renewed = key_file
        .regenerate_recovery_with_code(&dek, &recovery_code, &KdfParams::PRODUCTION)
        .map_err(|e| e.to_string())?;
    renewed.write_to(&key_path).map_err(|e| e.to_string())?;
    Ok(renewed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use budget_core::models::{AccountType, Transaction};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-lifecycle-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn now() -> NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(2026, 9, 24).unwrap().and_hms_opt(9, 0, 0).unwrap()
    }

    fn protected_profile(dir: &Path) -> (String, PathBuf, Store) {
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("v.db");
        let (id, key_file, _, target) =
            crate::protection_transition::create_protected_profile(&config_path, &live_db_path, "Sam", "old password 123", now()).unwrap();
        let dek = key_file.unlock_with_password("old password 123").unwrap();
        let store = Store::open_with_key(&target, DatabaseKey::Raw(dek.as_bytes())).unwrap();
        let account = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store
            .save_transactions(
                account,
                &[Transaction {
                    date: chrono::NaiveDate::from_ymd_opt(2026, 9, 20).unwrap(),
                    description: "Market Basket".to_string(),
                    amount: "-42.17".parse().unwrap(),
                    category: None,
                }],
            )
            .unwrap();
        let backups_dir = backups::backups_dir_for(&target, true);
        backups::create_backup(&store, &target, &backups_dir, None, now() - chrono::Duration::days(1)).unwrap();
        (id, target, store)
    }

    #[test]
    fn changing_the_password_rotates_the_database_backup_and_recovery_code() {
        let dir = temp_dir("happy-path");
        let config_path = dir.join("config.json");
        let (id, live_db_path, store) = protected_profile(&dir);
        let backups_dir = backups::backups_dir_for(&live_db_path, true);
        let backup_filename = backups::list_backups(&backups_dir, true).unwrap()[0].filename.clone();

        let (new_key_file, new_recovery_code, target_path) = rotate_password(
            &config_path,
            &id,
            &live_db_path,
            &store,
            "old password 123",
            "brand new password!!",
            now(),
        )
        .unwrap();

        let new_dek = new_key_file.unlock_with_password("brand new password!!").unwrap();
        assert!(new_key_file.unlock_with_password("old password 123").is_err());
        let opened = Store::open_with_key(&target_path, DatabaseKey::Raw(new_dek.as_bytes())).unwrap();
        assert!(opened
            .all_transactions()
            .unwrap()
            .iter()
            .any(|t| t.transaction.description == "Market Basket"));
        assert_eq!(
            new_key_file.unlock_with_recovery(&new_recovery_code).unwrap().as_bytes(),
            new_dek.as_bytes()
        );
        let backup_key = KeyFile::read(&keyfile::key_file_path_for(&backups_dir.join(backup_filename))).unwrap();
        assert_eq!(
            backup_key.unlock_with_password("brand new password!!").unwrap().as_bytes(),
            new_dek.as_bytes()
        );
        drop(opened);
        drop(store);
        complete_committed_rotation(&config_path).unwrap();
        assert!(!live_db_path.exists());
        assert!(!keyfile::key_file_path_for(&live_db_path).exists());
    }

    #[test]
    fn a_wrong_current_password_changes_nothing() {
        let dir = temp_dir("wrong-password");
        let config_path = dir.join("config.json");
        let (id, live_db_path, store) = protected_profile(&dir);
        let error = rotate_password(&config_path, &id, &live_db_path, &store, "wrong", "new password!!!!", now())
            .map(|_| ())
            .unwrap_err();
        assert_eq!(error, "That password didn't work.");
        assert!(live_db_path.exists());
        assert!(!rotation_journal_path_for(&config_path).exists());
    }

    #[test]
    fn regenerating_the_recovery_key_uses_the_confirmed_code_and_leaves_the_database_untouched() {
        let dir = temp_dir("regenerate");
        let (_, live_db_path, store) = protected_profile(&dir);
        let before = KeyFile::read(&keyfile::key_file_path_for(&live_db_path)).unwrap();
        let old_dek = before.unlock_with_password("old password 123").unwrap();
        let confirmed_code = RecoveryCode::generate();
        let confirmed_display = confirmed_code.display();

        let renewed = regenerate_recovery_with_code(&live_db_path, "old password 123", confirmed_code).unwrap();
        let confirmed_code = RecoveryCode::parse(&confirmed_display).unwrap();

        assert!(renewed.unlock_with_password("old password 123").is_ok(), "the password is unchanged");
        assert_eq!(renewed.unlock_with_recovery(&confirmed_code).unwrap().as_bytes(), old_dek.as_bytes());
        assert_ne!(renewed, before, "the recovery slot changes");
        assert!(store.list_categories().is_ok(), "the database itself was never touched");
        assert_eq!(KeyFile::read(&keyfile::key_file_path_for(&live_db_path)).unwrap(), renewed);
    }

    #[test]
    fn a_wrong_password_refuses_to_regenerate_recovery() {
        let dir = temp_dir("regenerate-wrong-password");
        let (_, live_db_path, _store) = protected_profile(&dir);
        let before = KeyFile::read(&keyfile::key_file_path_for(&live_db_path)).unwrap();

        let error = regenerate_recovery_with_code(&live_db_path, "not it", RecoveryCode::generate())
            .map(|_| ())
            .unwrap_err();

        assert_eq!(error, "That password didn't work.");
        assert_eq!(KeyFile::read(&keyfile::key_file_path_for(&live_db_path)).unwrap(), before);
    }

    #[test]
    fn removing_protection_exports_plaintext_and_keeps_one_last_encrypted_backup() {
        let dir = temp_dir("remove-happy-path");
        let config_path = dir.join("config.json");
        let (id, live_db_path, store) = protected_profile(&dir);
        let backups_dir = backups::backups_dir_for(&live_db_path, true);
        let backups_before = backups::list_backups(&backups_dir, true).unwrap().len();

        let target_path = remove_protection(&config_path, &id, &live_db_path, &store, "old password 123", now()).unwrap();

        let opened = Store::open(&target_path).unwrap();
        assert!(!opened.is_encrypted());
        assert!(opened
            .all_transactions()
            .unwrap()
            .iter()
            .any(|row| row.transaction.description == "Market Basket"));
        assert_eq!(backups::list_backups(&backups_dir, true).unwrap().len(), backups_before + 1);
        let entry = profiles::list_profiles(&config_path, &target_path)
            .into_iter()
            .find(|profile| profile.id == id)
            .unwrap();
        assert_eq!(entry.protection, None);
        drop(opened);
        drop(store);
        complete_committed_removal(&config_path).unwrap();
        assert!(!live_db_path.exists());
        assert!(!keyfile::key_file_path_for(&live_db_path).exists());
    }

    #[test]
    fn a_wrong_password_removes_nothing() {
        let dir = temp_dir("remove-wrong-password");
        let config_path = dir.join("config.json");
        let (id, live_db_path, store) = protected_profile(&dir);

        let error = remove_protection(&config_path, &id, &live_db_path, &store, "not it", now())
            .map(|_| ())
            .unwrap_err();

        assert_eq!(error, "That password didn't work.");
        assert!(live_db_path.exists());
        assert!(!removal_journal_path_for(&config_path).exists());
    }

    #[test]
    fn pre_commit_removal_recovery_discards_the_plaintext_export() {
        let dir = temp_dir("remove-recover-precommit");
        let config_path = dir.join("config.json");
        let (id, live_db_path, store) = protected_profile(&dir);
        let target = unique_plaintext_path(&live_db_path);
        store.export_plaintext_copy(&target).unwrap();
        write_removal_journal(
            &config_path,
            &RemovalJournal {
                format: 1,
                profile_id: id,
                old_db_path: live_db_path.display().to_string(),
                old_key_path: keyfile::key_file_path_for(&live_db_path).display().to_string(),
                target_db_path: target.display().to_string(),
            },
        )
        .unwrap();

        recover_interrupted_removal(&config_path).unwrap();

        assert!(!target.exists());
        assert!(live_db_path.exists());
        assert!(!removal_journal_path_for(&config_path).exists());
    }

    #[test]
    fn post_commit_removal_recovery_retires_the_encrypted_pair() {
        let dir = temp_dir("remove-recover-postcommit");
        let config_path = dir.join("config.json");
        let (id, live_db_path, store) = protected_profile(&dir);
        let target = remove_protection(&config_path, &id, &live_db_path, &store, "old password 123", now()).unwrap();
        drop(store);

        recover_interrupted_removal(&config_path).unwrap();

        assert!(target.exists());
        assert!(!live_db_path.exists());
        assert!(!keyfile::key_file_path_for(&live_db_path).exists());
        assert!(!removal_journal_path_for(&config_path).exists());
    }

    #[test]
    fn recovering_with_the_right_code_sets_a_new_password_and_issues_a_new_code() {
        let dir = temp_dir("recover-happy-path");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("v.db");
        let (id, key_file, recovery_code, target) =
            crate::protection_transition::create_protected_profile(&config_path, &live_db_path, "Sam", "old password 123", now()).unwrap();
        let old_dek = key_file.unlock_with_password("old password 123").unwrap();
        let store = Store::open_with_key(&target, DatabaseKey::Raw(old_dek.as_bytes())).unwrap();

        let (new_key_file, new_recovery_code, target_path) =
            recover_password(&config_path, &id, &target, &store, &recovery_code, "recovered new password", now()).unwrap();

        assert!(new_key_file.unlock_with_password("recovered new password").is_ok());
        assert!(new_key_file.unlock_with_password("old password 123").is_err());
        assert!(
            new_key_file.unlock_with_recovery(&recovery_code).is_err(),
            "the code just used to recover must stop working too"
        );
        assert!(new_key_file.unlock_with_recovery(&new_recovery_code).is_ok());
        assert_eq!(profiles::list_profiles(&config_path, &live_db_path).iter().find(|p| p.id == id).unwrap().db_path, target_path);
    }

    #[test]
    fn a_wrong_recovery_code_recovers_nothing() {
        let dir = temp_dir("recover-wrong-code");
        let config_path = dir.join("config.json");
        let live_db_path = dir.join("v.db");
        let (id, key_file, _real_code, target) =
            crate::protection_transition::create_protected_profile(&config_path, &live_db_path, "Sam", "old password 123", now()).unwrap();
        let dek = key_file.unlock_with_password("old password 123").unwrap();
        let store = Store::open_with_key(&target, DatabaseKey::Raw(dek.as_bytes())).unwrap();

        let error = recover_password(&config_path, &id, &target, &store, &RecoveryCode::generate(), "irrelevant new password", now())
            .map(|_| ())
            .unwrap_err();

        assert_eq!(error, "That recovery key didn't work.");
        assert!(target.exists(), "nothing was touched");
        assert!(!rotation_journal_path_for(&config_path).exists());
    }

    #[test]
    fn pre_commit_recovery_discards_staged_rotation() {
        let dir = temp_dir("recover-before-commit");
        let config_path = dir.join("config.json");
        let (id, live_db_path, store) = protected_profile(&dir);
        let target_db_path = unique_protected_path(&live_db_path);
        let protection = keyfile::create_protection("new password!!!!", &KdfParams::FAST_FOR_TESTS, "2026-09-24T09:00:00Z").unwrap();
        store.export_encrypted_copy(&target_db_path, protection.dek.as_bytes()).unwrap();
        protection.key_file.write_to(&keyfile::key_file_path_for(&target_db_path)).unwrap();
        write_rotation_journal(
            &config_path,
            &RotationJournal {
                format: 1,
                profile_id: id,
                old_db_path: live_db_path.display().to_string(),
                old_key_path: keyfile::key_file_path_for(&live_db_path).display().to_string(),
                target_db_path: target_db_path.display().to_string(),
                target_key_path: keyfile::key_file_path_for(&target_db_path).display().to_string(),
                staged_backup_filenames: Vec::new(),
            },
        )
        .unwrap();

        recover_interrupted_rotation(&config_path).unwrap();
        assert!(!target_db_path.exists());
        assert!(live_db_path.exists());
        assert!(!rotation_journal_path_for(&config_path).exists());
    }

    #[test]
    fn post_commit_recovery_finishes_an_individually_interrupted_backup_pair() {
        let dir = temp_dir("recover-pair");
        let config_path = dir.join("config.json");
        let (id, live_db_path, store) = protected_profile(&dir);
        let (_, _, target_path) = rotate_password(&config_path, &id, &live_db_path, &store, "old password 123", "new password!!!!", now()).unwrap();
        let backups_dir = backups::backups_dir_for(&target_path, true);
        let filename = backups::list_backups(&backups_dir, true).unwrap()[0].filename.clone();
        let staging = staging_dir_for(&backups_dir);
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::rename(
            keyfile::key_file_path_for(&backups_dir.join(&filename)),
            keyfile::key_file_path_for(&staging.join(&filename)),
        )
        .unwrap();
        let journal = RotationJournal {
            format: 1,
            profile_id: id,
            old_db_path: live_db_path.display().to_string(),
            old_key_path: keyfile::key_file_path_for(&live_db_path).display().to_string(),
            target_db_path: target_path.display().to_string(),
            target_key_path: keyfile::key_file_path_for(&target_path).display().to_string(),
            staged_backup_filenames: vec![filename.clone()],
        };
        write_rotation_journal(&config_path, &journal).unwrap();
        drop(store);

        recover_interrupted_rotation(&config_path).unwrap();
        assert!(keyfile::key_file_path_for(&backups_dir.join(filename)).exists());
        assert!(!rotation_journal_path_for(&config_path).exists());
    }
}
