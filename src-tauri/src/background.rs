//! The opt-in "keep running in the tray" behaviour: closing the window hides
//! it instead of quitting, a tray icon brings it back (or quits for real),
//! bills that fall due soon are reminded about even while the window is
//! closed, and — on Windows — Vault Spend can start hidden when the user
//! signs in. All of it is off until switched on in Settings.
use budget_core::store::BillReminder;
use chrono::NaiveDate;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent};
use tauri_plugin_notification::NotificationExt;

use crate::commands::AppStateHandle;
use crate::device_settings::DeviceSettingsStore;

const TRAY_ID: &str = "vaultspend-tray";
static EXITING: AtomicBool = AtomicBool::new(false);
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

/// What the reminder notification says: "Geico Auto — $120.00 due tomorrow" when `show_names` is
/// true, or a generic "A bill is due soon." when it is false — decision 9: an unlocked protected
/// profile without "Show bill names in reminders" turned on gets the generic text; an unprotected
/// profile always passes `true` (see `should_show_bill_names`).
pub fn reminder_body(reminder: &BillReminder, today: NaiveDate, show_names: bool) -> String {
    if !show_names {
        return "A bill is due soon.".to_string();
    }
    let days = (reminder.due_date - today).num_days();
    let when = match days {
        0 => "due today".to_string(),
        1 => "due tomorrow".to_string(),
        _ => format!("due {}", reminder.due_date.format("%b %-d")),
    };
    format!("{} — ${:.2} {}", reminder.merchant, reminder.amount.abs(), when)
}

/// Whether a reminder notification may name the bill and amount (decision 9): always for an
/// unprotected profile, and for a protected one only once "Show bill names in reminders" is on.
fn should_show_bill_names(is_encrypted: bool, setting: bool) -> bool {
    !is_encrypted || setting
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
    app.try_state::<DeviceSettingsStore>().map(|d| d.snapshot().tray_enabled).unwrap_or(false)
}

/// Puts the tray icon up when this computer's settings ask for it (a no-op if it is already there).
pub fn sync_tray_with_settings(app: &AppHandle) {
    if tray_enabled(app) {
        if let Err(e) = install_tray(app) {
            eprintln!("tray icon failed (continuing without it): {e}");
        }
    }
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
            "quit" => {
                EXITING.store(true, Ordering::SeqCst);
                app.exit(0);
            }
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
    if window.label() != MAIN_WINDOW || EXITING.load(Ordering::SeqCst) {
        return;
    }
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            if tray_enabled(window.app_handle()) {
                api.prevent_close();
                crate::auto_lock::queue_window_lock(window.app_handle(), crate::auto_lock::WindowLockTrigger::HiddenToTray);
                let _ = window.hide();
            } else {
                EXITING.store(true, Ordering::SeqCst);
            }
        }
        WindowEvent::Focused(false) => {
            crate::auto_lock::queue_window_lock(window.app_handle(), crate::auto_lock::WindowLockTrigger::FocusLost);
        }
        _ => {}
    }
}

/// Sends one notification through the operating system's own mechanism.
pub fn notify(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

/// Rebuild only the open profile's slice. Callers hold the runtime session, then acquire
/// device settings; never acquire the runtime while holding device settings. Raw row ids
/// stay inside this function and the live worker, never in the serialized cache.
pub fn refresh_reminder_index(
    config: &Path,
    db: &Path,
    store: &budget_core::store::Store,
    device: &DeviceSettingsStore,
    today: NaiveDate,
) -> Result<(), String> {
    let rows = store.reminder_projection(today).map_err(|e| e.to_string())?;
    device.update(|settings| {
        if let Some(profile) = crate::profiles::list_profiles(config, db).into_iter().find(|p| p.db_path == db) {
            settings.replace_reminders(&profile.id, &profile.name, index_entries(&rows));
        }
    })
}

fn index_entries(rows: &[budget_core::store::ReminderProjection]) -> Vec<crate::device_settings::ReminderIndexEntry> {
    rows.iter()
        .map(|r| crate::device_settings::ReminderIndexEntry {
            opaque_id: r.opaque_id.clone(),
            due_date: r.due_date.to_string(),
            last_notified: r.last_notified.map(|d| d.to_string()),
        })
        .collect()
}

fn deliver_index_reminders(
    settings: &mut crate::device_settings::DeviceSettings,
    open_id: Option<&str>,
    today: NaiveDate,
    mut send: impl FnMut(&str) -> Result<(), String>,
) {
    for (id, profile) in &mut settings.reminder_index {
        if Some(id.as_str()) == open_id {
            continue;
        }
        for row in &mut profile.entries {
            if row.is_due(today, REMINDER_WINDOW_DAYS) && send(&format!("A bill is due soon in {}", profile.profile_name)).is_ok() {
                row.last_notified = Some(today.to_string());
            }
        }
    }
}

/// Shared production worker with only the OS delivery boundary injectable. Holding an open
/// session through delivery prevents a full-text notification racing past a completed lock.
/// The device update serializes competing checks and sent markers. No Store is opened here.
pub fn run_reminder_check(
    runtime: &AppStateHandle,
    paths: &crate::config::AppPaths,
    device: &DeviceSettingsStore,
    today: NaiveDate,
    mut send: impl FnMut(&str) -> Result<(), String>,
) -> Result<(), String> {
    let session = runtime.lock().ok();
    let db = paths.db_path.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let projection = session
        .as_ref()
        .map(|s| s.store.reminder_projection(today))
        .transpose()
        .map_err(|e| e.to_string())?;
    let live = session
        .as_ref()
        .map(|s| s.store.reminders_to_send(today, REMINDER_WINDOW_DAYS))
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let show_names = session
        .as_ref()
        .is_some_and(|s| should_show_bill_names(s.store.is_encrypted(), s.store.show_bill_names_in_reminders().unwrap_or(false)));
    device.update(|settings| {
        let profiles = crate::profiles::list_profiles(&paths.config_path, &db);
        // Reconcile before delivering: deleted profiles cannot keep sending; names follow renames.
        settings.reminder_index.retain(|id, cached| {
            if let Some(p) = profiles.iter().find(|p| &p.id == id) {
                cached.profile_name.clone_from(&p.name);
                true
            } else {
                false
            }
        });
        let open = session.as_ref().and_then(|_| profiles.iter().find(|p| p.db_path == db));
        if let (Some(profile), Some(rows)) = (open, projection.as_ref()) {
            settings.replace_reminders(&profile.id, &profile.name, index_entries(rows));
        }
        if !settings.tray_enabled {
            return;
        }
        if let (Some(profile), Some(rows), Some(session)) = (open, projection.as_ref(), session.as_ref()) {
            for reminder in &live {
                let Some(row) = rows.iter().find(|r| r.recurring_id == reminder.recurring_id) else {
                    continue;
                };
                let due = reminder.due_date.to_string();
                let eligible = settings.reminder_index.get(&profile.id).is_some_and(|p| {
                    p.entries
                        .iter()
                        .any(|r| r.opaque_id == row.opaque_id && r.due_date == due && r.is_due(today, REMINDER_WINDOW_DAYS))
                });
                if eligible && send(&reminder_body(reminder, today, show_names)).is_ok() {
                    settings.mark_index_reminder_sent(&profile.id, &row.opaque_id, &due, &today.to_string());
                    let _ = session.store.mark_reminder_sent(reminder.recurring_id, reminder.due_date, today);
                }
            }
        }
        deliver_index_reminders(settings, open.map(|p| p.id.as_str()), today, &mut send);
    })
}

fn check_reminders(app: &AppHandle) {
    let result = run_reminder_check(
        &app.state::<AppStateHandle>(),
        &app.state::<crate::config::AppPaths>(),
        &app.state::<DeviceSettingsStore>(),
        chrono::Local::now().date_naive(),
        |body| notify(app, "Upcoming bill", body),
    );
    if result.is_err() {
        eprintln!("Could not refresh or save bill reminders.");
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

/// A sign-in start (`--minimized`) hides the window only when there is a tray icon to bring it back
/// from and a profile is open. A launch error is shown, never hidden.
pub fn should_hide_at_launch(minimized_flag: bool, tray_enabled: bool, profile_open: bool) -> bool {
    minimized_flag && tray_enabled && profile_open
}

/// Started from the sign-in entry (`--minimized`) with the tray on: keep the
/// window out of the way.
pub fn hide_if_started_minimized(app: &AppHandle) {
    let minimized = std::env::args().any(|a| a == MINIMIZED_FLAG);
    let profile_open = app.try_state::<AppStateHandle>().map(|s| s.is_open()).unwrap_or(false);
    if should_hide_at_launch(minimized, tray_enabled(app), profile_open) {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            let _ = window.hide();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;

    #[test]
    fn reminders_survive_lock_without_database_access_and_deduplicate_after_unlock() {
        use crate::{commands::AppState, config::AppPaths, runtime::AppRuntime};
        use std::sync::{atomic::AtomicU64, Mutex};
        let dir = std::env::temp_dir().join(format!("reminder-runtime-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("vaultspend.db");
        let paths = AppPaths {
            config_path: dir.join("config.json"),
            db_path: Mutex::new(db.clone()),
            generation: AtomicU64::new(0),
        };
        let device = DeviceSettingsStore::load(dir.join("device-settings.json"));
        let runtime = AppRuntime::no_profile_open();
        let state = AppState::open(&db).unwrap();
        let id = state
            .store
            .create_recurring("Secret Merchant", None, "-123.45".parse().unwrap(), "monthly", day("2026-09-20"), None)
            .unwrap();
        refresh_reminder_index(&paths.config_path, &db, &state.store, &device, day("2026-09-18")).unwrap();
        runtime.install(state);
        runtime.lock_profile("default");
        device.update(|s| s.tray_enabled = true).unwrap();
        let mut messages = Vec::new();
        run_reminder_check(&runtime, &paths, &device, day("2026-09-18"), |body| {
            messages.push(body.to_string());
            Ok(())
        })
        .unwrap();
        assert_eq!(messages, vec!["A bill is due soon in Default"]);
        assert!(!runtime.is_open());
        runtime.release_lock();
        run_reminder_check(&runtime, &paths, &device, day("2026-09-19"), |_| panic!("no-profile must not repeat")).unwrap();
        let state = AppState::open(&db).unwrap();
        assert_eq!(
            state.store.reminders_to_send(day("2026-09-18"), 3).unwrap()[0].recurring_id,
            id,
            "locked send must not mark the database"
        );
        runtime.install(state);
        run_reminder_check(&runtime, &paths, &device, day("2026-09-19"), |_| panic!("unlock must not repeat")).unwrap();
        run_reminder_check(&runtime, &paths, &device, day("2026-10-18"), |body| {
            messages.push(body.to_string());
            Ok(())
        })
        .unwrap();
        assert_eq!(messages[1], "Secret Merchant — $123.45 due Oct 20");
        run_reminder_check(&runtime, &paths, &device, day("2026-10-19"), |_| panic!("open send must not repeat")).unwrap();
        runtime.lock_profile("default");
        let text = std::fs::read_to_string(dir.join("device-settings.json")).unwrap();
        for forbidden in [
            "Secret Merchant",
            "123.45",
            "recurring_id",
            "transaction_id",
            "merchant",
            "amount",
            "category",
            "account",
            "notes",
        ] {
            assert!(!text.contains(forbidden), "cache leaked {forbidden}");
        }
    }

    #[test]
    fn failed_delivery_does_not_silence_the_index() {
        use crate::device_settings::{DeviceSettings, ReminderIndexEntry};
        let mut settings = DeviceSettings::default();
        settings.replace_reminders(
            "p",
            "Sam",
            vec![ReminderIndexEntry {
                opaque_id: "a".into(),
                due_date: "2026-09-20".into(),
                last_notified: None,
            }],
        );
        deliver_index_reminders(&mut settings, None, day("2026-09-18"), |_| Err("offline".into()));
        assert_eq!(settings.reminder_index["p"].entries[0].last_notified, None);
        let mut messages = vec![];
        deliver_index_reminders(&mut settings, None, day("2026-09-18"), |body| {
            messages.push(body.to_owned());
            Ok(())
        });
        assert_eq!(messages, vec!["A bill is due soon in Sam"]);
        assert_eq!(settings.reminder_index["p"].entries[0].last_notified.as_deref(), Some("2026-09-18"));
    }

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
            reminder_body(&reminder("Rent", "-1200", "2026-09-18"), today, true),
            "Rent — $1200.00 due today"
        );
        assert_eq!(
            reminder_body(&reminder("Geico Auto", "-120.5", "2026-09-19"), today, true),
            "Geico Auto — $120.50 due tomorrow"
        );
        assert_eq!(
            reminder_body(&reminder("Netflix", "-15.49", "2026-09-21"), today, true),
            "Netflix — $15.49 due Sep 21"
        );
    }

    #[test]
    fn reminder_body_names_the_bill_when_show_names_is_true() {
        let today = day("2026-09-21");
        let r = reminder("Geico Auto", "-120.00", "2026-09-22");

        assert_eq!(reminder_body(&r, today, true), "Geico Auto — $120.00 due tomorrow");
    }

    #[test]
    fn reminder_body_is_generic_when_show_names_is_false() {
        let today = day("2026-09-21");
        let r = reminder("Geico Auto", "-120.00", "2026-09-22");

        assert_eq!(reminder_body(&r, today, false), "A bill is due soon.");
    }

    // The live worker and compiled-app tests cover delivery; this matrix separately guards
    // the opt-in rule so protected profiles never inherit unprotected full-text defaults.
    #[test]
    fn should_show_bill_names_matrix() {
        assert!(should_show_bill_names(false, false), "unprotected: always real names, setting ignored");
        assert!(should_show_bill_names(false, true), "unprotected: always real names, setting ignored");
        assert!(!should_show_bill_names(true, false), "protected, setting off: generic");
        assert!(should_show_bill_names(true, true), "protected, setting on: real names");
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

    #[test]
    fn a_sign_in_start_hides_only_when_the_tray_is_on_and_a_profile_is_open() {
        assert!(should_hide_at_launch(true, true, true));
        assert!(!should_hide_at_launch(false, true, true), "an ordinary start shows the window");
        assert!(!should_hide_at_launch(true, false, true), "no tray means nowhere to bring it back from");
        assert!(!should_hide_at_launch(true, true, false), "a launch error must be seen, not hidden");
    }
}
