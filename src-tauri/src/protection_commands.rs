//! Profile selection, unlock and manual lock (plan v2 §4.4-4.5). Thin wrappers: all the real logic
//! (attempt delays, the crypto, choosing the next `StartupState`) lives in `protection_session`,
//! `budget_core::protection`/`store`, and `startup::startup_state_for_registry`.
use crate::commands::{AppState, AppStateHandle};
use crate::config::AppPaths;
use crate::device_settings::DeviceSettingsStore;
use crate::profiles;
use crate::protection_session::{Sessions, SetupChallenge};
use crate::startup::{self, LaunchStatus, StartupState};
use budget_core::protection::keyfile::KeyFile;
use budget_core::protection::recovery::RecoveryCode;
use budget_core::store::{DatabaseKey, Store};
use serde::Serialize;

fn current_db_path(paths: &AppPaths) -> std::path::PathBuf {
    paths.db_path.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct AutoLockSettingsDto {
    pub inactivity_minutes: u32,
    pub lock_when_hidden: bool,
    pub lock_on_focus_loss: bool,
    pub lock_on_system_event: bool,
    pub system_event_supported: bool,
}

impl From<profiles::AutoLockSettings> for AutoLockSettingsDto {
    fn from(settings: profiles::AutoLockSettings) -> Self {
        Self {
            inactivity_minutes: settings.inactivity_minutes,
            lock_when_hidden: settings.lock_when_hidden,
            lock_on_focus_loss: settings.lock_on_focus_loss,
            lock_on_system_event: settings.lock_on_system_event,
            system_event_supported: cfg!(windows),
        }
    }
}

#[tauri::command]
pub fn get_auto_lock_settings(paths: tauri::State<AppPaths>, runtime: tauri::State<AppStateHandle>) -> Result<AutoLockSettingsDto, String> {
    let _open = runtime.lock()?;
    let db_path = current_db_path(&paths);
    let profile_id = profiles::profile_id_for(&paths.config_path, &db_path);
    profiles::auto_lock_settings_for(&paths.config_path, &db_path, &profile_id).map(Into::into)
}

#[tauri::command]
pub fn set_auto_lock_settings(
    settings: profiles::AutoLockSettings,
    expected_generation: u64,
    paths: tauri::State<AppPaths>,
    runtime: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    if paths.current_generation() != expected_generation {
        return Err("The active profile changed before automatic-lock settings could be saved.".to_string());
    }
    let _open = runtime.lock()?;
    let db_path = current_db_path(&paths);
    let profile_id = profiles::profile_id_for(&paths.config_path, &db_path);
    profiles::set_auto_lock_settings(&paths.config_path, &db_path, &profile_id, settings)
}

#[tauri::command]
pub fn show_profile_selector(
    paths: tauri::State<AppPaths>,
    runtime: tauri::State<AppStateHandle>,
    status: tauri::State<LaunchStatus>,
    device: tauri::State<DeviceSettingsStore>,
) -> StartupState {
    // The only caller is the lock screen's "Switch profile" button, which always means "abandon
    // this locked profile and let me pick another" — release the lock FIRST, or startup_state_for_
    // registry's own Locked-first check (the same one every passive state query relies on) would
    // just hand back the exact same Locked state, making this button a permanent no-op. Never
    // discards a real OPEN session: release_lock is a no-op on anything but a genuinely locked slot.
    runtime.release_lock();
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
        let next = startup::startup_state_for_registry(&paths.config_path, &runtime, &status, Some(&id));
        startup::broadcast_state(&app);
        return Ok(next);
    }
    match startup::open_registered_profile(&paths.config_path, &id) {
        Ok((_, opened)) => {
            let _ = device.update(|s| s.note_last_used(&id));
            startup::activate(&app, opened);
            startup::broadcast_state(&app);
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
    startup::activate(
        &app,
        startup::OpenedProfile {
            state,
            db_path: target.db_path,
        },
    );
    startup::broadcast_state(&app);
    Ok(StartupState::Open)
}

/// Drops the open profile, requiring `expected_generation` to still match (a stale caller — e.g. a
/// second lock button click that lost a race — must not lock a *different* profile that opened in
/// the meantime).
#[tauri::command]
pub fn lock_current_profile(
    expected_generation: u64,
    app: tauri::AppHandle,
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
    let next = startup::startup_state_for_registry(&paths.config_path, &runtime, &status, Some(&profile_id));
    startup::broadcast_state(&app);
    Ok(next)
}

/// Turns password protection on for the currently open (and so far unprotected) profile — the
/// journaled conversion itself lives in `protection_transition::enable_protection`; this function
/// just supplies the profile identity from the live session, then hot-swaps the connection to the
/// freshly encrypted file the same way `unlock_profile` swaps in a freshly opened one (`startup::
/// activate`, not a raw field assignment, so the second backup folder, the tray and the due-backup
/// check all run exactly as they do on every other profile-open). Returns the one-time recovery
/// code (never stored) for the caller to show, once, before it is gone forever.
///
/// Deliberately **not** a `#[tauri::command]` (Phase C, Task 7) — Task 6's `commit_protection_setup`
/// is the only correct way to reach this, since it enforces the 2-of-7 recovery-code confirmation
/// first. Registering this as its own directly invokable command would let the frontend (or a bug)
/// call straight through to it, encrypting a profile with nobody ever having proven they wrote the
/// recovery code down. It stays a plain function, called only from `commit_protection_setup` below.
pub fn enable_profile_protection_with_recovery(
    password: String,
    recovery_code: budget_core::protection::recovery::RecoveryCode,
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
        crate::protection_transition::enable_protection_with_recovery(
            &paths.config_path,
            &profile_id,
            &db_path,
            &session.store,
            &password,
            recovery_code,
            chrono::Local::now().naive_local(),
        )?
    };
    let dek = key_file.unlock_with_password(&password).map_err(|e| e.to_string())?;
    let state = AppState::open_with_key(&target_path, DatabaseKey::Raw(dek.as_bytes())).map_err(|e| e.to_string())?;
    startup::activate(&app, startup::OpenedProfile { state, db_path: target_path });
    startup::broadcast_state(&app);
    Ok(recovery_code.display())
}

#[tauri::command]
pub fn verify_current_password(password: String, expected_generation: u64, paths: tauri::State<AppPaths>) -> Result<(), String> {
    if paths.current_generation() != expected_generation {
        return Err("The active profile changed before the password could be checked.".to_string());
    }
    let db_path = current_db_path(&paths);
    let key_file = KeyFile::read(&budget_core::protection::keyfile::key_file_path_for(&db_path)).map_err(|e| e.to_string())?;
    key_file
        .unlock_with_password(&password)
        .map_err(|_| "That password didn't work.".to_string())?;
    Ok(())
}

#[tauri::command]
pub fn change_password(
    current_password: String,
    token: String,
    answers: [String; 2],
    app: tauri::AppHandle,
    paths: tauri::State<AppPaths>,
    runtime: tauri::State<AppStateHandle>,
    sessions: tauri::State<Sessions>,
) -> Result<String, String> {
    let (new_password, recovery_code, expected_generation) = sessions.take_verified_setup(&token, &answers)?;
    if paths.current_generation() != expected_generation {
        return Err("The active profile changed before the password could be changed.".to_string());
    }
    let db_path = current_db_path(&paths);
    let profile_id = profiles::profile_id_for(&paths.config_path, &db_path);
    let (key_file, committed_recovery_code, target_path) = {
        let session = runtime.lock()?;
        crate::protection_lifecycle::rotate_password_with_recovery(
            &paths.config_path,
            &profile_id,
            &db_path,
            &session.store,
            &current_password,
            &new_password,
            recovery_code,
            chrono::Local::now().naive_local(),
        )?
    };
    let dek = key_file.unlock_with_password(&new_password).map_err(|e| e.to_string())?;
    let state = AppState::open_with_key(&target_path, DatabaseKey::Raw(dek.as_bytes())).map_err(|e| e.to_string())?;
    startup::activate(&app, startup::OpenedProfile { state, db_path: target_path });
    if let Err(reason) = crate::protection_lifecycle::complete_committed_rotation(&paths.config_path) {
        eprintln!("password rotation committed; old-file cleanup will resume on restart: {reason}");
    }
    startup::broadcast_state(&app);
    Ok(committed_recovery_code.display())
}

#[tauri::command]
pub fn begin_regenerate_recovery(
    current_password: String,
    expected_generation: u64,
    paths: tauri::State<AppPaths>,
    sessions: tauri::State<Sessions>,
) -> Result<SetupChallenge, String> {
    if paths.current_generation() != expected_generation {
        return Err("The active profile changed before the password could be checked.".to_string());
    }
    let db_path = current_db_path(&paths);
    let profile_id = profiles::profile_id_for(&paths.config_path, &db_path);
    let remaining = sessions.delay_remaining(&profile_id);
    if !remaining.is_zero() {
        return Err(format!("Try again in {} seconds.", remaining.as_secs().max(1)));
    }
    let key_file = KeyFile::read(&budget_core::protection::keyfile::key_file_path_for(&db_path)).map_err(|e| e.to_string())?;
    if key_file.unlock_with_password(&current_password).is_err() {
        sessions.record_failure(&profile_id);
        return Err("That password didn't work.".to_string());
    }
    sessions.record_success(&profile_id);
    Ok(sessions.begin_setup(&current_password, expected_generation))
}

#[tauri::command]
pub fn commit_regenerate_recovery(
    token: String,
    answers: [String; 2],
    paths: tauri::State<AppPaths>,
    sessions: tauri::State<Sessions>,
) -> Result<String, String> {
    let (current_password, recovery_code, expected_generation) = sessions.take_verified_setup(&token, &answers)?;
    if paths.current_generation() != expected_generation {
        return Err("The active profile changed before the recovery key could be regenerated.".to_string());
    }
    let recovery_display = recovery_code.display();
    let db_path = current_db_path(&paths);
    crate::protection_lifecycle::regenerate_recovery_with_code(&db_path, &current_password, recovery_code)?;
    Ok(recovery_display)
}

#[tauri::command]
pub fn remove_protection(
    current_password: String,
    expected_generation: u64,
    app: tauri::AppHandle,
    paths: tauri::State<AppPaths>,
    runtime: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    if paths.current_generation() != expected_generation {
        return Err("The active profile changed before protection could be removed.".to_string());
    }
    let db_path = current_db_path(&paths);
    let profile_id = profiles::profile_id_for(&paths.config_path, &db_path);
    let target_path = {
        let session = runtime.lock()?;
        crate::protection_lifecycle::remove_protection(
            &paths.config_path,
            &profile_id,
            &db_path,
            &session.store,
            &current_password,
            chrono::Local::now().naive_local(),
        )?
    };
    let state = AppState::open(&target_path).map_err(|e| e.to_string())?;
    startup::activate(&app, startup::OpenedProfile { state, db_path: target_path });
    if let Err(reason) = crate::protection_lifecycle::complete_committed_removal(&paths.config_path) {
        eprintln!("protection removal committed; encrypted-file cleanup will resume on restart: {reason}");
    }
    startup::broadcast_state(&app);
    Ok(())
}

/// A fast, non-committing check used only to fail early in the recover-via-code dialog's first step,
/// before the person is asked to choose a new password. `commit_recovery` re-verifies for real
/// (against the on-disk key file, inside `rotate_dek`) regardless of what this returns. Subject to
/// the same per-profile attempt delays as a password attempt — the two share one `Sessions` table
/// keyed on profile id, so a person can't bypass the delay by switching between password and
/// recovery-code guesses.
#[tauri::command]
pub fn verify_recovery_code(id: String, code: String, paths: tauri::State<AppPaths>, sessions: tauri::State<Sessions>) -> Result<(), String> {
    let remaining = sessions.delay_remaining(&id);
    if !remaining.is_zero() {
        return Err(format!("Try again in {} seconds.", remaining.as_secs().max(1)));
    }
    let target = profiles::registered_profiles_strict(&paths.config_path)
        .map_err(|p| p.reason)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "That profile no longer exists.".to_string())?;
    let key_file = KeyFile::read(&budget_core::protection::keyfile::key_file_path_for(&target.db_path)).map_err(|e| e.to_string())?;
    let parsed = RecoveryCode::parse(&code).map_err(|_| "That recovery key didn't work.".to_string())?;
    if key_file.unlock_with_recovery(&parsed).is_err() {
        sessions.record_failure(&id);
        return Err("That recovery key didn't work.".to_string());
    }
    sessions.record_success(&id);
    Ok(())
}

/// Re-verifies the recovery code (fail fast, same check as `verify_recovery_code`, committing
/// nothing) then starts the shared 2-of-7 challenge for the new password the person is about to set.
/// `expected_generation` guards against something else changing state mid-dialog, the same
/// convention every other multi-step protection command already follows — even though nothing is
/// open yet here, `AppPaths::generation` is a plain counter, not scoped to an open session.
#[tauri::command]
pub fn begin_recovery(
    id: String,
    code: String,
    new_password: String,
    expected_generation: u64,
    paths: tauri::State<AppPaths>,
    sessions: tauri::State<Sessions>,
) -> Result<SetupChallenge, String> {
    if new_password.chars().count() < 8 {
        return Err("Choose a password of at least 8 characters.".to_string());
    }
    if paths.current_generation() != expected_generation {
        return Err("Something else changed before recovery could continue.".to_string());
    }
    let target = profiles::registered_profiles_strict(&paths.config_path)
        .map_err(|p| p.reason)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "That profile no longer exists.".to_string())?;
    let key_file = KeyFile::read(&budget_core::protection::keyfile::key_file_path_for(&target.db_path)).map_err(|e| e.to_string())?;
    let parsed = RecoveryCode::parse(&code).map_err(|_| "That recovery key didn't work.".to_string())?;
    key_file
        .unlock_with_recovery(&parsed)
        .map_err(|_| "That recovery key didn't work.".to_string())?;
    Ok(sessions.begin_setup(&new_password, expected_generation))
}

/// Finishes recovery for `id`: re-verifies `code` against the on-disk key file one more time (never
/// trusting `begin_recovery`'s earlier check alone), opens the profile with the DEK it unwraps, and
/// rotates to the confirmed new password via `protection_lifecycle::recover_password_with_recovery`
/// — the same journaled rotation `change_password` uses, so a kill mid-recovery resolves through the
/// exact startup recovery Task 2 already built (`recover_interrupted_rotation`). Activates the
/// profile on success, the same hot-swap `unlock_profile`/`change_password` already do.
#[tauri::command]
pub fn commit_recovery(
    id: String,
    code: String,
    token: String,
    answers: [String; 2],
    app: tauri::AppHandle,
    paths: tauri::State<AppPaths>,
    sessions: tauri::State<Sessions>,
) -> Result<String, String> {
    let (new_password, new_recovery_code, expected_generation) = sessions.take_verified_setup(&token, &answers)?;
    if paths.current_generation() != expected_generation {
        return Err("Something else changed before recovery could finish.".to_string());
    }
    let target = profiles::registered_profiles_strict(&paths.config_path)
        .map_err(|p| p.reason)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "That profile no longer exists.".to_string())?;
    let key_file = KeyFile::read(&budget_core::protection::keyfile::key_file_path_for(&target.db_path)).map_err(|e| e.to_string())?;
    let parsed = RecoveryCode::parse(&code).map_err(|_| "That recovery key didn't work.".to_string())?;
    let dek = key_file
        .unlock_with_recovery(&parsed)
        .map_err(|_| "That recovery key didn't work.".to_string())?;
    let opened = Store::open_with_key(&target.db_path, DatabaseKey::Raw(dek.as_bytes())).map_err(|e| e.to_string())?;
    let (new_key_file, committed_recovery_code, target_path) = crate::protection_lifecycle::recover_password_with_recovery(
        &paths.config_path,
        &id,
        &target.db_path,
        &opened,
        &parsed,
        &new_password,
        new_recovery_code,
        chrono::Local::now().naive_local(),
    )?;
    let new_dek = new_key_file.unlock_with_password(&new_password).map_err(|e| e.to_string())?;
    let state = AppState::open_with_key(&target_path, DatabaseKey::Raw(new_dek.as_bytes())).map_err(|e| e.to_string())?;
    startup::activate(&app, startup::OpenedProfile { state, db_path: target_path });
    if let Err(reason) = crate::protection_lifecycle::complete_committed_rotation(&paths.config_path) {
        eprintln!("recovery committed; old-file cleanup will resume on restart: {reason}");
    }
    startup::broadcast_state(&app);
    Ok(committed_recovery_code.display())
}

/// Starts the shared 2-of-7 recovery-key setup challenge (Phase C, Task 6), used by both turning
/// protection on for the current profile and creating a brand-new protected one. Which of those two
/// this is for is not asked here — only `password` and the generation the caller's session must
/// still match — and is instead supplied again to `commit_protection_setup`, since nothing about
/// which target this challenge is *for* needs remembering server-side in between: only the secret
/// (the password) and proof the recovery code was actually written down do.
#[tauri::command]
pub fn begin_protection_setup(password: String, expected_generation: u64, sessions: tauri::State<Sessions>) -> Result<SetupChallenge, String> {
    if password.chars().count() < 8 {
        return Err("Choose a password of at least 8 characters.".to_string());
    }
    Ok(sessions.begin_setup(&password, expected_generation))
}

#[tauri::command]
pub fn cancel_protection_setup(token: String, sessions: tauri::State<Sessions>) {
    sessions.cancel_setup(&token);
}

/// Finishes a setup once its challenge has been answered correctly: either protects the currently
/// open profile or creates a brand-new protected one. The existing-profile case delegates to
/// `enable_profile_protection` rather than re-deriving its own hot-swap — that command's own doc
/// comment explains why going through `startup::activate` (not a raw field assignment) matters, and
/// duplicating that logic here would only give it a second, easier-to-drift copy. A brand-new
/// profile is registered but never auto-opened here — Task 8's UI decides whether and how to switch
/// to it, the same way plaintext `create_profile` already leaves that choice to its own caller.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn commit_protection_setup(
    token: String,
    answers: [String; 2],
    target_profile_id: Option<String>,
    new_profile_name: Option<String>,
    app: tauri::AppHandle,
    paths: tauri::State<AppPaths>,
    runtime: tauri::State<AppStateHandle>,
    status: tauri::State<LaunchStatus>,
    sessions: tauri::State<Sessions>,
) -> Result<StartupState, String> {
    let (password, recovery_code, expected_generation) = sessions.take_verified_setup(&token, &answers)?;
    if paths.current_generation() != expected_generation {
        return Err("The active profile changed before setup could finish.".to_string());
    }
    match (target_profile_id, new_profile_name) {
        (Some(id), None) => {
            let active_id = profiles::profile_id_for(&paths.config_path, &current_db_path(&paths));
            if id != active_id {
                return Err("The active profile changed before setup could finish.".to_string());
            }
            enable_profile_protection_with_recovery(password, recovery_code, app, paths, runtime)?;
            Ok(StartupState::Open)
        }
        (None, Some(name)) => {
            let live_db_path = current_db_path(&paths);
            crate::protection_transition::create_protected_profile_with_recovery(
                &paths.config_path,
                &live_db_path,
                &name,
                &password,
                recovery_code,
                chrono::Local::now().naive_local(),
            )?;
            Ok(startup::startup_state_for_registry(&paths.config_path, &runtime, &status, None))
        }
        _ => Err("Specify exactly one of an existing profile to protect or a new profile name.".to_string()),
    }
}

/// Leftovers can only exist for a profile that was actually *converted* (the plaintext file
/// `enable_profile_protection` replaced) — a profile protected from creation never had one, and
/// `db_path` itself is by now the new encrypted file, not the plaintext original, so it must never
/// be passed to `list_leftovers` as the path to look for leftovers next to (see `profiles::
/// ProfileEntry::former_plaintext_path`'s doc comment).
#[tauri::command]
pub fn list_protection_leftovers(
    paths: tauri::State<AppPaths>,
    device: tauri::State<DeviceSettingsStore>,
) -> Vec<crate::protection_leftovers::LeftoverEntry> {
    let db_path = current_db_path(&paths);
    let profile_id = profiles::profile_id_for(&paths.config_path, &db_path);
    let Some(former_path) = profiles::former_plaintext_path_for(&paths.config_path, &db_path, &profile_id) else {
        return Vec::new();
    };
    let mirror = device.snapshot().backup_mirror_dir(&profile_id).map(std::path::PathBuf::from);
    crate::protection_leftovers::list_leftovers(&former_path, mirror.as_deref())
}

#[tauri::command]
pub fn delete_protection_leftovers(paths_to_delete: Vec<String>, paths: tauri::State<AppPaths>) -> Result<Vec<String>, String> {
    crate::protection_leftovers::delete_leftovers(&paths_to_delete, &current_db_path(&paths))
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
