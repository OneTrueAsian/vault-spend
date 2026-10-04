use budget_core::categorizer;
use budget_core::classifier::Classifier;
use budget_core::import_resolution;
use budget_core::importer;
use budget_core::learner;
use budget_core::models::AccountType;
use budget_core::rules::RuleSet;
use budget_core::store::{import_category_key, CategorySource, ImportCategoryChoice, ImportCategoryError, Store, NOTES_MAX_CHARS};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
mod files;
pub use self::files::*;
mod system;
pub use self::system::*;
mod profiles;
pub use self::profiles::*;
mod import;
pub use self::import::*;
mod transactions;
pub use self::transactions::*;
mod categories;
pub use self::categories::*;
mod accounts;
pub use self::accounts::*;
mod budgets;
pub use self::budgets::*;
mod reports;
pub use self::reports::*;
mod recurring;
pub use self::recurring::*;
mod investments;
pub use self::investments::*;
mod assets;
pub use self::assets::*;

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
/// differ from what `startup::open_from_disk` opened at launch, since
/// `relocate_data_file`/`restore_backup` update it in place rather than
/// requiring a restart. A poisoned lock (only possible if an earlier panic
/// happened mid-update) still yields a usable path rather than taking down
/// every command that reads it.
fn current_db_path(paths: &crate::config::AppPaths) -> std::path::PathBuf {
    paths.db_path.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// The registry id of the profile this session has open (`"default"` before any profile was created).
fn active_profile_id(paths: &crate::config::AppPaths) -> String {
    crate::profiles::profile_id_for(&paths.config_path, &current_db_path(paths))
}

struct ValidatedProtectedPackage {
    manifest: budget_core::protection::PackageManifest,
    key_file: budget_core::protection::keyfile::KeyFile,
    dek: budget_core::protection::keyfile::UnlockedKey,
}

fn validate_protected_package(package_dir: &std::path::Path, password: &str) -> Result<ValidatedProtectedPackage, String> {
    use budget_core::protection::package::{sha256_file, DATABASE_FILENAME, MANIFEST_FILENAME};
    use budget_core::protection::PACKAGE_FORMAT;

    if !package_dir.is_dir() {
        return Err(format!("{} isn't a Vault Spend package folder.", package_dir.display()));
    }
    let manifest = budget_core::protection::PackageManifest::from_json(
        &std::fs::read_to_string(package_dir.join(MANIFEST_FILENAME)).map_err(|e| format!("couldn't read this package's manifest: {e}"))?,
    )?;
    if manifest.format != PACKAGE_FORMAT {
        return Err(format!(
            "This package uses format {}, but this Vault Spend supports format {PACKAGE_FORMAT}.",
            manifest.format
        ));
    }
    let database_path = package_dir.join(DATABASE_FILENAME);
    let actual_hash = sha256_file(&database_path).map_err(|e| format!("couldn't read this package's database: {e}"))?;
    if actual_hash != manifest.database_sha256 {
        return Err("This package's database doesn't match its manifest. It may be damaged or incomplete.".to_string());
    }
    if !budget_core::store::file_looks_encrypted(&database_path).map_err(|e| e.to_string())? {
        return Err("This protected package contains a plaintext database.".to_string());
    }
    let key_file_path = budget_core::protection::keyfile::key_file_path_for(&database_path);
    let key_file = budget_core::protection::keyfile::KeyFile::read(&key_file_path).map_err(|e| e.to_string())?;
    if key_file.format != manifest.protection_format {
        return Err("This package's protection information doesn't match its manifest.".to_string());
    }
    let dek = key_file
        .unlock_with_password(password)
        .map_err(|_| "That password didn't work.".to_string())?;
    Ok(ValidatedProtectedPackage { manifest, key_file, dek })
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
    /// The last import preview's per-row results, so `commit_import` settles the rows exactly as
    /// the review screen showed them (and runs the categorizer once, not twice). Only ever set
    /// here by `preview_import`; the screen can't supply it.
    pub import_review: Option<Box<ImportReview>>,
}

/// One import preview, as `commit_import` reuses it: the file's review token and each row's facts.
pub struct ImportReview {
    pub token: String,
    pub facts: Vec<import_resolution::RowFacts>,
}

pub type AppStateHandle = crate::runtime::AppRuntime;

impl AppState {
    pub fn open(db_path: impl AsRef<std::path::Path>) -> Result<Self, String> {
        let store = Store::open(db_path).map_err(|e| e.to_string())?;
        // The starter rules are persisted once (see
        // `Store::seed_default_rules_once`) rather than faked in memory
        // whenever the table is empty, so the rules manager can show and
        // delete every one of them and "delete them all" sticks.
        store.seed_default_rules_once().map_err(|e| e.to_string())?;
        let rules = store.load_rules().map_err(|e| e.to_string())?;
        Ok(AppState {
            store,
            rules,
            import_review: None,
        })
    }

    /// The keyed counterpart to `open`, used once a password has unwrapped a profile's database
    /// key (Phase C). Refuses a missing file rather than silently creating one — see
    /// `budget_core::store::encryption::Store::open_with_key`'s own doc comment.
    pub fn open_with_key(db_path: impl AsRef<std::path::Path>, key: budget_core::store::DatabaseKey<'_>) -> Result<Self, String> {
        let store = Store::open_with_key(db_path, key).map_err(|e| e.to_string())?;
        store.seed_default_rules_once().map_err(|e| e.to_string())?;
        let rules = store.load_rules().map_err(|e| e.to_string())?;
        Ok(AppState {
            store,
            rules,
            import_review: None,
        })
    }
}

/// The labeled history (what the classifier trains on, and what tells a rule whether its merchant has
/// been filed under more than one category) together with the classifier trained from it.
fn build_classifier(state: &AppState) -> Result<(Vec<(String, String)>, Classifier), String> {
    let history = state.store.labeled_history().map_err(|e| e.to_string())?;
    let examples: Vec<(&str, &str)> = history.iter().map(|(d, c)| (d.as_str(), c.as_str())).collect();
    let classifier = Classifier::train(&examples);
    Ok((history, classifier))
}

/// Runs the categorizer over every transaction that doesn't have a category
/// yet, persisting whatever it decides. Shared by import and by anything
/// else that adds uncategorized rows.
/// Returns the ids of every row it actually assigned a category to, so
/// callers that need to show the user exactly what changed (see
/// `recategorize_uncategorized`) don't have to separately diff the transactions.
fn categorize_uncategorized(state: &mut AppState) -> Result<Vec<i64>, String> {
    categorize_uncategorized_except(state, &std::collections::HashSet::new())
}

/// `categorize_uncategorized`, leaving the rows in `skip` alone (an import's own rows, already settled).
fn categorize_uncategorized_except(state: &mut AppState, skip: &std::collections::HashSet<i64>) -> Result<Vec<i64>, String> {
    let (history, classifier) = build_classifier(state)?;
    let all = state.store.all_transactions().map_err(|e| e.to_string())?;
    let mut categorized_ids = Vec::new();
    for stored in all {
        if stored.transaction.category.is_some() || skip.contains(&stored.id) {
            continue;
        }
        if let Some((category, source, confidence)) =
            categorizer::categorize(&stored.transaction.description, &state.rules, &history, Some(&classifier))
        {
            // A guess is only ever filed under a category the person already has — it must
            // not add one to their list.
            let applied = state
                .store
                .set_category_if_registered(stored.id, &category, source, confidence)
                .map_err(|e| e.to_string())?;
            if applied {
                categorized_ids.push(stored.id);
            }
        }
    }
    Ok(categorized_ids)
}

fn refresh_open_reminders(store: &Store, paths: &crate::config::AppPaths, device: &crate::device_settings::DeviceSettingsStore) {
    if crate::background::refresh_reminder_index(
        &paths.config_path,
        &current_db_path(paths),
        store,
        device,
        chrono::Local::now().date_naive(),
    )
    .is_err()
    {
        eprintln!("Could not refresh bill reminders after a recurring change.");
    }
}
