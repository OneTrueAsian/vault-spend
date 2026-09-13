//! Automatic and manual local backup snapshots of the live database, kept
//! next to wherever it actually lives (default AppData, or a relocated
//! folder — see `config.rs`). Every filename embeds its own timestamp
//! (`vaultspend-YYYYMMDD-HHMMSS.db`), so listing/pruning/sorting never
//! needs filesystem metadata — just string comparison, which is also
//! chronological given the fixed-width format.
use budget_core::store::Store;
use chrono::NaiveDateTime;
use std::path::{Path, PathBuf};

const BACKUP_PREFIX: &str = "vaultspend-";
const BACKUP_SUFFIX: &str = ".db";
const DEFAULT_KEEP: usize = 15;
const AUTO_BACKUP_INTERVAL_HOURS: i64 = 24;

pub struct BackupInfo {
    pub filename: String,
    pub created_at: String,
    pub size_bytes: u64,
}

fn backup_filename(now: NaiveDateTime) -> String {
    format!("{BACKUP_PREFIX}{}{BACKUP_SUFFIX}", now.format("%Y%m%d-%H%M%S"))
}

/// The plain `backup_filename(now)` path, or a disambiguated `-N` variant
/// if that path is already taken — two backups computed within the same
/// second (a manual "Back up now" immediately followed by a restore's own
/// safety-snapshot, in practice) must never silently overwrite one
/// another; second-precision filenames alone can't tell them apart.
fn unique_backup_path(backups_dir: &Path, now: NaiveDateTime) -> PathBuf {
    let base = backups_dir.join(backup_filename(now));
    if !base.exists() {
        return base;
    }
    // `_N` rather than `-N`: filenames sort lexicographically wherever
    // this crate treats sort order as chronological (`prune_backups`,
    // `list_backups`) — `_` (0x5F) sorts *after* `.` (0x2E), so a
    // disambiguated (later-created) file correctly sorts newer than the
    // plain one it collided with. A `-` (0x2D) sorts *before* `.`, which
    // silently inverted that ordering and was the actual cause of a
    // stale/empty backup outranking the real one in the UI in practice.
    let mut n = 2;
    loop {
        let candidate = backups_dir.join(format!("{BACKUP_PREFIX}{}_{n}{BACKUP_SUFFIX}", now.format("%Y%m%d-%H%M%S")));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/// A disambiguating `_N` suffix (see `unique_backup_path`) may follow the
/// fixed-width `YYYYMMDD-HHMMSS` (15 characters) timestamp — only that
/// leading slice is parsed, so a disambiguated filename still yields a
/// usable (if identical-to-the-second) display timestamp.
fn parse_backup_timestamp(filename: &str) -> Option<NaiveDateTime> {
    let stem = filename.strip_prefix(BACKUP_PREFIX)?.strip_suffix(BACKUP_SUFFIX)?;
    let timestamp_part = stem.get(0..15)?;
    NaiveDateTime::parse_from_str(timestamp_part, "%Y%m%d-%H%M%S").ok()
}

/// Given every backup filename currently on disk (any order), the ones
/// beyond the newest `keep` that should be deleted — pure, so directly
/// testable without a real filesystem. Filenames sort chronologically as
/// plain strings given the fixed-width timestamp format.
fn prune_backups(mut existing: Vec<String>, keep: usize) -> Vec<String> {
    existing.sort();
    let excess = existing.len().saturating_sub(keep);
    existing.into_iter().take(excess).collect()
}

/// Whether enough time has passed since the newest existing backup (or
/// there are none yet) to justify creating another one.
fn should_create_backup(existing: &[String], now: NaiveDateTime, interval_hours: i64) -> bool {
    let newest = existing.iter().filter_map(|f| parse_backup_timestamp(f)).max();
    match newest {
        None => true,
        Some(t) => (now - t).num_hours() >= interval_hours,
    }
}

fn list_backup_filenames(backups_dir: &Path) -> std::io::Result<Vec<String>> {
    if !backups_dir.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for entry in std::fs::read_dir(backups_dir)? {
        let name = entry?.file_name();
        if let Some(name) = name.to_str() {
            if name.starts_with(BACKUP_PREFIX) && name.ends_with(BACKUP_SUFFIX) {
                result.push(name.to_string());
            }
        }
    }
    Ok(result)
}

fn prune_to_disk(backups_dir: &Path, keep: usize) -> Result<(), String> {
    let existing = list_backup_filenames(backups_dir).map_err(|e| e.to_string())?;
    for filename in prune_backups(existing, keep) {
        // Best-effort: a backup that fails to delete (e.g. briefly locked
        // by antivirus scanning) just means one extra file survives past
        // the retention target, not a functional failure worth surfacing.
        let _ = std::fs::remove_file(backups_dir.join(filename));
    }
    Ok(())
}

/// A backup that opens without erroring isn't necessarily a *correct* one:
/// `Store::open` on a schema-less or truncated file silently heals it into
/// a valid but **empty** database (`init_schema`'s `CREATE TABLE IF NOT
/// EXISTS` runs regardless) — so "does it open" can't distinguish a real
/// backup from one left behind by an interrupted write (observed in
/// practice: a freshly-created destination file occasionally comes back
/// as 0 bytes with a stray `-journal` sibling, most likely a transient
/// Windows filesystem/antivirus interaction with a brand-new file rather
/// than anything `Store::backup_to`/SQLite's backup API did wrong). This
/// compares row counts against the source instead, which a merely-empty
/// database can't fake.
fn verify_backup(source: &Store, dest_path: &Path) -> Result<(), String> {
    let today = chrono::Local::now().date_naive();
    let expected_accounts = source.list_accounts(today).map_err(|e| e.to_string())?.len();
    let expected_transactions = source.all_transactions().map_err(|e| e.to_string())?.len();

    let backup = Store::open(dest_path).map_err(|e| e.to_string())?;
    let actual_accounts = backup.list_accounts(today).map_err(|e| e.to_string())?.len();
    let actual_transactions = backup.all_transactions().map_err(|e| e.to_string())?.len();

    if actual_accounts != expected_accounts || actual_transactions != expected_transactions {
        return Err(format!(
            "expected {expected_accounts} account(s) / {expected_transactions} transaction(s), got {actual_accounts} / {actual_transactions}"
        ));
    }
    Ok(())
}

/// Creates one timestamped backup of `store` in `backups_dir` via
/// `Store::backup_to`, verifies it (see `verify_backup`) with a couple of
/// retries for the transient-write-interference case, then prunes down to
/// the newest `DEFAULT_KEEP`. A backup that never verifies within the
/// retry budget is deleted rather than left in the list looking like a
/// real one. Used by both the manual "Back up now" command and the
/// automatic launch-time check.
pub fn create_backup(store: &Store, backups_dir: &Path, now: NaiveDateTime) -> Result<String, String> {
    std::fs::create_dir_all(backups_dir).map_err(|e| e.to_string())?;
    let dest_path = unique_backup_path(backups_dir, now);
    let filename = dest_path.file_name().expect("just built from a filename").to_string_lossy().to_string();

    const MAX_ATTEMPTS: u32 = 3;
    let mut last_error = String::new();
    for attempt in 1..=MAX_ATTEMPTS {
        let _ = std::fs::remove_file(&dest_path);
        let _ = std::fs::remove_file(dest_path.with_extension("db-journal"));
        store.backup_to(&dest_path).map_err(|e| e.to_string())?;
        match verify_backup(store, &dest_path) {
            Ok(()) => {
                prune_to_disk(backups_dir, DEFAULT_KEEP)?;
                return Ok(filename);
            }
            Err(e) => {
                last_error = e;
                if attempt < MAX_ATTEMPTS {
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
            }
        }
    }
    let _ = std::fs::remove_file(&dest_path);
    Err(format!("backup did not verify after {MAX_ATTEMPTS} attempts: {last_error}"))
}

/// Creates a backup only if the newest existing one is more than 24h old
/// (or none exist yet) — the launch-time automatic check, distinct from
/// the always-runs manual "Back up now" button.
pub fn create_backup_if_due(store: &Store, backups_dir: &Path, now: NaiveDateTime) -> Result<Option<String>, String> {
    std::fs::create_dir_all(backups_dir).map_err(|e| e.to_string())?;
    let existing = list_backup_filenames(backups_dir).map_err(|e| e.to_string())?;
    if should_create_backup(&existing, now, AUTO_BACKUP_INTERVAL_HOURS) {
        Ok(Some(create_backup(store, backups_dir, now)?))
    } else {
        Ok(None)
    }
}

/// Every backup on disk, newest first, with its display timestamp (parsed
/// from the filename, not filesystem metadata — stable even if the file
/// was copied/moved and its mtime changed) and size.
pub fn list_backups(backups_dir: &Path) -> Result<Vec<BackupInfo>, String> {
    let mut filenames = list_backup_filenames(backups_dir).map_err(|e| e.to_string())?;
    filenames.sort();
    filenames.reverse();
    Ok(filenames
        .into_iter()
        .map(|filename| {
            let path = backups_dir.join(&filename);
            let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let created_at = parse_backup_timestamp(&filename)
                .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_else(|| filename.clone());
            BackupInfo {
                filename,
                created_at,
                size_bytes,
            }
        })
        .collect())
}

/// Restores `filename` by copying it into a **brand-new** file next to
/// `live_db_path` (never into `live_db_path` itself). Order of operations,
/// each a real safety gate:
/// 1. The chosen backup must open as a valid Vault Spend database and
///    survive a sanity read (`list_accounts`) — a corrupt/truncated
///    backup file is rejected before anything live is touched.
/// 2. The *current* live data is snapshotted first (via `create_backup`),
///    so restoring is itself reversible.
/// 3. The backup's content is copied into a freshly-named file (verified
///    against the source, with a couple of retries for transient write
///    interference — the same defense as `create_backup`).
///
/// Writing into `live_db_path` directly was the original design, and it
/// reliably produced a silently-empty database in real end-to-end testing
/// — `live_db_path` is a file the running app's own connection already
/// has open, and SQLite's online backup API explicitly documents the
/// *destination* of a backup as unsafe to touch from anywhere else while
/// the copy is in progress (see the `backup` module's own doc comment).
/// `create_backup`'s destinations never have this problem (always a
/// brand-new filename), which is why only this direction needed
/// reworking. The caller is responsible for pointing `config.json` at the
/// returned path (same as `relocate_data_file`) and telling the user to
/// restart — this function never touches the running connection.
pub fn restore_backup(store: &Store, backups_dir: &Path, filename: &str, live_db_path: &Path) -> Result<PathBuf, String> {
    let backup_path = backups_dir.join(filename);
    if !backup_path.exists() {
        return Err(format!("backup \"{filename}\" not found"));
    }

    let today = chrono::Local::now().date_naive();
    let source = Store::open(&backup_path).map_err(|e| e.to_string())?;
    source.list_accounts(today).map_err(|e| e.to_string())?;

    let restored_dir = live_db_path.parent().unwrap_or(Path::new("."));
    let mut restored_path;
    let mut n = 1;
    loop {
        let suffix = if n == 1 { String::new() } else { format!("-{n}") };
        restored_path = restored_dir.join(format!("vaultspend-restored-{}{suffix}.db", chrono::Local::now().format("%Y%m%d-%H%M%S")));
        if !restored_path.exists() {
            break;
        }
        n += 1;
    }

    // Extract the chosen backup's data into its own file *before* taking
    // the live database's own safety snapshot below. That snapshot's
    // retention pruning (see `create_backup` -> `prune_to_disk`) can
    // delete the oldest backup on disk — and if `backup_path` (the file
    // being restored *from*) happens to be that oldest one, re-opening it
    // afterward would silently hand back a fresh, empty database instead
    // of erroring (see `verify_backup`'s doc comment), and this function
    // would report a successful restore of nothing. Finishing the actual
    // extraction — reading `source` into `restored_path` — before pruning
    // ever runs means `backup_path`'s later fate can't affect this restore.
    const MAX_ATTEMPTS: u32 = 3;
    let mut last_error = String::new();
    let mut restored = false;
    for attempt in 1..=MAX_ATTEMPTS {
        let _ = std::fs::remove_file(&restored_path);
        source.backup_to(&restored_path).map_err(|e| e.to_string())?;
        match verify_backup(&source, &restored_path) {
            Ok(()) => {
                restored = true;
                break;
            }
            Err(e) => {
                last_error = e;
                if attempt < MAX_ATTEMPTS {
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
            }
        }
    }
    if !restored {
        let _ = std::fs::remove_file(&restored_path);
        return Err(format!("restore did not verify after {MAX_ATTEMPTS} attempts: {last_error}"));
    }

    // Now that the restore itself is durably complete, snapshot the
    // current live data too — so switching to `restored_path` is itself
    // reversible. A failure here fails the whole operation (the "restore
    // is reversible" guarantee wasn't met), but `restored_path` is left
    // in place rather than deleted: it's valid, verified data, and
    // discarding it on top of a failed safety-backup would be strictly
    // worse for the user.
    create_backup(store, backups_dir, chrono::Local::now().naive_local())?;

    Ok(restored_path)
}

/// Where backups for a given live database path live — a `backups`
/// subfolder right next to it, so they follow a relocated data file too.
pub fn backups_dir_for(live_db_path: &Path) -> PathBuf {
    live_db_path
        .parent()
        .map(|p| p.join("backups"))
        .unwrap_or_else(|| PathBuf::from("backups"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use budget_core::models::AccountType;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-backups-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap()
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
        let store = Store::open(dir.join("live.db")).unwrap();
        store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        let backups_dir = dir.join("backups");

        let filename = create_backup(&store, &backups_dir, dt("2026-08-30 12:00:00")).unwrap();

        assert_eq!(filename, "vaultspend-20260830-120000.db");
        assert!(backups_dir.join(&filename).exists());
        let listed = list_backups(&backups_dir).unwrap();
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
        let store = Store::open(dir.join("live.db")).unwrap();
        store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        let backups_dir = dir.join("backups");
        let same_instant = dt("2026-08-30 19:41:25");

        let first = create_backup(&store, &backups_dir, same_instant).unwrap();
        let second = create_backup(&store, &backups_dir, same_instant).unwrap();

        assert_ne!(first, second, "two backups computed for the same second must not collide");
        assert!(backups_dir.join(&first).exists(), "the first backup must survive the second call");
        assert!(backups_dir.join(&second).exists());

        let listed = list_backups(&backups_dir).unwrap();
        assert_eq!(listed[0].filename, second, "the second (later-created) backup must sort first (newest)");
        assert_eq!(listed[1].filename, first);
    }

    #[test]
    fn create_backup_prunes_beyond_the_retention_limit() {
        let dir = temp_dir("prune-disk");
        let store = Store::open(dir.join("live.db")).unwrap();
        let backups_dir = dir.join("backups");
        std::fs::create_dir_all(&backups_dir).unwrap();
        // Pre-seed 15 fake backups (the retention limit) with distinct
        // timestamps, all older than the one about to be created.
        for i in 0..15 {
            let name = format!("vaultspend-202601{:02}-000000.db", i + 1);
            std::fs::write(backups_dir.join(name), b"fake").unwrap();
        }

        create_backup(&store, &backups_dir, dt("2026-08-30 12:00:00")).unwrap();

        let listed = list_backups(&backups_dir).unwrap();
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
        let store = Store::open(dir.join("live.db")).unwrap();
        let backups_dir = dir.join("backups");

        let first = create_backup_if_due(&store, &backups_dir, dt("2026-08-30 06:00:00")).unwrap();
        let second = create_backup_if_due(&store, &backups_dir, dt("2026-08-30 12:00:00")).unwrap();

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
        let filename = create_backup(&store, &backups_dir, dt("2026-08-30 12:00:00")).unwrap();

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
        let restored_path = restore_backup(&store, &backups_dir, &filename, &live_path).unwrap();
        assert_eq!(store.all_transactions().unwrap().len(), 2, "live_path must be untouched by restore");

        let restored = Store::open(&restored_path).unwrap();
        let transactions = restored.all_transactions().unwrap();
        assert_eq!(transactions.len(), 1, "expected only the pre-backup transaction in the restored file");
        assert_eq!(transactions[0].transaction.description, "Original");
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
        let oldest = create_backup(&store, &backups_dir, dt("2026-08-01 00:00:00")).unwrap();
        for day in 2..=DEFAULT_KEEP {
            create_backup(&store, &backups_dir, dt(&format!("2026-08-{day:02} 00:00:00"))).unwrap();
        }
        assert_eq!(list_backups(&backups_dir).unwrap().len(), DEFAULT_KEEP);

        let restored_path = restore_backup(&store, &backups_dir, &oldest, &live_path).unwrap();

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

        let result = restore_backup(&store, &backups_dir, "vaultspend-20260101-000000.db", &live_path);

        assert!(result.is_err());
    }
}
