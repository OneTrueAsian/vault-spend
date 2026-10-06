//! Protected installation registry; no financial projection or raw device credential persists.
use crate::mobile_secrets::SecretStore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
const DENIED: &str = "mobile_access_denied";
pub const COOKIE: &str = "__Host-vaultspend-device";
pub const LIFETIME: i64 = 365 * 86400;
pub fn random() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| DENIED)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
pub fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub fn equal(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |v, (a, b)| v | (a ^ b)) == 0
}
fn hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Grant {
    pub opaque: String,
    pub epoch: String,
    pub alias: String,
    pub sequence: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Device {
    pub id: String,
    pub label: String,
    verifier: String,
    pub expires: i64,
    pub grants: Vec<String>,
    #[serde(default)]
    pub last_seen: Option<i64>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Registry {
    version: u32,
    installation: String,
    devices: Vec<Device>,
    profiles: BTreeMap<String, Grant>,
}
#[derive(Clone, Serialize)]
pub struct Pending {
    pub id: String,
    pub label: String,
}
struct Pairing {
    id: String,
    code: String,
    created: i64,
    claim: Option<String>,
    label: String,
    grants: Option<Vec<String>>,
}
#[derive(Default)]
struct State {
    pairs: Vec<Pairing>,
    attempts: Vec<i64>,
}
pub struct Devices {
    store: Arc<dyn SecretStore>,
    state: Mutex<State>,
}
impl Devices {
    pub fn new(store: Arc<dyn SecretStore>) -> Self {
        Self {
            store,
            state: Mutex::new(State::default()),
        }
    }
    fn read(&self) -> Result<Registry, String> {
        let Some(bytes) = self.store.read().map_err(|_| "mobile_registry_unavailable")? else {
            return Ok(Registry {
                version: 1,
                ..Registry::default()
            });
        };
        let registry: Registry = serde_json::from_slice(&bytes).map_err(|_| DENIED)?;
        if registry.version != 1
            || registry.devices.len() > 32
            || registry.profiles.len() > 128
            || registry.devices.iter().any(|d| {
                !hex(&d.id, 64)
                    || !hex(&d.verifier, 64)
                    || !valid_label(&d.label)
                    || d.grants.len() > 128
                    || d.grants.iter().any(|p| !registry.profiles.contains_key(p))
            })
            || registry
                .profiles
                .values()
                .any(|g| !hex(&g.opaque, 64) || !hex(&g.epoch, 64) || !hex(&g.alias, 64))
        {
            return Err(DENIED.into());
        }
        let mut ids = std::collections::HashSet::new();
        if registry.devices.iter().any(|d| !ids.insert(&d.id)) {
            return Err(DENIED.into());
        }
        let mut profiles = std::collections::HashSet::new();
        if registry.profiles.values().any(|g| !profiles.insert(&g.opaque)) {
            return Err(DENIED.into());
        }
        Ok(registry)
    }
    fn save(&self, registry: &Registry) -> Result<(), String> {
        let bytes = zeroize::Zeroizing::new(serde_json::to_vec(registry).map_err(|_| DENIED)?);
        if bytes.len() > 65536 {
            return Err(DENIED.into());
        }
        self.store.write(&bytes).map_err(|_| "mobile_registry_unavailable".into())
    }
    fn trim(state: &mut State, now: i64) {
        state.pairs.retain(|p| now >= p.created && now - p.created < 300);
    }
    pub fn begin(&self, now: i64) -> Result<String, String> {
        let mut state = self.state.lock().map_err(|_| DENIED)?;
        self.read()?;
        Self::trim(&mut state, now);
        if state.pairs.len() >= 4 {
            return Err("mobile_pairing_busy".into());
        }
        let code = random()?;
        state.pairs.push(Pairing {
            id: random()?,
            code: hash(&code),
            created: now,
            claim: None,
            label: String::new(),
            grants: None,
        });
        Ok(code)
    }
    pub fn redeem(&self, code: &str, label: &str, now: i64) -> Result<String, String> {
        let mut state = self.state.lock().map_err(|_| DENIED)?;
        self.read()?;
        Self::trim(&mut state, now);
        state.attempts.retain(|t| now >= *t && now - *t < 60);
        if state.attempts.len() >= 10 {
            return Err("mobile_pairing_rate_limited".into());
        }
        state.attempts.push(now);
        if !hex(code, 64) || !valid_label(label) {
            return Err(DENIED.into());
        }
        let pair = state
            .pairs
            .iter_mut()
            .find(|p| equal(&p.code, &hash(code)) && p.claim.is_none())
            .ok_or(DENIED)?;
        let claim = random()?;
        pair.claim = Some(hash(&claim));
        pair.label = label.into();
        Ok(claim)
    }
    pub fn pending(&self, now: i64) -> Vec<Pending> {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        Self::trim(&mut state, now);
        state
            .pairs
            .iter()
            .filter(|p| p.claim.is_some() && p.grants.is_none())
            .map(|p| Pending {
                id: p.id.clone(),
                label: p.label.clone(),
            })
            .collect()
    }
    pub fn decide(&self, id: &str, grants: Option<Vec<String>>, now: i64) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| DENIED)?;
        Self::trim(&mut state, now);
        self.read()?;
        let index = state
            .pairs
            .iter()
            .position(|p| p.id == id && p.claim.is_some() && p.grants.is_none())
            .ok_or(DENIED)?;
        if let Some(grants) = grants {
            if grants.is_empty() || grants.len() > 128 {
                return Err(DENIED.into());
            }
            state.pairs[index].grants = Some(grants);
        } else {
            state.pairs.remove(index);
        }
        Ok(())
    }
    pub fn complete(&self, claim: &str, installation: &str, now: i64) -> Result<String, String> {
        let mut state = self.state.lock().map_err(|_| DENIED)?;
        Self::trim(&mut state, now);
        if !hex(claim, 64) {
            return Err(DENIED.into());
        }
        let index = state
            .pairs
            .iter()
            .position(|p| p.claim.as_ref().is_some_and(|v| equal(v, &hash(claim))))
            .ok_or(DENIED)?;
        let pair = &state.pairs[index];
        let grants = pair.grants.clone().ok_or("mobile_confirmation_pending")?;
        let mut registry = self.read()?;
        if !registry.installation.is_empty() && registry.installation != installation {
            return Err(DENIED.into());
        }
        registry.installation = installation.into();
        registry.devices.retain(|d| d.expires > now);
        if registry.devices.len() >= 32 {
            return Err("mobile_device_limit".into());
        }
        for profile in &grants {
            if !registry.profiles.contains_key(profile) {
                registry.profiles.insert(
                    profile.clone(),
                    Grant {
                        opaque: random()?,
                        epoch: random()?,
                        alias: random()?,
                        sequence: 0,
                    },
                );
            }
        }
        if registry.profiles.len() > 128 {
            return Err("mobile_profile_limit".into());
        }
        let token = random()?;
        registry.devices.push(Device {
            id: random()?,
            label: pair.label.clone(),
            verifier: hash(&token),
            expires: now + LIFETIME,
            grants,
            last_seen: Some(now),
        });
        self.save(&registry)?;
        state.pairs.remove(index);
        Ok(token)
    }
    pub fn authenticate(&self, token: &str, now: i64) -> Result<Device, String> {
        let _guard = self.state.lock().map_err(|_| DENIED)?;
        self.auth(&self.read()?, token, now)
    }
    pub fn renew(&self, token: &str, installation: &str, now: i64) -> Result<Device, String> {
        let _guard = self.state.lock().map_err(|_| DENIED)?;
        let mut registry = self.read()?;
        if registry.installation != installation {
            return Err(DENIED.into());
        }
        let mut device = self.auth(&registry, token, now)?;
        if device.expires < now + LIFETIME - 86400 || device.last_seen.is_none_or(|last| now.saturating_sub(last) >= 300) {
            device.expires = device.expires.max(now + LIFETIME);
            device.last_seen = Some(now);
            *registry.devices.iter_mut().find(|d| d.id == device.id).ok_or(DENIED)? = device.clone();
            self.save(&registry)?;
        }
        Ok(device)
    }
    fn auth(&self, registry: &Registry, token: &str, now: i64) -> Result<Device, String> {
        if !hex(token, 64) {
            return Err(DENIED.into());
        }
        registry
            .devices
            .iter()
            .find(|d| d.expires > now && equal(&d.verifier, &hash(token)))
            .cloned()
            .ok_or_else(|| DENIED.into())
    }
    pub fn authorize(&self, token: &str, opaque: &str, now: i64) -> Result<(String, Grant), String> {
        let _guard = self.state.lock().map_err(|_| DENIED)?;
        let registry = self.read()?;
        let device = self.auth(&registry, token, now)?;
        let (internal, grant) = registry
            .profiles
            .iter()
            .find(|(internal, g)| g.opaque == opaque && device.grants.contains(internal))
            .ok_or(DENIED)?;
        Ok((internal.clone(), grant.clone()))
    }
    pub fn grant_for(&self, token: &str, internal: &str, now: i64) -> Result<Grant, String> {
        let _guard = self.state.lock().map_err(|_| DENIED)?;
        let registry = self.read()?;
        let device = self.auth(&registry, token, now)?;
        if !device.grants.iter().any(|p| p == internal) {
            return Err(DENIED.into());
        }
        registry.profiles.get(internal).cloned().ok_or_else(|| DENIED.into())
    }
    pub fn next(&self, token: &str, opaque: &str, installation: &str, now: i64) -> Result<(String, Grant), String> {
        let _guard = self.state.lock().map_err(|_| DENIED)?;
        let mut registry = self.read()?;
        let device = self.auth(&registry, token, now)?;
        if registry.installation != installation {
            return Err(DENIED.into());
        }
        let (internal, grant) = registry
            .profiles
            .iter_mut()
            .find(|(internal, g)| g.opaque == opaque && device.grants.contains(internal))
            .ok_or(DENIED)?;
        grant.sequence = grant.sequence.checked_add(1).ok_or(DENIED)?;
        let result = (internal.clone(), grant.clone());
        self.save(&registry)?;
        Ok(result)
    }
    pub fn revoke(&self, id: &str) -> Result<(), String> {
        let _guard = self.state.lock().map_err(|_| DENIED)?;
        let mut registry = self.read()?;
        registry.devices.retain(|d| d.id != id);
        self.save(&registry)
    }
    pub fn remove_profile(&self, id: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| DENIED)?;
        let mut registry = self.read()?;
        // In-flight approvals cannot regrant a removed profile.
        state.pairs.retain(|p| p.grants.as_ref().is_none_or(|g| !g.iter().any(|g| g == id)));
        if !registry.profiles.contains_key(id) {
            return Ok(());
        }
        for d in &mut registry.devices {
            d.grants.retain(|g| g != id);
        }
        registry.profiles.remove(id);
        self.save(&registry)
    }
    pub fn remove_grant(&self, device: &str, profile: &str) -> Result<(), String> {
        let _guard = self.state.lock().map_err(|_| DENIED)?;
        let mut registry = self.read()?;
        registry
            .devices
            .iter_mut()
            .find(|d| d.id == device)
            .ok_or(DENIED)?
            .grants
            .retain(|id| id != profile);
        self.save(&registry)
    }
    pub fn cancel(&self) {
        self.state.lock().unwrap_or_else(|p| p.into_inner()).pairs.clear();
    }
    /// Explicit desktop profile-list reset removes every old grant, including aliases
    /// that could otherwise match a later Default profile with a reused internal ID.
    pub fn reset_grants(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| DENIED)?;
        if self.store.read().is_ok_and(|bytes| bytes.is_none()) {
            state.pairs.clear();
            return Ok(());
        }
        let installation = self.read().map(|r| r.installation).unwrap_or_default();
        self.save(&Registry {
            version: 1,
            installation,
            ..Registry::default()
        })?;
        state.pairs.clear();
        Ok(())
    }
    pub fn reset_trust(&self) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| DENIED)?;
        self.save(&Registry {
            version: 1,
            ..Registry::default()
        })?;
        state.pairs.clear();
        Ok(())
    }
    pub fn list(&self) -> Result<Vec<serde_json::Value>, String> {
        let _guard = self.state.lock().map_err(|_| DENIED)?;
        Ok(self
            .read()?
            .devices
            .into_iter()
            .map(|d| serde_json::json!({"id":d.id,"label":d.label,"profiles":d.grants,"lastSeen":d.last_seen,"expires":d.expires}))
            .collect())
    }
}
fn valid_label(label: &str) -> bool {
    !label.trim().is_empty() && label.chars().count() <= 60 && !label.chars().any(char::is_control)
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::mobile_secrets::SecretStore;
    use std::sync::{Arc, Mutex};
    #[test]
    fn trust_reset_revokes_old_tokens_and_allows_a_new_installation() {
        let devices = Devices::new(Arc::new(Memory::default()));
        let code = devices.begin(100).unwrap();
        let claim = devices.redeem(&code, "Phone", 101).unwrap();
        devices.decide(&devices.pending(101)[0].id, Some(vec!["personal".into()]), 102).unwrap();
        let old = devices.complete(&claim, "old-root", 103).unwrap();
        let renewed = devices.renew(&old, "old-root", 403).unwrap();
        assert_eq!(renewed.last_seen, Some(403));
        assert_eq!(devices.renew(&old, "old-root", 404).unwrap().last_seen, Some(403));
        devices.reset_trust().unwrap();
        assert!(devices.authenticate(&old, 404).is_err());
        assert!(devices.list().unwrap().is_empty());
        let code = devices.begin(405).unwrap();
        let claim = devices.redeem(&code, "New phone", 406).unwrap();
        devices.decide(&devices.pending(406)[0].id, Some(vec!["personal".into()]), 407).unwrap();
        let token = devices.complete(&claim, "new-root", 408).unwrap();
        assert!(devices.renew(&token, "new-root", 409).is_ok());
    }
    #[derive(Default)]
    struct Memory(Mutex<Option<Vec<u8>>>);
    impl SecretStore for Memory {
        fn read(&self) -> Result<Option<zeroize::Zeroizing<Vec<u8>>>, String> {
            Ok(self.0.lock().unwrap().clone().map(zeroize::Zeroizing::new))
        }
        fn write(&self, bytes: &[u8]) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(bytes.to_vec());
            Ok(())
        }
    }
    #[test]
    fn approval_is_explicit_redemption_single_use_and_grants_are_narrow() {
        let devices = Devices::new(Arc::new(Memory::default()));
        let code = devices.begin(100).unwrap();
        let claim = devices.redeem(&code, "My phone", 101).unwrap();
        assert!(devices.redeem(&code, "Other phone", 101).is_err());
        assert!(devices.complete(&claim, "installation", 102).is_err());
        let pending = devices.pending(102);
        devices.decide(&pending[0].id, Some(vec!["work".into()]), 103).unwrap();
        let token = devices.complete(&claim, "installation", 104).unwrap();
        assert!(devices.complete(&claim, "installation", 104).is_err());
        let auth = devices.authenticate(&token, 104).unwrap();
        assert_eq!(auth.grants.len(), 1);
        assert!(devices.authorize(&token, "guessed", 104).is_err());
        devices.revoke(&auth.id).unwrap();
        assert!(devices.authenticate(&token, 104).is_err());
    }
    #[test]
    fn expiry_cancel_and_disk_corruption_fail_closed() {
        let memory = Arc::new(Memory::default());
        let devices = Devices::new(memory.clone());
        let code = devices.begin(0).unwrap();
        assert!(devices.redeem(&code, "Phone", 301).is_err());
        let code = devices.begin(302).unwrap();
        let claim = devices.redeem(&code, "Phone", 303).unwrap();
        devices.decide(&devices.pending(303)[0].id, None, 304).unwrap();
        assert!(devices.complete(&claim, "installation", 305).is_err());
        *memory.0.lock().unwrap() = Some(b"damaged".to_vec());
        assert!(devices.begin(306).is_err());
    }
    #[test]
    fn concurrent_redemption_and_completion_have_exactly_one_winner() {
        let devices = Arc::new(Devices::new(Arc::new(Memory::default())));
        let code = devices.begin(100).unwrap();
        let gate = Arc::new(std::sync::Barrier::new(3));
        let jobs: Vec<_> = (0..2)
            .map(|_| {
                let devices = devices.clone();
                let code = code.clone();
                let gate = gate.clone();
                std::thread::spawn(move || {
                    gate.wait();
                    devices.redeem(&code, "Phone", 101)
                })
            })
            .collect();
        gate.wait();
        let claims: Vec<_> = jobs.into_iter().filter_map(|job| job.join().unwrap().ok()).collect();
        assert_eq!(claims.len(), 1);
        devices
            .decide(&devices.pending(101)[0].id, Some(vec!["a".into(), "b".into()]), 102)
            .unwrap();
        let gate = Arc::new(std::sync::Barrier::new(3));
        let claim = claims[0].clone();
        let jobs: Vec<_> = (0..2)
            .map(|_| {
                let devices = devices.clone();
                let claim = claim.clone();
                let gate = gate.clone();
                std::thread::spawn(move || {
                    gate.wait();
                    devices.complete(&claim, "installation", 103)
                })
            })
            .collect();
        gate.wait();
        let tokens: Vec<_> = jobs.into_iter().filter_map(|job| job.join().unwrap().ok()).collect();
        assert_eq!(tokens.len(), 1);
        let token = &tokens[0];
        let device = devices.authenticate(token, 103).unwrap();
        let grant = devices.grant_for(token, "a", 103).unwrap();
        devices.remove_grant(&device.id, "a").unwrap();
        assert!(devices.authorize(token, &grant.opaque, 103).is_err());
        assert!(devices.grant_for(token, "b", 103).is_ok());
        devices.remove_profile("b").unwrap();
        assert!(devices.grant_for(token, "b", 103).is_err());
    }
    #[test]
    fn rate_limits_cancellation_restart_sequence_and_verifier_only_storage() {
        let memory = Arc::new(Memory::default());
        let devices = Devices::new(memory.clone());
        for _ in 0..10 {
            assert!(devices.redeem(&"0".repeat(64), "Phone", 100).is_err());
        }
        assert_eq!(devices.redeem(&"0".repeat(64), "Phone", 101).unwrap_err(), "mobile_pairing_rate_limited");
        let code = devices.begin(200).unwrap();
        let claim = devices.redeem(&code, "Phone", 201).unwrap();
        devices.cancel();
        assert!(devices.complete(&claim, "installation", 202).is_err());
        let code = devices.begin(203).unwrap();
        let claim = devices.redeem(&code, "Phone", 204).unwrap();
        devices.decide(&devices.pending(204)[0].id, Some(vec!["work".into()]), 205).unwrap();
        let token = devices.complete(&claim, "installation", 206).unwrap();
        let plain = String::from_utf8(memory.0.lock().unwrap().clone().unwrap()).unwrap();
        assert!(!plain.contains(&token));
        assert!(!plain.contains(&claim));
        assert!(!plain.contains(&code));
        let reopened = Devices::new(memory);
        let grant = reopened.grant_for(&token, "work", 207).unwrap();
        assert_eq!(reopened.next(&token, &grant.opaque, "installation", 207).unwrap().1.sequence, 1);
        assert_eq!(reopened.next(&token, &grant.opaque, "installation", 208).unwrap().1.sequence, 2);
        assert!(reopened.next(&token, &grant.opaque, "other-installation", 208).is_err());
        assert!(reopened.authenticate(&token, 206 + LIFETIME).is_err());
    }
    #[test]
    fn failed_registry_write_does_not_publish_or_consume_approval() {
        struct Fault {
            memory: Memory,
            fail: std::sync::atomic::AtomicBool,
        }
        impl SecretStore for Fault {
            fn read(&self) -> Result<Option<zeroize::Zeroizing<Vec<u8>>>, String> {
                self.memory.read()
            }
            fn write(&self, bytes: &[u8]) -> Result<(), String> {
                if self.fail.load(std::sync::atomic::Ordering::SeqCst) {
                    Err("refused".into())
                } else {
                    self.memory.write(bytes)
                }
            }
        }
        let store = Arc::new(Fault {
            memory: Memory::default(),
            fail: std::sync::atomic::AtomicBool::new(true),
        });
        let devices = Devices::new(store.clone());
        let code = devices.begin(100).unwrap();
        let claim = devices.redeem(&code, "Phone", 101).unwrap();
        devices.decide(&devices.pending(101)[0].id, Some(vec!["work".into()]), 102).unwrap();
        assert!(devices.complete(&claim, "installation", 103).is_err());
        assert!(store.memory.0.lock().unwrap().is_none());
        store.fail.store(false, std::sync::atomic::Ordering::SeqCst);
        let token = devices.complete(&claim, "installation", 104).unwrap();
        let original = store.memory.0.lock().unwrap().clone();
        store.fail.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(devices.revoke(&devices.authenticate(&token, 104).unwrap().id).is_err());
        assert_eq!(*store.memory.0.lock().unwrap(), original);
        assert!(devices.authenticate(&token, 104).is_ok());
    }
    #[test]
    fn explicit_profile_list_reset_cannot_reuse_old_device_or_default_grants() {
        let memory = Arc::new(Memory::default());
        let devices = Devices::new(memory.clone());
        let code = devices.begin(100).unwrap();
        let claim = devices.redeem(&code, "Phone", 101).unwrap();
        devices.decide(&devices.pending(101)[0].id, Some(vec!["default".into()]), 102).unwrap();
        let token = devices.complete(&claim, "installation", 103).unwrap();
        let old = devices.grant_for(&token, "default", 103).unwrap();
        devices.reset_grants().unwrap();
        assert!(devices.authenticate(&token, 104).is_err());
        assert!(devices.authorize(&token, &old.opaque, 104).is_err());
        *memory.0.lock().unwrap() = Some(b"damaged".to_vec());
        assert!(devices.begin(105).is_err());
        devices.reset_grants().unwrap();
        assert!(devices.list().unwrap().is_empty());
    }
}
