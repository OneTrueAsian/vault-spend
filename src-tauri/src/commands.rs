use budget_core::categorizer;
use budget_core::classifier::Classifier;
use budget_core::importer;
use budget_core::learner;
use budget_core::models::AccountType;
use budget_core::rules::RuleSet;
use budget_core::store::{CategorySource, Store};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::sync::Mutex;

/// Writes arbitrary text (CSV export content) to a path the user already
/// picked via a native save dialog on the frontend — the frontend builds
/// the CSV itself (it already holds exactly the filtered/visible rows to
/// export), this just does the actual filesystem write, which sandboxed
/// frontend JS can't do directly.
///
/// Prepends a UTF-8 byte-order-mark: without one, Excel (and other Windows
/// tools) guesses the file is Windows-1252 rather than UTF-8, and any
/// non-ASCII character (an em dash, a curly quote, an accented name) comes
/// back as mojibake. `setup_import::load_setup_csv` strips a leading BOM
/// back out when reading a file this produced, so the round trip is safe.
/// Returns the currently-resolved data file path, for display on the
/// Reports tab's Settings section.
/// The data file path this session is actually using right now — may
/// differ from what `resolve_db_path` computed at launch, since
/// `relocate_data_file`/`restore_backup` update it in place rather than
/// requiring a restart. A poisoned lock (only possible if an earlier panic
/// happened mid-update) still yields a usable path rather than taking down
/// every command that reads it.
fn current_db_path(paths: &crate::config::AppPaths) -> std::path::PathBuf {
    paths.db_path.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
pub fn get_data_file_location(paths: tauri::State<crate::config::AppPaths>) -> String {
    current_db_path(&paths).to_string_lossy().to_string()
}

/// Copies the live database to `new_dir/vaultspend.db` (via `Store::backup_to`,
/// safe against a live connection), points `config.json` at it, then swaps
/// this session's live connection over to the new file in place. The old
/// file is deliberately left behind, untouched.
///
/// This used to ask for (and, briefly, automatically trigger) a full app
/// restart instead. Automatic restart via `tauri-plugin-process`'s
/// `relaunch()` turned out to be unreliable on Windows in real testing — a
/// second WebView2 instance racing the first one's teardown occasionally
/// left the relaunched window stuck on a native "can't reach this page"
/// error (a `Chrome_WidgetWin_0` window-class unregister failure). Hot-
/// swapping the connection instead sidesteps that whole class of bug by
/// never opening a second window at all.
#[tauri::command]
pub fn relocate_data_file(
    new_dir: String,
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
) -> Result<String, String> {
    let old_live_path = current_db_path(&paths);
    let new_dir = std::path::PathBuf::from(new_dir);
    std::fs::create_dir_all(&new_dir).map_err(|e| e.to_string())?;
    let new_db_path = new_dir.join("vaultspend.db");
    if new_db_path.exists() {
        return Err(format!("{} already has a vaultspend.db — pick an empty folder.", new_dir.display()));
    }

    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.backup_to(&new_db_path).map_err(|e| e.to_string())?;
    crate::config::write_db_location_config(&paths.config_path, &new_db_path).map_err(|e| e.to_string())?;
    *state = AppState::open(&new_db_path)?;
    *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = new_db_path.clone();
    paths.bump_generation();
    // If the profile that was just live is a registered profile (not the
    // plain, never-used-profiles Default), keep its registry entry pointing
    // at the moved file — otherwise switching away and back later would
    // silently reopen the stale pre-relocate copy. A no-op when
    // profiles.json doesn't exist yet.
    crate::profiles::update_active_db_path(&paths.config_path, &old_live_path, &new_db_path)?;

    Ok(new_db_path.to_string_lossy().to_string())
}

/// Copies the live database to an exact file path the user picked via a
/// native save dialog — unlike `relocate_data_file`, this never changes
/// what the app is actively using; it's a one-off copy for backing up to
/// a USB drive, a cloud-synced folder, or bringing to another computer.
/// Safe against the live connection (`Store::backup_to`'s SQLite online
/// backup API), so nothing needs to pause or lock while this runs.
#[tauri::command]
pub fn export_database(destination: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.backup_to(&destination).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct BackupDto {
    pub filename: String,
    pub created_at: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub fn list_backups(paths: tauri::State<crate::config::AppPaths>) -> Result<Vec<BackupDto>, String> {
    let backups_dir = crate::backups::backups_dir_for(&current_db_path(&paths));
    Ok(crate::backups::list_backups(&backups_dir)?
        .into_iter()
        .map(|b| BackupDto {
            filename: b.filename,
            created_at: b.created_at,
            size_bytes: b.size_bytes,
        })
        .collect())
}

#[derive(Serialize)]
pub struct BackgroundSettingsDto {
    pub tray_enabled: bool,
    pub autostart_enabled: bool,
    /// Whether "start when I sign in" can be turned on on this platform.
    pub autostart_supported: bool,
}

#[tauri::command]
pub fn get_background_settings(state: tauri::State<AppStateHandle>) -> Result<BackgroundSettingsDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let s = state.store.get_background_settings().map_err(|e| e.to_string())?;
    Ok(BackgroundSettingsDto {
        tray_enabled: s.tray_enabled,
        autostart_enabled: s.autostart_enabled,
        autostart_supported: cfg!(windows),
    })
}

/// Turns "keep running in the tray and remind me about bills" on or off —
/// the tray icon appears or disappears straight away.
#[tauri::command]
pub fn set_tray_enabled(enabled: bool, app: tauri::AppHandle, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    {
        let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
        state.store.set_tray_enabled(enabled).map_err(|e| e.to_string())?;
    }
    if enabled {
        crate::background::install_tray(&app).map_err(|e| e.to_string())
    } else {
        crate::background::remove_tray(&app);
        Ok(())
    }
}

/// Starts (or stops) Vault Spend at sign-in. The setting is only saved once
/// the operating system accepted the change.
#[tauri::command]
pub fn set_autostart_enabled(enabled: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    crate::background::set_autostart(enabled)?;
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_autostart_enabled(enabled).map_err(|e| e.to_string())
}

/// Sends a sample reminder so the user can see what one looks like and that
/// notifications get through.
#[tauri::command]
pub fn send_test_reminder(app: tauri::AppHandle) -> Result<(), String> {
    crate::background::notify(
        &app,
        "Vault Spend reminders are on",
        "This is what an upcoming-bill reminder will look like.",
    )
}

#[derive(Serialize)]
pub struct BackupNowDto {
    pub filename: String,
    /// The second folder the backup was also copied to, when one is set and it worked.
    pub copied_to: Option<String>,
    /// Why the second copy failed, when one is set and it did not work.
    pub copy_error: Option<String>,
}

/// Manual "Back up now" — always creates one, bypassing the 24h automatic
/// throttle (`backups::create_backup_if_due`, called only at launch). Also
/// copies it to the second backup folder when one is set.
#[tauri::command]
pub fn create_backup_now(paths: tauri::State<crate::config::AppPaths>, state: tauri::State<AppStateHandle>) -> Result<BackupNowDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let backups_dir = crate::backups::backups_dir_for(&current_db_path(&paths));
    let outcome = crate::backups::create_backup_full(&state.store, &backups_dir, chrono::Local::now().naive_local())?;
    Ok(BackupNowDto {
        filename: outcome.filename,
        copied_to: outcome.copied_to.map(|p| p.parent().map(|d| d.display().to_string()).unwrap_or_default()),
        copy_error: outcome.copy_error,
    })
}

/// The second folder every backup is also copied to, if one is set.
#[tauri::command]
pub fn get_backup_copy_dir(state: tauri::State<AppStateHandle>) -> Result<Option<String>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.get_backup_copy_dir().map_err(|e| e.to_string())
}

/// Sets (or clears, with `None`) the second backup folder. A folder is
/// checked before it's saved — usable, writable, not the primary backups
/// folder — and the newest existing backup is copied into it straight away,
/// so "it works" is shown rather than promised. Returns a sentence for the
/// user.
#[tauri::command]
pub fn set_backup_copy_dir(
    dir: Option<String>,
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
) -> Result<String, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let dir = dir.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
    let Some(dir) = dir else {
        state.store.set_backup_copy_dir(None).map_err(|e| e.to_string())?;
        return Ok("Backups will no longer be copied to a second folder.".to_string());
    };

    let backups_dir = crate::backups::backups_dir_for(&current_db_path(&paths));
    let copy_dir = std::path::Path::new(&dir);
    crate::backups::check_copy_dir(&backups_dir, copy_dir)?;
    let newest = crate::backups::list_backups(&backups_dir)?.into_iter().next();
    let copied_now = match newest {
        Some(b) => {
            crate::backups::mirror_backup(&backups_dir, &b.filename, copy_dir)?;
            true
        }
        None => false,
    };
    state.store.set_backup_copy_dir(Some(&dir)).map_err(|e| e.to_string())?;
    Ok(if copied_now {
        format!("Every backup will also be copied to {dir}. The latest one is there now.")
    } else {
        format!("Every backup will also be copied to {dir}, starting with the next one.")
    })
}

/// Restores `filename` into a brand-new file (see `backups::restore_backup`
/// for why it's never written into the already-open live path), points
/// `config.json` at it, and swaps this session's live connection over to it
/// — same in-place hot-swap as `relocate_data_file`, and for the same
/// reason (see its doc comment).
#[tauri::command]
pub fn restore_backup(filename: String, paths: tauri::State<crate::config::AppPaths>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let live_db_path = current_db_path(&paths);
    let backups_dir = crate::backups::backups_dir_for(&live_db_path);
    let restored_path = crate::backups::restore_backup(&state.store, &backups_dir, &filename, &live_db_path)?;
    crate::config::write_db_location_config(&paths.config_path, &restored_path).map_err(|e| e.to_string())?;
    *state = AppState::open(&restored_path)?;
    // Same registry-sync reasoning as `relocate_data_file` — do this before
    // `restored_path` is moved into `paths.db_path` below.
    crate::profiles::update_active_db_path(&paths.config_path, &live_db_path, &restored_path)?;
    *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = restored_path;
    paths.bump_generation();
    Ok(())
}

#[derive(Serialize)]
pub struct ProfileDto {
    pub id: String,
    pub name: String,
    pub is_active: bool,
    pub icon_key: Option<String>,
}

#[tauri::command]
pub fn list_profiles(paths: tauri::State<crate::config::AppPaths>) -> Vec<ProfileDto> {
    crate::profiles::list_profiles(&paths.config_path, &current_db_path(&paths))
        .into_iter()
        .map(|p| ProfileDto {
            id: p.id,
            name: p.name,
            is_active: p.is_active,
            icon_key: p.icon_key,
        })
        .collect()
}

/// Sets (or clears, with `None`) a profile's icon — see
/// `profiles::set_profile_icon`.
#[tauri::command]
pub fn set_profile_icon(id: String, icon_key: Option<String>, paths: tauri::State<crate::config::AppPaths>) -> Result<(), String> {
    crate::profiles::set_profile_icon(&paths.config_path, &current_db_path(&paths), &id, icon_key.as_deref())
}

/// Registers a brand-new, completely independent profile (its own
/// directory, its own `vaultspend.db`, its own isolated `backups/`
/// subfolder — see `profiles::create_profile`) and hot-swaps to it
/// immediately, same in-place mechanism as `relocate_data_file`/
/// `restore_backup` — creating a profile means "start using it now."
#[tauri::command]
pub fn create_profile(name: String, paths: tauri::State<crate::config::AppPaths>, state: tauri::State<AppStateHandle>) -> Result<String, String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let live_db_path = current_db_path(&paths);
    let profile = crate::profiles::create_profile(&paths.config_path, &live_db_path, &name, chrono::Local::now().naive_local())?;

    let profile_dir = profile.db_path.parent().ok_or_else(|| "invalid profile path".to_string())?;
    std::fs::create_dir_all(profile_dir).map_err(|e| e.to_string())?;
    // Config written before the live-state swap (matching
    // `relocate_data_file`/`restore_backup`) — if this fails, the app stays
    // live on the old profile instead of silently drifting out of sync with
    // `config.json`.
    crate::config::write_db_location_config(&paths.config_path, &profile.db_path).map_err(|e| e.to_string())?;
    *state = AppState::open(&profile.db_path)?;
    *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = profile.db_path.clone();
    paths.bump_generation();

    // Best-effort, matching `setup()`'s own treatment — a profile left
    // untouched for a long time and then switched into mid-session should
    // still get automatic backup coverage without waiting for a full
    // restart, but a failure here must never block using the app.
    let backups_dir = crate::backups::backups_dir_for(&profile.db_path);
    if let Err(e) = crate::backups::create_backup_if_due(&state.store, &backups_dir, chrono::Local::now().naive_local()) {
        eprintln!("automatic backup failed (continuing anyway): {e}");
    }

    Ok(profile.name)
}

/// Hot-swaps to an existing profile — same mechanism as `relocate_data_file`
/// (minus the `backup_to` copy step: this points at an already-independent
/// file, there's nothing to copy). Refuses to open a profile whose file has
/// gone missing (moved, deleted, a disconnected drive) rather than letting
/// `Store::open` silently heal it into a blank database — see
/// `backups::verify_backup`'s doc comment for why that's a real risk in
/// this codebase, not a hypothetical one.
#[tauri::command]
pub fn switch_profile(id: String, paths: tauri::State<crate::config::AppPaths>, state: tauri::State<AppStateHandle>) -> Result<String, String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let live_db_path = current_db_path(&paths);
    let target = crate::profiles::list_profiles(&paths.config_path, &live_db_path)
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| "That profile no longer exists.".to_string())?;

    if !target.db_path.exists() {
        return Err(format!(
            "{}'s data file wasn't found at {} — was it moved, or is a removable drive disconnected?",
            target.name,
            target.db_path.display()
        ));
    }

    // Unlike `create_profile` (whose target is a file this app just
    // created, so opening it can't meaningfully fail), `target.db_path`
    // here is an existing file that could be corrupt — so it's opened
    // *before* config.json is touched. Config written first and this
    // failing would leave config.json pointed at a database this app
    // can't use while the live connection quietly stayed on the old
    // profile: the two would disagree about which profile is active, and
    // the next launch would try (and fail) to open the broken one.
    // Validating first means a bad target fails here with config.json,
    // the live connection, and `paths.db_path` all left untouched.
    let new_state = AppState::open(&target.db_path)?;
    crate::config::write_db_location_config(&paths.config_path, &target.db_path).map_err(|e| e.to_string())?;
    *state = new_state;
    *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = target.db_path.clone();
    paths.bump_generation();

    let backups_dir = crate::backups::backups_dir_for(&target.db_path);
    if let Err(e) = crate::backups::create_backup_if_due(&state.store, &backups_dir, chrono::Local::now().naive_local()) {
        eprintln!("automatic backup failed (continuing anyway): {e}");
    }

    Ok(target.name)
}

/// Adopts a database file the user picked from somewhere else on disk (a
/// copy brought over from another machine, an external drive, a synced
/// folder) as a new profile — the counterpart to `create_profile`, which
/// always starts one empty. Opens `db_path` *before* touching the registry
/// or the live connection, so a bad pick (wrong file type, a corrupt file)
/// fails with a clear error and leaves everything exactly as it was; only a
/// file that actually opens as a Vault Spend database gets registered and
/// hot-swapped to, same "creating/adding a profile means start using it
/// now" convention as `create_profile`. The file itself is never copied or
/// moved — it stays wherever the user pointed at it.
#[tauri::command]
pub fn add_existing_profile(
    name: String,
    db_path: String,
    paths: tauri::State<crate::config::AppPaths>,
    state: tauri::State<AppStateHandle>,
) -> Result<String, String> {
    let picked_path = std::path::PathBuf::from(&db_path);
    if !picked_path.exists() {
        return Err(format!("{} doesn't exist.", picked_path.display()));
    }
    // Checked *before* AppState::open, which runs schema migrations that
    // create any table found missing — by the time it succeeds, even an
    // empty or completely unrelated SQLite file would look identical to
    // real data. This inspects the file exactly as picked, so the wrong
    // file is rejected with a clear reason instead of silently adopted as
    // a blank profile. Not filename-based on purpose — see
    // `looks_like_a_vault_spend_database`'s own doc comment.
    budget_core::store::looks_like_a_vault_spend_database(&picked_path)?;
    let new_state = AppState::open(&picked_path).map_err(|e| format!("Couldn't open {} as a Vault Spend data file: {e}", picked_path.display()))?;

    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let live_db_path = current_db_path(&paths);
    let profile = crate::profiles::add_existing_profile(&paths.config_path, &live_db_path, &name, &picked_path, chrono::Local::now().naive_local())?;

    // Config written before the live-state swap — see `create_profile`'s
    // comment on the same ordering. `new_state` was already proven openable
    // above, so this reordering costs nothing: the swap itself can't fail.
    crate::config::write_db_location_config(&paths.config_path, &picked_path).map_err(|e| e.to_string())?;
    *state = new_state;
    *paths.db_path.lock().map_err(|_| "db path poisoned".to_string())? = picked_path.clone();
    paths.bump_generation();

    // Best-effort, matching `create_profile`'s/`switch_profile`'s own
    // treatment — a file that hasn't been backed up in a while should still
    // get automatic coverage right away, but this must never block using
    // the app.
    let backups_dir = crate::backups::backups_dir_for(&picked_path);
    if let Err(e) = crate::backups::create_backup_if_due(&state.store, &backups_dir, chrono::Local::now().naive_local()) {
        eprintln!("automatic backup failed (continuing anyway): {e}");
    }

    Ok(profile.name)
}

#[tauri::command]
pub fn rename_profile(id: String, new_name: String, paths: tauri::State<crate::config::AppPaths>) -> Result<(), String> {
    crate::profiles::rename_profile(&paths.config_path, &current_db_path(&paths), &id, &new_name)
}

/// Registry-only — the profile's own file is left on disk untouched (same
/// "old file left in place" philosophy as `relocate_data_file`). Refuses to
/// delete whichever profile is currently active — see
/// `profiles::delete_profile`.
#[tauri::command]
pub fn delete_profile(id: String, paths: tauri::State<crate::config::AppPaths>) -> Result<(), String> {
    crate::profiles::delete_profile(&paths.config_path, &current_db_path(&paths), &id)
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(content.as_bytes());
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Downloads a GitHub release asset (`UpdateBanner.tsx`'s "Update now") to
/// the OS temp directory and returns its local path — the frontend then
/// hands that path to `openPath` (tauri-plugin-opener) to launch the OS's
/// normal installer, so the user still gets the usual installer prompts
/// rather than anything silently self-installing.
#[tauri::command]
pub async fn download_update_asset(url: String, filename: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let path = crate::updater::download_asset(&client, &url, &filename).await?;
    Ok(path.to_string_lossy().to_string())
}

fn parse_amount(amount: &str) -> Result<Decimal, String> {
    amount.parse().map_err(|_| format!("invalid amount: {amount}"))
}

fn parse_date(date: &str) -> Result<chrono::NaiveDate, String> {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| format!("invalid date: {date}"))
}

/// Everything the app needs across command calls. The classifier isn't
/// kept here — it's cheap to retrain from `store.labeled_history()` on
/// demand (see `classifier.rs`), so keeping a stale copy around would just
/// be a bug waiting to happen.
pub struct AppState {
    pub store: Store,
    pub rules: RuleSet,
}

pub type AppStateHandle = Mutex<AppState>;

impl AppState {
    pub fn open(db_path: impl AsRef<std::path::Path>) -> Result<Self, String> {
        let store = Store::open(db_path).map_err(|e| e.to_string())?;
        // The starter rules are persisted once (see
        // `Store::seed_default_rules_once`) rather than faked in memory
        // whenever the table is empty, so the rules manager can show and
        // delete every one of them and "delete them all" sticks.
        store.seed_default_rules_once().map_err(|e| e.to_string())?;
        let rules = store.load_rules().map_err(|e| e.to_string())?;
        Ok(AppState { store, rules })
    }
}

#[derive(Serialize)]
pub struct TransactionDto {
    pub id: i64,
    /// The other leg's id when this is one half of a linked transfer.
    pub transfer_counterpart_id: Option<i64>,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub category: Option<String>,
    pub category_source: Option<String>,
    pub confidence: Option<f64>,
    pub account_id: i64,
    pub account_name: String,
    pub applied_to_debt: Option<AppliedDebtPaymentDto>,
    pub principal_amount: Option<String>,
    pub split_count: i64,
    pub tags: Vec<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
}

#[derive(Serialize)]
pub struct AppliedDebtPaymentDto {
    pub debt_account_id: i64,
    pub debt_account_name: String,
    pub amount: String,
}

#[derive(Serialize)]
pub struct TransactionSplitDto {
    pub id: i64,
    pub category: Option<String>,
    pub amount: String,
    pub note: Option<String>,
}

#[derive(Serialize)]
pub struct AccountDto {
    pub id: i64,
    pub name: String,
    pub account_type: String,
    pub starting_balance: String,
    pub current_balance: String,
    pub institution: Option<String>,
    pub mask: Option<String>,
    pub interest_rate: Option<String>,
    pub excluded_from_debt_payoff: bool,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    /// A transaction dated on or before this can't move `current_balance`
    /// (see `StoredAccount::checkpoint_date`) — `None` if the account has
    /// never had a monthly rollover or manual balance correction.
    pub checkpoint_date: Option<String>,
    /// An explicit icon override (see `StoredAccount::icon_key`) — `None`
    /// means "keep guessing an icon from `account_type`."
    pub icon_key: Option<String>,
}

#[derive(Serialize)]
pub struct CategoryDto {
    pub name: String,
    pub icon_key: Option<String>,
}

#[derive(Serialize)]
pub struct FamilyMemberDto {
    pub id: i64,
    pub name: String,
}

#[derive(Serialize)]
pub struct ImportSummary {
    pub inserted: usize,
    pub row_errors: usize,
    /// The new transactions' ids, so the app can open its review inbox on exactly them.
    pub inserted_ids: Vec<i64>,
}

/// One parsed CSV row awaiting the user's review — every row is shown, not
/// just duplicates, so the user can pick which to include and which
/// account each belongs to before anything is written.
#[derive(Serialize)]
pub struct ImportRow {
    pub index: usize,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub is_duplicate: bool,
    /// The row's own Account column, when the source file has one (this
    /// app's own Transactions CSV export does; a real bank export never does) —
    /// `commit_import` routes the row there by default (creating that
    /// account if it doesn't exist yet) unless the user picks a different
    /// one for it on the review screen.
    pub account_name: Option<String>,
}

#[derive(Serialize)]
pub struct ImportPreview {
    pub rows: Vec<ImportRow>,
    pub row_errors: usize,
}

#[derive(Serialize)]
pub struct BucketDto {
    pub id: i64,
    pub name: String,
    pub target_amount: Option<String>,
    pub saved_amount: String,
    pub target_date: Option<String>,
    pub account_id: Option<i64>,
    pub account_name: Option<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    pub sinking_amount: Option<String>,
    pub color: Option<String>,
    pub icon_key: Option<String>,
    /// Progress follows the linked account's balance — see `Store::list_buckets_as_of`.
    pub tracks_account: bool,
    /// Net dollars per month gained over the trailing 90 days.
    pub monthly_pace: String,
}

#[derive(Serialize)]
pub struct ReportBudgetLineDto {
    pub category: String,
    pub budget_group: String,
    pub budgeted: String,
    pub actual: String,
    pub cap_enabled: bool,
    /// Unspent budget carried in from earlier months (see `Store::monthly_budget_actuals`).
    pub rollover: String,
    pub rollover_enabled: bool,
}

#[derive(Serialize)]
pub struct ReportDto {
    pub total_saved: String,
    pub income_total: String,
    pub month_label: String,
    pub budget_actuals: Vec<ReportBudgetLineDto>,
}

#[derive(Serialize)]
pub struct HoldingDto {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub symbol: String,
    pub name: String,
    pub shares: String,
    pub price: String,
    pub cost_basis: String,
    pub asset_class: Option<String>,
    pub value: String,
    pub gain_loss: String,
    pub prev_close: Option<String>,
    pub day_gain_loss: Option<String>,
}

#[derive(Serialize)]
pub struct RecurringDto {
    pub id: i64,
    pub merchant: String,
    pub category: Option<String>,
    pub amount: String,
    pub cadence: String,
    pub anchor_date: String,
    pub next_date: String,
    pub account_id: Option<i64>,
    pub account_name: Option<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    pub status: String,
}

#[derive(Serialize)]
pub struct RecurringTotalsDto {
    pub monthly_expense: String,
    pub monthly_income: String,
    pub annual_expense: String,
    pub annual_income: String,
}

#[derive(Serialize)]
pub struct RecurringCandidateDto {
    pub merchant: String,
    pub category: Option<String>,
    pub amount: String,
    pub cadence: String,
    pub anchor_date: String,
    pub occurrence_count: usize,
}

#[derive(Serialize)]
pub struct Stats {
    pub total: usize,
    pub auto_categorized: usize,
    pub user_confirmed: usize,
    pub uncategorized: usize,
}

fn build_classifier(state: &AppState) -> Result<Classifier, String> {
    let history = state.store.labeled_history().map_err(|e| e.to_string())?;
    let examples: Vec<(&str, &str)> = history.iter().map(|(d, c)| (d.as_str(), c.as_str())).collect();
    Ok(Classifier::train(&examples))
}

/// Runs the categorizer over every transaction that doesn't have a category
/// yet, persisting whatever it decides. Shared by import and by anything
/// else that adds uncategorized rows.
/// Returns the ids of every row it actually assigned a category to, so
/// callers that need to show the user exactly what changed (see
/// `recategorize_uncategorized`) don't have to separately diff the transactions.
fn categorize_uncategorized(state: &mut AppState) -> Result<Vec<i64>, String> {
    let classifier = build_classifier(state)?;
    let all = state.store.all_transactions().map_err(|e| e.to_string())?;
    let mut categorized_ids = Vec::new();
    for stored in all {
        if stored.transaction.category.is_some() {
            continue;
        }
        if let Some((category, source, confidence)) = categorizer::categorize(&stored.transaction.description, &state.rules, Some(&classifier)) {
            state
                .store
                .set_category(stored.id, &category, source, confidence)
                .map_err(|e| e.to_string())?;
            categorized_ids.push(stored.id);
        }
    }
    Ok(categorized_ids)
}

/// Re-runs categorization over whatever's still Uncategorized right now —
/// the manual "try again" for the Transactions tab's "Categorize uncategorized"
/// button, using whatever rules/classifier training exist at this moment
/// (which may have improved since these rows were first imported, e.g.
/// after the user has corrected enough similar transactions by hand).
/// Returns the ids of the rows it categorized, so the UI can show the user
/// exactly those rows to review and correct.
#[tauri::command]
pub fn recategorize_uncategorized(state: tauri::State<AppStateHandle>) -> Result<Vec<i64>, String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    categorize_uncategorized(&mut state)
}

/// Parses the file and flags which rows already exist in whichever account
/// each row will actually land in — every row is returned, not just
/// duplicates, so the review screen can show the whole import and let the
/// user decide, row by row, what to include and which account it actually
/// belongs to.
///
/// Each row's account is resolved the same way `commit_import` resolves it
/// (its own Account column, looked up by name — read-only here, via
/// `find_account_by_name`, since a preview must never create an account as
/// a side effect — else `account_id`, the one picked before the file was
/// chosen) *before* checking duplicates, so a row destined for account B
/// is checked against B's own history, not whatever `account_id` happens
/// to be. Checking every row against a single fixed account regardless of
/// its file-specified destination previously meant a genuine duplicate in
/// a different account came back `is_duplicate: false` here — silently
/// contradicting what committing that same row actually does.
#[tauri::command]
pub fn preview_import(path: String, invert_amounts: bool, account_id: i64, state: tauri::State<AppStateHandle>) -> Result<ImportPreview, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;

    let loaded = importer::load_transactions(&path, invert_amounts).map_err(|e| e.to_string())?;
    let row_errors = loaded.errors.len();

    let mut resolved_accounts = Vec::with_capacity(loaded.transactions.len());
    for index in 0..loaded.transactions.len() {
        let resolved = match loaded.account_names.get(index).and_then(|o| o.as_deref()) {
            Some(name) => state.store.find_account_by_name(name).map_err(|e| e.to_string())?.unwrap_or(account_id),
            None => account_id,
        };
        resolved_accounts.push(resolved);
    }

    let mut flags = vec![false; loaded.transactions.len()];
    let mut by_account: std::collections::HashMap<i64, Vec<usize>> = std::collections::HashMap::new();
    for (index, &acct) in resolved_accounts.iter().enumerate() {
        by_account.entry(acct).or_default().push(index);
    }
    for (acct, indices) in by_account {
        let group_txns: Vec<_> = indices.iter().map(|&i| loaded.transactions[i].clone()).collect();
        let group_flags = state.store.check_duplicates(acct, &group_txns).map_err(|e| e.to_string())?;
        for (i, flag) in indices.into_iter().zip(group_flags) {
            flags[i] = flag;
        }
    }

    let rows = loaded
        .transactions
        .iter()
        .zip(flags.iter())
        .enumerate()
        .map(|(index, (tx, is_duplicate))| ImportRow {
            index,
            date: tx.date.to_string(),
            description: tx.description.clone(),
            amount: tx.amount.to_string(),
            is_duplicate: *is_duplicate,
            account_name: loaded.account_names.get(index).cloned().flatten(),
        })
        .collect();

    Ok(ImportPreview { rows, row_errors })
}

/// Inserts exactly the rows the user chose to keep on the review screen.
/// Each row's account is: whatever the user explicitly picked for it on
/// the review screen, if anything; else the row's own Account column from
/// the file, resolved by name — case-insensitively, auto-creating a new
/// account if nothing matches, same as picking a never-before-seen name
/// when creating one by hand — so a full multi-account Transactions export
/// re-imports into the right accounts with zero manual setup; else
/// `default_account_id` (the one picked before the file was chosen), for
/// a real bank export with no Account column at all. Tags parsed from the
/// file are attached after insert, once each row has a real id. Unlike
/// the old preview-time duplicate check, nothing here re-decides what
/// counts as a duplicate — the user already made that call by checking or
/// unchecking each row.
#[tauri::command]
pub fn commit_import(
    path: String,
    invert_amounts: bool,
    default_account_id: i64,
    included_indices: Vec<usize>,
    account_overrides: std::collections::HashMap<usize, i64>,
    state: tauri::State<AppStateHandle>,
) -> Result<ImportSummary, String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;

    let loaded = importer::load_transactions(&path, invert_amounts).map_err(|e| e.to_string())?;
    let row_errors = loaded.errors.len();

    let included: std::collections::HashSet<usize> = included_indices.into_iter().collect();
    let mut by_account: std::collections::HashMap<i64, Vec<(budget_core::models::Transaction, Vec<String>)>> = std::collections::HashMap::new();
    for (index, tx) in loaded.transactions.into_iter().enumerate() {
        if !included.contains(&index) {
            continue;
        }
        let account_id = if let Some(explicit) = account_overrides.get(&index).copied() {
            explicit
        } else if let Some(name) = loaded.account_names.get(index).and_then(|o| o.as_deref()) {
            state
                .store
                .get_or_create_account(name, AccountType::Checking)
                .map_err(|e| e.to_string())?
        } else {
            default_account_id
        };
        let tags = loaded.tags.get(index).cloned().unwrap_or_default();
        by_account.entry(account_id).or_default().push((tx, tags));
    }

    let mut inserted = 0;
    let mut inserted_ids: Vec<i64> = Vec::new();
    for (account_id, rows) in by_account {
        let (txns, tags_per_row): (Vec<_>, Vec<_>) = rows.into_iter().unzip();
        let ids = state.store.save_transactions_with_ids(account_id, &txns).map_err(|e| e.to_string())?;
        inserted += ids.len();
        inserted_ids.extend(ids.iter().copied());
        for (id, tags) in ids.into_iter().zip(tags_per_row) {
            for tag in tags {
                state.store.add_tag(id, &tag).map_err(|e| e.to_string())?;
            }
        }
    }

    categorize_uncategorized(&mut state)?;

    Ok(ImportSummary {
        inserted,
        row_errors,
        inserted_ids,
    })
}

/// Adds one transaction directly, without a file import — the Transactions
/// tab's "Add transaction…" form. Uses `Store::create_transaction` (which reuses
/// `save_transactions`' own insert path), so fingerprinting and the
/// account's default-member assignment stay identical to an imported row.
/// Leaving `category` empty runs it through the same
/// `categorize_uncategorized` pass `commit_import` already uses above, so
/// an un-categorized manual entry gets auto-categorized the same way an
/// imported row would; passing one skips that guesswork entirely.
#[tauri::command]
pub fn create_manual_transaction(
    account_id: i64,
    date: String,
    description: String,
    amount: String,
    category: Option<String>,
    member_id: Option<i64>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let date = parse_date(&date)?;
    let amount = parse_amount(&amount)?;
    let category = category.filter(|c| !c.trim().is_empty());
    let has_category = category.is_some();
    let tx = budget_core::models::Transaction {
        date,
        description: description.trim().to_string(),
        amount,
        category,
    };
    let id = state.store.create_transaction(account_id, &tx).map_err(|e| e.to_string())?;
    if !has_category {
        categorize_uncategorized(&mut state)?;
    }
    if let Some(member_id) = member_id {
        state.store.set_transaction_member(id, Some(member_id)).map_err(|e| e.to_string())?;
    }
    Ok(id)
}

#[derive(Serialize)]
pub struct SetupAccountRowDto {
    pub index: usize,
    pub name: String,
    pub account_type: String,
    pub starting_balance: Option<String>,
    pub institution: Option<String>,
    pub mask: Option<String>,
    pub already_exists: bool,
}

#[derive(Serialize)]
pub struct SetupCategoryRowDto {
    pub index: usize,
    pub name: String,
    pub already_exists: bool,
}

#[derive(Serialize)]
pub struct SetupBudgetRowDto {
    pub index: usize,
    pub category: String,
    pub budget_group: String,
    pub monthly_amount: String,
    pub period: Option<String>,
    pub will_update: bool,
}

#[derive(Serialize)]
pub struct SetupBucketRowDto {
    pub index: usize,
    pub name: String,
    pub target_amount: Option<String>,
    pub target_date: Option<String>,
    pub linked_account_name: Option<String>,
    pub already_exists: bool,
}

#[derive(Serialize)]
pub struct SetupHoldingRowDto {
    pub index: usize,
    pub account_name: String,
    pub symbol: String,
    pub name: Option<String>,
    pub shares: String,
    pub price: String,
    pub cost_basis: String,
    pub asset_class: Option<String>,
    /// Unlike every other section's `already_exists` (a name-uniqueness
    /// check), this flags whether `account_name` actually resolves — a
    /// holding row is dropped entirely when it doesn't (see
    /// `Store::apply_setup_import`), so the review screen can catch a
    /// typo'd account name before committing rather than only reporting it
    /// afterward in the skipped-rows summary.
    pub account_found: bool,
}

#[derive(Serialize)]
pub struct SetupImportPreviewDto {
    pub accounts: Vec<SetupAccountRowDto>,
    pub categories: Vec<SetupCategoryRowDto>,
    pub budgets: Vec<SetupBudgetRowDto>,
    pub buckets: Vec<SetupBucketRowDto>,
    pub holdings: Vec<SetupHoldingRowDto>,
    pub row_errors: usize,
}

#[derive(Serialize)]
pub struct SetupImportSummaryDto {
    pub accounts_created: usize,
    pub categories_created: usize,
    pub budgets_set: usize,
    pub buckets_created: usize,
    pub holdings_created: usize,
    pub skipped: Vec<String>,
    pub row_errors: usize,
}

fn current_month_key() -> String {
    use chrono::Datelike;
    let today = chrono::Local::now().date_naive();
    format!("{:04}-{:02}", today.year(), today.month())
}

/// Parses the setup template and flags what already exists — a pure read,
/// so the review screen can show what an import would do before anything
/// is written. Same convention as `preview_import`'s duplicate flags.
#[tauri::command]
pub fn preview_setup_import(path: String, state: tauri::State<AppStateHandle>) -> Result<SetupImportPreviewDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let data = budget_core::setup_import::load_setup_csv(&path).map_err(|e| e.to_string())?;

    let today = chrono::Local::now().date_naive();
    let existing_accounts = state.store.list_accounts(today).map_err(|e| e.to_string())?;
    let existing_categories = state.store.list_categories().map_err(|e| e.to_string())?;
    let existing_buckets = state.store.list_buckets().map_err(|e| e.to_string())?;
    let default_period = current_month_key();

    let accounts = data
        .accounts
        .iter()
        .enumerate()
        .map(|(index, row)| SetupAccountRowDto {
            index,
            name: row.name.clone(),
            account_type: row.account_type.clone(),
            starting_balance: row.starting_balance.map(|a| a.to_string()),
            institution: row.institution.clone(),
            mask: row.mask.clone(),
            already_exists: existing_accounts.iter().any(|a| a.account.name.eq_ignore_ascii_case(&row.name)),
        })
        .collect();

    let categories = data
        .categories
        .iter()
        .enumerate()
        .map(|(index, row)| SetupCategoryRowDto {
            index,
            name: row.name.clone(),
            already_exists: existing_categories.iter().any(|c| c.eq_ignore_ascii_case(&row.name)),
        })
        .collect();

    let mut budgets = Vec::with_capacity(data.budgets.len());
    for (index, row) in data.budgets.iter().enumerate() {
        let period = row.period.clone().unwrap_or_else(|| default_period.clone());
        let existing_lines = state.store.list_budgets(&period).map_err(|e| e.to_string())?;
        budgets.push(SetupBudgetRowDto {
            index,
            category: row.category.clone(),
            budget_group: row.budget_group.clone(),
            monthly_amount: row.monthly_amount.to_string(),
            period: row.period.clone(),
            will_update: existing_lines.iter().any(|b| b.category.eq_ignore_ascii_case(&row.category)),
        });
    }

    let buckets = data
        .buckets
        .iter()
        .enumerate()
        .map(|(index, row)| SetupBucketRowDto {
            index,
            name: row.name.clone(),
            target_amount: row.target_amount.map(|a| a.to_string()),
            target_date: row.target_date.map(|d| d.to_string()),
            linked_account_name: row.linked_account_name.clone(),
            already_exists: existing_buckets.iter().any(|b| b.name.eq_ignore_ascii_case(&row.name)),
        })
        .collect();

    let holdings = data
        .holdings
        .iter()
        .enumerate()
        .map(|(index, row)| SetupHoldingRowDto {
            index,
            account_name: row.account_name.clone(),
            symbol: row.symbol.clone(),
            name: row.name.clone(),
            shares: row.shares.to_string(),
            price: row.price.to_string(),
            cost_basis: row.cost_basis.to_string(),
            asset_class: row.asset_class.clone(),
            account_found: existing_accounts.iter().any(|a| a.account.name.eq_ignore_ascii_case(&row.account_name)),
        })
        .collect();

    Ok(SetupImportPreviewDto {
        accounts,
        categories,
        budgets,
        buckets,
        holdings,
        row_errors: data.errors.len(),
    })
}

/// Applies exactly the rows the user kept checked on the review screen —
/// re-parsing the file rather than trusting client-echoed row data back,
/// same reasoning as `commit_import`.
#[tauri::command]
pub fn commit_setup_import(
    path: String,
    included_accounts: Vec<usize>,
    included_categories: Vec<usize>,
    included_budgets: Vec<usize>,
    included_buckets: Vec<usize>,
    included_holdings: Vec<usize>,
    state: tauri::State<AppStateHandle>,
) -> Result<SetupImportSummaryDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let mut data = budget_core::setup_import::load_setup_csv(&path).map_err(|e| e.to_string())?;
    let row_errors = data.errors.len();

    fn keep<T>(rows: Vec<T>, included: &[usize]) -> Vec<T> {
        let included: std::collections::HashSet<usize> = included.iter().copied().collect();
        rows.into_iter()
            .enumerate()
            .filter(|(i, _)| included.contains(i))
            .map(|(_, row)| row)
            .collect()
    }
    data.accounts = keep(data.accounts, &included_accounts);
    data.categories = keep(data.categories, &included_categories);
    data.budgets = keep(data.budgets, &included_budgets);
    data.buckets = keep(data.buckets, &included_buckets);
    data.holdings = keep(data.holdings, &included_holdings);

    let outcome = state.store.apply_setup_import(&data, &current_month_key()).map_err(|e| e.to_string())?;

    Ok(SetupImportSummaryDto {
        accounts_created: outcome.accounts_created,
        categories_created: outcome.categories_created,
        budgets_set: outcome.budgets_set,
        buckets_created: outcome.buckets_created,
        holdings_created: outcome.holdings_created,
        skipped: outcome.skipped,
        row_errors,
    })
}

#[tauri::command]
pub fn create_account(
    name: String,
    account_type: String,
    starting_balance: Option<String>,
    institution: Option<String>,
    mask: Option<String>,
    icon_key: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let account_type = AccountType::parse(&account_type).unwrap_or(AccountType::Other);
    // Validated *before* the account is created — an invalid balance must
    // fail cleanly with nothing written, not leave a zero-balance orphan
    // account behind because validation happened after the first write in
    // this sequence of otherwise-separate calls.
    let starting_balance = starting_balance.map(|b| parse_amount(&b)).transpose()?;
    let id = state.store.get_or_create_account(&name, account_type).map_err(|e| e.to_string())?;
    if let Some(balance) = starting_balance {
        state.store.set_account_starting_balance(id, balance).map_err(|e| e.to_string())?;
    }
    if institution.is_some() || mask.is_some() {
        state
            .store
            .set_account_details(id, institution.as_deref(), mask.as_deref())
            .map_err(|e| e.to_string())?;
    }
    if let Some(icon_key) = icon_key {
        state.store.set_account_icon(id, Some(&icon_key)).map_err(|e| e.to_string())?;
    }
    Ok(id)
}

#[tauri::command]
pub fn list_accounts(state: tauri::State<AppStateHandle>) -> Result<Vec<AccountDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let accounts = state.store.list_accounts(today).map_err(|e| e.to_string())?;

    Ok(accounts
        .into_iter()
        .map(|a| AccountDto {
            id: a.id,
            name: a.account.name,
            account_type: a.account.account_type.as_str().to_string(),
            starting_balance: a.starting_balance.to_string(),
            current_balance: a.current_balance.to_string(),
            institution: a.institution,
            mask: a.mask,
            interest_rate: a.interest_rate.map(|r| r.to_string()),
            excluded_from_debt_payoff: a.excluded_from_debt_payoff,
            member_id: a.member_id,
            member_name: a.member_name,
            checkpoint_date: a.checkpoint_date.map(|d| d.to_string()),
            icon_key: a.icon_key,
        })
        .collect())
}

#[tauri::command]
pub fn set_account_interest_rate(id: i64, rate: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let rate = rate.map(|r| parse_amount(&r)).transpose()?;
    state.store.set_account_interest_rate(id, rate).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_excluded_from_debt_payoff(id: i64, excluded: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_account_excluded_from_debt_payoff(id, excluded).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_details(id: i64, institution: Option<String>, mask: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state
        .store
        .set_account_details(id, institution.as_deref(), mask.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_starting_balance(id: i64, balance: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let balance = parse_amount(&balance)?;
    state.store.set_account_starting_balance(id, balance).map_err(|e| e.to_string())
}

/// Corrects an account's current balance as of today, without touching any
/// existing transaction — see `Store::set_account_balance_override`.
#[tauri::command]
pub fn set_account_balance_override(id: i64, balance: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let balance = parse_amount(&balance)?;
    let today = chrono::Local::now().date_naive();
    state.store.set_account_balance_override(id, balance, today).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_account_type(id: i64, account_type: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let account_type = AccountType::parse(&account_type).unwrap_or(AccountType::Other);
    state.store.update_account_type(id, account_type).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_icon(id: i64, icon_key: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_account_icon(id, icon_key.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_account(id: i64, state: tauri::State<AppStateHandle>) -> Result<usize, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_account(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_member(id: i64, member_id: Option<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_account_member(id, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_family_member(name: String, state: tauri::State<AppStateHandle>) -> Result<i64, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.create_family_member(&name).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("UNIQUE constraint failed") {
            format!("A family member named '{name}' already exists.")
        } else {
            msg
        }
    })
}

#[tauri::command]
pub fn list_family_members(state: tauri::State<AppStateHandle>) -> Result<Vec<FamilyMemberDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let members = state.store.list_family_members().map_err(|e| e.to_string())?;
    Ok(members.into_iter().map(|m| FamilyMemberDto { id: m.id, name: m.name }).collect())
}

#[tauri::command]
pub fn rename_family_member(id: i64, new_name: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.rename_family_member(id, &new_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_family_member(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_family_member(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_transactions(state: tauri::State<AppStateHandle>) -> Result<Vec<TransactionDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let stored = state.store.all_transactions().map_err(|e| e.to_string())?;

    Ok(stored
        .into_iter()
        .map(|s| TransactionDto {
            id: s.id,
            transfer_counterpart_id: s.transfer_counterpart_id,
            date: s.transaction.date.to_string(),
            description: s.transaction.description,
            amount: s.transaction.amount.to_string(),
            category: s.transaction.category,
            category_source: s.category_source.map(CategorySource::as_str).map(str::to_string),
            confidence: s.confidence,
            account_id: s.account_id,
            account_name: s.account_name,
            applied_to_debt: s.applied_to_debt.map(|d| AppliedDebtPaymentDto {
                debt_account_id: d.debt_account_id,
                debt_account_name: d.debt_account_name,
                amount: d.amount.to_string(),
            }),
            principal_amount: s.principal_amount.map(|a| a.to_string()),
            split_count: s.split_count,
            tags: s.tags,
            member_id: s.member_id,
            member_name: s.member_name,
        })
        .collect())
}

#[derive(Serialize)]
pub struct TransferCandidateDto {
    pub out_id: i64,
    pub in_id: i64,
}

/// Pairs of transactions that look like the two legs of one transfer
/// between the user's own accounts (equal amounts, opposite directions,
/// different accounts, within 3 days) and aren't linked yet.
#[tauri::command]
pub fn list_transfer_candidates(state: tauri::State<AppStateHandle>) -> Result<Vec<TransferCandidateDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let candidates = state.store.transfer_candidates().map_err(|e| e.to_string())?;
    Ok(candidates
        .into_iter()
        .map(|c| TransferCandidateDto {
            out_id: c.out_id,
            in_id: c.in_id,
        })
        .collect())
}

/// Links two transactions as the two legs of one transfer, so neither
/// counts as income or spending.
#[tauri::command]
pub fn link_transfer(a: i64, b: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    if state.store.link_transfer(a, b).map_err(|e| e.to_string())? {
        Ok(())
    } else {
        Err("Those two transactions can't be linked as a transfer — they need to be in different accounts, one going out and one coming in, and neither already linked.".to_string())
    }
}

/// Undoes a link, from either leg — both transactions count as ordinary
/// income/spending again.
#[tauri::command]
pub fn unlink_transfer(transaction_id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.unlink_transfer(transaction_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_tag(transaction_id: i64, tag: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.add_tag(transaction_id, &tag).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_tag(transaction_id: i64, tag: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.remove_tag(transaction_id, &tag).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_all_tags(state: tauri::State<AppStateHandle>) -> Result<Vec<String>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.list_all_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_transaction_member(id: i64, member_id: Option<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_transaction_member(id, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn bulk_set_transaction_member(ids: Vec<i64>, member_id: Option<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.bulk_set_transaction_member(&ids, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_transaction_splits(transaction_id: i64, state: tauri::State<AppStateHandle>) -> Result<Vec<TransactionSplitDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let splits = state.store.list_transaction_splits(transaction_id).map_err(|e| e.to_string())?;
    Ok(splits
        .into_iter()
        .map(|s| TransactionSplitDto {
            id: s.id,
            category: s.category,
            amount: s.amount.to_string(),
            note: s.note,
        })
        .collect())
}

#[tauri::command]
pub fn set_transaction_splits(
    transaction_id: i64,
    splits: Vec<(String, String, Option<String>)>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let splits = splits
        .into_iter()
        .map(|(category, amount, note)| Ok((category, parse_amount(&amount)?, note)))
        .collect::<Result<Vec<_>, String>>()?;
    state.store.set_transaction_splits(transaction_id, &splits).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn correct_category(id: i64, category: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;

    let description = state
        .store
        .all_transactions()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|t| t.id == id)
        .map(|t| t.transaction.description)
        .ok_or_else(|| format!("no transaction with id {id}"))?;

    state
        .store
        .set_category(id, &category, CategorySource::User, None)
        .map_err(|e| e.to_string())?;

    // teach the rule engine — and persist the rule so it survives a restart
    learner::learn_from_correction(&mut state.rules, &description, &category);
    state.store.upsert_rule(description.trim(), &category).map_err(|e| e.to_string())?;

    Ok(())
}

/// Same as `correct_category`, applied to every id in one call — used by
/// the Transactions tab's multi-select bulk-edit action so N selected rows cost one
/// round trip instead of N. Each transaction still teaches the rule
/// learner from its own description, same as if you'd corrected it one
/// at a time; an id that no longer exists is skipped rather than erroring,
/// same "harmless no-op" convention as the rest of this file.
#[tauri::command]
pub fn bulk_correct_category(ids: Vec<i64>, category: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;

    let transactions = state.store.all_transactions().map_err(|e| e.to_string())?;
    for id in ids {
        let Some(description) = transactions.iter().find(|t| t.id == id).map(|t| t.transaction.description.clone()) else {
            continue;
        };

        state
            .store
            .set_category(id, &category, CategorySource::User, None)
            .map_err(|e| e.to_string())?;

        learner::learn_from_correction(&mut state.rules, &description, &category);
        state.store.upsert_rule(description.trim(), &category).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Same as `delete_transaction`, applied to every id in one call — used by
/// the Transactions tab's multi-select bulk-delete action. Echoes `ids` back on
/// success so the frontend's undo toast can call `restore_transactions`
/// with exactly what was deleted, without tracking that set itself.
#[tauri::command]
pub fn bulk_delete_transactions(ids: Vec<i64>, state: tauri::State<AppStateHandle>) -> Result<Vec<i64>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let now = chrono::Local::now().naive_local();
    for &id in &ids {
        state.store.delete_transaction(id, now).map_err(|e| e.to_string())?;
    }
    Ok(ids)
}

/// Seeds a recurring item from each selected transaction — merchant,
/// category, amount, and account carried over as-is from the transaction
/// itself, `cadence` applied to every one (the Transactions tab's bulk-actions bar
/// offers a single cadence picker for the whole selection, same as its
/// "Set category to…" applies one category to every selected row). The
/// transaction's own date becomes the recurring item's anchor date —
/// `next_occurrence` walks forward from it to compute the actual next-due
/// date regardless of how far in the past it is. An id that no longer
/// matches any transaction is skipped rather than failing the whole batch.
/// Returns how many were created, for the confirmation message.
#[tauri::command]
pub fn bulk_create_recurring_from_transactions(ids: Vec<i64>, cadence: String, state: tauri::State<AppStateHandle>) -> Result<usize, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let transactions = state.store.all_transactions().map_err(|e| e.to_string())?;

    let mut created = 0;
    for id in ids {
        let Some(t) = transactions.iter().find(|t| t.id == id) else {
            continue;
        };
        state
            .store
            .create_recurring(
                &t.transaction.description,
                t.transaction.category.as_deref(),
                t.transaction.amount,
                &cadence,
                t.transaction.date,
                Some(t.account_id),
            )
            .map_err(|e| e.to_string())?;
        created += 1;
    }
    Ok(created)
}

/// Re-reads persisted rules into `state.rules` — needed after any command
/// that edits the `rules` table directly in the store (rename/delete
/// category), so the in-memory rule set categorization actually uses stays
/// in sync without requiring an app restart.
fn reload_rules(state: &mut AppState) -> Result<(), String> {
    state.rules = state.store.load_rules().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct RuleDto {
    pub pattern: String,
    pub category: String,
    pub match_count: usize,
}

#[derive(Serialize)]
pub struct RulePreviewDto {
    pub matching: usize,
    pub would_change: usize,
}

/// Every categorization rule (built-in and learned alike) with how many
/// transactions its pattern touches — Settings' rules manager list.
#[tauri::command]
pub fn list_rules(state: tauri::State<AppStateHandle>) -> Result<Vec<RuleDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let rules = state.store.list_rules().map_err(|e| e.to_string())?;
    Ok(rules
        .into_iter()
        .map(|r| RuleDto {
            pattern: r.pattern,
            category: r.category,
            match_count: r.match_count,
        })
        .collect())
}

/// What saving this rule would do to transactions already on the books,
/// without saving anything. `replacing` is the pattern of the rule being
/// edited, if any.
#[tauri::command]
pub fn preview_rule(
    pattern: String,
    category: String,
    replacing: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<RulePreviewDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let preview = state
        .store
        .preview_rule(&pattern, &category, replacing.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(RulePreviewDto {
        matching: preview.matching,
        would_change: preview.would_change,
    })
}

/// Creates a rule, or edits one (`replacing` = the old pattern). With
/// `apply_to_existing`, also re-categorizes the transactions
/// `preview_rule` counted. Returns how many were re-categorized.
#[tauri::command]
pub fn save_rule(
    pattern: String,
    category: String,
    replacing: Option<String>,
    apply_to_existing: bool,
    state: tauri::State<AppStateHandle>,
) -> Result<usize, String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let pattern = pattern.trim().to_string();
    let category = category.trim().to_string();
    if pattern.is_empty() {
        return Err("A rule needs some text to look for in a transaction's description.".to_string());
    }
    if category.is_empty() {
        return Err("Pick the category this rule should assign.".to_string());
    }

    state.store.create_category(&category, None).map_err(|e| e.to_string())?;
    match replacing.as_deref() {
        Some(old) => state.store.rename_rule(old, &pattern, &category),
        None => state.store.upsert_rule(&pattern, &category),
    }
    .map_err(|e| e.to_string())?;
    reload_rules(&mut state)?;

    if apply_to_existing {
        state.store.apply_rule_to_existing(&pattern, &category).map_err(|e| e.to_string())
    } else {
        Ok(0)
    }
}

/// Removes a rule. Transactions it already categorized keep their category.
#[tauri::command]
pub fn delete_rule(pattern: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_rule(&pattern).map_err(|e| e.to_string())?;
    reload_rules(&mut state)
}

#[tauri::command]
pub fn list_categories(state: tauri::State<AppStateHandle>) -> Result<Vec<String>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.list_categories().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_categories_with_icons(state: tauri::State<AppStateHandle>) -> Result<Vec<CategoryDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let categories = state.store.list_categories_with_icons().map_err(|e| e.to_string())?;
    Ok(categories
        .into_iter()
        .map(|c| CategoryDto {
            name: c.name,
            icon_key: c.icon_key,
        })
        .collect())
}

#[tauri::command]
pub fn create_category(name: String, icon_key: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.create_category(&name, icon_key.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_category_icon(name: String, icon_key: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_category_icon(&name, icon_key.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_category(old_name: String, new_name: String, state: tauri::State<AppStateHandle>) -> Result<usize, String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let affected = state.store.rename_category(&old_name, &new_name).map_err(|e| e.to_string())?;
    reload_rules(&mut state)?;
    Ok(affected)
}

#[tauri::command]
pub fn delete_category(name: String, state: tauri::State<AppStateHandle>) -> Result<usize, String> {
    let mut state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let affected = state.store.delete_category(&name).map_err(|e| e.to_string())?;
    reload_rules(&mut state)?;
    Ok(affected)
}

#[tauri::command]
pub fn update_transaction_amount(id: i64, amount: String, state: tauri::State<AppStateHandle>) -> Result<bool, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let amount = parse_amount(&amount)?;
    state.store.update_transaction_amount(id, amount).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_transaction_principal_amount(id: i64, principal_amount: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let principal_amount = principal_amount.map(|a| parse_amount(&a)).transpose()?;
    state
        .store
        .update_transaction_principal_amount(id, principal_amount)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_transaction_account(id: i64, account_id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.update_transaction_account(id, account_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_transaction_date(id: i64, date: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let date = parse_date(&date)?;
    state.store.update_transaction_date(id, date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_transaction_description(id: i64, description: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    if description.trim().is_empty() {
        return Err("Description can't be empty.".to_string());
    }
    state
        .store
        .update_transaction_description(id, description.trim())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_transaction(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let now = chrono::Local::now().naive_local();
    state.store.delete_transaction(id, now).map_err(|e| e.to_string())
}

/// Undoes `delete_transaction`/`bulk_delete_transactions` — the Transactions
/// tab's bulk-delete "Undo" toast calls this with exactly the ids it was told
/// were deleted.
#[tauri::command]
pub fn restore_transactions(ids: Vec<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.restore_transactions(&ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_debt_payment(
    source_transaction_id: i64,
    debt_account_id: i64,
    amount: String,
    date: String,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let amount = parse_amount(&amount)?;
    let date = parse_date(&date)?;
    state
        .store
        .apply_debt_payment(source_transaction_id, debt_account_id, amount, date)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unapply_debt_payment(source_transaction_id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.unapply_debt_payment(source_transaction_id).map_err(|e| e.to_string())
}

#[tauri::command]
// One independent optional field per `buckets` column, mirroring
// `Store::create_bucket` (see its own `#[allow]` for why this isn't
// bundled into a params struct).
#[allow(clippy::too_many_arguments)]
pub fn create_bucket(
    name: String,
    target_amount: Option<String>,
    target_date: Option<String>,
    account_id: Option<i64>,
    sinking_amount: Option<String>,
    color: Option<String>,
    icon_key: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let target_amount = target_amount.map(|a| parse_amount(&a)).transpose()?;
    let target_date = target_date.map(|d| parse_date(&d)).transpose()?;
    let sinking_amount = sinking_amount.map(|a| parse_amount(&a)).transpose()?;
    state
        .store
        .create_bucket(
            &name,
            target_amount,
            target_date,
            account_id,
            sinking_amount,
            color.as_deref(),
            icon_key.as_deref(),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_buckets(state: tauri::State<AppStateHandle>) -> Result<Vec<BucketDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let buckets = state.store.list_buckets_as_of(today).map_err(|e| e.to_string())?;
    Ok(buckets
        .into_iter()
        .map(|b| BucketDto {
            id: b.id,
            name: b.name,
            target_amount: b.target_amount.map(|a| a.to_string()),
            saved_amount: b.saved_amount.to_string(),
            target_date: b.target_date.map(|d| d.to_string()),
            account_id: b.account_id,
            account_name: b.account_name,
            member_id: b.member_id,
            member_name: b.member_name,
            sinking_amount: b.sinking_amount.map(|a| a.to_string()),
            color: b.color,
            icon_key: b.icon_key,
            tracks_account: b.tracks_account,
            monthly_pace: b.monthly_pace.to_string(),
        })
        .collect())
}

/// Turns "progress follows the linked account's balance" on or off for a
/// goal — see `Store::set_bucket_tracks_account`.
#[tauri::command]
pub fn set_bucket_tracks_account(id: i64, tracks_account: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_bucket_tracks_account(id, tracks_account).map_err(|e| e.to_string())
}

#[tauri::command]
// Same reasoning as `create_bucket` above.
#[allow(clippy::too_many_arguments)]
pub fn update_bucket_details(
    id: i64,
    target_amount: Option<String>,
    target_date: Option<String>,
    account_id: Option<i64>,
    sinking_amount: Option<String>,
    color: Option<String>,
    icon_key: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let target_amount = target_amount.map(|a| parse_amount(&a)).transpose()?;
    let target_date = target_date.map(|d| parse_date(&d)).transpose()?;
    let sinking_amount = sinking_amount.map(|a| parse_amount(&a)).transpose()?;
    state
        .store
        .update_bucket_details(
            id,
            target_amount,
            target_date,
            account_id,
            sinking_amount,
            color.as_deref(),
            icon_key.as_deref(),
        )
        .map_err(|e| e.to_string())
}

/// Auto-contributes each sinking-fund bucket's fixed monthly amount if this
/// is the first time it's happened this calendar month — see
/// `Store::apply_sinking_fund_contributions`. Safe to call on every app
/// launch, same convention as `check_monthly_rollover`.
#[tauri::command]
pub fn check_sinking_fund_contributions(state: tauri::State<AppStateHandle>) -> Result<Vec<SinkingFundContributionDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let applied = state.store.apply_sinking_fund_contributions(today).map_err(|e| e.to_string())?;
    Ok(applied
        .into_iter()
        .map(|(bucket_id, bucket_name, amount)| SinkingFundContributionDto {
            bucket_id,
            bucket_name,
            amount: amount.to_string(),
        })
        .collect())
}

#[derive(Serialize)]
pub struct SinkingFundContributionDto {
    pub bucket_id: i64,
    pub bucket_name: String,
    pub amount: String,
}

#[tauri::command]
pub fn set_bucket_member(id: i64, member_id: Option<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_bucket_member(id, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_bucket_contribution(
    bucket_id: i64,
    date: String,
    amount: String,
    note: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let date = parse_date(&date)?;
    let amount = parse_amount(&amount)?;
    state
        .store
        .add_bucket_contribution(bucket_id, date, amount, note.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_bucket(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_bucket(id).map_err(|e| e.to_string())
}

/// `period` ("YYYY-MM") scopes the change to that one month only — see
/// `Store::set_budget`. The frontend gets a category's budgeted amount
/// for a specific month from `budget_actuals_for_month`/`get_report`
/// (both already period-scoped), so there's no separate un-scoped
/// "list all budgets" command any more — that was the shape of the bug
/// this fixes (one global row per category shared by every month).
#[tauri::command]
pub fn set_budget(
    category: String,
    period: String,
    monthly_amount: String,
    budget_group: String,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let monthly_amount = parse_amount(&monthly_amount)?;
    state
        .store
        .set_budget(&category, &period, monthly_amount, &budget_group)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_budget(category: String, period: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_budget(&category, &period).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_report(state: tauri::State<AppStateHandle>) -> Result<ReportDto, String> {
    use chrono::Datelike;

    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let (year, month) = (today.year(), today.month());

    let total_saved = state.store.total_saved().map_err(|e| e.to_string())?;
    let income_total = state.store.income_total().map_err(|e| e.to_string())?;
    let budget_actuals = state
        .store
        .monthly_budget_actuals(year, month)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|a| ReportBudgetLineDto {
            category: a.category,
            budget_group: a.budget_group,
            budgeted: a.budgeted.to_string(),
            actual: a.actual.to_string(),
            cap_enabled: a.cap_enabled,
            rollover: a.rollover.to_string(),
            rollover_enabled: a.rollover_enabled,
        })
        .collect();

    Ok(ReportDto {
        total_saved: total_saved.to_string(),
        income_total: income_total.to_string(),
        month_label: today.format("%B %Y").to_string(),
        budget_actuals,
    })
}

/// Budget-vs-actual for an arbitrary month, for the Budget page's
/// prev/next month navigation — `get_report` above is deliberately
/// pinned to the current month for the Reports dashboard.
#[tauri::command]
pub fn budget_actuals_for_month(year: i32, month: u32, state: tauri::State<AppStateHandle>) -> Result<Vec<ReportBudgetLineDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let actuals = state.store.monthly_budget_actuals(year, month).map_err(|e| e.to_string())?;
    Ok(actuals
        .into_iter()
        .map(|a| ReportBudgetLineDto {
            category: a.category,
            budget_group: a.budget_group,
            budgeted: a.budgeted.to_string(),
            actual: a.actual.to_string(),
            cap_enabled: a.cap_enabled,
            rollover: a.rollover.to_string(),
            rollover_enabled: a.rollover_enabled,
        })
        .collect())
}

/// Opts a category's specific month in or out of carrying its unspent
/// budget forward — see `Store::set_budget_rollover`.
#[tauri::command]
pub fn set_budget_rollover(category: String, period: String, rollover_enabled: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state
        .store
        .set_budget_rollover(&category, &period, rollover_enabled)
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct MemberBudgetActualDto {
    pub category: String,
    pub budget_group: String,
    pub budgeted: String,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    pub actual: String,
}

/// Budget-vs-actual for one month, split by family member — see
/// `Store::monthly_budget_actuals_by_member`.
#[tauri::command]
pub fn monthly_budget_actuals_by_member(year: i32, month: u32, state: tauri::State<AppStateHandle>) -> Result<Vec<MemberBudgetActualDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let actuals = state.store.monthly_budget_actuals_by_member(year, month).map_err(|e| e.to_string())?;
    Ok(actuals
        .into_iter()
        .map(|a| MemberBudgetActualDto {
            category: a.category,
            budget_group: a.budget_group,
            budgeted: a.budgeted.to_string(),
            member_id: a.member_id,
            member_name: a.member_name,
            actual: a.actual.to_string(),
        })
        .collect())
}

/// Opts a category's specific month in or out of the stricter 90% warning
/// threshold — see `Store::set_budget_cap`.
#[tauri::command]
pub fn set_budget_cap(category: String, period: String, cap_enabled: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_budget_cap(&category, &period, cap_enabled).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct BudgetSuggestionDto {
    pub category: String,
    pub budget_group: String,
    pub current: Option<String>,
    pub suggested: String,
}

#[derive(Serialize)]
pub struct BudgetSuggestionsDto {
    pub months_used: u32,
    pub lines: Vec<BudgetSuggestionDto>,
}

/// The Budget page's "Suggest from my 3-month average" preview — see
/// `Store::suggest_budgets_from_average`. Read-only: nothing is saved until
/// the user applies rows through `set_budget`.
#[tauri::command]
pub fn suggest_budgets(year: i32, month: u32, state: tauri::State<AppStateHandle>) -> Result<BudgetSuggestionsDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let suggestions = state.store.suggest_budgets_from_average(year, month, 3).map_err(|e| e.to_string())?;
    Ok(BudgetSuggestionsDto {
        months_used: suggestions.months_used,
        lines: suggestions
            .lines
            .into_iter()
            .map(|l| BudgetSuggestionDto {
                category: l.category,
                budget_group: l.budget_group,
                current: l.current.map(|c| c.to_string()),
                suggested: l.suggested.to_string(),
            })
            .collect(),
    })
}

#[derive(Serialize)]
pub struct OverBudgetLineDto {
    pub category: String,
    pub budgeted: String,
    pub actual: String,
}

#[derive(Serialize)]
pub struct MonthReviewDto {
    pub year: i32,
    pub month: u32,
    pub income: String,
    pub expenses: String,
    pub prev_income: String,
    pub prev_expenses: String,
    pub over_budget: Vec<OverBudgetLineDto>,
    pub uncategorized_count: usize,
    pub uncategorized_total: String,
    pub reviewed: bool,
}

/// Everything the month-end review shows for one month — see
/// `Store::month_review`.
#[tauri::command]
pub fn month_review(year: i32, month: u32, state: tauri::State<AppStateHandle>) -> Result<MonthReviewDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let r = state.store.month_review(year, month).map_err(|e| e.to_string())?;
    Ok(MonthReviewDto {
        year: r.year,
        month: r.month,
        income: r.income.to_string(),
        expenses: r.expenses.to_string(),
        prev_income: r.prev_income.to_string(),
        prev_expenses: r.prev_expenses.to_string(),
        over_budget: r
            .over_budget
            .into_iter()
            .map(|l| OverBudgetLineDto {
                category: l.category,
                budgeted: l.budgeted.to_string(),
                actual: l.actual.to_string(),
            })
            .collect(),
        uncategorized_count: r.uncategorized_count,
        uncategorized_total: r.uncategorized_total.to_string(),
        reviewed: r.reviewed,
    })
}

#[tauri::command]
pub fn set_month_reviewed(year: i32, month: u32, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_month_reviewed(year, month).map_err(|e| e.to_string())
}

/// Every month whose review was finished, as "YYYY-MM".
#[tauri::command]
pub fn list_reviewed_months(state: tauri::State<AppStateHandle>) -> Result<Vec<String>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.list_reviewed_months().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct BudgetTrendPointDto {
    /// "YYYY-MM"
    pub month: String,
    pub actual: String,
}

/// One category's actual spend for each of the trailing `months` months
/// ending at `year`/`month` — powers the Budget page's per-row sparkline.
/// Fetched lazily per visible row rather than bulk-loaded for every
/// category up front.
#[tauri::command]
pub fn budget_actuals_trend(
    category: String,
    year: i32,
    month: u32,
    months: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<BudgetTrendPointDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let trend = state
        .store
        .budget_actuals_trend(&category, year, month, months)
        .map_err(|e| e.to_string())?;
    Ok(trend
        .into_iter()
        .map(|(month, actual)| BudgetTrendPointDto {
            month,
            actual: actual.to_string(),
        })
        .collect())
}

#[derive(Serialize)]
pub struct CategoryTransactionDto {
    pub transaction_id: i64,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub account_name: String,
    pub is_split: bool,
    pub split_note: Option<String>,
}

/// Line items behind one Budget page row — clicking a category (e.g.
/// "Utilities") shows every transaction (or split line) that counted
/// toward that category's "actual" for the month being viewed.
#[tauri::command]
pub fn transactions_for_category(
    category: String,
    year: i32,
    month: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<CategoryTransactionDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let items = state
        .store
        .transactions_for_category_in_month(&category, year, month)
        .map_err(|e| e.to_string())?;
    Ok(items
        .into_iter()
        .map(|t| CategoryTransactionDto {
            transaction_id: t.transaction_id,
            date: t.date.to_string(),
            description: t.description,
            amount: t.amount.to_string(),
            account_name: t.account_name,
            is_split: t.is_split,
            split_note: t.split_note,
        })
        .collect())
}

#[derive(Serialize)]
pub struct BudgetAlertDto {
    pub category: String,
    pub budget_group: String,
    pub budgeted: String,
    pub actual: String,
    pub pct: String,
    pub level: String,
    pub cap_enabled: bool,
}

#[tauri::command]
pub fn budget_alerts_for_month(year: i32, month: u32, state: tauri::State<AppStateHandle>) -> Result<Vec<BudgetAlertDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let alerts = state.store.budget_alerts_for_month(year, month).map_err(|e| e.to_string())?;
    Ok(alerts
        .into_iter()
        .map(|a| BudgetAlertDto {
            category: a.category,
            budget_group: a.budget_group,
            budgeted: a.budgeted.to_string(),
            actual: a.actual.to_string(),
            pct: a.pct.to_string(),
            level: a.level,
            cap_enabled: a.cap_enabled,
        })
        .collect())
}

#[derive(Serialize)]
pub struct InsightDto {
    pub severity: String,
    pub kind: String,
    pub message: String,
}

#[tauri::command]
pub fn dashboard_insights(state: tauri::State<AppStateHandle>) -> Result<Vec<InsightDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let insights = state.store.dashboard_insights(today).map_err(|e| e.to_string())?;
    Ok(insights
        .into_iter()
        .map(|i| InsightDto {
            severity: i.severity,
            kind: i.kind,
            message: i.message,
        })
        .collect())
}

#[derive(Deserialize)]
pub struct MinimumPaymentInput {
    pub account_id: i64,
    pub minimum_payment: String,
}

#[derive(Serialize)]
pub struct DebtPayoffLineDto {
    pub account_id: i64,
    pub account_name: String,
    pub starting_balance: String,
    pub payoff_date: Option<String>,
    pub total_interest_paid: String,
}

#[derive(Serialize)]
pub struct DebtPayoffPlanDto {
    pub per_account: Vec<DebtPayoffLineDto>,
    pub total_months: Option<u32>,
    pub total_interest_paid: String,
}

#[tauri::command]
pub fn debt_payoff_projection(
    strategy: String,
    extra_payment: String,
    minimums: Vec<MinimumPaymentInput>,
    state: tauri::State<AppStateHandle>,
) -> Result<DebtPayoffPlanDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let extra_payment = parse_amount(&extra_payment)?;
    let mut minimum_payments = Vec::with_capacity(minimums.len());
    for m in minimums {
        minimum_payments.push((m.account_id, parse_amount(&m.minimum_payment)?));
    }
    let today = chrono::Local::now().date_naive();
    let plan = state
        .store
        .debt_payoff_projection(&strategy, extra_payment, &minimum_payments, today)
        .map_err(|e| e.to_string())?;
    Ok(DebtPayoffPlanDto {
        per_account: plan
            .per_account
            .into_iter()
            .map(|l| DebtPayoffLineDto {
                account_id: l.account_id,
                account_name: l.account_name,
                starting_balance: l.starting_balance.to_string(),
                payoff_date: l.payoff_date.map(|d| d.to_string()),
                total_interest_paid: l.total_interest_paid.to_string(),
            })
            .collect(),
        total_months: plan.total_months,
        total_interest_paid: plan.total_interest_paid.to_string(),
    })
}

#[derive(Serialize)]
pub struct AnomalyFlagDto {
    pub transaction_id: i64,
    pub kind: String,
    pub detail: String,
}

/// The user looked at a flag and it's fine — see `Store::dismiss_anomaly`.
#[tauri::command]
pub fn dismiss_anomaly_flag(transaction_id: i64, kind: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.dismiss_anomaly(transaction_id, &kind).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_anomaly_flags(state: tauri::State<AppStateHandle>) -> Result<Vec<AnomalyFlagDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let flags = state.store.open_anomaly_flags().map_err(|e| e.to_string())?;
    Ok(flags
        .into_iter()
        .map(|f| AnomalyFlagDto {
            transaction_id: f.transaction_id,
            kind: f.kind,
            detail: f.detail,
        })
        .collect())
}

#[tauri::command]
pub fn get_stats(state: tauri::State<AppStateHandle>) -> Result<Stats, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let all = state.store.all_transactions().map_err(|e| e.to_string())?;

    let mut stats = Stats {
        total: all.len(),
        auto_categorized: 0,
        user_confirmed: 0,
        uncategorized: 0,
    };
    for t in &all {
        // "Needs a category" must mean exactly that — no category name at
        // all — not "no recorded source for whatever category it has".
        // A transaction imported with a category already attached (a QFX/
        // OFX file's own categorization, or a bulk setup-data import) gets
        // a real `category` but no `category_source`, since it was never
        // run through this app's own rule/classifier/user-confirm path;
        // counting it as "uncategorized" anyway (as this used to) made the
        // Transactions tab's "Needs a category" stat overcount, disagreeing with its
        // own "Uncategorized" filter, which correctly checks `category`.
        if t.transaction.category.is_none() {
            stats.uncategorized += 1;
        } else if t.category_source == Some(CategorySource::User) {
            stats.user_confirmed += 1;
        } else {
            stats.auto_categorized += 1;
        }
    }
    Ok(stats)
}

#[tauri::command]
pub fn create_recurring(
    merchant: String,
    category: Option<String>,
    amount: String,
    cadence: String,
    anchor_date: String,
    account_id: Option<i64>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let amount = parse_amount(&amount)?;
    let anchor_date = parse_date(&anchor_date)?;
    state
        .store
        .create_recurring(&merchant, category.as_deref(), amount, &cadence, anchor_date, account_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_recurring(state: tauri::State<AppStateHandle>) -> Result<Vec<RecurringDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let items = state.store.list_recurring(today).map_err(|e| e.to_string())?;
    Ok(items
        .into_iter()
        .map(|r| RecurringDto {
            id: r.id,
            merchant: r.merchant,
            category: r.category,
            amount: r.amount.to_string(),
            cadence: r.cadence,
            anchor_date: r.anchor_date.to_string(),
            next_date: r.next_date.to_string(),
            account_id: r.account_id,
            account_name: r.account_name,
            member_id: r.member_id,
            member_name: r.member_name,
            status: r.status,
        })
        .collect())
}

#[tauri::command]
pub fn delete_recurring(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_recurring(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_recurring_status(id: i64, status: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_recurring_status(id, &status).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct PriceChangeDto {
    pub from: String,
    pub to: String,
}

#[derive(Serialize)]
pub struct RecurringMatchDto {
    pub recurring_id: i64,
    pub state: String,
    pub last_due: Option<String>,
    pub last_paid_date: Option<String>,
    pub last_paid_amount: Option<String>,
    pub price_change: Option<PriceChangeDto>,
}

/// How every recurring item lines up with the charges actually posted — see
/// `Store::recurring_matches`.
#[tauri::command]
pub fn recurring_matches(state: tauri::State<AppStateHandle>) -> Result<Vec<RecurringMatchDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let matches = state.store.recurring_matches(today).map_err(|e| e.to_string())?;
    Ok(matches
        .into_iter()
        .map(|m| RecurringMatchDto {
            recurring_id: m.recurring_id,
            state: m.state,
            last_due: m.last_due.map(|d| d.to_string()),
            last_paid_date: m.last_paid_date.map(|d| d.to_string()),
            last_paid_amount: m.last_paid_amount.map(|a| a.to_string()),
            price_change: m.price_change.map(|c| PriceChangeDto {
                from: c.from.to_string(),
                to: c.to.to_string(),
            }),
        })
        .collect())
}

#[tauri::command]
pub fn recurring_totals(state: tauri::State<AppStateHandle>) -> Result<RecurringTotalsDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let totals = state.store.recurring_totals().map_err(|e| e.to_string())?;
    Ok(RecurringTotalsDto {
        monthly_expense: totals.monthly_expense.to_string(),
        monthly_income: totals.monthly_income.to_string(),
        annual_expense: totals.annual_expense.to_string(),
        annual_income: totals.annual_income.to_string(),
    })
}

#[tauri::command]
// Same reasoning as `create_bucket` above — mirrors `Store::update_recurring`.
#[allow(clippy::too_many_arguments)]
pub fn update_recurring(
    id: i64,
    merchant: String,
    category: Option<String>,
    amount: String,
    cadence: String,
    anchor_date: String,
    account_id: Option<i64>,
    state: tauri::State<AppStateHandle>,
) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let amount = parse_amount(&amount)?;
    let anchor_date = parse_date(&anchor_date)?;
    state
        .store
        .update_recurring(id, &merchant, category.as_deref(), amount, &cadence, anchor_date, account_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_recurring_member(id: i64, member_id: Option<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_recurring_member(id, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_recurring_candidates(state: tauri::State<AppStateHandle>) -> Result<Vec<RecurringCandidateDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let candidates = state.store.detect_recurring_candidates(today).map_err(|e| e.to_string())?;
    Ok(candidates
        .into_iter()
        .map(|c| RecurringCandidateDto {
            merchant: c.merchant,
            category: c.category,
            amount: c.amount.to_string(),
            cadence: c.cadence,
            anchor_date: c.anchor_date.to_string(),
            occurrence_count: c.occurrence_count,
        })
        .collect())
}

#[tauri::command]
pub fn dismiss_recurring_candidate(merchant: String, amount: String, cadence: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let amount = parse_amount(&amount)?;
    state
        .store
        .dismiss_recurring_candidate(&merchant, amount, &cadence)
        .map_err(|e| e.to_string())
}

#[tauri::command]
// Same reasoning as `create_bucket` above — mirrors `Store::create_holding`.
#[allow(clippy::too_many_arguments)]
pub fn create_holding(
    account_id: i64,
    symbol: String,
    name: String,
    shares: String,
    price: String,
    cost_basis: String,
    asset_class: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let shares = parse_amount(&shares)?;
    let price = parse_amount(&price)?;
    let cost_basis = parse_amount(&cost_basis)?;
    if shares <= Decimal::ZERO {
        return Err("Shares must be greater than zero.".to_string());
    }
    if price <= Decimal::ZERO {
        return Err("Price must be greater than zero.".to_string());
    }
    if cost_basis < Decimal::ZERO {
        return Err("Cost basis can't be negative.".to_string());
    }
    let id = state
        .store
        .create_holding(account_id, &symbol, &name, shares, price, cost_basis, asset_class.as_deref())
        .map_err(|e| e.to_string())?;
    // Best effort: a missed snapshot only leaves a gap in the value history.
    let _ = state.store.record_portfolio_snapshot(chrono::Local::now().date_naive());
    Ok(id)
}

#[tauri::command]
pub fn list_holdings(state: tauri::State<AppStateHandle>) -> Result<Vec<HoldingDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let holdings = state.store.list_holdings(today).map_err(|e| e.to_string())?;
    Ok(holdings
        .into_iter()
        .map(|h| HoldingDto {
            id: h.id,
            account_id: h.account_id,
            account_name: h.account_name,
            symbol: h.symbol,
            name: h.name,
            shares: h.shares.to_string(),
            price: h.price.to_string(),
            cost_basis: h.cost_basis.to_string(),
            asset_class: h.asset_class,
            value: h.value.to_string(),
            gain_loss: h.gain_loss.to_string(),
            prev_close: h.prev_close.map(|d| d.to_string()),
            day_gain_loss: h.day_gain_loss.map(|d| d.to_string()),
        })
        .collect())
}

#[derive(Serialize)]
pub struct CategoryMonthAmountDto {
    /// "YYYY-MM"
    pub month: String,
    pub category: String,
    pub amount: String,
}

/// Spending per category per month across a date range — the Reports page's
/// trend table. See `Store::category_spending_by_month`.
#[tauri::command]
pub fn category_spending_by_month(
    from_year: i32,
    from_month: u32,
    to_year: i32,
    to_month: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<CategoryMonthAmountDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let rows = state
        .store
        .category_spending_by_month(from_year, from_month, to_year, to_month)
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| CategoryMonthAmountDto {
            month: r.month,
            category: r.category,
            amount: r.amount.to_string(),
        })
        .collect())
}

#[derive(Serialize)]
pub struct DailySpendAmountDto {
    /// "YYYY-MM-DD"
    pub date: String,
    pub amount: String,
}

/// Total spend per calendar day across a date range — the Reports page's
/// daily-spend heatmap. See `Store::daily_spending`.
#[tauri::command]
pub fn daily_spending(
    from_year: i32,
    from_month: u32,
    to_year: i32,
    to_month: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<DailySpendAmountDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let rows = state
        .store
        .daily_spending(from_year, from_month, to_year, to_month)
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| DailySpendAmountDto {
            date: r.date,
            amount: r.amount.to_string(),
        })
        .collect())
}

#[derive(Serialize)]
pub struct BalancePointDto {
    pub date: String,
    pub balance: String,
}

/// An account's balance at each of the last `months` month-ends, ending with
/// today — see `Store::account_balance_history`.
#[tauri::command]
pub fn account_balance_history(account_id: i64, months: u32, state: tauri::State<AppStateHandle>) -> Result<Vec<BalancePointDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let history = state
        .store
        .account_balance_history(account_id, today, months)
        .map_err(|e| e.to_string())?;
    Ok(history
        .into_iter()
        .map(|(date, balance)| BalancePointDto {
            date: date.to_string(),
            balance: balance.to_string(),
        })
        .collect())
}

#[derive(Serialize)]
pub struct AccountTransactionDto {
    pub id: i64,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub category: Option<String>,
    pub cleared: bool,
}

fn account_transaction_dtos(rows: Vec<budget_core::store::AccountTransaction>) -> Vec<AccountTransactionDto> {
    rows.into_iter()
        .map(|t| AccountTransactionDto {
            id: t.id,
            date: t.date.to_string(),
            description: t.description,
            amount: t.amount.to_string(),
            category: t.category,
            cleared: t.cleared,
        })
        .collect()
}

#[tauri::command]
pub fn list_account_transactions(account_id: i64, limit: usize, state: tauri::State<AppStateHandle>) -> Result<Vec<AccountTransactionDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let rows = state.store.list_account_transactions(account_id, limit).map_err(|e| e.to_string())?;
    Ok(account_transaction_dtos(rows))
}

/// The transactions to tick through for a statement ending `statement_date` —
/// see `Store::reconcile_candidates`.
#[tauri::command]
pub fn reconcile_candidates(
    account_id: i64,
    statement_date: String,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<AccountTransactionDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let date = parse_date(&statement_date)?;
    let rows = state.store.reconcile_candidates(account_id, date).map_err(|e| e.to_string())?;
    Ok(account_transaction_dtos(rows))
}

#[tauri::command]
pub fn set_transactions_cleared(ids: Vec<i64>, cleared: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_transactions_cleared(&ids, cleared).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct ReconciliationStatusDto {
    pub cleared_balance: String,
    pub difference: String,
    pub cleared_count: usize,
}

#[tauri::command]
pub fn reconciliation_status(
    account_id: i64,
    statement_balance: String,
    state: tauri::State<AppStateHandle>,
) -> Result<ReconciliationStatusDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let statement_balance = parse_amount(&statement_balance)?;
    let status = state
        .store
        .reconciliation_status(account_id, statement_balance)
        .map_err(|e| e.to_string())?;
    Ok(ReconciliationStatusDto {
        cleared_balance: status.cleared_balance.to_string(),
        difference: status.difference.to_string(),
        cleared_count: status.cleared_count,
    })
}

/// Records the reconciliation if it balances; `false` means the difference
/// wasn't zero and nothing was recorded.
#[tauri::command]
pub fn finish_reconciliation(
    account_id: i64,
    statement_date: String,
    statement_balance: String,
    state: tauri::State<AppStateHandle>,
) -> Result<bool, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let date = parse_date(&statement_date)?;
    let balance = parse_amount(&statement_balance)?;
    state
        .store
        .finish_reconciliation(account_id, date, balance, chrono::Local::now().naive_local())
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct LastReconciliationDto {
    pub statement_date: String,
    pub statement_balance: String,
}

#[tauri::command]
pub fn last_reconciliation(account_id: i64, state: tauri::State<AppStateHandle>) -> Result<Option<LastReconciliationDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let last = state.store.last_reconciliation(account_id).map_err(|e| e.to_string())?;
    Ok(last.map(|(date, balance)| LastReconciliationDto {
        statement_date: date.to_string(),
        statement_balance: balance.to_string(),
    }))
}

#[derive(Serialize)]
pub struct PortfolioPointDto {
    pub date: String,
    pub value: String,
}

/// The portfolio's recorded value over time — see `Store::record_portfolio_snapshot`.
#[tauri::command]
pub fn portfolio_history(state: tauri::State<AppStateHandle>) -> Result<Vec<PortfolioPointDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let history = state.store.portfolio_history().map_err(|e| e.to_string())?;
    Ok(history
        .into_iter()
        .map(|(date, value)| PortfolioPointDto {
            date: date.to_string(),
            value: value.to_string(),
        })
        .collect())
}

/// Records today's portfolio value — the app calls it at launch so a quiet
/// week still leaves a point on the chart.
#[tauri::command]
pub fn record_portfolio_snapshot(state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    state.store.record_portfolio_snapshot(today).map(|_| ()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct AllocationTargetDto {
    pub asset_class: String,
    pub percent: String,
}

#[tauri::command]
pub fn list_allocation_targets(state: tauri::State<AppStateHandle>) -> Result<Vec<AllocationTargetDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let targets = state.store.list_allocation_targets().map_err(|e| e.to_string())?;
    Ok(targets
        .into_iter()
        .map(|(asset_class, percent)| AllocationTargetDto {
            asset_class,
            percent: percent.to_string(),
        })
        .collect())
}

/// Sets (or, at 0, clears) one asset class's target share — see `Store::set_allocation_target`.
#[tauri::command]
pub fn set_allocation_target(asset_class: String, percent: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let percent = parse_amount(&percent)?;
    state.store.set_allocation_target(&asset_class, percent).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_holding_price(id: i64, price: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let price = parse_amount(&price)?;
    if price <= Decimal::ZERO {
        return Err("Price must be greater than zero.".to_string());
    }
    let today = chrono::Local::now().date_naive();
    state.store.update_holding_price(id, price, today).map_err(|e| e.to_string())?;
    let _ = state.store.record_portfolio_snapshot(today);
    Ok(())
}

#[tauri::command]
pub fn delete_holding(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_holding(id).map_err(|e| e.to_string())?;
    let _ = state.store.record_portfolio_snapshot(chrono::Local::now().date_naive());
    Ok(())
}

#[derive(Serialize)]
pub struct LivePriceSettingsDto {
    pub enabled: bool,
    pub provider: String,
    pub last_refreshed_at: Option<String>,
    pub requests_used_today: i64,
    /// `None` when the active provider has no daily cap to enforce
    /// (Finnhub — a real per-*minute* limit, not a per-day one; see
    /// `live_price_provider.rs`). `Some(25)` for Alpha Vantage.
    pub requests_limit: Option<i64>,
}

/// The opt-in live-price feature's current state — the API key itself is
/// never sent back to the frontend once saved (write-only, standard
/// credential handling). `requests_used_today`/`requests_limit` let the
/// Settings UI show (and warn about) today's usage without a separate
/// command.
#[tauri::command]
pub fn get_live_price_settings(state: tauri::State<AppStateHandle>) -> Result<LivePriceSettingsDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let settings = state.store.get_live_price_settings().map_err(|e| e.to_string())?;
    let today = chrono::Local::now().date_naive();
    let requests_used_today = state.store.live_price_requests_used_today(today).map_err(|e| e.to_string())?;
    let provider = crate::live_price_provider::LivePriceProvider::parse(&settings.provider)
        .unwrap_or(crate::live_price_provider::LivePriceProvider::AlphaVantage);
    Ok(LivePriceSettingsDto {
        enabled: settings.api_key.is_some(),
        provider: provider.as_str().to_string(),
        last_refreshed_at: settings.last_refreshed_at.map(|t| t.format("%Y-%m-%d %H:%M").to_string()),
        requests_used_today,
        requests_limit: provider.daily_limit(),
    })
}

/// Saves (or, with `api_key: None`/an empty string, clears) the chosen
/// provider and its API key together. Purely local persistence — no
/// network call, so a typo'd key isn't caught here; "Refresh now" on the
/// Settings tab is what actually exercises it and would surface the
/// provider's own error message.
#[tauri::command]
pub fn set_live_price_settings(provider: String, api_key: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let provider =
        crate::live_price_provider::LivePriceProvider::parse(&provider).ok_or_else(|| format!("unknown live-price provider: {provider}"))?;
    let api_key = api_key.filter(|k| !k.trim().is_empty());
    state
        .store
        .set_live_price_settings(provider.as_str(), api_key.as_deref())
        .map_err(|e| e.to_string())
}

/// Global feature toggles shown as switches under Settings — see
/// `budget_core::StoredAppSettings` for what turning each one off does
/// (and, for `envelope_caps_enabled`, does *not* do to stored data).
#[derive(Serialize)]
pub struct AppSettingsDto {
    pub apply_to_debt_enabled: bool,
    pub split_purchases_enabled: bool,
    pub envelope_caps_enabled: bool,
    pub rollover_enabled: bool,
}

#[tauri::command]
pub fn get_app_settings(state: tauri::State<AppStateHandle>) -> Result<AppSettingsDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let settings = state.store.get_app_settings().map_err(|e| e.to_string())?;
    Ok(AppSettingsDto {
        apply_to_debt_enabled: settings.apply_to_debt_enabled,
        split_purchases_enabled: settings.split_purchases_enabled,
        envelope_caps_enabled: settings.envelope_caps_enabled,
        rollover_enabled: settings.rollover_enabled,
    })
}

#[tauri::command]
pub fn set_apply_to_debt_enabled(enabled: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_apply_to_debt_enabled(enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_split_purchases_enabled(enabled: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_split_purchases_enabled(enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_envelope_caps_enabled(enabled: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_envelope_caps_enabled(enabled).map_err(|e| e.to_string())
}

/// The global "Rollover unspent" switch (Settings). Off stops unspent budget
/// carrying into the next month without touching any stored budget or any
/// category's own choice.
#[tauri::command]
pub fn set_rollover_enabled(enabled: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_rollover_enabled(enabled).map_err(|e| e.to_string())
}

/// Looks up one live quote — used only by the New Holding form's autofill,
/// so it deliberately does not write a price anywhere. Returns `Ok(None)`
/// (not an error) when the feature isn't enabled or the provider has no
/// data for the symbol, since either way the form should just leave Price
/// for the user to fill in by hand. For Alpha Vantage, once today's
/// request budget is spent, this returns an `Err` instead of attempting
/// the call at all — see `refresh_live_prices` below for the same budget
/// check on the main path. Finnhub has no such proactive local check (its
/// real limit is per-minute, not per-day — see `live_price_provider.rs`).
///
/// Locks `state` only in short scoped blocks that close before the network
/// `.await` below — `AppStateHandle`'s `std::sync::MutexGuard` isn't `Send`,
/// so holding it across an await point would fail to compile against
/// Tauri's multi-threaded async runtime.
#[tauri::command]
pub async fn fetch_live_quote(
    symbol: String,
    state: tauri::State<'_, AppStateHandle>,
    paths: tauri::State<'_, crate::config::AppPaths>,
) -> Result<Option<String>, String> {
    let today = chrono::Local::now().date_naive();
    let generation = paths.current_generation();
    let (api_key, provider, used_today) = {
        let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
        let settings = state.store.get_live_price_settings().map_err(|e| e.to_string())?;
        let used_today = state.store.live_price_requests_used_today(today).map_err(|e| e.to_string())?;
        (settings.api_key, settings.provider, used_today)
    };
    let Some(api_key) = api_key else {
        return Ok(None);
    };
    let provider =
        crate::live_price_provider::LivePriceProvider::parse(&provider).unwrap_or(crate::live_price_provider::LivePriceProvider::AlphaVantage);

    if let Some(limit) = provider.daily_limit() {
        if used_today >= limit {
            return Err(format!(
                "Today's {} limit ({limit}/day) has been reached — enter the price manually, or try again tomorrow.",
                provider.label()
            ));
        }
    }

    let client = reqwest::Client::new();
    let result = crate::live_price_provider::fetch_quote(provider, &client, &api_key, &symbol).await;
    // Same generation guard as `refresh_live_prices` — the profile that
    // was live when this request started may not be the one live now.
    // Checked here first as a cheap early-out, then checked *again* just
    // below once the lock is actually held — a profile switch can acquire
    // the lock and bump the generation in the gap between this check
    // passing and `state.lock()` below actually returning (that lock call
    // blocks, uncontended-or-not, and a switch can run to completion
    // during the wait), so only the check taken while holding the same
    // lock the switch uses is actually atomic with it.
    if paths.current_generation() != generation {
        return Ok(None);
    }
    {
        let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
        if paths.current_generation() != generation {
            return Ok(None);
        }
        // Recorded unconditionally for every provider — for one with no
        // daily_limit() (Finnhub) this is an informational-only "requests
        // used today" count with no limit attached, not a budget check.
        state.store.record_live_price_request(today).map_err(|e| e.to_string())?;
    }
    Ok(result?.map(|p| p.to_string()))
}

#[derive(Serialize)]
pub struct FailedQuote {
    pub symbol: String,
    pub error: String,
}

#[derive(Serialize)]
pub struct LivePriceRefreshSummary {
    pub updated: Vec<String>,
    pub failed: Vec<FailedQuote>,
}

/// Refreshes every distinct symbol currently held (see
/// `Store::list_distinct_holding_symbols` — a symbol held in more than one
/// account still costs exactly one request). Called once on launch and
/// every 2 hours while the app stays open (see App.tsx), plus on demand via
/// the Settings tab's "Refresh now".
///
/// **For Alpha Vantage, stops pulling data once today's budget is spent**
/// — checked locally against `Store::live_price_requests_used_today`
/// before any request goes out, not just reacted to after the fact. If
/// fewer than `symbols.len()` requests remain today, only that many are
/// actually attempted; the rest land in `failed` with a "Skipped — limit"
/// message instead of being sent and failing anyway. This is a proactive
/// cap, not just error handling: opening and closing the app repeatedly
/// through the day (each launch triggers a refresh) accumulates against
/// the same per-profile counter, so it still stops at the daily total
/// regardless of how many separate launches it took to get there (see
/// `LivePriceProvider::daily_limit` — Alpha Vantage is 25/day, Twelve
/// Data is 800/day). **Finnhub has no such cap** — its real limit is 60
/// requests/*minute*, not a day, and this app's usage pattern (one
/// request per distinct symbol, refreshed at most every 2 hours) never
/// comes close to it; if it's ever actually exceeded, that 429 just lands
/// in `failed` like any other per-symbol error, with no proactive skip.
/// Symbols are fetched one at a time, not concurrently, so the running
/// total stays accurate mid-batch.
///
/// Same locking discipline as `fetch_live_quote` above: the network calls
/// below run with no lock held at all, and results are written back in
/// short, separate locks — one per request (to record it against today's
/// count as it happens, unconditionally for both providers), then one
/// more at the end for the price/timestamp writes.
#[tauri::command]
pub async fn refresh_live_prices(
    state: tauri::State<'_, AppStateHandle>,
    paths: tauri::State<'_, crate::config::AppPaths>,
) -> Result<LivePriceRefreshSummary, String> {
    let today = chrono::Local::now().date_naive();
    let generation = paths.current_generation();
    let (api_key, provider, symbols, used_today) = {
        let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
        let settings = state.store.get_live_price_settings().map_err(|e| e.to_string())?;
        let symbols = state.store.list_distinct_holding_symbols().map_err(|e| e.to_string())?;
        let used_today = state.store.live_price_requests_used_today(today).map_err(|e| e.to_string())?;
        (settings.api_key, settings.provider, symbols, used_today)
    };
    let provider =
        crate::live_price_provider::LivePriceProvider::parse(&provider).unwrap_or(crate::live_price_provider::LivePriceProvider::AlphaVantage);
    let api_key = api_key.ok_or_else(|| format!("Live prices aren't enabled — add a {} API key in Settings.", provider.label()))?;

    let limit = provider.daily_limit();
    let mut symbols = symbols;
    let skipped = match limit {
        Some(limit) => {
            let remaining = (limit - used_today).max(0) as usize;
            if symbols.len() > remaining {
                symbols.split_off(remaining)
            } else {
                Vec::new()
            }
        }
        None => Vec::new(),
    };
    let to_attempt = symbols;
    let attempted_any = !to_attempt.is_empty();

    let mut failed: Vec<FailedQuote> = skipped
        .into_iter()
        .map(|symbol| FailedQuote {
            symbol,
            error: format!(
                "Skipped — today's {} limit ({}/day) would be exceeded.",
                provider.label(),
                limit.expect("skipped is only ever non-empty when a limit exists")
            ),
        })
        .collect();

    let client = reqwest::Client::new();
    let results = crate::live_price_provider::fetch_quotes(provider, &client, &api_key, &to_attempt).await;
    // One HTTP request per symbol for a provider with no batching, one per
    // up-to-`max_batch_size()`-symbol chunk for one that does (StockData.org
    // today) — matches what `fetch_quotes` above actually sent, so
    // `record_live_price_request`'s "one request actually sent" contract
    // holds even though a batching provider prices several symbols per call.
    let request_count = match provider.max_batch_size() {
        None => to_attempt.len(),
        Some(batch_size) => to_attempt.len().div_ceil(batch_size),
    };

    let mut quotes = Vec::new();
    for (symbol, result) in results {
        match result {
            Ok(Some(price)) => quotes.push((symbol, price)),
            Ok(None) => failed.push(FailedQuote {
                symbol,
                error: "no data returned for this symbol".to_string(),
            }),
            Err(error) => failed.push(FailedQuote { symbol, error }),
        }
    }

    // The network calls above ran with no lock held (see this function's
    // own doc comment) and could take long enough for the user to switch,
    // restore, or relocate to a different profile in the meantime — in
    // which case `state` below is now some other database entirely. Their
    // results belong to the profile this refresh *started* against, not
    // whatever's live now, so a generation mismatch here discards them
    // rather than recording a request/price update against the wrong
    // profile's data (the concrete bug this guards against: a refresh
    // that failed against profile A recording as if it happened, or an
    // A-only price update landing on profile B's holdings).
    //
    // Checked here first as a cheap early-out, then checked *again* just
    // below once the lock is actually held — a profile switch can acquire
    // the lock, swap `state`, and bump the generation in the gap between
    // this check passing and `state.lock()` below actually returning, so
    // only the check taken while holding the same lock the switch uses is
    // actually atomic with it.
    if paths.current_generation() != generation {
        return Ok(LivePriceRefreshSummary {
            updated: Vec::new(),
            failed: Vec::new(),
        });
    }

    let mut updated = Vec::new();
    {
        let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
        if paths.current_generation() != generation {
            return Ok(LivePriceRefreshSummary {
                updated: Vec::new(),
                failed: Vec::new(),
            });
        }
        for _ in 0..request_count {
            // Recorded unconditionally for every provider — informational
            // only for Finnhub (and, above its daily cap, StockData.org's
            // request count), which have no limit to check it against.
            state.store.record_live_price_request(today).map_err(|e| e.to_string())?;
        }
        for (symbol, price) in quotes {
            state
                .store
                .update_holding_prices_for_symbol(&symbol, price, today)
                .map_err(|e| e.to_string())?;
            updated.push(symbol);
        }
        // The prices just moved, so today's portfolio value did too.
        let _ = state.store.record_portfolio_snapshot(today);
        // Only bump "last refreshed" if a request actually went out — a
        // refresh that was entirely skipped for being over budget didn't
        // actually refresh anything.
        if attempted_any {
            state
                .store
                .set_live_prices_last_refreshed(chrono::Local::now().naive_local())
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(LivePriceRefreshSummary { updated, failed })
}

#[derive(Serialize)]
pub struct AssetDto {
    pub id: i64,
    pub name: String,
    pub asset_type: String,
    pub value: String,
    pub valued_on: String,
    pub notes: Option<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
}

#[tauri::command]
pub fn create_asset(
    name: String,
    asset_type: String,
    value: String,
    valued_on: String,
    notes: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let value = parse_amount(&value)?;
    if value < Decimal::ZERO {
        return Err("Value can't be negative.".to_string());
    }
    let valued_on = parse_date(&valued_on)?;
    state
        .store
        .create_asset(&name, &asset_type, value, valued_on, notes.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_assets(state: tauri::State<AppStateHandle>) -> Result<Vec<AssetDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let assets = state.store.list_assets().map_err(|e| e.to_string())?;
    Ok(assets
        .into_iter()
        .map(|a| AssetDto {
            id: a.id,
            name: a.name,
            asset_type: a.asset_type,
            value: a.value.to_string(),
            valued_on: a.valued_on.to_string(),
            notes: a.notes,
            member_id: a.member_id,
            member_name: a.member_name,
        })
        .collect())
}

#[tauri::command]
pub fn update_asset_value(id: i64, value: String, valued_on: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let value = parse_amount(&value)?;
    if value < Decimal::ZERO {
        return Err("Value can't be negative.".to_string());
    }
    let valued_on = parse_date(&valued_on)?;
    state.store.update_asset_value(id, value, valued_on).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_asset_member(id: i64, member_id: Option<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.set_asset_member(id, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_asset(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    state.store.delete_asset(id).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct MonthTotalDto {
    pub month_label: String,
    pub year: i32,
    pub month: u32,
    pub income: String,
    pub expense: String,
}

#[derive(Serialize)]
pub struct CategoryAmountDto {
    pub category: String,
    pub amount: String,
}

#[derive(Serialize)]
pub struct MerchantAmountDto {
    pub description: String,
    pub amount: String,
}

#[derive(Serialize)]
pub struct CashFlowDto {
    pub months: Vec<MonthTotalDto>,
    pub top_categories: Vec<CategoryAmountDto>,
    pub top_merchants: Vec<MerchantAmountDto>,
    pub total_income: String,
    pub total_expense: String,
}

/// Bundles everything the Cash Flow page needs for a trailing window of
/// `months` months (including the current one) into one round-trip, same
/// reasoning as `get_report`.
#[tauri::command]
pub fn get_cash_flow(months: u32, state: tauri::State<AppStateHandle>) -> Result<CashFlowDto, String> {
    use chrono::Datelike;

    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();

    let mut year_months = Vec::with_capacity(months as usize);
    let (mut y, mut m) = (today.year(), today.month());
    for _ in 0..months {
        year_months.push((y, m));
        if m == 1 {
            m = 12;
            y -= 1;
        } else {
            m -= 1;
        }
    }
    year_months.reverse();

    let (first_year, first_month) = year_months[0];
    let (last_year, last_month) = year_months[year_months.len() - 1];
    let totals_by_month = state
        .store
        .monthly_totals_for_range(first_year, first_month, last_year, last_month)
        .map_err(|e| e.to_string())?;

    let mut month_totals = Vec::with_capacity(year_months.len());
    let mut total_income = Decimal::ZERO;
    let mut total_expense = Decimal::ZERO;
    for (year, month) in &year_months {
        let (income, expense) = totals_by_month.get(&(*year, *month)).copied().unwrap_or((Decimal::ZERO, Decimal::ZERO));
        total_income += income;
        total_expense += expense;
        let label = chrono::NaiveDate::from_ymd_opt(*year, *month, 1)
            .expect("a year/month this loop generated must be valid")
            .format("%b")
            .to_string();
        month_totals.push(MonthTotalDto {
            month_label: label,
            year: *year,
            month: *month,
            income: income.to_string(),
            expense: expense.to_string(),
        });
    }

    let (start_year, start_month) = year_months[0];
    let start_date = chrono::NaiveDate::from_ymd_opt(start_year, start_month, 1).expect("the first generated year/month must be valid");

    let top_categories = state
        .store
        .spending_by_category(start_date, today)
        .map_err(|e| e.to_string())?
        .into_iter()
        .take(6)
        .map(|(category, amount)| CategoryAmountDto {
            category,
            amount: amount.to_string(),
        })
        .collect();
    let top_merchants = state
        .store
        .top_merchants(start_date, today, 8)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(description, amount)| MerchantAmountDto {
            description,
            amount: amount.to_string(),
        })
        .collect();

    Ok(CashFlowDto {
        months: month_totals,
        top_categories,
        top_merchants,
        total_income: total_income.to_string(),
        total_expense: total_expense.to_string(),
    })
}

/// Every (year, month) from `from` through `to` inclusive, ascending. The
/// 1200-month (100-year) cap is just a safety valve against an accidentally
/// reversed or nonsensical range looping forever, not a real limit anyone
/// would hit.
fn month_range(from_year: i32, from_month: u32, to_year: i32, to_month: u32) -> Vec<(i32, u32)> {
    let mut year_months = Vec::new();
    let (mut y, mut m) = (from_year, from_month);
    loop {
        year_months.push((y, m));
        if (y, m) == (to_year, to_month) || year_months.len() > 1200 {
            break;
        }
        if m == 12 {
            m = 1;
            y += 1;
        } else {
            m += 1;
        }
    }
    year_months
}

fn month_totals_for_range(
    store: &Store,
    from_year: i32,
    from_month: u32,
    to_year: i32,
    to_month: u32,
    label_format: &str,
) -> Result<Vec<MonthTotalDto>, String> {
    let totals_by_month = store
        .monthly_totals_for_range(from_year, from_month, to_year, to_month)
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for (year, month) in month_range(from_year, from_month, to_year, to_month) {
        let (income, expense) = totals_by_month.get(&(year, month)).copied().unwrap_or((Decimal::ZERO, Decimal::ZERO));
        let label = chrono::NaiveDate::from_ymd_opt(year, month, 1)
            .expect("a year/month this loop generated must be valid")
            .format(label_format)
            .to_string();
        result.push(MonthTotalDto {
            month_label: label,
            year,
            month,
            income: income.to_string(),
            expense: expense.to_string(),
        });
    }
    Ok(result)
}

/// Cash flow for an explicit `[from, to]` month range instead of a fixed
/// trailing window — powers the Cash Flow page's custom date-range
/// picker. `get_cash_flow` (trailing-window) is unchanged and still used
/// for the page's default view.
#[tauri::command]
pub fn cash_flow_for_range(
    from_year: i32,
    from_month: u32,
    to_year: i32,
    to_month: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<CashFlowDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let month_totals = month_totals_for_range(&state.store, from_year, from_month, to_year, to_month, "%b '%y")?;

    let mut total_income = Decimal::ZERO;
    let mut total_expense = Decimal::ZERO;
    for line in &month_totals {
        total_income += Decimal::from_str(&line.income).map_err(|_| "invalid income total".to_string())?;
        total_expense += Decimal::from_str(&line.expense).map_err(|_| "invalid expense total".to_string())?;
    }

    let start_date =
        chrono::NaiveDate::from_ymd_opt(from_year, from_month, 1).ok_or_else(|| format!("invalid start month: {from_year:04}-{from_month:02}"))?;
    let end_date = last_day_of_month(to_year, to_month);

    let top_categories = state
        .store
        .spending_by_category(start_date, end_date)
        .map_err(|e| e.to_string())?
        .into_iter()
        .take(6)
        .map(|(category, amount)| CategoryAmountDto {
            category,
            amount: amount.to_string(),
        })
        .collect();
    let top_merchants = state
        .store
        .top_merchants(start_date, end_date, 8)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(description, amount)| MerchantAmountDto {
            description,
            amount: amount.to_string(),
        })
        .collect();

    Ok(CashFlowDto {
        months: month_totals,
        top_categories,
        top_merchants,
        total_income: total_income.to_string(),
        total_expense: total_expense.to_string(),
    })
}

/// Every category's spend for one month, uncapped — unlike `top_categories`
/// on `CashFlowDto`, which caps at 6 for the summary cards. Powers the
/// "Top categories" card's month-over-month trend: a category in the
/// *current* month's top 6 still needs an accurate prior-month figure
/// even if that category wouldn't itself have made the prior month's
/// top-6 cut.
#[tauri::command]
pub fn category_spending_for_month(year: i32, month: u32, state: tauri::State<AppStateHandle>) -> Result<Vec<CategoryAmountDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let start_date = chrono::NaiveDate::from_ymd_opt(year, month, 1).ok_or_else(|| format!("invalid month: {year:04}-{month:02}"))?;
    let end_date = last_day_of_month(year, month);
    Ok(state
        .store
        .spending_by_category(start_date, end_date)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(category, amount)| CategoryAmountDto {
            category,
            amount: amount.to_string(),
        })
        .collect())
}

#[derive(Serialize)]
pub struct LargeExpenseDto {
    pub transaction_id: i64,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub category: Option<String>,
    pub detail: String,
}

#[derive(Serialize)]
pub struct MonthExpenseDetailDto {
    pub month_label: String,
    pub categories: Vec<CategoryAmountDto>,
    pub large_expenses: Vec<LargeExpenseDto>,
}

/// Drill-down for one bar of the cash-flow chart: where that month's
/// expenses went by category, plus any unusually large charges that
/// occurred (see `Store::large_expenses_in_range`) — clicking a bar opens
/// this to answer "what drove this month's number."
#[tauri::command]
pub fn month_expense_detail(year: i32, month: u32, state: tauri::State<AppStateHandle>) -> Result<MonthExpenseDetailDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let start_date = chrono::NaiveDate::from_ymd_opt(year, month, 1).ok_or_else(|| format!("invalid month: {year:04}-{month:02}"))?;
    let end_date = last_day_of_month(year, month);

    let categories = state
        .store
        .spending_by_category(start_date, end_date)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(category, amount)| CategoryAmountDto {
            category,
            amount: amount.to_string(),
        })
        .collect();

    let large_expenses = state
        .store
        .large_expenses_in_range(start_date, end_date)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|e| LargeExpenseDto {
            transaction_id: e.transaction_id,
            date: e.date.to_string(),
            description: e.description,
            amount: e.amount.to_string(),
            category: e.category,
            detail: e.detail,
        })
        .collect();

    let month_label = start_date.format("%B %Y").to_string();

    Ok(MonthExpenseDetailDto {
        month_label,
        categories,
        large_expenses,
    })
}

#[derive(Serialize)]
pub struct YoyCashFlowDto {
    pub current: Vec<MonthTotalDto>,
    pub prior_year: Vec<MonthTotalDto>,
}

/// The same `[from, to]` month range paired month-by-month against the
/// identical range exactly one year earlier — a month with no prior-year
/// data just comes back as zeros (`monthly_totals` sums an empty match
/// set to zero, no special-casing needed), not an error.
#[tauri::command]
pub fn year_over_year_cash_flow(
    from_year: i32,
    from_month: u32,
    to_year: i32,
    to_month: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<YoyCashFlowDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let current = month_totals_for_range(&state.store, from_year, from_month, to_year, to_month, "%b")?;
    let prior_year = month_totals_for_range(&state.store, from_year - 1, from_month, to_year - 1, to_month, "%b")?;
    Ok(YoyCashFlowDto { current, prior_year })
}

#[derive(Serialize)]
pub struct ForecastPointDto {
    pub date: String,
    pub balance: String,
}

#[tauri::command]
pub fn cash_flow_forecast(days: i64, state: tauri::State<AppStateHandle>) -> Result<Vec<ForecastPointDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let points = state.store.cash_flow_forecast(today, days).map_err(|e| e.to_string())?;
    Ok(points
        .into_iter()
        .map(|p| ForecastPointDto {
            date: p.date.to_string(),
            balance: p.balance.to_string(),
        })
        .collect())
}

#[derive(Serialize)]
pub struct ForecastEventDto {
    pub date: String,
    pub label: String,
    pub amount: String,
}

#[derive(Serialize)]
pub struct BillAwareForecastDto {
    pub uses_recurring: bool,
    pub start_balance: String,
    pub points: Vec<ForecastPointDto>,
    pub events: Vec<ForecastEventDto>,
    pub daily_baseline: String,
}

/// The Cash Flow tab's Forecast and the Dashboard's "Safe to spend": cash
/// projected day by day with every active Recurring bill and paycheck placed
/// on its due date (see `Store::bill_aware_forecast`). Falls back to the
/// plain trend forecast, flagged `uses_recurring: false`, when Recurring has
/// nothing active.
#[tauri::command]
pub fn bill_aware_forecast(days: i64, state: tauri::State<AppStateHandle>) -> Result<BillAwareForecastDto, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let forecast = state.store.bill_aware_forecast(today, days).map_err(|e| e.to_string())?;
    Ok(BillAwareForecastDto {
        uses_recurring: forecast.uses_recurring,
        start_balance: forecast.start_balance.to_string(),
        points: forecast
            .points
            .into_iter()
            .map(|p| ForecastPointDto {
                date: p.date.to_string(),
                balance: p.balance.to_string(),
            })
            .collect(),
        events: forecast
            .events
            .into_iter()
            .map(|ev| ForecastEventDto {
                date: ev.date.to_string(),
                label: ev.label,
                amount: ev.amount.to_string(),
            })
            .collect(),
        daily_baseline: forecast.daily_baseline.to_string(),
    })
}

/// Average monthly spend over the trailing ~90 days — powers the
/// Dashboard's runway stat ("liquid savings ÷ average monthly spend").
#[tauri::command]
pub fn average_monthly_spend(state: tauri::State<AppStateHandle>) -> Result<String, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    state.store.average_monthly_spend(today).map(|d| d.to_string()).map_err(|e| e.to_string())
}

fn last_day_of_month(year: i32, month: u32) -> chrono::NaiveDate {
    let (next_year, next_month) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    chrono::NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .expect("a valid next month always exists for a valid year/month")
        .pred_opt()
        .expect("the day before the 1st always exists")
}

#[derive(Serialize)]
pub struct NetWorthPointDto {
    pub month_label: String,
    pub value: String,
    /// Dashboard stat-card breakdown for this same point in time — see
    /// `Store::net_worth_breakdown_as_of`. `debt` is negative-signed
    /// (credit + loan combined), matching how it's shown everywhere else.
    pub cash: String,
    pub debt: String,
    pub investments: String,
    /// The exact date this point was valued as of — lets the frontend ask
    /// `account_contribution_deltas` for "what changed" between any two
    /// points on this same series without re-deriving the date math here.
    pub as_of: String,
}

/// Net worth for each of the trailing `months` months (including the
/// current one) — past months are valued as of their last day, the
/// current month as of today, matching how a real net-worth trend should
/// read (not "as of the end of a month that hasn't happened yet").
#[tauri::command]
pub fn net_worth_history(months: u32, state: tauri::State<AppStateHandle>) -> Result<Vec<NetWorthPointDto>, String> {
    use chrono::Datelike;

    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();

    let mut year_months = Vec::with_capacity(months as usize);
    let (mut y, mut m) = (today.year(), today.month());
    for _ in 0..months {
        year_months.push((y, m));
        if m == 1 {
            m = 12;
            y -= 1;
        } else {
            m -= 1;
        }
    }
    year_months.reverse();

    let last_index = year_months.len().saturating_sub(1);
    let mut points = Vec::with_capacity(year_months.len());
    for (i, (year, month)) in year_months.into_iter().enumerate() {
        let as_of = if i == last_index { today } else { last_day_of_month(year, month) };
        let breakdown = state.store.net_worth_breakdown_as_of(as_of).map_err(|e| e.to_string())?;
        let label = chrono::NaiveDate::from_ymd_opt(year, month, 1)
            .expect("a year/month this loop generated must be valid")
            .format("%b")
            .to_string();
        points.push(NetWorthPointDto {
            month_label: label,
            value: breakdown.net_worth.to_string(),
            cash: breakdown.cash.to_string(),
            debt: breakdown.debt.to_string(),
            investments: breakdown.investments.to_string(),
            as_of: as_of.to_string(),
        });
    }
    Ok(points)
}

#[derive(Serialize)]
pub struct AccountContributionDeltaDto {
    pub account_id: i64,
    pub name: String,
    pub group: String,
    pub from_amount: String,
    pub to_amount: String,
    pub delta: String,
}

/// "What changed" behind a Dashboard stat card's trend — see
/// `Store::account_contribution_deltas`. `from`/`to` are expected to be
/// two `as_of` dates off a `net_worth_history` response, but any two
/// dates work.
#[tauri::command]
pub fn account_contribution_deltas(
    from: String,
    to: String,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<AccountContributionDeltaDto>, String> {
    let from = chrono::NaiveDate::parse_from_str(&from, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let to = chrono::NaiveDate::parse_from_str(&to, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let deltas = state.store.account_contribution_deltas(from, to).map_err(|e| e.to_string())?;
    Ok(deltas
        .into_iter()
        .map(|d| AccountContributionDeltaDto {
            account_id: d.account_id,
            name: d.name,
            group: d.group,
            from_amount: d.from_amount.to_string(),
            to_amount: d.to_amount.to_string(),
            delta: d.delta.to_string(),
        })
        .collect())
}

/// Spending by category for the current calendar month only — feeds the
/// Dashboard's spending donut, distinct from Cash Flow's multi-month
/// range version.
#[tauri::command]
pub fn spending_this_month(state: tauri::State<AppStateHandle>) -> Result<Vec<CategoryAmountDto>, String> {
    use chrono::Datelike;

    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let start_of_month = chrono::NaiveDate::from_ymd_opt(today.year(), today.month(), 1).expect("the 1st of the current month must be valid");

    Ok(state
        .store
        .spending_by_category(start_of_month, today)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(category, amount)| CategoryAmountDto {
            category,
            amount: amount.to_string(),
        })
        .collect())
}

#[derive(Serialize)]
pub struct RolledAccountDto {
    pub account_id: i64,
    pub account_name: String,
    pub new_balance: String,
}

/// Rolls every account's balance forward into a fresh monthly reset if
/// this is the first time it's happened this calendar month (see
/// `Store::roll_forward_monthly_balances`) — safe to call on every app
/// launch. Returns only the accounts that just got a *fresh* reset in
/// this call, so the UI can show a one-time "here's what changed" note
/// instead of nagging every time the app opens.
#[tauri::command]
pub fn check_monthly_rollover(state: tauri::State<AppStateHandle>) -> Result<Vec<RolledAccountDto>, String> {
    let state = state.lock().map_err(|_| "app state poisoned".to_string())?;
    let today = chrono::Local::now().date_naive();
    let rolled = state.store.roll_forward_monthly_balances(today).map_err(|e| e.to_string())?;
    Ok(rolled
        .into_iter()
        .map(|(account_id, account_name, new_balance)| RolledAccountDto {
            account_id,
            account_name,
            new_balance: new_balance.to_string(),
        })
        .collect())
}
