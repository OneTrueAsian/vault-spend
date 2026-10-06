//! App-owned discovery on the selected private interface, never public DNS.
use mdns_sd::{DaemonEvent, IfKind, Receiver, ServiceDaemon, ServiceInfo};
use std::{net::Ipv4Addr, time::Duration};
pub struct Discovery {
    daemon: ServiceDaemon,
    events: Receiver<DaemonEvent>,
    fullname: String,
}
impl Discovery {
    pub fn start(interface: &str, ip: Ipv4Addr, port: u16, hostname: &str) -> Result<Self, String> {
        if !ip.is_private() || !crate::mobile_server::valid_local_hostname(hostname) {
            return Err("Choose an available private network for local discovery.".into());
        }
        let daemon = ServiceDaemon::new().map_err(|_| "Local discovery could not start.")?;
        let events = match daemon.monitor() {
            Ok(events) => events,
            Err(_) => {
                let _ = daemon.shutdown();
                return Err("Local discovery could not start.".into());
            }
        };
        let mut guard = Self {
            daemon,
            events,
            fullname: String::new(),
        };
        guard
            .daemon
            .disable_interface(IfKind::All)
            .map_err(|_| "Local discovery interface could not be restricted.")?;
        guard
            .daemon
            .enable_interface(IfKind::Name(interface.into()))
            .map_err(|_| "Local discovery interface could not be opened.")?;
        guard
            .daemon
            .disable_interface(IfKind::IPv6)
            .map_err(|_| "Local discovery interface could not be restricted.")?;
        let service = ServiceInfo::new(
            "_vault-spend._tcp.local.",
            hostname.trim_end_matches(".local"),
            &format!("{hostname}."),
            std::net::IpAddr::V4(ip),
            port,
            None::<std::collections::HashMap<String, String>>,
        )
        .map_err(|_| "Local discovery name is invalid.")?;
        guard.fullname = service.get_fullname().to_owned();
        guard
            .daemon
            .register(service)
            .map_err(|_| "Local discovery could not publish this computer.")?;
        Ok(guard)
    }
    pub fn failed(&self) -> bool {
        while let Ok(event) = self.events.try_recv() {
            // Never silently suffix the hostname and change the phone's storage origin.
            if matches!(event, DaemonEvent::Error(_) | DaemonEvent::NameChange(_)) {
                return true;
            }
        }
        false
    }
}
impl Drop for Discovery {
    fn drop(&mut self) {
        if !self.fullname.is_empty() {
            if let Ok(done) = self.daemon.unregister(&self.fullname) {
                let _ = done.recv_timeout(Duration::from_millis(500));
            }
        }
        if let Ok(done) = self.daemon.shutdown() {
            let _ = done.recv_timeout(Duration::from_millis(500));
        }
    }
}
