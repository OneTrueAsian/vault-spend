//! What happens between "the window opened" and "a profile is open": deciding which data file to
//! open, refusing with a reason the person can act on instead of quietly opening something else, and
//! the work that follows every successful open. Design: plan v2 sections 4.4 and 4.13.
use crate::commands::{AppState, AppStateHandle};
use crate::config;
use crate::device_settings::{DeviceSettingsStore, LegacyProfileSettings};
use crate::profiles;
use crate::runtime::AppRuntime;
use budget_core::store::Store;
use chrono::NaiveDateTime;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct OpenedProfile {
    pub state: AppState,
    pub db_path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LaunchErrorKind {
    /// `profiles.json` exists and cannot be read.
    RegistryUnreadable,
    /// `config.json` exists and cannot be read.
    LocationUnreadable,
    /// `config.json` names a data file that is not there.
    DataFileMissing,
    /// The data file is there and cannot be opened.
    DataFileUnreadable,
}

/// A profile the person can open instead, when the one they wanted will not open.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LaunchProfile {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LaunchError {
    pub kind: LaunchErrorKind,
    /// A plain sentence for the person.
    pub message: String,
    /// The technical reason, behind a "details" disclosure.
    pub details: String,
    pub db_path: Option<String>,
    pub can_restore_registry: bool,
    pub other_profiles: Vec<LaunchProfile>,
}

/// Registered profiles, other than `except`, whose data files exist.
fn other_profiles(registered: &[profiles::RegisteredProfile], except: Option<&Path>) -> Vec<LaunchProfile> {
    registered
        .iter()
        .filter(|p| p.db_path.exists() && Some(p.db_path.as_path()) != except)
        .map(|p| LaunchProfile { id: p.id.clone(), name: p.name.clone() })
        .collect()
}

/// Opens the data file `config.json` and the profile list point at, or says why it cannot. A fresh
/// install (no `config.json`, no `vaultspend.db`) creates and opens a new default database, exactly
/// as before. Nothing here ever opens a different file than the one that was asked for.
pub fn open_from_disk(config_path: &Path, default_dir: &Path) -> Result<OpenedProfile, LaunchError> {
    let registered = profiles::registered_profiles_strict(config_path).map_err(|problem| LaunchError {
        kind: LaunchErrorKind::RegistryUnreadable,
        message: "Vault Spend can't read its list of profiles. Your data files have not been changed.".to_string(),
        details: problem.reason,
        db_path: None,
        can_restore_registry: problem.backup_available,
        other_profiles: Vec::new(),
    })?;

    let db_path = match config::read_location_strict(config_path) {
        Err(reason) => {
            return Err(LaunchError {
                kind: LaunchErrorKind::LocationUnreadable,
                message: "Vault Spend can't read the note that says where your data file is kept. Your data file has not been changed.".to_string(),
                details: reason,
                db_path: None,
                can_restore_registry: false,
                other_profiles: other_profiles(&registered, None),
            });
        }
        Ok(Some(configured)) if !configured.exists() => {
            return Err(LaunchError {
                kind: LaunchErrorKind::DataFileMissing,
                message: format!(
                    "Vault Spend looked for your data file at {} and it isn't there. It may have been moved or deleted, or a removable drive may be disconnected.",
                    configured.display()
                ),
                details: configured.display().to_string(),
                db_path: Some(configured.display().to_string()),
                can_restore_registry: false,
                other_profiles: other_profiles(&registered, Some(&configured)),
            });
        }
        Ok(Some(configured)) => configured,
        Ok(None) => default_dir.join(config::DB_FILENAME),
    };

    match AppState::open(&db_path) {
        Ok(state) => Ok(OpenedProfile { state, db_path }),
        Err(reason) => Err(LaunchError {
            kind: LaunchErrorKind::DataFileUnreadable,
            message: format!(
                "Vault Spend couldn't open your data file at {}. The file may be damaged, or it may not be a Vault Spend data file. It has not been changed.",
                db_path.display()
            ),
            details: reason,
            db_path: Some(db_path.display().to_string()),
            can_restore_registry: false,
            other_profiles: other_profiles(&registered, Some(&db_path)),
        }),
    }
}

/// Opens the registered profile `id` (from the launch error screen) and points `config.json` at it.
/// Returns its name. Refuses an unknown id, a missing file and a profile list that cannot be read.
pub fn open_registered_profile(config_path: &Path, id: &str) -> Result<(String, OpenedProfile), String> {
    let registered = profiles::registered_profiles_strict(config_path)
        .map_err(|problem| format!("Vault Spend can't read its list of profiles: {}", problem.reason))?;
    let target = registered.into_iter().find(|p| p.id == id).ok_or_else(|| "That profile no longer exists.".to_string())?;
    if !target.db_path.exists() {
        return Err(format!(
            "{}'s data file wasn't found at {} — was it moved, or is a removable drive disconnected?",
            target.name,
            target.db_path.display()
        ));
    }
    let state = AppState::open(&target.db_path).map_err(|e| format!("Couldn't open {}: {e}", target.name))?;
    config::write_db_location_config(config_path, &target.db_path).map_err(|e| e.to_string())?;
    Ok((target.name, OpenedProfile { state, db_path: target.db_path }))
}

/// Opens a data file the person found with a file picker, and remembers it: `config.json` points at
/// it, and the profile entry that used `previous` (the file that was missing) follows it there. The
/// file is checked before anything is written, so a wrong pick changes nothing.
pub fn locate_data_file_at(config_path: &Path, previous: Option<&Path>, picked: &Path) -> Result<OpenedProfile, String> {
    if !picked.exists() {
        return Err(format!("{} doesn't exist.", picked.display()));
    }
    budget_core::store::looks_like_a_vault_spend_database(picked)?;
    let state = AppState::open(picked).map_err(|e| format!("Couldn't open {} as a Vault Spend data file: {e}", picked.display()))?;
    config::write_db_location_config(config_path, picked).map_err(|e| e.to_string())?;
    if let Some(previous) = previous {
        profiles::update_active_db_path(config_path, previous, picked)?;
    }
    Ok(OpenedProfile { state, db_path: picked.to_path_buf() })
}

/// The work that follows every successful open of a profile's data file: take over the settings that
/// used to live in the database (once), then the automatic backup when one is due, mirrored to this
/// profile's second folder. Best effort: a failure here never blocks using the app.
pub fn after_profile_opened(config_path: &Path, db_path: &Path, store: &Store, device: &DeviceSettingsStore, now: NaiveDateTime) {
    let profile_id = profiles::profile_id_for(config_path, db_path);
    take_over_legacy_settings(&profile_id, store, device);
    let copy_dir = device.snapshot().backup_mirror_dir(&profile_id).map(PathBuf::from);
    let backups_dir = crate::backups::backups_dir_for(db_path);
    if let Err(e) = crate::backups::create_backup_if_due(store, &backups_dir, copy_dir.as_deref(), now) {
        eprintln!("automatic backup failed (continuing anyway): {e}");
    }
}

fn take_over_legacy_settings(profile_id: &str, store: &Store, device: &DeviceSettingsStore) {
    let (background, copy_dir) = match (store.get_background_settings(), store.get_backup_copy_dir()) {
        (Ok(background), Ok(copy_dir)) => (background, copy_dir),
        (Err(e), _) | (_, Err(e)) => {
            eprintln!("couldn't read this profile's old settings (continuing anyway): {e}");
            return;
        }
    };
    let legacy = LegacyProfileSettings {
        tray_enabled: background.tray_enabled,
        autostart_enabled: background.autostart_enabled,
        backup_copy_dir: copy_dir,
    };
    if let Err(e) = device.update(|settings| {
        settings.take_over_from_profile(profile_id, &legacy);
    }) {
        eprintln!("{e} (continuing anyway)");
    }
}

/// Managed by Tauri: the folder startup resolves against, and the reason no profile is open, if any.
pub struct LaunchStatus {
    pub default_dir: PathBuf,
    error: Mutex<Option<LaunchError>>,
}

impl LaunchStatus {
    pub fn new(default_dir: PathBuf) -> Self {
        LaunchStatus { default_dir, error: Mutex::new(None) }
    }

    pub fn set_error(&self, error: LaunchError) {
        *self.error.lock().unwrap_or_else(|e| e.into_inner()) = Some(error);
    }

    pub fn clear(&self) {
        *self.error.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    pub fn error(&self) -> Option<LaunchError> {
        self.error.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

/// What the page renders. Phase C adds `Selector` and `Locked`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum StartupState {
    Open,
    Error { error: LaunchError },
}

pub fn startup_state(runtime: &AppRuntime, status: &LaunchStatus) -> StartupState {
    if runtime.is_open() {
        return StartupState::Open;
    }
    // Not reachable in Phase B: with nothing open, startup always recorded why.
    let error = status.error().unwrap_or_else(|| LaunchError {
        kind: LaunchErrorKind::DataFileUnreadable,
        message: "No profile is open.".to_string(),
        details: String::new(),
        db_path: None,
        can_restore_registry: false,
        other_profiles: Vec::new(),
    });
    StartupState::Error { error }
}

/// Makes `opened` the live profile: settles this computer's settings and any due backup, hands the
/// connection to the runtime, records the new location, and brings the tray up when this computer's
/// settings ask for it. The one place a profile becomes live at launch and after a recovery.
pub fn activate(app: &tauri::AppHandle, opened: OpenedProfile) {
    use tauri::Manager;
    let runtime = app.state::<AppStateHandle>();
    let paths = app.state::<config::AppPaths>();
    let device = app.state::<DeviceSettingsStore>();
    let status = app.state::<LaunchStatus>();

    after_profile_opened(&paths.config_path, &opened.db_path, &opened.state.store, &device, chrono::Local::now().naive_local());
    *paths.db_path.lock().unwrap_or_else(|e| e.into_inner()) = opened.db_path;
    paths.bump_generation();
    runtime.install(opened.state);
    status.clear();
    crate::background::sync_tray_with_settings(app);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device_settings::DEVICE_SETTINGS_FILENAME;
    use crate::runtime::AppRuntime;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-startup-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_database(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        drop(AppState::open(path).unwrap());
    }

    fn expect_error(result: Result<OpenedProfile, LaunchError>) -> LaunchError {
        match result {
            Err(error) => error,
            Ok(_) => panic!("expected a launch error"),
        }
    }

    fn write_registry(dir: &Path, entries: &[(&str, &str, PathBuf)]) {
        let profiles: Vec<serde_json::Value> = entries
            .iter()
            .map(|(id, name, db)| serde_json::json!({ "id": id, "name": name, "db_path": db.to_string_lossy(), "icon_key": null }))
            .collect();
        std::fs::write(dir.join("profiles.json"), serde_json::json!({ "profiles": profiles }).to_string()).unwrap();
    }

    fn now() -> NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(2026, 9, 21).unwrap().and_hms_opt(9, 0, 0).unwrap()
    }

    // ---- open_from_disk ----

    #[test]
    fn a_fresh_folder_opens_a_new_default_database() {
        let dir = temp_dir("fresh");

        let opened = open_from_disk(&dir.join("config.json"), &dir).ok().expect("a fresh install opens straight in");

        assert_eq!(opened.db_path, dir.join("vaultspend.db"));
        assert!(dir.join("vaultspend.db").exists());
    }

    #[test]
    fn the_configured_data_file_is_the_one_that_opens() {
        let dir = temp_dir("configured");
        let elsewhere = dir.join("elsewhere").join("moved.db");
        make_database(&elsewhere);
        config::write_db_location_config(&dir.join("config.json"), &elsewhere).unwrap();

        let opened = open_from_disk(&dir.join("config.json"), &dir).ok().unwrap();

        assert_eq!(opened.db_path, elsewhere);
        assert!(!dir.join("vaultspend.db").exists(), "the default file must not be created as well");
    }

    #[test]
    fn a_configured_file_that_is_gone_is_an_error_naming_it_and_never_the_default() {
        let dir = temp_dir("gone");
        make_database(&dir.join("vaultspend.db")); // a perfectly good default that must NOT be used instead
        let gone = dir.join("removable").join("vaultspend.db");
        config::write_db_location_config(&dir.join("config.json"), &gone).unwrap();

        let error = expect_error(open_from_disk(&dir.join("config.json"), &dir));

        assert_eq!(error.kind, LaunchErrorKind::DataFileMissing);
        assert_eq!(error.db_path, Some(gone.display().to_string()));
        assert!(error.message.contains(&gone.display().to_string()), "{}", error.message);
        assert!(!gone.exists(), "nothing may be created in its place");
    }

    #[test]
    fn a_damaged_data_file_is_an_error_and_is_left_untouched() {
        let dir = temp_dir("damaged-db");
        std::fs::write(dir.join("vaultspend.db"), b"this is not a database").unwrap();

        let error = expect_error(open_from_disk(&dir.join("config.json"), &dir));

        assert_eq!(error.kind, LaunchErrorKind::DataFileUnreadable);
        assert!(!error.details.is_empty());
        assert_eq!(std::fs::read(dir.join("vaultspend.db")).unwrap(), b"this is not a database");
    }

    #[test]
    fn a_damaged_config_file_is_an_error_and_opens_nothing() {
        let dir = temp_dir("damaged-config");
        std::fs::write(dir.join("config.json"), b"{ not json").unwrap();

        let error = expect_error(open_from_disk(&dir.join("config.json"), &dir));

        assert_eq!(error.kind, LaunchErrorKind::LocationUnreadable);
        assert_eq!(error.db_path, None);
        assert!(!dir.join("vaultspend.db").exists(), "no blank database may be started instead");
    }

    #[test]
    fn a_damaged_profile_list_is_an_error_that_says_whether_the_previous_one_can_come_back() {
        let dir = temp_dir("damaged-registry");
        std::fs::write(dir.join("profiles.json"), b"garbage").unwrap();

        let without_backup = expect_error(open_from_disk(&dir.join("config.json"), &dir));
        assert_eq!(without_backup.kind, LaunchErrorKind::RegistryUnreadable);
        assert!(!without_backup.can_restore_registry);
        assert!(!dir.join("vaultspend.db").exists());

        write_registry(&dir, &[("default", "Default", dir.join("vaultspend.db"))]);
        std::fs::rename(dir.join("profiles.json"), dir.join("profiles.json.bak")).unwrap();
        std::fs::write(dir.join("profiles.json"), b"garbage").unwrap();
        let with_backup = expect_error(open_from_disk(&dir.join("config.json"), &dir));
        assert!(with_backup.can_restore_registry);
    }

    #[test]
    fn other_profiles_whose_files_exist_are_offered_when_the_data_file_is_missing() {
        let dir = temp_dir("others");
        let gone = dir.join("gone.db");
        let second = dir.join("profiles").join("second").join("vaultspend.db");
        let third = dir.join("profiles").join("third").join("vaultspend.db"); // registered, file missing
        make_database(&second);
        write_registry(&dir, &[("default", "Default", gone.clone()), ("second", "Second", second.clone()), ("third", "Third", third.clone())]);
        config::write_db_location_config(&dir.join("config.json"), &gone).unwrap();

        let error = expect_error(open_from_disk(&dir.join("config.json"), &dir));

        assert_eq!(error.other_profiles, vec![LaunchProfile { id: "second".to_string(), name: "Second".to_string() }]);
    }

    // ---- open_registered_profile ----

    #[test]
    fn opening_a_registered_profile_points_the_config_at_it() {
        let dir = temp_dir("open-registered");
        let alpha = dir.join("alpha").join("vaultspend.db");
        make_database(&alpha);
        write_registry(&dir, &[("alpha", "Alpha", alpha.clone())]);

        let (name, opened) = open_registered_profile(&dir.join("config.json"), "alpha").ok().unwrap();

        assert_eq!(name, "Alpha");
        assert_eq!(opened.db_path, alpha);
        assert_eq!(config::read_location_strict(&dir.join("config.json")).unwrap(), Some(alpha));
    }

    #[test]
    fn opening_a_registered_profile_refuses_an_unknown_id_a_missing_file_and_a_damaged_list() {
        let dir = temp_dir("open-registered-refuse");
        let missing = dir.join("missing.db");
        write_registry(&dir, &[("alpha", "Alpha", missing.clone())]);
        let config_path = dir.join("config.json");

        assert!(open_registered_profile(&config_path, "nobody").is_err());
        let error = open_registered_profile(&config_path, "alpha").err().unwrap();
        assert!(error.contains("Alpha") && error.contains("missing.db"), "{error}");
        assert!(!config_path.exists(), "a failed open must not touch config.json");

        std::fs::write(dir.join("profiles.json"), b"garbage").unwrap();
        assert!(open_registered_profile(&config_path, "alpha").is_err());
    }

    // ---- locate_data_file_at ----

    #[test]
    fn locating_a_data_file_points_the_config_and_the_profile_entry_at_it() {
        let dir = temp_dir("locate");
        let old = dir.join("old-drive").join("vaultspend.db");
        let found = dir.join("found").join("vaultspend.db");
        make_database(&found);
        write_registry(&dir, &[("default", "Default", old.clone())]);
        let config_path = dir.join("config.json");

        let opened = locate_data_file_at(&config_path, Some(&old), &found).ok().unwrap();

        assert_eq!(opened.db_path, found);
        assert_eq!(config::read_location_strict(&config_path).unwrap(), Some(found.clone()));
        assert_eq!(profiles::registered_profiles_strict(&config_path).unwrap()[0].db_path, found);
    }

    #[test]
    fn locating_refuses_a_missing_file_and_a_file_that_is_not_a_data_file() {
        let dir = temp_dir("locate-refuse");
        let config_path = dir.join("config.json");
        let text_file = dir.join("notes.txt");
        std::fs::write(&text_file, b"just some notes").unwrap();

        assert!(locate_data_file_at(&config_path, None, &dir.join("nope.db")).is_err());
        assert!(locate_data_file_at(&config_path, None, &text_file).is_err());
        assert!(!config_path.exists(), "a refused pick must not touch config.json");
    }

    // ---- after_profile_opened ----

    #[test]
    fn opening_a_profile_takes_over_the_old_settings_and_mirrors_the_due_backup() {
        let dir = temp_dir("after-open");
        let db_path = dir.join("vaultspend.db");
        let store = Store::open(&db_path).unwrap();
        let second = dir.join("second-copy");
        std::fs::create_dir_all(&second).unwrap();
        store.set_tray_enabled(true).unwrap();
        store.set_backup_copy_dir(Some(second.to_str().unwrap())).unwrap();
        let device = DeviceSettingsStore::load(dir.join(DEVICE_SETTINGS_FILENAME));

        after_profile_opened(&dir.join("config.json"), &db_path, &store, &device, now());

        let settings = device.snapshot();
        assert!(settings.tray_enabled);
        assert_eq!(settings.backup_mirror_dir("default"), Some(second.to_str().unwrap()));
        assert!(DeviceSettingsStore::load(dir.join(DEVICE_SETTINGS_FILENAME)).snapshot().tray_enabled, "saved to the file");
        let backups = crate::backups::list_backups(&crate::backups::backups_dir_for(&db_path)).unwrap();
        assert_eq!(backups.len(), 1, "a launch with no backup yet takes the automatic one");
        assert!(second.join(&backups[0].filename).exists(), "and copies it to the second folder");
    }

    #[test]
    fn opening_the_same_profile_again_does_not_undo_a_change_made_here() {
        let dir = temp_dir("after-open-twice");
        let db_path = dir.join("vaultspend.db");
        let store = Store::open(&db_path).unwrap();
        store.set_tray_enabled(true).unwrap();
        let device = DeviceSettingsStore::load(dir.join(DEVICE_SETTINGS_FILENAME));
        after_profile_opened(&dir.join("config.json"), &db_path, &store, &device, now());
        device.update(|s| s.tray_enabled = false).unwrap();

        after_profile_opened(&dir.join("config.json"), &db_path, &store, &device, now());

        assert!(!device.snapshot().tray_enabled, "the database's old value must not come back");
    }

    // ---- StartupState ----

    fn sample_error() -> LaunchError {
        LaunchError {
            kind: LaunchErrorKind::DataFileMissing,
            message: "It isn't there.".to_string(),
            details: "E:\\gone.db".to_string(),
            db_path: Some("E:\\gone.db".to_string()),
            can_restore_registry: false,
            other_profiles: vec![LaunchProfile { id: "second".to_string(), name: "Second".to_string() }],
        }
    }

    #[test]
    fn the_startup_state_serializes_with_a_status_tag() {
        assert_eq!(serde_json::to_value(StartupState::Open).unwrap(), serde_json::json!({ "status": "open" }));

        let value = serde_json::to_value(StartupState::Error { error: sample_error() }).unwrap();

        assert_eq!(value["status"], "error");
        assert_eq!(value["error"]["kind"], "data_file_missing");
        assert_eq!(value["error"]["db_path"], "E:\\gone.db");
        assert_eq!(value["error"]["can_restore_registry"], false);
        assert_eq!(value["error"]["other_profiles"][0]["name"], "Second");
    }

    #[test]
    fn the_startup_state_is_open_only_while_a_profile_is_open() {
        let dir = temp_dir("state");
        let runtime = AppRuntime::no_profile_open();
        let status = LaunchStatus::new(dir.clone());
        status.set_error(sample_error());

        assert_eq!(startup_state(&runtime, &status), StartupState::Error { error: sample_error() });

        runtime.install(AppState::open(dir.join("vaultspend.db")).unwrap());
        status.clear();
        assert_eq!(startup_state(&runtime, &status), StartupState::Open);
    }
}
