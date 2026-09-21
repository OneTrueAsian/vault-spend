//! The commands the launch error screen calls. None of them needs an open profile (that is the
//! point), and the ones that would open a profile refuse when one is already open, so a bug in the
//! page can never swap the open profile through here. Plan v2 section 4.13.
use crate::commands::AppStateHandle;
use crate::config::AppPaths;
use crate::profiles;
use crate::startup::{self, LaunchStatus, StartupState};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn current(app: &AppHandle) -> StartupState {
    startup::startup_state(&app.state::<AppStateHandle>(), &app.state::<LaunchStatus>())
}

fn refuse_if_open(app: &AppHandle) -> Result<(), String> {
    if app.state::<AppStateHandle>().is_open() {
        Err("A profile is already open.".to_string())
    } else {
        Ok(())
    }
}

fn retry(app: &AppHandle) -> StartupState {
    if app.state::<AppStateHandle>().is_open() {
        return StartupState::Open;
    }
    let paths = app.state::<AppPaths>();
    let status = app.state::<LaunchStatus>();
    match startup::open_from_disk(&paths.config_path, &status.default_dir) {
        Ok(opened) => startup::activate(app, opened),
        Err(error) => status.set_error(error),
    }
    current(app)
}

/// Where startup stands: a profile is open, or why none is.
#[tauri::command]
pub fn get_startup_state(app: AppHandle) -> StartupState {
    current(&app)
}

/// Runs the launch check again (after the person plugged a drive back in, say). Idempotent: with a
/// profile already open it just says so.
#[tauri::command]
pub fn retry_startup(app: AppHandle) -> StartupState {
    retry(&app)
}

/// Puts the previous profile list back in place of a damaged one, then runs the launch check again.
#[tauri::command]
pub fn restore_registry_backup(app: AppHandle) -> Result<StartupState, String> {
    refuse_if_open(&app)?;
    profiles::restore_registry_backup(&app.state::<AppPaths>().config_path)?;
    Ok(retry(&app))
}

/// Opens a different registered profile instead of the one that would not open.
#[tauri::command]
pub fn open_profile_at_launch(id: String, app: AppHandle) -> Result<StartupState, String> {
    refuse_if_open(&app)?;
    let (_name, opened) = startup::open_registered_profile(&app.state::<AppPaths>().config_path, &id)?;
    startup::activate(&app, opened);
    Ok(current(&app))
}

/// Opens a data file the person picked, and remembers it as where this profile's data now lives.
#[tauri::command]
pub fn locate_data_file(path: String, app: AppHandle) -> Result<StartupState, String> {
    refuse_if_open(&app)?;
    let previous = app.state::<LaunchStatus>().error().and_then(|e| e.db_path).map(PathBuf::from);
    let opened = startup::locate_data_file_at(&app.state::<AppPaths>().config_path, previous.as_deref(), Path::new(&path))?;
    startup::activate(&app, opened);
    Ok(current(&app))
}

/// Quits from the launch error screen, which has no tray menu of its own to do it from.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
