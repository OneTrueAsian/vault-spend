use super::*;
use crate::holding_import::{Session, Sessions};
use budget_core::holding_import::{map_rows, parse_source, ImportRow, Mapping, MAX_BYTES};
use std::{
    collections::HashSet,
    io::Read,
    path::{Path, PathBuf},
    time::Instant,
};

#[derive(Serialize)]
pub struct HoldingSourceDto {
    id: String,
    headers: Vec<String>,
    samples: Vec<Vec<String>>,
    row_count: usize,
}

fn ensure_generation(paths: &crate::config::AppPaths, generation: u64) -> Result<(), String> {
    if paths.current_generation() != generation {
        return Err("The profile changed. Close this import and start again in the current profile.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn load_holding_import(
    path: Option<String>,
    content: Option<String>,
    format: String,
    generation: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    sessions: tauri::State<Sessions>,
) -> Result<HoldingSourceDto, String> {
    let _state = state.lock()?;
    ensure_generation(&paths, generation)?;
    let content = match (path, content) {
        (Some(path), None) => {
            let file = Path::new(&path);
            if !file.extension().is_some_and(|s| s.eq_ignore_ascii_case("csv")) || !file.is_file() {
                return Err("Choose one CSV file, not a folder or another file type.".into());
            }
            let mut bytes = Vec::new();
            std::fs::File::open(file)
                .map_err(|_| "Could not open this CSV file. Check its location and access.")?
                .take((MAX_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| "Could not read this CSV file.")?;
            if bytes.len() > MAX_BYTES {
                return Err("This file is larger than 5 MB. Split it into smaller files.".into());
            }
            String::from_utf8(bytes).map_err(|_| "Save the CSV as UTF-8 before importing it.")?
        }
        (None, Some(content)) => content,
        _ => return Err("Choose one file or paste rows, not both.".into()),
    };
    let source = parse_source(&content, &format)?;
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "Could not create a safe import preview.")?;
    let id = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let dto = HoldingSourceDto {
        id: id.clone(),
        headers: source.headers.clone(),
        samples: source.rows.iter().take(3).map(|(_, r)| r.clone()).collect(),
        row_count: source.rows.len(),
    };
    let mut cache = sessions.0.lock().map_err(|_| "Could not open the import preview.")?;
    Sessions::prune(&mut cache, generation);
    // The UI exposes a single import at a time. Bound memory even for callers that do not cancel.
    cache.clear();
    cache.insert(
        id,
        Session {
            generation,
            created: Instant::now(),
            source,
            account_id: None,
            rows: vec![],
        },
    );
    Ok(dto)
}

#[derive(Serialize)]
pub struct HoldingPreviewDto {
    rows: Vec<ImportRow>,
    account_name: String,
    current_value: String,
    holdings_value: String,
    has_holdings: bool,
}

#[tauri::command]
pub fn preview_holding_import(
    id: String,
    account_id: i64,
    mapping: Mapping,
    generation: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    sessions: tauri::State<Sessions>,
) -> Result<HoldingPreviewDto, String> {
    let state = state.lock()?;
    ensure_generation(&paths, generation)?;
    let today = chrono::Local::now().date_naive();
    let account = state
        .store
        .list_accounts(today)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|a| a.id == account_id && a.account.account_type == budget_core::models::AccountType::Investment)
        .ok_or("Choose an existing investment account.")?;
    let existing = state
        .store
        .list_holdings(today)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|h| h.account_id == account_id)
        .collect::<Vec<_>>();
    let symbols = existing.iter().map(|h| h.symbol.trim().to_uppercase()).collect::<HashSet<_>>();
    let value = existing
        .iter()
        .try_fold(Decimal::ZERO, |sum, h| budget_core::holding_import::add_values(sum, h.value))?;
    let mut cache = sessions.0.lock().map_err(|_| "Could not open the import preview.")?;
    Sessions::prune(&mut cache, generation);
    let session = cache.get_mut(&id).ok_or("This preview expired. Load your rows again.")?;
    let mut rows = map_rows(&session.source, &mapping)?;
    for row in &mut rows {
        row.already_exists = row.holding.as_ref().is_some_and(|h| symbols.contains(&h.symbol));
    }
    session.account_id = Some(account_id);
    session.rows = rows.clone();
    Ok(HoldingPreviewDto {
        rows,
        account_name: account.account.name,
        current_value: account.current_balance.to_string(),
        holdings_value: value.to_string(),
        has_holdings: !existing.is_empty(),
    })
}

#[tauri::command]
pub fn commit_holding_import(
    id: String,
    selected_rows: Vec<usize>,
    generation: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    sessions: tauri::State<Sessions>,
) -> Result<usize, String> {
    let state = state.lock()?;
    ensure_generation(&paths, generation)?;
    let mut cache = sessions.0.lock().map_err(|_| "Could not open the import preview.")?;
    Sessions::prune(&mut cache, generation);
    let session = cache.get(&id).ok_or("This preview expired or was already saved. Load your rows again.")?;
    let (account_id, holdings) = session.selected_holdings(&selected_rows)?;
    let ids = state.store.import_holdings(account_id, &holdings, chrono::Local::now().date_naive())?;
    cache.remove(&id);
    Ok(ids.len())
}

#[tauri::command]
pub fn cancel_holding_import(id: String, sessions: tauri::State<Sessions>) -> Result<(), String> {
    sessions.0.lock().map_err(|_| "Could not close the import preview.")?.remove(&id);
    Ok(())
}

#[derive(Serialize)]
pub struct ImportFileEntry {
    name: String,
    path: String,
    directory: bool,
}
#[derive(Serialize)]
pub struct ImportDirectory {
    path: String,
    parent: Option<String>,
    entries: Vec<ImportFileEntry>,
}

#[tauri::command]
pub fn list_holding_import_files(path: Option<String>, state: tauri::State<AppStateHandle>) -> Result<ImportDirectory, String> {
    let _state = state.lock()?;
    let folder = match path.filter(|s| !s.trim().is_empty()) {
        Some(path) => PathBuf::from(path),
        None => std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .ok_or("Enter a folder path.")?,
    };
    let folder = folder
        .canonicalize()
        .map_err(|_| "Could not open this folder. Check its path and access.")?;
    let mut entries = Vec::new();
    for (index, entry) in std::fs::read_dir(&folder).map_err(|_| "Could not read this folder.")?.enumerate() {
        if index >= 10_000 {
            return Err("This folder has too many entries. Open a smaller folder by typing its path.".into());
        }
        let entry = entry.map_err(|_| "Could not read a folder entry.")?;
        let path = entry.path();
        let directory = path.is_dir();
        if directory || path.extension().is_some_and(|s| s.eq_ignore_ascii_case("csv")) {
            if entries.len() >= 1_000 {
                return Err("This folder has too many CSV files or subfolders. Open a smaller folder.".into());
            }
            entries.push(ImportFileEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
                directory,
            });
        }
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(ImportDirectory {
        path: folder.to_string_lossy().into_owned(),
        parent: folder.parent().map(|p| p.to_string_lossy().into_owned()),
        entries,
    })
}
