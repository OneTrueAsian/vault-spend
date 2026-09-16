//! Persists the main window's size — never position, since a saved
//! position could point at a monitor that's no longer connected, leaving
//! the window stuck off-screen with no way to reach it — across launches,
//! so resizing past the 800x600 default doesn't have to be redone every
//! time the app opens.
//!
//! Deliberately hand-rolled instead of pulling in
//! `tauri-plugin-window-state`: that plugin always resolves its storage
//! path via `app.path().app_data_dir()`, with no way to point it anywhere
//! else — exactly the real-AppData path the `VAULTSPEND_DB_DIR` handling
//! in `lib.rs::run` was written to avoid touching from debug/E2E builds
//! (see the comment there). Writing this file into the same directory as
//! config.json/the database instead means it automatically inherits that
//! same isolation for free, with no risk of concurrent E2E runs racing
//! on one shared real file.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, WindowEvent};

const FILENAME: &str = "window-state.json";
const MIN_WIDTH: f64 = 400.0;
const MIN_HEIGHT: f64 = 300.0;

#[derive(Serialize, Deserialize)]
struct WindowState {
    width: f64,
    height: f64,
    maximized: bool,
}

fn state_path(dir: &Path) -> PathBuf {
    dir.join(FILENAME)
}

fn load(dir: &Path) -> Option<WindowState> {
    let raw = std::fs::read_to_string(state_path(dir)).ok()?;
    let state: WindowState = serde_json::from_str(&raw).ok()?;
    if state.width < MIN_WIDTH || state.height < MIN_HEIGHT {
        return None; // nonsensical — fall back to the config default rather than trust it
    }
    Some(state)
}

fn save(dir: &Path, state: &WindowState) {
    if let Ok(json) = serde_json::to_string(state) {
        let _ = std::fs::write(state_path(dir), json);
    }
}

/// Applies any saved size/maximized state to the app's "main" window, then
/// shows it — it starts hidden (see `tauri.conf.json`) specifically so
/// this can happen before the user ever sees the 800x600 default flash by
/// — and registers a listener that keeps the saved state up to date. A
/// no-op if "main" doesn't exist, which shouldn't happen but must never
/// block startup if it somehow does.
pub fn restore_and_track(app: &AppHandle, dir: &Path) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if let Some(state) = load(dir) {
        let _ = window.set_size(tauri::LogicalSize::new(state.width, state.height));
        if state.maximized {
            let _ = window.maximize();
        }
    }
    let _ = window.show();
    let _ = window.set_focus();

    let dir = dir.to_path_buf();
    let tracked_window = window.clone();
    window.on_window_event(move |event| {
        // Saved on every resize/move settling, not only on a clean
        // `CloseRequested` — verified against a real native window that a
        // killed process (or, as found while verifying this, WebDriver's
        // own way of tearing a session down) never reaches `CloseRequested`
        // at all, so relying on it alone would silently lose the resize
        // that motivated this feature in the first place.
        let should_save = matches!(event, WindowEvent::CloseRequested { .. } | WindowEvent::Resized(_) | WindowEvent::Moved(_));
        if !should_save {
            return;
        }
        let maximized = tracked_window.is_maximized().unwrap_or(false);
        if let (Ok(size), Ok(scale)) = (tracked_window.inner_size(), tracked_window.scale_factor()) {
            let logical = size.to_logical::<f64>(scale);
            save(&dir, &WindowState { width: logical.width, height: logical.height, maximized });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-window-state-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn load_returns_none_when_no_file_exists_yet() {
        let dir = temp_dir("missing");
        assert!(load(&dir).is_none());
    }

    #[test]
    fn save_then_load_round_trips_the_saved_size_and_maximized_flag() {
        let dir = temp_dir("roundtrip");
        save(&dir, &WindowState { width: 1280.0, height: 800.0, maximized: true });

        let loaded = load(&dir).unwrap();

        assert_eq!(loaded.width, 1280.0);
        assert_eq!(loaded.height, 800.0);
        assert!(loaded.maximized);
    }

    #[test]
    fn load_rejects_a_saved_size_below_the_minimum() {
        let dir = temp_dir("too-small");
        save(&dir, &WindowState { width: 100.0, height: 100.0, maximized: false });

        assert!(load(&dir).is_none());
    }

    #[test]
    fn load_ignores_a_corrupted_file_instead_of_panicking() {
        let dir = temp_dir("corrupt");
        std::fs::write(state_path(&dir), "not valid json").unwrap();

        assert!(load(&dir).is_none());
    }
}
