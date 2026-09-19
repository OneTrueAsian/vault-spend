//! The opt-in "keep running in the tray" behaviour: closing the window hides
//! it instead of quitting, a tray icon brings it back (or quits for real),
//! bills that fall due soon are reminded about even while the window is
//! closed, and — on Windows — Vault Spend can start hidden when the user
//! signs in. All of it is off until switched on in Settings.
use budget_core::store::BillReminder;
use chrono::NaiveDate;
use std::path::Path;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent};
use tauri_plugin_notification::NotificationExt;

use crate::commands::AppStateHandle;

const TRAY_ID: &str = "vaultspend-tray";
const MAIN_WINDOW: &str = "main";
/// A bill counts as "due soon" from today through this many days out — the
/// same window the Dashboard's To do list uses.
const REMINDER_WINDOW_DAYS: i64 = 3;
const REMINDER_CHECK_EVERY: Duration = Duration::from_secs(30 * 60);
/// Windows' per-user startup list.
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "VaultSpend";
/// Passed by the sign-in entry so the app starts hidden in the tray.
pub const MINIMIZED_FLAG: &str = "--minimized";

/// What the reminder notification says: "Geico Auto — $120.00 due tomorrow".
pub fn reminder_body(reminder: &BillReminder, today: NaiveDate) -> String {
    let days = (reminder.due_date - today).num_days();
    let when = match days {
        0 => "due today".to_string(),
        1 => "due tomorrow".to_string(),
        _ => format!("due {}", reminder.due_date.format("%b %-d")),
    };
    format!("{} — ${:.2} {}", reminder.merchant, reminder.amount.abs(), when)
}

/// The `reg` invocation that adds (or removes) Vault Spend from the Windows
/// sign-in list. Built as plain arguments so it can be checked without
/// touching the registry.
pub fn autostart_reg_args(enable: bool, exe: &Path) -> Vec<String> {
    if enable {
        vec![
            "add".to_string(),
            RUN_KEY.to_string(),
            "/v".to_string(),
            RUN_VALUE.to_string(),
            "/t".to_string(),
            "REG_SZ".to_string(),
            "/d".to_string(),
            format!("\"{}\" {MINIMIZED_FLAG}", exe.display()),
            "/f".to_string(),
        ]
    } else {
        vec![
            "delete".to_string(),
            RUN_KEY.to_string(),
            "/v".to_string(),
            RUN_VALUE.to_string(),
            "/f".to_string(),
        ]
    }
}

/// Starts (or stops) Vault Spend at sign-in. Windows only for now — the
/// other platforms keep their own login-item mechanisms, which this doesn't
/// touch.
pub fn set_autostart(enable: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let output = std::process::Command::new("reg")
            .args(autostart_reg_args(enable, &exe))
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output()
            .map_err(|e| e.to_string())?;
        // Removing an entry that was never there isn't a failure.
        if !output.status.success() && enable {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = enable;
        Err("Starting Vault Spend at sign-in is only available on Windows for now.".to_string())
    }
}

fn tray_enabled(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<AppStateHandle>() else {
        return false;
    };
    let Ok(guard) = state.lock() else {
        return false;
    };
    guard.store.get_background_settings().map(|s| s.tray_enabled).unwrap_or(false)
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Puts the tray icon up (a no-op if it's already there).
pub fn install_tray(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let open = MenuItem::with_id(app, "open", "Open Vault Spend", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Vault Spend")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Takes the tray icon down again.
pub fn remove_tray(app: &AppHandle) {
    let _ = app.remove_tray_by_id(TRAY_ID);
}

/// With the tray on, closing the main window tucks it away instead of
/// quitting; with it off the window closes the app as it always did.
pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != MAIN_WINDOW {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        if tray_enabled(window.app_handle()) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

/// Sends one notification through the operating system's own mechanism.
pub fn notify(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

/// One pass of the reminder check: if the tray is on, remind about each bill
/// due soon that hasn't been reminded about for that due date yet.
fn check_reminders(app: &AppHandle) {
    let Some(state) = app.try_state::<AppStateHandle>() else {
        return;
    };
    let Ok(guard) = state.lock() else {
        return;
    };
    let Ok(settings) = guard.store.get_background_settings() else {
        return;
    };
    if !settings.tray_enabled {
        return;
    }
    let today = chrono::Local::now().date_naive();
    let Ok(reminders) = guard.store.reminders_to_send(today, REMINDER_WINDOW_DAYS) else {
        return;
    };
    for reminder in reminders {
        if notify(app, "Upcoming bill", &reminder_body(&reminder, today)).is_ok() {
            let _ = guard.store.mark_reminder_sent(reminder.recurring_id, reminder.due_date, today);
        }
    }
}

/// Checks for bills due soon shortly after launch and then every half hour,
/// for as long as the app (or its tray icon) is running.
pub fn start_reminder_thread(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20));
        loop {
            check_reminders(&app);
            std::thread::sleep(REMINDER_CHECK_EVERY);
        }
    });
}

/// Started from the sign-in entry (`--minimized`) with the tray on: keep the
/// window out of the way.
pub fn hide_if_started_minimized(app: &AppHandle) {
    let minimized = std::env::args().any(|a| a == MINIMIZED_FLAG);
    if minimized && tray_enabled(app) {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            let _ = window.hide();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;

    fn reminder(merchant: &str, amount: &str, due: &str) -> BillReminder {
        BillReminder {
            recurring_id: 1,
            merchant: merchant.to_string(),
            amount: amount.parse::<Decimal>().unwrap(),
            due_date: due.parse().unwrap(),
        }
    }

    fn day(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }

    #[test]
    fn the_reminder_says_what_and_how_much_and_when() {
        let today = day("2026-09-18");

        assert_eq!(
            reminder_body(&reminder("Rent", "-1200", "2026-09-18"), today),
            "Rent — $1200.00 due today"
        );
        assert_eq!(
            reminder_body(&reminder("Geico Auto", "-120.5", "2026-09-19"), today),
            "Geico Auto — $120.50 due tomorrow"
        );
        assert_eq!(
            reminder_body(&reminder("Netflix", "-15.49", "2026-09-21"), today),
            "Netflix — $15.49 due Sep 21"
        );
    }

    #[test]
    fn adding_to_the_sign_in_list_names_the_exe_and_asks_for_a_hidden_start() {
        let args = autostart_reg_args(true, Path::new(r"C:\Apps\Vault Spend\vaultspend.exe"));

        assert_eq!(args[0], "add");
        assert!(args.contains(&RUN_KEY.to_string()));
        assert!(args.contains(&"VaultSpend".to_string()));
        assert!(args.contains(&"/f".to_string()));
        let data = args.iter().position(|a| a == "/d").map(|i| args[i + 1].clone()).unwrap();
        assert_eq!(
            data, r#""C:\Apps\Vault Spend\vaultspend.exe" --minimized"#,
            "the path is quoted so a space in it survives"
        );
    }

    #[test]
    fn removing_from_the_sign_in_list_deletes_just_our_value() {
        let args = autostart_reg_args(false, Path::new("ignored.exe"));

        assert_eq!(args, vec!["delete", RUN_KEY, "/v", "VaultSpend", "/f"]);
    }
}
