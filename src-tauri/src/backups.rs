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

/// Whether `name` is shaped like one of ours (`vaultspend-YYYYMMDD-HHMMSS[_N].db`) — the same test
/// `list_backup_filenames`/`prune_to_disk` already use to decide what a backups folder or a second
/// copy folder is allowed to touch, exposed so other modules that scan those same folders (e.g.
/// `protection_leftovers`) can apply the identical "only files named like ours" rule rather than a
/// looser one of their own.
pub(crate) fn is_our_backup_filename(name: &str) -> bool {
    name.starts_with(BACKUP_PREFIX) && name.ends_with(BACKUP_SUFFIX)
}

fn list_backup_filenames(backups_dir: &Path) -> std::io::Result<Vec<String>> {
    if !backups_dir.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for entry in std::fs::read_dir(backups_dir)? {
        let name = entry?.file_name();
        if let Some(name) = name.to_str() {
            if is_our_backup_filename(name) {
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
        return Err(format!("{} already exists, so the backup was not published over it", final_db.display()));
    }
    let has_key = staged_key.exists();
    flush_to_disk(staged_db);
    if has_key {
        flush_to_disk(&staged_key);
        std::fs::rename(&staged_key, &final_key).map_err(|e| format!("couldn't publish the backup's key file: {e}"))?;
    }
    crate::protection_transition::debug_failpoint(after_key);
    if let Err(e) = std::fs::rename(staged_db, final_db) {
        if has_key {
            let _ = std::fs::remove_file(&final_key);
        }
        return Err(format!("couldn't publish the backup: {e}"));
    }
    crate::protection_transition::debug_failpoint(after_database);
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
    crate::protection_transition::debug_failpoint("mirror_after_staged_copy");
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
        crate::protection_transition::debug_failpoint("backup_after_staged_copy");
        match verify_backup(store, &staged) {
            Ok(()) => {
                crate::protection_transition::debug_failpoint("backup_after_verification");
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
    let source = Store::open_with_key(&backup_path, source_key).map_err(|e| e.to_string())?;
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

#[cfg(test)]
mod tests {
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
}
