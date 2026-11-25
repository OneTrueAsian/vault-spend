//! Watched-folder discovery (VS-102). While a profile is open and folder imports are on, one
//! background thread looks at the chosen folder every few seconds (and straight away when the page
//! asks, on opening, unlocking or returning to the window). It lists the folder's own files only,
//! never subfolders or links, matches names to the profile's account mappings, skips older exports
//! by their file name without opening them, waits until a file has stopped changing, then saves a
//! copy for review. Nothing it does reaches the ledger.
//!
//! Every pass captures the open session and the folder-import settings revision under a short lock,
//! does all file reading with no lock held, and saves only if both are unchanged when it locks
//! again. A locked profile, another profile or changed settings make it drop what it found.

use budget_core::folder_import::{self, Eligibility, NameProblem, MAX_FILE_BYTES};
use budget_core::store::{BatchStatus, FolderImportMapping, StageInput, StageOutcome, Store};
use chrono::NaiveDate;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, SystemTime};

/// Sent to the page whenever discovery saved or noted something, so it reads the queue again.
pub const CHANGED_EVENT: &str = "folder-imports-changed";
const POLL_EVERY: Duration = Duration::from_secs(5);
/// A file untouched for this long counts as finished on first sight (one saved while the app was closed).
const SETTLED_AFTER: Duration = Duration::from_secs(10);
/// The most file bytes one pass reads into memory. Further exports wait for the next pass.
const MAX_PASS_BYTES: u64 = 32 * 1024 * 1024;

/// A mapping as discovery uses it: with whether its account can still receive imports.
#[derive(Debug, Clone)]
pub struct MappingView {
    pub mapping: FolderImportMapping,
    pub usable: bool,
}

/// What a scan learned about one file, for the activity list.
#[derive(Debug, Clone, PartialEq)]
pub struct Note {
    pub mapping_id: Option<i64>,
    pub account_id: Option<i64>,
    pub file_name: String,
    pub outcome: &'static str,
    pub reason: String,
}

/// A finished, eligible export read into memory, ready to save.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub mapping_id: i64,
    pub account_id: i64,
    pub file_name: String,
    pub digest: String,
    pub bytes: Vec<u8>,
    pub start: NaiveDate,
    pub end: NaiveDate,
}

#[derive(Debug, Default)]
pub struct ScanPlan {
    pub notes: Vec<Note>,
    pub candidates: Vec<Candidate>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Observed {
    len: u64,
    modified: Option<SystemTime>,
    /// Already saved, noted or skipped for these exact size and time.
    done: bool,
}

/// What discovery remembers between passes about the files it has looked at. Cleared whenever the
/// open session or the settings revision changes.
#[derive(Debug, Default)]
pub struct Observations {
    files: HashMap<PathBuf, Observed>,
    session: u64,
    settings_revision: i64,
    /// The folder couldn't be read on the last pass (or nobody has looked since the session or
    /// settings changed): the next good pass notes that it can be read again.
    folder_unsure: bool,
}

impl Observations {
    fn reset_if_changed(&mut self, session: u64, settings_revision: i64) {
        if self.session != session || self.settings_revision != settings_revision {
            self.files.clear();
            self.session = session;
            self.settings_revision = settings_revision;
            self.folder_unsure = true;
        }
    }
}

/// Which mapping a file name belongs to, or why it was not queued.
pub enum NameMatch<'a> {
    /// Not any mapping's export name: ignored without a note.
    None,
    One(&'a MappingView, folder_import::ExportDates),
    Problem { mapping: &'a MappingView, problem: NameProblem },
    Ambiguous,
}

pub fn match_name<'a>(file_name: &str, mappings: &'a [MappingView]) -> NameMatch<'a> {
    if folder_import::is_temporary_name(file_name) {
        return NameMatch::None;
    }
    let mut hits = Vec::new();
    let mut problem = None;
    for view in mappings {
        match folder_import::match_export_name(&view.mapping.stem, &view.mapping.extensions, file_name) {
            Ok(dates) => hits.push((view, dates)),
            Err(NameProblem::NotThisMapping) => {}
            Err(p) => problem = problem.or(Some((view, p))),
        }
    }
    match (hits.len(), problem) {
        (0, None) => NameMatch::None,
        (0, Some((mapping, problem))) => NameMatch::Problem { mapping, problem },
        (1, _) => NameMatch::One(hits[0].0, hits[0].1),
        _ => NameMatch::Ambiguous,
    }
}

fn note(view: Option<&MappingView>, file_name: &str, outcome: &'static str, reason: String) -> Note {
    Note {
        mapping_id: view.map(|v| v.mapping.id),
        account_id: view.map(|v| v.mapping.account_id),
        file_name: file_name.to_string(),
        outcome,
        reason,
    }
}

/// The reason shown for an export that is older than the mapping allows.
pub fn older_reason(limit: NaiveDate) -> String {
    format!("Older export — not queued (dated before {})", limit.format("%b %-d, %Y"))
}

/// The folder's own regular files, with symlinks, junctions and subfolders left out and every path
/// checked to still be inside the folder.
fn folder_files(root: &Path) -> Result<Vec<(PathBuf, String, std::fs::Metadata)>, String> {
    let canonical_root = std::fs::canonicalize(root).map_err(|_| "The watched folder can't be found. Choose it again in Settings.".to_string())?;
    let entries = std::fs::read_dir(&canonical_root).map_err(|_| "Vault Spend can't read the watched folder. Check that it still exists and you can open it.".to_string())?;
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() || !kind.is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
        let path = entry.path();
        match std::fs::canonicalize(&path) {
            Ok(real) if real.parent() == Some(canonical_root.as_path()) => {}
            _ => continue,
        }
        let Ok(meta) = std::fs::symlink_metadata(&path) else { continue };
        if !meta.is_file() {
            continue;
        }
        files.push((path, name, meta));
    }
    files.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(files)
}

/// Reads a file whole if it does not change while being read: its size and time are the same
/// before and after, and it is no bigger than the limit. `None` means "not finished yet".
fn read_settled(path: &Path, before: &std::fs::Metadata) -> std::io::Result<Option<Vec<u8>>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
    let after = std::fs::symlink_metadata(path)?;
    if after.len() != before.len() || after.modified().ok() != before.modified().ok() || bytes.len() as u64 != after.len() {
        return Ok(None);
    }
    Ok(Some(bytes))
}

pub fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// One pass over `root`: which exports to save, and notes for the ones that were not. Older
/// exports and bad names are decided from the name alone, without opening the file. A file is read
/// only once it has kept the same size and time across two passes (or has been untouched for a
/// while), and read again later only if it changes.
pub fn plan_scan(root: &Path, mappings: &[MappingView], observations: &mut Observations, now: SystemTime) -> Result<ScanPlan, String> {
    let mut plan = ScanPlan::default();
    let files = folder_files(root)?;
    let present: std::collections::HashSet<PathBuf> = files.iter().map(|f| f.0.clone()).collect();
    let mut read_bytes: u64 = 0;
    observations.files.retain(|path, _| present.contains(path));
    for (path, name, meta) in files {
        let seen = Observed {
            len: meta.len(),
            modified: meta.modified().ok(),
            done: false,
        };
        let previous = observations.files.get(&path).copied();
        if previous.is_some_and(|p| p.done && p.len == seen.len && p.modified == seen.modified) {
            continue;
        }
        let (view, dates) = match match_name(&name, mappings) {
            NameMatch::None => continue,
            NameMatch::Ambiguous => {
                plan.notes.push(note(None, &name, "bad_name", "More than one export name matches this file, so it isn't queued. Make the names in Settings distinct.".to_string()));
                observations.files.insert(path, Observed { done: true, ..seen });
                continue;
            }
            NameMatch::Problem { mapping, problem } => {
                plan.notes.push(note(Some(mapping), &name, "bad_name", problem.reason().to_string()));
                observations.files.insert(path, Observed { done: true, ..seen });
                continue;
            }
            NameMatch::One(view, dates) => (view, dates),
        };
        if !view.usable {
            plan.notes.push(note(Some(view), &name, "needs_account", "The account for this export name was deleted or hidden. Choose an account in Settings.".to_string()));
            observations.files.insert(path, Observed { done: true, ..seen });
            continue;
        }
        if folder_import::dated_in_future(dates.end, chrono::DateTime::<chrono::Local>::from(now).date_naive()) {
            plan.notes.push(note(Some(view), &name, "future_date", folder_import::FUTURE_REASON.to_string()));
            observations.files.insert(path, Observed { done: true, ..seen });
            continue;
        }
        if let Eligibility::Older { limit } = folder_import::eligibility(dates.end, view.mapping.initial_cutoff, view.mapping.watermark) {
            plan.notes.push(note(Some(view), &name, "older", older_reason(limit)));
            observations.files.insert(path, Observed { done: true, ..seen });
            continue;
        }
        if seen.len > MAX_FILE_BYTES {
            plan.notes.push(note(Some(view), &name, "too_large", "This file is over 10 MB, so it isn't read. Export a shorter date range from your bank.".to_string()));
            observations.files.insert(path, Observed { done: true, ..seen });
            continue;
        }
        let unchanged = previous.is_some_and(|p| p.len == seen.len && p.modified == seen.modified);
        let old_enough = seen.modified.and_then(|m| now.duration_since(m).ok()).is_some_and(|age| age >= SETTLED_AFTER);
        if !(unchanged || old_enough) {
            observations.files.insert(path, seen);
            continue;
        }
        // Enough read for one pass: the rest are read on the next one.
        if !plan.candidates.is_empty() && read_bytes + seen.len > MAX_PASS_BYTES {
            observations.files.insert(path, seen);
            continue;
        }
        match read_settled(&path, &meta) {
            Ok(Some(bytes)) => {
                read_bytes += bytes.len() as u64;
                observations.files.insert(path, Observed { done: true, ..seen });
                plan.candidates.push(Candidate {
                    mapping_id: view.mapping.id,
                    account_id: view.mapping.account_id,
                    file_name: name,
                    digest: digest(&bytes),
                    bytes,
                    start: dates.start,
                    end: dates.end,
                });
            }
            // Still being written: look again next pass.
            Ok(None) => {
                observations.files.insert(path, seen);
            }
            Err(_) => {
                plan.notes.push(note(Some(view), &name, "unreadable", "Vault Spend couldn't read this file. It may still be downloading or open in another app; it will be tried again.".to_string()));
                observations.files.insert(path, seen);
            }
        }
    }
    // Several exports found together are saved oldest first.
    plan.candidates.sort_by(|a, b| a.end.cmp(&b.end).then(a.file_name.cmp(&b.file_name)));
    Ok(plan)
}

/// Saves the plan's exports and notes. Returns whether anything changed. A full queue leaves the
/// file to be picked up on a later pass.
pub fn apply_plan(store: &Store, plan: ScanPlan, observations: &mut Observations, now: &str) -> Result<bool, budget_core::store::StoreError> {
    let mut changed = false;
    for n in &plan.notes {
        // A repeat of a file's latest note adds nothing, so the page isn't told to read again.
        changed |= store.record_folder_import_activity(n.mapping_id, n.account_id, &n.file_name, n.outcome, &n.reason, None, now)?;
    }
    for c in &plan.candidates {
        let outcome = store.stage_folder_import(&StageInput {
            mapping_id: c.mapping_id,
            account_id: c.account_id,
            file_name: &c.file_name,
            digest: &c.digest,
            content: &c.bytes,
            export_start: c.start,
            export_end: c.end,
            now,
        })?;
        let (kind, reason, batch) = match outcome {
            StageOutcome::Queued(id) => ("queued", "Waiting for your review".to_string(), Some(id)),
            StageOutcome::AlreadyKnown { batch_id, status: BatchStatus::Pending } => {
                // The waiting file itself is rescanned after every settings change: only a different name is news.
                match store.folder_import_batch(batch_id)?.filter(|b| b.file_name != c.file_name) {
                    Some(waiting) => (
                        "already_pending",
                        format!("Same file as \"{}\", which is already waiting for review — not queued twice", waiting.file_name),
                        Some(batch_id),
                    ),
                    None => continue,
                }
            }
            StageOutcome::AlreadyKnown { batch_id, status: BatchStatus::Imported } => {
                ("already_imported", "Already imported — not queued again".to_string(), Some(batch_id))
            }
            StageOutcome::AlreadyKnown { batch_id, status: BatchStatus::Dismissed } => {
                ("already_dismissed", "Dismissed earlier — not queued again".to_string(), Some(batch_id))
            }
            StageOutcome::QueueFull => {
                // Found by name: the scan keys files by the folder's canonical path spelling.
                let file_name = std::ffi::OsStr::new(&c.file_name);
                if let Some((_, seen)) = observations.files.iter_mut().find(|(path, _)| path.file_name() == Some(file_name)) {
                    seen.done = false;
                }
                (
                    "queue_full",
                    "Too many exports are waiting for review. Review or dismiss some and this one will be picked up.".to_string(),
                    None,
                )
            }
        };
        changed |= store.record_folder_import_activity(Some(c.mapping_id), Some(c.account_id), &c.file_name, kind, &reason, batch, now)?;
    }
    Ok(changed)
}

/// Reads one named export in the folder now, for "Review again" on a file that was never saved
/// (an older export). The name must still match the mapping; the age limit is not applied.
pub fn read_for_review(root: &Path, file_name: &str, view: &MappingView) -> Result<Candidate, String> {
    let NameMatch::One(_, dates) = match_name(file_name, std::slice::from_ref(view)) else {
        return Err("This file's name no longer matches its export name in Settings.".to_string());
    };
    let gone = || "The file is no longer in the watched folder. Put it back, or import it with Import transactions.".to_string();
    let (path, _, meta) = folder_files(root)?.into_iter().find(|f| f.1 == file_name).ok_or_else(gone)?;
    if meta.len() > MAX_FILE_BYTES {
        return Err("This file is over 10 MB, so it isn't read. Export a shorter date range from your bank.".to_string());
    }
    let bytes = read_settled(&path, &meta)
        .map_err(|_| "Vault Spend couldn't read this file. Close it in other apps and try again.".to_string())?
        .ok_or_else(|| "This file is still changing. Wait for it to finish saving and try again.".to_string())?;
    Ok(Candidate {
        mapping_id: view.mapping.id,
        account_id: view.mapping.account_id,
        file_name: file_name.to_string(),
        digest: digest(&bytes),
        bytes,
        start: dates.start,
        end: dates.end,
    })
}

/// The background thread's wake-up signal and its memory of the folder. Managed by Tauri.
#[derive(Default)]
pub struct Discovery {
    wake: Mutex<bool>,
    signal: Condvar,
    observations: Mutex<Observations>,
}

impl Discovery {
    /// Asks for a pass now instead of at the next tick.
    pub fn wake(&self) {
        *self.wake.lock().unwrap_or_else(|e| e.into_inner()) = true;
        self.signal.notify_all();
    }

    fn wait(&self) {
        let guard = self.wake.lock().unwrap_or_else(|e| e.into_inner());
        let (mut guard, _) = self
            .signal
            .wait_timeout_while(guard, POLL_EVERY, |woken| !*woken)
            .unwrap_or_else(|e| e.into_inner());
        *guard = false;
    }
}

fn now_text() -> String {
    chrono::Local::now().naive_local().format("%Y-%m-%dT%H:%M:%S").to_string()
}

/// One pass for the open profile, if any. Never holds the profile lock while touching files.
fn scan_once(app: &tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    let runtime = app.state::<crate::commands::AppStateHandle>();
    let paths = app.state::<crate::config::AppPaths>();
    let device = app.state::<crate::device_settings::DeviceSettingsStore>();
    let discovery = app.state::<Discovery>();
    let mut observations = discovery.observations.lock().unwrap_or_else(|e| e.into_inner());

    // 1. What to look for, under a short lock.
    let captured = {
        let Ok(state) = runtime.lock() else {
            observations.files.clear();
            return;
        };
        let session = runtime.current_revision();
        let Ok(settings) = state.store.folder_import_settings() else { return };
        if !settings.enabled {
            return;
        }
        let Some(root) = device.snapshot().folder_import_dir(&crate::commands::active_profile_id(&paths)).map(PathBuf::from) else {
            return;
        };
        let Ok(mappings) = state.store.list_folder_import_mappings() else { return };
        let views: Vec<MappingView> = mappings
            .into_iter()
            .map(|mapping| MappingView {
                usable: state.store.folder_import_account_usable(mapping.account_id).unwrap_or(false),
                mapping,
            })
            .collect();
        (session, settings.revision, root, views)
    };
    let (session, revision, root, views) = captured;
    observations.reset_if_changed(session, revision);

    // 2. Look at the folder and read finished exports, with no lock held.
    let folder_name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let plan = match plan_scan(&root, &views, &mut observations, SystemTime::now()) {
        Ok(mut plan) => {
            if std::mem::take(&mut observations.folder_unsure) {
                // Recorded only when the folder's latest note is a problem.
                plan.notes.push(note(None, &folder_name, "folder_ok", "The folder can be read again.".to_string()));
            }
            plan
        }
        Err(problem) => {
            observations.folder_unsure = true;
            ScanPlan {
            notes: vec![Note {
                mapping_id: None,
                account_id: None,
                file_name: folder_name,
                outcome: "folder_problem",
                reason: problem,
            }],
            candidates: Vec::new(),
            }
        }
    };
    if plan.notes.is_empty() && plan.candidates.is_empty() {
        return;
    }

    // 3. Save only into the same open session, under the same settings.
    let changed = {
        let Ok(state) = runtime.lock() else {
            observations.files.clear();
            return;
        };
        let still_same = runtime.current_revision() == session
            && state.store.folder_import_settings().is_ok_and(|s| s.enabled && s.revision == revision);
        if !still_same {
            observations.files.clear();
            return;
        }
        match apply_plan(&state.store, plan, &mut observations, &now_text()) {
            Ok(changed) => changed,
            Err(e) => {
                eprintln!("folder imports: saving what was found failed: {e}");
                observations.files.clear();
                false
            }
        }
    };
    if changed {
        let _ = app.emit(CHANGED_EVENT, session);
    }
}

/// Starts the discovery thread. It does nothing while no profile is open, the profile is locked or
/// folder imports are off.
pub fn start_thread(app: tauri::AppHandle) {
    use tauri::Manager;
    std::thread::Builder::new()
        .name("vaultspend-folder-imports".to_string())
        .spawn(move || loop {
            // A bug in one pass must not stop discovery for the rest of the session.
            if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| scan_once(&app))).is_err() {
                eprintln!("folder imports: a pass failed unexpectedly; trying again next time");
            }
            app.state::<Discovery>().wait();
        })
        .expect("the folder import thread could start");
}

#[cfg(test)]
mod tests {
    use super::*;
    use budget_core::models::AccountType;
    use budget_core::store::FolderImportMappingInput;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vaultspend-folder-imports-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn store_with_mapping(cutoff: Option<&str>) -> (Store, Vec<MappingView>) {
        let store = Store::open_in_memory().unwrap();
        let account = store.create_account("Max Checking", AccountType::Checking).unwrap().unwrap();
        store
            .save_folder_import_mapping(&FolderImportMappingInput {
                id: None,
                account_id: account,
                stem: "Bank Max Checking".to_string(),
                extensions: vec!["csv".to_string(), "xlsx".to_string()],
                invert_amounts: false,
                initial_cutoff: cutoff.map(d),
            })
            .unwrap();
        let views = views(&store);
        (store, views)
    }

    fn views(store: &Store) -> Vec<MappingView> {
        store
            .list_folder_import_mappings()
            .unwrap()
            .into_iter()
            .map(|mapping| MappingView {
                usable: store.folder_import_account_usable(mapping.account_id).unwrap(),
                mapping,
            })
            .collect()
    }

    const CSV: &str = "Date,Description,Amount\n2026-11-17,Cafe,-4.00\n";

    fn later() -> SystemTime {
        SystemTime::now() + Duration::from_secs(60)
    }

    #[test]
    fn a_new_export_is_queued_once_an_older_one_is_skipped_without_reading_and_other_files_are_ignored() {
        let dir = temp_dir("basic");
        let (store, views) = store_with_mapping(Some("2026-11-10"));
        std::fs::write(dir.join("Bank Max Checking_2026-11-18.csv"), CSV).unwrap();
        std::fs::write(dir.join("Bank Max Checking_2026-11-01.csv"), "not read").unwrap();
        std::fs::write(dir.join("holiday photo.jpg"), "x").unwrap();
        std::fs::create_dir(dir.join("Bank Max Checking_2026-11-19.csv")).unwrap();
        let mut obs = Observations::default();
        let plan = plan_scan(&dir, &views, &mut obs, later()).unwrap();
        assert_eq!(plan.candidates.len(), 1);
        assert_eq!(plan.candidates[0].file_name, "Bank Max Checking_2026-11-18.csv");
        assert_eq!(plan.notes.len(), 1);
        assert_eq!(plan.notes[0].outcome, "older");
        assert!(plan.notes[0].reason.contains("Nov 10, 2026"), "{}", plan.notes[0].reason);
        assert!(apply_plan(&store, plan, &mut obs, "2026-11-22T10:00:00").unwrap());
        assert_eq!(store.list_folder_import_batches(true).unwrap().len(), 1);
        assert_eq!(store.all_transactions().unwrap().len(), 0, "discovery is financially inert");
        // Repeated passes (bursty events) neither re-read nor re-queue.
        let again = plan_scan(&dir, &views, &mut obs, later()).unwrap();
        assert!(again.candidates.is_empty() && again.notes.is_empty());
    }

    #[test]
    fn a_file_still_being_written_waits_until_it_stops_changing() {
        let dir = temp_dir("settle");
        let (_store, views) = store_with_mapping(None);
        let path = dir.join("Bank Max Checking_2026-11-18.csv");
        std::fs::write(&path, "Date,Description,Amount\n").unwrap();
        let mut obs = Observations::default();
        let now = SystemTime::now();
        assert!(plan_scan(&dir, &views, &mut obs, now).unwrap().candidates.is_empty(), "first sight of a fresh file waits");
        std::fs::write(&path, CSV).unwrap();
        assert!(plan_scan(&dir, &views, &mut obs, now).unwrap().candidates.is_empty(), "it changed since: wait again");
        let plan = plan_scan(&dir, &views, &mut obs, now).unwrap();
        assert_eq!(plan.candidates.len(), 1, "unchanged across two passes: read");
        assert_eq!(plan.candidates[0].bytes, CSV.as_bytes());
    }

    #[test]
    fn copies_renames_and_re_adds_of_the_same_content_queue_once_and_changed_content_is_a_new_version() {
        let dir = temp_dir("dedupe");
        let (store, views) = store_with_mapping(None);
        std::fs::write(dir.join("Bank Max Checking_2026-11-18.csv"), CSV).unwrap();
        let mut obs = Observations::default();
        let plan = plan_scan(&dir, &views, &mut obs, later()).unwrap();
        apply_plan(&store, plan, &mut obs, "t").unwrap();
        std::fs::rename(dir.join("Bank Max Checking_2026-11-18.csv"), dir.join("Bank Max Checking_2026-11-11_to_2026-11-18.csv")).unwrap();
        std::fs::write(dir.join("Bank Max Checking_ 2026-11-18.csv"), CSV).unwrap();
        let plan = plan_scan(&dir, &views, &mut obs, later()).unwrap();
        apply_plan(&store, plan, &mut obs, "t").unwrap();
        assert_eq!(store.list_folder_import_batches(true).unwrap().len(), 1);
        std::fs::write(dir.join("Bank Max Checking_2026-11-18.csv"), format!("{CSV}2026-11-18,Bus,-2.00\n")).unwrap();
        let plan = plan_scan(&dir, &views, &mut obs, later()).unwrap();
        apply_plan(&store, plan, &mut obs, "t").unwrap();
        assert_eq!(store.list_folder_import_batches(true).unwrap().len(), 2, "same date, different bytes: its own review");
    }

    #[test]
    fn bad_names_ambiguous_names_and_unusable_accounts_are_noted_not_queued() {
        let dir = temp_dir("notes");
        let (store, _) = store_with_mapping(None);
        let card = store.create_account("Max Card", AccountType::Credit).unwrap().unwrap();
        store
            .save_folder_import_mapping(&FolderImportMappingInput {
                id: None,
                account_id: card,
                stem: "Bank Max Checking_2026-11-18".to_string(),
                extensions: vec!["csv".to_string()],
                invert_amounts: false,
                initial_cutoff: None,
            })
            .unwrap();
        std::fs::write(dir.join("Bank Max Checking_2026-11-31.csv"), CSV).unwrap();
        std::fs::write(dir.join("Bank Max Checking_2026-11-18_to_2026-11-01.csv"), CSV).unwrap();
        let mut obs = Observations::default();
        let plan = plan_scan(&dir, &views(&store), &mut obs, later()).unwrap();
        assert!(plan.candidates.is_empty());
        let outcomes: Vec<_> = plan.notes.iter().map(|n| (n.file_name.as_str(), n.outcome)).collect();
        assert!(outcomes.contains(&("Bank Max Checking_2026-11-31.csv", "bad_name")), "{outcomes:?}");
        assert!(outcomes.contains(&("Bank Max Checking_2026-11-18_to_2026-11-01.csv", "bad_name")), "{outcomes:?}");
        store.delete_account(card).unwrap();
        let dir2 = temp_dir("needs-account");
        std::fs::write(dir2.join("Bank Max Checking_2026-11-18_2026-11-20.csv"), CSV).unwrap();
        let plan = plan_scan(&dir2, &views(&store), &mut Observations::default(), later()).unwrap();
        assert_eq!(plan.notes.iter().map(|n| n.outcome).collect::<Vec<_>>(), vec!["needs_account"]);
    }

    #[test]
    fn a_name_dated_in_the_future_is_noted_not_queued() {
        let dir = temp_dir("future");
        let (_store, views) = store_with_mapping(None);
        let today = chrono::Local::now().date_naive();
        let next_year = today + chrono::Days::new(365);
        let tomorrow = today + chrono::Days::new(1);
        std::fs::write(dir.join(format!("Bank Max Checking_{next_year}.csv")), CSV).unwrap();
        std::fs::write(dir.join(format!("Bank Max Checking_{tomorrow}.csv")), CSV).unwrap();
        let plan = plan_scan(&dir, &views, &mut Observations::default(), later()).unwrap();
        assert_eq!(plan.candidates.iter().map(|c| c.end).collect::<Vec<_>>(), vec![tomorrow], "a day ahead is a time zone, not a typo");
        assert_eq!(plan.notes.len(), 1);
        assert_eq!(plan.notes[0].outcome, "future_date");
        assert!(plan.notes[0].reason.contains("in the future"), "{}", plan.notes[0].reason);
    }

    #[test]
    fn a_second_name_for_content_already_waiting_is_noted_once_and_the_original_is_not() {
        let (store, views) = store_with_mapping(None);
        let m = &views[0].mapping;
        let candidate = |name: &str| Candidate {
            mapping_id: m.id,
            account_id: m.account_id,
            file_name: name.to_string(),
            digest: digest(CSV.as_bytes()),
            bytes: CSV.as_bytes().to_vec(),
            start: d("2026-11-18"),
            end: d("2026-11-18"),
        };
        let apply = |name: &str| {
            let plan = ScanPlan { notes: Vec::new(), candidates: vec![candidate(name)] };
            apply_plan(&store, plan, &mut Observations::default(), "t").unwrap();
        };
        apply("Bank Max Checking_2026-11-18.csv");
        assert_eq!(store.list_folder_import_activity(100).unwrap().len(), 1);
        apply("Bank Max Checking_2026-11-18 (1).csv");
        let entries = store.list_folder_import_activity(100).unwrap();
        let noted: Vec<_> = entries.iter().filter(|e| e.outcome == "already_pending").collect();
        assert_eq!(noted.len(), 1);
        assert_eq!(noted[0].file_name, "Bank Max Checking_2026-11-18 (1).csv");
        assert_eq!(
            noted[0].reason,
            "Same file as \"Bank Max Checking_2026-11-18.csv\", which is already waiting for review — not queued twice"
        );
        let count = entries.len();
        apply("Bank Max Checking_2026-11-18.csv");
        apply("Bank Max Checking_2026-11-18 (1).csv");
        assert_eq!(store.list_folder_import_activity(100).unwrap().len(), count, "neither the waiting file nor the repeat adds an entry");
    }

    #[test]
    fn an_export_turned_away_by_a_full_queue_is_picked_up_on_a_later_pass() {
        let dir = temp_dir("queue-full");
        let (store, views) = store_with_mapping(None);
        let mapping = &views[0].mapping;
        for i in 0..budget_core::folder_import::MAX_PENDING_BATCHES {
            let content = format!("{CSV}{i}");
            store
                .stage_folder_import(&StageInput {
                    mapping_id: mapping.id,
                    account_id: mapping.account_id,
                    file_name: "Bank Max Checking_2026-11-01.csv",
                    digest: &digest(content.as_bytes()),
                    content: content.as_bytes(),
                    export_start: d("2026-11-01"),
                    export_end: d("2026-11-01"),
                    now: "t",
                })
                .unwrap();
        }
        std::fs::write(dir.join("Bank Max Checking_2026-11-18.csv"), CSV).unwrap();
        let mut obs = Observations::default();
        let plan = plan_scan(&dir, &views, &mut obs, later()).unwrap();
        assert_eq!(plan.candidates.len(), 1);
        apply_plan(&store, plan, &mut obs, "t").unwrap();
        let waiting = store.list_folder_import_batches(true).unwrap();
        let first = waiting.iter().find(|b| b.file_name == "Bank Max Checking_2026-11-01.csv").unwrap();
        store.dismiss_folder_import(first.id, "t").unwrap();
        let retry = plan_scan(&dir, &views, &mut obs, later()).unwrap();
        assert_eq!(retry.candidates.len(), 1, "the full queue's file is read again once there is room");
        apply_plan(&store, retry, &mut obs, "t").unwrap();
        assert!(store.list_folder_import_batches(true).unwrap().iter().any(|b| b.file_name == "Bank Max Checking_2026-11-18.csv"));
    }

    #[test]
    fn a_note_already_made_does_not_tell_the_page_to_read_again() {
        let dir = temp_dir("quiet");
        let (store, views) = store_with_mapping(Some("2026-11-10"));
        std::fs::write(dir.join("Bank Max Checking_2026-11-01.csv"), CSV).unwrap();
        let plan = plan_scan(&dir, &views, &mut Observations::default(), later()).unwrap();
        assert!(apply_plan(&store, plan, &mut Observations::default(), "t").unwrap());
        // A fresh pass (after a restart, say) notes the same thing again: nothing new to show.
        let plan = plan_scan(&dir, &views, &mut Observations::default(), later()).unwrap();
        assert_eq!(plan.notes.len(), 1);
        assert!(!apply_plan(&store, plan, &mut Observations::default(), "t").unwrap());
    }

    #[test]
    fn one_pass_reads_a_bounded_amount_and_leaves_the_rest_for_the_next() {
        let dir = temp_dir("pass-bytes");
        let (_store, views) = store_with_mapping(None);
        let big = format!("Date,Description,Amount
{}", "2026-11-17,Cafe,-4.00
".repeat(9 * 1024 * 1024 / 22));
        for day in ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"] {
            std::fs::write(dir.join(format!("Bank Max Checking_{day}.csv")), &big).unwrap();
        }
        let mut obs = Observations::default();
        let first = plan_scan(&dir, &views, &mut obs, later()).unwrap();
        assert_eq!(first.candidates.len(), 3, "about 27 MB fits; a fourth would pass the limit");
        let second = plan_scan(&dir, &views, &mut obs, later()).unwrap();
        assert_eq!(second.candidates.iter().map(|c| c.end.to_string()).collect::<Vec<_>>(), vec!["2026-11-18"]);
    }

    #[test]
    fn several_new_exports_are_judged_against_the_same_watermark_and_saved_oldest_first() {
        let dir = temp_dir("order");
        let (store, views) = store_with_mapping(Some("2026-11-01"));
        for day in ["2026-11-20", "2026-11-05", "2026-11-12"] {
            std::fs::write(dir.join(format!("Bank Max Checking_{day}.csv")), format!("Date,Description,Amount\n{day},Cafe,-1.00\n")).unwrap();
        }
        let mut obs = Observations::default();
        let plan = plan_scan(&dir, &views, &mut obs, later()).unwrap();
        let order: Vec<_> = plan.candidates.iter().map(|c| c.end.to_string()).collect();
        assert_eq!(order, vec!["2026-11-05", "2026-11-12", "2026-11-20"]);
        apply_plan(&store, plan, &mut obs, "t").unwrap();
        let batches = store.list_folder_import_batches(true).unwrap();
        assert_eq!(batches.len(), 3);
    }

    #[test]
    fn a_missing_folder_is_reported_not_fatal_and_review_again_reads_an_older_file_on_request() {
        let (_store, views) = store_with_mapping(Some("2026-11-10"));
        let missing = std::env::temp_dir().join("vaultspend-folder-imports-does-not-exist-xyz");
        assert!(plan_scan(&missing, &views, &mut Observations::default(), later()).unwrap_err().contains("can't be found"));
        let dir = temp_dir("review-again");
        std::fs::write(dir.join("Bank Max Checking_2026-11-01.csv"), CSV).unwrap();
        let candidate = read_for_review(&dir, "Bank Max Checking_2026-11-01.csv", &views[0]).unwrap();
        assert_eq!(candidate.end, d("2026-11-01"));
        assert!(read_for_review(&dir, "Bank Max Checking_2026-11-02.csv", &views[0]).unwrap_err().contains("no longer in the watched folder"));
    }

    /// An older export is skipped from its name alone: while another program holds it open with no
    /// sharing at all, any attempt to read it would fail and be noted as unreadable instead.
    #[cfg(windows)]
    #[test]
    fn an_older_export_is_skipped_without_being_opened() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = temp_dir("never-opened");
        let (_store, views) = store_with_mapping(Some("2026-11-10"));
        let older = dir.join("Bank Max Checking_2026-11-01.csv");
        std::fs::write(&older, CSV).unwrap();
        let _held = std::fs::OpenOptions::new().read(true).share_mode(0).open(&older).unwrap();
        assert!(std::fs::read(&older).is_err(), "the exclusive hold works: nobody else can read it");
        let plan = plan_scan(&dir, &views, &mut Observations::default(), later()).unwrap();
        assert_eq!(plan.notes.iter().map(|n| n.outcome).collect::<Vec<_>>(), vec!["older"]);
        assert!(plan.candidates.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn files_reached_through_a_link_are_never_read() {
        let outside = temp_dir("outside");
        std::fs::write(outside.join("Bank Max Checking_2026-11-18.csv"), CSV).unwrap();
        let dir = temp_dir("links");
        // A directory junction needs no special rights on Windows.
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(dir.join("inner"))
            .arg(&outside)
            .output()
            .unwrap();
        assert!(status.status.success());
        let (_store, views) = store_with_mapping(None);
        let plan = plan_scan(&dir, &views, &mut Observations::default(), later()).unwrap();
        assert!(plan.candidates.is_empty() && plan.notes.is_empty(), "subfolders and junctions are not followed");
    }
}
