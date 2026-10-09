//! Backend-only staging primitives; no download/install IPC is registered.
use super::transport::SelectedUpdate;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

pub struct UpdateStaging {
    directory: PathBuf,
    entries: HashMap<String, (PathBuf, budget_core::update_manifest::UpdateManifest, Instant)>,
}

impl UpdateStaging {
    /// `parent` must be a backend-selected per-user app cache directory, never renderer input.
    pub fn new(parent: &Path) -> Result<Self, String> {
        ensure_directory(parent)?;
        let directory = parent.join(format!("vaultspend-update-{}", random_token()?));
        fs::create_dir(&directory).map_err(|_| "Couldn't create private update staging.".to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).is_err() {
                let _ = fs::remove_dir(&directory);
                return Err("Couldn't restrict update staging access.".into());
            }
        }
        Ok(Self {
            directory,
            entries: HashMap::new(),
        })
    }

    pub async fn download(&mut self, update: SelectedUpdate) -> Result<String, String> {
        self.ensure_not_staged(&update)?;
        let response = super::transport::installer_response(&update).await?;
        self.stage_response(update, response).await
    }

    async fn stage_response(&mut self, update: SelectedUpdate, mut response: reqwest::Response) -> Result<String, String> {
        use std::io::Write;
        self.ensure_not_staged(&update)?;
        ensure_directory(&self.directory)?;
        let manifest = update.manifest;
        if !response.status().is_success() || response.content_length().is_some_and(|size| size != manifest.size) {
            return Err("The installer response has an invalid status or size.".into());
        }
        let token = random_token()?;
        if self.entries.contains_key(&token) {
            return Err("The update token already exists.".into());
        }
        let path = self.directory.join(format!("{token}-{}", manifest.filename));
        let mut pending = PendingFile {
            path: path.clone(),
            owned: false,
        };
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "Couldn't create the staged installer.".to_string())?;
        pending.owned = true;
        let mut size = 0u64;
        while let Some(chunk) = response.chunk().await.map_err(|_| "Couldn't read the installer download.")? {
            if chunk.len() as u64 > manifest.size.saturating_sub(size) {
                return Err("The installer download is too large.".into());
            }
            file.write_all(&chunk).map_err(|_| "Couldn't save the installer download.")?;
            size += chunk.len() as u64;
        }
        file.sync_all().map_err(|_| "Couldn't finish saving the installer.")?;
        drop(file);
        verify_file(&self.directory, &path, &manifest)?;
        self.entries
            .insert(token.clone(), (path, manifest, Instant::now() + Duration::from_secs(600)));
        pending.owned = false;
        Ok(token)
    }

    fn ensure_not_staged(&self, update: &SelectedUpdate) -> Result<(), String> {
        if self
            .entries
            .values()
            .any(|(_, manifest, _)| manifest.version == update.manifest().version && manifest.target == update.manifest().target)
        {
            return Err("This update is already staged. Cancel it before downloading again.".into());
        }
        Ok(())
    }

    /// One-use token; rehash immediately before an explicitly confirmed future backend action.
    /// This callback is never wired to an opener while production trust is unavailable.
    pub fn with_verified_installer(&mut self, token: &str, action: impl FnOnce(&Path) -> Result<(), String>) -> Result<(), String> {
        let (path, manifest, expires) = self.entries.remove(token).ok_or("The update token is invalid or no longer available.")?;
        let _cleanup = PendingFile {
            path: path.clone(),
            owned: true,
        };
        if Instant::now() >= expires {
            return Err("The update token has expired.".into());
        }
        verify_file(&self.directory, &path, &manifest)?;
        action(&path)
    }

    pub fn cancel(&mut self, token: &str) -> Result<(), String> {
        let (path, _, _) = self.entries.remove(token).ok_or("The update token is invalid or no longer available.")?;
        ensure_directory(&self.directory)?;
        fs::remove_file(path).map_err(|_| "Couldn't remove the cancelled update.".into())
    }
}

/// Restart cleanup is deliberately non-recursive and only accepts old, recognizable app files.
/// Recent sessions (including another running app instance) and unknown/link entries are retained.
pub fn cleanup_abandoned(parent: &Path) -> Result<usize, String> {
    cleanup_before(parent, std::time::SystemTime::now() - Duration::from_secs(24 * 60 * 60))
}

fn cleanup_before(parent: &Path, cutoff: std::time::SystemTime) -> Result<usize, String> {
    ensure_directory(parent)?;
    let mut removed = 0;
    for entry in fs::read_dir(parent).map_err(|_| "Couldn't inspect update staging.")? {
        let entry = entry.map_err(|_| "Couldn't inspect update staging.")?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !name.strip_prefix("vaultspend-update-").is_some_and(valid_token) {
            continue;
        }
        let directory = entry.path();
        if ensure_directory(&directory).is_err() {
            continue;
        }
        let metadata = fs::symlink_metadata(&directory).map_err(|_| "Couldn't inspect update staging.")?;
        if metadata.modified().map_or(true, |modified| modified >= cutoff) {
            continue;
        }
        let children: Vec<_> = fs::read_dir(&directory)
            .map_err(|_| "Couldn't inspect update staging.")?
            .collect::<Result<_, _>>()
            .map_err(|_| "Couldn't inspect update staging.")?;
        let recognizable = children.iter().all(|child| {
            let name = child.file_name();
            let Some(name) = name.to_str() else {
                return false;
            };
            let Some((token, filename)) = name.split_once('-') else {
                return false;
            };
            valid_token(token)
                && filename.starts_with("Vault.Spend_")
                && ["_x64-setup.exe", "_x64_en-US.msi", "_universal.dmg"]
                    .iter()
                    .any(|suffix| filename.ends_with(suffix))
                && fs::symlink_metadata(child.path()).is_ok_and(|metadata| metadata.is_file() && !reparse(&metadata))
        });
        if !recognizable {
            continue;
        }
        // Recheck before deletion; never follow a replaced staging directory.
        ensure_directory(&directory)?;
        for child in children {
            fs::remove_file(child.path()).map_err(|_| "Couldn't clean an abandoned update.")?;
        }
        fs::remove_dir(directory).map_err(|_| "Couldn't clean an abandoned update.")?;
        removed += 1;
    }
    Ok(removed)
}

fn valid_token(token: &str) -> bool {
    token.len() == 64 && token.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

impl Drop for UpdateStaging {
    fn drop(&mut self) {
        if ensure_directory(&self.directory).is_err() {
            return;
        }
        for (path, _, _) in self.entries.values() {
            let _ = fs::remove_file(path);
        }
        let _ = fs::remove_dir(&self.directory);
    }
}

struct PendingFile {
    path: PathBuf,
    owned: bool,
}
impl Drop for PendingFile {
    fn drop(&mut self) {
        if self.owned && self.path.parent().is_some_and(|parent| ensure_directory(parent).is_ok()) {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "Couldn't create a secure update token.")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "Update staging is unavailable.")?;
    if !metadata.is_dir() || reparse(&metadata) {
        return Err("Update staging cannot use a redirected directory.".into());
    }
    Ok(())
}

fn verify_file(directory: &Path, path: &Path, manifest: &budget_core::update_manifest::UpdateManifest) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    ensure_directory(directory)?;
    let metadata = fs::symlink_metadata(path).map_err(|_| "The staged installer is unavailable.")?;
    if !metadata.is_file() || reparse(&metadata) || metadata.len() != manifest.size {
        return Err("The staged installer has changed.".into());
    }
    let mut file = fs::File::open(path).map_err(|_| "The staged installer is unavailable.")?;
    let mut digest = Sha256::new();
    let mut size = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "Couldn't verify the staged installer.")?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > manifest.size {
            return Err("The staged installer has changed.".into());
        }
        digest.update(&buffer[..count]);
    }
    if size != manifest.size || format!("{:x}", digest.finalize()) != manifest.sha256 {
        return Err("The staged installer has changed.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::transport::tests::{fixture_release, fixture_selection, response};
    use super::*;

    fn stage() -> UpdateStaging {
        UpdateStaging::new(&std::env::temp_dir()).unwrap()
    }
    fn selection() -> SelectedUpdate {
        fixture_selection(&fixture_release()).unwrap()
    }
    const INERT: &[u8] = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\ninert";

    #[tokio::test]
    async fn accepts_inert_fixture_consumes_token_and_cleans_staging() {
        let mut staging = stage();
        let directory = staging.directory.clone();
        let token = staging.stage_response(selection(), response(INERT).await).await.unwrap();
        assert_eq!(token.len(), 64);
        assert!(
            staging.stage_response(selection(), response(INERT).await).await.is_err(),
            "duplicate download is rejected"
        );
        staging
            .with_verified_installer(&token, |path| {
                assert_eq!(fs::read(path).unwrap(), b"inert");
                Ok(())
            })
            .unwrap();
        assert!(staging.with_verified_installer(&token, |_| panic!("stale token")).is_err());
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
        drop(staging);
        assert!(!directory.exists());
    }

    #[tokio::test]
    async fn cleans_size_digest_and_truncated_response_failures_then_allows_retry() {
        let mut staging = stage();
        for raw in [
            b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\ninert!".as_slice(),
            b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\ninert!".as_slice(),
            b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nother".as_slice(),
            b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nin".as_slice(),
        ] {
            assert!(staging.stage_response(selection(), response(raw).await).await.is_err());
            assert_eq!(fs::read_dir(&staging.directory).unwrap().count(), 0);
        }
        let token = staging.stage_response(selection(), response(INERT).await).await.unwrap();
        staging.cancel(&token).unwrap();
        assert!(staging.cancel(&token).is_err());
    }

    #[tokio::test]
    async fn rejects_tampering_expiry_and_tokens_from_other_session() {
        let mut staging = stage();
        let mut other = stage();
        let token = staging.stage_response(selection(), response(INERT).await).await.unwrap();
        assert!(other.with_verified_installer(&token, |_| panic!("cross session token")).is_err());
        fs::write(&staging.entries[&token].0, b"other").unwrap();
        assert!(staging.with_verified_installer(&token, |_| panic!("changed bytes")).is_err());
        let token = staging.stage_response(selection(), response(INERT).await).await.unwrap();
        staging.entries.get_mut(&token).unwrap().2 = Instant::now();
        assert!(staging.with_verified_installer(&token, |_| panic!("expired token")).is_err());
        let token = staging.stage_response(selection(), response(INERT).await).await.unwrap();
        let path = staging.entries[&token].0.clone();
        drop(staging);
        assert!(!path.exists());
        assert!(other.with_verified_installer(&token, |_| panic!("restart token")).is_err());
    }

    #[tokio::test]
    async fn cancelling_in_flight_future_removes_partial_file() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (release, wait) = std::sync::mpsc::channel::<()>();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            assert!(stream.read(&mut [0; 4096]).unwrap() > 0);
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nin")
                .unwrap();
            let _ = wait.recv_timeout(Duration::from_secs(3));
        });
        let response = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap()
            .get(format!("http://{address}/fixture"))
            .send()
            .await
            .unwrap();
        let mut staging = stage();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), staging.stage_response(selection(), response))
                .await
                .is_err()
        );
        assert_eq!(fs::read_dir(&staging.directory).unwrap().count(), 0);
        drop(release);
        server.join().unwrap();
    }

    #[test]
    fn restart_cleanup_preserves_recent_unknown_and_unrelated_files() {
        let parent = stage();
        let abandoned = UpdateStaging::new(&parent.directory).unwrap();
        let abandoned_path = abandoned.directory.clone();
        let unknown = UpdateStaging::new(&parent.directory).unwrap();
        fs::write(unknown.directory.join("do-not-delete.txt"), b"keep").unwrap();
        let unrelated = parent.directory.join("other-app");
        fs::create_dir(&unrelated).unwrap();
        assert_eq!(cleanup_abandoned(&parent.directory).unwrap(), 0, "recent sessions retained");
        assert_eq!(
            cleanup_before(&parent.directory, std::time::SystemTime::now() + Duration::from_secs(1)).unwrap(),
            1
        );
        assert!(!abandoned_path.exists());
        assert!(unknown.directory.join("do-not-delete.txt").exists());
        assert!(unrelated.exists());
        fs::remove_file(unknown.directory.join("do-not-delete.txt")).unwrap();
        fs::remove_dir(unrelated).unwrap();
    }
}
