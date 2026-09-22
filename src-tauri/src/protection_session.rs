//! Per-profile unlock attempt bookkeeping. In memory only — resets on process restart, exactly as
//! plan v2 §4.8 requires ("never persisted"). Lives apart from `AppRuntime` because it must survive
//! across the `Locked -> Open` transition to reset on success but *also* be readable from the
//! selector while nothing is open at all, which `AppRuntime`'s single mutex slot does not model.
use budget_core::protection::recovery::RecoveryCode;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

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

/// What `Sessions::begin_setup` hands back for the frontend to show: the recovery code in full,
/// and which two of its seven groups the person must retype to prove they actually saved it —
/// shared by both "turn protection on for this profile" (Task 5) and "create a protected profile"
/// (Task 6), since both need the exact same "show once, then prove it was written down" challenge.
#[derive(Debug, Clone, Serialize)]
pub struct SetupChallenge {
    pub token: String,
    pub recovery_display: String,
    pub challenge_group_indices: [usize; 2],
}

/// A password and recovery code waiting on their 2-of-7 challenge to be answered correctly before
/// anything is actually protected. Only one at a time (plan v2's architecture note) — starting a
/// new one silently invalidates whatever was pending, so an abandoned setup can never be completed
/// by mistake with the wrong target already forgotten.
struct PendingSetup {
    token: String,
    password: Zeroizing<String>,
    recovery_code: RecoveryCode,
    challenge_group_indices: [usize; 2],
    expected_generation: u64,
}

fn distinct_pair(count: usize) -> (usize, usize) {
    let a = budget_core::protection::random_bytes::<1>()[0] as usize % count;
    let mut b = budget_core::protection::random_bytes::<1>()[0] as usize % count;
    while b == a {
        b = budget_core::protection::random_bytes::<1>()[0] as usize % count;
    }
    (a, b)
}

fn random_token() -> String {
    budget_core::protection::random_bytes::<16>().iter().map(|b| format!("{b:02x}")).collect()
}

pub struct Sessions {
    attempts: Mutex<HashMap<String, ProfileAttempts>>,
    pending: Mutex<Option<PendingSetup>>,
}

impl Sessions {
    pub fn new() -> Self {
        Sessions { attempts: Mutex::new(HashMap::new()), pending: Mutex::new(None) }
    }

    /// Starts a setup, invalidating any previous pending one. The two challenge indices are
    /// distinct and drawn fresh each call, so cancelling and starting over always asks about a
    /// different pair of groups.
    pub fn begin_setup(&self, password: &str, expected_generation: u64) -> SetupChallenge {
        let recovery_code = RecoveryCode::generate();
        let display = recovery_code.display();
        let group_count = display.split('-').count();
        let (a, b) = distinct_pair(group_count);
        let token = random_token();
        let challenge = SetupChallenge { token: token.clone(), recovery_display: display, challenge_group_indices: [a, b] };
        *self.pending.lock().unwrap_or_else(|e| e.into_inner()) = Some(PendingSetup {
            token,
            password: Zeroizing::new(password.to_string()),
            recovery_code,
            challenge_group_indices: [a, b],
            expected_generation,
        });
        challenge
    }

    /// Consumes the pending setup if `token` matches, checking both challenge answers against the
    /// actual groups (never a renderer-computed boolean — the backend verifies). Any mismatch, or
    /// no pending setup at all, leaves the slot untouched.
    pub fn take_verified_setup(&self, token: &str, answers: &[String; 2]) -> Result<(String, u64), &'static str> {
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        let setup = pending.as_ref().filter(|p| p.token == token).ok_or("This setup has expired or was already used.")?;
        let display = setup.recovery_code.display();
        let groups: Vec<&str> = display.split('-').collect();
        let expected = [groups[setup.challenge_group_indices[0]], groups[setup.challenge_group_indices[1]]];
        if answers[0].trim().to_uppercase() != expected[0] || answers[1].trim().to_uppercase() != expected[1] {
            return Err("Those don't match what was shown. Check them and try again.");
        }
        let setup = pending.take().unwrap();
        Ok((setup.password.to_string(), setup.expected_generation))
    }

    pub fn cancel_setup(&self, token: &str) {
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        if pending.as_ref().map(|p| p.token.as_str()) == Some(token) {
            *pending = None;
        }
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

#[cfg(test)]
mod pending_setup_tests {
    use super::*;

    #[test]
    fn the_two_challenge_indices_are_always_distinct() {
        for _ in 0..50 {
            let sessions = Sessions::new();
            let challenge = sessions.begin_setup("a password", 1);
            assert_ne!(challenge.challenge_group_indices[0], challenge.challenge_group_indices[1]);
        }
    }

    #[test]
    fn the_correct_two_groups_complete_setup_and_return_the_password_and_generation() {
        let sessions = Sessions::new();
        let challenge = sessions.begin_setup("hunter2 but eight chars", 7);
        let groups: Vec<&str> = challenge.recovery_display.split('-').collect();
        let answers = [groups[challenge.challenge_group_indices[0]].to_string(), groups[challenge.challenge_group_indices[1]].to_string()];

        let (password, generation) = sessions.take_verified_setup(&challenge.token, &answers).unwrap();

        assert_eq!(password, "hunter2 but eight chars");
        assert_eq!(generation, 7);
    }

    #[test]
    fn a_wrong_answer_is_refused_and_does_not_consume_the_pending_setup() {
        let sessions = Sessions::new();
        let challenge = sessions.begin_setup("a password", 1);

        assert!(sessions.take_verified_setup(&challenge.token, &["WRONG".to_string(), "ALSO".to_string()]).is_err());
        // still pending — the right answer still works afterward:
        let groups: Vec<&str> = challenge.recovery_display.split('-').collect();
        let answers = [groups[challenge.challenge_group_indices[0]].to_string(), groups[challenge.challenge_group_indices[1]].to_string()];
        assert!(sessions.take_verified_setup(&challenge.token, &answers).is_ok());
    }

    #[test]
    fn a_stale_or_unknown_token_is_refused() {
        let sessions = Sessions::new();
        sessions.begin_setup("a password", 1);

        assert!(sessions.take_verified_setup("not-a-real-token", &["AAAA".to_string(), "BBBB".to_string()]).is_err());
    }

    #[test]
    fn starting_a_new_setup_invalidates_the_previous_pending_one() {
        let sessions = Sessions::new();
        let first = sessions.begin_setup("first", 1);

        sessions.begin_setup("second", 2);

        assert!(sessions.take_verified_setup(&first.token, &["AAAA".to_string(), "BBBB".to_string()]).is_err());
    }

    #[test]
    fn cancelling_clears_the_pending_setup() {
        let sessions = Sessions::new();
        let challenge = sessions.begin_setup("a password", 1);

        sessions.cancel_setup(&challenge.token);

        let groups: Vec<&str> = challenge.recovery_display.split('-').collect();
        let answers = [groups[challenge.challenge_group_indices[0]].to_string(), groups[challenge.challenge_group_indices[1]].to_string()];
        assert!(sessions.take_verified_setup(&challenge.token, &answers).is_err());
    }

    #[test]
    fn answers_are_matched_case_insensitively_and_trimmed() {
        // The recovery alphabet is all uppercase; a person retyping it may not match case exactly,
        // and a pasted/typed answer may carry stray leading/trailing whitespace.
        let sessions = Sessions::new();
        let challenge = sessions.begin_setup("a password", 1);
        let groups: Vec<&str> = challenge.recovery_display.split('-').collect();
        let answers = [
            format!("  {}  ", groups[challenge.challenge_group_indices[0]].to_lowercase()),
            groups[challenge.challenge_group_indices[1]].to_lowercase(),
        ];

        assert!(sessions.take_verified_setup(&challenge.token, &answers).is_ok());
    }
}
