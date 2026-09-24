//! Test-only surface that must never compile into a release build. `debug_process_id` lets an e2e
//! test learn the exact OS process id of the running app — `tauri-driver` launches the app as its
//! own child, so nothing else hands a test that PID, and the crash-recovery tests (Task 9) need to
//! kill this exact process, never one found by name (which could hit the owner's own installed copy).
#[cfg(debug_assertions)]
#[tauri::command]
pub fn debug_process_id() -> u32 {
    std::process::id()
}

/// Debug-build-only probe used by compiled-app E2E until the real recovery flow lands in Task 5.
/// It returns only a boolean and never logs or serializes the recovery code or unwrapped key.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn debug_recovery_code_unlocks(code: String, paths: tauri::State<crate::config::AppPaths>) -> Result<bool, String> {
    let db_path = paths.db_path.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let key_file =
        budget_core::protection::keyfile::KeyFile::read(&budget_core::protection::keyfile::key_file_path_for(&db_path)).map_err(|e| e.to_string())?;
    let parsed = match budget_core::protection::recovery::RecoveryCode::parse(&code) {
        Ok(code) => code,
        Err(_) => return Ok(false),
    };
    Ok(key_file.unlock_with_recovery(&parsed).is_ok())
}

/// Advances only the managed automatic-lock clock. This deterministic seam is compiled out of
/// release builds and lets desktop E2E prove warning/cancellation/expiry without changing release
/// timeout choices or waiting a real minute.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn debug_advance_auto_lock(seconds: u64, app: tauri::AppHandle) -> Result<(), String> {
    crate::auto_lock::advance_debug_clock(&app, seconds)
}
