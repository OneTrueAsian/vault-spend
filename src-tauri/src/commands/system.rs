//! Commands: tray, start-up, reminders, the legal notice, updates, app-wide switches and maintenance.

use super::*;

#[derive(Serialize)]
pub struct BackgroundSettingsDto {
    pub tray_enabled: bool,
    pub autostart_enabled: bool,
    /// Whether "start when I sign in" can be turned on on this platform.
    pub autostart_supported: bool,
}

#[tauri::command]
pub fn get_background_settings(device: tauri::State<crate::device_settings::DeviceSettingsStore>) -> BackgroundSettingsDto {
    let settings = device.snapshot();
    BackgroundSettingsDto {
        tray_enabled: settings.tray_enabled,
        autostart_enabled: settings.autostart_enabled,
        autostart_supported: cfg!(windows),
    }
}

/// Turns "keep running in the tray and remind me about bills" on or off —
/// the tray icon appears or disappears straight away. A setting of this
/// computer, saved beside `config.json`.
#[tauri::command]
pub fn set_tray_enabled(
    enabled: bool,
    app: tauri::AppHandle,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
) -> Result<(), String> {
    device.update(|settings| settings.tray_enabled = enabled)?;
    if enabled {
        crate::background::install_tray(&app).map_err(|e| e.to_string())
    } else {
        crate::background::remove_tray(&app);
        Ok(())
    }
}

/// Starts (or stops) Vault Spend at sign-in. The setting is only saved once
/// the operating system accepted the change.
#[tauri::command]
pub fn set_autostart_enabled(enabled: bool, device: tauri::State<crate::device_settings::DeviceSettingsStore>) -> Result<(), String> {
    crate::background::set_autostart(enabled)?;
    device.update(|settings| settings.autostart_enabled = enabled)
}

#[derive(Serialize)]
pub struct LegalNoticeAcknowledgementDto {
    /// The notice version last acknowledged on this computer, if any.
    pub version: Option<String>,
    pub acknowledged_at: Option<String>,
    /// True only for an e2e run that asked to start past the notice (see `legal_notice_skipped`).
    pub skip: bool,
}

/// Which version of the legal notice this computer has acknowledged. Read before any profile opens.
#[tauri::command]
pub fn get_legal_notice_acknowledgement(device: tauri::State<crate::device_settings::DeviceSettingsStore>) -> LegalNoticeAcknowledgementDto {
    let settings = device.snapshot();
    LegalNoticeAcknowledgementDto {
        version: settings.legal_notice_version,
        acknowledged_at: settings.legal_notice_acknowledged_at,
        skip: crate::device_settings::legal_notice_skipped(std::env::var_os("VAULTSPEND_SKIP_LEGAL_NOTICE"), std::env::var_os("VAULTSPEND_DB_DIR")),
    }
}

/// Records that the person has seen `version` of the legal notice. The time is stamped here, not taken
/// from the page.
#[tauri::command]
pub fn acknowledge_legal_notice(version: String, device: tauri::State<crate::device_settings::DeviceSettingsStore>) -> Result<(), String> {
    let at = chrono::Utc::now().to_rfc3339();
    device.update(|settings| settings.acknowledge_legal_notice(&version, &at))
}

/// Sends a sample reminder so the user can see what one looks like and that
/// notifications get through.
#[tauri::command]
pub fn send_test_reminder(app: tauri::AppHandle) -> Result<(), String> {
    crate::background::notify(
        &app,
        "Vault Spend reminders are on",
        "This is what an upcoming-bill reminder will look like.",
    )
}

/// The frontend had no reason to know its own copy of `AppPaths::generation` before Phase C —
/// `set_profile_ui_state`'s staleness guard is the first frontend-initiated write that needs it.
#[tauri::command]
pub fn get_current_generation(paths: tauri::State<crate::config::AppPaths>) -> u64 {
    paths.current_generation()
}

/// The newest published release, for `UpdateBanner.tsx`'s launch check.
#[tauri::command]
pub async fn fetch_latest_release() -> Result<crate::updater::LatestRelease, String> {
    crate::updater::fetch_latest_release().await
}

/// Global feature toggles shown as switches under Settings — see
/// `budget_core::StoredAppSettings` for what turning each one off does
/// (and, for `envelope_caps_enabled`, does *not* do to stored data).
#[derive(Serialize)]
pub struct AppSettingsDto {
    pub apply_to_debt_enabled: bool,
    pub split_purchases_enabled: bool,
    pub envelope_caps_enabled: bool,
    pub rollover_enabled: bool,
    pub auto_link_transfers: bool,
    pub safe_to_spend_enabled: bool,
}

#[tauri::command]
pub fn get_app_settings(state: tauri::State<AppStateHandle>) -> Result<AppSettingsDto, String> {
    let state = state.lock()?;
    let settings = state.store.get_app_settings().map_err(|e| e.to_string())?;
    Ok(AppSettingsDto {
        apply_to_debt_enabled: settings.apply_to_debt_enabled,
        split_purchases_enabled: settings.split_purchases_enabled,
        envelope_caps_enabled: settings.envelope_caps_enabled,
        rollover_enabled: settings.rollover_enabled,
        auto_link_transfers: settings.auto_link_transfers,
        safe_to_spend_enabled: settings.safe_to_spend_enabled,
    })
}

#[tauri::command]
pub fn set_apply_to_debt_enabled(enabled: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.set_apply_to_debt_enabled(enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_split_purchases_enabled(enabled: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.set_split_purchases_enabled(enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_envelope_caps_enabled(enabled: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.set_envelope_caps_enabled(enabled).map_err(|e| e.to_string())
}

/// The global "Rollover unspent" switch (Settings). Off stops unspent budget
/// carrying into the next month without touching any stored budget or any
/// category's own choice.
#[tauri::command]
pub fn set_rollover_enabled(enabled: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.set_rollover_enabled(enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_safe_to_spend_enabled(enabled: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.set_safe_to_spend_enabled(enabled).map_err(|e| e.to_string())
}

/// The opt-in "link matching transfers automatically" switch (Settings).
/// Turning it ON also links the clear-cut pairs already in the ledger, and
/// returns how many that was (so the app can say so); turning it off returns 0
/// and leaves existing links alone.
#[tauri::command]
pub fn set_auto_link_transfers(enabled: bool, state: tauri::State<AppStateHandle>) -> Result<usize, String> {
    let state = state.lock()?;
    state.store.set_auto_link_transfers(enabled).map_err(|e| e.to_string())?;
    if enabled {
        Ok(state.store.auto_link_transfers().map_err(|e| e.to_string())?.len())
    } else {
        Ok(0)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RolledAccountDto {
    pub account_id: i64,
    pub account_name: String,
    pub new_balance: String,
}

/// What opening the profile's housekeeping did (this month's roll-forward, automatic sinking-fund
/// contributions), for the page's one-time "here's what changed" notes. The work itself runs in
/// `startup::after_profile_opened`, never from the page; this hands the result over once and needs
/// an open profile like every other read.
#[tauri::command]
pub fn take_maintenance_summary(state: tauri::State<AppStateHandle>) -> Result<crate::maintenance::MaintenanceSummary, String> {
    state.take_notice()
}
