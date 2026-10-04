//! Commands: recurring bills and income, their matches and suggestions.

use super::*;

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

#[tauri::command]
#[allow(clippy::too_many_arguments)] // recurring fields plus managed runtime/cache state
pub fn create_recurring(
    merchant: String,
    category: Option<String>,
    amount: String,
    cadence: String,
    anchor_date: String,
    account_id: Option<i64>,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
) -> Result<i64, String> {
    let state = state.lock()?;
    let amount = parse_amount(&amount)?;
    let anchor_date = parse_date(&anchor_date)?;
    let result = state
        .store
        .create_recurring(&merchant, category.as_deref(), amount, &cadence, anchor_date, account_id)
        .map_err(|e| e.to_string())?;
    refresh_open_reminders(&state.store, &paths, &device);
    Ok(result)
}

#[tauri::command]
pub fn list_recurring(state: tauri::State<AppStateHandle>) -> Result<Vec<RecurringDto>, String> {
    let state = state.lock()?;
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
pub fn delete_recurring(
    id: i64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
) -> Result<(), String> {
    let state = state.lock()?;
    state.store.delete_recurring(id).map_err(|e| e.to_string())?;
    refresh_open_reminders(&state.store, &paths, &device);
    Ok(())
}

#[tauri::command]
pub fn set_recurring_status(
    id: i64,
    status: String,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
) -> Result<(), String> {
    let state = state.lock()?;
    state.store.set_recurring_status(id, &status).map_err(|e| e.to_string())?;
    refresh_open_reminders(&state.store, &paths, &device);
    Ok(())
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
) -> Result<(), String> {
    let state = state.lock()?;
    let amount = parse_amount(&amount)?;
    let anchor_date = parse_date(&anchor_date)?;
    state
        .store
        .update_recurring(id, &merchant, category.as_deref(), amount, &cadence, anchor_date, account_id)
        .map_err(|e| e.to_string())?;
    refresh_open_reminders(&state.store, &paths, &device);
    Ok(())
}

#[tauri::command]
pub fn set_recurring_member(
    id: i64,
    member_id: Option<i64>,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
    device: tauri::State<crate::device_settings::DeviceSettingsStore>,
) -> Result<(), String> {
    let state = state.lock()?;
    state.store.set_recurring_member(id, member_id).map_err(|e| e.to_string())?;
    refresh_open_reminders(&state.store, &paths, &device);
    Ok(())
}

#[tauri::command]
pub fn list_recurring_candidates(state: tauri::State<AppStateHandle>) -> Result<Vec<RecurringCandidateDto>, String> {
    let state = state.lock()?;
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
    let state = state.lock()?;
    let amount = parse_amount(&amount)?;
    state
        .store
        .dismiss_recurring_candidate(&merchant, amount, &cadence)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dismiss_recurring_price_change(id: i64, from: String, to: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state
        .store
        .dismiss_recurring_price_change(id, parse_amount(&from)?, parse_amount(&to)?)
        .map_err(|e| e.to_string())
}
