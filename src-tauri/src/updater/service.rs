use super::{staging::UpdateStaging, transport::SelectedUpdate};
use std::{
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Emitter;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOffer {
    pub handle: String,
    pub version: String,
    pub size: u64,
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    handle: String,
    received: u64,
    total: u64,
    verifying: bool,
}
struct Control {
    offer: Option<(UpdateOffer, SelectedUpdate, Instant)>,
    active: Option<(String, tokio::sync::watch::Sender<bool>)>,
    staged: Option<(String, String)>,
}
pub struct UpdateService {
    control: Mutex<Control>,
    staging: tokio::sync::Mutex<Result<UpdateStaging, String>>,
}
struct ActiveDownload<'a> {
    service: &'a UpdateService,
    handle: &'a str,
}
impl Drop for ActiveDownload<'_> {
    fn drop(&mut self) {
        if let Ok(mut control) = self.service.control.lock() {
            if control.active.as_ref().is_some_and(|(handle, _)| handle == self.handle) {
                control.active = None;
            }
        }
    }
}
impl UpdateService {
    pub fn new(parent: &Path) -> Self {
        let staging = std::fs::create_dir_all(parent)
            .map_err(|_| "Update staging is unavailable.".to_string())
            .and_then(|_| super::staging::cleanup_abandoned(parent))
            .and_then(|_| UpdateStaging::new(parent));
        Self {
            control: Mutex::new(Control {
                offer: None,
                active: None,
                staged: None,
            }),
            staging: tokio::sync::Mutex::new(staging),
        }
    }
    pub async fn prepare(&self) -> Result<Option<UpdateOffer>, String> {
        if super::trust::embedded_keys()?.is_empty() {
            return Ok(None);
        }
        let release = super::fetch_latest_release().await?;
        let selected = super::transport::signed_selection(&release).await?;
        self.offer(selected).map(Some)
    }
    fn offer(&self, selected: SelectedUpdate) -> Result<UpdateOffer, String> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|_| "Couldn't create a secure update handle.")?;
        let offer = UpdateOffer {
            handle: bytes.iter().map(|byte| format!("{byte:02x}")).collect(),
            version: selected.manifest().version.clone(),
            size: selected.manifest().size,
        };
        let mut control = self.control.lock().map_err(|_| "The updater is unavailable.")?;
        if control.active.is_some() || control.staged.is_some() {
            return Err("Finish or cancel the current update first.".into());
        }
        control.offer = Some((offer.clone(), selected, Instant::now() + Duration::from_secs(600)));
        Ok(offer)
    }
    fn start(&self, handle: &str) -> Result<(SelectedUpdate, tokio::sync::watch::Receiver<bool>), String> {
        let mut control = self.control.lock().map_err(|_| "The updater is unavailable.")?;
        if control.active.is_some() || control.staged.is_some() {
            return Err("An update is already downloading or ready to install.".into());
        }
        let (offer, _, expiry) = control.offer.as_ref().ok_or("Check for a signed update again.")?;
        if offer.handle != handle || Instant::now() >= *expiry {
            return Err("The update handle is invalid or expired. Check again.".into());
        }
        let (_, selected, _) = control.offer.take().unwrap();
        let (cancel, receiver) = tokio::sync::watch::channel(false);
        control.active = Some((handle.to_string(), cancel));
        Ok((selected, receiver))
    }
    pub async fn download(&self, handle: &str, progress: impl FnMut(u64, u64, bool) + Send) -> Result<String, String> {
        let (selected, mut cancel) = self.start(handle)?;
        let _active = ActiveDownload { service: self, handle };
        let mut storage = self.staging.lock().await;
        let mut result = match storage.as_mut() {
            Err(error) => Err(error.clone()),
            Ok(staging) => tokio::select! {
                biased;
                _ = cancel.changed() => Err("Update download cancelled.".into()),
                result = staging.download_progress(selected, progress) => result,
            },
        };
        let mut control = self.control.lock().map_err(|_| "The updater is unavailable.")?;
        if *cancel.borrow() {
            if let Ok(token) = &result {
                let _ = storage.as_mut().map(|staging| staging.cancel(token));
            }
            result = Err("Update download cancelled.".into());
        }
        control.active = None;
        if let Ok(token) = &result {
            control.staged = Some((handle.to_string(), token.clone()));
        }
        result
    }
    pub async fn cancel(&self, handle: &str) -> Result<(), String> {
        let token;
        {
            let mut control = self.control.lock().map_err(|_| "The updater is unavailable.")?;
            if let Some((active, cancel)) = &control.active {
                if active == handle {
                    let _ = cancel.send(true);
                    return Ok(());
                }
                return Err("The update handle belongs to another operation.".into());
            }
            if control.offer.as_ref().is_some_and(|(offer, _, _)| offer.handle == handle) {
                control.offer = None;
                return Ok(());
            }
            if !control.staged.as_ref().is_some_and(|(job, token)| job == handle || token == handle) {
                return Err("The update handle is invalid or no longer available.".into());
            }
            token = control.staged.take().unwrap().1;
        }
        self.staging.lock().await.as_mut().map_err(|error| error.clone())?.cancel(&token)
    }
    pub async fn install(&self, token: &str) -> Result<(), String> {
        {
            let mut control = self.control.lock().map_err(|_| "The updater is unavailable.")?;
            if !control.staged.as_ref().is_some_and(|(_, stored)| stored == token) {
                return Err("The update token is invalid or no longer available.".into());
            }
            control.staged = None;
        }
        self.staging
            .lock()
            .await
            .as_mut()
            .map_err(|error| error.clone())?
            .handoff_verified_installer(token, launch_installer)
    }
}
fn launch_installer(path: &Path) -> Result<(), String> {
    use std::process::{Command, Stdio};
    #[cfg(target_os = "windows")]
    let mut command = match path.extension().and_then(|value| value.to_str()) {
        Some("exe") => Command::new(path),
        Some("msi") => {
            let root = std::env::var_os("SystemRoot").ok_or("Windows installer is unavailable.")?;
            let system = std::path::PathBuf::from(root).join("System32").join("msiexec.exe");
            if !system.is_absolute() {
                return Err("Windows installer is unavailable.".into());
            }
            let mut command = Command::new(system);
            command.arg("/i").arg(path);
            command
        }
        _ => return Err("Unsupported verified installer type.".into()),
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        if path.extension().and_then(|value| value.to_str()) != Some("dmg") {
            return Err("Unsupported verified installer type.".into());
        }
        let mut command = Command::new("/usr/bin/open");
        command.arg(path);
        command
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = {
        let _ = path;
        return Err("Updates are unavailable for this platform.".into());
        #[allow(unreachable_code)]
        Command::new("")
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Couldn't start the verified installer. Download it again or use the official release page.")?;
    Ok(())
}

#[tauri::command]
pub async fn prepare_signed_update(service: tauri::State<'_, UpdateService>) -> Result<Option<UpdateOffer>, String> {
    service.prepare().await
}
#[tauri::command]
pub async fn download_signed_update(handle: String, app: tauri::AppHandle, service: tauri::State<'_, UpdateService>) -> Result<String, String> {
    let progress_handle = handle.clone();
    service
        .download(&handle, move |received, total, verifying| {
            let _ = app.emit(
                "signed-update-progress",
                UpdateProgress {
                    handle: progress_handle.clone(),
                    received,
                    total,
                    verifying,
                },
            );
        })
        .await
}
#[tauri::command]
pub async fn cancel_signed_update(handle: String, service: tauri::State<'_, UpdateService>) -> Result<(), String> {
    service.cancel(&handle).await
}
#[tauri::command]
pub async fn install_signed_update(token: String, service: tauri::State<'_, UpdateService>) -> Result<(), String> {
    service.install(&token).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parent(prefix: &str) -> std::path::PathBuf {
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes).unwrap();
        std::env::temp_dir().join(format!("{prefix}-{}", bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>()))
    }
    #[tokio::test]
    async fn offer_identity_serializes_downloads_and_cancellation_does_not_wait_on_storage() {
        let parent = parent("vs-update-service");
        let service = UpdateService::new(&parent);
        let selected = super::super::transport::tests::fixture_selection(&super::super::transport::tests::fixture_release()).unwrap();
        let offer = service.offer(selected).unwrap();
        assert!(service.start("wrong").is_err());
        let (_selected, mut cancelled) = service.start(&offer.handle).unwrap();
        assert!(service.start(&offer.handle).is_err());
        let _held = service.staging.lock().await;
        service.cancel(&offer.handle).await.unwrap();
        cancelled.changed().await.unwrap();
        assert!(*cancelled.borrow());
        assert!(service.cancel("other-session").await.is_err());
        drop(_held);
        drop(service);
        std::fs::remove_dir(parent).unwrap();
    }
    #[tokio::test]
    async fn arbitrary_installer_paths_and_restart_tokens_are_refused() {
        let parent = parent("vs-update-refusal");
        let service = UpdateService::new(&parent);
        for token in ["C:\\unverified.exe", "", "old-session-token"] {
            assert!(service.install(token).await.is_err());
        }
        drop(service);
        std::fs::remove_dir(parent).unwrap();
    }

    #[tokio::test]
    async fn dropped_download_future_releases_busy_state_before_retry() {
        let parent = parent("vs-update-abort");
        let service = std::sync::Arc::new(UpdateService::new(&parent));
        let selected = super::super::transport::tests::fixture_selection(&super::super::transport::tests::fixture_release()).unwrap();
        let offer = service.offer(selected).unwrap();
        let held = service.staging.lock().await;
        let task_service = service.clone();
        let task = tokio::spawn(async move { task_service.download(&offer.handle, |_, _, _| {}).await });
        tokio::task::yield_now().await;
        assert!(service.control.lock().unwrap().active.is_some());
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(service.control.lock().unwrap().active.is_none());
        drop(held);
        drop(service);
        std::fs::remove_dir(parent).unwrap();
    }
}
