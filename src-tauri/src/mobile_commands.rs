//! Desktop IPC only. These commands are never bridged onto HTTP.
use crate::mobile_server::{MobileConfig, MobileService, MobileStatus, PublicCertificate};
use tauri::Manager;
use tauri::State;
#[tauri::command]
pub async fn mobile_export_certificate(service: State<'_, MobileService>, path: String) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let public = service.public_certificate()?;
        budget_core::fsutil::write_atomic(std::path::Path::new(&path), public.pem.as_bytes())
            .map_err(|_| "The public certificate could not be saved.".to_string())
    })
    .await
    .map_err(|_| "The public certificate could not be exported.".to_string())?
}
#[tauri::command]
pub fn mobile_saved_config(service: State<'_, MobileService>) -> Result<Option<MobileConfig>, String> {
    service.saved_config()
}
#[tauri::command]
pub async fn mobile_reset_trust(app: tauri::AppHandle, service: State<'_, MobileService>, config: MobileConfig) -> Result<MobileStatus, String> {
    let service = service.inner().clone();
    let devices = app.state::<crate::mobile_api::MobileAccess>().devices.clone();
    tauri::async_runtime::spawn_blocking(move || service.reset_trust(config, &devices))
        .await
        .map_err(|_| "Mobile trust could not be reset.".to_string())?
}
#[tauri::command]
pub fn mobile_begin_pairing(app: tauri::AppHandle, service: State<'_, MobileService>) -> Result<String, String> {
    if !service.status().running {
        return Err("Enable local HTTPS before pairing a phone.".into());
    }
    app.state::<crate::mobile_api::MobileAccess>()
        .devices
        .begin(chrono::Utc::now().timestamp())
}
#[tauri::command]
pub fn mobile_pending_pairings(app: tauri::AppHandle) -> Vec<crate::mobile_devices::Pending> {
    app.state::<crate::mobile_api::MobileAccess>()
        .devices
        .pending(chrono::Utc::now().timestamp())
}
#[tauri::command]
pub fn mobile_pairing_profiles(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    Ok(crate::mobile_api::available_profiles(&app)?
        .into_iter()
        .map(|p| serde_json::json!({"id":p.id,"name":p.name}))
        .collect())
}
#[tauri::command]
pub fn mobile_decide_pairing(app: tauri::AppHandle, id: String, profiles: Option<Vec<String>>) -> Result<(), String> {
    if let Some(ids) = &profiles {
        let available = crate::mobile_api::available_profiles(&app)?;
        if ids.iter().any(|id| !available.iter().any(|p| &p.id == id && p.db_path.exists())) {
            return Err("Choose profiles that are still available on this desktop.".into());
        }
    }
    app.state::<crate::mobile_api::MobileAccess>()
        .devices
        .decide(&id, profiles, chrono::Utc::now().timestamp())
}
#[tauri::command]
pub fn mobile_cancel_pairing(app: tauri::AppHandle) {
    app.state::<crate::mobile_api::MobileAccess>().devices.cancel();
}
#[tauri::command]
pub fn mobile_list_devices(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    app.state::<crate::mobile_api::MobileAccess>().devices.list()
}
#[tauri::command]
pub fn mobile_revoke_device(app: tauri::AppHandle, id: String) -> Result<(), String> {
    app.state::<crate::mobile_api::MobileAccess>().devices.revoke(&id)
}
#[tauri::command]
pub fn mobile_remove_grant(app: tauri::AppHandle, id: String, profile: String) -> Result<(), String> {
    app.state::<crate::mobile_api::MobileAccess>().devices.remove_grant(&id, &profile)
}
#[tauri::command]
pub async fn mobile_server_status(service: State<'_, MobileService>) -> Result<MobileStatus, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.refresh_network()?;
        Ok(service.status())
    })
    .await
    .map_err(|_| "Mobile status unavailable".to_string())?
}
#[tauri::command]
pub fn mobile_network_interfaces() -> Vec<(String, std::net::Ipv4Addr)> {
    crate::mobile_server::interfaces()
}
#[tauri::command]
pub async fn mobile_configure(service: State<'_, MobileService>, config: MobileConfig) -> Result<MobileStatus, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.configure(config))
        .await
        .map_err(|_| "Mobile setup could not finish.".to_string())?
}
#[tauri::command]
pub async fn mobile_disable(service: State<'_, MobileService>) -> Result<MobileStatus, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.disable())
        .await
        .map_err(|_| "Mobile access could not stop.".to_string())?
}
#[tauri::command]
pub async fn mobile_public_certificate(service: State<'_, MobileService>) -> Result<PublicCertificate, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.public_certificate())
        .await
        .map_err(|_| "Public mobile certificate could not be opened.".to_string())?
}

#[tauri::command]
pub async fn mobile_configure_guided(service: State<'_, MobileService>, config: MobileConfig) -> Result<MobileStatus, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.configure_guided(config))
        .await
        .map_err(|_| "Phone setup could not start.".to_string())?
}

#[tauri::command]
pub async fn mobile_begin_setup(service: State<'_, MobileService>) -> Result<crate::mobile_bootstrap::SetupInfo, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.begin_setup())
        .await
        .map_err(|_| "Phone setup unavailable.".to_string())?
}
#[tauri::command]
pub async fn mobile_cancel_setup(service: State<'_, MobileService>) -> Result<(), String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.cancel_setup())
        .await
        .map_err(|_| "Phone setup could not stop.".to_string())
}
#[tauri::command]
pub async fn mobile_setup_status(service: State<'_, MobileService>) -> Result<Option<crate::mobile_bootstrap::SetupInfo>, String> {
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.setup_status())
        .await
        .map_err(|_| "Phone setup status unavailable.".to_string())
}
