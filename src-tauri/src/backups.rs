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

/// What `create_backup_full` did: the backup itself, and what happened to
/// the optional second copy (see `mirror_backup`).
pub struct BackupOutcome {
    pub filename: String,
    /// Where the second copy landed, when one was made.
    pub copied_to: Option<PathBuf>,
    /// Why the second copy failed, when it was attempted and did not work.
    /// A failed second copy never fails the backup itself.
    pub copy_error: Option<String>,
}

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
    if !name_is_taken(&base) {
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
        if !name_is_taken(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// A backup name is taken by a database *or* by a leftover key file: publication refuses to
/// replace either, and an orphan key from an interrupted publication must not capture the name.
fn name_is_taken(db_path: &Path) -> bool {
    db_path.exists() || budget_core::protection::keyfile::key_file_path_for(db_path).exists()
}

/// A disambiguating `_N` suffix (see `unique_backup_path`) may follow the
/// fixed-width `YYYYMMDD-HHMMSS` (15 characters) timestamp — only that
/// leading slice is parsed, so a disambiguated filename still yields a
/// usable (if identical-to-the-second) display timestamp.
fn parse_backup_timestamp(filename: &str) -> Option<NaiveDateTime> {
    let stem = filename
        .strip_prefix(BACKUP_PREFIX)
        .or_else(|| filename.strip_prefix("pre-historical-moves-"))?
        .strip_suffix(BACKUP_SUFFIX)?;
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

/// Whether `name` is shaped like one of ours (`vaultspend-YYYYMMDD-HHMMSS[_N].db`) — the same test
/// `list_backup_filenames`/`prune_to_disk` already use to decide what a backups folder or a second
/// copy folder is allowed to touch, exposed so other modules that scan those same folders (e.g.
/// `protection::leftovers`) can apply the identical "only files named like ours" rule rather than a
/// looser one of their own.
pub(crate) fn is_our_backup_filename(name: &str) -> bool {
    (name.starts_with(BACKUP_PREFIX) || is_pre_migration_backup(name)) && name.ends_with(BACKUP_SUFFIX)
}

fn is_pre_migration_backup(name: &str) -> bool {
    name.starts_with("pre-historical-moves-") && name.ends_with(".db")
}

fn list_backup_filenames(backups_dir: &Path) -> std::io::Result<Vec<String>> {
    if !backups_dir.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for entry in std::fs::read_dir(backups_dir)? {
        let name = entry?.file_name();
        if let Some(name) = name.to_str() {
            if is_our_backup_filename(name) && !is_pre_migration_backup(name) {
                result.push(name.to_string());
            }
        }
    }
    Ok(result)
}

/// Staging files never match `list_backup_filenames` (they don't start with `vaultspend-`), so a
/// half-written copy can never be listed, pruned around, or restored as a backup.
const STAGING_PREFIX: &str = ".vaultspend-backup-";
const STAGING_SUFFIX: &str = ".partial";

/// A unique staging path inside `dir` (the destination folder, so the publishing rename never
/// crosses a filesystem), outside the recognized backup filename pattern.
fn staging_path(dir: &Path) -> PathBuf {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    dir.join(format!("{STAGING_PREFIX}{}-{nanos}-{n}{STAGING_SUFFIX}", std::process::id()))
}

/// Removes this operation's own staging artifacts: the staged database, its staged key, and any
/// SQLite sidecar a verifying open may have left. Never touches anything else.
fn remove_staged(staged_db: &Path) {
    let _ = std::fs::remove_file(budget_core::protection::keyfile::key_file_path_for(staged_db));
    for suffix in ["", "-journal", "-wal", "-shm"] {
        let mut name = staged_db.as_os_str().to_os_string();
        name.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(name));
    }
}

/// Best-effort flush of a finished file to stable storage before it is renamed into place. Errors
/// are ignored: a flush is defence in depth, and the rename below is what makes a backup visible.
fn flush_to_disk(path: &Path) {
    if let Ok(file) = std::fs::OpenOptions::new().write(true).open(path) {
        let _ = file.sync_all();
    }
}

/// Publishes a finished, verified, closed staged backup as `final_db`. The key (when there is
/// one) goes first and the database last, so a listed `.db` always has its key; a crash between
/// the two renames leaves only an orphan key, which nothing lists. Never replaces an existing
/// database or key file. Two renames are not one atomic transaction, and the flush is best-effort:
/// this defends against the process dying, not against every power failure.
fn publish_staged_backup(staged_db: &Path, final_db: &Path) -> Result<(), String> {
    publish_with_checkpoints(staged_db, final_db, "backup_after_key_publication", "backup_after_database_publication")
}

fn publish_with_checkpoints(staged_db: &Path, final_db: &Path, after_key: &str, after_database: &str) -> Result<(), String> {
    let staged_key = budget_core::protection::keyfile::key_file_path_for(staged_db);
    let final_key = budget_core::protection::keyfile::key_file_path_for(final_db);
    if final_db.exists() || final_key.exists() {
        return Err(format!("{} already exists, so the new backup was not saved over it", final_db.display()));
    }
    let has_key = staged_key.exists();
    flush_to_disk(staged_db);
    if has_key {
        flush_to_disk(&staged_key);
        std::fs::rename(&staged_key, &final_key).map_err(|e| format!("couldn't publish the backup's key file: {e}"))?;
    }
    crate::protection::transition::debug_failpoint(after_key);
    if let Err(e) = std::fs::rename(staged_db, final_db) {
        if has_key {
            let _ = std::fs::remove_file(&final_key);
        }
        return Err(format!("couldn't publish the backup: {e}"));
    }
    crate::protection::transition::debug_failpoint(after_database);
    Ok(())
}

/// Whether two files hold exactly the same bytes, streamed so a large database is never held whole.
fn files_identical(a: &Path, b: &Path) -> std::io::Result<bool> {
    use std::io::Read;
    if std::fs::metadata(a)?.len() != std::fs::metadata(b)?.len() {
        return Ok(false);
    }
    let (mut fa, mut fb) = (
        std::io::BufReader::new(std::fs::File::open(a)?),
        std::io::BufReader::new(std::fs::File::open(b)?),
    );
    let (mut ba, mut bb) = (vec![0u8; 64 * 1024], vec![0u8; 64 * 1024]);
    loop {
        let n = fa.read(&mut ba)?;
        if n == 0 {
            return Ok(true);
        }
        fb.read_exact(&mut bb[..n])?;
        if ba[..n] != bb[..n] {
            return Ok(false);
        }
    }
}

fn prune_to_disk(backups_dir: &Path, keep: usize) -> Result<(), String> {
    let existing = list_backup_filenames(backups_dir).map_err(|e| e.to_string())?;
    for filename in prune_backups(existing, keep) {
        // Best-effort: a backup that fails to delete (e.g. briefly locked
        // by antivirus scanning) just means one extra file survives past
        // the retention target, not a functional failure worth surfacing.
        let path = backups_dir.join(filename);
        let _ = std::fs::remove_file(budget_core::protection::keyfile::key_file_path_for(&path));
        let _ = std::fs::remove_file(path);
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

    let key = match source.db_key_bytes() {
        Some(bytes) => budget_core::store::DatabaseKey::Raw(bytes),
        None => budget_core::store::DatabaseKey::Plaintext,
    };
    let backup = Store::open_with_key(dest_path, key).map_err(|e| e.to_string())?;
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
pub fn create_backup(
    store: &Store,
    source_db_path: &Path,
    backups_dir: &Path,
    copy_dir: Option<&Path>,
    now: NaiveDateTime,
) -> Result<String, String> {
    let outcome = create_backup_full(store, source_db_path, backups_dir, copy_dir, now)?;
    if let Some(error) = &outcome.copy_error {
        eprintln!("second backup copy failed (the backup itself succeeded): {error}");
    }
    Ok(outcome.filename)
}

/// Whether two paths name the same folder — canonical paths when both
/// exist, otherwise a plain comparison (a folder that doesn't exist yet
/// can't be the one backups already live in).
fn same_folder(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// Checks `copy_dir` can serve as the second backup folder: not the folder
/// backups already live in, already there (a mistyped path must not quietly
/// make a new folder somewhere unintended — the person creates it, or picks
/// one with Browse), and writable (proved by writing and removing a probe
/// file, since a read-only or unplugged drive otherwise only shows up at the
/// next backup).
pub fn check_copy_dir(backups_dir: &Path, copy_dir: &Path) -> Result<(), String> {
    if same_folder(backups_dir, copy_dir) {
        return Err("choose a different folder than the one your backups are already kept in".to_string());
    }
    if !copy_dir.exists() {
        return Err(format!(
            "{} doesn't exist. Create the folder first, or use Browse… to pick one that does.",
            copy_dir.display()
        ));
    }
    if !copy_dir.is_dir() {
        return Err(format!("{} isn't a folder.", copy_dir.display()));
    }
    let probe = copy_dir.join(".vaultspend-write-test");
    std::fs::write(&probe, b"ok").map_err(|e| format!("couldn't write to {}: {e}", copy_dir.display()))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// Copies the backup `filename` from `backups_dir` into `copy_dir` (staged, proven identical byte
/// for byte, then published — never over an existing file of the same name unless that file already
/// is the identical copy), and trims `copy_dir` to the newest `DEFAULT_KEEP` backups (only files
/// named like ours — anything else in the folder is never touched). Returns the copy's path.
pub fn mirror_backup(backups_dir: &Path, filename: &str, copy_dir: &Path) -> Result<PathBuf, String> {
    check_copy_dir(backups_dir, copy_dir)?;
    let source = backups_dir.join(filename);
    let dest = copy_dir.join(filename);
    let source_key = budget_core::protection::keyfile::key_file_path_for(&source);

    // Already there, byte for byte (e.g. the same folder chosen again): nothing to publish.
    if dest.exists() && files_identical(&source, &dest).unwrap_or(false) {
        let dest_key = budget_core::protection::keyfile::key_file_path_for(&dest);
        let key_matches = !source_key.exists() || (dest_key.exists() && files_identical(&source_key, &dest_key).unwrap_or(false));
        if key_matches {
            prune_to_disk(copy_dir, DEFAULT_KEEP)?;
            return Ok(dest);
        }
    }

    // Stage an exact copy of the already verified local files inside the destination folder, prove
    // it byte for byte, and only then publish it: an unplugged drive or a kill mid-copy leaves
    // nothing that lists as a backup, and an existing file of the same name is never replaced.
    let staged = staging_path(copy_dir);
    let staged_key = budget_core::protection::keyfile::key_file_path_for(&staged);
    let stage = || -> Result<(), String> {
        std::fs::copy(&source, &staged).map_err(|e| format!("couldn't copy to {}: {e}", dest.display()))?;
        if source_key.exists() {
            std::fs::copy(&source_key, &staged_key).map_err(|e| format!("couldn't mirror the backup's key file: {e}"))?;
        }
        let same_db = files_identical(&source, &staged).map_err(|e| e.to_string())?;
        let same_key = !source_key.exists() || files_identical(&source_key, &staged_key).map_err(|e| e.to_string())?;
        if !(same_db && same_key) {
            return Err(format!("the copy in {} did not match the backup it was made from", copy_dir.display()));
        }
        Ok(())
    };
    if let Err(e) = stage() {
        remove_staged(&staged);
        return Err(e);
    }
    crate::protection::transition::debug_failpoint("mirror_after_staged_copy");
    if let Err(e) = publish_with_checkpoints(&staged, &dest, "mirror_after_key_publication", "mirror_after_database_publication") {
        remove_staged(&staged);
        return Err(e);
    }
    prune_to_disk(copy_dir, DEFAULT_KEEP)?;
    Ok(dest)
}

/// `create_backup`, plus the optional second copy: when `copy_dir` is
/// given, the fresh backup is also mirrored there. A second copy that
/// fails is reported in the outcome rather than failing the backup — the
/// local one is still good.
pub fn create_backup_full(
    store: &Store,
    source_db_path: &Path,
    backups_dir: &Path,
    copy_dir: Option<&Path>,
    now: NaiveDateTime,
) -> Result<BackupOutcome, String> {
    let filename = create_local_backup(store, source_db_path, backups_dir, now)?;
    let mut copied_to = None;
    let mut copy_error = None;
    if let Some(dir) = copy_dir {
        match mirror_backup(backups_dir, &filename, dir) {
            Ok(path) => copied_to = Some(path),
            Err(e) => copy_error = Some(e),
        }
    }
    Ok(BackupOutcome {
        filename,
        copied_to,
        copy_error,
    })
}

fn create_local_backup(store: &Store, source_db_path: &Path, backups_dir: &Path, now: NaiveDateTime) -> Result<String, String> {
    std::fs::create_dir_all(backups_dir).map_err(|e| e.to_string())?;
    let final_path = unique_backup_path(backups_dir, now);
    let filename = final_path.file_name().expect("just built from a filename").to_string_lossy().to_string();

    // Build and verify the snapshot under a staging name no listing recognizes, and publish it only
    // once it is complete (see `publish_staged_backup`): an error or a kill at any earlier point can
    // never leave something that lists as a backup.
    let staged = staging_path(backups_dir);
    let staged_key = budget_core::protection::keyfile::key_file_path_for(&staged);

    const MAX_ATTEMPTS: u32 = 3;
    let mut last_error = String::new();
    for attempt in 1..=MAX_ATTEMPTS {
        remove_staged(&staged);
        if let Err(e) = store.backup_to(&staged) {
            remove_staged(&staged);
            return Err(e.to_string());
        }
        if store.is_encrypted() {
            let source_key_path = budget_core::protection::keyfile::key_file_path_for(source_db_path);
            if let Err(e) = std::fs::copy(&source_key_path, &staged_key) {
                remove_staged(&staged);
                return Err(format!("couldn't write the backup's key file: {e}"));
            }
        }
        crate::protection::transition::debug_failpoint("backup_after_staged_copy");
        match verify_backup(store, &staged) {
            Ok(()) => {
                crate::protection::transition::debug_failpoint("backup_after_verification");
                if let Err(e) = publish_staged_backup(&staged, &final_path) {
                    remove_staged(&staged);
                    return Err(e);
                }
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
    remove_staged(&staged);
    Err(format!("backup did not verify after {MAX_ATTEMPTS} attempts: {last_error}"))
}

/// Creates a backup only if the newest existing one is more than 24h old
/// (or none exist yet) — the launch-time automatic check, distinct from
/// the always-runs manual "Back up now" button.
pub fn create_backup_if_due(
    store: &Store,
    source_db_path: &Path,
    backups_dir: &Path,
    copy_dir: Option<&Path>,
    now: NaiveDateTime,
) -> Result<Option<String>, String> {
    std::fs::create_dir_all(backups_dir).map_err(|e| e.to_string())?;
    let existing = list_backup_filenames(backups_dir).map_err(|e| e.to_string())?;
    if should_create_backup(&existing, now, AUTO_BACKUP_INTERVAL_HOURS) {
        Ok(Some(create_backup(store, source_db_path, backups_dir, copy_dir, now)?))
    } else {
        Ok(None)
    }
}

/// Every backup on disk, newest first, with its display timestamp (parsed
/// from the filename, not filesystem metadata — stable even if the file
/// was copied/moved and its mtime changed) and size.
pub fn list_backups(backups_dir: &Path, is_encrypted: bool) -> Result<Vec<BackupInfo>, String> {
    let mut filenames = list_backup_filenames(backups_dir).map_err(|e| e.to_string())?;
    // Keep upgrade safety copies visible/restorable but outside ordinary retention pruning.
    if backups_dir.exists() {
        for entry in std::fs::read_dir(backups_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.path().is_file() && is_pre_migration_backup(&name) {
                filenames.push(name);
            }
        }
    }
    if is_encrypted {
        filenames.retain(|f| budget_core::protection::keyfile::key_file_path_for(&backups_dir.join(f)).exists());
    }
    filenames.sort();
    filenames.reverse();
    Ok(filenames
        .into_iter()
        .map(|filename| {
            let path = backups_dir.join(&filename);
            let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let created_at = parse_backup_timestamp(&filename)
                .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_else(|| {
                    if is_pre_migration_backup(&filename) {
                        "Safety copy before update".into()
                    } else {
                        filename.clone()
                    }
                });
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
pub fn restore_backup(store: &Store, backups_dir: &Path, copy_dir: Option<&Path>, filename: &str, live_db_path: &Path) -> Result<PathBuf, String> {
    restore_backup_with_key(
        store,
        backups_dir,
        copy_dir,
        filename,
        live_db_path,
        budget_core::store::DatabaseKey::Plaintext,
    )
}

/// Key-aware restore used for protected profiles. `source_key` belongs to the selected backup,
/// which can differ from the live store's key after a password change.
pub fn restore_backup_with_key(
    store: &Store,
    backups_dir: &Path,
    copy_dir: Option<&Path>,
    filename: &str,
    live_db_path: &Path,
    source_key: budget_core::store::DatabaseKey<'_>,
) -> Result<PathBuf, String> {
    if Path::new(filename).file_name().and_then(|n| n.to_str()) != Some(filename) || !is_our_backup_filename(filename) {
        return Err("Choose a listed backup filename.".into());
    }
    let backup_path = backups_dir.join(filename);
    if !backup_path.exists() {
        return Err(format!("backup \"{filename}\" not found"));
    }

    // A zero-byte file would otherwise open "successfully": `Store::open` heals it into a valid but
    // empty database, and restoring that would silently replace the person's data with nothing.
    if std::fs::metadata(&backup_path).map_err(|e| e.to_string())?.len() == 0 {
        return Err(format!("backup \"{filename}\" is empty or damaged and can't be restored"));
    }

    let today = chrono::Local::now().date_naive();
    // Opening a Store runs migrations. Preserve an upgrade safety copy in its original format
    // by migrating only an owned working copy, never the recovery source itself.
    let working = if is_pre_migration_backup(filename) {
        Some(MigrationRestoreSource::create(&backup_path)?)
    } else {
        None
    };
    let source_path = working.as_ref().map(|w| w.path.as_path()).unwrap_or(&backup_path);
    let source = Store::open_with_key(source_path, source_key).map_err(|e| e.to_string())?;
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
    create_backup(store, live_db_path, backups_dir, copy_dir, chrono::Local::now().naive_local())?;

    Ok(restored_path)
}

/// Where backups for a given live database path live — a `backups` subfolder right next to it (so
/// they follow a relocated data file too), split further into `backups/protected/` for an
/// encrypted profile so a converted backup can keep its original filename without colliding with
/// the plaintext original sitting in the plain `backups/` folder (Phase C, Task 5).
pub fn backups_dir_for(live_db_path: &Path, is_encrypted: bool) -> PathBuf {
    let base = live_db_path
        .parent()
        .map(|p| p.join("backups"))
        .unwrap_or_else(|| PathBuf::from("backups"));
    if is_encrypted {
        base.join("protected")
    } else {
        base
    }
}

struct MigrationRestoreSource {
    directory: PathBuf,
    path: PathBuf,
}

impl MigrationRestoreSource {
    fn create(source: &Path) -> Result<Self, String> {
        // Published safety snapshots are closed databases. Refuse an externally opened/modified
        // source with journal data rather than copying a main file without its pending writes.
        for suffix in ["-wal", "-journal"] {
            let sidecar = PathBuf::from(format!("{}{suffix}", source.display()));
            if std::fs::metadata(sidecar).is_ok_and(|m| m.len() > 0) {
                return Err("The upgrade safety copy is in use. Close it before restoring.".into());
            }
        }
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let directory = source
            .parent()
            .unwrap_or(Path::new("."))
            .join(format!(".historical-restore-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&directory).map_err(|e| e.to_string())?;
        let working = Self {
            path: directory.join("source.db"),
            directory,
        };
        // Written before any financial bytes, so a killed restore remains discoverable by the
        // explicit plaintext-leftover cleanup after a later protection conversion.
        std::fs::write(working.directory.join(".vaultspend-restore-owner"), b"historical-restore-v1").map_err(|e| e.to_string())?;
        std::fs::copy(source, &working.path).map_err(|e| e.to_string())?;
        if !files_identical(source, &working.path).map_err(|e| e.to_string())? {
            return Err("The restore working copy did not match the safety copy.".into());
        }
        let source_key = budget_core::protection::keyfile::key_file_path_for(source);
        if source_key.exists() {
            std::fs::copy(source_key, budget_core::protection::keyfile::key_file_path_for(&working.path)).map_err(|e| e.to_string())?;
        }
        Ok(working)
    }
}

impl Drop for MigrationRestoreSource {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

#[cfg(test)]
mod tests;
