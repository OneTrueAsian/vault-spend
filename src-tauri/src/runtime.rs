//! The one place that decides whether a profile's data is available. `AppRuntime` replaces the
//! always-open `Mutex<AppState>`: it can hold no profile (the launch error screen, later the
//! selector), a locked profile (later phases) or an open one. Every command reaches its state
//! through `lock()`, which fails the same way for the first two. Design: plan v2 section 4.4.
use crate::commands::AppState;
use std::ops::{Deref, DerefMut};
use std::sync::{Mutex, MutexGuard};

/// The error text of a command that needs an open profile and finds it locked starts with this.
pub const PROFILE_LOCKED: &str = "PROFILE_LOCKED";
/// The error text of a command that needs an open profile and finds none starts with this.
pub const NO_PROFILE_OPEN: &str = "NO_PROFILE_OPEN";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeStatus {
    NoProfileOpen,
    Locked { profile_id: String },
    Open,
}

enum Slot {
    NoProfileOpen,
    Locked { profile_id: String },
    Open(AppState),
}

pub struct AppRuntime {
    slot: Mutex<Slot>,
}

/// The open state, held under the runtime's lock for as long as this value lives.
pub struct OpenSession<'a> {
    guard: MutexGuard<'a, Slot>,
}

impl Deref for OpenSession<'_> {
    type Target = AppState;

    fn deref(&self) -> &AppState {
        match &*self.guard {
            Slot::Open(state) => state,
            _ => unreachable!("an OpenSession is only created while the slot is open"),
        }
    }
}

impl DerefMut for OpenSession<'_> {
    fn deref_mut(&mut self) -> &mut AppState {
        match &mut *self.guard {
            Slot::Open(state) => state,
            _ => unreachable!("an OpenSession is only created while the slot is open"),
        }
    }
}

impl AppRuntime {
    pub fn no_profile_open() -> Self {
        AppRuntime { slot: Mutex::new(Slot::NoProfileOpen) }
    }

    /// The open state, or `NO_PROFILE_OPEN: ...` / `PROFILE_LOCKED: ...`. Meant to be used as
    /// `let state = state.lock()?;` in a command that returns `Result<_, String>`.
    pub fn lock(&self) -> Result<OpenSession<'_>, String> {
        let guard = self.slot.lock().map_err(|_| "app state poisoned".to_string())?;
        if matches!(&*guard, Slot::Open(_)) {
            return Ok(OpenSession { guard });
        }
        match &*guard {
            Slot::Locked { .. } => Err(format!("{PROFILE_LOCKED}: This profile is locked. Unlock it to continue.")),
            _ => Err(format!("{NO_PROFILE_OPEN}: No profile is open.")),
        }
    }

    /// Makes `state` the open profile, dropping whatever was there (its connection closes).
    pub fn install(&self, state: AppState) {
        *self.slot.lock().unwrap_or_else(|e| e.into_inner()) = Slot::Open(state);
    }

    /// Drops the open profile's state (its connection closes) and remembers which profile is locked.
    #[allow(dead_code)] // used by the lock screen and auto-lock in Phases C and E
    pub fn lock_profile(&self, profile_id: &str) {
        *self.slot.lock().unwrap_or_else(|e| e.into_inner()) = Slot::Locked { profile_id: profile_id.to_string() };
    }

    pub fn status(&self) -> RuntimeStatus {
        match &*self.slot.lock().unwrap_or_else(|e| e.into_inner()) {
            Slot::NoProfileOpen => RuntimeStatus::NoProfileOpen,
            Slot::Locked { profile_id } => RuntimeStatus::Locked { profile_id: profile_id.clone() },
            Slot::Open(_) => RuntimeStatus::Open,
        }
    }

    pub fn is_open(&self) -> bool {
        self.status() == RuntimeStatus::Open
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::AppState;
    use std::path::PathBuf;

    fn temp_db(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-runtime-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("test.db")
    }

    fn open_state(name: &str) -> AppState {
        AppState::open(temp_db(name)).unwrap()
    }

    fn open_runtime(state: AppState) -> AppRuntime {
        let runtime = AppRuntime::no_profile_open();
        runtime.install(state);
        runtime
    }

    #[test]
    fn an_open_runtime_hands_out_the_state() {
        let runtime = open_runtime(open_state("open"));

        assert_eq!(runtime.status(), RuntimeStatus::Open);
        assert!(runtime.is_open());
        let session = runtime.lock().ok().expect("an open runtime can be locked for use");
        assert!(session.store.get_background_settings().is_ok());
    }

    #[test]
    fn no_profile_open_refuses_with_its_code() {
        let runtime = AppRuntime::no_profile_open();

        let message = runtime.lock().err().expect("nothing is open");

        assert!(message.starts_with(NO_PROFILE_OPEN), "{message}");
        assert_eq!(runtime.status(), RuntimeStatus::NoProfileOpen);
        assert!(!runtime.is_open());
    }

    #[test]
    fn a_locked_runtime_refuses_with_its_own_code_and_drops_the_state() {
        let runtime = open_runtime(open_state("locked"));

        runtime.lock_profile("work");

        let message = runtime.lock().err().expect("a locked profile has no usable state");
        assert!(message.starts_with(PROFILE_LOCKED), "{message}");
        assert!(!message.starts_with(NO_PROFILE_OPEN));
        assert_eq!(runtime.status(), RuntimeStatus::Locked { profile_id: "work".to_string() });
    }

    #[test]
    fn installing_opens_a_runtime_that_had_nothing() {
        let runtime = AppRuntime::no_profile_open();

        runtime.install(open_state("install"));

        assert_eq!(runtime.status(), RuntimeStatus::Open);
        assert!(runtime.lock().is_ok());
    }

    #[test]
    fn a_locked_runtime_can_be_opened_again() {
        let runtime = open_runtime(open_state("relock"));
        runtime.lock_profile("work");

        runtime.install(open_state("relock-second"));

        assert_eq!(runtime.status(), RuntimeStatus::Open);
    }

    #[test]
    fn the_session_lets_a_command_swap_the_state_in_place() {
        // relocate_data_file, restore_backup and switch_profile do `*state = AppState::open(..)?`.
        let runtime = open_runtime(open_state("swap-first"));

        {
            let mut session = runtime.lock().ok().unwrap();
            *session = open_state("swap-second");
        }

        assert!(runtime.lock().is_ok());
    }
}
