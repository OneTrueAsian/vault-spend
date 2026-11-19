use super::*;
use crate::mobile::certificates::{ensure_identity, legacy_identity, MemorySecrets};
use crate::mobile::devices::Devices;
fn test_devices() -> Arc<Devices> {
    Arc::new(Devices::new(Arc::new(MemorySecrets::default())))
}
#[test]
fn explicit_root_replacement_changes_trust_and_origin_binding() {
    let store = MemorySecrets::default();
    let ip = "192.168.1.103".parse().unwrap();
    let first = ensure_identity(&store, ip, 1_800_000_000).unwrap();
    let next_ip = "192.168.1.104".parse().unwrap();
    let replacement = crate::mobile::certificates::reset_identity(&store, next_ip, 1_800_000_001).unwrap();
    assert_ne!(first.installation_id, replacement.installation_id);
    assert_ne!(first.fingerprint().unwrap(), replacement.fingerprint().unwrap());
    assert!(ensure_identity(&store, ip, 1_800_000_002).is_err());
    assert_eq!(
        ensure_identity(&store, next_ip, 1_800_000_002).unwrap().installation_id,
        replacement.installation_id
    );
}

#[test]
fn identity_is_stable_renewable_and_never_silently_changes_address() {
    let store = MemorySecrets::default();
    let ip = "192.168.1.103".parse().unwrap();
    let first = ensure_identity(&store, ip, 1_800_000_000).unwrap();
    let reopened = ensure_identity(&store, ip, 1_800_000_001).unwrap();
    assert_eq!(first.root_pem, reopened.root_pem);
    assert_eq!(first.leaf_pem, reopened.leaf_pem);
    let renewed = ensure_identity(&store, ip, first.leaf_expires - 10 * 86400).unwrap();
    assert_eq!(first.root_pem, renewed.root_pem);
    assert_ne!(first.leaf_pem, renewed.leaf_pem);
    assert!(ensure_identity(&store, "192.168.1.104".parse().unwrap(), 1_800_000_000).is_err());
    assert!(ensure_identity(&store, ip, first.root_expires).is_err());
}

#[test]
fn selected_interface_and_host_are_explicit_and_private() {
    for address in ["0.0.0.0", "127.0.0.1", "8.8.8.8", "169.254.1.1", "224.0.0.1"] {
        let config = MobileConfig {
            enabled: true,
            ipv4: address.parse().unwrap(),
            port: 8443,
            interface: "wifi".into(),
            identity_initialized: false,
            hostname: None,
        };
        assert!(config.validate().is_err());
    }
    let config = MobileConfig {
        enabled: true,
        ipv4: "192.168.1.103".parse().unwrap(),
        port: 8443,
        interface: "wifi".into(),
        identity_initialized: false,
        hostname: None,
    };
    assert!(config.validate().is_ok());
    assert_eq!(config.origin(), "https://192.168.1.103:8443");
    assert!(!config.present_in(&[("vpn".into(), config.ipv4)]));
    assert!(config.present_in(&[("wifi".into(), config.ipv4)]));
}

#[test]
fn secret_refusal_and_damaged_bundle_do_not_regenerate_trust() {
    use std::sync::atomic::Ordering;
    let store = MemorySecrets::default();
    let ip = "192.168.1.103".parse().unwrap();
    let now = 1_800_000_000;
    let original = ensure_identity(&store, ip, now).unwrap();
    let bytes = store.bytes.lock().unwrap().clone();
    store.fail.store(true, Ordering::SeqCst);
    assert!(ensure_identity(&store, ip, original.leaf_expires - 86400).is_err());
    assert_eq!(*store.bytes.lock().unwrap(), bytes);
    store.fail.store(false, Ordering::SeqCst);
    *store.bytes.lock().unwrap() = Some(b"broken protected identity".to_vec());
    assert!(ensure_identity(&store, ip, now).is_err());
    assert_eq!(store.bytes.lock().unwrap().as_ref().unwrap(), b"broken protected identity");
}

#[test]
fn failed_refresh_after_root_expiry_and_expired_leaf_recovery_are_explicit() {
    let store = MemorySecrets::default();
    let ip = "192.168.1.103".parse().unwrap();
    let now = 1_800_000_000;
    let original = ensure_identity(&store, ip, now).unwrap();
    let recovered = ensure_identity(&store, ip, original.leaf_expires + 86400).unwrap();
    assert_eq!(original.root_pem, recovered.root_pem);
    assert!(recovered.leaf_expires > original.leaf_expires);
    let bytes = store.bytes.lock().unwrap().clone();
    assert!(ensure_identity(&store, ip, original.root_expires).is_err());
    assert_eq!(*store.bytes.lock().unwrap(), bytes);
}

#[test]
fn assets_have_an_exact_nonfinancial_allowlist_and_security_headers() {
    let origin = "https://192.168.1.103:8443";
    let host = "192.168.1.103:8443";
    let make = |path: &str| Request::builder().uri(path).header("Host", host).body(()).unwrap();
    for asset in MOBILE_ASSETS {
        let response = asset_response(&make(asset.path), host, origin);
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert!(response.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("script-src 'self'"));
    }
    for path in [
        "/api/snapshot",
        "/config.json",
        "/mobile-certificates.protected",
        "/mobile/root-key.pem",
        "/mobile/../config.json",
        "/mobile/%2e%2e/config.json",
        "/mobile/preview.html",
        "/mobile/storage-test.html",
    ] {
        let response = asset_response(&make(path), host, origin);
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(response.headers()["cache-control"], "no-store");
    }
    for request in [
        Request::builder()
            .uri("/mobile/index.html")
            .header("Host", "attacker.invalid")
            .body(())
            .unwrap(),
        Request::builder()
            .uri("/mobile/index.html")
            .header("Host", host)
            .header("Origin", "https://attacker.invalid")
            .body(())
            .unwrap(),
        Request::builder()
            .uri("/mobile/index.html")
            .header("Host", host)
            .header("Content-Length", "999999")
            .body(())
            .unwrap(),
    ] {
        assert_eq!(asset_response(&request, host, origin).status(), StatusCode::BAD_REQUEST);
    }
    assert_eq!(
        asset_response(
            &Request::builder()
                .method("POST")
                .uri("/mobile/index.html")
                .header("Host", host)
                .body(())
                .unwrap(),
            host,
            origin
        )
        .status(),
        StatusCode::METHOD_NOT_ALLOWED
    );
}

#[test]
fn service_defaults_off_and_corrupt_settings_do_not_block_the_desktop() {
    let directory = std::env::temp_dir().join(format!("vault-mobile-task5-config-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let service = MobileService::new(directory.clone(), test_devices());
    service.resume();
    assert!(!service.status().running);
    assert!(service.status().error.is_none());
    std::fs::write(service.config_path(), b"corrupt config").unwrap();
    service.resume();
    assert!(!service.status().running);
    assert!(service.status().error.is_some());
    std::fs::remove_file(service.config_path()).unwrap();
    std::fs::remove_dir(directory).unwrap();
}

#[test]
fn real_https_serves_embedded_assets_with_test_only_trust_and_stops_all_connections() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let config = MobileConfig {
        enabled: true,
        ipv4: Ipv4Addr::LOCALHOST,
        port,
        interface: "test-only-loopback".into(),
        identity_initialized: false,
        hostname: None,
    };
    let store = Arc::new(MemorySecrets::default());
    let bundle = ensure_identity(store.as_ref(), config.ipv4, chrono::Utc::now().timestamp()).unwrap();
    let pem = bundle.root_pem.clone();
    let fingerprint = bundle.fingerprint().unwrap();
    let status = Arc::new(Mutex::new(MobileStatus::default()));
    let running = start_listener(
        listener,
        config.clone(),
        false,
        store.clone(),
        bundle.clone(),
        bundle.tls_config().unwrap(),
        status.clone(),
    )
    .unwrap();
    // One deliberately incomplete TLS socket proves shutdown cancels outstanding handshakes.
    let slow = std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
    slow.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let client = reqwest::Client::builder()
            .add_root_certificate(reqwest::Certificate::from_pem(pem.as_bytes()).unwrap())
            .resolve("localhost", (Ipv4Addr::LOCALHOST, port).into())
            .https_only(true)
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        let response = client.get(format!("{}/mobile/index.html", config.origin())).send().await.unwrap();
        assert_eq!(response.status(), 200);
        assert!(response.text().await.unwrap().contains("/assets/"));
        for asset in MOBILE_ASSETS {
            let response = client.get(format!("{}{}", config.origin(), asset.path)).send().await.unwrap();
            assert_eq!(response.status(), 200, "{}", asset.path);
            assert_eq!(response.bytes().await.unwrap().as_ref(), asset.content);
        }
        let response = client.get(format!("{}/api/snapshot", config.origin())).send().await.unwrap();
        assert_eq!(response.status(), 404);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert!(
            client.get(format!("https://localhost:{port}/mobile/index.html")).send().await.is_err(),
            "Wrong DNS SAN must fail, even with the correct trusted root"
        );
        let untrusted = reqwest::Client::builder().timeout(Duration::from_secs(3)).build().unwrap();
        assert!(untrusted.get(format!("{}/mobile/index.html", config.origin())).send().await.is_err());
    });
    let before = std::time::Instant::now();
    running.stop();
    assert!(before.elapsed() < Duration::from_secs(2));
    assert!(!status.lock().unwrap().running);
    assert!(std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)).is_err());
    let recovered = ensure_identity(store.as_ref(), config.ipv4, chrono::Utc::now().timestamp()).unwrap();
    assert_eq!(fingerprint, recovered.fingerprint().unwrap());
    let occupied = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).unwrap();
    assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_err());
    drop(occupied);
}

#[test]
fn failed_secret_write_during_renewal_retains_the_original_trusted_bundle() {
    struct RejectWrites<'a>(&'a MemorySecrets);
    impl SecretStore for RejectWrites<'_> {
        fn read(&self) -> Result<Option<zeroize::Zeroizing<Vec<u8>>>, String> {
            self.0.read()
        }
        fn write(&self, _bytes: &[u8]) -> Result<(), String> {
            Err("Injected write failure".into())
        }
    }
    let store = MemorySecrets::default();
    let ip = "192.168.1.103".parse().unwrap();
    let first = ensure_identity(&store, ip, 1_800_000_000).unwrap();
    let before = store.bytes.lock().unwrap().clone();
    assert!(ensure_identity(&RejectWrites(&store), ip, first.leaf_expires - 86400).is_err());
    assert_eq!(*store.bytes.lock().unwrap(), before);
}

#[test]
fn disappearance_of_selected_interface_stops_listener_with_actionable_status() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let config = MobileConfig {
        enabled: true,
        ipv4: "192.168.1.103".parse().unwrap(),
        port,
        interface: "deliberately-absent-test-interface".into(),
        identity_initialized: false,
        hostname: None,
    };
    let store = Arc::new(MemorySecrets::default());
    let bundle = ensure_identity(store.as_ref(), config.ipv4, chrono::Utc::now().timestamp()).unwrap();
    let tls = bundle.tls_config().unwrap();
    let status = Arc::new(Mutex::new(MobileStatus::default()));
    let running = start_listener(listener, config, true, store, bundle, tls, status.clone()).unwrap();
    let before = std::time::Instant::now();
    while status.lock().unwrap().running && before.elapsed() < Duration::from_secs(3) {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(!status.lock().unwrap().running);
    assert!(status.lock().unwrap().error.as_ref().unwrap().contains("network"));
    running.stop();
    assert!(std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)).is_err());
}

#[test]
fn a_known_missing_identity_cannot_be_recreated_by_export_or_setup() {
    let directory = std::env::temp_dir().join(format!("vault-mobile-task5-missing-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let service = MobileService::new(directory.clone(), test_devices());
    let config = MobileConfig {
        enabled: false,
        ipv4: "192.168.1.103".parse().unwrap(),
        port: 8443,
        interface: "test-interface".into(),
        identity_initialized: true,
        hostname: None,
    };
    service.save_config(&config).unwrap();
    assert!(service.public_certificate().is_err());
    let mut omitted = config.clone();
    omitted.identity_initialized = false;
    assert!(service.configure(omitted).is_ok());
    assert!(service.load_config().unwrap().unwrap().identity_initialized);
    assert!(service.public_certificate().is_err());
    assert!(!directory.join("mobile-certificates.protected").exists());
    assert!(!service.status().running);
    std::fs::remove_file(service.config_path()).unwrap();
    std::fs::remove_dir(directory).unwrap();
}

#[test]
fn named_https_uses_dns_san_and_rejects_ip_host_even_with_correct_root() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let store = Arc::new(MemorySecrets::default());
    let bundle = crate::mobile::certificates::ensure_guided_identity(store.as_ref(), Ipv4Addr::LOCALHOST, chrono::Utc::now().timestamp()).unwrap();
    let config = MobileConfig {
        enabled: true,
        ipv4: Ipv4Addr::LOCALHOST,
        port,
        interface: "fixture-only".into(),
        identity_initialized: true,
        hostname: bundle.hostname.clone(),
    };
    let status = Arc::new(Mutex::new(MobileStatus::default()));
    let running = start_listener(
        listener,
        config.clone(),
        false,
        store,
        bundle.clone(),
        bundle.tls_config().unwrap(),
        status,
    )
    .unwrap();
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let client = reqwest::Client::builder()
            .no_proxy()
            .add_root_certificate(reqwest::Certificate::from_pem(bundle.root_pem.as_bytes()).unwrap())
            .resolve(config.hostname.as_ref().unwrap(), (Ipv4Addr::LOCALHOST, port).into())
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        assert_eq!(
            client
                .get(format!("{}/mobile/index.html", config.origin()))
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert!(client.get(format!("https://127.0.0.1:{port}/mobile/index.html")).send().await.is_err());
        assert_eq!(
            client
                .get(format!("{}/mobile/index.html", config.origin()))
                .header("Host", format!("127.0.0.1:{port}"))
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
    });
    running.stop();
}
#[test]
fn local_origin_is_stable_and_arbitrary_local_names_are_rejected() {
    let mut config = MobileConfig {
        enabled: true,
        ipv4: "192.168.1.2".parse().unwrap(),
        port: 8443,
        interface: "home".into(),
        identity_initialized: true,
        hostname: Some(crate::mobile::certificates::local_hostname(&"a".repeat(32))),
    };
    let origin = config.origin();
    config.ipv4 = "192.168.1.3".parse().unwrap();
    assert_eq!(origin, config.origin());
    config.validate().unwrap();
    config.hostname = Some("evil.local".into());
    assert!(config.validate().is_err());
    let dir = std::env::temp_dir().join(format!("vault-mobile-guided-stop-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let service = MobileService::new(dir.clone(), test_devices());
    service.stop();
    service.refresh_network().unwrap();
    assert!(!service.status().running);
    std::fs::remove_dir(dir).unwrap();
}

fn outdated_service(label: &str) -> (MobileService, Arc<MemorySecrets>, Arc<Devices>, PathBuf, MobileConfig) {
    let directory = std::env::temp_dir().join(format!("vault-mobile-vs37-{label}-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let store = Arc::new(MemorySecrets::default());
    let devices = test_devices();
    let service = MobileService::with_secrets(directory.clone(), devices.clone(), store.clone());
    let config = MobileConfig {
        enabled: true,
        ipv4: "192.168.1.20".parse().unwrap(),
        port: 8443,
        interface: "deliberately-absent-test-interface".into(),
        identity_initialized: true,
        hostname: None,
    };
    (service, store, devices, directory, config)
}
fn pair_one_phone(devices: &Devices) {
    let code = devices.begin(100).unwrap();
    let claim = devices.redeem(&code, "Phone", 101).unwrap();
    devices.decide(&devices.pending(101)[0].id, Some(vec!["personal".into()]), 102).unwrap();
    devices.complete(&claim, "old-root", 103).unwrap();
    assert_eq!(devices.list().unwrap().len(), 1);
}
fn installation(store: &MemorySecrets) -> String {
    let value: serde_json::Value = serde_json::from_slice(store.bytes.lock().unwrap().as_ref().unwrap()).unwrap();
    value["installation_id"].as_str().unwrap().to_string()
}

#[test]
fn an_outdated_root_is_replaced_and_paired_phones_are_signed_out() {
    let (service, store, devices, directory, config) = outdated_service("replace");
    let old = legacy_identity(store.as_ref(), config.ipv4, chrono::Utc::now().timestamp()).unwrap();
    assert!(old.needs_trust_upgrade());
    pair_one_phone(&devices);
    service.save_config(&config).unwrap();
    service.configure(config.clone()).unwrap();
    let new = ensure_identity(store.as_ref(), config.ipv4, chrono::Utc::now().timestamp()).unwrap();
    assert_ne!(new.installation_id, old.installation_id);
    assert!(!new.needs_trust_upgrade());
    assert!(devices.list().unwrap().is_empty());
    assert!(!service.load_config().unwrap().unwrap().enabled);
    assert!(!service.status().running);
    assert!(service.status().trust_replaced);
    // A second start has nothing left to upgrade: no second reset, and the notice stays for the session.
    let _ = service.configure(config.clone());
    assert_eq!(installation(&store), new.installation_id);
    assert!(service.status().trust_replaced);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn the_guided_setup_start_also_replaces_an_outdated_root() {
    let (service, store, devices, directory, config) = outdated_service("guided");
    let old = legacy_identity(store.as_ref(), config.ipv4, chrono::Utc::now().timestamp()).unwrap();
    pair_one_phone(&devices);
    service.configure_guided(config).unwrap();
    assert_ne!(installation(&store), old.installation_id);
    assert!(devices.list().unwrap().is_empty());
    assert!(service.status().trust_replaced);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn a_damaged_saved_identity_is_never_replaced_by_the_upgrade() {
    let (service, store, devices, directory, config) = outdated_service("damaged");
    *store.bytes.lock().unwrap() = Some(b"broken protected identity".to_vec());
    pair_one_phone(&devices);
    assert!(service.configure(config).is_err());
    assert_eq!(store.bytes.lock().unwrap().as_ref().unwrap(), b"broken protected identity");
    assert_eq!(devices.list().unwrap().len(), 1);
    assert!(!service.status().trust_replaced);
    std::fs::remove_dir_all(directory).unwrap();
}
