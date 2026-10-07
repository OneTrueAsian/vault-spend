//! Commands: budgets, goals (buckets), month reviews and budget alerts.

use super::*;

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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
/// `Store::apply_sinking_fund_contributions`. The page calls this when a
/// bucket gains a sinking amount so it takes effect right away; the run that
/// happens as a profile opens is `maintenance::run_open_profile_maintenance`.
#[tauri::command]
pub fn check_sinking_fund_contributions(state: tauri::State<AppStateHandle>) -> Result<Vec<SinkingFundContributionDto>, String> {
    let state = state.lock()?;
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

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SinkingFundContributionDto {
    pub bucket_id: i64,
    pub bucket_name: String,
    pub amount: String,
}

#[tauri::command]
pub fn set_bucket_member(id: i64, member_id: Option<i64>, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
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
    let state = state.lock()?;
    let date = parse_date(&date)?;
    let amount = parse_amount(&amount)?;
    state
        .store
        .add_bucket_contribution(bucket_id, date, amount, note.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_bucket(id: i64, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
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
    let state = state.lock()?;
    let monthly_amount = parse_amount(&monthly_amount)?;
    state
        .store
        .set_budget(&category, &period, monthly_amount, &budget_group)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_budget(category: String, period: String, state: tauri::State<AppStateHandle>) -> Result<(), String> {
    let state = state.lock()?;
    state.store.delete_budget(&category, &period).map_err(|e| e.to_string())
}

/// Budget-vs-actual for an arbitrary month, for the Budget page's
/// prev/next month navigation — `get_report` above is deliberately
/// pinned to the current month for the Reports dashboard.
#[tauri::command]
pub fn budget_actuals_for_month(year: i32, month: u32, state: tauri::State<AppStateHandle>) -> Result<Vec<ReportBudgetLineDto>, String> {
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
    state.store.set_month_reviewed(year, month).map_err(|e| e.to_string())
}

/// Every month whose review was finished, as "YYYY-MM".
#[tauri::command]
pub fn list_reviewed_months(state: tauri::State<AppStateHandle>) -> Result<Vec<String>, String> {
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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

#[tauri::command]
pub fn spending_transactions_for_category(
    category: String,
    year: i32,
    month: u32,
    state: tauri::State<AppStateHandle>,
) -> Result<Vec<CategoryTransactionDto>, String> {
    if chrono::NaiveDate::from_ymd_opt(year, month, 1).is_none() {
        return Err("invalid month".to_string());
    }
    let state = state.lock()?;
    state
        .store
        .spending_transactions_for_category_in_month(&category, year, month)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|t| {
            Ok(CategoryTransactionDto {
                transaction_id: t.transaction_id,
                date: t.date.to_string(),
                description: t.description,
                amount: t.amount.to_string(),
                account_name: t.account_name,
                is_split: t.is_split,
                split_note: t.split_note,
            })
        })
        .collect()
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
    let state = state.lock()?;
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
