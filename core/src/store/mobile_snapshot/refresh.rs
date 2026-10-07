//! Admission control for the future authenticated snapshot route. Acquire before queueing work,
//! hold through projection/publication, and release on every outcome. This is not authentication.
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
pub const MOBILE_REFRESH_INTERVAL: Duration = Duration::from_secs(30);
const MAX_TRACKED_PROFILES: usize = 128;
#[derive(Default)]
struct State {
    active: bool,
    last: BTreeMap<String, Instant>,
}
#[derive(Clone, Default)]
pub struct MobileSnapshotRefreshGate {
    state: Arc<Mutex<State>>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MobileRefreshDenied {
    Busy,
    TooSoon,
    Capacity,
}
pub struct MobileSnapshotRefreshPermit {
    state: Arc<Mutex<State>>,
}
impl Drop for MobileSnapshotRefreshPermit {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            state.active = false;
        }
    }
}
impl MobileSnapshotRefreshGate {
    /// One installation-wide refresh in flight, one start per profile per 30 seconds, including
    /// failed refreshes. Only authenticated grant IDs may reach this method. No financial writes.
    pub fn try_start(&self, profile_id: &str) -> Result<MobileSnapshotRefreshPermit, MobileRefreshDenied> {
        self.at(profile_id, Instant::now())
    }
    fn at(&self, profile_id: &str, now: Instant) -> Result<MobileSnapshotRefreshPermit, MobileRefreshDenied> {
        let mut state = self.state.lock().map_err(|_| MobileRefreshDenied::Busy)?;
        if state.active {
            return Err(MobileRefreshDenied::Busy);
        }
        if state
            .last
            .get(profile_id)
            .is_some_and(|last| now.saturating_duration_since(*last) < MOBILE_REFRESH_INTERVAL)
        {
            return Err(MobileRefreshDenied::TooSoon);
        }
        state
            .last
            .retain(|_, last| now.saturating_duration_since(*last) < MOBILE_REFRESH_INTERVAL);
        if state.last.len() >= MAX_TRACKED_PROFILES {
            return Err(MobileRefreshDenied::Capacity);
        }
        state.last.insert(profile_id.into(), now);
        state.active = true;
        Ok(MobileSnapshotRefreshPermit {
            state: Arc::clone(&self.state),
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gate_bounds_work_retries_and_independent_profiles() {
        let gate = MobileSnapshotRefreshGate::default();
        let now = Instant::now();
        let permit = gate.at("first", now).unwrap();
        assert!(matches!(gate.at("other", now), Err(MobileRefreshDenied::Busy)));
        drop(permit);
        assert!(matches!(
            gate.at("first", now + Duration::from_secs(29)),
            Err(MobileRefreshDenied::TooSoon)
        ));
        drop(gate.at("other", now + Duration::from_secs(29)).unwrap());
        drop(gate.at("first", now + MOBILE_REFRESH_INTERVAL).unwrap());
    }
    #[test]
    fn tracking_is_bounded_and_expired_entries_do_not_block_new_grants() {
        let gate = MobileSnapshotRefreshGate::default();
        let now = Instant::now();
        for i in 0..MAX_TRACKED_PROFILES {
            drop(gate.at(&i.to_string(), now).unwrap());
        }
        assert!(matches!(gate.at("new", now), Err(MobileRefreshDenied::Capacity)));
        drop(gate.at("new", now + MOBILE_REFRESH_INTERVAL).unwrap());
        assert_eq!(gate.state.lock().unwrap().last.len(), 1);
    }
}
