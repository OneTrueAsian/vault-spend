//! Commands: profiles (list, create, switch, add, rename, delete) and their saved screen state.

use super::*;

#[derive(Serialize)]
pub struct ProfileDto {
    pub id: String,
    pub name: String,
    pub is_active: bool,
    pub icon_key: Option<String>,
    pub is_password_protected: bool,
}

#[tauri::command]
pub fn list_profiles(paths: tauri::State<crate::config::AppPaths>) -> Vec<ProfileDto> {
    crate::profiles::list_profiles(&paths.config_path, &current_db_path(&paths))
        .into_iter()
        .map(|p| ProfileDto {
            is_password_protected: p.is_password_protected(),
            id: p.id,
            name: p.name,
            is_active: p.is_active,
            icon_key: p.icon_key,
        })
        .collect()
}

/// Sets (or clears, with `None`) a profile's icon — see
/// `profiles::set_profile_icon`.
#[tauri::command]
pub fn set_profile_icon(id: String, icon_key: Option<String>, paths: tauri::State<crate::config::AppPaths>) -> Result<(), String> {
    crate::profiles::set_profile_icon(&paths.config_path, &current_db_path(&paths), &id, icon_key.as_deref())
}

/// Registers a brand-new, completely independent profile (its own
/// directory, its own `vaultspend.db`, its own isolated `backups/`
/// subfolder — see `profiles::create_profile`) and hot-swaps to it
/// immediately, same in-place mechanism as `relocate_data_file`/
/// `restore_backup` — creating a profile means "start using it now."
///
/// Deliberately does NOT require a profile to already be open (`runtime.install`, not `.lock()?`
/// followed by a swap): the in-app Settings "New profile" button always has one open, but
/// `EmptyRegistryScreen` (Phase C) calls this exact command with NOTHING open — a registry that
/// exists but lists no profiles. `install` drops whatever was there and installs fresh either way,
/// so both callers get the same "now open on the new profile" result regardless of where they
/// started. Found via a real e2e launch (Task 9): no unit test calls the real Tauri command layer,
/// so `state.lock()?` unconditionally failing with `NO_PROFILE_OPEN` for the empty-registry path
/// was invisible to every jsdom/Rust test already covering the two pieces separately.
#[tauri::command]
pub fn create_profile(
    name: String,
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
) -> Result<String, String> {
    let live_db_path = current_db_path(&paths);
    let profile = crate::profiles::create_profile(&paths.config_path, &live_db_path, &name, chrono::Local::now().naive_local())?;

    let profile_dir = profile.db_path.parent().ok_or_else(|| "invalid profile path".to_string())?;
    std::fs::create_dir_all(profile_dir).map_err(|e| e.to_string())?;
    // Config written before the live-state swap (matching
    // `relocate_data_file`/`restore_backup`) — if this fails, the app stays
    // live on the old profile instead of silently drifting out of sync with
    // `config.json`.
    crate::config::write_db_location_config(&paths.config_path, &profile.db_path).map_err(|e| e.to_string())?;
    state.install(AppState::open(&profile.db_path)?);
    *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = profile.db_path.clone();
    paths.bump_generation();

    let session = state.lock()?;
    let summary = crate::startup::after_profile_opened(
        &paths.config_path,
        &profile.db_path,
        &session.store,
        &device,
        chrono::Local::now().naive_local(),
    );
    state.set_notice(summary);

    Ok(profile.name)
}

/// Hot-swaps to an existing profile — same mechanism as `relocate_data_file`
/// (minus the `backup_to` copy step: this points at an already-independent
/// file, there's nothing to copy). Refuses to open a profile whose file has
/// gone missing (moved, deleted, a disconnected drive) rather than letting
/// `Store::open` silently heal it into a blank database — see
/// `backups::verify_backup`'s doc comment for why that's a real risk in
/// this codebase, not a hypothetical one.
#[tauri::command]
pub fn switch_profile(
    id: String,
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
) -> Result<String, String> {
    let runtime = &*state;
    let mut state = runtime.lock()?;
    let live_db_path = current_db_path(&paths);
    let target = crate::profiles::list_profiles(&paths.config_path, &live_db_path)
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "That profile no longer exists.".to_string())?;

    if !target.db_path.exists() {
        return Err(format!(
            "{}'s data file wasn't found at {} — was it moved, or is a removable drive disconnected?",
            target.name,
            target.db_path.display()
        ));
    }

    // Unlike `create_profile` (whose target is a file this app just
    // created, so opening it can't meaningfully fail), `target.db_path`
    // here is an existing file that could be corrupt — so it's opened
    // *before* config.json is touched. Config written first and this
    // failing would leave config.json pointed at a database this app
    // can't use while the live connection quietly stayed on the old
    // profile: the two would disagree about which profile is active, and
    // the next launch would try (and fail) to open the broken one.
    // Validating first means a bad target fails here with config.json,
    // the live connection, and `paths.db_path` all left untouched.
    let new_state = AppState::open(&target.db_path)?;
    crate::config::write_db_location_config(&paths.config_path, &target.db_path).map_err(|e| e.to_string())?;
    state.replace(new_state);
    *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = target.db_path.clone();
    paths.bump_generation();

    let summary = crate::startup::after_profile_opened(
        &paths.config_path,
        &target.db_path,
        &state.store,
        &device,
        chrono::Local::now().naive_local(),
    );
    runtime.set_notice(summary);

    Ok(target.name)
}

/// Whether `path` is an encrypted Vault Spend database, so the frontend's "Use existing file…"
/// picker knows to ask for a password before calling `add_existing_profile` — without this, a
/// protected profile that was removed from the list (or a `.db` copied in from a backup) could
/// never be re-added even with the right password, since the picker never offered a password field
/// for a bare file (only for a `.vaultspend` package folder).
#[tauri::command]
pub fn path_looks_password_protected(path: String) -> Result<bool, String> {
    let path = std::path::PathBuf::from(path);
    if path.is_dir() || !path.exists() {
        return Ok(false);
    }
    budget_core::store::file_looks_encrypted(&path).map_err(|e| e.to_string())
}

/// Adopts a database file the user picked from somewhere else on disk (a
/// copy brought over from another machine, an external drive, a synced
/// folder) as a new profile — the counterpart to `create_profile`, which
/// always starts one empty. Opens `db_path` *before* touching the registry
/// or the live connection, so a bad pick (wrong file type, a corrupt file)
/// fails with a clear error and leaves everything exactly as it was; only a
/// file that actually opens as a Vault Spend database gets registered and
/// hot-swapped to, same "creating/adding a profile means start using it
/// now" convention as `create_profile`. The file itself is never copied or
/// moved — it stays wherever the user pointed at it.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn add_existing_profile(
    name: String,
    db_path: String,
    password: Option<String>,
    expected_generation: u64,
    app: tauri::AppHandle,
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
    sessions: tauri::State<crate::protection_session::Sessions>,
) -> Result<String, String> {
    if paths.current_generation() != expected_generation {
        return Err("The active profile changed before this profile could be added.".to_string());
    }
    let picked_path = std::path::PathBuf::from(&db_path);
    if !picked_path.exists() {
        return Err(format!("{} doesn't exist.", picked_path.display()));
    }
    if picked_path.is_dir() {
        let validated = validate_protected_package(&picked_path, password.as_deref().unwrap_or_default(), &sessions)?;
        let live_db_path = current_db_path(&paths);
        let (id, imported_db_path) = crate::profiles::plan_new_profile(&paths.config_path, &live_db_path, &name, chrono::Local::now().naive_local())?;
        let imported_dir = imported_db_path.parent().ok_or_else(|| "invalid imported profile path".to_string())?;
        std::fs::create_dir_all(imported_dir).map_err(|e| e.to_string())?;
        let prepare_result = (|| {
            let packaged_db = picked_path.join(budget_core::protection::package::DATABASE_FILENAME);
            std::fs::copy(&packaged_db, &imported_db_path).map_err(|e| format!("couldn't copy the package database: {e}"))?;
            let copied_hash = budget_core::protection::package::sha256_file(&imported_db_path)?;
            if copied_hash != validated.manifest.database_sha256 {
                return Err("The imported database copy did not verify.".to_string());
            }
            validated
                .key_file
                .write_to(&budget_core::protection::keyfile::key_file_path_for(&imported_db_path))
                .map_err(|e| e.to_string())?;
            AppState::open_with_key(&imported_db_path, budget_core::store::DatabaseKey::Raw(validated.dek.as_bytes()))
        })();
        let new_state = match prepare_result {
            Ok(state) => state,
            Err(error) => {
                let _ = std::fs::remove_dir_all(imported_dir);
                return Err(error);
            }
        };

        let runtime = &*state;
        let mut state = runtime.lock()?;
        if paths.current_generation() != expected_generation {
            return Err("The active profile changed before this profile could be added.".into());
        }
        if let Err(error) = crate::profiles::register_prepared_profile(
            &paths.config_path,
            &live_db_path,
            &id,
            &name,
            &imported_db_path,
            Some(crate::profiles::Protection::new(validated.manifest.protection_format)),
        ) {
            let _ = std::fs::remove_dir_all(imported_dir);
            return Err(error);
        }
        crate::config::write_db_location_config(&paths.config_path, &imported_db_path).map_err(|e| e.to_string())?;
        state.replace(new_state);
        *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = imported_db_path.clone();
        paths.bump_generation();
        let summary = crate::startup::after_profile_opened(
            &paths.config_path,
            &imported_db_path,
            &state.store,
            &device,
            chrono::Local::now().naive_local(),
        );
        runtime.set_notice(summary);
        // See `relocate_data_file`'s identical comments — `state` must be released first (it holds
        // the same mutex `arm_current_profile` locks internally) — the generation just bumped
        // above, and this is a newly-imported *protected* profile switching in for the first time,
        // so the timer must be armed for it now or automatic locking never engages for it at all
        // this session.
        drop(state);
        crate::auto_lock::arm_current_profile(&app);
        return Ok(name);
    }
    if budget_core::store::file_looks_encrypted(&picked_path).map_err(|e| e.to_string())? {
        let key_file_path = budget_core::protection::keyfile::key_file_path_for(&picked_path);
        if !key_file_path.exists() {
            return Err(
                "Choose the .vaultspend package folder, or a database with its matching .key file, not a bare encrypted database file.".to_string(),
            );
        }
        // A profile removed from the list ("forgot the password? remove this profile" or a plain
        // Delete) leaves exactly this shape on disk — an encrypted `.db` with its `.key` beside it,
        // no manifest — and the lock screen's own wording says it "can't be opened without the
        // password or recovery key", so re-adding it here with the right one must actually work.
        let key_file = budget_core::protection::keyfile::KeyFile::read(&key_file_path).map_err(|e| e.to_string())?;
        let dek = sessions
            .check_password(&key_file, password.as_deref().unwrap_or_default())
            .map_err(|error| {
                if error == "That password didn't work." {
                    "That password didn't work for this profile.".to_owned()
                } else {
                    error
                }
            })?;
        let new_state = AppState::open_with_key(&picked_path, budget_core::store::DatabaseKey::Raw(dek.as_bytes()))
            .map_err(|e| format!("Couldn't open {} as a Vault Spend data file: {e}", picked_path.display()))?;

        let runtime = &*state;
        let mut state = runtime.lock()?;
        if paths.current_generation() != expected_generation {
            return Err("The active profile changed before this profile could be added.".into());
        }
        let live_db_path = current_db_path(&paths);
        let profile = crate::profiles::add_existing_profile(
            &paths.config_path,
            &live_db_path,
            &name,
            &picked_path,
            Some(crate::profiles::Protection::new(budget_core::protection::keyfile::FORMAT)),
            chrono::Local::now().naive_local(),
        )?;

        crate::config::write_db_location_config(&paths.config_path, &picked_path).map_err(|e| e.to_string())?;
        state.replace(new_state);
        *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = picked_path.clone();
        paths.bump_generation();

        let summary = crate::startup::after_profile_opened(
            &paths.config_path,
            &picked_path,
            &state.store,
            &device,
            chrono::Local::now().naive_local(),
        );
        runtime.set_notice(summary);
        // `state` must be released before `arm_current_profile` — see the identical comment above.
        drop(state);
        crate::auto_lock::arm_current_profile(&app);
        return Ok(profile.name);
    }
    // Checked *before* AppState::open, which runs schema migrations that
    // create any table found missing — by the time it succeeds, even an
    // empty or completely unrelated SQLite file would look identical to
    // real data. This inspects the file exactly as picked, so the wrong
    // file is rejected with a clear reason instead of silently adopted as
    // a blank profile. Not filename-based on purpose — see
    // `looks_like_a_vault_spend_database`'s own doc comment.
    budget_core::store::looks_like_a_vault_spend_database(&picked_path)?;
    let new_state = AppState::open(&picked_path).map_err(|e| format!("Couldn't open {} as a Vault Spend data file: {e}", picked_path.display()))?;

    let runtime = &*state;
    let mut state = runtime.lock()?;
    let live_db_path = current_db_path(&paths);
    let profile = crate::profiles::add_existing_profile(
        &paths.config_path,
        &live_db_path,
        &name,
        &picked_path,
        None,
        chrono::Local::now().naive_local(),
    )?;

    // Config written before the live-state swap — see `create_profile`'s
    // comment on the same ordering. `new_state` was already proven openable
    // above, so this reordering costs nothing: the swap itself can't fail.
    crate::config::write_db_location_config(&paths.config_path, &picked_path).map_err(|e| e.to_string())?;
    state.replace(new_state);
    *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = picked_path.clone();
    paths.bump_generation();

    let summary = crate::startup::after_profile_opened(
        &paths.config_path,
        &picked_path,
        &state.store,
        &device,
        chrono::Local::now().naive_local(),
    );
    runtime.set_notice(summary);

    Ok(profile.name)
}

#[tauri::command]
pub fn rename_profile(
    id: String,
    new_name: String,
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
) -> Result<(), String> {
    let mut result = Ok(());
    device.update(|settings| {
        result = crate::profiles::rename_profile(&paths.config_path, &current_db_path(&paths), &id, &new_name);
        if result.is_ok() {
            if let Some(cached) = settings.reminder_index.get_mut(&id) {
                cached.profile_name = new_name.trim().to_owned();
            }
        }
    })?;
    result
}

/// Registry-only — the profile's own file is left on disk untouched (same
/// "old file left in place" philosophy as `relocate_data_file`). Refuses to
/// delete whichever profile is currently OPEN, but allows deleting one that's
/// merely LOCKED (its connection already closed the moment it was locked —
/// `AppPaths::db_path` still names it either way, so the runtime's own
/// status, not just the path, decides) — see `profiles::delete_profile`.
#[tauri::command]
pub fn delete_profile(
    id: String,
    paths: tauri::State<crate::config::AppPaths>,
    runtime: tauri::State<AppStateHandle>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
    mobile: tauri::State<crate::mobile_api::MobileAccess>,
) -> Result<(), String> {
    // Revoke before removing the registry entry: an I/O failure must never leave old grants
    // able to match a later profile with a reused internal ID.
    mobile.devices.remove_profile(&id)?;
    let currently_open = runtime.status() == crate::runtime::RuntimeStatus::Open;
    let mut result = Ok(());
    device.update(|settings| {
        result = crate::profiles::delete_profile(&paths.config_path, &current_db_path(&paths), currently_open, &id);
        if result.is_ok() {
            settings.remove_profile_reminders(&id);
        }
    })?;
    result
}

/// The four settings moved out of global browser storage into the profile database (plan v2
/// §4.12) — a bounded, typed set of keys, never an arbitrary storage passthrough.
#[tauri::command]
pub fn get_profile_ui_state(key: String, state: tauri::State<AppStateHandle>) -> Result<Option<String>, String> {
    let key = budget_core::store::UiStateKey::parse(&key).ok_or_else(|| format!("unknown UI state key: {key}"))?;
    let state = state.lock()?;
    state.store.get_ui_state(key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_profile_ui_state(
    key: String,
    value: String,
    expected_generation: u64,
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let key = budget_core::store::UiStateKey::parse(&key).ok_or_else(|| format!("unknown UI state key: {key}"))?;
    if paths.current_generation() != expected_generation {
        return Err("The active profile changed before this could be saved.".to_string());
    }
    let state = state.lock()?;
    state.store.set_ui_state(key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_ui_state_migrated(device: tauri::State<crate::device_settings::DeviceSettingsStore>) -> Result<(), String> {
    device.update(|s| s.ui_state_migrated = true)
}

#[tauri::command]
pub fn is_ui_state_migrated(device: tauri::State<crate::device_settings::DeviceSettingsStore>) -> bool {
    device.snapshot().ui_state_migrated
}
