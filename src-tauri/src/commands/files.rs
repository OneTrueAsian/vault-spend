//! Commands: where the data file lives, moving and exporting it, protected packages, and backups.

use super::*;

#[cfg(test)]
mod tests;

#[tauri::command]
pub fn get_data_file_location(paths: tauri::State<crate::config::AppPaths>) -> String {
    current_db_path(&paths).to_string_lossy().to_string()
}

/// Copies the live database to `new_dir/vaultspend.db` (via `Store::backup_to`,
/// safe against a live connection), points `config.json` at it, then swaps
/// this session's live connection over to the new file in place. The old
/// file is deliberately left behind, untouched.
///
/// This used to ask for (and, briefly, automatically trigger) a full app
/// restart instead. Automatic restart via `tauri-plugin-process`'s
/// `relaunch()` turned out to be unreliable on Windows in real testing — a
/// second WebView2 instance racing the first one's teardown occasionally
/// left the relaunched window stuck on a native "can't reach this page"
/// error (a `Chrome_WidgetWin_0` window-class unregister failure). Hot-
/// swapping the connection instead sidesteps that whole class of bug by
/// never opening a second window at all.
#[tauri::command]
pub fn relocate_data_file(
    new_dir: String,
    app: tauri::AppHandle,
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
) -> Result<String, String> {
    let old_live_path = current_db_path(&paths);
    let new_dir = std::path::PathBuf::from(new_dir);
    std::fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
    let new_db_path = new_dir.join("vaultspend.db");
    if new_db_path.exists() {
        return Err(format!("{} already has a vaultspend.db — pick an empty folder.", new_dir.display()));
    }

    let runtime = &*state;
    let mut state = runtime.lock()?;
    copy_database_for_relocation(&state.store, &old_live_path, &new_db_path)?;
    crate::config::write_db_location_config(&paths.config_path, &new_db_path).map_err(|e| e.to_string())?;
    let reopened = match state.store.db_key_bytes() {
        Some(key) => AppState::open_with_key(&new_db_path, budget_core::store::DatabaseKey::Raw(key))?,
        None => AppState::open(&new_db_path)?,
    };
    *state = reopened;
    *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = new_db_path.clone();
    paths.bump_generation();
    // If the profile that was just live is a registered profile (not the
    // plain, never-used-profiles Default), keep its registry entry pointing
    // at the moved file — otherwise switching away and back later would
    // silently reopen the stale pre-relocate copy. A no-op when
    // profiles.json doesn't exist yet.
    crate::profiles::update_active_db_path(&paths.config_path, &old_live_path, &new_db_path)?;
    // The page remounts after this and no longer runs the month's housekeeping itself.
    runtime.set_notice(crate::maintenance::run_open_profile_maintenance(
        &state.store,
        chrono::Local::now().date_naive(),
    ));
    // Must run after `state` (the open-session guard) is released: `arm_current_profile` calls
    // `runtime.is_open()`, which locks the very same mutex `state` is still holding — calling it
    // any earlier deadlocks this command forever.
    drop(state);
    // The generation just bumped above — the automatic-lock timer must be re-armed against the new
    // one (same as `startup::activate`/`set_auto_lock_settings`), or every lock trigger from here on
    // is rejected as stale and automatic locking silently stops for the rest of this session.
    crate::auto_lock::arm_current_profile(&app);

    Ok(new_db_path.to_string_lossy().to_string())
}

fn copy_database_for_relocation(store: &Store, old_live_path: &std::path::Path, new_db_path: &std::path::Path) -> Result<(), String> {
    store.backup_to(new_db_path).map_err(|e| e.to_string())?;
    if store.is_encrypted() {
        let source_key = budget_core::protection::keyfile::key_file_path_for(old_live_path);
        let destination_key = budget_core::protection::keyfile::key_file_path_for(new_db_path);
        if let Err(error) = std::fs::copy(&source_key, &destination_key) {
            let _ = std::fs::remove_file(new_db_path);
            return Err(format!("couldn't move the profile's key file: {error}"));
        }
    }
    Ok(())
}

/// Copies the live database to an exact file path the user picked via a
/// native save dialog — unlike `relocate_data_file`, this never changes
/// what the app is actively using; it's a one-off copy for backing up to
/// a USB drive, a cloud-synced folder, or bringing to another computer.
/// Safe against the live connection (`Store::backup_to`'s SQLite online
/// backup API), so nothing needs to pause or lock while this runs.
#[tauri::command]
pub fn export_database(destination: String, paths: tauri::State<crate::config::AppPaths>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    if state.store.is_encrypted() {
        let live_path = current_db_path(&paths);
        let profile_name = crate::profiles::list_profiles(&paths.config_path, &live_path)
            .into_iter()
            .find(|profile| profile.is_active)
            .map(|profile| profile.name)
            .unwrap_or_else(|| "Default".to_string());
        return export_protected_package(
            std::path::Path::new(&destination),
            &profile_name,
            &live_path,
            &state.store,
            &chrono::Utc::now().to_rfc3339(),
        );
    }
    state.store.backup_to(&destination).map_err(|e| e.to_string())
}

fn export_protected_package(
    destination: &std::path::Path,
    profile_name: &str,
    source_db_path: &std::path::Path,
    store: &Store,
    exported_at: &str,
) -> Result<(), String> {
    use budget_core::protection::package::{sha256_file, DATABASE_FILENAME, MANIFEST_FILENAME};
    use budget_core::protection::{PackageManifest, PACKAGE_FORMAT};

    if destination.exists() {
        return Err(format!("{} already exists. Choose a new package name.", destination.display()));
    }
    std::fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    let result = (|| {
        let database_path = destination.join(DATABASE_FILENAME);
        store.backup_to(&database_path).map_err(|e| e.to_string())?;
        let source_key_path = budget_core::protection::keyfile::key_file_path_for(source_db_path);
        let destination_key_path = budget_core::protection::keyfile::key_file_path_for(&database_path);
        std::fs::copy(&source_key_path, &destination_key_path).map_err(|e| format!("couldn't copy the profile's key file: {e}"))?;
        let key_file = budget_core::protection::keyfile::KeyFile::read(&destination_key_path).map_err(|e| e.to_string())?;
        let manifest = PackageManifest {
            format: PACKAGE_FORMAT,
            profile_name: profile_name.to_string(),
            protection_format: key_file.format,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            schema_user_version: store.schema_user_version().map_err(|e| e.to_string())?,
            database_sha256: sha256_file(&database_path)?,
            exported_at: exported_at.to_string(),
        };
        std::fs::write(destination.join(MANIFEST_FILENAME), manifest.to_json()).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(destination);
    }
    result
}

#[derive(Serialize)]
pub struct BackupDto {
    pub filename: String,
    pub created_at: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub fn list_backups(paths: tauri::State<crate::config::AppPaths>, state: tauri::State<AppStateHandle>) -> Result<Vec<BackupDto>, String> {
    let is_encrypted = state.lock()?.store.is_encrypted();
    let backups_dir = crate::backups::backups_dir_for(&current_db_path(&paths), is_encrypted);
    Ok(crate::backups::list_backups(&backups_dir, is_encrypted)?
        .into_iter()
        .map(|b| BackupDto {
            filename: b.filename,
            created_at: b.created_at,
            size_bytes: b.size_bytes,
        })
        .collect())
}

#[derive(Serialize)]
pub struct BackupNowDto {
    pub filename: String,
    /// The second folder the backup was also copied to, when one is set and it worked.
    pub copied_to: Option<String>,
    /// Why the second copy failed, when one is set and it did not work.
    pub copy_error: Option<String>,
}

/// Manual "Back up now" — always creates one, bypassing the 24h automatic
/// throttle (`backups::create_backup_if_due`, called only at launch). Also
/// copies it to the second backup folder when one is set.
#[tauri::command]
pub fn create_backup_now(
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
) -> Result<BackupNowDto, String> {
    let state = state.lock()?;
    let db_path = current_db_path(&paths);
    let backups_dir = crate::backups::backups_dir_for(&db_path, state.store.is_encrypted());
    let copy_dir = device
        .snapshot()
        .backup_mirror_dir(&active_profile_id(&paths))
        .map(std::path::PathBuf::from);
    let outcome = crate::backups::create_backup_full(
        &state.store,
        &db_path,
        &backups_dir,
        copy_dir.as_deref(),
        chrono::Local::now().naive_local(),
    )?;
    Ok(BackupNowDto {
        filename: outcome.filename,
        copied_to: outcome.copied_to.map(|p| p.parent().map(|d| d.display().to_string()).unwrap_or_default()),
        copy_error: outcome.copy_error,
    })
}

/// The second folder every backup of this profile is also copied to, if one is set.
#[tauri::command]
pub fn get_backup_copy_dir(
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
) -> Result<Option<String>, String> {
    Ok(device.snapshot().backup_mirror_dir(&active_profile_id(&paths)).map(str::to_string))
}

/// Sets (or clears, with `None`) the second backup folder. A folder is
/// checked before it's saved — usable, writable, not the primary backups
/// folder — and the newest existing backup is copied into it straight away,
/// so "it works" is shown rather than promised. Returns a sentence for the
/// user.
#[tauri::command]
pub fn set_backup_copy_dir(
    dir: Option<String>,
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
) -> Result<String, String> {
    let profile_id = active_profile_id(&paths);
    let dir = dir.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
    let Some(dir) = dir else {
        device.update(|settings| {
            settings.backup_mirror_dirs.remove(&profile_id);
        })?;
        return Ok("Backups will no longer be copied to a second folder.".to_string());
    };

    let is_encrypted = state.lock()?.store.is_encrypted();
    let backups_dir = crate::backups::backups_dir_for(&current_db_path(&paths), is_encrypted);
    let copy_dir = std::path::Path::new(&dir);
    crate::backups::check_copy_dir(&backups_dir, copy_dir)?;
    let newest = crate::backups::list_backups(&backups_dir, is_encrypted)?.into_iter().next();
    let copied_now = match newest {
        Some(b) => {
            crate::backups::mirror_backup(&backups_dir, &b.filename, copy_dir)?;
            true
        }
        None => false,
    };
    device.update(|settings| {
        settings.backup_mirror_dirs.insert(profile_id.clone(), dir.clone());
    })?;
    Ok(if copied_now {
        format!("Every backup will also be copied to {dir}. The latest one is there now.")
    } else {
        format!("Every backup will also be copied to {dir}, starting with the next one.")
    })
}

/// Restores `filename` into a brand-new file (see `backups::restore_backup`
/// for why it's never written into the already-open live path), points
/// `config.json` at it, and swaps this session's live connection over to it
/// — same in-place hot-swap as `relocate_data_file`, and for the same
/// reason (see its doc comment).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn restore_backup(
    filename: String,
    password: Option<String>,
    expected_generation: u64,
    app: tauri::AppHandle,
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
    sessions: tauri::State<crate::protection_session::Sessions>,
) -> Result<(), String> {
    if paths.current_generation() != expected_generation {
        return Err("The active profile changed before the backup could be restored.".to_string());
    }
    let runtime = &*state;
    let mut state = runtime.lock()?;
    let live_db_path = current_db_path(&paths);
    let is_encrypted = state.store.is_encrypted();
    let backups_dir = crate::backups::backups_dir_for(&live_db_path, is_encrypted);
    let copy_dir = device
        .snapshot()
        .backup_mirror_dir(&active_profile_id(&paths))
        .map(std::path::PathBuf::from);
    let profile_id = active_profile_id(&paths);
    let mut restored_key_file = None;
    let restored_dek = if is_encrypted {
        let remaining = sessions.delay_remaining(&profile_id);
        if !remaining.is_zero() {
            return Err(format!("Try again in {} seconds.", remaining.as_secs().max(1)));
        }
        let backup_path = backups_dir.join(&filename);
        let key_file = budget_core::protection::keyfile::KeyFile::read(&budget_core::protection::keyfile::key_file_path_for(&backup_path))
            .map_err(|e| e.to_string())?;
        match key_file.unlock_with_password(password.as_deref().unwrap_or_default()) {
            Ok(dek) => {
                sessions.record_success(&profile_id);
                restored_key_file = Some(key_file);
                Some(dek)
            }
            Err(_) => {
                sessions.record_failure(&profile_id);
                return Err("That password didn't work for this backup.".to_string());
            }
        }
    } else {
        None
    };
    let restored_path = match restored_dek.as_ref() {
        Some(dek) => crate::backups::restore_backup_with_key(
            &state.store,
            &backups_dir,
            copy_dir.as_deref(),
            &filename,
            &live_db_path,
            budget_core::store::DatabaseKey::Raw(dek.as_bytes()),
        )?,
        None => crate::backups::restore_backup(&state.store, &backups_dir, copy_dir.as_deref(), &filename, &live_db_path)?,
    };
    if let Some(key_file) = restored_key_file {
        key_file
            .write_to(&budget_core::protection::keyfile::key_file_path_for(&restored_path))
            .map_err(|e| e.to_string())?;
    }
    crate::config::write_db_location_config(&paths.config_path, &restored_path).map_err(|e| e.to_string())?;
    let reopened = match restored_dek.as_ref() {
        Some(dek) => AppState::open_with_key(&restored_path, budget_core::store::DatabaseKey::Raw(dek.as_bytes()))?,
        None => AppState::open(&restored_path)?,
    };
    *state = reopened;
    // Same registry-sync reasoning as `relocate_data_file` — do this before
    // `restored_path` is moved into `paths.db_path` below.
    crate::profiles::update_active_db_path(&paths.config_path, &live_db_path, &restored_path)?;
    *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = restored_path;
    paths.bump_generation();
    // The page remounts after this and no longer runs the month's housekeeping itself. A backup from
    // an earlier month needs this month's roll-forward as much as a freshly opened profile does.
    runtime.set_notice(crate::maintenance::run_open_profile_maintenance(
        &state.store,
        chrono::Local::now().date_naive(),
    ));
    // See `relocate_data_file`'s identical comments — `state` must be released before calling
    // `arm_current_profile` (it locks the same mutex `state` still holds) — the generation just
    // bumped above and the automatic-lock timer must be re-armed against it, or lock triggers
    // silently stop working.
    drop(state);
    crate::auto_lock::arm_current_profile(&app);
    Ok(())
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(content.as_bytes());
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}
