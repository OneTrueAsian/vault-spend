use super::*;
use budget_core::models::AccountType;
use budget_core::protection::kdf::KdfParams;
use budget_core::protection::keyfile;
use budget_core::store::DatabaseKey;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("vaultspend-backups-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn dt(s: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap()
}

/// An encrypted store with a real key file beside it, for the key-aware backup tests below.
/// Uses `FAST_FOR_TESTS` KDF settings — this is about file plumbing, not KDF strength.
fn encrypted_store_with_key(dir: &Path, key: &[u8; 32]) -> (Store, PathBuf) {
    let plain_path = dir.join("plain.db");
    let enc_path = dir.join("vaultspend.db");
    let plain = Store::open(&plain_path).unwrap();
    plain.export_encrypted_copy(&enc_path, key).unwrap();
    let protection = keyfile::create_protection("correct horse battery staple", &KdfParams::FAST_FOR_TESTS, "2026-09-21T00:00:00Z").unwrap();
    protection.key_file.write_to(&keyfile::key_file_path_for(&enc_path)).unwrap();
    (Store::open_with_key(&enc_path, DatabaseKey::Raw(key)).unwrap(), enc_path)
}

#[test]
fn prune_backups_keeps_only_the_newest_n() {
    let existing = vec![
        "vaultspend-20260101-000000.db".to_string(),
        "vaultspend-20260103-000000.db".to_string(),
        "vaultspend-20260102-000000.db".to_string(),
    ];

    let to_delete = prune_backups(existing, 2);

    assert_eq!(to_delete, vec!["vaultspend-20260101-000000.db".to_string()]);
}

#[test]
fn prune_backups_deletes_nothing_when_under_the_limit() {
    let existing = vec!["vaultspend-20260101-000000.db".to_string()];
    assert!(prune_backups(existing, 14).is_empty());
}

#[test]
fn should_create_backup_decision_matrix() {
    struct Case {
        label: &'static str,
        existing: Vec<String>,
        expected: bool,
    }
    let cases = [
        Case {
            label: "no existing backups",
            existing: vec![],
            expected: true,
        },
        Case {
            label: "6 hours old, within the 24h interval",
            existing: vec!["vaultspend-20260830-060000.db".to_string()],
            expected: false,
        },
        Case {
            label: "30 hours old, past the 24h interval",
            existing: vec!["vaultspend-20260829-060000.db".to_string()],
            expected: true,
        },
    ];

    for case in cases {
        assert_eq!(
            should_create_backup(&case.existing, dt("2026-08-30 12:00:00"), 24),
            case.expected,
            "case: {}",
            case.label
        );
    }
}

#[test]
fn verify_backup_rejects_a_destination_missing_the_sources_data() {
    // Simulates exactly the failure mode observed in practice: a
    // destination file that *opens* fine (Store::open silently heals a
    // schema-less/truncated file into a valid empty database) but
    // doesn't actually contain the source's data — `Store::open`
    // succeeding is not sufficient evidence the backup is real.
    let dir = temp_dir("verify-rejects-empty");
    let source = Store::open(dir.join("source.db")).unwrap();
    source.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let empty_dest_path = dir.join("suspiciously-empty.db");
    Store::open(&empty_dest_path).unwrap(); // opens/initializes as empty, nothing copied in

    let result = verify_backup(&source, &empty_dest_path);

    assert!(
        result.is_err(),
        "expected verification to reject a destination missing the source's account"
    );
}

#[test]
fn verify_backup_accepts_a_destination_that_actually_matches() {
    let dir = temp_dir("verify-accepts-match");
    let source = Store::open(dir.join("source.db")).unwrap();
    source.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let dest_path = dir.join("real-backup.db");
    source.backup_to(&dest_path).unwrap();

    assert!(verify_backup(&source, &dest_path).is_ok());
}

#[test]
fn create_backup_writes_a_file_and_lists_it() {
    let dir = temp_dir("create");
    let live_path = dir.join("live.db");
    let store = Store::open(&live_path).unwrap();
    store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let backups_dir = dir.join("backups");

    let filename = create_backup(&store, &live_path, &backups_dir, None, dt("2026-08-30 12:00:00")).unwrap();

    assert_eq!(filename, "vaultspend-20260830-120000.db");
    assert!(backups_dir.join(&filename).exists());
    let listed = list_backups(&backups_dir, false).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].filename, filename);
    assert!(listed[0].size_bytes > 0);
}

#[test]
fn same_second_backups_get_distinct_filenames_that_still_sort_newest_first() {
    // Reproduces exactly the scenario found in real end-to-end testing:
    // a manual "Back up now" immediately followed by a restore's own
    // safety-snapshot landing in the same wall-clock second. Without
    // disambiguation the second call silently overwrote the first
    // backup file — including, in the restore case, overwriting the
    // very backup about to be restored *from*, with the current
    // (unwanted) live data.
    //
    // The disambiguation suffix must also not invert "newest first" —
    // `list_backups`/`prune_backups` both trust plain string sorting
    // to match chronological order. A `-N` suffix (`-` is 0x2D, which
    // sorts *before* `.` at 0x2E) silently broke this: the second
    // (truly newer) backup sorted as older than the first, which in
    // practice meant a stale/earlier backup could outrank a just-
    // created real one in the UI's "Restore" list.
    let dir = temp_dir("same-second-collision");
    let live_path = dir.join("live.db");
    let store = Store::open(&live_path).unwrap();
    store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let backups_dir = dir.join("backups");
    let same_instant = dt("2026-08-30 19:41:25");

    let first = create_backup(&store, &live_path, &backups_dir, None, same_instant).unwrap();
    let second = create_backup(&store, &live_path, &backups_dir, None, same_instant).unwrap();

    assert_ne!(first, second, "two backups computed for the same second must not collide");
    assert!(backups_dir.join(&first).exists(), "the first backup must survive the second call");
    assert!(backups_dir.join(&second).exists());

    let listed = list_backups(&backups_dir, false).unwrap();
    assert_eq!(listed[0].filename, second, "the second (later-created) backup must sort first (newest)");
    assert_eq!(listed[1].filename, first);
}

#[test]
fn create_backup_prunes_beyond_the_retention_limit() {
    let dir = temp_dir("prune-disk");
    let live_path = dir.join("live.db");
    let store = Store::open(&live_path).unwrap();
    let backups_dir = dir.join("backups");
    std::fs::create_dir_all(&backups_dir).unwrap();
    // Pre-seed 15 fake backups (the retention limit) with distinct
    // timestamps, all older than the one about to be created.
    for i in 0..15 {
        let name = format!("vaultspend-202601{:02}-000000.db", i + 1);
        std::fs::write(backups_dir.join(name), b"fake").unwrap();
    }

    create_backup(&store, &live_path, &backups_dir, None, dt("2026-08-30 12:00:00")).unwrap();

    let listed = list_backups(&backups_dir, false).unwrap();
    assert_eq!(listed.len(), 15, "expected pruning back down to the 15-backup limit");
    assert_eq!(listed[0].filename, "vaultspend-20260830-120000.db", "newest should survive");
    assert!(
        !listed.iter().any(|b| b.filename == "vaultspend-20260101-000000.db"),
        "the oldest fake backup should have been pruned"
    );
}

#[test]
fn create_backup_if_due_skips_within_the_interval() {
    let dir = temp_dir("if-due-skip");
    let live_path = dir.join("live.db");
    let store = Store::open(&live_path).unwrap();
    let backups_dir = dir.join("backups");

    let first = create_backup_if_due(&store, &live_path, &backups_dir, None, dt("2026-08-30 06:00:00")).unwrap();
    let second = create_backup_if_due(&store, &live_path, &backups_dir, None, dt("2026-08-30 12:00:00")).unwrap();

    assert!(first.is_some());
    assert!(second.is_none(), "expected no new backup within 24h of the first");
}

#[test]
fn restore_backup_brings_back_the_backed_up_data_not_a_later_mutation() {
    let dir = temp_dir("restore");
    let live_path = dir.join("live.db");
    let backups_dir = dir.join("backups");

    let store = Store::open(&live_path).unwrap();
    let account = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    store
        .save_transactions(
            account,
            &[budget_core::models::Transaction {
                date: "2026-08-01".parse().unwrap(),
                description: "Original".to_string(),
                amount: "-10.00".parse().unwrap(),
                category: None,
            }],
        )
        .unwrap();
    let filename = create_backup(&store, &live_path, &backups_dir, None, dt("2026-08-30 12:00:00")).unwrap();

    // Mutate the live data after the backup was taken.
    store
        .save_transactions(
            account,
            &[budget_core::models::Transaction {
                date: "2026-08-15".parse().unwrap(),
                description: "Added after backup".to_string(),
                amount: "-999.00".parse().unwrap(),
                category: None,
            }],
        )
        .unwrap();
    assert_eq!(store.all_transactions().unwrap().len(), 2);

    // Restoring must never touch `live_path` itself (still open, still
    // showing the mutation) — it writes a brand-new file instead.
    let restored_path = restore_backup(&store, &backups_dir, None, &filename, &live_path).unwrap();
    assert_eq!(store.all_transactions().unwrap().len(), 2, "live_path must be untouched by restore");

    let restored = Store::open(&restored_path).unwrap();
    let transactions = restored.all_transactions().unwrap();
    assert_eq!(transactions.len(), 1, "expected only the pre-backup transaction in the restored file");
    assert_eq!(transactions[0].transaction.description, "Original");
}

#[test]
fn encrypted_restore_uses_the_selected_backups_own_key() {
    let dir = temp_dir("restore-encrypted-old-key");
    let live_path = dir.join("vaultspend.db");
    let backups_dir = backups_dir_for(&live_path, true);
    std::fs::create_dir_all(&backups_dir).unwrap();

    let old = keyfile::create_protection("old password", &KdfParams::FAST_FOR_TESTS, "2026-09-21T00:00:00Z").unwrap();
    let old_backup_path = backups_dir.join("vaultspend-20260921-000000.db");
    let old_plain = Store::open(dir.join("old-plain.db")).unwrap();
    old_plain.export_encrypted_copy(&old_backup_path, old.dek.as_bytes()).unwrap();
    old.key_file.write_to(&keyfile::key_file_path_for(&old_backup_path)).unwrap();

    let current = keyfile::create_protection("new password", &KdfParams::FAST_FOR_TESTS, "2026-09-22T00:00:00Z").unwrap();
    let current_plain = Store::open(dir.join("current-plain.db")).unwrap();
    current_plain.export_encrypted_copy(&live_path, current.dek.as_bytes()).unwrap();
    current.key_file.write_to(&keyfile::key_file_path_for(&live_path)).unwrap();
    let live = Store::open_with_key(&live_path, DatabaseKey::Raw(current.dek.as_bytes())).unwrap();

    let restored_path = restore_backup_with_key(
        &live,
        &backups_dir,
        None,
        "vaultspend-20260921-000000.db",
        &live_path,
        DatabaseKey::Raw(old.dek.as_bytes()),
    )
    .unwrap();

    assert!(Store::open_with_key(&restored_path, DatabaseKey::Raw(old.dek.as_bytes())).is_ok());
    assert!(Store::open_with_key(&restored_path, DatabaseKey::Raw(current.dek.as_bytes())).is_err());
}

/// Regression test for a real data-loss bug: restoring the *oldest*
/// retained backup while already at the retention cap used to delete
/// that very file (as part of the safety-backup's own pruning) before
/// it had been read, then silently open a fresh empty database in its
/// place and "restore" that instead — reporting success while handing
/// back zero accounts. Filling retention to the cap and restoring the
/// oldest one reproduces exactly that scenario.
#[test]
fn restoring_the_oldest_backup_at_the_retention_cap_does_not_lose_its_data() {
    let dir = temp_dir("restore-oldest-at-cap");
    let live_path = dir.join("live.db");
    let backups_dir = dir.join("backups");

    let store = Store::open(&live_path).unwrap();
    let account = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    store
        .save_transactions(
            account,
            &[budget_core::models::Transaction {
                date: "2026-08-01".parse().unwrap(),
                description: "Original".to_string(),
                amount: "-10.00".parse().unwrap(),
                category: None,
            }],
        )
        .unwrap();

    // The oldest backup — the one we're about to restore — carries the
    // real data above. Every backup after it is a distinct, later
    // snapshot of the same (by-then-still-one-transaction) store; what
    // matters is only that DEFAULT_KEEP (15) backups already exist
    // before the restore, so the safety-backup this restore takes of
    // the live database is the 16th and prunes the oldest one.
    let oldest = create_backup(&store, &live_path, &backups_dir, None, dt("2026-08-01 00:00:00")).unwrap();
    for day in 2..=DEFAULT_KEEP {
        create_backup(&store, &live_path, &backups_dir, None, dt(&format!("2026-08-{day:02} 00:00:00"))).unwrap();
    }
    assert_eq!(list_backups(&backups_dir, false).unwrap().len(), DEFAULT_KEEP);

    let restored_path = restore_backup(&store, &backups_dir, None, &oldest, &live_path).unwrap();

    let restored = Store::open(&restored_path).unwrap();
    let transactions = restored.all_transactions().unwrap();
    assert_eq!(
        transactions.len(),
        1,
        "restoring the pruned-during-this-operation backup must still recover its real data, not an empty database"
    );
    assert_eq!(transactions[0].transaction.description, "Original");
}

#[test]
fn restore_backup_rejects_an_unknown_filename() {
    let dir = temp_dir("restore-missing");
    let live_path = dir.join("live.db");
    let store = Store::open(&live_path).unwrap();
    let backups_dir = dir.join("backups");

    let result = restore_backup(&store, &backups_dir, None, "vaultspend-20260101-000000.db", &live_path);

    assert!(result.is_err());
}

// ---- Phase 2 / 17: second backup destination ----

fn seeded_store(dir: &Path) -> Store {
    let store = Store::open(dir.join("live.db")).unwrap();
    store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    store
}

#[test]
fn mirror_backup_copies_the_backup_into_an_existing_second_folder() {
    let dir = temp_dir("mirror-copies");
    let store = seeded_store(&dir);
    let backups_dir = dir.join("backups");
    let filename = create_backup(&store, &dir.join("live.db"), &backups_dir, None, dt("2026-09-18 10:00:00")).unwrap();
    let copy_dir = dir.join("OneDrive").join("VaultSpend");
    std::fs::create_dir_all(&copy_dir).unwrap();

    let copied = mirror_backup(&backups_dir, &filename, &copy_dir).unwrap();

    assert_eq!(copied, copy_dir.join(&filename));
    assert_eq!(
        std::fs::metadata(&copied).unwrap().len(),
        std::fs::metadata(backups_dir.join(&filename)).unwrap().len()
    );
}

#[test]
fn a_second_folder_that_does_not_exist_is_refused_and_never_created() {
    let dir = temp_dir("mirror-missing");
    let store = seeded_store(&dir);
    let backups_dir = dir.join("backups");
    let filename = create_backup(&store, &dir.join("live.db"), &backups_dir, None, dt("2026-09-18 10:00:00")).unwrap();
    // A typo in a path must not quietly make a new folder somewhere else.
    let missing = dir.join("OneDriv").join("VaultSpend");

    let checked = check_copy_dir(&backups_dir, &missing);
    let mirrored = mirror_backup(&backups_dir, &filename, &missing);

    assert!(checked.unwrap_err().contains("doesn't exist"));
    assert!(mirrored.is_err());
    assert!(!missing.exists(), "the folder must not have been created");
    assert!(!dir.join("OneDriv").exists());
}

#[test]
fn a_second_folder_that_is_really_a_file_is_refused() {
    let dir = temp_dir("mirror-file");
    let store = seeded_store(&dir);
    let backups_dir = dir.join("backups");
    create_backup(&store, &dir.join("live.db"), &backups_dir, None, dt("2026-09-18 10:00:00")).unwrap();
    let file = dir.join("notes.txt");
    std::fs::write(&file, b"not a folder").unwrap();

    assert!(check_copy_dir(&backups_dir, &file).unwrap_err().contains("isn't a folder"));
}

#[test]
fn mirror_backup_trims_the_second_folder_to_the_retention_limit_and_spares_other_files() {
    let dir = temp_dir("mirror-trims");
    let store = seeded_store(&dir);
    let backups_dir = dir.join("backups");
    let copy_dir = dir.join("second");
    std::fs::create_dir_all(&copy_dir).unwrap();
    for day in 1..=15 {
        std::fs::write(copy_dir.join(format!("vaultspend-202608{day:02}-000000.db")), b"old").unwrap();
    }
    std::fs::write(copy_dir.join("holiday-photos.zip"), b"not a backup").unwrap();
    let filename = create_backup(&store, &dir.join("live.db"), &backups_dir, None, dt("2026-09-18 10:00:00")).unwrap();

    mirror_backup(&backups_dir, &filename, &copy_dir).unwrap();

    let mut kept = list_backup_filenames(&copy_dir).unwrap();
    kept.sort();
    assert_eq!(kept.len(), DEFAULT_KEEP);
    assert!(
        !kept.contains(&"vaultspend-20260801-000000.db".to_string()),
        "the oldest copy should have been trimmed"
    );
    assert!(kept.contains(&filename), "the new copy must be kept");
    assert!(
        copy_dir.join("holiday-photos.zip").exists(),
        "files that aren't backups are never touched"
    );
}

#[test]
fn mirror_backup_refuses_the_folder_the_backups_already_live_in() {
    let dir = temp_dir("mirror-same");
    let store = seeded_store(&dir);
    let backups_dir = dir.join("backups");
    let filename = create_backup(&store, &dir.join("live.db"), &backups_dir, None, dt("2026-09-18 10:00:00")).unwrap();

    let result = mirror_backup(&backups_dir, &filename, &backups_dir);

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("different folder"));
}

#[test]
fn mirror_backup_reports_a_destination_it_cannot_use() {
    let dir = temp_dir("mirror-bad");
    let store = seeded_store(&dir);
    let backups_dir = dir.join("backups");
    let filename = create_backup(&store, &dir.join("live.db"), &backups_dir, None, dt("2026-09-18 10:00:00")).unwrap();
    // A plain file where the folder should be.
    let blocker = dir.join("blocker");
    std::fs::write(&blocker, b"a file, not a folder").unwrap();

    assert!(mirror_backup(&backups_dir, &filename, &blocker.join("inside")).is_err());
}

#[test]
fn create_backup_full_also_copies_when_a_second_folder_is_given() {
    let dir = temp_dir("full-copies");
    let store = seeded_store(&dir);
    let copy_dir = dir.join("second");
    std::fs::create_dir_all(&copy_dir).unwrap();

    let outcome = create_backup_full(
        &store,
        &dir.join("live.db"),
        &dir.join("backups"),
        Some(&copy_dir),
        dt("2026-09-18 10:00:00"),
    )
    .unwrap();

    assert_eq!(outcome.copied_to, Some(copy_dir.join(&outcome.filename)));
    assert!(outcome.copy_error.is_none());
    assert!(copy_dir.join(&outcome.filename).exists());
}

#[test]
fn create_backup_full_copies_nowhere_when_no_second_folder_is_set() {
    let dir = temp_dir("full-nocopy");
    let store = seeded_store(&dir);

    let outcome = create_backup_full(&store, &dir.join("live.db"), &dir.join("backups"), None, dt("2026-09-18 10:00:00")).unwrap();

    assert!(outcome.copied_to.is_none());
    assert!(outcome.copy_error.is_none());
}

#[test]
fn a_second_folder_that_fails_never_fails_the_backup_itself() {
    let dir = temp_dir("full-badcopy");
    let store = seeded_store(&dir);
    let blocker = dir.join("blocker");
    std::fs::write(&blocker, b"a file, not a folder").unwrap();
    let bad_copy_dir = blocker.join("inside");
    let backups_dir = dir.join("backups");

    let outcome = create_backup_full(&store, &dir.join("live.db"), &backups_dir, Some(&bad_copy_dir), dt("2026-09-18 10:00:00")).unwrap();

    assert!(backups_dir.join(&outcome.filename).exists(), "the primary backup must still exist");
    assert!(outcome.copied_to.is_none());
    assert!(outcome.copy_error.is_some(), "the failure must be reported, not swallowed");
}

// ---- key-aware backups (Phase C, Task 4) ----

#[test]
fn a_backup_of_an_encrypted_store_is_itself_encrypted_with_a_key_file_beside_it() {
    let dir = temp_dir("encrypted-backup");
    let key = [0x33u8; 32];
    let (store, source_path) = encrypted_store_with_key(&dir, &key);
    let backups_dir = backups_dir_for(&source_path, true);

    let filename = create_backup(&store, &source_path, &backups_dir, None, dt("2026-09-21 09:00:00")).unwrap();

    let backup_path = backups_dir.join(&filename);
    let header = std::fs::read(&backup_path).unwrap();
    assert_ne!(&header[..16], b"SQLite format 3\0", "the backup itself stays encrypted on disk");
    let key_file_path = keyfile::key_file_path_for(&backup_path);
    assert!(key_file_path.exists());
    assert!(Store::open_with_key(&backup_path, DatabaseKey::Raw(&key)).is_ok());
}

#[test]
fn list_backups_hides_an_encrypted_db_missing_its_key_file_for_a_protected_profile() {
    let dir = temp_dir("hide-incomplete-pair");
    let key = [0x44u8; 32];
    let (store, source_path) = encrypted_store_with_key(&dir, &key);
    let backups_dir = backups_dir_for(&source_path, true);
    let filename = create_backup(&store, &source_path, &backups_dir, None, dt("2026-09-21 09:00:00")).unwrap();
    std::fs::remove_file(keyfile::key_file_path_for(&backups_dir.join(&filename))).unwrap();

    let listed = list_backups(&backups_dir, true).unwrap();

    assert!(listed.is_empty(), "an interrupted publication must never look like a healthy backup");
}

#[test]
fn list_backups_for_an_unprotected_profile_is_unaffected_by_missing_key_files() {
    let dir = temp_dir("plaintext-unaffected");
    let store = seeded_store(&dir);
    let backups_dir = backups_dir_for(&dir.join("live.db"), false);
    create_backup(&store, &dir.join("live.db"), &backups_dir, None, dt("2026-09-21 09:00:00")).unwrap();

    assert_eq!(list_backups(&backups_dir, false).unwrap().len(), 1);
}

#[test]
fn mirroring_an_encrypted_backup_copies_its_key_file_too() {
    let dir = temp_dir("mirror-encrypted");
    let key = [0x55u8; 32];
    let (store, source_path) = encrypted_store_with_key(&dir, &key);
    let backups_dir = backups_dir_for(&source_path, true);
    let copy_dir = dir.join("second-copy");
    std::fs::create_dir_all(&copy_dir).unwrap();
    let filename = create_backup(&store, &source_path, &backups_dir, None, dt("2026-09-21 09:00:00")).unwrap();

    let mirrored = mirror_backup(&backups_dir, &filename, &copy_dir).unwrap();

    assert!(keyfile::key_file_path_for(&mirrored).exists());
}

#[test]
fn pruning_an_encrypted_backup_removes_its_key_file_with_it() {
    // Caught a real bug in this test itself the first time it ran: it iterated `remaining`
    // (the *survivors*) and asserted each one's key file was gone, backwards from what the
    // behavior actually is (a survivor keeps its key; only a pruned backup loses it) — the
    // assertion happened to still fail loudly rather than silently pass, but for the wrong
    // reason. Fixed to check both sides against the full list of what was created.
    let dir = temp_dir("prune-encrypted");
    let key = [0x66u8; 32];
    let (store, source_path) = encrypted_store_with_key(&dir, &key);
    let backups_dir = backups_dir_for(&source_path, true);
    let days = [
        "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17",
    ];
    let mut all_created = Vec::new();
    for day in days {
        all_created.push(create_backup(&store, &source_path, &backups_dir, None, dt(&format!("2026-08-{day} 00:00:00"))).unwrap());
    }

    let remaining = list_backup_filenames(&backups_dir).unwrap();
    assert_eq!(remaining.len(), 15, "DEFAULT_KEEP still applies");
    for filename in &all_created {
        let key_file_path = keyfile::key_file_path_for(&backups_dir.join(filename));
        if remaining.contains(filename) {
            assert!(key_file_path.exists(), "a surviving backup must keep its key file: {filename}");
        } else {
            assert!(!key_file_path.exists(), "a pruned backup's key file must go with it: {filename}");
        }
    }
}

// ---- interrupted-copy safety (Phase F, Task 1): only complete backups are ever published ----

/// Every entry in `dir` that is neither a recognized backup nor its key — i.e. staging debris.
fn stray_files(dir: &Path) -> Vec<String> {
    let mut strays: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .filter(|name| !(name.starts_with(BACKUP_PREFIX) && (name.ends_with(BACKUP_SUFFIX) || name.ends_with(".db.key"))))
        .collect();
    strays.sort();
    strays
}

#[test]
fn staging_files_and_orphan_key_files_are_never_listed_as_backups() {
    let dir = temp_dir("list-ignores-debris");
    std::fs::write(dir.join(".vaultspend-backup-test.partial"), b"partial").unwrap();
    std::fs::write(dir.join("vaultspend-20260927-120000.db.key"), b"orphan").unwrap();

    assert!(list_backup_filenames(&dir).unwrap().is_empty());
    assert!(list_backups(&dir, true).unwrap().is_empty());
    assert!(list_backups(&dir, false).unwrap().is_empty());
}

#[test]
fn a_successful_backup_leaves_no_staging_files_behind() {
    let dir = temp_dir("publish-clean");
    let store = seeded_store(&dir);
    let backups_dir = dir.join("backups");

    create_backup(&store, &dir.join("live.db"), &backups_dir, None, dt("2026-09-27 10:00:00")).unwrap();

    assert!(stray_files(&backups_dir).is_empty(), "found {:?}", stray_files(&backups_dir));
}

#[test]
fn publishing_a_plaintext_staged_backup_moves_it_to_the_final_name() {
    let dir = temp_dir("publish-plain");
    let staged = dir.join(".vaultspend-backup-1.partial");
    let final_db = dir.join("vaultspend-20260927-100000.db");
    std::fs::write(&staged, b"complete snapshot").unwrap();

    publish_staged_backup(&staged, &final_db).unwrap();

    assert_eq!(std::fs::read(&final_db).unwrap(), b"complete snapshot");
    assert!(!staged.exists());
    assert!(!keyfile::key_file_path_for(&final_db).exists());
}

#[test]
fn publishing_a_protected_staged_backup_publishes_the_pair() {
    let dir = temp_dir("publish-pair");
    let staged = dir.join(".vaultspend-backup-1.partial");
    let final_db = dir.join("vaultspend-20260927-100000.db");
    std::fs::write(&staged, b"encrypted snapshot").unwrap();
    std::fs::write(keyfile::key_file_path_for(&staged), b"key material").unwrap();

    publish_staged_backup(&staged, &final_db).unwrap();

    assert_eq!(std::fs::read(&final_db).unwrap(), b"encrypted snapshot");
    assert_eq!(std::fs::read(keyfile::key_file_path_for(&final_db)).unwrap(), b"key material");
    assert!(stray_files(&dir).is_empty(), "found {:?}", stray_files(&dir));
}

#[test]
fn publishing_never_replaces_an_existing_backup() {
    let dir = temp_dir("publish-collision");
    let staged = dir.join(".vaultspend-backup-1.partial");
    let final_db = dir.join("vaultspend-20260927-100000.db");
    std::fs::write(&final_db, b"the earlier good backup").unwrap();
    std::fs::write(&staged, b"new snapshot").unwrap();
    std::fs::write(keyfile::key_file_path_for(&staged), b"new key").unwrap();

    let result = publish_staged_backup(&staged, &final_db);

    assert!(result.unwrap_err().contains("already exists"));
    assert_eq!(std::fs::read(&final_db).unwrap(), b"the earlier good backup");
    assert!(
        !keyfile::key_file_path_for(&final_db).exists(),
        "a refused publication must not leave its key behind"
    );
}

#[test]
fn publishing_never_replaces_an_existing_key_file() {
    let dir = temp_dir("publish-key-collision");
    let staged = dir.join(".vaultspend-backup-1.partial");
    let final_db = dir.join("vaultspend-20260927-100000.db");
    let final_key = keyfile::key_file_path_for(&final_db);
    std::fs::write(&final_key, b"someone else's key").unwrap();
    std::fs::write(&staged, b"new snapshot").unwrap();
    std::fs::write(keyfile::key_file_path_for(&staged), b"new key").unwrap();

    let result = publish_staged_backup(&staged, &final_db);

    assert!(result.is_err());
    assert_eq!(std::fs::read(&final_key).unwrap(), b"someone else's key");
    assert!(!final_db.exists(), "the database must not be published without owning its key");
}

#[test]
fn a_failed_database_publication_removes_only_the_key_this_attempt_published() {
    let dir = temp_dir("publish-db-fails");
    let staged = dir.join(".vaultspend-backup-1.partial");
    let final_db = dir.join("vaultspend-20260927-100000.db");
    // The staged key exists but the staged database is gone, so the second rename fails.
    std::fs::write(keyfile::key_file_path_for(&staged), b"new key").unwrap();
    std::fs::write(dir.join("vaultspend-20260101-000000.db"), b"an unrelated earlier backup").unwrap();

    let result = publish_staged_backup(&staged, &final_db);

    assert!(result.is_err());
    assert!(!final_db.exists());
    assert!(
        !keyfile::key_file_path_for(&final_db).exists(),
        "no orphan key may remain from this attempt"
    );
    assert_eq!(
        std::fs::read(dir.join("vaultspend-20260101-000000.db")).unwrap(),
        b"an unrelated earlier backup"
    );
}

#[test]
fn a_backup_that_cannot_write_its_key_file_publishes_nothing_and_keeps_earlier_backups() {
    let dir = temp_dir("key-copy-fails");
    let key = [0x77u8; 32];
    let (store, source_path) = encrypted_store_with_key(&dir, &key);
    let backups_dir = backups_dir_for(&source_path, true);
    let earlier = create_backup(&store, &source_path, &backups_dir, None, dt("2026-09-26 09:00:00")).unwrap();
    std::fs::remove_file(keyfile::key_file_path_for(&source_path)).unwrap();

    let result = create_backup(&store, &source_path, &backups_dir, None, dt("2026-09-27 09:00:00"));

    assert!(result.is_err());
    let listed = list_backups(&backups_dir, true).unwrap();
    assert_eq!(listed.len(), 1, "only the earlier backup may be listed");
    assert_eq!(listed[0].filename, earlier);
    assert!(Store::open_with_key(backups_dir.join(&earlier), DatabaseKey::Raw(&key)).is_ok());
    assert!(stray_files(&backups_dir).is_empty(), "found {:?}", stray_files(&backups_dir));
}

#[test]
fn an_orphan_key_file_does_not_capture_the_next_backup_name() {
    let dir = temp_dir("orphan-key-name");
    std::fs::write(dir.join("vaultspend-20260927-100000.db.key"), b"orphan from a crash").unwrap();

    let path = unique_backup_path(&dir, dt("2026-09-27 10:00:00"));

    assert_ne!(path, dir.join("vaultspend-20260927-100000.db"));
    assert!(!keyfile::key_file_path_for(&path).exists());
}

#[test]
fn a_second_folder_name_collision_is_reported_and_leaves_the_other_file_alone() {
    let dir = temp_dir("mirror-collision");
    let store = seeded_store(&dir);
    let backups_dir = dir.join("backups");
    let copy_dir = dir.join("second");
    std::fs::create_dir_all(&copy_dir).unwrap();
    let existing = copy_dir.join("vaultspend-20260918-100000.db");
    std::fs::write(&existing, b"someone else's file with this name").unwrap();

    let outcome = create_backup_full(&store, &dir.join("live.db"), &backups_dir, Some(&copy_dir), dt("2026-09-18 10:00:00")).unwrap();

    assert_eq!(outcome.filename, "vaultspend-20260918-100000.db");
    assert!(outcome.copied_to.is_none());
    assert!(outcome.copy_error.unwrap().contains("already exists"));
    assert_eq!(std::fs::read(&existing).unwrap(), b"someone else's file with this name");
    assert_eq!(list_backups(&backups_dir, false).unwrap().len(), 1, "the local backup is still good");
    assert!(stray_files(&copy_dir).is_empty(), "no staging debris, found {:?}", stray_files(&copy_dir));
}

#[test]
fn mirroring_a_backup_the_second_folder_already_holds_identically_is_a_success() {
    // Choosing the same folder again after "Stop copying" re-mirrors the newest backup, which
    // may already be there byte for byte — that must not turn into a refusal.
    let dir = temp_dir("mirror-identical");
    let key = [0xAAu8; 32];
    let (store, source_path) = encrypted_store_with_key(&dir, &key);
    let backups_dir = backups_dir_for(&source_path, true);
    let copy_dir = dir.join("second");
    std::fs::create_dir_all(&copy_dir).unwrap();
    let filename = create_backup(&store, &source_path, &backups_dir, None, dt("2026-09-27 09:00:00")).unwrap();
    let first = mirror_backup(&backups_dir, &filename, &copy_dir).unwrap();

    let again = mirror_backup(&backups_dir, &filename, &copy_dir).unwrap();

    assert_eq!(first, again);
    assert!(Store::open_with_key(&again, DatabaseKey::Raw(&key)).is_ok());
    assert!(stray_files(&copy_dir).is_empty(), "found {:?}", stray_files(&copy_dir));
}

#[test]
fn a_second_folder_key_collision_publishes_no_database_and_keeps_the_local_backup() {
    let dir = temp_dir("mirror-key-collision");
    let key = [0x88u8; 32];
    let (store, source_path) = encrypted_store_with_key(&dir, &key);
    let backups_dir = backups_dir_for(&source_path, true);
    let copy_dir = dir.join("second");
    std::fs::create_dir_all(&copy_dir).unwrap();
    let orphan_key = copy_dir.join("vaultspend-20260927-090000.db.key");
    std::fs::write(&orphan_key, b"orphan key at the destination").unwrap();

    let outcome = create_backup_full(&store, &source_path, &backups_dir, Some(&copy_dir), dt("2026-09-27 09:00:00")).unwrap();

    assert!(outcome.copy_error.is_some());
    assert!(
        !copy_dir.join(&outcome.filename).exists(),
        "no database may be published next to a foreign key"
    );
    assert_eq!(std::fs::read(&orphan_key).unwrap(), b"orphan key at the destination");
    assert!(Store::open_with_key(backups_dir.join(&outcome.filename), DatabaseKey::Raw(&key)).is_ok());
}

#[test]
fn a_protected_second_copy_is_a_usable_pair_and_leaves_no_staging_files() {
    let dir = temp_dir("mirror-pair");
    let key = [0x99u8; 32];
    let (store, source_path) = encrypted_store_with_key(&dir, &key);
    let backups_dir = backups_dir_for(&source_path, true);
    let copy_dir = dir.join("second");
    std::fs::create_dir_all(&copy_dir).unwrap();

    let outcome = create_backup_full(&store, &source_path, &backups_dir, Some(&copy_dir), dt("2026-09-27 09:00:00")).unwrap();

    let copied = outcome.copied_to.expect("the second copy should have been made");
    assert_eq!(
        std::fs::read(&copied).unwrap(),
        std::fs::read(backups_dir.join(&outcome.filename)).unwrap()
    );
    assert_eq!(
        std::fs::read(keyfile::key_file_path_for(&copied)).unwrap(),
        std::fs::read(keyfile::key_file_path_for(&backups_dir.join(&outcome.filename))).unwrap()
    );
    assert!(Store::open_with_key(&copied, DatabaseKey::Raw(&key)).is_ok());
    assert!(stray_files(&copy_dir).is_empty(), "found {:?}", stray_files(&copy_dir));
}

fn assert_restore_refuses_damaged_snapshot(name: &str, damage: impl Fn(&Path)) {
    let dir = temp_dir(name);
    let store = seeded_store(&dir);
    let backups_dir = dir.join("backups");
    std::fs::create_dir_all(&backups_dir).unwrap();
    let damaged = backups_dir.join("vaultspend-20260101-000000.db");
    damage(&damaged);
    let live = dir.join("live.db");
    let accounts_before = store.list_accounts(chrono::Local::now().date_naive()).unwrap().len();

    let result = restore_backup(&store, &backups_dir, None, "vaultspend-20260101-000000.db", &live);

    assert!(result.is_err(), "a damaged legacy snapshot must be refused, got {result:?}");
    assert_eq!(
        store.list_accounts(chrono::Local::now().date_naive()).unwrap().len(),
        accounts_before,
        "the active data is untouched"
    );
    let restored: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .filter(|n| n.starts_with("vaultspend-restored-"))
        .collect();
    assert!(restored.is_empty(), "no restored file may be left behind: {restored:?}");
}

#[test]
fn restoring_a_legacy_snapshot_of_garbage_bytes_is_refused() {
    assert_restore_refuses_damaged_snapshot("restore-garbage", |p| std::fs::write(p, b"this was never a database").unwrap());
}

#[test]
fn restoring_a_legacy_snapshot_of_zero_bytes_is_refused_not_healed_into_an_empty_database() {
    assert_restore_refuses_damaged_snapshot("restore-zero", |p| std::fs::write(p, b"").unwrap());
}

#[test]
fn restoring_a_truncated_legacy_snapshot_is_refused() {
    assert_restore_refuses_damaged_snapshot("restore-truncated", |p| {
        let source_dir = p.parent().unwrap().parent().unwrap().join("source-for-truncation");
        std::fs::create_dir_all(&source_dir).unwrap();
        let store = Store::open(source_dir.join("real.db")).unwrap();
        store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.backup_to(p).unwrap();
        drop(store);
        let bytes = std::fs::read(p).unwrap();
        std::fs::write(p, &bytes[..bytes.len() / 2]).unwrap();
    });
}

#[test]
fn upgrade_safety_copies_are_listed_recoverable_and_preserved_by_restore_and_retention() {
    for encrypted in [false, true] {
        let dir = temp_dir(if encrypted {
            "historical-upgrade-protected"
        } else {
            "historical-upgrade-plain"
        });
        let plain_path = dir.join("plain.db");
        {
            let store = Store::open(&plain_path).unwrap();
            store.get_or_create_account("Original account", AccountType::Checking).unwrap();
        }
        rusqlite::Connection::open(&plain_path)
            .unwrap()
            .execute("DELETE FROM schema_features WHERE name = 'historical_account_moves'", [])
            .unwrap();
        let protection = keyfile::create_protection("historical restore password", &KdfParams::FAST_FOR_TESTS, "2026-10-29T00:00:00Z").unwrap();
        let path = if encrypted {
            let encrypted_path = dir.join("protected.db");
            // Export without first opening/migrating the legacy input through Store.
            let conn = rusqlite::Connection::open(&plain_path).unwrap();
            let key_hex: String = protection.dek.as_bytes().iter().map(|b| format!("{b:02x}")).collect();
            conn.execute_batch(&format!(
                "ATTACH DATABASE '{}' AS encrypted KEY \"x'{key_hex}'\"; SELECT sqlcipher_export('encrypted'); DETACH DATABASE encrypted;",
                encrypted_path.to_string_lossy().replace('\\', "/").replace('\'', "''")
            ))
            .unwrap();
            protection.key_file.write_to(&keyfile::key_file_path_for(&encrypted_path)).unwrap();
            encrypted_path
        } else {
            plain_path.clone()
        };
        let store = Store::open_with_key(
            &path,
            if encrypted {
                DatabaseKey::Raw(protection.dek.as_bytes())
            } else {
                DatabaseKey::Plaintext
            },
        )
        .unwrap();
        let directory = backups_dir_for(&path, encrypted);
        let listed = list_backups(&directory, encrypted).unwrap();
        let safety = listed
            .iter()
            .find(|b| is_pre_migration_backup(&b.filename))
            .expect("upgrade copy appears in the restore list");
        let source = directory.join(&safety.filename);
        let original_bytes = std::fs::read(&source).unwrap();
        let key_bytes = encrypted.then(|| std::fs::read(keyfile::key_file_path_for(&source)).unwrap());
        let key = if encrypted {
            let recovered = keyfile::KeyFile::read(&keyfile::key_file_path_for(&source))
                .unwrap()
                .unlock_with_password("historical restore password")
                .unwrap();
            Some(recovered)
        } else {
            None
        };
        let restored = restore_backup_with_key(
            &store,
            &directory,
            None,
            &safety.filename,
            &path,
            key.as_ref().map(|k| DatabaseKey::Raw(k.as_bytes())).unwrap_or(DatabaseKey::Plaintext),
        )
        .unwrap();
        let restored_store = Store::open_with_key(
            &restored,
            key.as_ref().map(|k| DatabaseKey::Raw(k.as_bytes())).unwrap_or(DatabaseKey::Plaintext),
        )
        .unwrap();
        assert!(restored_store
            .list_accounts(chrono::Local::now().date_naive())
            .unwrap()
            .iter()
            .any(|a| a.account.name == "Original account"));
        assert_eq!(
            std::fs::read(&source).unwrap(),
            original_bytes,
            "restoring does not migrate the original recovery copy"
        );
        if let Some(bytes) = key_bytes {
            assert_eq!(std::fs::read(keyfile::key_file_path_for(&source)).unwrap(), bytes);
        }
        prune_to_disk(&directory, 0).unwrap();
        assert!(source.exists(), "ordinary retention never deletes the pre-upgrade recovery copy");
        assert!(std::fs::read_dir(&directory)
            .unwrap()
            .all(|e| !e.unwrap().file_name().to_string_lossy().starts_with(".historical-restore-")));
    }
}
