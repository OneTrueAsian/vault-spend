//! Commands: the ledger — listing, editing, splitting, tagging, transfers, bulk changes and review flags.

use super::*;

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
    pub notes: Option<String>,
}

#[derive(Serialize)]
pub struct AppliedDebtPaymentDto {
    pub date: String,
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
pub struct Stats {
    pub total: usize,
    pub auto_categorized: usize,
    pub user_confirmed: usize,
    pub uncategorized: usize,
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
    let mut state = state.lock()?;
    categorize_uncategorized(&mut state)
}

#[derive(Serialize)]
pub struct FlipSignsDto {
    pub flipped: usize,
    pub account_ids: Vec<i64>,
}

/// The Transactions tab's "Flip signs…" bulk action: see `Store::flip_transaction_signs`. A refusal (a
/// linked transfer or applied debt payment in the selection) comes back as an error that says what to do.
#[tauri::command]
pub fn flip_transaction_signs(ids: Vec<i64>, state: tauri::State<AppStateHandle>) -> Result<FlipSignsDto, String> {
    let state = state.lock()?;
    let summary = state.store.flip_transaction_signs(&ids).map_err(|e| e.to_string())?;
    Ok(FlipSignsDto {
        flipped: summary.flipped,
        account_ids: summary.account_ids,
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
#[allow(clippy::too_many_arguments)]
pub fn create_manual_transaction(
    account_id: i64,
    date: String,
    description: String,
    amount: String,
    category: Option<String>,
    member_id: Option<i64>,
    notes: Option<String>,
    state: tauri::State<AppStateHandle>,
) -> Result<i64, String> {
    let mut state = state.lock()?;
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
    let id = state
        .store
        .create_transaction(account_id, &tx, notes.as_deref())
        .map_err(|e| e.to_string())?;
    if !has_category {
        categorize_uncategorized(&mut state)?;
    }
    if let Some(member_id) = member_id {
        state.store.set_transaction_member(id, Some(member_id)).map_err(|e| e.to_string())?;
    }
    // (When the switch is on, an entry that completes a transfer is linked now;
    // the app finds out from the review list.)
    state.store.auto_link_transfers_if_enabled().map_err(|e| e.to_string())?;
    Ok(id)
}

pub(super) fn transaction_dto(s: budget_core::store::StoredTransaction) -> TransactionDto {
    TransactionDto {
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
            date: d.date.to_string(),
            debt_account_id: d.debt_account_id,
            debt_account_name: d.debt_account_name,
            amount: d.amount.to_string(),
        }),
        principal_amount: s.principal_amount.map(|a| a.to_string()),
        split_count: s.split_count,
        tags: s.tags,
        member_id: s.member_id,
        member_name: s.member_name,
        notes: s.notes,
    }
}

#[tauri::command]
pub fn list_transactions(state: tauri::State<AppStateHandle>) -> Result<Vec<TransactionDto>, String> {
    let state = state.lock()?;
    let stored = state.store.all_transactions().map_err(|e| e.to_string())?;
    Ok(stored.into_iter().map(transaction_dto).collect())
}

/// The listed transactions as `list_transactions` shows them (gone or unknown ids are left out) — what
/// the page re-reads after editing a few rows, instead of every transaction.
#[tauri::command]
pub fn list_transactions_by_ids(ids: Vec<i64>, state: tauri::State<AppStateHandle>) -> Result<Vec<TransactionDto>, String> {
    let state = state.lock()?;
    let stored = state.store.transactions_by_ids(&ids).map_err(|e| e.to_string())?;
    Ok(stored.into_iter().map(transaction_dto).collect())
}

#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct TransferCandidateDto {
    pub out_id: i64,
    pub in_id: i64,
}

/// Pairs of transactions that look like the two legs of one transfer
/// between the user's own accounts (equal amounts, opposite directions,
/// different accounts, within 3 days) and aren't linked yet.
#[tauri::command]
pub fn list_transfer_candidates(state: tauri::State<AppStateHandle>) -> Result<Vec<TransferCandidateDto>, String> {
    let state = state.lock()?;
    let candidates = state.store.transfer_candidates().map_err(|e| e.to_string())?;
    Ok(candidates
        .into_iter()
        .map(|c| TransferCandidateDto {
            out_id: c.out_id,
            in_id: c.in_id,
        })
        .collect())
}

/// Transfer pairs the app linked on its own (the Settings switch) that no one
/// has marked "looks right" yet — the review report. Each pair is identified by
/// its outgoing leg.
#[tauri::command]
pub fn list_auto_linked_transfers(state: tauri::State<AppStateHandle>) -> Result<Vec<TransferCandidateDto>, String> {
    let state = state.lock()?;
    let linked = state.store.auto_linked_transfers_to_review().map_err(|e| e.to_string())?;
    Ok(linked
        .into_iter()
        .map(|c| TransferCandidateDto {
            out_id: c.out_id,
            in_id: c.in_id,
        })
        .collect())
}

/// "Looks right": takes the given automatic links (by outgoing leg) off the
/// review list. The links stay. Returns how many were marked.
#[tauri::command]
pub fn mark_auto_links_reviewed(out_ids: Vec<i64>, state: tauri::State<AppStateHandle>) -> Result<usize, String> {
    let state = state.lock()?;
    state.store.mark_transfer_links_reviewed(&out_ids).map_err(|e| e.to_string())
}

/// The complete current set of possible transfer pairs, including
/// alternates hidden by `list_transfer_candidates`' one-match-per-transaction
/// reduction — what "Dismiss all" dismisses, so it really clears the list.
#[tauri::command]
pub fn list_all_transfer_candidate_pairs(state: tauri::State<AppStateHandle>) -> Result<Vec<TransferCandidateDto>, String> {
    let state = state.lock()?;
    let pairs = state.store.list_all_transfer_candidate_pairs().map_err(|e| e.to_string())?;
    Ok(pairs
        .into_iter()
        .map(|c| TransferCandidateDto {
            out_id: c.out_id,
            in_id: c.in_id,
        })
        .collect())
}

/// Tells Vault Spend to stop suggesting these exact pairs as transfers.
/// Never touches either transaction's data or totals. Returns only the
/// pairs newly dismissed (already-dismissed pairs in the batch are
/// omitted), for the frontend's Undo to restore exactly those.
#[tauri::command]
pub fn dismiss_transfer_candidates(
    pairs: Vec<TransferCandidateDto>,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<TransferCandidateDto>, String> {
    let state = state.lock()?;
    let pairs: Vec<(i64, i64)> = pairs.into_iter().map(|p| (p.out_id, p.in_id)).collect();
    let newly = state.store.dismiss_transfer_candidates(&pairs).map_err(|e| e.to_string())?;
    Ok(newly
        .into_iter()
        .map(|c| TransferCandidateDto {
            out_id: c.out_id,
            in_id: c.in_id,
        })
        .collect())
}

/// Undoes the named dismissals (Undo after `dismiss_transfer_candidates`).
#[tauri::command]
pub fn restore_transfer_candidates(pairs: Vec<TransferCandidateDto>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    let pairs: Vec<(i64, i64)> = pairs.into_iter().map(|p| (p.out_id, p.in_id)).collect();
    state.store.restore_transfer_candidates(&pairs).map_err(|e| e.to_string())
}

/// Links two transactions as the two legs of one transfer, so neither
/// counts as income or spending.
#[tauri::command]
pub fn link_transfer(a: i64, b: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
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
    let state = state.lock()?;
    state.store.unlink_transfer(transaction_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_tag(transaction_id: i64, tag: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.add_tag(transaction_id, &tag).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_tag(transaction_id: i64, tag: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.remove_tag(transaction_id, &tag).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_all_tags(state: tauri::State<AppStateHandle>) -> Result<Vec<String>, String> {
    let state = state.lock()?;
    state.store.list_all_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_transaction_member(id: i64, member_id: Option<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.set_transaction_member(id, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn bulk_set_transaction_member(ids: Vec<i64>, member_id: Option<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.bulk_set_transaction_member(&ids, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_transaction_splits(transaction_id: i64, state: tauri::State<AppStateHandle>) -> Result<Vec<TransactionSplitDto>, String> {
    let state = state.lock()?;
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
    let state = state.lock()?;
    let splits = splits
        .into_iter()
        .map(|(category, amount, note)| Ok((category, parse_amount(&amount)?, note)))
        .collect::<Result<Vec<_>, String>>()?;
    state.store.set_transaction_splits(transaction_id, &splits).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn correct_category(id: i64, category: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let mut state = state.lock()?;

    let description = state
        .store
        .transaction_description(id)
        .map_err(|e| e.to_string())?
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
    let mut state = state.lock()?;

    for id in ids {
        let Some(description) = state.store.transaction_description(id).map_err(|e| e.to_string())? else {
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
    let state = state.lock()?;
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
pub fn bulk_create_recurring_from_transactions(
    ids: Vec<i64>,
    cadence: String,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
) -> Result<usize, String> {
    let state = state.lock()?;
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
        refresh_open_reminders(&state.store, &paths, &device);
        created += 1;
    }
    Ok(created)
}

#[tauri::command]
pub fn update_transaction_amount(id: i64, amount: String, state: tauri::State<AppStateHandle>) -> Result<bool, String> {
    let state = state.lock()?;
    let amount = parse_amount(&amount)?;
    state.store.update_transaction_amount(id, amount).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_transaction_principal_amount(id: i64, principal_amount: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    let principal_amount = principal_amount.map(|a| parse_amount(&a)).transpose()?;
    state
        .store
        .update_transaction_principal_amount(id, principal_amount)
        .map_err(|e| e.to_string())
}

/// Sets, changes or clears (`null`) a transaction's own freeform note. See
/// `Store::update_transaction_notes` for the validation/whitespace rules
/// and why a missing/deleted transaction is a real error here, not a
/// silent no-op like most `update_transaction_*` commands.
#[tauri::command]
pub fn update_transaction_notes(transaction_id: i64, notes: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state
        .store
        .update_transaction_notes(transaction_id, notes.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_transaction_account(id: i64, account_id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.update_transaction_account(id, account_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_transaction_date(id: i64, date: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    let date = parse_date(&date)?;
    state.store.update_transaction_date(id, date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_transaction_description(id: i64, description: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
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
    let state = state.lock()?;
    let now = chrono::Local::now().naive_local();
    state.store.delete_transaction(id, now).map_err(|e| e.to_string())
}

/// Undoes `delete_transaction`/`bulk_delete_transactions` — the Transactions
/// tab's bulk-delete "Undo" toast calls this with exactly the ids it was told
/// were deleted.
#[tauri::command]
pub fn restore_transactions(ids: Vec<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
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
    let state = state.lock()?;
    let amount = parse_amount(&amount)?;
    let date = parse_date(&date)?;
    state
        .store
        .apply_debt_payment(source_transaction_id, debt_account_id, amount, date)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unapply_debt_payment(source_transaction_id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.unapply_debt_payment(source_transaction_id).map_err(|e| e.to_string())
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
    let state = state.lock()?;
    state.store.dismiss_anomaly(transaction_id, &kind).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_anomaly_flags(state: tauri::State<AppStateHandle>) -> Result<Vec<AnomalyFlagDto>, String> {
    let state = state.lock()?;
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
    let state = state.lock()?;
    // Counted in SQL rather than by loading every transaction (see `Store::category_counts` for what
    // each count means: "needs a category" is exactly "no category name").
    let counts = state.store.category_counts().map_err(|e| e.to_string())?;
    Ok(Stats {
        total: counts.total,
        auto_categorized: counts.auto_categorized,
        user_confirmed: counts.user_confirmed,
        uncategorized: counts.uncategorized,
    })
}
