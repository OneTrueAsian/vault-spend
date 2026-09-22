//! Profile selection, unlock and manual lock (plan v2 §4.4-4.5). Thin wrappers: all the real logic
//! (attempt delays, the crypto, choosing the next `StartupState`) lives in `protection_session`,
//! `budget_core::protection`/`store`, and `startup::startup_state_for_registry`.
use crate::commands::{AppState, AppStateHandle};
use crate::config::AppPaths;
use crate::device_settings::DeviceSettingsStore;
use crate::protection_session::Sessions;
use crate::startup::{self, LaunchStatus, StartupState};
use crate::profiles;
use budget_core::protection::keyfile::KeyFile;
use budget_core::store::DatabaseKey;

fn current_db_path(paths: &AppPaths) -> std::path::PathBuf {
    paths.db_path.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
pub fn show_profile_selector(
    paths: tauri::State<AppPaths>,
    runtime: tauri::State<AppStateHandle>,
    status: tauri::State<LaunchStatus>,
    device: tauri::State<DeviceSettingsStore>,
) -> StartupState {
    // Never silently discards an open session: the frontend only calls this from the profile
    // switcher (which locks or authenticates first) or the very first launch check.
    startup::startup_state_for_registry(&paths.config_path, &runtime, &status, device.snapshot().last_used_profile_id.as_deref())
}

/// Without an active session, opens an unprotected profile straight away or moves a protected one
/// to `Locked`. Refuses an id that no longer exists.
#[tauri::command]
pub fn select_profile(
    id: String,
    app: tauri::AppHandle,
    paths: tauri::State<AppPaths>,
    runtime: tauri::State<AppStateHandle>,
    status: tauri::State<LaunchStatus>,
    device: tauri::State<DeviceSettingsStore>,
) -> Result<StartupState, String> {
    let target = profiles::registered_profiles_strict(&paths.config_path)
        .map_err(|p| p.reason)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "That profile no longer exists.".to_string())?;

    if target.protection.is_some() {
        runtime.lock_profile(&id);
        return Ok(startup::startup_state_for_registry(&paths.config_path, &runtime, &status, Some(&id)));
    }
    match startup::open_registered_profile(&paths.config_path, &id) {
        Ok((_, opened)) => {
            let _ = device.update(|s| s.note_last_used(&id));
            startup::activate(&app, opened);
            Ok(StartupState::Open)
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn unlock_profile(
    id: String,
    password: String,
    app: tauri::AppHandle,
    paths: tauri::State<AppPaths>,
    // Not read yet — Task 7 adds a `broadcast_state(&app, ..., &runtime, &status, ...)` call at the
    // end of this command, once the frontend has something listening for it. Underscore-prefixed
    // rather than dropped so this command's parameter list is already shaped for that, and so
    // Tauri still resolves and injects the right managed state under this exact name.
    _runtime: tauri::State<AppStateHandle>,
    _status: tauri::State<LaunchStatus>,
    device: tauri::State<DeviceSettingsStore>,
    sessions: tauri::State<Sessions>,
) -> Result<StartupState, String> {
    let remaining = sessions.delay_remaining(&id);
    if !remaining.is_zero() {
        return Err(format!("Try again in {} seconds.", remaining.as_secs().max(1)));
    }
    let target = profiles::registered_profiles_strict(&paths.config_path)
        .map_err(|p| p.reason)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "That profile no longer exists.".to_string())?;
    let protection = target.protection.ok_or_else(|| "That profile is not password protected.".to_string())?;
    if protection.format != budget_core::protection::keyfile::FORMAT {
        return Err("This profile was protected by a newer version of Vault Spend. Update Vault Spend to open it.".to_string());
    }
    let key_file_path = budget_core::protection::keyfile::key_file_path_for(&target.db_path);
    let key_file = KeyFile::read(&key_file_path).map_err(|e| e.to_string())?;
    let dek = match key_file.unlock_with_password(&password) {
        Ok(dek) => dek,
        Err(_) => {
            sessions.record_failure(&id);
            return Err("That password didn't work.".to_string());
        }
    };
    let state = AppState::open_with_key(&target.db_path, DatabaseKey::Raw(dek.as_bytes())).map_err(|e| e.to_string())?;
    sessions.record_success(&id);
    let _ = device.update(|s| s.note_last_used(&id));
    startup::activate(&app, startup::OpenedProfile { state, db_path: target.db_path });
    Ok(StartupState::Open)
}

/// Drops the open profile, requiring `expected_generation` to still match (a stale caller — e.g. a
/// second lock button click that lost a race — must not lock a *different* profile that opened in
/// the meantime).
#[tauri::command]
pub fn lock_current_profile(
    expected_generation: u64,
    paths: tauri::State<AppPaths>,
    runtime: tauri::State<AppStateHandle>,
    status: tauri::State<LaunchStatus>,
) -> Result<StartupState, String> {
    if paths.current_generation() != expected_generation {
        return Err("Something else already changed which profile is open.".to_string());
    }
    let profile_id = profiles::profile_id_for(&paths.config_path, &current_db_path(&paths));
    runtime.lock_profile(&profile_id);
    paths.bump_generation();
    Ok(startup::startup_state_for_registry(&paths.config_path, &runtime, &status, Some(&profile_id)))
}

/// Turns password protection on for the currently open (and so far unprotected) profile — the
/// journaled conversion itself lives in `protection_transition::enable_protection`; this command
/// just supplies the profile identity from the live session, then hot-swaps the connection to the
/// freshly encrypted file the same way `unlock_profile` swaps in a freshly opened one (`startup::
/// activate`, not a raw field assignment, so the second backup folder, the tray and the due-backup
/// check all run exactly as they do on every other profile-open). Returns the one-time recovery
/// code (never stored) for the caller to show, once, before it is gone forever.
#[tauri::command]
pub fn enable_profile_protection(
    password: String,
    app: tauri::AppHandle,
    paths: tauri::State<AppPaths>,
    runtime: tauri::State<AppStateHandle>,
) -> Result<String, String> {
    if password.chars().count() < 8 {
        return Err("Choose a password of at least 8 characters.".to_string());
    }
    let db_path = current_db_path(&paths);
    let profile_id = profiles::profile_id_for(&paths.config_path, &db_path);
    let (key_file, recovery_code, target_path) = {
        // Held for the whole conversion, not just released after reading the source: nothing else
        // may mutate this profile's data while it is being exported into and verified against the
        // new encrypted file.
        let session = runtime.lock()?;
        crate::protection_transition::enable_protection(
            &paths.config_path,
            &profile_id,
            &db_path,
            &session.store,
            &password,
            chrono::Local::now().naive_local(),
        )?
    };
    let dek = key_file.unlock_with_password(&password).map_err(|e| e.to_string())?;
    let state = AppState::open_with_key(&target_path, DatabaseKey::Raw(dek.as_bytes())).map_err(|e| e.to_string())?;
    startup::activate(&app, startup::OpenedProfile { state, db_path: target_path });
    Ok(recovery_code.display())
}

#[cfg(test)]
mod tests {
    // Command functions that take `tauri::State`/`tauri::AppHandle` cannot be called directly in a
    // unit test without a running Tauri app (there is no existing precedent for mocking that in
    // this codebase — `commands.rs`'s own tests exercise the plain functions underneath, e.g.
    // `profiles::create_profile`, not `commands::create_profile` itself). This module's behaviour
    // is therefore proved by: (a) the plain-function tests in `startup.rs`/`protection_session.rs`
    // that back every branch here, and (b) feature101/feature102 (Task 9), which drive the actual
    // compiled app through these exact commands over IPC.
}
