//! Backend release notification. Installer downloading/opening is disabled until authenticated
//! manifests and production publisher keys are integrated.
pub mod staging;
pub mod transport;
/// GitHub's "latest release" endpoint for this app. Asked from the backend,
/// not the page: the window's content rules refuse every remote request from
/// the page, which is how 1.2.9's page-side check silently never saw 1.3.0.
const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/OneTrueAsian/vault-spend/releases/latest";

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Clone)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    #[serde(default)]
    pub size: u64,
}

/// The few fields of a GitHub release the update banner needs.
#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct LatestRelease {
    pub tag_name: String,
    #[serde(default)]
    pub html_url: String,
    #[serde(default)]
    pub assets: Vec<ReleaseAsset>,
}

fn parse_latest_release(body: &str) -> Result<LatestRelease, String> {
    serde_json::from_str(body).map_err(|e| format!("Couldn't read the latest release details: {e}"))
}

/// Whether the e2e suite has asked the app not to check for updates: every
/// launch would otherwise ask GitHub, which makes the suite depend on the
/// network and on what's published, and uses up GitHub's 60-an-hour limit
/// for this machine. Honoured only alongside `VAULTSPEND_DB_DIR`, the
/// test-only data folder a real install never sets.
fn update_check_skipped(skip: Option<std::ffi::OsString>, test_db_dir: Option<std::ffi::OsString>) -> bool {
    test_db_dir.is_some() && skip.is_some_and(|value| value == "1")
}

/// Asks GitHub for the newest published release. GitHub's API refuses
/// requests without a `User-Agent` header.
pub async fn fetch_latest_release() -> Result<LatestRelease, String> {
    if update_check_skipped(std::env::var_os("VAULTSPEND_SKIP_UPDATE_CHECK"), std::env::var_os("VAULTSPEND_DB_DIR")) {
        return Err("Update check is turned off for the test suite".to_string());
    }
    let body = transport::release_metadata().await?;
    let body = std::str::from_utf8(&body).map_err(|_| "Couldn't read the latest release details: invalid text".to_string())?;
    parse_latest_release(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_check_is_skipped_only_for_the_test_suite() {
        let set = Some(std::ffi::OsString::from("1"));
        let dir = Some(std::ffi::OsString::from("C:/temp/e2e-db"));
        assert!(update_check_skipped(set.clone(), dir.clone()));
        assert!(!update_check_skipped(set, None), "a real install never sets the test data folder");
        assert!(!update_check_skipped(None, dir.clone()));
        assert!(!update_check_skipped(Some("0".into()), dir));
    }

    #[test]
    fn parse_latest_release_keeps_tag_page_and_assets() {
        let body = r#"{
            "tag_name": "v1.3.0",
            "html_url": "https://github.com/OneTrueAsian/vault-spend/releases/tag/v1.3.0",
            "draft": false,
            "assets": [
                { "name": "Vault.Spend_1.3.0_x64-setup.exe", "size": 1, "browser_download_url": "https://example.invalid/setup.exe" },
                { "name": "Vault.Spend_1.3.0_universal.dmg", "size": 1, "browser_download_url": "https://example.invalid/app.dmg" }
            ]
        }"#;
        let release = parse_latest_release(body).unwrap();
        assert_eq!(release.tag_name, "v1.3.0");
        assert_eq!(release.html_url, "https://github.com/OneTrueAsian/vault-spend/releases/tag/v1.3.0");
        assert_eq!(release.assets.len(), 2);
        assert_eq!(release.assets[0].name, "Vault.Spend_1.3.0_x64-setup.exe");
        assert_eq!(release.assets[0].browser_download_url, "https://example.invalid/setup.exe");
    }

    #[test]
    fn parse_latest_release_tolerates_missing_page_and_assets() {
        let release = parse_latest_release(r#"{ "tag_name": "v2.0.0" }"#).unwrap();
        assert_eq!(release.tag_name, "v2.0.0");
        assert_eq!(release.html_url, "");
        assert!(release.assets.is_empty());
    }

    #[test]
    fn parse_latest_release_rejects_a_reply_without_a_tag() {
        assert!(parse_latest_release(r#"{ "message": "API rate limit exceeded" }"#).is_err());
    }

    #[test]
    fn renderer_has_no_permission_to_open_downloaded_installers() {
        let raw = include_str!("../capabilities/default.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).unwrap();
        let permissions = parsed["permissions"].as_array().unwrap();
        assert!(permissions
            .iter()
            .all(|p| p.as_str() != Some("opener:allow-open-path") && p["identifier"] != "opener:allow-open-path"));
    }
}
