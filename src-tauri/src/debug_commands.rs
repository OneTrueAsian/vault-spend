//! Test-only surface that must never compile into a release build. `debug_process_id` lets an e2e
//! test learn the exact OS process id of the running app — `tauri-driver` launches the app as its
//! own child, so nothing else hands a test that PID, and the crash-recovery tests (Task 9) need to
//! kill this exact process, never one found by name (which could hit the owner's own installed copy).
#[cfg(debug_assertions)]
#[tauri::command]
pub fn debug_process_id() -> u32 {
    std::process::id()
}
