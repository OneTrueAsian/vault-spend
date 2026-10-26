//! Temporary certificate-only HTTP bootstrap. Never routes to financial APIs.
use crate::mobile_server::{MobileConfig, PublicCertificate};
use base64::{engine::general_purpose::STANDARD, Engine};
use http_body_util::Full;
use hyper::{body::Bytes, service::service_fn, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use rustls::pki_types::pem::PemObject;
use serde::Serialize;
use std::{convert::Infallible, net::TcpListener, sync::Arc, thread, time::Duration};
use tokio::{
    sync::{oneshot, Semaphore},
    task::JoinSet,
};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupInfo {
    pub url: String,
    pub expires: i64,
}
pub struct Bootstrap {
    pub info: SetupInfo,
    stop: Option<oneshot::Sender<()>>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Drop for Bootstrap {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
fn response(status: StatusCode, content: Vec<u8>, kind: &str) -> Response<Full<Bytes>> {
    Response::builder().status(status).header("Content-Type",kind)
 .header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff")
 .header("Referrer-Policy","no-referrer").header("Connection","close")
 .header("Content-Security-Policy","default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'none'; img-src 'none'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
 .body(Full::new(Bytes::from(content))).expect("fixed setup headers")
}
fn certificate_profile(public: &PublicCertificate) -> Result<Vec<u8>, String> {
    let der = rustls::pki_types::CertificateDer::pem_slice_iter(public.pem.as_bytes())
        .next()
        .ok_or("Public certificate unavailable.")?
        .map_err(|_| "Public certificate unavailable.")?;
    let id = &public.installation_id;
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Public certificate identity invalid.".into());
    }
    let uuid = format!("{}-{}-{}-{}-{}", &id[..8], &id[8..12], &id[12..16], &id[16..20], &id[20..]);
    Ok(format!(r#"<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>PayloadType</key><string>Configuration</string><key>PayloadVersion</key><integer>1</integer><key>PayloadIdentifier</key><string>local.vaultspend.{id}.profile</string><key>PayloadUUID</key><string>{uuid}</string><key>PayloadDisplayName</key><string>Vault Spend local certificate {short}</string><key>PayloadDescription</key><string>Certificate only. Verify this certificate against your computer before trusting it. Remove it when you stop using mobile access.</string><key>PayloadContent</key><array><dict><key>PayloadType</key><string>com.apple.security.root</string><key>PayloadVersion</key><integer>1</integer><key>PayloadIdentifier</key><string>local.vaultspend.{id}.root</string><key>PayloadUUID</key><string>{root_uuid}</string><key>PayloadDisplayName</key><string>Vault Spend local certificate {short}</string><key>PayloadContent</key><data>{data}</data></dict></array></dict></plist>"#,short=&id[..8],root_uuid=format_args!("{}-{}-{}-{}-{}",&id[16..24],&id[24..28],&id[28..32],&id[..4],&id[4..16]),data=STANDARD.encode(der)).into_bytes())
}
pub fn start(config: MobileConfig, public: PublicCertificate, check_interface: bool) -> Result<Bootstrap, String> {
    let listener = TcpListener::bind((config.ipv4, 0)).map_err(|_| "The phone setup page could not open.")?;
    listener.set_nonblocking(true).map_err(|_| "The phone setup page could not open.")?;
    let host = format!(
        "{}:{}",
        config.ipv4,
        listener.local_addr().map_err(|_| "Setup address unavailable.")?.port()
    );
    let mut secret = [0u8; 24];
    getrandom::fill(&mut secret).map_err(|_| "Setup could not start.")?;
    let prefix = format!("/setup/{}/", secret.iter().map(|b| format!("{b:02x}")).collect::<String>());
    let expires = chrono::Utc::now().timestamp() + 600;
    let info = SetupInfo {
        url: format!("http://{host}{prefix}"),
        expires,
    };
    let viewer = format!("{}/mobile/", config.origin());
    let profile = certificate_profile(&public)?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .map_err(|_| "Setup could not start.")?;
    let (stop, mut stopped) = oneshot::channel();
    let thread=thread::Builder::new().name("mobile-certificate-setup".into()).spawn(move||runtime.block_on(async move{
  let Ok(listener)=tokio::net::TcpListener::from_std(listener) else{return;};
  let public=Arc::new(public);let profile=Arc::new(profile);let permits=Arc::new(Semaphore::new(8));let mut tasks=JoinSet::new();let mut tick=tokio::time::interval(Duration::from_secs(1));
  loop{tokio::select!{
   _=&mut stopped=>break,
   _=tick.tick()=>if chrono::Utc::now().timestamp()>=expires||(check_interface&&!config.available()){break;},
   Some(_)=tasks.join_next(),if !tasks.is_empty()=>{},
   incoming=listener.accept()=>{
    let Ok((stream,peer))=incoming else{break;};
    if check_interface&&!matches!(peer.ip(),std::net::IpAddr::V4(ip) if ip.is_private()){continue;}
    let Ok(permit)=permits.clone().try_acquire_owned() else{continue;};
    let host=host.clone();let prefix=prefix.clone();let public=public.clone();let profile=profile.clone();let viewer=viewer.clone();
    tasks.spawn(async move{
     let _permit=permit;
     let service=service_fn(move|request|{let reply=route(&request,&host,&prefix,&public,&profile,&viewer,chrono::Utc::now().timestamp()<expires);async move{Ok::<_,Infallible>(reply)}});
     let mut http=hyper::server::conn::http1::Builder::new();http.timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(3)).max_headers(24).max_buf_size(8192).keep_alive(false);
     let _=tokio::time::timeout(Duration::from_secs(5),http.serve_connection(TokioIo::new(stream),service)).await;
    });
   }
  }}
  tasks.abort_all();while tasks.join_next().await.is_some(){}
 })).map_err(|_|"Setup could not start.")?;
    Ok(Bootstrap {
        info,
        stop: Some(stop),
        thread: Some(thread),
    })
}
fn route<B>(
    request: &Request<B>,
    host: &str,
    prefix: &str,
    public: &PublicCertificate,
    profile: &[u8],
    viewer: &str,
    active: bool,
) -> Response<Full<Bytes>> {
    let denied = || {
        response(
            StatusCode::NOT_FOUND,
            b"Setup is unavailable. Return to Vault Spend on your computer.".to_vec(),
            "text/plain; charset=utf-8",
        )
    };
    if !active
        || request.method() != hyper::Method::GET
        || request.uri().query().is_some()
        || request.uri().scheme().is_some()
        || request.headers().get_all("host").iter().count() != 1
        || request.headers().get("host").and_then(|s| s.to_str().ok()) != Some(host)
        || request.headers().contains_key("authorization")
        || request.headers().get_all("origin").iter().count() > 1
        || request
            .headers()
            .get("origin")
            .is_some_and(|v| v.to_str().ok() != Some(format!("http://{host}").as_str()))
    {
        return denied();
    }
    let Some(path) = request.uri().path().strip_prefix(prefix) else {
        return denied();
    };
    let (body, kind, download) = match path {
        "" => (
            include_str!("mobile_setup/index.html").replace("__VIEWER__", viewer).into_bytes(),
            "text/html; charset=utf-8",
            None,
        ),
        "guide.js" => (include_bytes!("mobile_setup/guide.js").to_vec(), "application/javascript", None),
        "guide.css" => (include_bytes!("mobile_setup/guide.css").to_vec(), "text/css; charset=utf-8", None),
        "fonts/body.woff2" | "fonts/body-bold.woff2" | "fonts/display.woff2" => {
            let name = match path {
                "fonts/body.woff2" => "/assets/dm-sans-latin-400-normal-",
                "fonts/body-bold.woff2" => "/assets/dm-sans-latin-700-normal-",
                _ => "/assets/barlow-condensed-latin-700-normal-",
            };
            let Some(asset) = crate::mobile_server::MOBILE_ASSETS
                .iter()
                .find(|asset| asset.path.starts_with(name) && asset.path.ends_with(".woff2"))
            else {
                return denied();
            };
            (asset.content.to_vec(), "font/woff2", None)
        }
        "certificate.crt" => (
            public.pem.as_bytes().to_vec(),
            "application/x-x509-ca-cert",
            Some("attachment; filename=\"vault-spend-local-root.crt\""),
        ),
        "certificate.mobileconfig" => (
            profile.to_vec(),
            "application/x-apple-aspen-config",
            Some("attachment; filename=\"vault-spend-certificate.mobileconfig\""),
        ),
        _ => return denied(),
    };
    let mut result = response(StatusCode::OK, body, kind);
    if let Some(download) = download {
        result
            .headers_mut()
            .insert("Content-Disposition", download.parse().expect("fixed filename"));
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    fn public() -> PublicCertificate {
        let b = crate::mobile_certificates::ensure_identity(
            &crate::mobile_certificates::MemorySecrets::default(),
            "192.168.1.2".parse().unwrap(),
            1_800_000_000,
        )
        .unwrap();
        PublicCertificate {
            pem: b.root_pem.clone(),
            fingerprint: b.fingerprint().unwrap(),
            installation_id: b.installation_id.clone(),
        }
    }
    #[test]
    fn real_bootstrap_download_is_public_only_and_cancellation_closes_listener() {
        let public = public();
        let expected = public.pem.clone();
        let config = MobileConfig {
            enabled: true,
            ipv4: std::net::Ipv4Addr::LOCALHOST,
            port: 8443,
            interface: "fixture-only".into(),
            identity_initialized: false,
            hostname: None,
        };
        let setup = start(config, public, false).unwrap();
        let url = setup.info.url.clone();
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(3)).build().unwrap();
            let response = client.get(format!("{url}certificate.crt")).send().await.unwrap();
            assert_eq!(response.status(), 200);
            assert_eq!(response.headers()["cache-control"], "no-store");
            assert_eq!(response.text().await.unwrap(), expected);
            for font in ["body", "body-bold", "display"] {
                let response = client.get(format!("{url}fonts/{font}.woff2")).send().await.unwrap();
                assert_eq!(response.status(), 200);
                assert_eq!(response.headers()["content-type"], "font/woff2");
                assert!(response.bytes().await.unwrap().starts_with(b"wOF2"));
            }
            assert_eq!(client.get(format!("{url}fonts/private.woff2")).send().await.unwrap().status(), 404);
            assert_eq!(client.get(format!("{url}api/status")).send().await.unwrap().status(), 404);
            assert_eq!(client.post(format!("{url}certificate.crt")).send().await.unwrap().status(), 404);
        });
        let parsed = reqwest::Url::parse(&url).unwrap();
        let address = (std::net::Ipv4Addr::LOCALHOST, parsed.port().unwrap());
        drop(setup);
        assert!(std::net::TcpStream::connect(address).is_err());
    }
    #[test]
    fn profile_contains_only_the_actual_public_root() {
        let p = public();
        let xml = String::from_utf8(certificate_profile(&p).unwrap()).unwrap();
        assert_eq!(xml.matches("com.apple.security.root").count(), 1);
        assert!(!xml.contains("PRIVATE KEY"));
        assert!(!xml.contains("com.apple.mdm"));
        let data = xml.split("<data>").nth(1).unwrap().split("</data>").next().unwrap();
        let der = STANDARD.decode(data).unwrap();
        let expected = rustls::pki_types::CertificateDer::pem_slice_iter(p.pem.as_bytes())
            .next()
            .unwrap()
            .unwrap();
        assert_eq!(der, expected.as_ref());
    }
    #[test]
    fn bootstrap_does_not_bridge_apis_paths_origins_or_expired_sessions() {
        let p = public();
        let profile = certificate_profile(&p).unwrap();
        let host = "192.168.1.2:9876";
        let prefix = "/setup/test/";
        for path in [
            "/api/status",
            "/setup/test/api/snapshot",
            "/setup/test/../certificate.crt",
            "/setup/test/certificate.crt?x=1",
            "/setup/wrong/",
        ] {
            let req = Request::builder().uri(path).header("Host", host).body(()).unwrap();
            assert_eq!(
                route(&req, host, prefix, &p, &profile, "https://example.local:8443/mobile/", true).status(),
                StatusCode::NOT_FOUND
            );
        }
        let req = Request::builder()
            .uri("/setup/test/certificate.crt")
            .header("Host", host)
            .body(())
            .unwrap();
        assert_eq!(route(&req, host, prefix, &p, &profile, "", false).status(), StatusCode::NOT_FOUND);
        assert_eq!(route(&req, host, prefix, &p, &profile, "", true).status(), StatusCode::OK);
        let foreign = Request::builder()
            .uri("/setup/test/")
            .header("Host", host)
            .header("Origin", "http://evil.local")
            .body(())
            .unwrap();
        assert_eq!(route(&foreign, host, prefix, &p, &profile, "", true).status(), StatusCode::NOT_FOUND);
    }
}
