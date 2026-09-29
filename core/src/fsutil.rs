//! Small filesystem helpers shared by the key file, the profile registry and the config.
use std::io::Write;
use std::path::{Path, PathBuf};

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(suffix);
    path.with_file_name(name)
}

/// Writes `bytes` so a crash or power loss leaves either the old file or the new one, never a
/// torn one: a temporary file beside the destination, flushed to disk, then renamed over it.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temp = sibling(path, &format!(".tmp-{}", std::process::id()));
    let result = (|| {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// As `write_atomic`, but first keeps the previous contents (if there are any) as `<path>.bak`.
pub fn write_atomic_with_backup(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if path.exists() {
        let previous = std::fs::read(path)?;
        write_atomic(&sibling(path, ".bak"), &previous)?;
    }
    write_atomic(path, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-fsutil-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn leftover_temp_files(dir: &Path) -> usize {
        std::fs::read_dir(dir)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains(".tmp-"))
            .count()
    }

    #[test]
    fn writes_a_new_file_and_leaves_no_temporary_file() {
        let dir = temp_dir("new");
        let path = dir.join("registry.json");

        write_atomic(&path, b"hello").unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"hello");
        assert_eq!(leftover_temp_files(&dir), 0);
    }

    #[test]
    fn replaces_an_existing_file_completely() {
        let dir = temp_dir("replace");
        let path = dir.join("registry.json");
        std::fs::write(&path, b"a much longer previous content").unwrap();

        write_atomic(&path, b"new").unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"new");
    }

    #[test]
    fn a_failed_write_reports_an_error_and_cleans_up_its_temporary_file() {
        let dir = temp_dir("fail");
        let destination_is_a_directory = dir.join("taken");
        std::fs::create_dir_all(&destination_is_a_directory).unwrap();

        let result = write_atomic(&destination_is_a_directory, b"x");

        assert!(result.is_err());
        assert_eq!(leftover_temp_files(&dir), 0);
    }

    #[test]
    fn the_backup_variant_keeps_the_previous_version_as_bak() {
        let dir = temp_dir("bak");
        let path = dir.join("profiles.json");
        let bak = dir.join("profiles.json.bak");

        write_atomic_with_backup(&path, b"one").unwrap();
        assert!(!bak.exists(), "nothing to back up on the first write");

        write_atomic_with_backup(&path, b"two").unwrap();
        assert_eq!(std::fs::read(&bak).unwrap(), b"one");
        assert_eq!(std::fs::read(&path).unwrap(), b"two");

        write_atomic_with_backup(&path, b"three").unwrap();
        assert_eq!(std::fs::read(&bak).unwrap(), b"two");
        assert_eq!(std::fs::read(&path).unwrap(), b"three");
        assert_eq!(leftover_temp_files(&dir), 0);
    }
}
