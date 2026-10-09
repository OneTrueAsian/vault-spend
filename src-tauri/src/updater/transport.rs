//! Bounded backend transport. No renderer command accepts a URL or filesystem path.
use budget_core::update_manifest::{verify_manifest, TrustedUpdateKey, UpdateManifest};
use reqwest::Url;
use std::time::Duration;

pub const MAX_METADATA_BYTES: usize = 256 * 1024;
// Largest observed v1.3.0 installer: 26,326,075 bytes (DMG); ~5x headroom.
pub const MAX_DOWNLOAD_BYTES: u64 = 128 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;

pub struct SelectedUpdate {
    pub(super) manifest: UpdateManifest,
    url: Url,
}

impl SelectedUpdate {
    pub fn manifest(&self) -> &UpdateManifest {
        &self.manifest
    }
}

/// Only authenticated fields can select an installer. Metadata is not an authority for URLs.
pub fn select_update(
    release: &super::LatestRelease,
    manifest_bytes: &[u8],
    signature: &[u8],
    key_id: &str,
    keys: &[TrustedUpdateKey<'_>],
) -> Result<SelectedUpdate, String> {
    let target = if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "windows-x86_64"
    } else if cfg!(target_os = "macos") {
        "macos-universal"
    } else {
        return Err("Updates are unavailable for this platform.".into());
    };
    select_for_target(release, manifest_bytes, signature, key_id, keys, target, env!("CARGO_PKG_VERSION"))
}

fn select_for_target(
    release: &super::LatestRelease,
    manifest_bytes: &[u8],
    signature: &[u8],
    key_id: &str,
    keys: &[TrustedUpdateKey<'_>],
    target: &str,
    current_version: &str,
) -> Result<SelectedUpdate, String> {
    let manifest = verify_manifest(manifest_bytes, signature, key_id, keys, target, current_version).map_err(str::to_string)?;
    if release.tag_name != format!("v{}", manifest.version) || manifest.size > MAX_DOWNLOAD_BYTES {
        return Err("The update release or installer size is invalid.".into());
    }
    let mut assets = release.assets.iter().filter(|asset| asset.name == manifest.filename);
    let asset = assets.next().ok_or("The signed update installer is missing.")?;
    if assets.next().is_some() || asset.size != manifest.size {
        return Err("The update installer selection is ambiguous or has the wrong size.".into());
    }
    let expected = format!(
        "https://github.com/OneTrueAsian/vault-spend/releases/download/{}/{}",
        release.tag_name, manifest.filename
    );
    if asset.browser_download_url != expected {
        return Err("The update installer source is invalid.".into());
    }
    let url = Url::parse(&expected).map_err(|_| "The update installer source is invalid.")?;
    Ok(SelectedUpdate { manifest, url })
}

fn safe_https(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url.fragment().is_none()
}

fn asset_redirect_allowed(url: &Url) -> bool {
    safe_https(url)
        && url.host_str() == Some("release-assets.githubusercontent.com")
        && url.path().starts_with("/github-production-release-asset/1351742903/")
}

fn client(asset: bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .dns_resolver(std::sync::Arc::new(PublicDns))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(if asset { 120 } else { 20 }))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if asset && attempt.previous().len() <= MAX_REDIRECTS && asset_redirect_allowed(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("Update redirect is not permitted")
            }
        }))
        .user_agent("VaultSpend-Updater")
        .build()
        .map_err(|_| "Couldn't initialize the update connection.".into())
}

struct PublicDns;
impl reqwest::dns::Resolve for PublicDns {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let name = name.as_str().to_string();
        Box::pin(async move {
            if !matches!(name.as_str(), "api.github.com" | "github.com" | "release-assets.githubusercontent.com") {
                return Err("Update DNS host is not permitted".into());
            }
            let addresses: Vec<_> = tokio::net::lookup_host((name.as_str(), 443)).await?.collect();
            if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
                return Err("Update DNS destination is not public".into());
            }
            Ok(Box::new(addresses.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

fn public_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && a != 0
                && a < 224
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 192 && b == 0 && (c == 0 || c == 2))
                && !(a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                && !(a == 203 && b == 0 && c == 113)
        }
        std::net::IpAddr::V6(ip) => {
            let s = ip.segments();
            // Global unicast only; exclude transition, benchmark and documentation ranges.
            s[0] & 0xe000 == 0x2000 && s[0] != 0x2002 && !(s[0] == 0x2001 && matches!(s[1], 0 | 2 | 0xdb8)) && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}

pub(super) async fn release_metadata() -> Result<Vec<u8>, String> {
    let response = client(false)?
        .get(super::LATEST_RELEASE_URL)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "Couldn't check for updates.".to_string())?;
    bounded_body(response, MAX_METADATA_BYTES).await
}

async fn bounded_body(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if !response.status().is_success() || response.content_length().is_some_and(|size| size > limit as u64) {
        return Err("The update response has an invalid status or size.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Couldn't read the update response.")? {
        if chunk.len() > limit.saturating_sub(bytes.len()) {
            return Err("The update response is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub(super) async fn installer_response(update: &SelectedUpdate) -> Result<reqwest::Response, String> {
    client(true)?
        .get(update.url.clone())
        .send()
        .await
        .map_err(|_| "Couldn't download the signed update installer.".into())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn redirect_policy_is_exact_and_excludes_unsafe_destinations() {
        for url in [
            "http://release-assets.githubusercontent.com/github-production-release-asset/1351742903/a",
            "https://release-assets.githubusercontent.com.evil.invalid/github-production-release-asset/1351742903/a",
            "https://evil.release-assets.githubusercontent.com/github-production-release-asset/1351742903/a",
            "https://user:pass@release-assets.githubusercontent.com/github-production-release-asset/1351742903/a",
            "https://release-assets.githubusercontent.com:444/github-production-release-asset/1351742903/a",
            "https://release-assets.githubusercontent.com/github-production-release-asset/other/a",
            "https://127.0.0.1/a",
            "https://192.168.1.1/a",
            "https://[::1]/a",
            "https://github.com/other/repo/releases/download/v1/a.exe",
        ] {
            assert!(!asset_redirect_allowed(&Url::parse(url).unwrap()), "{url}");
        }
        assert!(asset_redirect_allowed(
            &Url::parse("https://release-assets.githubusercontent.com/github-production-release-asset/1351742903/fixture?token=opaque").unwrap()
        ));
    }

    #[test]
    fn dns_rejects_private_loopback_and_reserved_addresses() {
        for address in [
            "0.0.0.0",
            "10.0.0.1",
            "127.0.0.1",
            "169.254.169.254",
            "172.16.0.1",
            "192.168.1.1",
            "100.64.0.1",
            "192.0.2.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "255.255.255.255",
            "::1",
            "fe80::1",
            "fc00::1",
            "::ffff:127.0.0.1",
            "2001:db8::1",
            "2002:7f00:1::1",
        ] {
            assert!(!public_ip(address.parse().unwrap()), "{address}");
        }
        assert!(public_ip("140.82.112.3".parse().unwrap()));
        assert!(public_ip("2606:4700::1111".parse().unwrap()));
    }

    // Unit-only raw HTTP response fixture: production client always requires HTTPS.
    pub(crate) async fn response(raw: &'static [u8]) -> reqwest::Response {
        use std::io::Write;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            use std::io::Read;
            let mut request = [0; 4096];
            assert!(stream.read(&mut request).unwrap() > 0);
            stream.write_all(raw).unwrap();
        });
        reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap()
            .get(format!("http://{address}/fixture"))
            .send()
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn body_limit_applies_to_chunked_missing_length_and_declared_length() {
        for raw in [
            b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\ninert!".as_slice(),
            b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\ninert!".as_slice(),
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n3\r\nine\r\n3\r\nrt!\r\n0\r\n\r\n".as_slice(),
        ] {
            assert!(bounded_body(response(raw).await, 5).await.is_err());
        }
        assert_eq!(
            bounded_body(
                response(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\ninert").await,
                5
            )
            .await
            .unwrap(),
            b"inert"
        );
        assert!(bounded_body(response(b"HTTP/1.1 500 Error\r\nContent-Length: 0\r\n\r\n").await, 5)
            .await
            .is_err());
    }

    pub(crate) fn fixture_release() -> super::super::LatestRelease {
        super::super::LatestRelease {
            tag_name: "v1.4.0".into(),
            html_url: String::new(),
            assets: vec![super::super::ReleaseAsset {
                name: "Vault.Spend_1.4.0_x64-setup.exe".into(),
                size: 5,
                browser_download_url: "https://github.com/OneTrueAsian/vault-spend/releases/download/v1.4.0/Vault.Spend_1.4.0_x64-setup.exe".into(),
            }],
        }
    }

    pub(crate) fn fixture_selection(release: &super::super::LatestRelease) -> Result<SelectedUpdate, String> {
        use base64::Engine;
        let bytes = br#"{"format":1,"repository":"OneTrueAsian/vault-spend","version":"1.4.0","target":"windows-x86_64","filename":"Vault.Spend_1.4.0_x64-setup.exe","size":5,"sha256":"3321675705932e37c55c0ba4b0870788177e3f5670b9d7ea7a3206e287dd5ead"}"#;
        // Disposable seed [7; 32], shared with core unit tests. Never production trust.
        let public = base64::engine::general_purpose::STANDARD
            .decode("6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=")
            .unwrap();
        let signature = base64::engine::general_purpose::STANDARD
            .decode("EjukPrK3jTahfGAlBydWDVa76mdBgUUX9+AuEd03QjhqBNwvAarCb6pHslH0sy/DwpOp+Bxiei5NqFqGHAQrDQ==")
            .unwrap();
        select_for_target(
            release,
            bytes,
            &signature,
            "fixture",
            &[TrustedUpdateKey {
                id: "fixture",
                public_key: &public.try_into().unwrap(),
            }],
            "windows-x86_64",
            "1.3.0",
        )
    }

    #[test]
    fn selection_binds_signed_filename_size_tag_and_fixed_repository_url() {
        let release = fixture_release();
        assert!(fixture_selection(&release).is_ok());
        for url in [
            "http://github.com/OneTrueAsian/vault-spend/releases/download/v1.4.0/Vault.Spend_1.4.0_x64-setup.exe",
            "https://evil.invalid/inert.exe",
            "https://github.com/other/repo/releases/download/v1.4.0/Vault.Spend_1.4.0_x64-setup.exe",
        ] {
            let mut wrong = fixture_release();
            wrong.assets[0].browser_download_url = url.into();
            assert!(fixture_selection(&wrong).is_err());
        }
        let mut wrong = fixture_release();
        wrong.tag_name = "v1.3.0".into();
        assert!(fixture_selection(&wrong).is_err());
        let mut wrong = fixture_release();
        wrong.assets[0].size = 6;
        assert!(fixture_selection(&wrong).is_err());
        let mut wrong = fixture_release();
        wrong.assets.push(wrong.assets[0].clone());
        assert!(fixture_selection(&wrong).is_err());
        let mut wrong = fixture_release();
        wrong.assets.clear();
        assert!(fixture_selection(&wrong).is_err());
    }
}
