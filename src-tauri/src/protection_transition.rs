//! Turning password protection on for an already-in-use profile: a journaled transaction so a
//! kill at any point either finishes or fully unwinds, never leaving a half-protected profile.
//! Design: plan v2 §4.6 and the Phase C plan's Task 5 header.
use crate::{backups, config, profiles};
use budget_core::fsutil::write_atomic;
use budget_core::protection::kdf::KdfParams;
use budget_core::protection::keyfile::{self, KeyFile};
use budget_core::protection::recovery::RecoveryCode;
use budget_core::store::DatabaseKey;
use budget_core::store::Store;
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const JOURNAL_FILENAME: &str = "protection-journal.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProtectionJournal {
    format: u32,
    profile_id: String,
    target_db_path: String,
    target_key_path: String,
    owned_backup_pairs: Vec<String>,
}

fn journal_path_for(config_path: &Path) -> PathBuf {
    config_path.parent().unwrap_or_else(|| Path::new(".")).join(JOURNAL_FILENAME)
}

fn write_journal(config_path: &Path, journal: &ProtectionJournal) -> Result<(), String> {
    let json = serde_json::to_string_pretty(journal).expect("ProtectionJournal always serializes");
    write_atomic(&journal_path_for(config_path), json.as_bytes()).map_err(|e| e.to_string())
}

/// A `vaultspend-protected.db` path beside `source`, disambiguated on collision — the new file this
/// operation writes, never overwriting or reusing an existing name.
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

/// Writes a `failpoint-reached.txt` marker into `VAULTSPEND_DB_DIR` and then blocks forever when
/// `VAULTSPEND_FAILPOINT` names it — Task 9's e2e driver polls for that file and hard-kills the
/// process at that exact instant. A marker file, not a stderr line: `tauri-driver` launches the app
/// as its own child without forwarding the app's stdio anywhere a test can read it, confirmed
/// empirically while building Task 9, so a file that survives independently of any process's stdio
/// plumbing is the only reliable signal. Gated behind `VAULTSPEND_DB_DIR` (only ever set by e2e
/// tests, never a normal launch) on top of the existing `#[cfg(debug_assertions)]` gate, so a stray
/// `VAULTSPEND_FAILPOINT` left set in a dev shell can never freeze an ordinary `tauri dev` session.
/// Compiled out entirely in release builds, so it can never fire for a real user.
#[cfg(debug_assertions)]
pub fn debug_failpoint(name: &str) {
    let Ok(marker_dir) = std::env::var("VAULTSPEND_DB_DIR") else { return };
    if std::env::var("VAULTSPEND_FAILPOINT").as_deref() != Ok(name) {
        return;
    }
    let _ = std::fs::write(Path::new(&marker_dir).join("failpoint-reached.txt"), name);
    loop {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}
#[cfg(not(debug_assertions))]
pub fn debug_failpoint(_name: &str) {}

/// Encrypts `store` (the profile's currently-open, plaintext database) under a brand-new password,
/// converting every historical backup alongside it. `store` and `source_db_path` name the same
/// live file. Returns the new key file, the one-time recovery code, and the new database path —
/// the caller (Task 8's UI, and Task 9's tests) is responsible for showing the recovery code and
/// telling the frontend to reopen at the returned path.
#[allow(dead_code)] // convenience entry point used by transition tests; commands supply a confirmed recovery code
pub fn enable_protection(
    config_path: &Path,
    profile_id: &str,
    source_db_path: &Path,
    store: &Store,
    password: &str,
    now: NaiveDateTime,
) -> Result<(KeyFile, RecoveryCode, PathBuf), String> {
    enable_protection_with_recovery(config_path, profile_id, source_db_path, store, password, RecoveryCode::generate(), now)
}

pub fn enable_protection_with_recovery(
    config_path: &Path,
    profile_id: &str,
    source_db_path: &Path,
    store: &Store,
    password: &str,
    recovery_code: RecoveryCode,
    now: NaiveDateTime,
) -> Result<(KeyFile, RecoveryCode, PathBuf), String> {
    if store.is_encrypted() {
        return Err("This profile is already password protected.".to_string());
    }
    // A journal left by an earlier failed attempt in this same session (or process) must be
    // unwound before starting a new one — otherwise this attempt's own converted backups can
    // collide with orphans the earlier attempt never got to clean up (`export_encrypted_copy`
    // refuses to overwrite an existing file).
    recover_interrupted_operation(config_path)?;

    let created_at = now.and_utc().to_rfc3339();
    let protection =
        keyfile::create_protection_with_recovery(password, recovery_code, &KdfParams::PRODUCTION, &created_at).map_err(|e| e.to_string())?;
    let target_db_path = unique_protected_path(source_db_path);
    let target_key_path = keyfile::key_file_path_for(&target_db_path);

    let mut journal = ProtectionJournal {
        format: 1,
        profile_id: profile_id.to_string(),
        target_db_path: target_db_path.display().to_string(),
        target_key_path: target_key_path.display().to_string(),
        owned_backup_pairs: Vec::new(),
    };
    debug_failpoint("before_journal");
    write_journal(config_path, &journal)?;

    let pre_commit_result = (|| -> Result<(), String> {
        store
            .export_encrypted_copy(&target_db_path, protection.dek.as_bytes())
            .map_err(|e| e.to_string())?;
        store
            .verify_copy(&target_db_path, DatabaseKey::Raw(protection.dek.as_bytes()))
            .map_err(|e| e.to_string())?;
        protection.key_file.write_to(&target_key_path).map_err(|e| e.to_string())?;
        debug_failpoint("after_export");

        let plaintext_backups_dir = backups::backups_dir_for(source_db_path, false);
        let protected_backups_dir = backups::backups_dir_for(source_db_path, true);
        std::fs::create_dir_all(&protected_backups_dir).map_err(|e| e.to_string())?;
        for info in backups::list_backups(&plaintext_backups_dir, false)? {
            let filename = info.filename;
            let source_backup = plaintext_backups_dir.join(&filename);
            let converted_backup = protected_backups_dir.join(&filename);
            let historical = Store::open(&source_backup).map_err(|e| format!("{filename}: couldn't open this historical backup: {e}"))?;
            historical
                .export_encrypted_copy(&converted_backup, protection.dek.as_bytes())
                .map_err(|e| format!("{filename}: {e}"))?;
            historical
                .verify_copy(&converted_backup, DatabaseKey::Raw(protection.dek.as_bytes()))
                .map_err(|e| format!("{filename}: {e}"))?;
            protection
                .key_file
                .write_to(&keyfile::key_file_path_for(&converted_backup))
                .map_err(|e| e.to_string())?;
            journal.owned_backup_pairs.push(converted_backup.display().to_string());
            write_journal(config_path, &journal)?;
        }
        debug_failpoint("after_backups");
        Ok(())
    })();
    if let Err(error) = pre_commit_result {
        // Nothing has been committed yet — unwind right now, exactly as startup recovery would,
        // instead of leaving orphaned files for a same-session retry to collide with.
        let _ = recover_interrupted_operation(config_path);
        return Err(error);
    }

    // A single atomic write moves the registry's db_path to the new file AND records protection
    // together — see `profiles::commit_protection_conversion`'s own doc comment for why splitting
    // this into two separate writes (as a plain `set_profile_protection` call alone would) is unsafe.
    profiles::commit_protection_conversion(
        config_path,
        source_db_path,
        profile_id,
        &target_db_path,
        profiles::Protection::new(keyfile::FORMAT),
    )?;
    debug_failpoint("after_registry_write");
    config::write_db_location_config(config_path, &target_db_path).map_err(|e| e.to_string())?;
    debug_failpoint("after_config_write");

    std::fs::remove_file(journal_path_for(config_path)).map_err(|e| e.to_string())?;
    Ok((protection.key_file, protection.recovery_code, target_db_path))
}

/// Creates a brand-new, already-protected profile: an in-memory (never touches disk unencrypted,
/// not even momentarily) empty database exported straight to an encrypted file, verified, then
/// registered — in that order, so a kill at any point before registration just leaves an orphaned,
/// never-registered file on disk, exactly what "failed/cancelled creation leaves the prior session
/// and registry intact" requires. No journal: unlike `enable_protection`, there is nothing to
/// unwind that isn't already unwound by simply never having registered anything.
#[allow(dead_code)] // convenience entry point used by transition tests; commands supply a confirmed recovery code
pub fn create_protected_profile(
    config_path: &Path,
    live_db_path: &Path,
    name: &str,
    password: &str,
    now: NaiveDateTime,
) -> Result<(String, KeyFile, RecoveryCode, PathBuf), String> {
    create_protected_profile_with_recovery(config_path, live_db_path, name, password, RecoveryCode::generate(), now)
}

pub fn create_protected_profile_with_recovery(
    config_path: &Path,
    live_db_path: &Path,
    name: &str,
    password: &str,
    recovery_code: RecoveryCode,
    now: NaiveDateTime,
) -> Result<(String, KeyFile, RecoveryCode, PathBuf), String> {
    let (id, target_db_path) = profiles::plan_new_profile(config_path, live_db_path, name, now)?;
    std::fs::create_dir_all(target_db_path.parent().ok_or_else(|| "invalid profile path".to_string())?).map_err(|e| e.to_string())?;

    let empty = Store::open_in_memory().map_err(|e| e.to_string())?;
    let protection = keyfile::create_protection_with_recovery(password, recovery_code, &KdfParams::PRODUCTION, &now.and_utc().to_rfc3339())
        .map_err(|e| e.to_string())?;
    empty
        .export_encrypted_copy(&target_db_path, protection.dek.as_bytes())
        .map_err(|e| e.to_string())?;
    empty
        .verify_copy(&target_db_path, DatabaseKey::Raw(protection.dek.as_bytes()))
        .map_err(|e| e.to_string())?;
    protection
        .key_file
        .write_to(&keyfile::key_file_path_for(&target_db_path))
        .map_err(|e| e.to_string())?;
    debug_failpoint("before_register");
    profiles::register_prepared_profile(
        config_path,
        live_db_path,
        &id,
        name,
        &target_db_path,
        Some(profiles::Protection::new(keyfile::FORMAT)),
    )?;
    Ok((id, protection.key_file, protection.recovery_code, target_db_path))
}

/// Resolves an interrupted `enable_protection` (or, from Task 6, a protected creation) found at
/// startup, before anything else opens. The registry is the only source of truth for whether the
/// commit happened — see this task's header comment for why that collapses every kill point to one
/// rule instead of four stage-specific branches.
pub fn recover_interrupted_operation(config_path: &Path) -> Result<(), String> {
    let journal_path = journal_path_for(config_path);
    let text = match std::fs::read_to_string(&journal_path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    let journal: ProtectionJournal = serde_json::from_str(&text).map_err(|e| format!("the protection journal is damaged: {e}"))?;
    let committed = profiles::registered_profiles_strict(config_path)
        .map_err(|p| p.reason)?
        .into_iter()
        .any(|p| p.id == journal.profile_id && p.protection.is_some());
    if !committed {
        let _ = std::fs::remove_file(&journal.target_db_path);
        let _ = std::fs::remove_file(&journal.target_key_path);
        debug_failpoint("during_recovery");
        for filename in &journal.owned_backup_pairs {
            let _ = std::fs::remove_file(filename);
            let _ = std::fs::remove_file(keyfile::key_file_path_for(Path::new(filename)));
        }
    }
    std::fs::remove_file(&journal_path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use budget_core::models::{AccountType, Transaction};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-transition-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn now() -> NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(2026, 9, 21).unwrap().and_hms_opt(9, 0, 0).unwrap()
    }

    fn tx(date: &str, description: &str, amount: &str) -> Transaction {
        Transaction {
            date: chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
            description: description.to_string(),
            amount: amount.parse().unwrap(),
            category: None,
        }
    }

    /// A profile with real content across every kind of table the acceptance checklist names: an
    /// account, a transaction, a category, a saved filter (via Task 3's `profile_ui_state`) and two
    /// historical backups. `verify_copy`'s table/row-count check alone would pass on an
    /// accidentally-truncated table pair if both sides lost the same row — this fixture makes each
    /// value distinct enough that a values test actually proves equality, not just count.
    fn populated_profile(dir: &Path) -> (Store, PathBuf) {
        let db_path = dir.join("vaultspend.db");
        let store = Store::open(&db_path).unwrap();
        let account = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.create_category("Groceries", None).unwrap();
        store.save_transactions(account, &[tx("2026-09-10", "Market Basket", "-42.17")]).unwrap();
        store
            .set_ui_state(budget_core::store::UiStateKey::SavedFilters, "[{\"name\":\"Groceries only\"}]")
            .unwrap();
        let backups_dir = backups::backups_dir_for(&db_path, false);
        backups::create_backup(&store, &db_path, &backups_dir, None, now() - chrono::Duration::days(2)).unwrap();
        backups::create_backup(&store, &db_path, &backups_dir, None, now() - chrono::Duration::days(1)).unwrap();
        (store, db_path)
    }

    fn register(config_path: &Path, live_db_path: &Path) -> String {
        profiles::create_profile(config_path, live_db_path, "Alex", now()).unwrap();
        profiles::list_profiles(config_path, live_db_path)[1].id.clone()
    }

    #[test]
    fn enabling_protection_produces_a_verified_encrypted_copy_and_registers_it() {
        let dir = temp_dir("happy-path");
        let (store, db_path) = populated_profile(&dir);
        let config_path = dir.join("config.json");
        let profile_id = register(&config_path, &db_path);

        let (key_file, recovery_code, target_path) =
            enable_protection(&config_path, &profile_id, &db_path, &store, "correct horse battery staple", now()).unwrap();

        assert_eq!(target_path, dir.join("vaultspend-protected.db"));
        assert!(!dir.join("protection-journal.json").exists(), "the journal is retired on success");
        let opened = Store::open_with_key(
            &target_path,
            DatabaseKey::Raw(key_file.unlock_with_password("correct horse battery staple").unwrap().as_bytes()),
        )
        .unwrap();
        assert!(opened
            .all_transactions()
            .unwrap()
            .iter()
            .any(|t| t.transaction.description == "Market Basket" && t.transaction.amount == "-42.17".parse().unwrap()));
        assert_eq!(
            opened.get_ui_state(budget_core::store::UiStateKey::SavedFilters).unwrap(),
            Some("[{\"name\":\"Groceries only\"}]".to_string())
        );
        let recovered_dek = key_file.unlock_with_recovery(&recovery_code).unwrap();
        assert_eq!(
            recovered_dek.as_bytes(),
            key_file.unlock_with_password("correct horse battery staple").unwrap().as_bytes()
        );
        let registered = profiles::list_profiles(&config_path, &target_path);
        let entry = registered.iter().find(|p| p.id == profile_id).unwrap();
        assert_eq!(entry.protection, Some(profiles::Protection::new(keyfile::FORMAT)));
        assert_eq!(entry.db_path, target_path, "the registry must follow the profile to its new file");
    }

    #[test]
    fn every_historical_backup_is_converted_and_the_originals_are_untouched() {
        let dir = temp_dir("backups-converted");
        let (store, db_path) = populated_profile(&dir);
        let config_path = dir.join("config.json");
        let profile_id = register(&config_path, &db_path);
        let plaintext_backups_dir = backups::backups_dir_for(&db_path, false);
        let originals: Vec<String> = backups::list_backups(&plaintext_backups_dir, false)
            .unwrap()
            .into_iter()
            .map(|b| b.filename)
            .collect();
        assert_eq!(originals.len(), 2, "the fixture made two");

        let (key_file, _, _) = enable_protection(&config_path, &profile_id, &db_path, &store, "correct horse battery staple", now()).unwrap();

        for filename in &originals {
            assert!(
                plaintext_backups_dir.join(filename).exists(),
                "the plaintext original stays exactly where it was"
            );
        }
        let protected_backups_dir = backups::backups_dir_for(&db_path, true);
        for filename in &originals {
            let converted = protected_backups_dir.join(filename);
            assert!(keyfile::key_file_path_for(&converted).exists());
            let dek = key_file.unlock_with_password("correct horse battery staple").unwrap();
            assert!(Store::open_with_key(&converted, DatabaseKey::Raw(dek.as_bytes())).is_ok());
        }
    }

    #[test]
    fn creating_a_protected_profile_registers_only_after_the_encrypted_file_verifies() {
        let dir = temp_dir("create-protected-happy");
        let live = dir.join("v.db");
        let config_path = dir.join("config.json");

        let (id, key_file, recovery_code, target_path) =
            create_protected_profile(&config_path, &live, "Sam", "correct horse battery staple", now()).unwrap();

        assert!(target_path.exists());
        assert!(keyfile::key_file_path_for(&target_path).exists());
        let dek = key_file.unlock_with_password("correct horse battery staple").unwrap();
        let opened = Store::open_with_key(&target_path, DatabaseKey::Raw(dek.as_bytes())).unwrap();
        // A fresh database always seeds the standard starter categories (see `DEFAULT_CATEGORIES`
        // in core/src/store/schema.rs) — the real signal that this is a genuinely fresh schema and not a
        // copy of some other, already-populated profile is the absence of any account or
        // transaction, which only a real profile would ever have.
        assert!(opened.list_accounts(chrono::Local::now().date_naive()).unwrap().is_empty());
        assert!(opened.all_transactions().unwrap().is_empty());
        assert_eq!(
            profiles::list_profiles(&config_path, &live)
                .iter()
                .find(|p| p.id == id)
                .unwrap()
                .protection,
            Some(profiles::Protection::new(keyfile::FORMAT))
        );
        assert_eq!(recovery_code.display().split('-').count(), 7);
    }

    #[test]
    fn a_duplicate_name_is_refused_before_any_file_is_written() {
        let dir = temp_dir("create-protected-duplicate");
        let live = dir.join("v.db");
        let config_path = dir.join("config.json");
        profiles::create_profile(&config_path, &live, "Sam", now()).unwrap();

        let error = create_protected_profile(&config_path, &live, "Sam", "correct horse battery staple", now())
            .map(|_| ())
            .unwrap_err();

        assert!(error.contains("already exists"), "{error}");
        assert_eq!(profiles::list_profiles(&config_path, &live).len(), 2, "no extra entry was added");
    }

    #[test]
    fn a_failed_export_never_registers_a_profile() {
        // Forces `export_encrypted_copy` to fail its own `refuse_existing` check by pre-creating the
        // exact path `plan_new_profile` will compute, proving the write-then-verify-then-register
        // order really is enforced and not just true by construction in the happy-path test above.
        let dir = temp_dir("create-protected-export-fails");
        let live = dir.join("v.db");
        let config_path = dir.join("config.json");
        let (id, target_db_path) = profiles::plan_new_profile(&config_path, &live, "Sam", now()).unwrap();
        std::fs::create_dir_all(target_db_path.parent().unwrap()).unwrap();
        std::fs::write(&target_db_path, b"already here").unwrap();

        let error = create_protected_profile(&config_path, &live, "Sam", "correct horse battery staple", now())
            .map(|_| ())
            .unwrap_err();

        assert!(error.contains("already exists"), "{error}");
        assert!(
            profiles::list_profiles(&config_path, &live).iter().all(|p| p.id != id),
            "never registered"
        );
    }

    #[test]
    fn an_unreadable_historical_backup_stops_the_operation_naming_it_and_touches_nothing_committed() {
        let dir = temp_dir("bad-backup");
        let (store, db_path) = populated_profile(&dir);
        let config_path = dir.join("config.json");
        let profile_id = register(&config_path, &db_path);
        let plaintext_backups_dir = backups::backups_dir_for(&db_path, false);
        let bad = plaintext_backups_dir.join("vaultspend-20250101-000000.db");
        std::fs::write(&bad, b"not a database").unwrap();

        let error = enable_protection(&config_path, &profile_id, &db_path, &store, "correct horse battery staple", now())
            .map(|_| ())
            .unwrap_err();

        assert!(error.contains("vaultspend-20250101-000000.db"), "{error}");
        assert_eq!(
            profiles::list_profiles(&config_path, &db_path)
                .iter()
                .find(|p| p.id == profile_id)
                .unwrap()
                .protection,
            None,
            "never committed"
        );
        // A pre-commit failure is unwound immediately, in this same call — not left on disk for the
        // next app launch to clean up. Waiting until then would mean any retry attempted in this same
        // session collides with this attempt's own orphaned files (see the test below).
        assert!(
            !config_path.parent().unwrap().join("protection-journal.json").exists(),
            "the journal should be cleaned up immediately, not left for a later restart"
        );
        assert!(
            !dir.join("vaultspend-protected.db").exists(),
            "the partial target database should be removed too"
        );
    }

    #[test]
    fn retrying_in_the_same_session_after_a_failed_attempt_does_not_collide_with_its_orphans() {
        let dir = temp_dir("retry-after-bad-backup");
        let (store, db_path) = populated_profile(&dir);
        let config_path = dir.join("config.json");
        let profile_id = register(&config_path, &db_path);
        let plaintext_backups_dir = backups::backups_dir_for(&db_path, false);
        // `populated_profile` makes two backups, at now()-2d and now()-1d; conversion processes
        // newest first (`list_backups` sorts newest-first), so corrupting the OLDER one means the
        // newer one is fully converted (and left as an orphan) before the failure is reached.
        let older = plaintext_backups_dir.join("vaultspend-20260919-090000.db");
        assert!(older.exists(), "fixture assumption: this is the older of the two backups");
        std::fs::write(&older, b"not a database").unwrap();

        let first_attempt = enable_protection(&config_path, &profile_id, &db_path, &store, "correct horse battery staple", now());
        assert!(first_attempt.is_err(), "the corrupted backup should still stop the first attempt");

        // The person moves the unreadable backup out of the way (the workaround Decision 10 itself
        // names) and tries again in the same running session.
        std::fs::remove_file(&older).unwrap();
        let (key_file, _, target_path) = enable_protection(&config_path, &profile_id, &db_path, &store, "correct horse battery staple", now())
            .expect("a retry after removing the bad backup should succeed, not collide with the first attempt's own orphaned files");

        let opened = Store::open_with_key(
            &target_path,
            DatabaseKey::Raw(key_file.unlock_with_password("correct horse battery staple").unwrap().as_bytes()),
        )
        .unwrap();
        assert!(opened
            .all_transactions()
            .unwrap()
            .iter()
            .any(|t| t.transaction.description == "Market Basket"));
        assert_eq!(
            profiles::list_profiles(&config_path, &target_path)
                .iter()
                .find(|p| p.id == profile_id)
                .unwrap()
                .protection,
            Some(profiles::Protection::new(keyfile::FORMAT))
        );
    }

    #[test]
    fn recovery_after_a_kill_before_the_registry_write_discards_everything_owned() {
        let dir = temp_dir("recover-before-commit");
        let (store, db_path) = populated_profile(&dir);
        let config_path = dir.join("config.json");
        let profile_id = register(&config_path, &db_path);
        // Simulates a kill right after the backups finish converting, before the registry write —
        // in a real run `debug_failpoint` would block forever here; a unit test can't spawn and kill
        // a real process (that is Task 9's job), so instead this drives `enable_protection` to
        // completion (nothing here blocks in a test build without a matching env var) and then
        // hand-verifies `recover_interrupted_operation` against a journal shaped exactly like a kill
        // at this point would leave: a written target db/key and both converted backups, but no
        // registry entry yet. Reconstructing that shape directly is simpler and just as faithful as
        // trying to actually stop the real function mid-flight.
        let plaintext_backups_dir = backups::backups_dir_for(&db_path, false);
        let protected_backups_dir = backups::backups_dir_for(&db_path, true);
        std::fs::create_dir_all(&protected_backups_dir).unwrap();
        let target_db_path = dir.join("vaultspend-protected.db");
        let target_key_path = keyfile::key_file_path_for(&target_db_path);
        let protection = keyfile::create_protection("correct horse battery staple", &KdfParams::FAST_FOR_TESTS, "2026-09-21T09:00:00Z").unwrap();
        store.export_encrypted_copy(&target_db_path, protection.dek.as_bytes()).unwrap();
        protection.key_file.write_to(&target_key_path).unwrap();
        let mut owned_backup_pairs = Vec::new();
        for info in backups::list_backups(&plaintext_backups_dir, false).unwrap() {
            let converted = protected_backups_dir.join(&info.filename);
            let historical = Store::open(plaintext_backups_dir.join(&info.filename)).unwrap();
            historical.export_encrypted_copy(&converted, protection.dek.as_bytes()).unwrap();
            protection.key_file.write_to(&keyfile::key_file_path_for(&converted)).unwrap();
            owned_backup_pairs.push(converted.display().to_string());
        }
        write_journal(
            &config_path,
            &ProtectionJournal {
                format: 1,
                profile_id: profile_id.clone(),
                target_db_path: target_db_path.display().to_string(),
                target_key_path: target_key_path.display().to_string(),
                owned_backup_pairs,
            },
        )
        .unwrap();

        recover_interrupted_operation(&config_path).unwrap();

        assert!(!target_db_path.exists());
        assert!(!target_key_path.exists());
        assert!(!config_path.parent().unwrap().join("protection-journal.json").exists());
        assert_eq!(
            profiles::list_profiles(&config_path, &db_path)
                .iter()
                .find(|p| p.id == profile_id)
                .unwrap()
                .protection,
            None
        );
        assert!(
            store
                .all_transactions()
                .unwrap()
                .iter()
                .any(|t| t.transaction.description == "Market Basket"),
            "the original is untouched and still openable"
        );
    }

    #[test]
    fn recovery_after_the_registry_already_shows_protection_just_retires_the_journal() {
        let dir = temp_dir("recover-after-commit");
        let (store, db_path) = populated_profile(&dir);
        let config_path = dir.join("config.json");
        let profile_id = register(&config_path, &db_path);
        let (_, _, target_path) = enable_protection(&config_path, &profile_id, &db_path, &store, "correct horse battery staple", now()).unwrap();
        // Re-create a journal by hand naming a commit that (per the registry) already happened —
        // simulating a kill in the sliver between the config write and the journal's own deletion.
        write_journal(
            &config_path,
            &ProtectionJournal {
                format: 1,
                profile_id: profile_id.clone(),
                target_db_path: target_path.display().to_string(),
                target_key_path: keyfile::key_file_path_for(&target_path).display().to_string(),
                owned_backup_pairs: Vec::new(),
            },
        )
        .unwrap();

        recover_interrupted_operation(&config_path).unwrap();

        assert!(target_path.exists(), "a committed target must never be deleted by recovery");
        assert!(!config_path.parent().unwrap().join("protection-journal.json").exists());
    }

    #[test]
    fn recovery_with_no_journal_at_all_is_a_silent_no_op() {
        let dir = temp_dir("recover-no-journal");

        recover_interrupted_operation(&dir.join("config.json")).unwrap();
    }
}
