//! Opt-in local HTTPS for embedded public viewer assets only. Task 6 adds typed authorized APIs.
use crate::mobile_certificates::{ensure_guided_identity, ensure_identity, CertificateBundle};
use crate::mobile_secrets::{OsSecrets, SecretStore};
use http_body_util::Full;
use hyper::{body::Bytes, service::service_fn, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde::{Deserialize, Serialize};
use std::{
    convert::Infallible,
    net::{Ipv4Addr, TcpListener},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tokio::{
    sync::{oneshot, Semaphore},
    task::JoinSet,
};

pub struct Asset {
    pub path: &'static str,
    pub content: &'static [u8],
    pub content_type: &'static str,
}
include!(concat!(env!("OUT_DIR"), "/mobile_assets.rs"));
const CSP:&str="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MobileConfig {
    pub enabled: bool,
    pub ipv4: Ipv4Addr,
    pub port: u16,
    pub interface: String,
    #[serde(default)]
    pub identity_initialized: bool,
    #[serde(default)]
    pub hostname: Option<String>,
}
impl MobileConfig {
    pub fn validate(&self) -> Result<(), String> {
        if !self.ipv4.is_private() || self.ipv4.is_broadcast() || self.port < 1024 || self.interface.trim().is_empty() || self.interface.len() > 256 {
            return Err("Choose a private IPv4 address on this computer, its interface, and a fixed port from 1024 to 65535.".into());
        }
        if self.hostname.as_ref().is_some_and(|host| !valid_local_hostname(host)) {
            return Err("Invalid local viewer name.".into());
        }
        Ok(())
    }
    pub fn origin(&self) -> String {
        format!("https://{}:{}", self.hostname.clone().unwrap_or_else(|| self.ipv4.to_string()), self.port)
    }
    pub fn present_in(&self, interfaces: &[(String, Ipv4Addr)]) -> bool {
        interfaces.iter().any(|(name, ip)| name == &self.interface && *ip == self.ipv4)
    }
    pub(crate) fn available(&self) -> bool {
        self.present_in(&interfaces())
    }
}
pub fn valid_local_hostname(host: &str) -> bool {
    host.strip_prefix("vault-spend-")
        .and_then(|s| s.strip_suffix(".local"))
        .is_some_and(|id| id.len() == 32 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}
fn identity(store: &dyn SecretStore, config: &MobileConfig, now: i64) -> Result<CertificateBundle, String> {
    let bundle = if config.hostname.is_some() {
        ensure_guided_identity(store, config.ipv4, now)?
    } else {
        ensure_identity(store, config.ipv4, now)?
    };
    if config.hostname != bundle.hostname {
        return Err("The local name does not match this installation.".into());
    }
    Ok(bundle)
}
pub fn interfaces() -> Vec<(String, Ipv4Addr)> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.ip() {
            std::net::IpAddr::V4(ip) if ip.is_private() && !i.is_loopback() => Some((i.name, ip)),
            _ => None,
        })
        .collect()
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileStatus {
    pub running: bool,
    pub origin: Option<String>,
    pub fingerprint: Option<String>,
    pub leaf_expires: Option<i64>,
    pub error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicCertificate {
    pub pem: String,
    pub fingerprint: String,
    pub installation_id: String,
}
struct Running {
    stop: oneshot::Sender<()>,
    thread: thread::JoinHandle<()>,
}
impl Running {
    fn stop(self) {
        let _ = self.stop.send(());
        let _ = self.thread.join();
    }
}
#[derive(Clone)]
pub struct MobileService {
    inner: Arc<ServiceInner>,
}
struct ServiceInner {
    routes: Mutex<Option<Arc<dyn crate::mobile_api::Routes>>>,
    directory: PathBuf,
    secrets: Arc<OsSecrets>,
    operations: Mutex<()>,
    running: Mutex<Option<Running>>,
    setup: Mutex<Option<crate::mobile_bootstrap::Bootstrap>>,
    status: Arc<Mutex<MobileStatus>>,
    suspended: std::sync::atomic::AtomicBool,
    supervisor: Mutex<Option<thread::JoinHandle<()>>>,
}
impl MobileService {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            inner: Arc::new(ServiceInner {
                routes: Mutex::new(None),
                secrets: Arc::new(OsSecrets::new(directory.join("mobile-certificates.protected"))),
                operations: Mutex::new(()),
                directory,
                running: Mutex::new(None),
                setup: Mutex::new(None),
                status: Arc::new(Mutex::new(MobileStatus::default())),
                suspended: std::sync::atomic::AtomicBool::new(false),
                supervisor: Mutex::new(None),
            }),
        }
    }
    pub fn status(&self) -> MobileStatus {
        self.inner.status.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
    pub fn saved_config(&self) -> Result<Option<MobileConfig>, String> {
        self.load_config()
    }
    pub fn reset_trust(&self, mut config: MobileConfig, devices: &crate::mobile_devices::Devices) -> Result<MobileStatus, String> {
        let _operation = self.inner.operations.lock().unwrap_or_else(|p| p.into_inner());
        config.validate()?;
        if !config.available() {
            return Err("Choose an available local network before resetting mobile trust.".into());
        }
        self.stop_checked();
        config.hostname = None;
        config.enabled = false;
        // A failed reset stays disabled even after restarting the desktop.
        self.save_config(&config)?;
        devices.reset_trust()?;
        let bundle = crate::mobile_certificates::reset_identity(self.secrets().as_ref(), config.ipv4, chrono::Utc::now().timestamp())?;
        config.identity_initialized = true;
        self.save_config(&config)?;
        *self.inner.status.lock().unwrap_or_else(|p| p.into_inner()) = MobileStatus {
            running: false,
            origin: Some(config.origin()),
            fingerprint: Some(bundle.fingerprint()?),
            leaf_expires: Some(bundle.leaf_expires),
            error: None,
        };
        Ok(self.status())
    }
    pub fn attach(&self, app: tauri::AppHandle) {
        let weak = Arc::downgrade(&self.inner);
        let mut supervisor = self.inner.supervisor.lock().unwrap_or_else(|p| p.into_inner());
        if supervisor.is_none() {
            *supervisor = thread::Builder::new()
                .name("mobile-network-monitor".into())
                .spawn(move || loop {
                    thread::sleep(Duration::from_secs(2));
                    let Some(inner) = weak.upgrade() else {
                        break;
                    };
                    let service = MobileService { inner };
                    if let Err(error) = service.refresh_network() {
                        service.inner.status.lock().unwrap_or_else(|p| p.into_inner()).error = Some(error);
                    }
                })
                .ok();
        }

        *self.inner.routes.lock().unwrap_or_else(|p| p.into_inner()) = Some(Arc::new(crate::mobile_api::DesktopRoutes(app)));
    }
    fn config_path(&self) -> PathBuf {
        self.inner.directory.join("mobile-network.json")
    }
    fn secrets(&self) -> Arc<OsSecrets> {
        self.inner.secrets.clone()
    }
    fn load_config(&self) -> Result<Option<MobileConfig>, String> {
        let file = match std::fs::File::open(self.config_path()) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("Mobile network settings could not be opened; mobile access remains stopped.".into()),
        };
        use std::io::Read;
        let mut bytes = Vec::new();
        file.take(4097)
            .read_to_end(&mut bytes)
            .map_err(|_| "Mobile network settings could not be opened.")?;
        if bytes.len() > 4096 {
            return Err("Mobile network settings are invalid; mobile access remains stopped.".into());
        }
        let config: MobileConfig =
            serde_json::from_slice(&bytes).map_err(|_| "Mobile network settings are invalid; mobile access remains stopped.")?;
        config.validate()?;
        Ok(Some(config))
    }
    fn save_config(&self, config: &MobileConfig) -> Result<(), String> {
        budget_core::fsutil::write_atomic(
            &self.config_path(),
            &serde_json::to_vec(config).map_err(|_| "Mobile settings could not be saved.")?,
        )
        .map_err(|_| "Mobile settings could not be saved. Check storage permissions.".into())
    }
    pub fn stop(&self) {
        let _operation = self.inner.operations.lock().unwrap_or_else(|p| p.into_inner());
        self.inner.suspended.store(true, std::sync::atomic::Ordering::SeqCst);
        self.stop_checked();
    }
    fn stop_checked(&self) {
        self.inner.setup.lock().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(routes) = self.inner.routes.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            routes.cancel();
        }
        if let Some(running) = self.inner.running.lock().unwrap_or_else(|p| p.into_inner()).take() {
            running.stop();
        }
        self.inner.status.lock().unwrap_or_else(|p| p.into_inner()).running = false;
    }
    pub fn resume(&self) {
        self.inner.suspended.store(false, std::sync::atomic::Ordering::SeqCst);
        let _operation = self.inner.operations.lock().unwrap_or_else(|p| p.into_inner());
        if let Err(error) = self.resume_checked() {
            self.inner.status.lock().unwrap_or_else(|p| p.into_inner()).error = Some(error);
        }
    }
    fn resume_checked(&self) -> Result<(), String> {
        if let Some(config) = self.load_config()? {
            if config.enabled {
                self.configure_checked(config)?;
            }
        }
        Ok(())
    }
    pub fn configure(&self, config: MobileConfig) -> Result<MobileStatus, String> {
        let _operation = self.inner.operations.lock().unwrap_or_else(|p| p.into_inner());
        let result = self.configure_checked(config);
        if let Err(error) = &result {
            self.inner.status.lock().unwrap_or_else(|p| p.into_inner()).error = Some(error.clone());
        }
        result
    }
    pub fn configure_guided(&self, mut config: MobileConfig) -> Result<MobileStatus, String> {
        let _operation = self.inner.operations.lock().unwrap_or_else(|p| p.into_inner());
        config.validate()?;
        if !config.enabled || !config.available() {
            return Err("Choose your available private home network.".into());
        }
        if self.load_config()?.is_some_and(|c| c.identity_initialized) && self.secrets().read()?.is_none() {
            return Err("The saved mobile identity is missing. Reset trust explicitly before setup.".into());
        }
        self.stop_checked();
        let bundle = ensure_guided_identity(self.secrets().as_ref(), config.ipv4, chrono::Utc::now().timestamp())?;
        config.hostname = bundle.hostname.clone();
        config.identity_initialized = true;
        self.configure_checked(config)
    }
    pub fn refresh_network(&self) -> Result<(), String> {
        let _operation = self.inner.operations.lock().unwrap_or_else(|p| p.into_inner());
        if self.inner.suspended.load(std::sync::atomic::Ordering::SeqCst) {
            return Ok(());
        }
        let Some(mut config) = self.load_config()? else {
            return Ok(());
        };
        if !config.enabled || config.hostname.is_none() {
            return Ok(());
        }
        let candidates: Vec<_> = interfaces().into_iter().filter(|(name, _)| name == &config.interface).collect();
        if candidates.len() == 1 && candidates[0].1 != config.ipv4 {
            self.stop_checked();
            config.ipv4 = candidates[0].1;
            self.configure_checked(config)?;
        } else if config.available()
            && !self.status().running
            && self
                .status()
                .error
                .as_deref()
                .is_some_and(|e| e.starts_with("The selected network changed"))
        {
            self.configure_checked(config)?;
        }
        Ok(())
    }
    fn configure_checked(&self, mut config: MobileConfig) -> Result<MobileStatus, String> {
        config.validate()?;
        self.inner.suspended.store(false, std::sync::atomic::Ordering::SeqCst);
        self.inner.setup.lock().unwrap_or_else(|p| p.into_inner()).take();
        // Caller omission cannot downgrade the persisted expectation of an existing root.
        if let Some(saved) = self.load_config()? {
            config.identity_initialized |= saved.identity_initialized;
            if config.hostname.is_none() {
                config.hostname = saved.hostname;
            }
        }
        if !config.enabled {
            self.stop_checked();
            self.save_config(&config)?;
            self.inner.status.lock().unwrap_or_else(|p| p.into_inner()).error = None;
            return Ok(self.status());
        }
        if !config.available() {
            return Err("The selected network address/interface is unavailable. Reconnect to that network or explicitly update mobile setup.".into());
        }
        let mut running = self.inner.running.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(prior) = running.take() {
            prior.stop();
        }
        self.inner.status.lock().unwrap_or_else(|p| p.into_inner()).running = false;
        if let Some(routes) = self.inner.routes.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            routes.cancel();
        }
        if config.identity_initialized && self.secrets().read()?.is_none() {
            return Err("The saved mobile identity is missing. Explicitly reset trust before creating a replacement.".into());
        }
        let listener = TcpListener::bind((config.ipv4, config.port))
            .map_err(|_| "The mobile HTTPS address/port could not be opened. Check for a port conflict or unavailable interface.")?;
        let store = self.secrets();
        let bundle = identity(store.as_ref(), &config, chrono::Utc::now().timestamp())?;
        let config_tls = bundle.tls_config()?;
        // Persist opt-in before publishing a listener. A failed write never starts it.
        config.identity_initialized = true;
        self.save_config(&config)?;
        let handle = start_listener_with_app(
            listener,
            config,
            true,
            store,
            bundle,
            config_tls,
            self.inner.status.clone(),
            self.inner.routes.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        )?;
        *running = Some(handle);
        Ok(self.status())
    }
    /// Compiled-app fixture only. Requires the existing disposable E2E data override,
    /// binds loopback with an ephemeral port, and never writes a LAN opt-in setting.
    #[cfg(debug_assertions)]
    pub fn start_test_fixture(&self) -> Result<(MobileStatus, PublicCertificate), String> {
        let _operation = self.inner.operations.lock().unwrap_or_else(|p| p.into_inner());
        let override_dir = std::env::var_os("VAULTSPEND_DB_DIR").ok_or("A disposable test directory is required.")?;
        if std::fs::canonicalize(override_dir).ok() != std::fs::canonicalize(&self.inner.directory).ok() {
            return Err("A disposable test directory is required.".into());
        }
        let mut running = self.inner.running.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(prior) = running.take() {
            prior.stop();
        }
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|_| "Test HTTPS could not bind.")?;
        let config = MobileConfig {
            enabled: true,
            ipv4: Ipv4Addr::LOCALHOST,
            port: listener.local_addr().map_err(|_| "Test HTTPS could not bind.")?.port(),
            interface: "test-only-loopback".into(),
            identity_initialized: false,
            hostname: None,
        };
        let store = self.secrets();
        let bundle = identity(store.as_ref(), &config, chrono::Utc::now().timestamp())?;
        let public = PublicCertificate {
            pem: bundle.root_pem.clone(),
            fingerprint: bundle.fingerprint()?,
            installation_id: bundle.installation_id.clone(),
        };
        let tls = bundle.tls_config()?;
        *running = Some(start_listener_with_app(
            listener,
            config,
            false,
            store,
            bundle,
            tls,
            self.inner.status.clone(),
            self.inner.routes.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        )?);
        Ok((self.status(), public))
    }
    #[cfg(debug_assertions)]
    pub fn start_test_setup_fixture(&self) -> Result<crate::mobile_bootstrap::SetupInfo, String> {
        let _operation = self.inner.operations.lock().unwrap_or_else(|p| p.into_inner());
        let directory = std::env::var_os("VAULTSPEND_DB_DIR").ok_or("Disposable data required.")?;
        let expected = std::fs::canonicalize(directory).map_err(|_| "Disposable data required.")?;
        if std::fs::canonicalize(&self.inner.directory).ok().as_ref() != Some(&expected) || !self.status().running {
            return Err("Start the disposable HTTPS fixture first.".into());
        }
        let config = MobileConfig {
            enabled: true,
            ipv4: Ipv4Addr::LOCALHOST,
            port: self
                .status()
                .origin
                .as_deref()
                .and_then(|s| s.rsplit(':').next())
                .and_then(|s| s.parse().ok())
                .ok_or("Fixture address unavailable.")?,
            interface: "fixture-only".into(),
            identity_initialized: false,
            hostname: None,
        };
        let bundle = ensure_identity(self.secrets().as_ref(), config.ipv4, chrono::Utc::now().timestamp())?;
        let public = PublicCertificate {
            pem: bundle.root_pem.clone(),
            fingerprint: bundle.fingerprint()?,
            installation_id: bundle.installation_id.clone(),
        };
        let mut setup = self.inner.setup.lock().unwrap_or_else(|p| p.into_inner());
        setup.take();
        let bootstrap = crate::mobile_bootstrap::start(config, public, false)?;
        // Fixture viewer uses the running ephemeral HTTPS address, not the lab config's fixed port.
        // Test serves public setup/certificate routes; it makes no phone-trust claim.
        let info = bootstrap.info.clone();
        *setup = Some(bootstrap);
        Ok(info)
    }
    pub fn begin_setup(&self) -> Result<crate::mobile_bootstrap::SetupInfo, String> {
        let _operation = self.inner.operations.lock().unwrap_or_else(|p| p.into_inner());
        if !self.status().running {
            return Err("Enable local access before showing phone setup.".into());
        }
        let config = self.load_config()?.ok_or("Mobile configuration unavailable.")?;
        if !config.available() {
            return Err("Your selected home network is unavailable.".into());
        }
        let public = match self.public_certificate_checked() {
            Ok(public) => public,
            Err(error) => {
                self.stop_checked();
                self.inner.status.lock().unwrap_or_else(|p| p.into_inner()).error = Some(error.clone());
                return Err(error);
            }
        };
        let mut setup = self.inner.setup.lock().unwrap_or_else(|p| p.into_inner());
        setup.take();
        let next = crate::mobile_bootstrap::start(config, public, true)?;
        let info = next.info.clone();
        *setup = Some(next);
        Ok(info)
    }
    pub fn cancel_setup(&self) {
        self.inner.setup.lock().unwrap_or_else(|p| p.into_inner()).take();
    }
    pub fn setup_status(&self) -> Option<crate::mobile_bootstrap::SetupInfo> {
        let mut setup = self.inner.setup.lock().unwrap_or_else(|p| p.into_inner());
        if !self.status().running || setup.as_ref().is_some_and(|s| s.info.expires <= chrono::Utc::now().timestamp()) {
            setup.take();
        }
        setup.as_ref().map(|s| s.info.clone())
    }
    pub fn disable(&self) -> Result<MobileStatus, String> {
        let _operation = self.inner.operations.lock().unwrap_or_else(|p| p.into_inner());
        self.stop_checked();
        if let Some(mut config) = self.load_config()? {
            config.enabled = false;
            self.save_config(&config)?;
        }
        self.inner.status.lock().unwrap_or_else(|p| p.into_inner()).error = None;
        Ok(self.status())
    }
    pub fn public_certificate(&self) -> Result<PublicCertificate, String> {
        let _operation = self.inner.operations.lock().unwrap_or_else(|p| p.into_inner());
        let result = self.public_certificate_checked();
        if let Err(error) = &result {
            self.stop_checked();
            self.inner.status.lock().unwrap_or_else(|p| p.into_inner()).error = Some(error.clone());
        }
        result
    }
    fn public_certificate_checked(&self) -> Result<PublicCertificate, String> {
        let mut config = self
            .load_config()?
            .ok_or("Choose the mobile network before exporting its public certificate.")?;
        if config.identity_initialized && self.secrets().read()?.is_none() {
            return Err("The saved mobile identity is missing. Explicitly reset trust before creating a replacement.".into());
        }
        let bundle = identity(self.secrets().as_ref(), &config, chrono::Utc::now().timestamp())?;
        config.identity_initialized = true;
        self.save_config(&config)?;
        Ok(PublicCertificate {
            pem: bundle.root_pem.clone(),
            fingerprint: bundle.fingerprint()?,
            installation_id: bundle.installation_id.clone(),
        })
    }
}
impl Drop for ServiceInner {
    fn drop(&mut self) {
        self.setup.get_mut().unwrap_or_else(|p| p.into_inner()).take();
        if let Some(running) = self.running.get_mut().unwrap_or_else(|p| p.into_inner()).take() {
            running.stop();
        }
    }
}

#[cfg(test)]
fn start_listener(
    listener: TcpListener,
    config: MobileConfig,
    check_interface: bool,
    store: Arc<dyn SecretStore>,
    bundle: CertificateBundle,
    tls: Arc<rustls::ServerConfig>,
    status: Arc<Mutex<MobileStatus>>,
) -> Result<Running, String> {
    start_listener_with_app(listener, config, check_interface, store, bundle, tls, status, None)
}
#[allow(clippy::too_many_arguments)]
fn start_listener_with_app(
    listener: TcpListener,
    config: MobileConfig,
    check_interface: bool,
    store: Arc<dyn SecretStore>,
    mut bundle: CertificateBundle,
    tls: Arc<rustls::ServerConfig>,
    status: Arc<Mutex<MobileStatus>>,
    app: Option<Arc<dyn crate::mobile_api::Routes>>,
) -> Result<Running, String> {
    listener.set_nonblocking(true).map_err(|_| "Mobile HTTPS could not start.")?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|_| "Mobile HTTPS could not start.")?;
    let discovery = if check_interface {
        config
            .hostname
            .as_ref()
            .map(|host| crate::mobile_discovery::Discovery::start(&config.interface, config.ipv4, config.port, host))
            .transpose()?
    } else {
        None
    };
    let (stop, mut stopped) = oneshot::channel();
    let initial = MobileStatus {
        running: true,
        origin: Some(config.origin()),
        fingerprint: Some(bundle.fingerprint()?),
        leaf_expires: Some(bundle.leaf_expires),
        error: None,
    };
    *status.lock().unwrap_or_else(|p| p.into_inner()) = initial;
    let status_on_failure = status.clone();
    let thread=thread::Builder::new().name("mobile-https".into()).spawn(move||runtime.block_on(async move {
        let listener=match tokio::net::TcpListener::from_std(listener){Ok(listener)=>listener,Err(_)=>{let mut state=status.lock().unwrap_or_else(|p|p.into_inner());state.running=false;state.error=Some("Mobile HTTPS could not start.".into());return;}};
        let permits=Arc::new(Semaphore::new(32));let mut tasks=JoinSet::new();let mut acceptor=tokio_rustls::TlsAcceptor::from(tls);let mut monitor=tokio::time::interval(Duration::from_secs(2));
        loop {
            tokio::select! {
                _=&mut stopped=>break,
                _=monitor.tick()=>{
                    if discovery.as_ref().is_some_and(|d| d.failed()) { status.lock().unwrap_or_else(|p|p.into_inner()).error=Some("Local name discovery failed or conflicted. Mobile access stopped. Review your network before enabling it again.".into());break; }
                    if check_interface&&!config.available(){status.lock().unwrap_or_else(|p|p.into_inner()).error=Some("The selected network changed or disconnected. Mobile HTTPS has stopped; reconnect and enable it again.".into());break;}
                    let now=chrono::Utc::now().timestamp();
                    if now>=bundle.leaf_expires-14*86400 {
                        match identity(store.as_ref(),&config,now).and_then(|next|next.tls_config().map(|tls|(next,tls))) {
                            Ok((next,tls))=>{bundle=next;acceptor=tokio_rustls::TlsAcceptor::from(tls);status.lock().unwrap_or_else(|p|p.into_inner()).leaf_expires=Some(bundle.leaf_expires);},
                            Err(error)=>{status.lock().unwrap_or_else(|p|p.into_inner()).error=Some(error);break;}
                        }
                    }
                },
                Some(_)=tasks.join_next(),if !tasks.is_empty()=>{},
                accepted=listener.accept()=>{
                    let (socket,peer)=match accepted{Ok(value)=>value,Err(_)=>{status.lock().unwrap_or_else(|p|p.into_inner()).error=Some("Mobile HTTPS stopped after a network error.".into());break;}};
                    if check_interface&&!matches!(peer.ip(),std::net::IpAddr::V4(ip) if ip.is_private()){continue;}
                    let Ok(permit)=permits.clone().try_acquire_owned() else {continue;};
                    let acceptor=acceptor.clone();let origin=config.origin();let host=format!("{}:{}",config.hostname.clone().unwrap_or_else(||config.ipv4.to_string()),config.port);let app=app.clone();let installation=bundle.installation_id.clone();
                    tasks.spawn(async move {
                        let _permit=permit;
                        let Ok(Ok(tls))=tokio::time::timeout(Duration::from_secs(5),acceptor.accept(socket)).await else{return;};
                        let service=service_fn(move|request|{let origin=origin.clone();let host=host.clone();let app=app.clone();let installation=installation.clone();async move{Ok::<_,Infallible>(match app {Some(routes)=>routes.respond(request,host,origin,installation).await,None=>crate::mobile_api::public_response(request,&host,&origin).await})}});
                        let mut http=hyper::server::conn::http1::Builder::new();http.timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(5)).max_buf_size(16384).max_headers(40).keep_alive(false);
                        let _=tokio::time::timeout(Duration::from_secs(20),http.serve_connection(TokioIo::new(tls),service)).await;
                    });
                }
            }
        }
        // Quit/disable/network loss cancels handshakes and in-progress connections immediately.
        drop(listener);tasks.abort_all();while tasks.join_next().await.is_some(){}
        if let Some(routes)=app.as_ref(){routes.cancel();}
        status.lock().unwrap_or_else(|p|p.into_inner()).running=false;
    })).map_err(|_|{let mut state=status_on_failure.lock().unwrap_or_else(|p|p.into_inner());state.running=false;"Mobile HTTPS could not start.".to_string()})?;
    Ok(Running { stop, thread })
}
pub(crate) fn reply(status: StatusCode, bytes: &'static [u8], content_type: &'static str) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Cache-Control", "no-store")
        .header("Content-Security-Policy", CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        .header("Cross-Origin-Resource-Policy", "same-origin")
        .header("Connection", "close")
        .body(Full::new(Bytes::from_static(bytes)))
        .expect("static response headers")
}
pub(crate) fn asset_response<B>(request: &Request<B>, host: &str, origin: &str) -> Response<Full<Bytes>> {
    let denied = || reply(StatusCode::BAD_REQUEST, b"Request rejected.", "text/plain; charset=utf-8");
    if request.headers().get_all("host").iter().count() != 1
        || request.headers().get("host").and_then(|h| h.to_str().ok()) != Some(host)
        || request.headers().get_all("origin").iter().count() > 1
        || request.headers().get("origin").is_some_and(|h| h.to_str().ok() != Some(origin))
        || request.headers().get("sec-fetch-site").is_some_and(|h| h == "cross-site")
        || request.uri().query().is_some()
        || request.uri().authority().is_some()
        || request.headers().contains_key("transfer-encoding")
        || request.headers().get("content-length").is_some_and(|h| h != "0")
    {
        return denied();
    }
    if request.method() != hyper::Method::GET && request.method() != hyper::Method::HEAD {
        return reply(StatusCode::METHOD_NOT_ALLOWED, b"Read-only viewer.", "text/plain; charset=utf-8");
    }
    let path = match request.uri().path() {
        "/" | "/mobile/" => "/mobile/index.html",
        path => path,
    };
    let Some(asset) = MOBILE_ASSETS.iter().find(|asset| asset.path == path) else {
        return reply(StatusCode::NOT_FOUND, b"Not found.", "text/plain; charset=utf-8");
    };
    let body = if request.method() == hyper::Method::HEAD {
        b"".as_slice()
    } else {
        asset.content
    };
    let mut response = reply(StatusCode::OK, body, asset.content_type);
    response
        .headers_mut()
        .insert("Cache-Control", hyper::header::HeaderValue::from_static("no-cache"));
    response
        .headers_mut()
        .insert("Content-Length", hyper::header::HeaderValue::from(asset.content.len()));
    response
}

#[cfg(test)]
#[path = "mobile_transport_tests.rs"]
mod tests;
