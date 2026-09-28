//! The commands the launch error screen calls. None of them needs an open profile (that is the
//! point), and the ones that would open a profile refuse when one is already open, so a bug in the
//! page can never swap the open profile through here. Plan v2 section 4.13.
use crate::commands::AppStateHandle;
use crate::config::AppPaths;
use crate::profiles;
use crate::startup::{self, LaunchErrorKind, LaunchStatus, StartupState};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Registry-aware (Phase C): a real `profiles.json` can mean the selector, a locked profile, or an
/// empty registry, none of which the pre-Phase-C `startup::startup_state` (open-or-error only) ever
/// reports — see `startup_state_for_registry`'s own doc comment. This is also what makes `.setup()`
/// (`lib.rs`) skipping its boot-time auto-open once a registry exists actually visible to the
/// frontend: without this, `get_startup_state` would report the OLD "no profile is open" generic
/// error instead of the selector, exactly the class of bug only a real launch (Task 9's e2e) could
/// catch — no unit test calls the real Tauri command this wraps.
fn current(app: &AppHandle) -> StartupState {
    let paths = app.state::<AppPaths>();
    let runtime = app.state::<AppStateHandle>();
    let status = app.state::<LaunchStatus>();
    let device = app.state::<crate::device_settings::DeviceSettingsStore>();
    startup::startup_state_for_registry(&paths.config_path, &runtime, &status, device.snapshot().last_used_profile_id.as_deref())
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

/// Starts with a new, empty data file when the one that was asked for can't be used. Offered only for
/// file problems; the old file is left exactly where it is.
#[tauri::command]
pub fn start_with_new_data_file(app: AppHandle) -> Result<StartupState, String> {
    refuse_if_open(&app)?;
    let status = app.state::<LaunchStatus>();
    let Some(error) = status.error() else {
        return Err("There is no data file problem to start over from.".to_string());
    };
    if !matches!(
        error.kind,
        LaunchErrorKind::DataFileMissing | LaunchErrorKind::DataFileUnreadable | LaunchErrorKind::LocationUnreadable
    ) {
        return Err("There is no data file problem to start over from.".to_string());
    }
    let previous = error.db_path.map(PathBuf::from);
    let opened = startup::start_new_data_file_at(
        &app.state::<AppPaths>().config_path,
        &status.default_dir,
        previous.as_deref(),
        chrono::Local::now().naive_local(),
    )?;
    startup::activate(&app, opened);
    Ok(current(&app))
}

/// Starts without a damaged profile list (it is kept as `profiles.json.damaged`), then runs the launch
/// check again.
#[tauri::command]
pub fn start_with_new_profile_list(app: AppHandle) -> Result<StartupState, String> {
    refuse_if_open(&app)?;
    startup::start_new_profile_list_at(&app.state::<AppPaths>().config_path)?;
    Ok(retry(&app))
}

/// Quits from the launch error screen, which has no tray menu of its own to do it from.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
