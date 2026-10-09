//! Coherent, session-bound Budget/Household and Reports aggregate reads.
use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FinancialContext {
    contract_version: u8,
    generation: u64,
    session_revision: u64,
}
#[derive(Serialize)]
struct FinancialRevision {
    local: u64,
    external: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetSnapshot {
    contract_version: u8,
    context: FinancialContext,
    revision: FinancialRevision,
    year: i32,
    month: u32,
    actuals: Vec<ReportBudgetLineDto>,
    alerts: Vec<BudgetAlertDto>,
    flow: CashFlowDto,
    members: Vec<MemberBudgetActualDto>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRangeSnapshot {
    contract_version: u8,
    context: FinancialContext,
    revision: FinancialRevision,
    from_year: i32,
    from_month: u32,
    to_year: i32,
    to_month: u32,
    cells: Vec<CategoryMonthAmountDto>,
    flow: CashFlowDto,
    daily: Vec<DailySpendAmountDto>,
}
fn valid_range(from_year: i32, from_month: u32, to_year: i32, to_month: u32) -> Result<(), ReadError> {
    let from = chrono::NaiveDate::from_ymd_opt(from_year, from_month, 1);
    let to = chrono::NaiveDate::from_ymd_opt(to_year, to_month, 1);
    let span = i64::from(to_year) * 12 + i64::from(to_month) - i64::from(from_year) * 12 - i64::from(from_month);
    if !(1..=9999).contains(&from_year) || !(1..=9999).contains(&to_year) || from.is_none() || to.is_none() || !(0..1200).contains(&span) {
        return Err(ReadError::new("invalid_argument", "Choose a valid ordered range of at most 1200 months."));
    }
    Ok(())
}
fn context(generation: u64, revision: u64) -> FinancialContext {
    FinancialContext {
        contract_version: 1,
        generation,
        session_revision: revision,
    }
}
fn query_error(error: String) -> budget_core::store::StoreError {
    budget_core::store::StoreError::ToSqlConversionFailure(Box::new(std::io::Error::other(error)))
}
fn origin(paths: &crate::config::AppPaths, state: &AppStateHandle, generation: u64, revision: u64) -> Result<(), ReadError> {
    if paths.current_generation() != generation || state.current_revision() != revision {
        return Err(ReadError::new(
            "stale_profile",
            "These totals were requested from a previous profile session.",
        ));
    }
    Ok(())
}
fn budget_snapshot(store: &Store, context: FinancialContext, year: i32, month: u32) -> Result<BudgetSnapshot, String> {
    store
        .read_snapshot(|store| {
            let (local, external) = store.read_revision()?;
            let actuals = store
                .monthly_budget_actuals(year, month)?
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
            let alerts = store
                .budget_alerts_for_month(year, month)?
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
                .collect();
            let members = store
                .monthly_budget_actuals_by_member(year, month)?
                .into_iter()
                .map(|a| MemberBudgetActualDto {
                    category: a.category,
                    budget_group: a.budget_group,
                    budgeted: a.budgeted.to_string(),
                    actual: a.actual.to_string(),
                    member_id: a.member_id,
                    member_name: a.member_name,
                })
                .collect();
            let flow = reports::cash_flow_for_store(store, year, month, year, month).map_err(query_error)?;
            Ok(BudgetSnapshot {
                contract_version: 1,
                context,
                revision: FinancialRevision { local, external },
                year,
                month,
                actuals,
                alerts,
                flow,
                members,
            })
        })
        .map_err(|e| e.to_string())
}
fn report_snapshot(
    store: &Store,
    context: FinancialContext,
    from_year: i32,
    from_month: u32,
    to_year: i32,
    to_month: u32,
) -> Result<ReportRangeSnapshot, String> {
    store
        .read_snapshot(|store| {
            let (local, external) = store.read_revision()?;
            let cells = store
                .category_spending_by_month(from_year, from_month, to_year, to_month)?
                .into_iter()
                .map(|c| CategoryMonthAmountDto {
                    month: c.month,
                    category: c.category,
                    amount: c.amount.to_string(),
                })
                .collect();
            let daily = store
                .daily_spending(from_year, from_month, to_year, to_month)?
                .into_iter()
                .map(|d| DailySpendAmountDto {
                    date: d.date,
                    amount: d.amount.to_string(),
                })
                .collect();
            let flow = reports::cash_flow_for_store(store, from_year, from_month, to_year, to_month).map_err(query_error)?;
            Ok(ReportRangeSnapshot {
                contract_version: 1,
                context,
                revision: FinancialRevision { local, external },
                from_year,
                from_month,
                to_year,
                to_month,
                cells,
                flow,
                daily,
            })
        })
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn get_budget_snapshot(
    year: i32,
    month: u32,
    expected_generation: u64,
    expected_session_revision: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
) -> Result<BudgetSnapshot, ReadError> {
    valid_range(year, month, year, month)?;
    let session = state.lock().map_err(ReadError::from)?;
    origin(&paths, &state, expected_generation, expected_session_revision)?;
    budget_snapshot(&session.store, context(expected_generation, expected_session_revision), year, month)
        .map_err(|e| ReadError::new("internal_error", e))
}
#[tauri::command]
// Tauri receives the range and origin as named IPC arguments plus injected state.
#[allow(clippy::too_many_arguments)]
pub fn get_report_range_snapshot(
    from_year: i32,
    from_month: u32,
    to_year: i32,
    to_month: u32,
    expected_generation: u64,
    expected_session_revision: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
) -> Result<ReportRangeSnapshot, ReadError> {
    valid_range(from_year, from_month, to_year, to_month)?;
    let session = state.lock().map_err(ReadError::from)?;
    origin(&paths, &state, expected_generation, expected_session_revision)?;
    report_snapshot(
        &session.store,
        context(expected_generation, expected_session_revision),
        from_year,
        from_month,
        to_year,
        to_month,
    )
    .map_err(|e| ReadError::new("internal_error", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Store, i64, i64) {
        let store = Store::open_in_memory().unwrap();
        let account = store.get_or_create_account("Synthetic", AccountType::Checking).unwrap();
        store.create_category("Fixture", None).unwrap();
        store
            .set_budget("Fixture", "2026-10", Decimal::from_str("9007199254740992.01").unwrap(), "flexible")
            .unwrap();
        let row = budget_core::models::Transaction {
            date: chrono::NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
            description: "Synthetic".into(),
            amount: Decimal::from_str("-12.34").unwrap(),
            category: Some("Fixture".into()),
        };
        let id = store.create_transaction(account, &row, None).unwrap();
        (store, account, id)
    }
    #[test]
    fn budget_serialization_matches_shared_decimal_and_nullable_contract() {
        let (store, _, _) = fixture();
        let result = serde_json::to_value(budget_snapshot(&store, context(2, 7), 2026, 10).unwrap()).unwrap();
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../core/tests/fixtures/budget_line.json")).unwrap();
        assert_eq!(result["actuals"][0], fixture);
        assert!(result["members"][0]["member_id"].is_null());
        assert_eq!(result["flow"]["total_expense"], "12.34");
        assert_eq!(result["context"]["sessionRevision"], 7);
    }
    #[test]
    fn report_budget_and_daily_follow_split_and_delete_restore_inclusion() {
        let (store, account, id) = fixture();
        store.create_category("Other", None).unwrap();
        let tx = budget_core::models::Transaction {
            date: chrono::NaiveDate::from_ymd_opt(2026, 10, 2).unwrap(),
            description: "Split fixture".into(),
            amount: Decimal::from(-20),
            category: Some("Fixture".into()),
        };
        let split = store.create_transaction(account, &tx, None).unwrap();
        store
            .set_transaction_splits(
                split,
                &[("Fixture".into(), Decimal::from(-5), None), ("Other".into(), Decimal::from(-15), None)],
            )
            .unwrap();
        let budget = budget_snapshot(&store, context(2, 7), 2026, 10).unwrap();
        let report = report_snapshot(&store, context(2, 7), 2026, 10, 2026, 10).unwrap();
        assert_eq!(budget.actuals[0].actual, "17.34");
        assert_eq!(report.flow.total_expense, "32.34");
        assert_eq!(report.cells.iter().find(|c| c.category == "Fixture").unwrap().amount, "17.34");
        assert_eq!(report.daily.iter().find(|d| d.date == "2026-10-02").unwrap().amount, "20");
        store.delete_transaction(id, chrono::Local::now().naive_local()).unwrap();
        assert_eq!(budget_snapshot(&store, context(2, 7), 2026, 10).unwrap().actuals[0].actual, "5");
        store.restore_transactions(&[id]).unwrap();
        assert_eq!(budget_snapshot(&store, context(2, 7), 2026, 10).unwrap().actuals[0].actual, "17.34");
    }
    #[test]
    fn malformed_reversed_and_unbounded_periods_are_domain_refusals() {
        for range in [
            (2026, 0, 2026, 1),
            (2026, 13, 2026, 13),
            (2026, 10, 2026, 9),
            (0, 1, 2026, 1),
            (1, 1, 9999, 12),
        ] {
            let error = valid_range(range.0, range.1, range.2, range.3).unwrap_err();
            assert_eq!(serde_json::to_value(error).unwrap()["code"], "invalid_argument");
        }
        valid_range(2026, 10, 2026, 10).unwrap();
    }
    #[test]
    fn transfers_generated_payments_and_checkpoints_keep_metric_boundaries() {
        let (store, account, _) = fixture();
        let other = store.get_or_create_account("Other synthetic account", AccountType::Savings).unwrap();
        let loan = store.get_or_create_account("Synthetic loan", AccountType::Loan).unwrap();
        let date = chrono::NaiveDate::from_ymd_opt(2026, 10, 2).unwrap();
        let row = |amount| budget_core::models::Transaction {
            date,
            description: format!("Synthetic {amount}"),
            amount: Decimal::from(amount),
            category: Some("Fixture".into()),
        };
        let outgoing = store.create_transaction(account, &row(-30), None).unwrap();
        let incoming = store.create_transaction(other, &row(30), None).unwrap();
        assert!(store.link_transfer(outgoing, incoming).unwrap());
        let payment = store.create_transaction(account, &row(-10), None).unwrap();
        store.apply_debt_payment(payment, loan, Decimal::from(10), date).unwrap();
        store
            .set_account_balance_override(account, Decimal::from_str("999.99").unwrap(), date)
            .unwrap();
        let b = budget_snapshot(&store, context(2, 7), 2026, 10).unwrap();
        let r = report_snapshot(&store, context(2, 7), 2026, 10, 2026, 10).unwrap();
        assert_eq!(b.actuals[0].actual, "22.34");
        assert_eq!(r.flow.total_expense, "22.34");
        assert_eq!(r.flow.total_income, "0");
        store.delete_transaction(outgoing, chrono::Local::now().naive_local()).unwrap();
        assert_eq!(
            report_snapshot(&store, context(2, 7), 2026, 10, 2026, 10).unwrap().flow.total_income,
            "30"
        );
        store.restore_transactions(&[outgoing]).unwrap();
        assert_eq!(report_snapshot(&store, context(2, 7), 2026, 10, 2026, 10).unwrap().flow.total_income, "0");
    }
}
