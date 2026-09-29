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
pub fn list_leftovers(source_db_path: &Path, mirror_dir: Option<&Path>) -> Vec<LeftoverEntry> {
    let mut out = Vec::new();
    if source_db_path.exists() {
        out.push(entry(source_db_path, LeftoverKind::OriginalDatabase));
    }
    let plaintext_backups_dir = crate::backups::backups_dir_for(source_db_path, false);
    collect_plaintext_dbs(&plaintext_backups_dir, LeftoverKind::PlaintextBackup, &mut out);
    if let Some(mirror_dir) = mirror_dir {
        collect_plaintext_dbs(mirror_dir, LeftoverKind::MirroredPlaintextBackup, &mut out);
    }
    out
}

fn collect_plaintext_dbs(dir: &Path, kind: LeftoverKind, out: &mut Vec<LeftoverEntry>) {
    let Ok(read_dir) = std::fs::read_dir(dir) else { return };
    for item in read_dir.flatten() {
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
        let has_key = budget_core::protection::keyfile::key_file_path_for(&path).exists();
        if name_matches && !has_key {
            out.push(entry(&path, kind));
        }
    }
}

fn entry(path: &Path, kind: LeftoverKind) -> LeftoverEntry {
    LeftoverEntry { path: path.display().to_string(), kind, size_bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) }
}

/// Deletes exactly the given paths. Refuses (without erroring the whole call) anything that is not
/// a plain file, that matches `live_db_path` (the one thing this must never delete regardless of
/// what a caller passes), or that isn't in a freshly re-derived `list_leftovers(source_db_path,
/// mirror_dir)` — never trusting the caller's own list of paths at face value, since the frontend
/// only round-trips whatever `list_protection_leftovers` last returned it, and a second backup
/// folder can be shared with another profile (or another program). Returns the paths that could not
/// be deleted, for the UI to report.
pub fn delete_leftovers(paths: &[String], source_db_path: &Path, mirror_dir: Option<&Path>, live_db_path: &Path) -> Result<Vec<String>, String> {
    let authoritative: std::collections::HashSet<String> = list_leftovers(source_db_path, mirror_dir).into_iter().map(|e| e.path).collect();
    let mut failed = Vec::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        if !authoritative.contains(raw) || path.is_dir() || path == live_db_path || std::fs::remove_file(&path).is_err() {
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
        backups::create_backup(&store, &db_path, &backups_dir, None, chrono::NaiveDate::from_ymd_opt(2026, 9, 21).unwrap().and_hms_opt(9, 0, 0).unwrap()).unwrap();

        let leftovers = list_leftovers(&db_path, None);

        assert!(leftovers.iter().any(|l| l.kind == LeftoverKind::OriginalDatabase && l.path == db_path.display().to_string()));
        assert!(leftovers.iter().any(|l| l.kind == LeftoverKind::PlaintextBackup));
    }

    #[test]
    fn a_missing_original_is_simply_not_listed_rather_than_an_error() {
        let dir = temp_dir("gone");

        let leftovers = list_leftovers(&dir.join("vaultspend.db"), None);

        assert!(!leftovers.iter().any(|l| l.kind == LeftoverKind::OriginalDatabase));
    }

    #[test]
    fn a_named_mirror_folder_lists_its_plaintext_backups_but_not_an_encrypted_one() {
        let dir = temp_dir("mirror");
        let mirror = dir.join("mirror");
        std::fs::create_dir_all(&mirror).unwrap();
        std::fs::write(mirror.join("vaultspend-20260918-090000.db"), b"plain").unwrap();
        std::fs::write(mirror.join("vaultspend-20260919-090000.db"), b"enc").unwrap();
        std::fs::write(
            budget_core::protection::keyfile::key_file_path_for(&mirror.join("vaultspend-20260919-090000.db")),
            b"{}",
        )
        .unwrap();

        let leftovers = list_leftovers(&dir.join("vaultspend.db"), Some(&mirror));

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
        std::fs::write(mirror.join("vaultspend-20260918-090000.db"), b"ours").unwrap();
        std::fs::write(mirror.join("some-other-app-export.db"), b"not ours").unwrap();
        std::fs::write(mirror.join("holiday-photos.zip"), b"definitely not ours").unwrap();

        let leftovers = list_leftovers(&dir.join("vaultspend.db"), Some(&mirror));

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
        std::fs::write(&source_db_path, b"the original plaintext database").unwrap();
        let plaintext_backups_dir = backups::backups_dir_for(&source_db_path, false);
        std::fs::create_dir_all(&plaintext_backups_dir).unwrap();
        let leftover = plaintext_backups_dir.join("vaultspend-20260918-090000.db");
        std::fs::write(&leftover, b"stuff").unwrap();
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
}
