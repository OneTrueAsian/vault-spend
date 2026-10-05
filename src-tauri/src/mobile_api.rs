//! Only typed reads and narrow pairing/session operations; never a desktop IPC bridge.
use crate::{
    mobile_devices::{Devices, COOKIE, LIFETIME},
    mobile_secrets::OsSecrets,
};
use budget_core::store::{MobileSnapshotContext, MobileSnapshotRefreshGate, MobileSnapshotRefreshPermit};
use http_body_util::BodyExt;
use hyper::{
    body::{Body, Bytes, Frame, Incoming, SizeHint},
    Method, Request, Response, StatusCode,
};
use serde::Deserialize;
use std::{
    path::PathBuf,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    task::{Context, Poll},
};
use tauri::{Emitter, Manager};
pub trait Routes: Send + Sync {
    fn respond(
        &self,
        request: Request<Incoming>,
        host: String,
        origin: String,
        installation: String,
    ) -> Pin<Box<dyn std::future::Future<Output = Response<Delivery>> + Send + '_>>;
    fn cancel(&self);
}
pub struct DesktopRoutes(pub tauri::AppHandle);
impl Routes for DesktopRoutes {
    fn respond(
        &self,
        request: Request<Incoming>,
        host: String,
        origin: String,
        installation: String,
    ) -> Pin<Box<dyn std::future::Future<Output = Response<Delivery>> + Send + '_>> {
        Box::pin(async move { respond(request, &host, &origin, Some(self.0.clone()), installation).await })
    }
    fn cancel(&self) {
        self.0.state::<MobileAccess>().devices.cancel();
    }
}
pub async fn public_response(request: Request<Incoming>, host: &str, origin: &str) -> Response<Delivery> {
    let (parts, body) = crate::mobile_server::asset_response(&request, host, origin).into_parts();
    let bytes = body.collect().await.expect("infallible static assets").to_bytes();
    Response::from_parts(
        parts,
        Delivery {
            bytes: Some(bytes),
            check: None,
            permit: None,
        },
    )
}
#[derive(Clone)]
pub struct MobileAccess {
    pub devices: Arc<Devices>,
    gate: MobileSnapshotRefreshGate,
    #[cfg(debug_assertions)]
    pub race: Arc<std::sync::Mutex<Option<Arc<crate::mobile_race::Race>>>>,
}
impl MobileAccess {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            devices: Arc::new(Devices::new(Arc::new(OsSecrets::new(directory.join("mobile-devices.protected"))))),
            gate: MobileSnapshotRefreshGate::default(),
            #[cfg(debug_assertions)]
            race: Arc::new(std::sync::Mutex::new(None)),
        }
    }
}
/// The first successful frame poll is the delivery boundary. Lock/switch/revoke before
/// this poll discards the unsent projection; bytes already handed to HTTP cannot be recalled.
pub struct Delivery {
    bytes: Option<Bytes>,
    check: Option<Box<dyn FnOnce() -> bool + Send>>,
    permit: Option<MobileSnapshotRefreshPermit>,
}
#[derive(Clone, Copy)]
struct SessionStamp {
    generation: u64,
    revision: u64,
}
impl Body for Delivery {
    type Data = Bytes;
    type Error = std::io::Error;
    fn poll_frame(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Option<Result<Frame<Bytes>, Self::Error>>> {
        let Some(bytes) = self.bytes.take() else { return Poll::Ready(None) };
        let allowed = self.check.take().is_none_or(|check| check());
        self.permit.take();
        if allowed {
            Poll::Ready(Some(Ok(Frame::data(bytes))))
        } else {
            Poll::Ready(Some(Err(std::io::Error::other("mobile_delivery_cancelled"))))
        }
    }
    fn size_hint(&self) -> SizeHint {
        SizeHint::default()
    }
}
fn json(status: StatusCode, value: serde_json::Value) -> Response<Delivery> {
    let bytes = Bytes::from(serde_json::to_vec(&value).expect("typed JSON"));
    crate::mobile_server::reply(status, b"", "application/json; charset=utf-8").map(|_| Delivery {
        bytes: Some(bytes),
        check: None,
        permit: None,
    })
}
fn error(status: StatusCode, code: &str) -> Response<Delivery> {
    json(status, serde_json::json!({"error":code}))
}
fn cookie(response: &mut Response<Delivery>, token: &str, age: i64) {
    if let Ok(value) = format!("{COOKIE}={token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age={age}").parse() {
        response.headers_mut().insert("Set-Cookie", value);
    }
}
fn token(request: &Request<Incoming>) -> Option<String> {
    if request.headers().get_all("cookie").iter().count() != 1 {
        return None;
    }
    let value = request.headers().get("cookie")?.to_str().ok()?;
    if value.len() > 4096 {
        return None;
    }
    let values: Vec<_> = value
        .split(';')
        .filter_map(|v| v.trim().split_once('='))
        .filter(|(key, _)| *key == COOKIE)
        .collect();
    if values.len() != 1 {
        return None;
    }
    Some(values[0].1.into())
}
fn csrf(token: &str) -> String {
    crate::mobile_devices::hash(&format!("vault-spend-mobile-csrf-v1:{token}"))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Redeem {
    code: String,
    label: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Complete {
    claim: String,
}
pub fn available_profiles(app: &tauri::AppHandle) -> Result<Vec<crate::profiles::Profile>, String> {
    let paths = app.state::<crate::config::AppPaths>();
    crate::profiles::registered_profiles_strict(&paths.config_path).map_err(|_| "mobile_profiles_unavailable")?;
    let db = paths.db_path.lock().map_err(|_| "mobile_profiles_unavailable")?.clone();
    Ok(crate::profiles::list_profiles(&paths.config_path, &db))
}
pub async fn respond(
    request: Request<Incoming>,
    host: &str,
    origin: &str,
    app: Option<tauri::AppHandle>,
    installation: String,
) -> Response<Delivery> {
    let route = request.uri().path().to_owned();
    if !route.starts_with("/api/") {
        return public_response(request, host, origin).await;
    }
    if !matches!(route.as_str(), "/api/pair/redeem" | "/api/pair/complete" | "/api/status" | "/api/logout") && !route.starts_with("/api/snapshot/") {
        return error(StatusCode::NOT_FOUND, "not_found");
    }
    if request.headers().get_all("host").iter().count() != 1
        || request.headers().get("host").and_then(|v| v.to_str().ok()) != Some(host)
        || request.headers().get_all("origin").iter().count() > 1
        || request.headers().get("origin").is_some_and(|v| v.to_str().ok() != Some(origin))
        || request.headers().get("sec-fetch-site").is_some_and(|v| v != "same-origin" && v != "none")
        || request.uri().authority().is_some()
        || request.uri().query().is_some()
        || request.headers().get_all("x-vault-request").iter().count() != 1
        || request.headers().get("x-vault-request").is_none_or(|v| v != "1")
    {
        return error(StatusCode::BAD_REQUEST, "request_rejected");
    }
    let Some(app) = app else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "mobile_unavailable");
    };
    let access = app.state::<MobileAccess>().inner().clone();
    let now = chrono::Utc::now().timestamp();
    if request.method() == Method::POST {
        if !matches!(route.as_str(), "/api/pair/redeem" | "/api/pair/complete" | "/api/logout") {
            return error(StatusCode::METHOD_NOT_ALLOWED, "read_only");
        }
        if request.headers().get("origin").and_then(|v| v.to_str().ok()) != Some(origin)
            || request.headers().get_all("content-type").iter().count() != 1
            || request.headers().get("content-type").is_none_or(|v| v != "application/json")
            || request.headers().contains_key("transfer-encoding")
        {
            return error(StatusCode::BAD_REQUEST, "request_rejected");
        }
        let credential = token(&request);
        if route == "/api/logout"
            && credential.as_ref().is_none_or(|token| {
                request.headers().get_all("x-vault-csrf").iter().count() != 1
                    || request
                        .headers()
                        .get("x-vault-csrf")
                        .and_then(|v| v.to_str().ok())
                        .is_none_or(|value| !crate::mobile_devices::equal(value, &csrf(token)))
            })
        {
            return error(StatusCode::FORBIDDEN, "request_rejected");
        }
        let bytes = match http_body_util::Limited::new(request.into_body(), 4096).collect().await {
            Ok(value) => value.to_bytes(),
            Err(_) => return error(StatusCode::PAYLOAD_TOO_LARGE, "request_rejected"),
        };
        if route == "/api/pair/redeem" {
            let Ok(input) = serde_json::from_slice::<Redeem>(&bytes) else {
                return error(StatusCode::BAD_REQUEST, "request_rejected");
            };
            return match access.devices.redeem(&input.code, &input.label, now) {
                Ok(claim) => {
                    let _ = app.emit("mobile-pairing-changed", ());
                    json(StatusCode::ACCEPTED, serde_json::json!({"claim":claim,"expiresIn":300}))
                }
                Err(code) => error(
                    if code == "mobile_pairing_rate_limited" {
                        StatusCode::TOO_MANY_REQUESTS
                    } else {
                        StatusCode::FORBIDDEN
                    },
                    &code,
                ),
            };
        }
        if route == "/api/pair/complete" {
            let Ok(input) = serde_json::from_slice::<Complete>(&bytes) else {
                return error(StatusCode::BAD_REQUEST, "request_rejected");
            };
            return match access.devices.complete(&input.claim, &installation, now) {
                Ok(token) => {
                    let mut response = json(StatusCode::OK, serde_json::json!({"paired":true}));
                    cookie(&mut response, &token, LIFETIME);
                    response
                }
                Err(code) => error(
                    if code == "mobile_confirmation_pending" {
                        StatusCode::CONFLICT
                    } else {
                        StatusCode::FORBIDDEN
                    },
                    &code,
                ),
            };
        }
        if bytes.as_ref() != b"{}" {
            return error(StatusCode::BAD_REQUEST, "request_rejected");
        }
        let credential = credential.unwrap_or_default();
        return match access.devices.authenticate(&credential, now).and_then(|d| access.devices.revoke(&d.id)) {
            Ok(()) => {
                let mut response = json(StatusCode::OK, serde_json::json!({"forgotten":true}));
                cookie(&mut response, "", 0);
                response
            }
            Err(code) => error(StatusCode::UNAUTHORIZED, &code),
        };
    }
    if request.method() != Method::GET
        || request.headers().contains_key("transfer-encoding")
        || request.headers().get("content-length").is_some_and(|v| v != "0")
    {
        return error(StatusCode::METHOD_NOT_ALLOWED, "read_only");
    }
    let Some(credential) = token(&request) else {
        return error(StatusCode::UNAUTHORIZED, "mobile_access_denied");
    };
    let device = match access.devices.renew(&credential, &installation, now) {
        Ok(device) => device,
        Err(_) => return error(StatusCode::UNAUTHORIZED, "mobile_access_denied"),
    };
    if route == "/api/status" {
        let profiles = match available_profiles(&app) {
            Ok(profiles) => profiles,
            Err(code) => return error(StatusCode::SERVICE_UNAVAILABLE, &code),
        };
        let mut approved = Vec::new();
        let open = app.state::<crate::runtime::AppRuntime>().is_open();
        for p in profiles.into_iter().filter(|p| device.grants.contains(&p.id)) {
            // Internal profile IDs, paths and unapproved metadata never enter a network response.
            let grant = match access.devices.grant_for(&credential, &p.id, now) {
                Ok(grant) => grant,
                Err(_) => continue,
            };
            approved
                .push(serde_json::json!({"id":grant.opaque,"epoch":grant.epoch,"name":p.name,"icon":p.icon_key,"refreshable":p.is_active && open}));
        }
        let granted = device.grants.clone();
        let devices = access.devices.clone();
        let checked_token = credential.clone();
        let mut response = json(
            StatusCode::OK,
            serde_json::json!({"installationId":installation,"profiles":approved,"csrf":csrf(&credential)}),
        );
        response.body_mut().check = Some(Box::new(move || {
            devices
                .authenticate(&checked_token, chrono::Utc::now().timestamp())
                .is_ok_and(|current| granted.iter().all(|id| current.grants.contains(id)))
        }));
        cookie(&mut response, &credential, device.expires - now);
        return response;
    }
    let Some(opaque) = route.strip_prefix("/api/snapshot/") else {
        return error(StatusCode::NOT_FOUND, "not_found");
    };
    let (internal, _) = match access.devices.authorize(&credential, opaque, now) {
        Ok(result) => result,
        Err(_) => return error(StatusCode::FORBIDDEN, "mobile_access_denied"),
    };
    let permit = match access.gate.try_start(opaque) {
        Ok(permit) => permit,
        Err(_) => return error(StatusCode::TOO_MANY_REQUESTS, "mobile_refresh_limited"),
    };
    let stamp = SessionStamp {
        generation: app.state::<crate::config::AppPaths>().current_generation(),
        revision: app.state::<crate::runtime::AppRuntime>().current_revision(),
    };
    let cancelled = Arc::new(AtomicBool::new(false));
    struct Cancel(Arc<AtomicBool>);
    impl Drop for Cancel {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }
    let _cancel = Cancel(cancelled.clone());
    let (send, receive) = tokio::sync::oneshot::channel();
    let queued_app = app.clone();
    let queued_token = credential.clone();
    let queued_opaque = opaque.to_string();
    let queued_installation = installation.clone();
    app.state::<crate::command_thread::CommandQueue>().run(Box::new(move || {
        let result = project(
            &queued_app,
            &queued_token,
            &queued_opaque,
            &internal,
            &queued_installation,
            stamp,
            &cancelled,
        );
        let _ = send.send((result, permit));
    }));
    let (bytes, permit) = match tokio::time::timeout(std::time::Duration::from_secs(15), receive).await {
        Ok(Ok((Ok(bytes), permit))) => (bytes, permit),
        Ok(Ok((Err(code), _))) => return error(StatusCode::CONFLICT, &code),
        _ => return error(StatusCode::SERVICE_UNAVAILABLE, "mobile_refresh_unavailable"),
    };
    let opaque = opaque.to_string();
    let access = access.clone();
    let cookie_token = credential.clone();
    let mut response = crate::mobile_server::reply(StatusCode::OK, b"", "application/json; charset=utf-8").map(|_| Delivery {
        bytes: Some(Bytes::from(bytes)),
        permit: Some(permit),
        check: Some(Box::new(move || {
            #[cfg(debug_assertions)]
            if crate::mobile_race::pause(&app, "ready").is_err() {
                return false;
            }
            valid_session(&app, &access, &credential, &opaque, stamp).is_ok()
        })),
    });
    cookie(&mut response, &cookie_token, device.expires - now);
    response
}
fn valid_session(app: &tauri::AppHandle, access: &MobileAccess, token: &str, opaque: &str, stamp: SessionStamp) -> Result<(), String> {
    let runtime = app.state::<crate::runtime::AppRuntime>();
    let _session = runtime.lock().map_err(|_| "mobile_profile_unavailable")?;
    let paths = app.state::<crate::config::AppPaths>();
    if paths.current_generation() != stamp.generation || runtime.current_revision() != stamp.revision {
        return Err("mobile_profile_changed".into());
    }
    let profiles = available_profiles(app)?;
    let active = profiles.iter().find(|p| p.is_active).ok_or("mobile_profile_unavailable")?;
    // Keep the final grant decision after filesystem/metadata work. This is the
    // authorization point for the first frame; revocation after it cannot recall delivery.
    let (internal, _) = access.devices.authorize(token, opaque, chrono::Utc::now().timestamp())?;
    if active.id != internal {
        return Err("mobile_profile_unavailable".into());
    }
    Ok(())
}
fn project(
    app: &tauri::AppHandle,
    token: &str,
    opaque: &str,
    internal: &str,
    installation: &str,
    stamp: SessionStamp,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, String> {
    let access = app.state::<MobileAccess>();
    if cancelled.load(Ordering::SeqCst) {
        return Err("mobile_refresh_cancelled".into());
    }
    #[cfg(debug_assertions)]
    crate::mobile_race::pause(app, "queued")?;
    valid_session(app, &access, token, opaque, stamp)?;
    let runtime = app.state::<crate::runtime::AppRuntime>();
    let session = runtime.lock().map_err(|_| "mobile_profile_unavailable")?;
    if app.state::<crate::config::AppPaths>().current_generation() != stamp.generation || runtime.current_revision() != stamp.revision {
        return Err("mobile_profile_changed".into());
    }
    let profile = available_profiles(app)?
        .into_iter()
        .find(|p| p.id == internal && p.is_active)
        .ok_or("mobile_profile_unavailable")?;
    #[cfg(debug_assertions)]
    crate::mobile_race::pause(app, "building")?;
    let (_, grant) = access.devices.next(token, opaque, installation, chrono::Utc::now().timestamp())?;
    let mut alias = [0u8; 32];
    for (i, pair) in grant.alias.as_bytes().as_chunks::<2>().0.iter().enumerate() {
        alias[i] = u8::from_str_radix(std::str::from_utf8(pair).map_err(|_| "mobile_access_denied")?, 16).map_err(|_| "mobile_access_denied")?;
    }
    let context = MobileSnapshotContext {
        installation_id: installation.into(),
        profile_id: opaque.into(),
        profile_name: profile.name,
        profile_icon: profile.icon_key,
        epoch: grant.epoch,
        sequence: grant.sequence,
        generated_at: chrono::Utc::now(),
        alias_key: alias,
    };
    let snapshot = session
        .store
        .build_mobile_snapshot(&context, chrono::Local::now().date_naive())
        .map_err(|_| "mobile_snapshot_unavailable")?;
    let bytes = budget_core::mobile_snapshot::serialize_mobile_snapshot(&snapshot).map_err(|_| "mobile_snapshot_unavailable")?;
    drop(session);
    #[cfg(debug_assertions)]
    crate::mobile_race::changed(app)?;
    if cancelled.load(Ordering::SeqCst) {
        return Err("mobile_refresh_cancelled".into());
    }
    valid_session(app, &access, token, opaque, stamp)?;
    Ok(bytes.into_bytes())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn unsent_financial_frame_is_discarded_when_authorization_changes() {
        let allowed = Arc::new(AtomicBool::new(true));
        let checked = allowed.clone();
        let delivery = Delivery {
            bytes: Some(Bytes::from_static(b"private financial projection")),
            check: Some(Box::new(move || checked.load(Ordering::SeqCst))),
            permit: None,
        };
        allowed.store(false, Ordering::SeqCst);
        assert!(delivery.collect().await.is_err());
    }
    #[tokio::test]
    async fn a_frame_already_handed_to_http_cannot_be_recalled() {
        let allowed = Arc::new(AtomicBool::new(true));
        let checked = allowed.clone();
        let mut delivery = Delivery {
            bytes: Some(Bytes::from_static(b"already delivered")),
            check: Some(Box::new(move || checked.load(Ordering::SeqCst))),
            permit: None,
        };
        let frame = delivery.frame().await.unwrap().unwrap();
        assert_eq!(frame.into_data().unwrap(), Bytes::from_static(b"already delivered"));
        allowed.store(false, Ordering::SeqCst);
        assert!(delivery.frame().await.is_none());
    }
}
