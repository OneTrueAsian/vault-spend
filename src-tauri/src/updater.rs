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
