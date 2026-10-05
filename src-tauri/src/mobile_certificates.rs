//! One protected installation identity; leaf renewal never silently replaces the trusted root.
use crate::mobile_secrets::SecretStore;
use rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair, KeyUsagePurpose, PublicKeyData,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::Ipv4Addr;
use std::sync::Arc;
use zeroize::{Zeroize, Zeroizing};

const DAY: i64 = 86400;
const INVALID: &str =
    "Saved mobile certificates could not be verified. Mobile access remains stopped; restore the saved identity or explicitly reset trust.";
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CertificateBundle {
    version: u32,
    pub installation_id: String,
    pub ipv4: Ipv4Addr,
    #[serde(default)]
    pub hostname: Option<String>,
    pub root_pem: String,
    root_key: String,
    pub leaf_pem: String,
    leaf_key: String,
    pub root_expires: i64,
    pub leaf_expires: i64,
}
impl Drop for CertificateBundle {
    fn drop(&mut self) {
        self.root_key.zeroize();
        self.leaf_key.zeroize();
    }
}
impl CertificateBundle {
    pub fn fingerprint(&self) -> Result<String, String> {
        let der = pem_der(&self.root_pem)?;
        Ok(Sha256::digest(der).iter().map(|n| format!("{n:02X}")).collect::<Vec<_>>().join(":"))
    }
    pub fn tls_config(&self) -> Result<Arc<rustls::ServerConfig>, String> {
        let certificates = rustls_pemfile::certs(&mut self.leaf_pem.as_bytes())
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| INVALID)?;
        let key = rustls_pemfile::private_key(&mut self.leaf_key.as_bytes())
            .map_err(|_| INVALID)?
            .ok_or(INVALID)?;
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let mut config = rustls::ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|_| INVALID)?
            .with_no_client_auth()
            .with_single_cert(certificates, key)
            .map_err(|_| INVALID)?;
        config.alpn_protocols = vec![b"http/1.1".to_vec()];
        Ok(Arc::new(config))
    }
    fn validate(&self, now: i64) -> Result<(), String> {
        if self.version != 1 || self.installation_id.len() != 32 || !self.installation_id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(INVALID.into());
        }
        let root = pem_der(&self.root_pem)?;
        let leaf = pem_der(&self.leaf_pem)?;
        let (_, root) = x509_parser::parse_x509_certificate(&root).map_err(|_| INVALID)?;
        let (_, leaf) = x509_parser::parse_x509_certificate(&leaf).map_err(|_| INVALID)?;
        if !root.is_ca()
            || leaf.is_ca()
            || root.validity().not_after.timestamp() != self.root_expires
            || leaf.validity().not_after.timestamp() != self.leaf_expires
            || root.validity().not_before.timestamp() > now
            || leaf.validity().not_before.timestamp() > now
            || root.subject() != leaf.issuer()
        {
            return Err(INVALID.into());
        }
        root.verify_signature(None).map_err(|_| INVALID)?;
        leaf.verify_signature(Some(root.public_key())).map_err(|_| INVALID)?;
        let san = leaf.subject_alternative_name().map_err(|_| INVALID)?.ok_or(INVALID)?;
        if san.value.general_names.len() != 1
            || !san.value.general_names.iter().any(|name| match (&self.hostname, name) {
                (Some(host), x509_parser::extensions::GeneralName::DNSName(value)) => host == value && *host == local_hostname(&self.installation_id),
                (None, x509_parser::extensions::GeneralName::IPAddress(bytes)) => *bytes == self.ipv4.octets(),
                _ => false,
            })
        {
            return Err(INVALID.into());
        }
        let root_key = KeyPair::from_pem(&self.root_key).map_err(|_| INVALID)?;
        if root_key.subject_public_key_info() != root.public_key().raw {
            return Err(INVALID.into());
        }
        self.tls_config()?;
        Ok(())
    }
}
fn pem_der(pem: &str) -> Result<Vec<u8>, String> {
    rustls_pemfile::certs(&mut pem.as_bytes())
        .next()
        .ok_or(INVALID)?
        .map(|c| c.to_vec())
        .map_err(|_| INVALID.into())
}
fn dates(params: &mut CertificateParams, now: i64, days: i64) -> Result<(), String> {
    params.not_before = time::OffsetDateTime::from_unix_timestamp(now - 300).map_err(|_| INVALID)?;
    params.not_after = time::OffsetDateTime::from_unix_timestamp(now + days * DAY).map_err(|_| INVALID)?;
    Ok(())
}
fn renew(bundle: &mut CertificateBundle, now: i64) -> Result<(), String> {
    let root_key = KeyPair::from_pem(&bundle.root_key).map_err(|_| INVALID)?;
    let issuer = Issuer::from_ca_cert_pem(&bundle.root_pem, root_key).map_err(|_| INVALID)?;
    let leaf_key = KeyPair::generate().map_err(|_| INVALID)?;
    let mut leaf = CertificateParams::new(vec![bundle.hostname.clone().unwrap_or_else(|| bundle.ipv4.to_string())]).map_err(|_| INVALID)?;
    dates(&mut leaf, now, 90)?;
    leaf.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    leaf.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    leaf.distinguished_name = DistinguishedName::new();
    leaf.distinguished_name.push(DnType::CommonName, "Vault Spend mobile viewer");
    let certificate = leaf.signed_by(&leaf_key, &issuer).map_err(|_| INVALID)?;
    bundle.leaf_key.zeroize();
    bundle.leaf_key = leaf_key.serialize_pem();
    bundle.leaf_pem = certificate.pem();
    bundle.leaf_expires = now + 90 * DAY;
    Ok(())
}
pub fn ensure_identity(store: &dyn SecretStore, ipv4: Ipv4Addr, now: i64) -> Result<CertificateBundle, String> {
    let _guard = store.lock();
    if let Some(bytes) = store.read()? {
        let mut bundle: CertificateBundle = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
        bundle.validate(now)?;
        if bundle.ipv4 != ipv4 {
            return Err("The desktop address changed. Keep the previous origin or explicitly reset mobile setup; saved phone storage will not move to a new address.".into());
        }
        if bundle.root_expires <= now + 91 * DAY {
            return Err("The mobile root certificate needs an explicit trust reset. Mobile access remains stopped.".into());
        }
        if bundle.leaf_expires <= now + 14 * DAY {
            renew(&mut bundle, now)?;
            let bytes = Zeroizing::new(serde_json::to_vec(&bundle).map_err(|_| INVALID)?);
            store.write(&bytes)?;
        }
        return Ok(bundle);
    }
    create_identity(store, ipv4, now)
}
pub fn local_hostname(id: &str) -> String {
    format!("vault-spend-{id}.local")
}
/// Explicit guided migration retains the local root but uses a stable DNS identity.
/// Missing/corrupt protected storage is checked by the service before this call.
pub fn ensure_guided_identity(store: &dyn SecretStore, ipv4: Ipv4Addr, now: i64) -> Result<CertificateBundle, String> {
    let _guard = store.lock();
    let mut bundle = match store.read()? {
        Some(bytes) => {
            let value: CertificateBundle = serde_json::from_slice(&bytes).map_err(|_| INVALID)?;
            value.validate(now)?;
            value
        }
        None => create_identity(store, ipv4, now)?,
    };
    if bundle.root_expires <= now + 91 * DAY {
        return Err("The mobile root certificate needs an explicit trust reset.".into());
    }
    let hostname = local_hostname(&bundle.installation_id);
    if bundle.hostname.as_ref().is_some_and(|saved| saved != &hostname) {
        return Err(INVALID.into());
    }
    if bundle.hostname.is_none() || bundle.ipv4 != ipv4 || bundle.leaf_expires <= now + 14 * DAY {
        bundle.hostname = Some(hostname);
        bundle.ipv4 = ipv4;
        renew(&mut bundle, now)?;
        bundle.validate(now)?;
        store.write(&Zeroizing::new(serde_json::to_vec(&bundle).map_err(|_| INVALID)?))?;
    }
    Ok(bundle)
}
/// Desktop-only explicit trust replacement; callers stop delivery and revoke all grants first.
pub fn reset_identity(store: &dyn SecretStore, ipv4: Ipv4Addr, now: i64) -> Result<CertificateBundle, String> {
    let _guard = store.lock();
    create_identity(store, ipv4, now)
}
fn create_identity(store: &dyn SecretStore, ipv4: Ipv4Addr, now: i64) -> Result<CertificateBundle, String> {
    let mut id = [0u8; 16];
    getrandom::fill(&mut id).map_err(|_| INVALID)?;
    let id = id.iter().map(|n| format!("{n:02x}")).collect::<String>();
    let root_key = KeyPair::generate().map_err(|_| INVALID)?;
    let mut root = CertificateParams::new(Vec::<String>::new()).map_err(|_| INVALID)?;
    dates(&mut root, now, 3650)?;
    root.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    root.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    root.distinguished_name = DistinguishedName::new();
    root.distinguished_name
        .push(DnType::CommonName, format!("Vault Spend local root {}", &id[..8]));
    let certificate = root.self_signed(&root_key).map_err(|_| INVALID)?;
    let mut bundle = CertificateBundle {
        version: 1,
        installation_id: id,
        hostname: None,
        ipv4,
        root_pem: certificate.pem(),
        root_key: root_key.serialize_pem(),
        leaf_pem: String::new(),
        leaf_key: String::new(),
        root_expires: now + 3650 * DAY,
        leaf_expires: 0,
    };
    renew(&mut bundle, now)?;
    bundle.validate(now)?;
    let bytes = Zeroizing::new(serde_json::to_vec(&bundle).map_err(|_| INVALID)?);
    store.write(&bytes)?;
    Ok(bundle)
}
#[cfg(test)]
#[derive(Default)]
pub struct MemorySecrets {
    pub bytes: std::sync::Mutex<Option<Vec<u8>>>,
    pub fail: std::sync::atomic::AtomicBool,
}
#[cfg(test)]
impl SecretStore for MemorySecrets {
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        if self.fail.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Injected secret-store refusal".into());
        }
        Ok(self.bytes.lock().unwrap().clone().map(Zeroizing::new))
    }
    fn write(&self, bytes: &[u8]) -> Result<(), String> {
        if self.fail.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Injected secret-store refusal".into());
        }
        *self.bytes.lock().unwrap() = Some(bytes.to_vec());
        Ok(())
    }
}

#[cfg(test)]
mod guided_tests {
    use super::*;
    #[test]
    fn guided_dhcp_migration_retains_root_and_name_but_renews_leaf() {
        let store = MemorySecrets::default();
        let now = 1_800_000_000;
        let old = ensure_identity(&store, "192.168.1.2".parse().unwrap(), now).unwrap();
        let first = ensure_guided_identity(&store, old.ipv4, now).unwrap();
        assert_eq!(first.root_pem, old.root_pem);
        assert_eq!(first.installation_id, old.installation_id);
        assert_eq!(first.hostname.as_deref(), Some(local_hostname(&old.installation_id).as_str()));
        let next = ensure_guided_identity(&store, "192.168.1.3".parse().unwrap(), now + 1).unwrap();
        assert_eq!(next.root_pem, first.root_pem);
        assert_eq!(next.hostname, first.hostname);
        assert_ne!(next.leaf_pem, first.leaf_pem);
        next.validate(now + 1).unwrap();
    }
    #[test]
    fn damaged_named_identity_cannot_rebind_or_replace_root() {
        let store = MemorySecrets::default();
        let now = 1_800_000_000;
        ensure_guided_identity(&store, "192.168.1.2".parse().unwrap(), now).unwrap();
        let mut value: serde_json::Value = serde_json::from_slice(store.bytes.lock().unwrap().as_ref().unwrap()).unwrap();
        value["hostname"] = serde_json::json!("attacker.local");
        *store.bytes.lock().unwrap() = Some(serde_json::to_vec(&value).unwrap());
        let before = store.bytes.lock().unwrap().clone();
        assert!(ensure_guided_identity(&store, "192.168.1.3".parse().unwrap(), now).is_err());
        assert_eq!(before, *store.bytes.lock().unwrap());
    }
}
