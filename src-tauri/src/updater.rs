//! Downloads the installer asset for a newer release so "Update now"
//! (`UpdateBanner.tsx`) can hand it straight to the OS's own installer
//! instead of making the user find and download it from GitHub by hand.
//! Deliberately **not** a full auto-updater — nothing here verifies a
//! signature or executes anything; the frontend calls `openPath` on the
//! downloaded file, which just runs the OS's normal installer UI (NSIS/MSI
//! wizard on Windows, mounting the .dmg on macOS), exactly as if the user
//! had downloaded and double-clicked it themselves — a real self-updater
//! (signed, silent, no installer UI) was considered and explicitly not
//! built, since it needs a dedicated signing keypair and CI changes on top
//! of what this app already has.
use std::path::PathBuf;

/// GitHub's "latest release" endpoint for this app. Asked from the backend,
/// not the page: the window's content rules refuse every remote request from
/// the page, which is how 1.2.9's page-side check silently never saw 1.3.0.
const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/OneTrueAsian/vault-spend/releases/latest";

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
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
pub async fn fetch_latest_release(client: &reqwest::Client) -> Result<LatestRelease, String> {
    if update_check_skipped(std::env::var_os("VAULTSPEND_SKIP_UPDATE_CHECK"), std::env::var_os("VAULTSPEND_DB_DIR")) {
        return Err("Update check is turned off for the test suite".to_string());
    }
    let response = client
        .get(LATEST_RELEASE_URL)
        .header("User-Agent", "VaultSpend-Updater")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Couldn't check for updates: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Couldn't check for updates: server returned {}", response.status()));
    }
    let body = response.text().await.map_err(|e| format!("Couldn't check for updates: {e}"))?;
    parse_latest_release(&body)
}

/// Strips path separators so a filename from an external source (a GitHub
/// release asset's own `name` field) can never be used to write outside the
/// intended temp directory.
fn sanitize_filename(name: &str) -> String {
    name.chars().filter(|c| !matches!(c, '/' | '\\' | ':')).collect()
}

/// Downloads `url` (a GitHub release asset's direct download URL) to a file
/// named `filename` under the OS temp directory, overwriting any leftover
/// file from a previous check. GitHub requires a `User-Agent` header on
/// asset requests or it responds with an error instead of the file.
pub async fn download_asset(client: &reqwest::Client, url: &str, filename: &str) -> Result<PathBuf, String> {
    let response = client
        .get(url)
        .header("User-Agent", "VaultSpend-Updater")
        .send()
        .await
        .map_err(|e| format!("Failed to download the update: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Failed to download the update: server returned {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| format!("Failed to read the downloaded file: {e}"))?;
    let path = std::env::temp_dir().join(sanitize_filename(filename));
    std::fs::write(&path, &bytes).map_err(|e| format!("Failed to save the downloaded file: {e}"))?;
    Ok(path)
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
    fn sanitize_filename_strips_path_separators() {
        assert_eq!(sanitize_filename("../../evil.exe"), "....evil.exe");
        assert_eq!(sanitize_filename("Vault.Spend_1.1.4_x64-setup.exe"), "Vault.Spend_1.1.4_x64-setup.exe");
        assert_eq!(sanitize_filename("C:\\Windows\\evil.exe"), "CWindowsevil.exe");
    }

    /// `UpdateBanner.tsx`'s "Update now" hands the file this module
    /// downloads to `openPath`, which the opener plugin will silently
    /// reject unless `capabilities/default.json` grants `open_path` an
    /// actual scope — the plugin's own docs describe the bare
    /// `opener:allow-open-path` permission string as enabling the command
    /// "without any pre-configured scope," meaning zero paths, not "every
    /// path." This shipped broken twice with nothing to catch it until a
    /// live update check hit it: once with the permission missing
    /// entirely, once with it present but scopeless (the object form is
    /// required, with a non-empty `allow` list) — this is the missing net,
    /// so a third regression of either kind fails a test instead of
    /// quietly reaching a real user again.
    #[test]
    fn open_path_permission_grants_a_non_empty_scope() {
        let raw = include_str!("../capabilities/default.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).expect("capabilities/default.json must be valid JSON");
        let permissions = parsed["permissions"]
            .as_array()
            .expect("capabilities/default.json must have a permissions array");

        let entry = permissions
            .iter()
            .find(|p| p.as_str() == Some("opener:allow-open-path") || p["identifier"] == "opener:allow-open-path")
            .expect("capabilities/default.json is missing the opener:allow-open-path permission entirely");

        let scope = entry["allow"].as_array().unwrap_or_else(|| {
            panic!(
                "opener:allow-open-path must be the object form with a non-empty `allow` scope, not just \
                 the bare permission string -- see this test's own doc comment, or UpdateBanner.tsx's, for why"
            )
        });
        assert!(
            !scope.is_empty() && scope.iter().any(|e| e["path"].is_string()),
            "opener:allow-open-path's scope must include at least one {{ \"path\": ... }} entry"
        );
    }
}
