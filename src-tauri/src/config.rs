//! Resolves where the live database file lives, and persists a relocation
//! chosen from the Reports tab's Settings section. Kept separate from
//! `lib.rs`'s `setup()` so the precedence logic is unit-testable without a
//! real Tauri app context.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

pub(crate) const DB_FILENAME: &str = "vaultspend.db";

/// Tauri-managed — the paths `get_data_file_location`, `relocate_data_file`,
/// and the backup commands (commands.rs) need but `AppState` doesn't
/// otherwise carry. `config_path` never changes after startup (it's the one
/// fixed, discoverable location config.json always lives at — see
/// `lib.rs`'s `setup()`), but `db_path` does: `relocate_data_file` and
/// `restore_backup` both swap the live `AppState` connection to a new file
/// in place (no restart — see their doc comments for why) and must update
/// this alongside it, or `get_data_file_location`/the backups commands
/// would keep computing against the file the app no longer actually uses.
pub struct AppPaths {
    pub config_path: PathBuf,
    pub db_path: Mutex<PathBuf>,
    /// Bumped by every command that swaps the live database out from under
    /// `AppState` (`relocate_data_file`, `restore_backup`, `create_profile`,
    /// `switch_profile`, `add_existing_profile` — everywhere `db_path` above
    /// is reassigned). A long-running async command (`refresh_live_prices`
    /// is the one real example: it makes a network call with no lock held,
    /// then writes its result back afterward) can capture this value before
    /// its `.await` and compare against it once the write-back lock is
    /// re-acquired — a mismatch means the active profile changed while it
    /// was in flight, so its result belongs to a profile that isn't live
    /// anymore and must be discarded instead of mutating whatever profile
    /// happens to be live now.
    pub generation: AtomicU64,
}

impl AppPaths {
    pub fn current_generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Call exactly once, in the same command that reassigns `db_path`,
    /// right alongside that reassignment.
    pub fn bump_generation(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }
}

#[derive(Serialize, Deserialize)]
struct DbLocationConfig {
    db_path: String,
}

/// Where `config.json` says the data file is. `Ok(None)`: there is no `config.json`, which is normal
/// until the data file is moved or a profile is created. `Err`: there is one and it cannot be read;
/// the launch check must not guess. Whether the file it names exists is the caller's question.
///
/// `VAULTSPEND_DB_DIR` (the E2E-test env var) is not handled here: the caller substitutes it for the
/// whole default folder, so a test run's `config.json` lives in the same throwaway directory as
/// everything else and never touches the real AppData folder's `config.json`.
pub fn read_location_strict(config_path: &Path) -> Result<Option<PathBuf>, String> {
    let text = match std::fs::read_to_string(config_path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{}: {e}", config_path.display())),
    };
    let config: DbLocationConfig = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", config_path.display()))?;
    Ok(Some(PathBuf::from(config.db_path)))
}

/// Persists a chosen data-file location to `config_path` — read back by
/// `read_location_strict` on the *next* launch (relocating doesn't hot-swap the
/// currently-open connection; the frontend tells the user to restart).
pub fn write_db_location_config(config_path: &Path, db_path: &Path) -> std::io::Result<()> {
    let config = DbLocationConfig {
        db_path: db_path.to_string_lossy().to_string(),
    };
    let json = serde_json::to_string_pretty(&config).expect("DbLocationConfig always serializes");
    budget_core::fsutil::write_atomic(config_path, json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-config-test-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rewriting_the_location_config_replaces_it_and_leaves_no_temporary_file() {
        let dir = temp_dir("atomic-config");
        let config_path = dir.join("config.json");

        write_db_location_config(&config_path, &dir.join("one.db")).unwrap();
        write_db_location_config(&config_path, &dir.join("two.db")).unwrap();

        let text = std::fs::read_to_string(&config_path).unwrap();
        assert!(text.contains("two.db") && !text.contains("one.db"));
        let temp_files = std::fs::read_dir(&dir)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains(".tmp-"))
            .count();
        assert_eq!(temp_files, 0);
    }

    #[test]
    fn a_missing_config_file_is_not_an_error() {
        let dir = temp_dir("strict-none");

        assert_eq!(read_location_strict(&dir.join("config.json")).unwrap(), None);
    }

    #[test]
    fn the_configured_location_is_returned_even_when_that_file_is_gone() {
        let dir = temp_dir("strict-configured");
        let config_path = dir.join("config.json");
        write_db_location_config(&config_path, &dir.join("no_such_file.db")).unwrap();

        assert_eq!(read_location_strict(&config_path).unwrap(), Some(dir.join("no_such_file.db")));
    }

    #[test]
    fn a_damaged_config_file_is_an_error_not_a_reason_to_open_the_default_file() {
        let dir = temp_dir("strict-damaged");
        let config_path = dir.join("config.json");
        std::fs::write(&config_path, b"{ not json").unwrap();

        assert!(read_location_strict(&config_path).is_err());
    }
}
