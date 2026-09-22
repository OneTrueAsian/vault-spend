//! Settings that belong to this computer, not to a profile: whether the tray icon and start at
//! sign-in are on, and each profile's second backup folder. They live in `device-settings.json` next
//! to `config.json`, so a start with no profile open (or a locked one) can decide what the tray and
//! the window do without a database. Design: plan v2 sections 4.3 and 4.10.
use budget_core::fsutil::write_atomic;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Mutex;

pub const DEVICE_SETTINGS_FILENAME: &str = "device-settings.json";

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct DeviceSettings {
    pub tray_enabled: bool,
    pub autostart_enabled: bool,
    /// Each profile's second backup folder, keyed by its registry id.
    pub backup_mirror_dirs: BTreeMap<String, String>,
    /// True once the tray and start-at-sign-in choices were taken over from a profile's database.
    pub tray_settings_migrated: bool,
    /// Profiles whose old second-backup-folder setting has been taken over, even when it was unset.
    pub mirror_dirs_migrated: BTreeSet<String>,
    /// The profile the selector should pre-select on the next launch (plan v2 §4.4/§7.5). Updated
    /// only on a successful activation, never merely on being shown in the selector.
    #[serde(default)]
    pub last_used_profile_id: Option<String>,
    /// True once the four legacy browser-storage settings (saved filters, the safe-to-spend
    /// buffer, notified bills, category order) have been moved into a profile's database — plan v2
    /// §4.12. Set once, on this computer, by whichever profile opens first after the upgrade;
    /// never re-checked afterward, so a later profile never re-imports stale browser values.
    #[serde(default)]
    pub ui_state_migrated: bool,
}

/// What a profile's database still holds from before these settings moved out of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyProfileSettings {
    pub tray_enabled: bool,
    pub autostart_enabled: bool,
    pub backup_copy_dir: Option<String>,
}

impl DeviceSettings {
    pub fn backup_mirror_dir(&self, profile_id: &str) -> Option<&str> {
        self.backup_mirror_dirs.get(profile_id).map(String::as_str)
    }

    /// The one-time move out of a profile's database. The tray and sign-in choices come from the
    /// first profile opened after the upgrade; a profile's second backup folder comes when that
    /// profile is first opened. Once taken over, the database's values are never read again, so a
    /// choice the person later changes here cannot be undone by an old value. Returns whether
    /// anything changed.
    pub fn take_over_from_profile(&mut self, profile_id: &str, legacy: &LegacyProfileSettings) -> bool {
        let mut changed = false;
        if !self.tray_settings_migrated {
            self.tray_enabled = legacy.tray_enabled;
            self.autostart_enabled = legacy.autostart_enabled;
            self.tray_settings_migrated = true;
            changed = true;
        }
        if !self.mirror_dirs_migrated.contains(profile_id) {
            let dir = legacy.backup_copy_dir.as_deref().map(str::trim).filter(|d| !d.is_empty());
            if let Some(dir) = dir {
                self.backup_mirror_dirs.entry(profile_id.to_string()).or_insert_with(|| dir.to_string());
            }
            self.mirror_dirs_migrated.insert(profile_id.to_string());
            changed = true;
        }
        changed
    }

    pub fn note_last_used(&mut self, profile_id: &str) {
        self.last_used_profile_id = Some(profile_id.to_string());
    }
}

/// The settings in memory plus the file they are saved to. Managed by Tauri.
pub struct DeviceSettingsStore {
    path: PathBuf,
    inner: Mutex<DeviceSettings>,
}

impl DeviceSettingsStore {
    /// A missing file is a first launch. A file that cannot be read loads as defaults: the take-over
    /// then runs again from the profile's database, which is a safe way to start over.
    pub fn load(path: PathBuf) -> Self {
        let settings = match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                eprintln!("{} could not be read ({e}); starting from defaults", path.display());
                DeviceSettings::default()
            }),
            Err(_) => DeviceSettings::default(),
        };
        DeviceSettingsStore { path, inner: Mutex::new(settings) }
    }

    pub fn snapshot(&self) -> DeviceSettings {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Applies `change`, saves the file atomically, and only then updates memory, so a failed write
    /// leaves both as they were. A change that alters nothing writes nothing.
    pub fn update(&self, change: impl FnOnce(&mut DeviceSettings)) -> Result<(), String> {
        let mut current = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut next = current.clone();
        change(&mut next);
        if next == *current {
            return Ok(());
        }
        let json = serde_json::to_string_pretty(&next).expect("DeviceSettings always serializes");
        write_atomic(&self.path, json.as_bytes()).map_err(|e| format!("couldn't save this computer's settings: {e}"))?;
        *current = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-device-settings-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn legacy(tray: bool, autostart: bool, dir: Option<&str>) -> LegacyProfileSettings {
        LegacyProfileSettings { tray_enabled: tray, autostart_enabled: autostart, backup_copy_dir: dir.map(str::to_string) }
    }

    #[test]
    fn everything_starts_off_and_unset() {
        let settings = DeviceSettings::default();

        assert!(!settings.tray_enabled && !settings.autostart_enabled);
        assert_eq!(settings.backup_mirror_dir("default"), None);
    }

    #[test]
    fn the_first_profile_opened_decides_the_tray_and_sign_in_choices() {
        let mut settings = DeviceSettings::default();

        assert!(settings.take_over_from_profile("first", &legacy(true, true, None)));
        settings.take_over_from_profile("second", &legacy(false, false, None));

        assert!(settings.tray_enabled && settings.autostart_enabled, "a later profile's old values are ignored");
    }

    #[test]
    fn each_profiles_second_backup_folder_moves_when_that_profile_is_first_opened() {
        let mut settings = DeviceSettings::default();

        settings.take_over_from_profile("first", &legacy(false, false, Some("D:\\Backups")));
        settings.take_over_from_profile("second", &legacy(false, false, Some("  E:\\Other  ")));

        assert_eq!(settings.backup_mirror_dir("first"), Some("D:\\Backups"));
        assert_eq!(settings.backup_mirror_dir("second"), Some("E:\\Other"), "stored trimmed");
    }

    #[test]
    fn a_blank_folder_moves_as_unset_and_still_counts_as_moved() {
        let mut settings = DeviceSettings::default();

        settings.take_over_from_profile("p", &legacy(false, false, Some("   ")));

        assert_eq!(settings.backup_mirror_dir("p"), None);
        assert!(settings.mirror_dirs_migrated.contains("p"));
    }

    #[test]
    fn taking_over_twice_changes_nothing_the_second_time() {
        let mut settings = DeviceSettings::default();

        assert!(settings.take_over_from_profile("p", &legacy(true, false, Some("D:\\B"))));
        assert!(!settings.take_over_from_profile("p", &legacy(true, false, Some("D:\\B"))));
    }

    #[test]
    fn a_folder_the_person_removed_stays_removed() {
        let mut settings = DeviceSettings::default();
        settings.take_over_from_profile("p", &legacy(false, false, Some("D:\\B")));
        settings.backup_mirror_dirs.remove("p");

        settings.take_over_from_profile("p", &legacy(false, false, Some("D:\\B")));

        assert_eq!(settings.backup_mirror_dir("p"), None, "the old database value must not come back");
    }

    #[test]
    fn a_missing_file_loads_as_defaults() {
        let dir = temp_dir("missing");

        let store = DeviceSettingsStore::load(dir.join(DEVICE_SETTINGS_FILENAME));

        assert_eq!(store.snapshot(), DeviceSettings::default());
    }

    #[test]
    fn a_change_is_written_and_survives_a_reload() {
        let dir = temp_dir("reload");
        let path = dir.join(DEVICE_SETTINGS_FILENAME);
        let store = DeviceSettingsStore::load(path.clone());

        store.update(|s| s.tray_enabled = true).unwrap();
        store
            .update(|s| {
                s.backup_mirror_dirs.insert("default".to_string(), "D:\\B".to_string());
            })
            .unwrap();

        let reloaded = DeviceSettingsStore::load(path).snapshot();
        assert!(reloaded.tray_enabled);
        assert_eq!(reloaded.backup_mirror_dir("default"), Some("D:\\B"));
    }

    #[test]
    fn an_update_that_changes_nothing_writes_nothing() {
        let dir = temp_dir("unchanged");
        let path = dir.join(DEVICE_SETTINGS_FILENAME);
        let store = DeviceSettingsStore::load(path.clone());

        store.update(|_| {}).unwrap();

        assert!(!path.exists());
    }

    #[test]
    fn a_damaged_file_loads_as_defaults_so_the_take_over_runs_again() {
        let dir = temp_dir("damaged");
        let path = dir.join(DEVICE_SETTINGS_FILENAME);
        std::fs::write(&path, b"{ not json").unwrap();

        let store = DeviceSettingsStore::load(path);

        assert_eq!(store.snapshot(), DeviceSettings::default());
        assert!(!store.snapshot().tray_settings_migrated);
    }

    #[test]
    fn fields_from_a_newer_version_are_ignored_and_missing_ones_take_their_defaults() {
        let dir = temp_dir("newer");
        let path = dir.join(DEVICE_SETTINGS_FILENAME);
        std::fs::write(&path, br#"{"tray_enabled": true, "something_new": 7}"#).unwrap();

        let settings = DeviceSettingsStore::load(path).snapshot();

        assert!(settings.tray_enabled);
        assert!(!settings.autostart_enabled);
    }

    #[test]
    fn writing_leaves_no_temporary_file() {
        let dir = temp_dir("no-temp");
        let store = DeviceSettingsStore::load(dir.join(DEVICE_SETTINGS_FILENAME));

        store.update(|s| s.tray_enabled = true).unwrap();
        store.update(|s| s.tray_enabled = false).unwrap();

        let temp_files = std::fs::read_dir(&dir).unwrap().filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains(".tmp-")).count();
        assert_eq!(temp_files, 0);
    }

    #[test]
    fn a_failed_write_reports_the_problem_and_leaves_the_settings_unchanged() {
        let dir = temp_dir("failed-write");
        let blocker = dir.join("blocker");
        std::fs::write(&blocker, b"a file, not a folder").unwrap();
        let store = DeviceSettingsStore::load(blocker.join(DEVICE_SETTINGS_FILENAME));

        let result = store.update(|s| s.tray_enabled = true);

        assert!(result.is_err());
        assert!(!store.snapshot().tray_enabled, "memory must not run ahead of the file");
    }

    // ---- last-used profile (Phase C, Task 1) ----

    #[test]
    fn there_is_no_last_used_profile_by_default() {
        assert_eq!(DeviceSettings::default().last_used_profile_id, None);
    }

    #[test]
    fn noting_a_profile_used_records_it_and_replaces_the_previous_one() {
        let mut settings = DeviceSettings::default();

        settings.note_last_used("alpha");
        settings.note_last_used("beta");

        assert_eq!(settings.last_used_profile_id, Some("beta".to_string()));
    }

    // ---- profile UI state migration flag (Phase C, Task 3) ----

    #[test]
    fn ui_state_migration_starts_unmarked() {
        assert!(!DeviceSettings::default().ui_state_migrated);
    }
}
