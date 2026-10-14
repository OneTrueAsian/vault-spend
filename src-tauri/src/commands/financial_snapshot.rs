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
    // Budget reads deliberately initialize an untouched month's inherited plan.
    // Complete that legacy write before capturing a coherent read-only revision.
    store.list_budgets(&format!("{year:04}-{month:02}")).map_err(|e| e.to_string())?;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
    contract_version: u8,
    context: FinancialContext,
    revision: FinancialRevision,
    as_of: String,
    report: ReportDto,
    net_worth: Vec<NetWorthPointDto>,
    spending: Vec<CategoryAmountDto>,
    alerts: Vec<BudgetAlertDto>,
    insights: Vec<InsightDto>,
    average_spend: String,
    contributions: Vec<AccountContributionDeltaDto>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSummarySnapshot {
    contract_version: u8,
    context: FinancialContext,
    revision: FinancialRevision,
    as_of: String,
    report: ReportDto,
    accounts: Vec<AccountDto>,
    average_spend: String,
}
fn summary_snapshot(store: &Store, context: FinancialContext, today: chrono::NaiveDate) -> Result<ReportSummarySnapshot, String> {
    store.list_budgets(&today.format("%Y-%m").to_string()).map_err(|e| e.to_string())?;
    store
        .read_snapshot(|store| {
            let (local, external) = store.read_revision()?;
            let report = reports::report_for_store(store, today).map_err(query_error)?;
            let accounts = store.list_accounts(today)?.into_iter().map(super::accounts::account_dto).collect();
            let average_spend = store.average_monthly_spend(today)?.to_string();
            Ok(ReportSummarySnapshot {
                contract_version: 1,
                context,
                revision: FinancialRevision { local, external },
                as_of: today.to_string(),
                report,
                accounts,
                average_spend,
            })
        })
        .map_err(|e| e.to_string())
}
fn dashboard_snapshot(store: &Store, context: FinancialContext, today: chrono::NaiveDate) -> Result<DashboardSnapshot, String> {
    store.list_budgets(&today.format("%Y-%m").to_string()).map_err(|e| e.to_string())?;
    use chrono::Datelike;
    store
        .read_snapshot(|store| {
            let (local, external) = store.read_revision()?;
            let report = reports::report_for_store(store, today).map_err(query_error)?;
            let net_worth = reports::net_worth_for_store(store, today, 6).map_err(query_error)?;
            let first = chrono::NaiveDate::from_ymd_opt(today.year(), today.month(), 1).expect("current month is valid");
            let spending = store
                .spending_by_category(first, today)?
                .into_iter()
                .map(|(category, amount)| CategoryAmountDto {
                    category,
                    amount: amount.to_string(),
                })
                .collect();
            let alerts = store
                .budget_alerts_for_month(today.year(), today.month())?
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
            let insights = store
                .dashboard_insights(today)?
                .into_iter()
                .map(|i| InsightDto {
                    severity: i.severity,
                    kind: i.kind,
                    message: i.message,
                })
                .collect();
            let average_spend = store.average_monthly_spend(today)?.to_string();
            let from = chrono::NaiveDate::parse_from_str(&net_worth[0].as_of, "%Y-%m-%d").map_err(|e| query_error(e.to_string()))?;
            let contributions = store
                .account_contribution_deltas(from, today)?
                .into_iter()
                .map(|d| AccountContributionDeltaDto {
                    account_id: d.account_id,
                    name: d.name,
                    group: d.group,
                    from_amount: d.from_amount.to_string(),
                    to_amount: d.to_amount.to_string(),
                    delta: d.delta.to_string(),
                })
                .collect();
            Ok(DashboardSnapshot {
                contract_version: 1,
                context,
                revision: FinancialRevision { local, external },
                as_of: today.to_string(),
                report,
                net_worth,
                spending,
                alerts,
                insights,
                average_spend,
                contributions,
            })
        })
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn get_dashboard_snapshot(
    expected_generation: u64,
    expected_session_revision: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
) -> Result<DashboardSnapshot, ReadError> {
    let session = state.lock().map_err(ReadError::from)?;
    origin(&paths, &state, expected_generation, expected_session_revision)?;
    dashboard_snapshot(
        &session.store,
        context(expected_generation, expected_session_revision),
        chrono::Local::now().date_naive(),
    )
    .map_err(|e| ReadError::new("internal_error", e))
}
#[tauri::command]
pub fn get_report_summary_snapshot(
    expected_generation: u64,
    expected_session_revision: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
) -> Result<ReportSummarySnapshot, ReadError> {
    let session = state.lock().map_err(ReadError::from)?;
    origin(&paths, &state, expected_generation, expected_session_revision)?;
    summary_snapshot(
        &session.store,
        context(expected_generation, expected_session_revision),
        chrono::Local::now().date_naive(),
    )
    .map_err(|e| ReadError::new("internal_error", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ask_vault_session_guard_refuses_locked_empty_and_retired_origins() {
        use super::super::ask_vault::{read_for_session, AskRequest};
        let request: AskRequest =
            serde_json::from_value(serde_json::json!({"kind":"total","periods":[{"from":"2026-10-01","to":"2026-10-08"}],"limit":5})).unwrap();
        let runtime = crate::runtime::AppRuntime::no_profile_open();
        let paths = crate::config::AppPaths {
            config_path: "unused-test-config".into(),
            db_path: std::sync::Mutex::new("unused-test-db".into()),
            generation: std::sync::atomic::AtomicU64::new(4),
        };
        let code =
            |result: Result<super::super::ask_vault::AskSnapshot, ReadError>| serde_json::to_value(result.unwrap_err()).unwrap()["code"].clone();
        assert_eq!(code(read_for_session(&request, 4, 0, &runtime, &paths)), "no_profile_open");
        let make_state = || AppState {
            store: Store::open_in_memory().unwrap(),
            rules: RuleSet::new(vec![]),
            import_review: None,
        };
        runtime.install(make_state());
        let revision = runtime.current_revision();
        assert!(read_for_session(&request, 4, revision, &runtime, &paths).is_ok());
        assert_eq!(code(read_for_session(&request, 3, revision, &runtime, &paths)), "stale_profile");
        runtime.lock_profile("synthetic");
        assert_eq!(code(read_for_session(&request, 4, revision, &runtime, &paths)), "profile_locked");
        runtime.install(make_state());
        assert_eq!(code(read_for_session(&request, 4, revision, &runtime, &paths)), "stale_profile");
    }
    #[test]
    fn ask_vault_contract_preserves_exact_money_and_rejects_stale_data() {
        let (store, account, _) = fixture();
        let request = serde_json::from_value::<super::super::ask_vault::AskRequest>(serde_json::json!({
            "kind":"total", "periods":[{"from":"2026-10-01","to":"2026-10-08"}],
            "accountIds":[account], "categories":["Fixture"], "limit":5
        }))
        .unwrap();
        let today = "2026-10-08".parse().unwrap();
        let answer = super::super::ask_vault::snapshot(&store, 2, 7, &request, today).unwrap();
        let json = serde_json::to_value(answer).unwrap();
        assert_eq!(json["periods"][0]["total"], "12.34");
        assert_eq!(json["context"]["sessionRevision"], 7);
        assert_eq!(json["context"]["generation"], 2);
        let mut stale = request;
        stale.expected_revision = Some(serde_json::from_value(json["revision"].clone()).unwrap());
        store.create_category("Changed", None).unwrap();
        let error = super::super::ask_vault::snapshot(&store, 2, 7, &stale, today).unwrap_err();
        assert_eq!(serde_json::to_value(error).unwrap()["code"], "stale_data");
    }
    #[test]
    fn ask_vault_refuses_unknown_fields_and_invalid_request_shapes() {
        use super::super::ask_vault::{snapshot, AskRequest};
        let store = Store::open_in_memory().unwrap();
        let today = "2026-10-08".parse().unwrap();
        let base = serde_json::json!({"kind":"total","periods":[{"from":"2026-10-01","to":"2026-10-08"}],"limit":5});
        let mut injected = base.clone();
        injected["sql"] = serde_json::json!("DELETE FROM transactions");
        assert!(serde_json::from_value::<AskRequest>(injected).is_err());
        for (key, value) in [
            ("limit", serde_json::json!(0)),
            ("limit", serde_json::json!(51)),
            ("periods", serde_json::json!([])),
            ("periods", serde_json::json!([{"from":"2026-10-09","to":"2026-10-08"}])),
            ("periods", serde_json::json!([{"from":"2026-02-30","to":"2026-10-08"}])),
            ("minimumPurchase", serde_json::json!({"amount":"1.001","inclusive":true})),
            ("minimumPurchase", serde_json::json!({"amount":"1e2","inclusive":true})),
            (
                "minimumPurchase",
                serde_json::json!({"amount":"79228162514264337593543950335.01","inclusive":true}),
            ),
        ] {
            let mut value_json = base.clone();
            value_json[key] = value;
            let request = serde_json::from_value::<AskRequest>(value_json).unwrap();
            let error = snapshot(&store, 2, 7, &request, today).unwrap_err();
            assert_eq!(serde_json::to_value(error).unwrap()["code"], "invalid_argument");
        }
    }
    #[test]
    fn ask_vault_comparison_keeps_exact_scope_and_unequal_calendar_lengths() {
        use super::super::ask_vault::{snapshot, AskRequest};
        let (store, account, _) = fixture();
        let request: AskRequest = serde_json::from_value(serde_json::json!({
            "kind":"compare","periods":[{"from":"2026-10-01","to":"2026-10-08"},{"from":"2026-09-01","to":"2026-09-30"}],
            "accountIds":[account],"categories":["Fixture"],"limit":5
        }))
        .unwrap();
        let result = serde_json::to_value(snapshot(&store, 2, 7, &request, "2026-10-08".parse().unwrap()).unwrap()).unwrap();
        assert_eq!(result["difference"], "12.34");
        assert_eq!(result["periods"][0]["dayCount"], 8);
        assert_eq!(result["periods"][1]["dayCount"], 30);
        assert_eq!(result["periods"][0]["endsToday"], true);
        assert_eq!(result["periods"][1]["endsToday"], false);
        assert_eq!(result["periods"][1]["purchaseCount"], 0);
        assert_eq!(result["periods"][1]["historyCoverage"], "unknown");
        assert!(result["periods"][0]["purchases"].as_array().unwrap().is_empty());
    }
    #[test]
    fn ask_vault_vendor_requests_return_exact_totals_and_the_names_matched() {
        use super::super::ask_vault::{snapshot, AskRequest};
        let (store, account, _) = fixture();
        let today = "2026-10-08".parse().unwrap();
        let ask = |vendor: serde_json::Value| -> Result<serde_json::Value, serde_json::Value> {
            let request: AskRequest = serde_json::from_value(serde_json::json!({
                "kind":"total","periods":[{"from":"2026-10-01","to":"2026-10-08"}],
                "accountIds":[account],"categories":[],"vendors":if vendor.is_null() { serde_json::json!([]) } else { serde_json::json!([vendor]) },"limit":5
            }))
            .unwrap();
            snapshot(&store, 2, 7, &request, today)
                .map(|ok| serde_json::to_value(ok).unwrap())
                .map_err(|e| serde_json::to_value(e).unwrap())
        };
        let found = ask(serde_json::json!("synth")).unwrap();
        assert_eq!(found["periods"][0]["total"], "12.34");
        assert_eq!(found["periods"][0]["vendorNameCount"], 1);
        assert_eq!(found["periods"][0]["vendors"][0]["description"], "Synthetic");
        assert_eq!(found["periods"][0]["vendors"][0]["purchaseCount"], 1);
        let none = ask(serde_json::json!("walmart")).unwrap();
        assert_eq!(none["periods"][0]["total"], "0");
        assert!(none["periods"][0]["vendors"].as_array().unwrap().is_empty());
        let without = ask(serde_json::Value::Null).unwrap();
        assert_eq!(without["periods"][0]["vendorTotals"].as_array().unwrap().len(), 0);
        assert_eq!(without["periods"][0]["leftOut"]["purchaseCount"], 0);
        assert_eq!(without["periods"][0]["vendorNameCount"], 0);
        assert!(without["periods"][0]["vendors"].as_array().unwrap().is_empty());
        for bad in ["", "a", "!!"] {
            assert_eq!(ask(serde_json::json!(bad)).unwrap_err()["code"], "invalid_argument", "{bad:?}");
        }
    }
    #[test]
    fn ask_vault_lists_of_stores_and_exclusions_return_breakdowns_and_what_was_left_out() {
        use super::super::ask_vault::{snapshot, AskRequest};
        let (store, account, _) = fixture();
        let today = "2026-10-08".parse().unwrap();
        let ask = |extra: serde_json::Value| -> Result<serde_json::Value, serde_json::Value> {
            let mut body = serde_json::json!({"kind":"total","periods":[{"from":"2026-10-01","to":"2026-10-08"}],"accountIds":[account],"limit":5});
            body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            let request: AskRequest = serde_json::from_value(body).unwrap();
            snapshot(&store, 2, 7, &request, today)
                .map(|ok| serde_json::to_value(ok).unwrap())
                .map_err(|e| serde_json::to_value(e).unwrap())
        };
        let many = ask(serde_json::json!({"vendors":["synth","walmart"]})).unwrap();
        assert_eq!(many["periods"][0]["total"], "12.34");
        assert_eq!(many["periods"][0]["vendorTotals"][0]["term"], "synth");
        assert_eq!(many["periods"][0]["vendorTotals"][0]["total"], "12.34");
        assert_eq!(many["periods"][0]["vendorTotals"][1]["term"], "walmart");
        assert_eq!(many["periods"][0]["vendorTotals"][1]["total"], "0");
        let left = ask(serde_json::json!({"excludeVendors":["synth"]})).unwrap();
        assert_eq!(left["periods"][0]["total"], "0");
        assert_eq!(left["periods"][0]["leftOut"]["total"], "12.34");
        assert_eq!(left["periods"][0]["leftOut"]["purchaseCount"], 1);
        assert_eq!(left["periods"][0]["leftOut"]["vendors"][0]["description"], "Synthetic");
        let by_category = ask(serde_json::json!({"excludeCategories":["Fixture"]})).unwrap();
        assert_eq!(by_category["periods"][0]["leftOut"]["categories"][0]["category"], "Fixture");
        assert_eq!(by_category["periods"][0]["leftOut"]["categories"][0]["amount"], "12.34");
        for bad in [
            serde_json::json!({"vendors":["synth"],"excludeVendors":["synth"]}),
            serde_json::json!({"categories":["Fixture"],"excludeCategories":["Fixture"]}),
            serde_json::json!({"excludeVendors":["a"]}),
            serde_json::json!({"excludeCategories":["Missing"]}),
        ] {
            assert_eq!(ask(bad.clone()).unwrap_err()["code"], "invalid_argument", "{bad}");
        }
    }
    #[test]
    fn untouched_month_is_initialized_before_coherent_reads_without_resurrecting_deleted_lines() {
        let store = Store::open_in_memory().unwrap();
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();
        store.set_budget("Fixture", "2026-09", Decimal::from(50), "flexible").unwrap();
        let first = dashboard_snapshot(&store, context(2, 7), today).unwrap();
        assert_eq!(first.report.budget_actuals[0].budgeted, "50");
        store.delete_budget("Fixture", "2026-10").unwrap();
        assert!(summary_snapshot(&store, context(2, 7), today).unwrap().report.budget_actuals.is_empty());
        assert!(budget_snapshot(&store, context(2, 7), 2026, 11).unwrap().actuals.is_empty());
        assert_eq!(
            dashboard_snapshot(&Store::open_in_memory().unwrap(), context(2, 7), today)
                .unwrap()
                .report
                .total_saved,
            "0"
        );
    }
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
    fn dashboard_and_export_reconcile_with_budget_and_exact_accounts() {
        let (store, _, id) = fixture();
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();
        let dashboard = dashboard_snapshot(&store, context(2, 7), today).unwrap();
        let summary = summary_snapshot(&store, context(2, 7), today).unwrap();
        assert_eq!(dashboard.report.budget_actuals[0].actual, "12.34");
        assert_eq!(summary.report.budget_actuals[0].actual, dashboard.report.budget_actuals[0].actual);
        assert_eq!(dashboard.spending[0].amount, "12.34");
        assert_eq!(summary.accounts[0].current_balance, "-12.34");
        assert_eq!(dashboard.net_worth.len(), 6);
        store.delete_transaction(id, chrono::Local::now().naive_local()).unwrap();
        assert_eq!(
            Decimal::from_str(&summary_snapshot(&store, context(2, 7), today).unwrap().report.budget_actuals[0].actual).unwrap(),
            Decimal::ZERO
        );
        assert!(dashboard_snapshot(&store, context(2, 7), today).unwrap().spending.is_empty());
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
