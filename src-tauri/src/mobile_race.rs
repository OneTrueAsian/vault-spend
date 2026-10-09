//! Disposable compiled-app race barriers. Never built or registered in release.
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::Manager;
pub struct Race {
    pub stage: String,
    directory: PathBuf,
    nonce: String,
    started: AtomicBool,
}
impl Race {
    fn file(&self, suffix: &str) -> PathBuf {
        self.directory.join(format!("mobile-race-{}.{suffix}", self.nonce))
    }
    fn wait(&self, suffix: &str) -> Result<(), String> {
        let until = Instant::now() + Duration::from_secs(15);
        while !self.file(suffix).exists() {
            if Instant::now() >= until {
                return Err("mobile_test_barrier_timeout".into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        Ok(())
    }
}
pub fn pause(app: &tauri::AppHandle, stage: &str) -> Result<(), String> {
    let access = app.state::<crate::mobile_api::MobileAccess>();
    let race = access.race.lock().map_err(|_| "mobile_test_barrier")?.clone();
    if let Some(race) = race {
        if race.stage == stage && !race.started.swap(true, Ordering::SeqCst) {
            std::fs::write(race.file("reached"), b"1").map_err(|_| "mobile_test_barrier")?;
            race.wait("release")?;
        }
    }
    Ok(())
}
pub fn changed(app: &tauri::AppHandle) -> Result<(), String> {
    let access = app.state::<crate::mobile_api::MobileAccess>();
    let race = access.race.lock().map_err(|_| "mobile_test_barrier")?.clone();
    if let Some(race) = race {
        if race.stage == "building" && race.started.load(Ordering::SeqCst) {
            race.wait("changed")?;
        }
    }
    Ok(())
}
pub fn arm(app: tauri::AppHandle, stage: String, action: String, target: String) -> Result<String, String> {
    if !matches!(stage.as_str(), "queued" | "building" | "ready") || !matches!(action.as_str(), "lock" | "switch" | "revoke") {
        return Err("mobile_test_barrier_invalid".into());
    }
    let directory = PathBuf::from(std::env::var_os("VAULTSPEND_DB_DIR").ok_or("Disposable data required")?);
    let paths = app.state::<crate::config::AppPaths>();
    if directory.canonicalize().ok() != paths.config_path.parent().and_then(|p| p.canonicalize().ok()) {
        return Err("Disposable data required".into());
    }
    let nonce = crate::mobile_devices::random()?;
    let race = Arc::new(Race {
        stage,
        directory,
        nonce: nonce.clone(),
        started: AtomicBool::new(false),
    });
    *app.state::<crate::mobile_api::MobileAccess>()
        .race
        .lock()
        .map_err(|_| "mobile_test_barrier")? = Some(race.clone());
    std::thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            race.wait("reached")?;
            let paths = app.state::<crate::config::AppPaths>();
            let runtime = app.state::<crate::runtime::AppRuntime>();
            match action.as_str() {
                "lock" => {
                    runtime.lock_open_profile(
                        &target,
                        || true,
                        |_| {
                            paths.bump_generation();
                            None
                        },
                    )?;
                }
                "switch" => {
                    let profile = crate::mobile_api::available_profiles(&app)?
                        .into_iter()
                        .find(|p| p.id == target && !p.is_password_protected())
                        .ok_or("mobile_test_profile")?;
                    let new = crate::commands::AppState::open(&profile.db_path)?;
                    let mut state = runtime.lock()?;
                    crate::config::write_db_location_config(&paths.config_path, &profile.db_path).map_err(|_| "mobile_test_profile")?;
                    state.replace(new);
                    *paths.db_path.lock().map_err(|_| "mobile_test_profile")? = profile.db_path;
                    paths.bump_generation();
                }
                "revoke" => {
                    app.state::<crate::mobile_api::MobileAccess>().devices.revoke(&target)?;
                }
                _ => unreachable!(),
            }
            Ok(())
        })();
        let _ = std::fs::write(race.file("changed"), if result.is_ok() { b"ok".as_slice() } else { b"failed".as_slice() });
    });
    Ok(nonce)
}
