//! Commands: accounts, household members, balance history and reconciling.

use super::*;

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
    /// The "Flip the signs" answer from the last import into this account
    /// (see `StoredAccount::import_flip_signs`) — `None` before the first.
    pub import_flip_signs: Option<bool>,
}

#[derive(Serialize)]
pub struct FamilyMemberDto {
    pub id: i64,
    pub name: String,
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
    let state = state.lock()?;
    let account_type = AccountType::parse(&account_type).unwrap_or(AccountType::Other);
    // Validated *before* the account is created — an invalid balance must
    // fail cleanly with nothing written, not leave a zero-balance orphan
    // account behind because validation happened after the first write in
    // this sequence of otherwise-separate calls.
    let starting_balance = starting_balance.map(|b| parse_amount(&b)).transpose()?;
    // Never reuse an account with the same name: the balance and details below would overwrite it.
    let Some(id) = state.store.create_account(&name, account_type).map_err(|e| e.to_string())? else {
        return Err(format!(
            "You already have an account called \"{}\". Choose a different name.",
            name.trim()
        ));
    };
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
    let state = state.lock()?;
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
            import_flip_signs: a.import_flip_signs,
        })
        .collect())
}

#[tauri::command]
pub fn set_account_interest_rate(id: i64, rate: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    let rate = rate.map(|r| parse_amount(&r)).transpose()?;
    state.store.set_account_interest_rate(id, rate).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_excluded_from_debt_payoff(id: i64, excluded: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.set_account_excluded_from_debt_payoff(id, excluded).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_details(id: i64, institution: Option<String>, mask: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state
        .store
        .set_account_details(id, institution.as_deref(), mask.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_starting_balance(id: i64, balance: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    let balance = parse_amount(&balance)?;
    state.store.set_account_starting_balance(id, balance).map_err(|e| e.to_string())
}

/// Corrects an account's current balance as of today, without touching any
/// existing transaction — see `Store::set_account_balance_override`.
#[tauri::command]
pub fn set_account_balance_override(id: i64, balance: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    let balance = parse_amount(&balance)?;
    let today = chrono::Local::now().date_naive();
    state.store.set_account_balance_override(id, balance, today).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_account_type(id: i64, account_type: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    let account_type = AccountType::parse(&account_type).unwrap_or(AccountType::Other);
    state.store.update_account_type(id, account_type).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_icon(id: i64, icon_key: Option<String>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.set_account_icon(id, icon_key.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_account(id: i64, state: tauri::State<AppStateHandle>) -> Result<usize, String> {
    let state = state.lock()?;
    state.store.delete_account(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_account_member(id: i64, member_id: Option<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.set_account_member(id, member_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_family_member(name: String, state: tauri::State<AppStateHandle>) -> Result<i64, String> {
    let state = state.lock()?;
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
    let state = state.lock()?;
    let members = state.store.list_family_members().map_err(|e| e.to_string())?;
    Ok(members.into_iter().map(|m| FamilyMemberDto { id: m.id, name: m.name }).collect())
}

#[tauri::command]
pub fn rename_family_member(id: i64, new_name: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.rename_family_member(id, &new_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_family_member(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.delete_family_member(id).map_err(|e| e.to_string())
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
    let state = state.lock()?;
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
    pub payment_source_id: Option<i64>,
    pub payment_source_account_id: Option<i64>,
    pub payment_source_account_name: Option<String>,
    pub payment_source_date: Option<String>,
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
            payment_source_id: t.payment_source_id,
            payment_source_account_id: t.payment_source_account_id,
            payment_source_account_name: t.payment_source_account_name,
            payment_source_date: t.payment_source_date.map(|date| date.to_string()),
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
    let state = state.lock()?;
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
    let state = state.lock()?;
    let date = parse_date(&statement_date)?;
    let rows = state.store.reconcile_candidates(account_id, date).map_err(|e| e.to_string())?;
    Ok(account_transaction_dtos(rows))
}

#[tauri::command]
pub fn set_transactions_cleared(ids: Vec<i64>, cleared: bool, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
    let last = state.store.last_reconciliation(account_id).map_err(|e| e.to_string())?;
    Ok(last.map(|(date, balance)| LastReconciliationDto {
        statement_date: date.to_string(),
        statement_balance: balance.to_string(),
    }))
}
