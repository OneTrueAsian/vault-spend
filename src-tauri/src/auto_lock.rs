use crate::commands::{AppState, AppStateHandle};
use crate::config::AppPaths;
use crate::device_settings::DeviceSettingsStore;
use crate::profiles::{self, AutoLockSettings};
use crate::startup::{self, StartupState};
use serde::Serialize;
#[cfg(debug_assertions)]
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

const WARNING_SECONDS: u64 = 10;
const COUNTDOWN_EVENT: &str = "profile-lock-countdown";
const COUNTDOWN_CANCELLED_EVENT: &str = "profile-lock-countdown-cancelled";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LockReason {
    Inactivity,
    Manual,
    HiddenToTray,
    FocusLost,
    SystemLocked,
    Suspending,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowLockTrigger {
    HiddenToTray,
    FocusLost,
    FocusGained,
    Quit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemSessionEvent {
    Locked,
    Suspending,
    Resumed,
}

/// `dialog_open` is true while a native save/open dialog (an owned window) is up — it defocuses the
/// main window the same way a real alt-tab does, so `FocusLost` is suppressed while one is open, or
/// opting into "lock on focus loss" would lock the profile out from under an in-progress Export,
/// Relocate, or "Use existing file…". A dialog never hides the main window, so it can't have caused
/// `HiddenToTray` and never suppresses it.
pub fn window_lock_reason(
    profile_open: bool,
    is_protected: bool,
    settings: AutoLockSettings,
    trigger: WindowLockTrigger,
    dialog_open: bool,
) -> Option<LockReason> {
    if !profile_open || !is_protected {
        return None;
    }
    match trigger {
        WindowLockTrigger::HiddenToTray if settings.lock_when_hidden => Some(LockReason::HiddenToTray),
        WindowLockTrigger::FocusLost if settings.lock_on_focus_loss && !dialog_open => Some(LockReason::FocusLost),
        WindowLockTrigger::HiddenToTray | WindowLockTrigger::FocusLost | WindowLockTrigger::FocusGained | WindowLockTrigger::Quit => None,
    }
}

pub fn system_session_lock_reason(
    profile_open: bool,
    is_protected: bool,
    settings: AutoLockSettings,
    event: SystemSessionEvent,
) -> Option<LockReason> {
    if !profile_open || !is_protected || !settings.lock_on_system_event {
        return None;
    }
    match event {
        SystemSessionEvent::Locked => Some(LockReason::SystemLocked),
        SystemSessionEvent::Suspending => Some(LockReason::Suspending),
        SystemSessionEvent::Resumed => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CountdownIdentity {
    pub profile_id: String,
    pub generation: u64,
}

impl CountdownIdentity {
    fn new(profile_id: &str, generation: u64) -> Self {
        Self {
            profile_id: profile_id.to_string(),
            generation,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CountdownPayload {
    pub profile_id: String,
    pub generation: u64,
    pub seconds: u64,
    pub reason: LockReason,
}

impl CountdownPayload {
    fn inactivity(profile_id: &str, generation: u64, seconds: u64) -> Self {
        Self {
            profile_id: profile_id.to_string(),
            generation,
            seconds,
            reason: LockReason::Inactivity,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LockRequest {
    profile_id: String,
    generation: u64,
    reason: LockReason,
}

impl LockRequest {
    fn inactivity(profile_id: &str, generation: u64) -> Self {
        Self {
            profile_id: profile_id.to_string(),
            generation,
            reason: LockReason::Inactivity,
        }
    }

    fn window(profile_id: &str, generation: u64, reason: LockReason) -> Self {
        Self {
            profile_id: profile_id.to_string(),
            generation,
            reason,
        }
    }

    fn system(profile_id: &str, generation: u64, reason: LockReason) -> Self {
        Self {
            profile_id: profile_id.to_string(),
            generation,
            reason,
        }
    }
}

#[derive(Debug, Clone)]
struct ArmedTimer {
    profile_id: String,
    generation: u64,
    timeout_seconds: Option<u64>,
    deadline: Option<u64>,
    warning_sent: bool,
    settings: AutoLockSettings,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TimerAction {
    None,
    Warn(CountdownPayload),
    CancelWarning(CountdownIdentity),
    Lock(LockRequest),
}

#[derive(Debug, Default)]
struct TimerState {
    armed: Option<ArmedTimer>,
}

impl TimerState {
    fn arm(&mut self, profile_id: &str, generation: u64, settings: AutoLockSettings, now: u64) {
        let timeout_seconds = (settings.inactivity_minutes != 0).then(|| u64::from(settings.inactivity_minutes) * 60);
        self.armed = Some(ArmedTimer {
            profile_id: profile_id.to_string(),
            generation,
            timeout_seconds,
            deadline: timeout_seconds.map(|timeout| now.saturating_add(timeout)),
            warning_sent: false,
            settings,
        });
    }

    fn record_activity(&mut self, profile_id: &str, generation: u64, now: u64) -> TimerAction {
        let Some(armed) = self.armed.as_mut() else {
            return TimerAction::None;
        };
        if armed.profile_id != profile_id || armed.generation != generation {
            return TimerAction::None;
        }
        let cancelled = armed.warning_sent;
        armed.warning_sent = false;
        armed.deadline = armed.timeout_seconds.map(|timeout| now.saturating_add(timeout));
        if cancelled {
            TimerAction::CancelWarning(CountdownIdentity::new(profile_id, generation))
        } else {
            TimerAction::None
        }
    }

    fn disarm(&mut self, profile_id: &str, generation: u64) -> bool {
        let matches = self
            .armed
            .as_ref()
            .is_some_and(|armed| armed.profile_id == profile_id && armed.generation == generation);
        if matches {
            self.armed = None;
        }
        matches
    }

    fn disarm_all(&mut self) {
        self.armed = None;
    }

    fn tick(&mut self, now: u64) -> TimerAction {
        let Some(armed) = self.armed.as_mut() else {
            return TimerAction::None;
        };
        let Some(deadline) = armed.deadline else {
            return TimerAction::None;
        };
        if now >= deadline {
            let request = LockRequest::inactivity(&armed.profile_id, armed.generation);
            self.armed = None;
            return TimerAction::Lock(request);
        }
        if !armed.warning_sent && deadline.saturating_sub(now) <= WARNING_SECONDS {
            armed.warning_sent = true;
            return TimerAction::Warn(CountdownPayload::inactivity(
                &armed.profile_id,
                armed.generation,
                deadline.saturating_sub(now),
            ));
        }
        TimerAction::None
    }

    fn window_lock_request(&self, trigger: WindowLockTrigger, dialog_open: bool) -> Option<LockRequest> {
        let armed = self.armed.as_ref()?;
        window_lock_reason(true, true, armed.settings, trigger, dialog_open)
            .map(|reason| LockRequest::window(&armed.profile_id, armed.generation, reason))
    }

    fn system_session_lock_request(&self, event: SystemSessionEvent) -> Option<LockRequest> {
        let armed = self.armed.as_ref()?;
        system_session_lock_reason(true, true, armed.settings, event).map(|reason| LockRequest::system(&armed.profile_id, armed.generation, reason))
    }
}

pub struct AutoLockController {
    started: Instant,
    #[cfg(debug_assertions)]
    debug_offset_seconds: AtomicU64,
    timer: Mutex<TimerState>,
    /// Set by the frontend around every native save/open dialog call (`note_native_dialog_state`) —
    /// see `window_lock_reason`'s doc comment for why `FocusLost` must be suppressed while this is
    /// true.
    dialog_open: AtomicBool,
}

impl AutoLockController {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
            #[cfg(debug_assertions)]
            debug_offset_seconds: AtomicU64::new(0),
            timer: Mutex::new(TimerState::default()),
            dialog_open: AtomicBool::new(false),
        }
    }

    pub fn set_dialog_open(&self, open: bool) {
        self.dialog_open.store(open, Ordering::SeqCst);
    }

    fn is_dialog_open(&self) -> bool {
        self.dialog_open.load(Ordering::SeqCst)
    }

    fn now_seconds(&self) -> u64 {
        let elapsed = self.started.elapsed().as_secs();
        #[cfg(debug_assertions)]
        return elapsed.saturating_add(self.debug_offset_seconds.load(Ordering::SeqCst));
        #[cfg(not(debug_assertions))]
        elapsed
    }

    pub fn arm(&self, profile_id: &str, generation: u64, settings: AutoLockSettings) {
        self.timer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .arm(profile_id, generation, settings, self.now_seconds());
    }

    fn record_activity(&self, profile_id: &str, generation: u64) -> TimerAction {
        self.timer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .record_activity(profile_id, generation, self.now_seconds())
    }

    pub fn disarm(&self, profile_id: &str, generation: u64) {
        self.timer.lock().unwrap_or_else(|e| e.into_inner()).disarm(profile_id, generation);
    }

    pub fn disarm_all(&self) {
        self.timer.lock().unwrap_or_else(|e| e.into_inner()).disarm_all();
    }

    fn tick(&self) -> TimerAction {
        self.timer.lock().unwrap_or_else(|e| e.into_inner()).tick(self.now_seconds())
    }

    fn window_lock_request(&self, trigger: WindowLockTrigger) -> Option<LockRequest> {
        self.timer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .window_lock_request(trigger, self.is_dialog_open())
    }

    fn system_session_lock_request(&self, event: SystemSessionEvent) -> Option<LockRequest> {
        self.timer.lock().unwrap_or_else(|e| e.into_inner()).system_session_lock_request(event)
    }

    #[cfg(debug_assertions)]
    fn advance_debug_clock(&self, seconds: u64) {
        self.debug_offset_seconds.fetch_add(seconds, Ordering::SeqCst);
    }
}

pub fn arm_current_profile(app: &tauri::AppHandle) {
    let paths = app.state::<AppPaths>();
    let runtime = app.state::<AppStateHandle>();
    let controller = app.state::<AutoLockController>();
    if !runtime.is_open() {
        controller.disarm_all();
        return;
    }
    let db_path = paths.db_path.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let profile_id = profiles::profile_id_for(&paths.config_path, &db_path);
    match profiles::auto_lock_settings_for(&paths.config_path, &db_path, &profile_id) {
        Ok(settings) => controller.arm(&profile_id, paths.current_generation(), settings),
        Err(_) => controller.disarm_all(),
    }
}

fn transition_runtime<F>(
    paths: &AppPaths,
    runtime: &AppStateHandle,
    expected_profile_id: &str,
    expected_generation: u64,
    final_backup: F,
) -> Result<String, String>
where
    F: FnOnce(&AppState) -> Result<(), String>,
{
    if paths.current_generation() != expected_generation {
        return Err("Something else already changed which profile is open.".to_string());
    }
    let db_path = paths.db_path.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let profile_id = profiles::profile_id_for(&paths.config_path, &db_path);
    if profile_id != expected_profile_id {
        return Err("Something else already changed which profile is open.".to_string());
    }
    let backup_error = runtime.lock_open_profile(
        &profile_id,
        || paths.current_generation() == expected_generation && *paths.db_path.lock().unwrap_or_else(|e| e.into_inner()) == db_path,
        |state| {
            let error = final_backup(state).err();
            paths.bump_generation();
            error
        },
    )?;
    if let Some(error) = backup_error {
        eprintln!("final automatic backup failed (locking anyway): {error}");
    }
    Ok(profile_id)
}

/// The last chance to take a due automatic backup: the database is still open here and is gone the
/// moment the coordinator swaps in the locked slot.
fn take_final_backup(
    state: &AppState,
    db_path: &std::path::Path,
    copy_dir: Option<&std::path::Path>,
    now: chrono::NaiveDateTime,
) -> Result<(), String> {
    let backups_dir = crate::backups::backups_dir_for(db_path, state.store.is_encrypted());
    crate::backups::create_backup_if_due(&state.store, db_path, &backups_dir, copy_dir, now).map(|_| ())
}

pub fn lock_profile(
    app: &tauri::AppHandle,
    expected_profile_id: &str,
    expected_generation: u64,
    _reason: LockReason,
) -> Result<StartupState, String> {
    let paths = app.state::<AppPaths>();
    let runtime = app.state::<AppStateHandle>();
    let device = app.state::<DeviceSettingsStore>();
    let db_path = paths.db_path.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let copy_dir = device.snapshot().backup_mirror_dir(expected_profile_id).map(std::path::PathBuf::from);
    let profile_id = transition_runtime(&paths, &runtime, expected_profile_id, expected_generation, |state| {
        take_final_backup(state, &db_path, copy_dir.as_deref(), chrono::Local::now().naive_local())
    })?;
    app.state::<AutoLockController>().disarm(&profile_id, expected_generation);
    let status = app.state::<startup::LaunchStatus>();
    let next = startup::startup_state_for_registry(&paths.config_path, &runtime, &status, Some(&profile_id));
    startup::broadcast_state(app);
    Ok(next)
}

fn current_window_lock_request(app: &tauri::AppHandle, trigger: WindowLockTrigger) -> Option<LockRequest> {
    app.try_state::<AutoLockController>()?.window_lock_request(trigger)
}

fn perform_window_lock(app: &tauri::AppHandle, request: LockRequest) -> Result<(), String> {
    lock_profile(app, &request.profile_id, request.generation, request.reason).map(|_| ())
}

/// Captures the currently armed profile and generation before leaving the native event callback,
/// then performs the backup/lock transition on a worker. A later profile can never be locked by a
/// delayed event because `lock_profile` rechecks both captured values.
pub fn queue_window_lock(app: &tauri::AppHandle, trigger: WindowLockTrigger) -> bool {
    let Some(request) = current_window_lock_request(app, trigger) else {
        return false;
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = perform_window_lock(&handle, request) {
            eprintln!("window lock request was no longer current: {error}");
        }
    });
    true
}

fn current_system_session_lock_request(app: &tauri::AppHandle, event: SystemSessionEvent) -> Option<LockRequest> {
    app.try_state::<AutoLockController>()?.system_session_lock_request(event)
}

/// Captures the protected profile session while handling the native event, then leaves backup and
/// database teardown to the shared lock coordinator on a worker. Resume is deliberately a no-op.
pub fn queue_system_session_lock(app: &tauri::AppHandle, event: SystemSessionEvent) -> bool {
    let Some(request) = current_system_session_lock_request(app, event) else {
        return false;
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = perform_window_lock(&handle, request) {
            eprintln!("system session lock request was no longer current: {error}");
        }
    });
    true
}

/// Deterministic synchronous entry for debug-build desktop tests. It uses the same captured request
/// and coordinator as native callbacks; release builds never register the calling debug command.
#[cfg(debug_assertions)]
pub fn apply_window_lock_for_debug(app: &tauri::AppHandle, trigger: WindowLockTrigger) -> Result<bool, String> {
    let Some(request) = current_window_lock_request(app, trigger) else {
        return Ok(false);
    };
    perform_window_lock(app, request)?;
    Ok(true)
}

#[cfg(debug_assertions)]
pub fn apply_system_session_event_for_debug(app: &tauri::AppHandle, event: SystemSessionEvent) -> Result<bool, String> {
    let Some(request) = current_system_session_lock_request(app, event) else {
        return Ok(false);
    };
    perform_window_lock(app, request)?;
    Ok(true)
}

fn dispatch_action(app: &tauri::AppHandle, action: TimerAction) {
    match action {
        TimerAction::None => {}
        TimerAction::Warn(payload) => {
            let _ = app.emit(COUNTDOWN_EVENT, payload);
        }
        TimerAction::CancelWarning(payload) => {
            let _ = app.emit(COUNTDOWN_CANCELLED_EVENT, payload);
        }
        TimerAction::Lock(request) => {
            if let Err(error) = lock_profile(app, &request.profile_id, request.generation, request.reason) {
                eprintln!("automatic lock request was no longer current: {error}");
            }
        }
    }
}

#[tauri::command]
pub fn record_trusted_activity(
    expected_generation: u64,
    app: tauri::AppHandle,
    paths: tauri::State<AppPaths>,
    runtime: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    if paths.current_generation() != expected_generation {
        return Err("The active profile changed before activity could be recorded.".to_string());
    }
    {
        let _open = runtime.lock()?;
    }
    let db_path = paths.db_path.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let profile_id = profiles::profile_id_for(&paths.config_path, &db_path);
    let action = app.state::<AutoLockController>().record_activity(&profile_id, expected_generation);
    dispatch_action(&app, action);
    Ok(())
}

/// The frontend calls this immediately before, and (in a `finally`) immediately after, every native
/// save/open dialog invocation — see `window_lock_reason`'s doc comment. Never gated on whether a
/// profile is even protected: harmless either way, and simpler than tracking that here too.
#[tauri::command]
pub fn note_native_dialog_state(open: bool, app: tauri::AppHandle) {
    app.state::<AutoLockController>().set_dialog_open(open);
}

#[cfg(debug_assertions)]
pub fn advance_debug_clock(app: &tauri::AppHandle, seconds: u64) -> Result<(), String> {
    if seconds > 3_600 {
        return Err("The debug automatic-lock clock can advance by at most one hour at a time.".to_string());
    }
    let controller = app.state::<AutoLockController>();
    controller.advance_debug_clock(seconds);
    let action = controller.tick();
    dispatch_action(app, action);
    Ok(())
}

pub fn start_timer_thread(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let action = app.state::<AutoLockController>().tick();
        // The controller mutex has been released before either emitting or taking the runtime lock.
        dispatch_action(&app, action);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppPaths;
    use crate::profiles::AutoLockSettings;
    use crate::runtime::{AppRuntime, RuntimeStatus, PROFILE_LOCKED};
    use std::path::PathBuf;
    use std::sync::atomic::AtomicU64;

    fn settings(minutes: u32) -> AutoLockSettings {
        AutoLockSettings {
            inactivity_minutes: minutes,
            ..AutoLockSettings::default()
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-auto-lock-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn open_runtime_and_paths(name: &str, generation: u64) -> (AppRuntime, AppPaths) {
        let dir = temp_dir(name);
        let db_path = dir.join("vaultspend.db");
        let runtime = AppRuntime::no_profile_open();
        runtime.install(AppState::open(&db_path).unwrap());
        let paths = AppPaths {
            config_path: dir.join("config.json"),
            db_path: Mutex::new(db_path),
            generation: AtomicU64::new(generation),
        };
        (runtime, paths)
    }

    #[test]
    fn disabled_timeout_never_warns_or_expires() {
        let mut timer = TimerState::default();
        timer.arm("alpha", 3, settings(0), 100);

        assert_eq!(timer.tick(10_000), TimerAction::None);
    }

    #[test]
    fn activity_resets_the_deadline() {
        let mut timer = TimerState::default();
        timer.arm("alpha", 3, settings(1), 100);

        assert_eq!(timer.record_activity("alpha", 3, 150), TimerAction::None);
        assert_eq!(timer.tick(160), TimerAction::None);
        assert_eq!(timer.tick(200), TimerAction::Warn(CountdownPayload::inactivity("alpha", 3, 10)));
    }

    #[test]
    fn warning_is_emitted_once_at_ten_seconds() {
        let mut timer = TimerState::default();
        timer.arm("alpha", 3, settings(1), 100);

        assert_eq!(timer.tick(149), TimerAction::None);
        assert_eq!(timer.tick(150), TimerAction::Warn(CountdownPayload::inactivity("alpha", 3, 10)));
        assert_eq!(timer.tick(151), TimerAction::None);
        assert_eq!(timer.tick(159), TimerAction::None);
    }

    #[test]
    fn activity_cancels_a_warning_and_starts_a_fresh_interval() {
        let mut timer = TimerState::default();
        timer.arm("alpha", 3, settings(1), 100);
        assert!(matches!(timer.tick(150), TimerAction::Warn(_)));

        assert_eq!(
            timer.record_activity("alpha", 3, 153),
            TimerAction::CancelWarning(CountdownIdentity::new("alpha", 3))
        );
        assert_eq!(timer.tick(203), TimerAction::Warn(CountdownPayload::inactivity("alpha", 3, 10)));
    }

    #[test]
    fn expiry_disarms_and_emits_only_one_lock() {
        let mut timer = TimerState::default();
        timer.arm("alpha", 3, settings(1), 100);

        assert_eq!(timer.tick(160), TimerAction::Lock(LockRequest::inactivity("alpha", 3)));
        assert_eq!(timer.tick(161), TimerAction::None);
    }

    #[test]
    fn stale_profile_or_generation_activity_is_ignored() {
        let mut timer = TimerState::default();
        timer.arm("alpha", 3, settings(1), 100);

        assert_eq!(timer.record_activity("beta", 3, 120), TimerAction::None);
        assert_eq!(timer.record_activity("alpha", 2, 130), TimerAction::None);
        assert_eq!(timer.tick(150), TimerAction::Warn(CountdownPayload::inactivity("alpha", 3, 10)));
    }

    #[test]
    fn manual_lock_disarms_only_the_matching_session() {
        let mut timer = TimerState::default();
        timer.arm("alpha", 3, settings(1), 100);

        assert!(!timer.disarm("alpha", 2));
        assert!(timer.disarm("alpha", 3));
        assert_eq!(timer.tick(1_000), TimerAction::None);
    }

    #[test]
    fn unlock_rearms_with_the_new_generation() {
        let mut timer = TimerState::default();
        timer.arm("alpha", 3, settings(1), 100);
        assert!(timer.disarm("alpha", 3));

        timer.arm("alpha", 5, settings(1), 200);

        assert_eq!(timer.tick(250), TimerAction::Warn(CountdownPayload::inactivity("alpha", 5, 10)));
        assert_eq!(timer.tick(260), TimerAction::Lock(LockRequest::inactivity("alpha", 5)));
    }

    #[test]
    fn window_trigger_decision_covers_open_protected_settings_and_quit() {
        let defaults = AutoLockSettings::default();
        assert_eq!(
            window_lock_reason(false, true, defaults, WindowLockTrigger::HiddenToTray, false),
            None,
            "no open profile means there is no session to lock"
        );
        assert_eq!(
            window_lock_reason(true, false, defaults, WindowLockTrigger::HiddenToTray, false),
            None,
            "an unprotected open profile stays open"
        );
        assert_eq!(
            window_lock_reason(true, true, defaults, WindowLockTrigger::HiddenToTray, false),
            Some(LockReason::HiddenToTray)
        );
        assert_eq!(
            window_lock_reason(
                true,
                true,
                AutoLockSettings {
                    lock_when_hidden: false,
                    ..defaults
                },
                WindowLockTrigger::HiddenToTray,
                false,
            ),
            None,
            "the per-profile hide setting is respected"
        );
        assert_eq!(
            window_lock_reason(true, true, defaults, WindowLockTrigger::FocusLost, false),
            None,
            "focus-loss locking is off by default"
        );
        assert_eq!(
            window_lock_reason(
                true,
                true,
                AutoLockSettings {
                    lock_on_focus_loss: true,
                    ..defaults
                },
                WindowLockTrigger::FocusLost,
                false,
            ),
            Some(LockReason::FocusLost)
        );
        assert_eq!(window_lock_reason(true, true, defaults, WindowLockTrigger::FocusGained, false), None);
        assert_eq!(window_lock_reason(true, true, defaults, WindowLockTrigger::Quit, false), None);
    }

    #[test]
    fn a_native_dialog_being_open_suppresses_only_the_focus_loss_trigger() {
        // A native save/open dialog is an owned window: taking it up defocuses the main window the
        // same way a real alt-tab does, which would otherwise lock mid-Export/mid-Relocate/etc. for
        // anyone who has opted into "lock on focus loss." Tray-hide is unaffected — a dialog never
        // hides the main window, so there is nothing to suppress there.
        let opted_in = AutoLockSettings {
            lock_on_focus_loss: true,
            lock_when_hidden: true,
            ..AutoLockSettings::default()
        };
        assert_eq!(
            window_lock_reason(true, true, opted_in, WindowLockTrigger::FocusLost, true),
            None,
            "focus lost while a dialog is open must not lock, even with the setting on"
        );
        assert_eq!(
            window_lock_reason(true, true, opted_in, WindowLockTrigger::FocusLost, false),
            Some(LockReason::FocusLost),
            "focus lost with no dialog open still locks exactly as before"
        );
        assert_eq!(
            window_lock_reason(true, true, opted_in, WindowLockTrigger::HiddenToTray, true),
            Some(LockReason::HiddenToTray),
            "a dialog being open must not suppress tray-hide locking, which it can't have caused"
        );
    }

    #[test]
    fn the_controller_suppresses_a_focus_loss_request_while_a_dialog_is_marked_open() {
        let controller = AutoLockController::new();
        controller.arm(
            "alpha",
            1,
            AutoLockSettings {
                lock_on_focus_loss: true,
                ..AutoLockSettings::default()
            },
        );

        controller.set_dialog_open(true);
        assert_eq!(controller.window_lock_request(WindowLockTrigger::FocusLost), None);

        controller.set_dialog_open(false);
        assert_eq!(
            controller.window_lock_request(WindowLockTrigger::FocusLost),
            Some(LockRequest::window("alpha", 1, LockReason::FocusLost))
        );
    }

    #[test]
    fn controller_window_request_keeps_the_armed_profile_and_generation() {
        let controller = AutoLockController::new();
        controller.arm(
            "alpha",
            17,
            AutoLockSettings {
                lock_on_focus_loss: true,
                ..AutoLockSettings::default()
            },
        );

        assert_eq!(
            controller.window_lock_request(WindowLockTrigger::FocusLost),
            Some(LockRequest::window("alpha", 17, LockReason::FocusLost))
        );
    }

    #[test]
    fn system_session_decision_covers_open_protected_setting_and_resume() {
        let defaults = AutoLockSettings::default();
        assert_eq!(
            system_session_lock_reason(false, true, defaults, SystemSessionEvent::Locked),
            None,
            "no open profile means there is no session to lock"
        );
        assert_eq!(
            system_session_lock_reason(true, false, defaults, SystemSessionEvent::Locked),
            None,
            "an unprotected open profile stays open"
        );
        assert_eq!(
            system_session_lock_reason(true, true, defaults, SystemSessionEvent::Locked),
            Some(LockReason::SystemLocked)
        );
        assert_eq!(
            system_session_lock_reason(true, true, defaults, SystemSessionEvent::Suspending),
            Some(LockReason::Suspending)
        );
        assert_eq!(
            system_session_lock_reason(
                true,
                true,
                AutoLockSettings {
                    lock_on_system_event: false,
                    ..defaults
                },
                SystemSessionEvent::Locked,
            ),
            None,
            "the per-profile system-event setting is respected"
        );
        assert_eq!(
            system_session_lock_reason(true, true, defaults, SystemSessionEvent::Resumed),
            None,
            "resume never opens or unlocks a profile"
        );
    }

    #[test]
    fn controller_system_request_keeps_the_armed_profile_and_generation() {
        let controller = AutoLockController::new();
        controller.arm("alpha", 23, AutoLockSettings::default());

        assert_eq!(
            controller.system_session_lock_request(SystemSessionEvent::Suspending),
            Some(LockRequest::system("alpha", 23, LockReason::Suspending))
        );
        assert_eq!(controller.system_session_lock_request(SystemSessionEvent::Resumed), None);
    }

    #[test]
    fn coordinator_locks_the_runtime_and_advances_generation_once() {
        let (runtime, paths) = open_runtime_and_paths("coordinator", 7);

        let profile_id = transition_runtime(&paths, &runtime, "default", 7, |_| Ok(())).unwrap();

        assert_eq!(profile_id, "default");
        assert_eq!(paths.current_generation(), 8);
        assert_eq!(
            runtime.status(),
            RuntimeStatus::Locked {
                profile_id: "default".to_string()
            }
        );
        let message = runtime.lock().err().expect("the database connection is gone");
        assert!(message.starts_with(PROFILE_LOCKED), "{message}");
    }

    #[test]
    fn locking_takes_the_due_backup_before_the_connection_closes() {
        let (runtime, paths) = open_runtime_and_paths("final-backup", 3);
        let db_path = paths.db_path.lock().unwrap().clone();
        let now = chrono::NaiveDate::from_ymd_opt(2026, 9, 21).unwrap().and_hms_opt(9, 0, 0).unwrap();

        transition_runtime(&paths, &runtime, "default", 3, |state| take_final_backup(state, &db_path, None, now)).unwrap();

        let backups = crate::backups::list_backups(&crate::backups::backups_dir_for(&db_path, false), false).unwrap();
        assert_eq!(
            backups.len(),
            1,
            "a lock with no recent backup takes one while the database is still open"
        );
        assert!(matches!(runtime.status(), RuntimeStatus::Locked { .. }));
    }

    #[test]
    fn final_backup_failure_cannot_prevent_locking() {
        let (runtime, paths) = open_runtime_and_paths("backup-failure", 11);

        transition_runtime(&paths, &runtime, "default", 11, |_| Err("disk full".to_string())).unwrap();

        assert_eq!(paths.current_generation(), 12);
        assert_eq!(
            runtime.status(),
            RuntimeStatus::Locked {
                profile_id: "default".to_string()
            }
        );
    }

    #[test]
    fn stale_coordinator_request_does_not_lock_or_advance_generation() {
        let (runtime, paths) = open_runtime_and_paths("stale", 5);

        let error = transition_runtime(&paths, &runtime, "default", 4, |_| Ok(())).unwrap_err();

        assert!(error.contains("already changed"));
        assert_eq!(paths.current_generation(), 5);
        assert_eq!(runtime.status(), RuntimeStatus::Open);
    }
}
