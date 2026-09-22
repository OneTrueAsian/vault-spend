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
        let is_db = path.extension().and_then(|e| e.to_str()) == Some("db");
        let has_key = budget_core::protection::keyfile::key_file_path_for(&path).exists();
        if is_db && !has_key {
            out.push(entry(&path, kind));
        }
    }
}

fn entry(path: &Path, kind: LeftoverKind) -> LeftoverEntry {
    LeftoverEntry { path: path.display().to_string(), kind, size_bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) }
}

/// Deletes exactly the given paths. Refuses (without erroring the whole call) anything that is not
/// a plain file, or that matches `live_db_path` — the one thing this must never delete regardless
/// of what a caller passes. Returns the paths that could not be deleted, for the UI to report.
pub fn delete_leftovers(paths: &[String], live_db_path: &Path) -> Result<Vec<String>, String> {
    let mut failed = Vec::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        if path.is_dir() || path == live_db_path || std::fs::remove_file(&path).is_err() {
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
        std::fs::write(mirror.join("plain-backup.db"), b"plain").unwrap();
        std::fs::write(mirror.join("enc-backup.db"), b"enc").unwrap();
        std::fs::write(budget_core::protection::keyfile::key_file_path_for(&mirror.join("enc-backup.db")), b"{}").unwrap();

        let leftovers = list_leftovers(&dir.join("vaultspend.db"), Some(&mirror));

        assert!(leftovers.iter().any(|l| l.path.ends_with("plain-backup.db") && l.kind == LeftoverKind::MirroredPlaintextBackup));
        assert!(!leftovers.iter().any(|l| l.path.ends_with("enc-backup.db")), "a file with a key file beside it is not a plaintext leftover");
    }

    #[test]
    fn deleting_removes_exactly_the_named_files_and_refuses_a_directory_or_the_live_database() {
        let dir = temp_dir("delete");
        let leftover = dir.join("old.db");
        std::fs::write(&leftover, b"stuff").unwrap();
        let live = dir.join("vaultspend-protected.db");
        std::fs::write(&live, b"live").unwrap();

        let failed = delete_leftovers(&[leftover.display().to_string(), dir.display().to_string(), live.display().to_string()], &live).unwrap();

        assert!(!leftover.exists());
        assert!(dir.exists(), "a directory is refused, not recursed into");
        assert!(live.exists(), "the live database is refused even if named");
        assert_eq!(failed, vec![dir.display().to_string(), live.display().to_string()]);
    }
}
