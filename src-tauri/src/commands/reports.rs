//! Commands: reports, insights, debt payoff, cash flow, forecasts and net worth.

use super::*;

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

#[tauri::command]
pub fn get_report(state: tauri::State<AppStateHandle>) -> Result<ReportDto, String> {
    use chrono::Datelike;

    let state = state.lock()?;
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

#[derive(Serialize)]
pub struct InsightDto {
    pub severity: String,
    pub kind: String,
    pub message: String,
}

#[tauri::command]
pub fn dashboard_insights(state: tauri::State<AppStateHandle>) -> Result<Vec<InsightDto>, String> {
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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

    let state = state.lock()?;
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
    let state = state.lock()?;
    cash_flow_for_store(&state.store, from_year, from_month, to_year, to_month)
}

pub(super) fn cash_flow_for_store(store: &Store, from_year: i32, from_month: u32, to_year: i32, to_month: u32) -> Result<CashFlowDto, String> {
    let month_totals = month_totals_for_range(store, from_year, from_month, to_year, to_month, "%b '%y")?;

    let mut total_income = Decimal::ZERO;
    let mut total_expense = Decimal::ZERO;
    for line in &month_totals {
        total_income += Decimal::from_str(&line.income).map_err(|_| "invalid income total".to_string())?;
        total_expense += Decimal::from_str(&line.expense).map_err(|_| "invalid expense total".to_string())?;
    }

    let start_date =
        chrono::NaiveDate::from_ymd_opt(from_year, from_month, 1).ok_or_else(|| format!("invalid start month: {from_year:04}-{from_month:02}"))?;
    let end_date = last_day_of_month(to_year, to_month);

    let top_categories = store
        .spending_by_category(start_date, end_date)
        .map_err(|e| e.to_string())?
        .into_iter()
        .take(6)
        .map(|(category, amount)| CategoryAmountDto {
            category,
            amount: amount.to_string(),
        })
        .collect();
    let top_merchants = store
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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
    let state = state.lock()?;
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

    let state = state.lock()?;
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
    let state = state.lock()?;
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

    let state = state.lock()?;
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
