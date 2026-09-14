//! Carries a user's data forward across a product rename that changes the
//! app's identifier (`tauri.conf.json`'s `identifier`) — Windows/macOS both
//! key the AppData/Application Support folder by that identifier, so
//! renaming it alone (as every rename so far has: Meadow -> Pennywise ->
//! Penny Worth -> Vault Spend) makes the app look in a folder that's never
//! had anything in it. A comment in `lib.rs` predating this module
//! describes the previous "fix": the developer copied their own local file
//! by hand after each rename — which only ever covered one machine, never
//! a real user's install. This is the real fix: on first launch under a
//! new identifier, look for the most recent previous identifier's folder
//! and adopt its config/profile registry automatically, before ever
//! creating a fresh empty database of its own.
//!
//! Deliberately conservative: this only ever *reads* the legacy folder and
//! *writes* into the new one — no file is ever moved, renamed, or deleted,
//! so a mistake here can't make things worse than doing nothing would.
use std::path::{Path, PathBuf};

/// Every previous identifier this app has shipped under, most recent
/// first, paired with the default database filename that version used
/// when its owner never relocated their data. Add a new entry here (at
/// the front) the next time the product is renamed — this is the one
/// place that has to know the app's naming history.
const LEGACY_INSTALLS: &[(&str, &str)] = &[
    ("com.joeyf.pennyworth", "pennyworth.db"),
    ("com.joeyf.pennywise", "pennywise.db"),
    ("com.joeyf.meadow", "meadow.db"),
];

/// Finds the most recent legacy identifier's data folder that actually
/// exists as a sibling of `current_app_data_dir` (which itself is keyed by
/// the *current* identifier — Tauri's own `app_data_dir()` always resolves
/// to `<platform base>/<identifier>`, so its parent is the same "base"
/// directory every identifier's folder lives under, on any platform this
/// app ships for).
fn find_legacy_dir(current_app_data_dir: &Path) -> Option<(PathBuf, &'static str)> {
    let base = current_app_data_dir.parent()?;
    LEGACY_INSTALLS.iter().find_map(|(identifier, db_filename)| {
        let dir = base.join(identifier);
        dir.is_dir().then_some((dir, *db_filename))
    })
}

/// Copies `legacy_dir`'s `config.json`/`profiles.json` forward into
/// `new_default_dir` if this identifier has never been used before —
/// returns `true` if anything was actually migrated. Every path inside a
/// copied `config.json`/`profiles.json` is already absolute (relocated
/// data, or a profile living under the legacy folder itself), so nothing
/// needs rewriting for the paths to keep resolving correctly; only the
/// *filename convention* changed, which is exactly why the fallback branch
/// below (no config.json, just an implicitly-default-located legacy db)
/// has to write a fresh `config.json` explicitly naming that file, rather
/// than assuming the new default filename would ever find it on its own.
///
/// Never runs against a `new_default_dir` that already has its own
/// `config.json` or its own default-named database — either means this
/// identifier already has real state (migrated already, or a user who
/// genuinely started fresh under the new name), and migrating over the
/// top of that would silently discard it.
pub fn migrate_if_needed(new_default_dir: &Path, new_default_db_filename: &str) -> std::io::Result<bool> {
    if new_default_dir.join("config.json").exists() || new_default_dir.join(new_default_db_filename).exists() {
        return Ok(false);
    }
    let Some((legacy_dir, legacy_db_filename)) = find_legacy_dir(new_default_dir) else {
        return Ok(false);
    };

    let legacy_config = legacy_dir.join("config.json");
    let legacy_default_db = legacy_dir.join(legacy_db_filename);
    if legacy_config.exists() {
        std::fs::copy(&legacy_config, new_default_dir.join("config.json"))?;
    } else if legacy_default_db.exists() {
        crate::config::write_db_location_config(&new_default_dir.join("config.json"), &legacy_default_db)?;
    } else {
        // The legacy folder exists but has neither an explicit relocation
        // nor its own implicit default database — nothing to carry
        // forward (e.g. it was created but never actually used).
        return Ok(false);
    }

    let legacy_profiles = legacy_dir.join("profiles.json");
    if legacy_profiles.exists() {
        std::fs::copy(&legacy_profiles, new_default_dir.join("profiles.json"))?;
    }

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-legacy-migration-test-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Sets up `<base>/com.joeyf.pennyworth` and `<base>/com.joeyf.vaultspend`
    /// as siblings, the same real relationship `app_data_dir()` produces —
    /// `new_default_dir` is what `migrate_if_needed` is called against.
    fn new_and_legacy_dirs(name: &str) -> (PathBuf, PathBuf) {
        let base = temp_dir(name);
        let new_default_dir = base.join("com.joeyf.vaultspend");
        let legacy_dir = base.join("com.joeyf.pennyworth");
        std::fs::create_dir_all(&new_default_dir).unwrap();
        std::fs::create_dir_all(&legacy_dir).unwrap();
        (new_default_dir, legacy_dir)
    }

    #[test]
    fn migrates_an_explicit_relocation_from_the_legacy_config() {
        let (new_default_dir, legacy_dir) = new_and_legacy_dirs("explicit-relocation");
        crate::config::write_db_location_config(&legacy_dir.join("config.json"), Path::new("E:\\misc\\DataBases\\pennyworth.db")).unwrap();

        let migrated = migrate_if_needed(&new_default_dir, "vaultspend.db").unwrap();

        assert!(migrated);
        let content = std::fs::read_to_string(new_default_dir.join("config.json")).unwrap();
        assert!(content.contains("E:\\\\misc\\\\DataBases\\\\pennyworth.db"), "got: {content}");
    }

    #[test]
    fn migrates_an_implicit_default_location_by_writing_an_explicit_config() {
        // No config.json in the legacy folder at all — the user never
        // relocated, so their data is just "pennyworth.db" sitting
        // directly in the legacy folder. The new identifier's own default
        // filename is different, so this must become an explicit pointer,
        // not rely on the new app guessing the old filename.
        let (new_default_dir, legacy_dir) = new_and_legacy_dirs("implicit-default");
        std::fs::write(legacy_dir.join("pennyworth.db"), b"fake db content").unwrap();

        let migrated = migrate_if_needed(&new_default_dir, "vaultspend.db").unwrap();

        assert!(migrated);
        let resolved = crate::config::resolve_db_path(&new_default_dir.join("config.json"), &new_default_dir);
        assert_eq!(resolved, legacy_dir.join("pennyworth.db"));
    }

    #[test]
    fn also_carries_the_profile_registry_forward() {
        let (new_default_dir, legacy_dir) = new_and_legacy_dirs("profiles-carry-forward");
        std::fs::write(legacy_dir.join("pennyworth.db"), b"fake db content").unwrap();
        std::fs::write(
            legacy_dir.join("profiles.json"),
            br#"{"profiles":[{"id":"default","name":"Joey","db_path":"X"}]}"#,
        )
        .unwrap();

        migrate_if_needed(&new_default_dir, "vaultspend.db").unwrap();

        let content = std::fs::read_to_string(new_default_dir.join("profiles.json")).unwrap();
        assert!(content.contains("Joey"), "got: {content}");
    }

    #[test]
    fn does_nothing_when_no_legacy_folder_exists_at_all() {
        let new_default_dir = temp_dir("no-legacy").join("com.joeyf.vaultspend");
        std::fs::create_dir_all(&new_default_dir).unwrap();

        let migrated = migrate_if_needed(&new_default_dir, "vaultspend.db").unwrap();

        assert!(!migrated);
        assert!(!new_default_dir.join("config.json").exists());
    }

    #[test]
    fn does_nothing_when_the_legacy_folder_exists_but_was_never_actually_used() {
        let (new_default_dir, _legacy_dir) = new_and_legacy_dirs("legacy-empty-shell");
        // legacy_dir exists (created by new_and_legacy_dirs) but has
        // neither a config.json nor its own default-named database.

        let migrated = migrate_if_needed(&new_default_dir, "vaultspend.db").unwrap();

        assert!(!migrated);
    }

    #[test]
    fn never_overwrites_a_new_identifier_that_already_has_its_own_config() {
        let (new_default_dir, legacy_dir) = new_and_legacy_dirs("already-configured");
        crate::config::write_db_location_config(&legacy_dir.join("config.json"), Path::new("E:\\legacy.db")).unwrap();
        crate::config::write_db_location_config(&new_default_dir.join("config.json"), Path::new("E:\\already-real.db")).unwrap();

        let migrated = migrate_if_needed(&new_default_dir, "vaultspend.db").unwrap();

        assert!(!migrated);
        let content = std::fs::read_to_string(new_default_dir.join("config.json")).unwrap();
        assert!(content.contains("already-real.db"), "must not have been overwritten, got: {content}");
    }

    #[test]
    fn never_overwrites_a_new_identifier_that_already_has_its_own_default_database() {
        let (new_default_dir, legacy_dir) = new_and_legacy_dirs("already-has-default-db");
        std::fs::write(legacy_dir.join("pennyworth.db"), b"legacy content").unwrap();
        std::fs::write(new_default_dir.join("vaultspend.db"), b"already real content").unwrap();

        let migrated = migrate_if_needed(&new_default_dir, "vaultspend.db").unwrap();

        assert!(!migrated);
        assert!(!new_default_dir.join("config.json").exists());
    }
}
