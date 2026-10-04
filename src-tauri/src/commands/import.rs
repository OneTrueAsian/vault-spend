//! Commands: importing files (preview, settle, commit), the sign question, and the setup-data template.

use super::*;

#[cfg(test)]
mod tests;

#[derive(Serialize, Debug)]
pub struct ImportSummary {
    pub inserted: usize,
    pub row_errors: usize,
    /// The new transactions' ids, so the app can open its review inbox on exactly them.
    pub inserted_ids: Vec<i64>,
    /// How many transfer pairs were linked automatically as part of this import
    /// (0 unless the Settings switch is on).
    pub auto_linked: usize,
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
    /// The row's own Category column, when the file has one (a bank's CSV export does) —
    /// what the file calls it, not necessarily a category the person has.
    pub category: Option<String>,
    /// The person's category the file's one matches (any casing), in their spelling.
    pub matched_category: Option<String>,
    /// What the rules or the auto-categorizer would file the row under, for every row without a
    /// `matched_category` (see `budget_core::import_resolution::row_facts`).
    pub suggestion: Option<SuggestionDto>,
}

#[derive(Serialize)]
pub struct ImportPreview {
    pub rows: Vec<ImportRow>,
    pub row_errors: usize,
    /// Category names the file uses that the person doesn't have. Nothing is created for
    /// these unless the review screen sends back a `Create` choice for them.
    pub unmatched_categories: Vec<UnmatchedCategoryDto>,
    /// A fingerprint of the file as reviewed; `commit_import` refuses a file that changed since.
    pub review_token: String,
    /// A guess less sure than this waits for the person's choice (`IMPORT_CHOICE_BELOW`).
    pub choice_below: f64,
}

/// A rule's or the auto-categorizer's answer for one row, as the review screen sees it.
#[derive(Serialize)]
pub struct SuggestionDto {
    pub category: String,
    /// "rule" or "guess" (the auto-categorizer).
    pub source: &'static str,
    pub confidence: Option<f64>,
}

impl From<budget_core::import_resolution::Suggestion> for SuggestionDto {
    fn from(s: budget_core::import_resolution::Suggestion) -> Self {
        SuggestionDto {
            category: s.category,
            source: match s.source {
                CategorySource::Rule => "rule",
                _ => "guess",
            },
            confidence: s.confidence,
        }
    }
}

#[derive(Serialize)]
pub struct UnmatchedCategoryDto {
    pub name: String,
    pub count: usize,
    /// The category the person mapped this name to on an earlier import, filled in for them.
    pub remembered_category: Option<String>,
}

/// What the review screen decided for one unmatched file category (see `commit_import`).
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum CategoryChoiceDto {
    /// File the rows under this existing category.
    MapTo { category: String },
    /// Add the file's category to the person's list.
    Create,
    /// Import the rows without a category.
    Skip,
}

impl From<CategoryChoiceDto> for ImportCategoryChoice {
    fn from(choice: CategoryChoiceDto) -> Self {
        match choice {
            CategoryChoiceDto::MapTo { category } => ImportCategoryChoice::MapTo(category),
            CategoryChoiceDto::Create => ImportCategoryChoice::Create,
            CategoryChoiceDto::Skip => ImportCategoryChoice::Skip,
        }
    }
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
#[derive(Serialize)]
pub struct ImportSignCounts {
    pub positive: usize,
    pub negative: usize,
}

/// How many of a file's amounts are positive and how many negative, as written in the file — read before
/// the "Which way do the amounts go?" question, so a credit card's export that shows charges as positive can
/// be recognised and "Flip the signs" suggested. Reads the file only; nothing is stored.
#[tauri::command]
pub fn count_import_signs(path: String) -> Result<ImportSignCounts, String> {
    let loaded = importer::load_transactions(&path, false).map_err(|e| e.to_string())?;
    Ok(ImportSignCounts {
        positive: loaded
            .transactions
            .iter()
            .filter(|t| t.amount.is_sign_positive() && !t.amount.is_zero())
            .count(),
        negative: loaded
            .transactions
            .iter()
            .filter(|t| t.amount.is_sign_negative() && !t.amount.is_zero())
            .count(),
    })
}

#[tauri::command]
pub fn preview_import(path: String, invert_amounts: bool, account_id: i64, state: tauri::State<AppStateHandle>) -> Result<ImportPreview, String> {
    let mut state = state.lock()?;
    preview_import_for(&mut state, &path, invert_amounts, account_id)
}

/// `preview_import` against an already-locked profile. A pure read: nothing is created or remembered.
fn preview_import_for(state: &mut AppState, path: &str, invert_amounts: bool, account_id: i64) -> Result<ImportPreview, String> {
    let loaded = importer::load_transactions(path, invert_amounts).map_err(|e| e.to_string())?;
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

    let (history, classifier) = build_classifier(state)?;
    let facts =
        import_resolution::row_facts(&state.store, &loaded.transactions, &state.rules, &history, Some(&classifier)).map_err(|e| e.to_string())?;
    let remembered = state.store.import_category_mappings().map_err(|e| e.to_string())?;
    let review_token = import_resolution::review_token(&loaded);
    state.import_review = Some(Box::new(ImportReview {
        token: review_token.clone(),
        facts: facts.clone(),
    }));

    let rows = loaded
        .transactions
        .iter()
        .zip(flags.iter())
        .zip(facts)
        .enumerate()
        .map(|(index, ((tx, is_duplicate), facts))| ImportRow {
            index,
            date: tx.date.to_string(),
            description: tx.description.clone(),
            amount: tx.amount.to_string(),
            is_duplicate: *is_duplicate,
            account_name: loaded.account_names.get(index).cloned().flatten(),
            category: tx.category.as_deref().map(str::trim).filter(|c| !c.is_empty()).map(str::to_string),
            matched_category: facts.matched_category,
            suggestion: facts.suggestion.map(SuggestionDto::from),
        })
        .collect();

    let unmatched_categories = state
        .store
        .unmatched_import_categories(&loaded.transactions)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|u| UnmatchedCategoryDto {
            remembered_category: remembered.get(&import_category_key(&u.name)).cloned(),
            name: u.name,
            count: u.count,
        })
        .collect();

    Ok(ImportPreview {
        rows,
        row_errors,
        unmatched_categories,
        review_token,
        choice_below: import_resolution::IMPORT_CHOICE_BELOW,
    })
}

/// Inserts exactly the rows the user chose to keep on the review screen.
/// Each row's account is: whatever the user explicitly picked for it on
/// the review screen, if anything; else the row's own Account column from
/// the file, resolved by name — case-insensitively, auto-creating a new
/// account if nothing matches, same as picking a never-before-seen name
/// when creating one by hand — so a full multi-account Transactions export
/// re-imports into the right accounts with zero manual setup; else
/// `default_account_id` (the one picked before the file was chosen), for
/// a real bank export with no Account column at all. Unlike the old
/// preview-time duplicate check, nothing here re-decides what counts as a
/// duplicate — the user already made that call by checking or unchecking
/// each row.
///
/// Every row's category is settled before anything is written (see
/// `budget_core::import_resolution`): the file's own category when it is
/// one of the person's, else the review screen's choice for that file
/// category (`category_choices`, falling back to the remembered one), else
/// a sure rule or auto-categorizer answer, else the person's `row_choices`
/// pick for that row (`None` = leave it uncategorized). An included row
/// still needing a choice, a file that changed since `review_token` was
/// issued, or any other bad input refuses the whole import, and nothing is
/// written: the import itself is one transaction.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn commit_import(
    path: String,
    invert_amounts: bool,
    default_account_id: i64,
    review_token: String,
    included_indices: Vec<usize>,
    account_overrides: std::collections::HashMap<usize, i64>,
    category_choices: Option<std::collections::HashMap<String, CategoryChoiceDto>>,
    row_choices: std::collections::HashMap<usize, Option<String>>,
    state: tauri::State<AppStateHandle>,
) -> Result<ImportSummary, String> {
    let mut state = state.lock()?;
    commit_import_for(
        &mut state,
        CommitImportRequest {
            path,
            invert_amounts,
            default_account_id,
            review_token,
            included_indices,
            account_overrides,
            category_choices,
            row_choices,
        },
    )
}

/// `commit_import`'s arguments, so the same logic runs against an already-locked profile in tests.
pub struct CommitImportRequest {
    pub path: String,
    pub invert_amounts: bool,
    pub default_account_id: i64,
    pub review_token: String,
    pub included_indices: Vec<usize>,
    pub account_overrides: std::collections::HashMap<usize, i64>,
    pub category_choices: Option<std::collections::HashMap<String, CategoryChoiceDto>>,
    /// A missing key means no choice was made; a `None` value means "Leave uncategorized".
    pub row_choices: std::collections::HashMap<usize, Option<String>>,
}

fn commit_import_for(state: &mut AppState, req: CommitImportRequest) -> Result<ImportSummary, String> {
    use budget_core::import_resolution::Automatic;
    use budget_core::store::{ImportAccount, ImportBatch, ImportBatchRow, RowCategory};

    let loaded = importer::load_transactions(&req.path, req.invert_amounts).map_err(|e| e.to_string())?;
    if import_resolution::review_token(&loaded) != req.review_token {
        return Err("This file changed. Review it again before importing.".to_string());
    }
    let mut row_errors = loaded.errors.len();

    let mut included: Vec<usize> = req.included_indices.clone();
    included.sort_unstable();
    included.dedup();
    if included.iter().any(|&i| i >= loaded.transactions.len()) {
        return Err("This import names a row the file doesn't have. Review it again before importing.".to_string());
    }

    // Every row is settled from the profile as it was before this import: the same rules,
    // history and remembered choices for the whole file.
    let sent: std::collections::HashMap<String, ImportCategoryChoice> = req
        .category_choices
        .unwrap_or_default()
        .into_iter()
        .map(|(name, choice)| (name, choice.into()))
        .collect();
    let remembered = state.store.import_category_mappings().map_err(|e| e.to_string())?;
    let panel = import_resolution::effective_panel_choices(&sent, &remembered).map_err(|e| e.to_string())?;
    for choice in panel.values() {
        if let ImportCategoryChoice::MapTo(target) = choice {
            if state.store.find_category(target).map_err(|e| e.to_string())?.is_none() {
                return Err(ImportCategoryError::UnknownCategory(target.trim().to_string()).to_string());
            }
        }
    }
    // Settled the way the review screen showed them: the preview's own results when this is the
    // file it reviewed, worked out again only when there is none (the app restarted, say).
    let facts = match state.import_review.as_ref() {
        Some(review) if review.token == req.review_token && review.facts.len() == loaded.transactions.len() => review.facts.clone(),
        _ => {
            let (history, classifier) = build_classifier(state)?;
            import_resolution::row_facts(&state.store, &loaded.transactions, &state.rules, &history, Some(&classifier)).map_err(|e| e.to_string())?
        }
    };

    let mut categories: std::collections::HashMap<usize, RowCategory> = std::collections::HashMap::new();
    let mut unsettled = 0usize;
    let mut chosen: std::collections::HashSet<usize> = std::collections::HashSet::new();
    for &index in &included {
        let category = match import_resolution::automatic(&facts[index], &panel) {
            Some(Automatic::File(_)) => RowCategory::AsFiled,
            Some(Automatic::Guess(s)) => RowCategory::Guess {
                category: s.category,
                source: s.source,
                confidence: s.confidence,
            },
            None => match req.row_choices.get(&index) {
                None => {
                    unsettled += 1;
                    continue;
                }
                Some(pick) => {
                    chosen.insert(index);
                    match pick {
                        None => RowCategory::LeaveUncategorized,
                        Some(name) => match state.store.find_category(name).map_err(|e| e.to_string())? {
                            Some(spelling) => RowCategory::Chosen(spelling),
                            None => return Err(ImportCategoryError::UnknownCategory(name.trim().to_string()).to_string()),
                        },
                    }
                }
            },
        };
        categories.insert(index, category);
    }
    if unsettled > 0 {
        let rows = if unsettled == 1 {
            "1 more row".to_string()
        } else {
            format!("{unsettled} more rows")
        };
        return Err(format!("Choose a category for {rows}, or leave them uncategorized."));
    }
    // A pick for a row that is unchecked, or that no longer needs one, is a stale screen: refuse it
    // rather than let it override the file's own category or the screen's file-category choice.
    if req.row_choices.keys().any(|i| !chosen.contains(i)) {
        return Err("Some choices no longer match this import. Review it again before importing.".to_string());
    }

    let mut batch = ImportBatch {
        sign_preference: Some((req.default_account_id, req.invert_amounts)),
        ..ImportBatch::default()
    };
    // Each unfamiliar file category the included rows use, by key, in the file's first spelling.
    let mut used_names: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();
    for &index in &included {
        // A row whose note is over the limit is skipped, like any other unreadable row, before
        // anything is written ("skip the bad row, keep the rest").
        let note_ok = loaded
            .notes
            .get(index)
            .and_then(|o| o.as_deref())
            .is_none_or(|n| n.trim().chars().count() <= NOTES_MAX_CHARS);
        if !note_ok {
            row_errors += 1;
            continue;
        }
        let row_facts = &facts[index];
        let category = categories.remove(&index).expect("every included row was settled above");
        if row_facts.matched_category.is_none() {
            if let Some(name) = &row_facts.file_category {
                used_names.entry(import_category_key(name)).or_insert_with(|| name.clone());
            }
        }
        let mut transaction = loaded.transactions[index].clone();
        transaction.category = match (&category, import_resolution::automatic(row_facts, &panel)) {
            (RowCategory::AsFiled, Some(Automatic::File(name))) => Some(name),
            _ => None,
        };
        let account = if let Some(explicit) = req.account_overrides.get(&index).copied() {
            ImportAccount::Existing(explicit)
        } else if let Some(name) = loaded.account_names.get(index).and_then(|o| o.as_deref()) {
            ImportAccount::Named(name.to_string())
        } else {
            ImportAccount::Existing(req.default_account_id)
        };
        batch.rows.push(ImportBatchRow {
            account,
            transaction,
            tags: loaded.tags.get(index).cloned().unwrap_or_default(),
            notes: loaded.notes.get(index).cloned().flatten(),
            category,
        });
    }
    // Only names the screen actually decided, for rows being imported, change what is remembered:
    // "use one of mine" is remembered, "let the app guess" forgets, "add it" needs no memory.
    for (key, name) in &used_names {
        if let Some(choice) = sent.iter().find(|(n, _)| import_category_key(n) == *key).map(|(_, c)| c) {
            match choice {
                ImportCategoryChoice::MapTo(target) => batch.remember.push((name.clone(), target.clone())),
                ImportCategoryChoice::Skip => batch.forget.push(name.clone()),
                ImportCategoryChoice::Create => {}
            }
        }
        if let Some(ImportCategoryChoice::Create) = panel.get(key) {
            batch.create_categories.push(name.clone());
        }
    }

    let outcome = state.store.commit_import_batch(&batch).map_err(|e| e.to_string())?;
    state.import_review = None;
    // The stored rules already have them; the in-memory ones learn only now that the import is saved.
    for (description, category) in &outcome.taught {
        learner::learn_from_correction(&mut state.rules, description, category);
    }

    // The usual passes over older rows run after the import is saved and never undo it: a failure
    // here only goes to the log, since the import itself already succeeded. This import's own rows
    // are left out, so a row the person left uncategorized stays that way.
    let just_imported: std::collections::HashSet<i64> = outcome.inserted_ids.iter().copied().collect();
    if let Err(e) = categorize_uncategorized_except(state, &just_imported) {
        eprintln!("import saved; categorizing older rows failed: {e}");
    }
    let auto_linked = match state.store.auto_link_transfers_if_enabled() {
        Ok(linked) => linked.len(),
        Err(e) => {
            eprintln!("import saved; linking transfers failed: {e}");
            0
        }
    };

    Ok(ImportSummary {
        inserted: outcome.inserted_ids.len(),
        row_errors,
        inserted_ids: outcome.inserted_ids,
        auto_linked,
    })
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
