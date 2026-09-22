//! Per-profile unlock attempt bookkeeping. In memory only — resets on process restart, exactly as
//! plan v2 §4.8 requires ("never persisted"). Lives apart from `AppRuntime` because it must survive
//! across the `Locked -> Open` transition to reset on success but *also* be readable from the
//! selector while nothing is open at all, which `AppRuntime`'s single mutex slot does not model.
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const FREE_ATTEMPTS: u32 = 3;

fn delay_for(failures: u32) -> Duration {
    match failures {
        0..=FREE_ATTEMPTS => Duration::ZERO,
        4 => Duration::from_secs(2),
        5 => Duration::from_secs(5),
        _ => Duration::from_secs(15),
    }
}

struct ProfileAttempts {
    failures: u32,
    not_before: Instant,
}

pub struct Sessions {
    attempts: Mutex<HashMap<String, ProfileAttempts>>,
}

impl Sessions {
    pub fn new() -> Self {
        Sessions { attempts: Mutex::new(HashMap::new()) }
    }

    /// How long the caller must wait before this profile's next attempt is allowed. `Duration::ZERO`
    /// means "attempt now." Does not itself record anything — see `record_failure`/`record_success`.
    pub fn delay_remaining(&self, profile_id: &str) -> Duration {
        let attempts = self.attempts.lock().unwrap_or_else(|e| e.into_inner());
        match attempts.get(profile_id) {
            Some(a) => a.not_before.saturating_duration_since(Instant::now()),
            None => Duration::ZERO,
        }
    }

    pub fn record_failure(&self, profile_id: &str) {
        let mut attempts = self.attempts.lock().unwrap_or_else(|e| e.into_inner());
        let entry = attempts.entry(profile_id.to_string()).or_insert(ProfileAttempts { failures: 0, not_before: Instant::now() });
        entry.failures += 1;
        entry.not_before = Instant::now() + delay_for(entry.failures);
    }

    pub fn record_success(&self, profile_id: &str) {
        self.attempts.lock().unwrap_or_else(|e| e.into_inner()).remove(profile_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_three_failures_carry_no_delay() {
        let sessions = Sessions::new();

        for _ in 0..3 {
            sessions.record_failure("p");
            assert_eq!(sessions.delay_remaining("p"), Duration::ZERO);
        }
    }

    #[test]
    fn the_fourth_fifth_and_sixth_failures_step_up_the_delay() {
        let sessions = Sessions::new();
        for _ in 0..3 {
            sessions.record_failure("p");
        }

        sessions.record_failure("p"); // 4th
        assert!(sessions.delay_remaining("p") > Duration::from_millis(1900) && sessions.delay_remaining("p") <= Duration::from_secs(2));

        sessions.record_failure("p"); // 5th
        assert!(sessions.delay_remaining("p") > Duration::from_millis(4900) && sessions.delay_remaining("p") <= Duration::from_secs(5));

        sessions.record_failure("p"); // 6th
        assert!(sessions.delay_remaining("p") > Duration::from_millis(14900) && sessions.delay_remaining("p") <= Duration::from_secs(15));

        sessions.record_failure("p"); // 7th and beyond stay at 15s, never a lockout
        assert!(sessions.delay_remaining("p") <= Duration::from_secs(15));
    }

    #[test]
    fn success_resets_the_count_for_that_profile_only() {
        let sessions = Sessions::new();
        for _ in 0..5 {
            sessions.record_failure("p");
        }
        for _ in 0..4 {
            sessions.record_failure("other"); // enough to actually be in a delayed state itself
        }

        sessions.record_success("p");

        assert_eq!(sessions.delay_remaining("p"), Duration::ZERO);
        assert!(sessions.delay_remaining("other") > Duration::ZERO, "another profile's delay is untouched");
    }

    #[test]
    fn two_profiles_track_independently_from_the_start() {
        let sessions = Sessions::new();

        sessions.record_failure("a");
        sessions.record_failure("a");
        sessions.record_failure("a");
        sessions.record_failure("a"); // a is now delayed

        assert_eq!(sessions.delay_remaining("b"), Duration::ZERO);
    }
}
