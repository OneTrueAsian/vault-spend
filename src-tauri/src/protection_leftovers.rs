//! What a conversion to password protection leaves behind: the original plaintext database, its
//! plaintext backups, and (if the person separately agrees) any mirrored copies of them. Read-only
//! listing plus an explicit, bounded delete — never a general file-delete endpoint.
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct LeftoverEntry {
    pub path: String,
    pub kind: LeftoverKind,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LeftoverKind {
    OriginalDatabase,
    PlaintextBackup,
    MirroredPlaintextBackup,
}

/// Every leftover a conversion to password protection may have left behind for `source_db_path`
/// (the plaintext file the profile used to live at): the original database itself if it still
/// exists, its own plaintext backups, and — if a second backup folder is configured — that folder's
/// plaintext backups too.
pub fn list_leftovers(source_db_path: &Path, mirror_dir: Option<&Path>) -> Result<Vec<LeftoverEntry>, String> {
    let mut out = Vec::new();
    if let Some(entry) = plaintext_entry(source_db_path, LeftoverKind::OriginalDatabase)? {
        out.push(entry);
    }
    let plaintext_backups_dir = crate::backups::backups_dir_for(source_db_path, false);
    collect_plaintext_dbs(&plaintext_backups_dir, LeftoverKind::PlaintextBackup, false, &mut out)?;
    if let Some(mirror_dir) = mirror_dir {
        collect_plaintext_dbs(mirror_dir, LeftoverKind::MirroredPlaintextBackup, true, &mut out)?;
    }
    Ok(out)
}

fn discovery_error(path: &Path, error: std::io::Error) -> String {
    format!("Couldn't check plaintext copies at {}: {error}", path.display())
}

fn collect_plaintext_dbs(dir: &Path, kind: LeftoverKind, required: bool, out: &mut Vec<LeftoverEntry>) -> Result<(), String> {
    let read_dir = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if !required && error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(discovery_error(dir, error)),
    };
    for item in read_dir {
        let item = item.map_err(|error| discovery_error(dir, error))?;
        let path = item.path();
        // Named like one of our own backups, not just "any .db file here" — a mirror/second-backup
        // folder is a shared, user-chosen location, and nothing stops another profile (or another
        // program entirely) from also using it. `mirror_backup` already applies this same "only
        // files named like ours" rule when writing there; listing (and, through it, deletion) must
        // apply it too.
        let name_matches = path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(crate::backups::is_our_backup_filename);
        if name_matches {
            if let Some(entry) = plaintext_entry(&path, kind)? {
                out.push(entry);
            }
        }
    }
    Ok(())
}

/// Never offer directories/symlinks, keyed pairs or non-plaintext headers.
/// Inspection failures are unknown inventory, not proof that no copies exist.
fn plaintext_entry(path: &Path, kind: LeftoverKind) -> Result<Option<LeftoverEntry>, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(discovery_error(path, error)),
    };
    if !metadata.file_type().is_file() {
        return Ok(None);
    }
    let key = budget_core::protection::keyfile::key_file_path_for(path);
    match std::fs::symlink_metadata(&key) {
        Ok(_) => return Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(discovery_error(&key, error)),
    }
    if budget_core::store::file_looks_encrypted(path).map_err(|error| discovery_error(path, error))? {
        return Ok(None);
    }
    Ok(Some(LeftoverEntry {
        path: path.display().to_string(),
        kind,
        size_bytes: metadata.len(),
    }))
}

/// Deletes exactly the given paths. Refuses (without erroring the whole call) anything that is not
/// a plain file, that matches `live_db_path` (the one thing this must never delete regardless of
/// what a caller passes), or that isn't in a freshly re-derived `list_leftovers(source_db_path,
/// mirror_dir)` — never trusting the caller's own list of paths at face value, since the frontend
/// only round-trips whatever `list_protection_leftovers` last returned it, and a second backup
/// folder can be shared with another profile (or another program). Returns the paths that could not
/// be deleted, for the UI to report.
pub fn delete_leftovers(paths: &[String], source_db_path: &Path, mirror_dir: Option<&Path>, live_db_path: &Path) -> Result<Vec<String>, String> {
    let authoritative: std::collections::HashSet<String> = list_leftovers(source_db_path, mirror_dir)?.into_iter().map(|e| e.path).collect();
    let live_canonical = std::fs::canonicalize(live_db_path).ok();
    let mut failed = Vec::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        let is_live = path == live_db_path
            || live_canonical
                .as_ref()
                .is_some_and(|live| std::fs::canonicalize(&path).ok().as_ref() == Some(live));
        if !authoritative.contains(raw)
            || is_live
            || !matches!(plaintext_entry(&path, LeftoverKind::OriginalDatabase), Ok(Some(_)))
            || std::fs::remove_file(&path).is_err()
        {
            failed.push(raw.clone());
        }
    }
    Ok(failed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backups;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-leftovers-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_original_database_and_its_plaintext_backups_are_listed() {
        let dir = temp_dir("basic");
        let db_path = dir.join("vaultspend.db");
        let store = budget_core::store::Store::open(&db_path).unwrap();
        let backups_dir = backups::backups_dir_for(&db_path, false);
        backups::create_backup(
            &store,
            &db_path,
            &backups_dir,
            None,
            chrono::NaiveDate::from_ymd_opt(2026, 9, 21).unwrap().and_hms_opt(9, 0, 0).unwrap(),
        )
        .unwrap();

        let leftovers = list_leftovers(&db_path, None).unwrap();

        assert!(leftovers
            .iter()
            .any(|l| l.kind == LeftoverKind::OriginalDatabase && l.path == db_path.display().to_string()));
        assert!(leftovers.iter().any(|l| l.kind == LeftoverKind::PlaintextBackup));
    }

    #[test]
    fn a_missing_original_is_simply_not_listed_rather_than_an_error() {
        let dir = temp_dir("gone");

        let leftovers = list_leftovers(&dir.join("vaultspend.db"), None).unwrap();

        assert!(!leftovers.iter().any(|l| l.kind == LeftoverKind::OriginalDatabase));
    }

    #[test]
    fn a_named_mirror_folder_lists_its_plaintext_backups_but_not_an_encrypted_one() {
        let dir = temp_dir("mirror");
        let mirror = dir.join("mirror");
        std::fs::create_dir_all(&mirror).unwrap();
        std::fs::write(mirror.join("vaultspend-20260918-090000.db"), b"SQLite format 3\0plain").unwrap();
        std::fs::write(mirror.join("vaultspend-20260919-090000.db"), b"enc").unwrap();
        std::fs::write(
            budget_core::protection::keyfile::key_file_path_for(&mirror.join("vaultspend-20260919-090000.db")),
            b"{}",
        )
        .unwrap();

        let leftovers = list_leftovers(&dir.join("vaultspend.db"), Some(&mirror)).unwrap();

        assert!(leftovers
            .iter()
            .any(|l| l.path.ends_with("vaultspend-20260918-090000.db") && l.kind == LeftoverKind::MirroredPlaintextBackup));
        assert!(
            !leftovers.iter().any(|l| l.path.ends_with("vaultspend-20260919-090000.db")),
            "a file with a key file beside it is not a plaintext leftover"
        );
    }

    #[test]
    fn a_shared_mirror_folder_never_lists_another_profiles_plaintext_backup() {
        // Nothing stops two profiles from pointing their second backup location at the same folder
        // (a shared OneDrive/Dropbox root, say). `mirror_backup` itself is already careful to touch
        // "only files named like ours"; leftovers listing (and, through it, deletion) must be too —
        // a `.db` without a key file beside it is not necessarily THIS profile's plaintext backup.
        let dir = temp_dir("shared-mirror");
        let mirror = dir.join("mirror");
        std::fs::create_dir_all(&mirror).unwrap();
        std::fs::write(mirror.join("vaultspend-20260918-090000.db"), b"SQLite format 3\0ours").unwrap();
        std::fs::write(mirror.join("some-other-app-export.db"), b"not ours").unwrap();
        std::fs::write(mirror.join("holiday-photos.zip"), b"definitely not ours").unwrap();

        let leftovers = list_leftovers(&dir.join("vaultspend.db"), Some(&mirror)).unwrap();

        assert!(leftovers.iter().any(|l| l.path.ends_with("vaultspend-20260918-090000.db")));
        assert!(
            !leftovers.iter().any(|l| l.path.ends_with("some-other-app-export.db")),
            "a .db that isn't shaped like one of our own backups must never be offered for deletion"
        );
    }

    #[test]
    fn deleting_removes_exactly_the_named_files_and_refuses_a_directory_or_the_live_database() {
        let dir = temp_dir("delete");
        let source_db_path = dir.join("vaultspend.db");
        std::fs::write(&source_db_path, b"SQLite format 3\0the original plaintext database").unwrap();
        let plaintext_backups_dir = backups::backups_dir_for(&source_db_path, false);
        std::fs::create_dir_all(&plaintext_backups_dir).unwrap();
        let leftover = plaintext_backups_dir.join("vaultspend-20260918-090000.db");
        std::fs::write(&leftover, b"SQLite format 3\0stuff").unwrap();
        let live = dir.join("vaultspend-protected.db");
        std::fs::write(&live, b"live").unwrap();

        let failed = delete_leftovers(
            &[
                leftover.display().to_string(),
                plaintext_backups_dir.display().to_string(),
                live.display().to_string(),
            ],
            &source_db_path,
            None,
            &live,
        )
        .unwrap();

        assert!(!leftover.exists());
        assert!(plaintext_backups_dir.exists(), "a directory is refused, not recursed into");
        assert!(live.exists(), "the live database is refused even if named");
        assert_eq!(failed, vec![plaintext_backups_dir.display().to_string(), live.display().to_string()]);
    }

    #[test]
    fn deleting_refuses_a_path_that_is_not_in_a_freshly_re_derived_leftovers_list() {
        // Never trusts the caller's own path list at face value — even a caller that (correctly or
        // not) names a file this profile's own original database/backup folder don't currently
        // contain must be refused, not deleted just because it was asked for.
        let dir = temp_dir("delete-unlisted");
        let source_db_path = dir.join("vaultspend.db");
        let live = dir.join("vaultspend-protected.db");
        let unlisted = dir.join("vaultspend-20260101-000000.db");
        std::fs::write(&unlisted, b"not a known leftover").unwrap();

        let failed = delete_leftovers(&[unlisted.display().to_string()], &source_db_path, None, &live).unwrap();

        assert!(unlisted.exists(), "a path outside the freshly re-derived list must never be deleted");
        assert_eq!(failed, vec![unlisted.display().to_string()]);
    }

    #[test]
    fn unavailable_configured_mirror_fails_closed_before_any_deletion() {
        let dir = temp_dir("missing-configured-mirror");
        let source = dir.join("vaultspend.db");
        std::fs::write(&source, b"SQLite format 3\0plaintext fixture").unwrap();
        let missing = dir.join("unavailable-mirror");
        let result = delete_leftovers(&[source.display().to_string()], &source, Some(&missing), &dir.join("live.db"));
        assert!(result.is_err(), "an unavailable mirror is unknown inventory, not an empty folder");
        assert!(source.exists(), "unknown discovery must not start deletion");
    }

    #[test]
    fn an_original_with_a_key_file_is_not_offered_or_deleted() {
        let dir = temp_dir("original-key-pair");
        let source = dir.join("vaultspend.db");
        std::fs::write(&source, b"SQLite format 3\0protected-pair fixture").unwrap();
        let key = budget_core::protection::keyfile::key_file_path_for(&source);
        std::fs::write(&key, b"key fixture").unwrap();
        let failed = delete_leftovers(&[source.display().to_string()], &source, None, &dir.join("live.db")).unwrap();
        assert_eq!(failed, vec![source.display().to_string()]);
        assert!(source.exists());
        assert!(key.exists());
    }

    #[test]
    fn inspection_errors_are_not_an_empty_inventory() {
        let dir = temp_dir("mirror-not-a-directory");
        let mirror = dir.join("mirror");
        std::fs::write(&mirror, b"not a folder").unwrap();
        assert!(list_leftovers(&dir.join("missing.db"), Some(&mirror)).is_err());
        assert!(list_leftovers(&dir.join("missing.db"), None).unwrap().is_empty());
    }

    #[test]
    fn gaining_a_key_after_listing_refuses_a_stale_requested_path() {
        let dir = temp_dir("key-after-listing");
        let source = dir.join("missing.db");
        let backup_dir = crate::backups::backups_dir_for(&source, false);
        std::fs::create_dir_all(&backup_dir).unwrap();
        let backup = backup_dir.join("vaultspend-20260918-090000.db");
        std::fs::write(&backup, b"SQLite format 3\0plain fixture").unwrap();
        let paths = list_leftovers(&source, None)
            .unwrap()
            .into_iter()
            .map(|entry| entry.path)
            .collect::<Vec<_>>();
        assert_eq!(paths.len(), 1);
        std::fs::write(budget_core::protection::keyfile::key_file_path_for(&backup), b"key").unwrap();
        assert_eq!(delete_leftovers(&paths, &source, None, &dir.join("live.db")).unwrap(), paths);
        assert!(backup.exists());
    }

    #[test]
    fn non_plaintext_backup_without_a_key_is_preserved() {
        let dir = temp_dir("ciphertext-without-key");
        let source = dir.join("missing.db");
        let mirror = dir.join("mirror");
        std::fs::create_dir_all(&mirror).unwrap();
        let backup = mirror.join("vaultspend-20260918-090000.db");
        std::fs::write(&backup, b"not a SQLite plaintext header").unwrap();
        assert!(list_leftovers(&source, Some(&mirror)).unwrap().is_empty());
        let paths = vec![backup.display().to_string()];
        assert_eq!(delete_leftovers(&paths, &source, Some(&mirror), &dir.join("live.db")).unwrap(), paths);
        assert!(backup.exists());
    }

    #[test]
    fn canonical_alias_of_the_live_database_is_refused() {
        let dir = temp_dir("live-alias");
        let child = dir.join("child");
        std::fs::create_dir_all(&child).unwrap();
        let live = dir.join("live.db");
        std::fs::write(&live, b"SQLite format 3\0live fixture").unwrap();
        let alias = child.join("..").join("live.db");
        let paths = vec![alias.display().to_string()];
        assert_eq!(delete_leftovers(&paths, &alias, None, &live).unwrap(), paths);
        assert!(live.exists());
    }
}
