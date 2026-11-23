//! Commands: watched-folder imports (VS-102) — the Settings setup, the queue of saved exports, their
//! review and commit through the shared import code, dismissal, "Review again" and the activity list.
//! The page names saved exports and mappings by id; only choosing the folder takes a path, from the
//! folder picker, and it is checked here before it is kept (on this computer only).

use super::import::{column_inspection_dto, commit_source, preview_source, CategoryChoiceDto, ColumnInspectionDto, CommitImportRequest, ImportPreview, ImportSource, ImportSummary, StagedCommit};
use super::*;
use crate::folder_imports::{self as discovery, MappingView};
use budget_core::csv_loader::ColumnMap;
use budget_core::store::{BatchStatus, FolderImportBatch, FolderImportMappingInput, StageInput, StageOutcome};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

fn now_text() -> String {
    chrono::Local::now().naive_local().format("%Y-%m-%dT%H:%M:%S").to_string()
}

fn folder_for(paths: &crate::config::AppPaths, device: &crate::device_settings::DeviceSettingsStore) -> Option<PathBuf> {
    device.snapshot().folder_import_dir(&active_profile_id(paths)).map(PathBuf::from)
}

/// The names of the files directly in the watched folder. Read before taking the profile lock, so
/// a slow or disconnected drive never holds it.
fn names_in(folder: Option<&Path>) -> HashSet<String> {
    folder
        .and_then(|f| std::fs::read_dir(f).ok())
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.file_type().is_ok_and(|t| t.is_file() && !t.is_symlink()))
                .filter_map(|e| e.file_name().to_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Serialize)]
pub struct FolderMappingDto {
    pub id: i64,
    pub account_id: i64,
    /// `None` when the account was deleted.
    pub account_name: Option<String>,
    /// False when the account was deleted or hidden: the mapping needs another account.
    pub account_usable: bool,
    pub stem: String,
    pub extensions: Vec<String>,
    pub invert_amounts: bool,
    pub initial_cutoff: Option<String>,
    pub watermark: Option<String>,
}

#[derive(Serialize)]
pub struct FolderBatchDto {
    pub id: i64,
    pub file_name: String,
    pub account_id: i64,
    pub account_name: Option<String>,
    pub export_start: String,
    pub export_end: String,
    pub detected_at: String,
    pub status: &'static str,
    pub row_version: i64,
    /// Whether the original file is still in the folder; when it isn't, the review uses the saved copy.
    pub source_present: bool,
    pub invert_amounts: bool,
}

#[derive(Serialize)]
pub struct FolderImportsDto {
    pub enabled: bool,
    /// The watched folder on this computer, if one was chosen.
    pub folder: Option<String>,
    /// A folder was chosen but can't be found now (a disconnected drive, say).
    pub folder_missing: bool,
    pub mappings: Vec<FolderMappingDto>,
    pub pending: Vec<FolderBatchDto>,
    /// The newest activity entry already seen in Folder activity.
    pub seen_activity_id: i64,
}

fn status_text(status: BatchStatus) -> &'static str {
    match status {
        BatchStatus::Pending => "pending",
        BatchStatus::Imported => "imported",
        BatchStatus::Dismissed => "dismissed",
    }
}

fn batch_dto(state: &AppState, names: &HashMap<i64, String>, present: &HashSet<String>, batch: FolderImportBatch) -> FolderBatchDto {
    let invert_amounts = batch
        .mapping_id
        .and_then(|id| state.store.folder_import_mapping(id).ok().flatten())
        .is_some_and(|m| m.invert_amounts);
    FolderBatchDto {
        source_present: present.contains(&batch.file_name),
        account_name: names.get(&batch.account_id).cloned(),
        id: batch.id,
        file_name: batch.file_name,
        account_id: batch.account_id,
        export_start: batch.export_start.to_string(),
        export_end: batch.export_end.to_string(),
        detected_at: batch.detected_at,
        status: status_text(batch.status),
        row_version: batch.row_version,
        invert_amounts,
    }
}

fn mapping_views(state: &AppState) -> Result<Vec<MappingView>, String> {
    let mappings = state.store.list_folder_import_mappings().map_err(|e| e.to_string())?;
    mappings
        .into_iter()
        .map(|mapping| {
            Ok(MappingView {
                usable: state.store.folder_import_account_usable(mapping.account_id).map_err(|e| e.to_string())?,
                mapping,
            })
        })
        .collect()
}

/// Everything the Settings section and the Transactions page show about folder imports.
#[tauri::command]
pub fn get_folder_imports(
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
    state: tauri::State<AppStateHandle>,
) -> Result<FolderImportsDto, String> {
    let folder = folder_for(&paths, &device);
    let present = names_in(folder.as_deref());
    let folder_missing = folder.as_ref().is_some_and(|f| !f.is_dir());
    let state = state.lock()?;
    let names = state.store.folder_import_account_names().map_err(|e| e.to_string())?;
    let settings = state.store.folder_import_settings().map_err(|e| e.to_string())?;
    let mappings = mapping_views(&state)?
        .into_iter()
        .map(|v| FolderMappingDto {
            id: v.mapping.id,
            account_id: v.mapping.account_id,
            account_name: names.get(&v.mapping.account_id).cloned(),
            account_usable: v.usable,
            stem: v.mapping.stem,
            extensions: v.mapping.extensions,
            invert_amounts: v.mapping.invert_amounts,
            initial_cutoff: v.mapping.initial_cutoff.map(|d| d.to_string()),
            watermark: v.mapping.watermark.map(|d| d.to_string()),
        })
        .collect();
    let pending = state
        .store
        .list_folder_import_batches(true)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|b| batch_dto(&state, &names, &present, b))
        .collect();
    Ok(FolderImportsDto {
        enabled: settings.enabled,
        folder_missing,
        folder: folder.map(|f| f.display().to_string()),
        mappings,
        pending,
        seen_activity_id: settings.seen_activity_id,
    })
}

/// Turns automatic discovery on or off. Turning it on needs a folder and at least one export name.
/// Turning it off stops discovery; saved exports, mappings and imported transactions stay.
#[tauri::command]
pub fn set_folder_imports_enabled(
    enabled: bool,
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
    discovery_state: tauri::State<discovery::Discovery>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock()?;
    if enabled {
        if folder_for(&paths, &device).is_none() {
            return Err("Choose the folder your bank exports are saved in first.".to_string());
        }
        if state.store.list_folder_import_mappings().map_err(|e| e.to_string())?.is_empty() {
            return Err("Add at least one export name and its account first.".to_string());
        }
    }
    state.store.set_folder_imports_enabled(enabled).map_err(|e| e.to_string())?;
    drop(state);
    if enabled {
        discovery_state.wake();
    }
    Ok(())
}

/// Sets (or clears, with `None`) the watched folder on this computer. The folder must exist; only
/// its own files are ever looked at. Clearing it turns automatic discovery off.
#[tauri::command]
pub fn set_folder_import_folder(
    dir: Option<String>,
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
    discovery_state: tauri::State<discovery::Discovery>,
    state: tauri::State<AppStateHandle>,
) -> Result<Option<String>, String> {
    let dir = dir.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
    // Check a new folder before taking the profile lock, so a slow or hung network drive never holds it.
    let shown = match &dir {
        None => None,
        Some(dir) => {
            let canonical = std::fs::canonicalize(dir).map_err(|_| "That folder can't be found. Choose another one.".to_string())?;
            if !canonical.is_dir() {
                return Err("Choose a folder, not a file.".to_string());
            }
            std::fs::read_dir(&canonical).map_err(|_| "Vault Spend can't read that folder. Choose one you can open.".to_string())?;
            Some(plain_folder_path(&canonical.display().to_string()))
        }
    };
    // Held through the device-settings write, like the backup mirror folder.
    let origin = state.lock()?;
    let profile_id = active_profile_id(&paths);
    let Some(shown) = shown else {
        device.update(|settings| {
            settings.folder_import_dirs.remove(&profile_id);
        })?;
        origin.store.set_folder_imports_enabled(false).map_err(|e| e.to_string())?;
        return Ok(None);
    };
    device.update(|settings| {
        settings.folder_import_dirs.insert(profile_id.clone(), shown.clone());
    })?;
    // A new folder is a new set of files: discovery starts over under a new settings revision.
    let enabled = origin.store.folder_import_settings().map_err(|e| e.to_string())?.enabled;
    origin.store.set_folder_imports_enabled(enabled).map_err(|e| e.to_string())?;
    drop(origin);
    discovery_state.wake();
    Ok(Some(shown))
}

#[derive(Deserialize)]
pub struct FolderMappingInputDto {
    pub id: Option<i64>,
    pub account_id: i64,
    pub stem: String,
    pub extensions: Vec<String>,
    pub invert_amounts: bool,
    /// `None` means "include exports already in the folder".
    pub initial_cutoff: Option<String>,
}

#[tauri::command]
pub fn save_folder_import_mapping(
    mapping: FolderMappingInputDto,
    discovery_state: tauri::State<discovery::Discovery>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let state = state.lock()?;
    let initial_cutoff = mapping.initial_cutoff.as_deref().map(parse_date).transpose()?;
    let id = state
        .store
        .save_folder_import_mapping(&FolderImportMappingInput {
            id: mapping.id,
            account_id: mapping.account_id,
            stem: mapping.stem,
            extensions: mapping.extensions,
            invert_amounts: mapping.invert_amounts,
            initial_cutoff,
        })
        .map_err(|e| e.to_string())?;
    drop(state);
    discovery_state.wake();
    Ok(id)
}

#[tauri::command]
pub fn delete_folder_import_mapping(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.delete_folder_import_mapping(id).map_err(|e| e.to_string())
}

/// "Start over": forgets the newest imported export's date for one export name, so exports from
/// its start date on are queued again. Anything already imported or dismissed still isn't.
#[tauri::command]
pub fn clear_folder_import_watermark(
    id: i64,
    discovery_state: tauri::State<discovery::Discovery>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    state.lock()?.store.clear_folder_import_watermark(id).map_err(|e| e.to_string())?;
    discovery_state.wake();
    Ok(())
}

/// Folder activity was read up to `through`: skipped files up to there are no longer announced.
#[tauri::command]
pub fn mark_folder_activity_seen(through: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    state.lock()?.store.mark_folder_import_activity_seen(through).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct FolderMatchDto {
    pub file_name: String,
    pub account_name: Option<String>,
    /// "would_queue", "older", "bad_name", "needs_account".
    pub outcome: &'static str,
    pub reason: String,
}

/// "Test names": which files in the folder match which account, and whether each would be queued.
/// Decided from the names only; nothing is read or saved.
#[tauri::command]
pub fn test_folder_import_names(
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<FolderMatchDto>, String> {
    let (folder, views, names) = {
        let state = state.lock()?;
        let folder = folder_for(&paths, &device).ok_or_else(|| "Choose the folder your bank exports are saved in first.".to_string())?;
        (folder, mapping_views(&state)?, state.store.folder_import_account_names().map_err(|e| e.to_string())?)
    };
    let entries = std::fs::read_dir(&folder).map_err(|_| "Vault Spend can't read the watched folder. Check that it still exists.".to_string())?;
    let mut files: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file() && !t.is_symlink()))
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .collect();
    files.sort();
    let mut out = Vec::new();
    for file_name in files {
        let (view, outcome, reason) = match discovery::match_name(&file_name, &views) {
            discovery::NameMatch::None => continue,
            discovery::NameMatch::Ambiguous => (None, "bad_name", "More than one export name matches this file.".to_string()),
            discovery::NameMatch::Problem { mapping, problem } => (Some(mapping), "bad_name", problem.reason().to_string()),
            discovery::NameMatch::One(view, dates) if !view.usable => {
                let _ = dates;
                (Some(view), "needs_account", "Its account was deleted or hidden.".to_string())
            }
            discovery::NameMatch::One(view, dates) if budget_core::folder_import::dated_in_future(dates.end, chrono::Local::now().date_naive()) => {
                (Some(view), "bad_name", budget_core::folder_import::FUTURE_REASON.to_string())
            }
            discovery::NameMatch::One(view, dates) => {
                match budget_core::folder_import::eligibility(dates.end, view.mapping.initial_cutoff, view.mapping.watermark) {
                    budget_core::folder_import::Eligibility::Older { limit } => (Some(view), "older", discovery::older_reason(limit)),
                    budget_core::folder_import::Eligibility::Eligible => (Some(view), "would_queue", "Will be queued for review (unless it was imported or dismissed before)".to_string()),
                }
            }
        };
        out.push(FolderMatchDto {
            account_name: view.and_then(|v| names.get(&v.mapping.account_id).cloned()),
            file_name,
            outcome,
            reason,
        });
    }
    Ok(out)
}

/// Asks discovery to look at the folder now (opening, unlocking or coming back to the window).
/// Returns at once; the page hears `folder-imports-changed` when something was found.
#[tauri::command]
pub fn scan_folder_imports_now(discovery_state: tauri::State<discovery::Discovery>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let _open = state.lock()?;
    discovery_state.wake();
    Ok(())
}

#[derive(Serialize)]
pub struct FolderActivityDto {
    pub id: i64,
    pub at: String,
    pub file_name: String,
    pub account_name: Option<String>,
    pub outcome: String,
    pub reason: String,
    pub batch_id: Option<i64>,
    /// Whether "Review again" can open this file: a finished saved export with its copy kept, or
    /// an older export that was skipped without being saved.
    pub can_review_again: bool,
    /// A finished export whose saved copy was cleared to keep the profile small: it can no longer
    /// be reviewed again from here.
    pub copy_cleared: bool,
}

#[tauri::command]
pub fn list_folder_import_activity(state: tauri::State<AppStateHandle>) -> Result<Vec<FolderActivityDto>, String> {
    let state = state.lock()?;
    let names = state.store.folder_import_account_names().map_err(|e| e.to_string())?;
    let entries = state.store.list_folder_import_activity(100).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        let finished = match entry.batch_id {
            Some(id) => state.store.folder_import_batch(id).map_err(|e| e.to_string())?.filter(|b| b.status != BatchStatus::Pending),
            None => None,
        };
        let can_review_again = match entry.batch_id {
            Some(_) => finished.as_ref().is_some_and(|b| b.has_content),
            None => entry.outcome == "older" && entry.mapping_id.is_some(),
        };
        let copy_cleared = finished.is_some_and(|b| !b.has_content);
        out.push(FolderActivityDto {
            account_name: entry.account_id.and_then(|id| names.get(&id).cloned()),
            id: entry.id,
            at: entry.at,
            file_name: entry.file_name,
            outcome: entry.outcome,
            reason: entry.reason,
            batch_id: entry.batch_id,
            can_review_again,
            copy_cleared,
        });
    }
    Ok(out)
}

/// `canonicalize` gives Windows' extended form (`\\?\C:\...`, or `\\?\UNC\server\share\...` for a
/// network folder); this is the ordinary spelling people recognise.
fn plain_folder_path(extended: &str) -> String {
    if let Some(share) = extended.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{share}");
    }
    extended.strip_prefix(r"\\?\").unwrap_or(extended).to_string()
}

/// The pending batch's saved copy, refusing a batch that is not waiting for review.
fn pending_source(state: &AppState, batch_id: i64) -> Result<(FolderImportBatch, Vec<u8>), String> {
    let batch = state
        .store
        .folder_import_batch(batch_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "That export is no longer saved. Refresh and try again.".to_string())?;
    if batch.status != BatchStatus::Pending {
        return Err("This export was already imported or dismissed. Use Review again to open it.".to_string());
    }
    if !state.store.folder_import_account_usable(batch.account_id).map_err(|e| e.to_string())? {
        return Err("The account for this export was deleted or hidden. Show the account again, or dismiss this export and import the file with Import transactions.".to_string());
    }
    let bytes = state
        .store
        .folder_import_batch_content(batch_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| budget_core::store::FolderImportError::ContentGone.to_string())?;
    Ok((batch, bytes))
}

/// The column-matching step for a saved export, the same as for a picked file.
#[tauri::command]
pub fn inspect_folder_import_columns(batch_id: i64, state: tauri::State<AppStateHandle>) -> Result<ColumnInspectionDto, String> {
    let state = state.lock()?;
    let (batch, bytes) = pending_source(&state, batch_id)?;
    let inspection = importer::inspect_columns_from_bytes(&batch.file_name, &bytes).map_err(|e| e.to_string())?;
    column_inspection_dto(&state, Some(inspection), batch.account_id)
}

#[derive(Serialize)]
pub struct FolderImportPreviewDto {
    pub batch: FolderBatchDto,
    pub preview: ImportPreview,
}

/// The review of a saved export: every row, through the same preview as a picked file. A pure read.
#[tauri::command]
pub fn preview_folder_import(
    batch_id: i64,
    invert_amounts: bool,
    column_map: Option<ColumnMap>,
    column_headers: Option<Vec<String>>,
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
    state: tauri::State<AppStateHandle>,
) -> Result<FolderImportPreviewDto, String> {
    let present = names_in(folder_for(&paths, &device).as_deref());
    let mut state = state.lock()?;
    let (batch, bytes) = pending_source(&state, batch_id)?;
    let source = ImportSource::Saved {
        file_name: &batch.file_name,
        bytes: &bytes,
    };
    let preview = preview_source(&mut state, &source, invert_amounts, batch.account_id, column_map.as_ref(), column_headers.as_deref())?;
    let names = state.store.folder_import_account_names().map_err(|e| e.to_string())?;
    Ok(FolderImportPreviewDto {
        batch: batch_dto(&state, &names, &present, batch),
        preview,
    })
}

/// Imports the rows the person kept from a saved export, under the same checks as `commit_import`,
/// and finishes the export (its receipt and the account's newest-export date) in the same
/// transaction. Refused when the export changed or was finished since it was reviewed.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn commit_folder_import(
    batch_id: i64,
    row_version: i64,
    invert_amounts: bool,
    review_token: String,
    included_indices: Vec<usize>,
    account_overrides: HashMap<usize, i64>,
    category_choices: Option<HashMap<String, CategoryChoiceDto>>,
    row_choices: HashMap<usize, Option<String>>,
    column_map: Option<ColumnMap>,
    column_headers: Option<Vec<String>>,
    remember_signs: Option<bool>,
    state: tauri::State<AppStateHandle>,
) -> Result<ImportSummary, String> {
    let mut state = state.lock()?;
    let (batch, bytes) = pending_source(&state, batch_id)?;
    if batch.row_version != row_version {
        return Err(budget_core::store::FolderImportError::Stale.to_string());
    }
    let source = ImportSource::Saved {
        file_name: &batch.file_name,
        bytes: &bytes,
    };
    let summary = commit_source(
        &mut state,
        &source,
        Some(StagedCommit { batch_id, row_version }),
        CommitImportRequest {
            path: String::new(),
            invert_amounts,
            default_account_id: batch.account_id,
            review_token,
            included_indices,
            account_overrides,
            category_choices,
            row_choices,
            column_map,
            column_headers,
        },
    )?;
    // "Use this for future exports": the sign choice made in this review becomes the export name's own.
    if remember_signs == Some(true) {
        if let Some(mapping) = batch.mapping_id {
            if let Err(e) = state.store.set_folder_import_mapping_invert(mapping, invert_amounts) {
                eprintln!("folder imports: remembering the amount convention failed: {e}");
            }
        }
    }
    Ok(summary)
}

/// "Dismiss": not imported, and not queued again automatically even if the file is added back.
#[tauri::command]
pub fn dismiss_folder_import(batch_id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.dismiss_folder_import(batch_id, &now_text()).map_err(|e| e.to_string())
}

/// "Review again" from the activity list: puts that one file back in the queue and returns it,
/// ready to open, without changing the cutoff, the watermark or any receipt. A saved export is
/// reopened from its saved copy; an older export that was skipped unread is read from the folder
/// now. Asking twice returns the same pending export. Works while discovery is paused.
#[tauri::command]
pub fn review_folder_import_again(
    activity_id: i64,
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
    discovery_state: tauri::State<discovery::Discovery>,
    runtime: tauri::State<AppStateHandle>,
) -> Result<FolderBatchDto, String> {
    let folder = folder_for(&paths, &device);
    let present = names_in(folder.as_deref());
    let (entry, view, session) = {
        let state = runtime.lock()?;
        let entry = state
            .store
            .folder_import_activity_entry(activity_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "That entry is no longer in the activity list. Refresh and try again.".to_string())?;
        if let Some(batch_id) = entry.batch_id {
            let batch = state.store.requeue_folder_import(batch_id, &now_text()).map_err(|e| e.to_string())?;
            let names = state.store.folder_import_account_names().map_err(|e| e.to_string())?;
            return Ok(batch_dto(&state, &names, &present, batch));
        }
        if entry.outcome != "older" {
            return Err("This file can't be reviewed again from here. Import it with Import transactions.".to_string());
        }
        let view = entry
            .mapping_id
            .and_then(|id| mapping_views(&state).ok()?.into_iter().find(|v| v.mapping.id == id))
            .ok_or_else(|| "The export name for this file was removed. Import it with Import transactions.".to_string())?;
        if !view.usable {
            return Err("The account for this export name was deleted or hidden. Choose an account in Settings first.".to_string());
        }
        (entry, view, runtime.current_revision())
    };
    let folder = folder.ok_or_else(|| "Choose the watched folder again in Settings first.".to_string())?;
    // Read with no lock held, then save only into the same open session.
    let candidate = discovery::read_for_review(&folder, &entry.file_name, &view)?;
    let state = runtime.lock()?;
    if runtime.current_revision() != session {
        return Err("STALE_PROFILE: This request belongs to a previous profile session.".to_string());
    }
    let now = now_text();
    let batch_id = match state
        .store
        .stage_folder_import(&StageInput {
            mapping_id: candidate.mapping_id,
            account_id: candidate.account_id,
            file_name: &candidate.file_name,
            digest: &candidate.digest,
            content: &candidate.bytes,
            export_start: candidate.start,
            export_end: candidate.end,
            now: &now,
        })
        .map_err(|e| e.to_string())?
    {
        StageOutcome::Queued(id) => {
            state
                .store
                .record_folder_import_activity(Some(candidate.mapping_id), Some(candidate.account_id), &candidate.file_name, "requeued", "Opened for review on request", Some(id), &now)
                .map_err(|e| e.to_string())?;
            id
        }
        StageOutcome::AlreadyKnown { batch_id, .. } => batch_id,
        StageOutcome::QueueFull => return Err("Too many exports are waiting for review. Review or dismiss some first.".to_string()),
    };
    let batch = state.store.requeue_folder_import(batch_id, &now).map_err(|e| e.to_string())?;
    let names = state.store.folder_import_account_names().map_err(|e| e.to_string())?;
    let dto = batch_dto(&state, &names, &present, batch);
    drop(state);
    discovery_state.wake();
    Ok(dto)
}

#[cfg(test)]
mod tests;
