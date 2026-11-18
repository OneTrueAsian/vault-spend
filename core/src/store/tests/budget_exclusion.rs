use super::*;

/// Shared fixture: Medical (flexible 200, rollover on) plus income lines, a
/// marked ER visit, an unmarked pharmacy row, a marked reimbursement, a
/// marked split purchase and a marked October row. The switch is on.
struct Fixture {
    store: Store,
    er: i64,
    split: i64,
}

fn fixture() -> Fixture {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_rollover_enabled(true).unwrap();
    store.set_budget_exclusion_enabled(true).unwrap();
    for month in ["2026-10", "2026-11"] {
        store.set_budget("Medical", month, "200.00".parse().unwrap(), "flexible").unwrap();
        store.set_budget_rollover("Medical", month, true).unwrap();
        store.set_budget("Paycheck", month, "1000.00".parse().unwrap(), "income").unwrap();
        store.set_budget("Reimbursement", month, "0.00".parse().unwrap(), "income").unwrap();
    }
    let medical = |date: &str, description: &str, amount: &str| Transaction {
        category: Some("Medical".to_string()),
        ..tx(date, description, amount)
    };
    let ids = store
        .save_transactions_with_ids(
            account,
            &[
                medical("2026-11-03", "City ER", "-3000.00"),
                medical("2026-11-05", "Pharmacy", "-50.00"),
                Transaction {
                    category: Some("Reimbursement".to_string()),
                    ..tx("2026-11-08", "Insurance refund", "600.00")
                },
                tx("2026-11-10", "Clinic and supplies", "-90.00"),
                medical("2026-10-12", "Surgery", "-400.00"),
                Transaction {
                    category: Some("Paycheck".to_string()),
                    ..tx("2026-11-01", "Pay", "1000.00")
                },
            ],
        )
        .unwrap();
    let (er, refund, split, october) = (ids[0], ids[2], ids[3], ids[4]);
    store
        .set_transaction_splits(split, &[("Medical".to_string(), "-90.00".parse().unwrap(), Some("lab".to_string()))])
        .unwrap();
    store.set_transactions_excluded_from_budget(&[er, refund, split, october], true).unwrap();
    Fixture { store, er, split }
}

fn dec(s: &str) -> Decimal {
    s.parse().unwrap()
}

fn medical_actual(store: &Store) -> Decimal {
    store
        .monthly_budget_actuals(2026, 11)
        .unwrap()
        .into_iter()
        .find(|b| b.category == "Medical")
        .unwrap()
        .actual
}

#[test]
fn budget_actuals_leave_marked_rows_out() {
    let f = fixture();
    let actuals = f.store.monthly_budget_actuals(2026, 11).unwrap();
    assert_eq!(actuals.iter().find(|b| b.category == "Medical").unwrap().actual, dec("50"));
    assert_eq!(actuals.iter().find(|b| b.category == "Reimbursement").unwrap().actual, dec("0"));
}

#[test]
fn rollover_ignores_marked_rows_in_earlier_months() {
    let f = fixture();
    let medical = f.store.monthly_budget_actuals(2026, 11).unwrap().into_iter().find(|b| b.category == "Medical").unwrap();
    assert_eq!(medical.rollover, dec("200"));
}

#[test]
fn budget_by_member_trend_and_drilldowns_leave_marked_rows_out() {
    let f = fixture();
    let by_member: Decimal = f
        .store
        .monthly_budget_actuals_by_member(2026, 11)
        .unwrap()
        .into_iter()
        .filter(|m| m.category == "Medical")
        .map(|m| m.actual)
        .sum();
    assert_eq!(by_member, dec("50"));

    let trend = f.store.budget_actuals_trend("Medical", 2026, 11, 2).unwrap();
    assert_eq!(trend, vec![("2026-10".to_string(), dec("0")), ("2026-11".to_string(), dec("50"))]);

    for rows in [
        f.store.transactions_for_category_in_month("Medical", 2026, 11).unwrap(),
        f.store.spending_transactions_for_category_in_month("Medical", 2026, 11).unwrap(),
    ] {
        assert_eq!(rows.len(), 1, "only the pharmacy row: {rows:?}");
        assert_eq!(rows[0].description, "Pharmacy");
        assert!(rows.iter().all(|r| r.transaction_id != f.er && r.transaction_id != f.split));
    }
}

#[test]
fn budget_alerts_ignore_marked_rows() {
    let f = fixture();
    let alerts = f.store.budget_alerts_for_month(2026, 11).unwrap();
    assert!(alerts.iter().all(|a| a.category != "Medical"), "{alerts:?}");
}

#[test]
fn suggested_budgets_ignore_marked_rows() {
    let f = fixture();
    // Averages the two months before December: October and November.
    let suggestions = f.store.suggest_budgets_from_average(2026, 12, 2).unwrap();
    let medical = suggestions.lines.iter().find(|l| l.category == "Medical").unwrap();
    assert_eq!(medical.suggested, dec("25"));
}

#[test]
fn month_review_totals_leave_marked_rows_out() {
    let f = fixture();
    let review = f.store.month_review(2026, 11).unwrap();
    assert_eq!(review.income, dec("1000"));
    assert_eq!(review.expenses, dec("50"));
    assert_eq!(review.prev_expenses, dec("0"));
}

#[test]
fn everything_else_still_counts_marked_rows() {
    let f = fixture();
    let start: NaiveDate = "2026-11-01".parse().unwrap();
    let end: NaiveDate = "2026-11-30".parse().unwrap();
    let spending = f.store.spending_by_category(start, end).unwrap();
    assert_eq!(spending.iter().find(|(c, _)| c == "Medical").unwrap().1, dec("3140"));
    assert_eq!(f.store.monthly_totals(2026, 11).unwrap(), (dec("1600"), dec("3140")));
    let large_on = f.store.large_expenses_in_range(start, end).unwrap();
    f.store.set_budget_exclusion_enabled(false).unwrap();
    assert_eq!(f.store.large_expenses_in_range(start, end).unwrap(), large_on);
    f.store.set_budget_exclusion_enabled(true).unwrap();
    assert_eq!(f.store.list_accounts(far_future()).unwrap()[0].current_balance, dec("-1940"));
}

#[test]
fn switch_off_counts_everything_and_on_again_restores() {
    let f = fixture();
    f.store.set_budget_exclusion_enabled(false).unwrap();
    assert_eq!(medical_actual(&f.store), dec("3140"));
    f.store.set_budget_exclusion_enabled(true).unwrap();
    assert_eq!(medical_actual(&f.store), dec("50"));
    let stored = f.store.all_transactions().unwrap();
    assert!(stored.iter().find(|t| t.id == f.er).unwrap().excluded_from_budget);
}
