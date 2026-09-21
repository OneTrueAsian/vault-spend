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

/// Resolution order:
/// 1. `config_path`'s `db_path`, if that config file exists, parses, and
///    the file it points at still exists (a configured path whose target
///    vanished — e.g. an unplugged external drive — falls through rather
///    than silently starting a brand-new empty database there).
/// 2. `default_dir` joined with `vaultspend.db` — untouched behavior for
///    every user who has never relocated their data.
///
/// `VAULTSPEND_DB_DIR` (the E2E-test env var) is *not* handled here — the
/// caller substitutes it directly for `default_dir` before calling this,
/// so a test run's `config.json` lives in the same throwaway directory as
/// everything else, never the real AppData folder. (An earlier version of
/// this function took the env var as a third, higher-priority parameter
/// that only affected the returned `db_path`, leaving `config_path`
/// computed from the *real* AppData folder regardless — meaning a test
/// that wrote to `config.json` was silently mutating the real user's
/// config. Fixed by giving the whole notion of "default location" the
/// override, not just the final path.)
pub fn resolve_db_path(config_path: &Path, default_dir: &Path) -> PathBuf {
    if let Some(configured) = read_configured_db_path(config_path) {
        return configured;
    }
    default_dir.join(DB_FILENAME)
}

fn read_configured_db_path(config_path: &Path) -> Option<PathBuf> {
    let content = std::fs::read_to_string(config_path).ok()?;
    let config: DbLocationConfig = serde_json::from_str(&content).ok()?;
    let path = PathBuf::from(config.db_path);
    path.exists().then_some(path)
}

/// Persists a chosen data-file location to `config_path` — read back by
/// `resolve_db_path` on the *next* launch (relocating doesn't hot-swap the
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
    fn configured_path_wins_when_its_target_file_exists() {
        let default_dir = temp_dir("configured-default");
        let relocated_dir = temp_dir("configured-target");
        let relocated_db = relocated_dir.join("vaultspend.db");
        std::fs::write(&relocated_db, b"fake db content").unwrap();
        let config_path = default_dir.join("config.json");
        write_db_location_config(&config_path, &relocated_db).unwrap();

        let resolved = resolve_db_path(&config_path, &default_dir);

        assert_eq!(resolved, relocated_db);
    }

    #[test]
    fn falls_back_to_default_when_no_config_file_exists() {
        let default_dir = temp_dir("no-config-default");
        let config_path = default_dir.join("config.json");

        let resolved = resolve_db_path(&config_path, &default_dir);

        assert_eq!(resolved, default_dir.join("vaultspend.db"));
    }

    #[test]
    fn falls_back_to_default_when_the_configured_target_no_longer_exists() {
        let default_dir = temp_dir("vanished-default");
        let config_path = default_dir.join("config.json");
        write_db_location_config(&config_path, &default_dir.join("no_such_file.db")).unwrap();

        let resolved = resolve_db_path(&config_path, &default_dir);

        assert_eq!(resolved, default_dir.join("vaultspend.db"));
    }

    #[test]
    fn rewriting_the_location_config_replaces_it_and_leaves_no_temporary_file() {
        let dir = temp_dir("atomic-config");
        let config_path = dir.join("config.json");

        write_db_location_config(&config_path, &dir.join("one.db")).unwrap();
        write_db_location_config(&config_path, &dir.join("two.db")).unwrap();

        let text = std::fs::read_to_string(&config_path).unwrap();
        assert!(text.contains("two.db") && !text.contains("one.db"));
        let temp_files = std::fs::read_dir(&dir).unwrap().filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains(".tmp-")).count();
        assert_eq!(temp_files, 0);
    }
}