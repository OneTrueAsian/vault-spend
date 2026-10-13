use super::*;
use budget_core::models::Transaction;
use budget_core::statement::Period;
use budget_core::store::{FinishReconciliation, ReconcileSource, StatementFinish};

fn profile(name: &str) -> (AppState, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("vaultspend-accounts-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    (AppState::open(dir.join("profile.db")).unwrap(), dir)
}

fn tx(date: &str, description: &str, amount: &str) -> Transaction {
    Transaction {
        date: date.parse().unwrap(),
        description: description.into(),
        amount: amount.parse().unwrap(),
        category: None,
    }
}

fn reconcile_by_hand(state: &AppState, account: i64, date: &str, start: Option<&str>, end: &str) {
    let finished = state
        .store
        .finish_reconciliation(
            &FinishReconciliation {
                account_id: account,
                period_start: None,
                statement_date: date.parse().unwrap(),
                statement_start: start.map(|s| s.parse().unwrap()),
                statement_end: end.parse().unwrap(),
                source: ReconcileSource::Manual,
            },
            chrono::Local::now().naive_local(),
        )
        .unwrap();
    assert!(finished.is_some(), "the reconciliation through {date} should balance");
}

/// A September investment statement that adds an 18.50 dividend, without checking share counts.
fn finish_september_investment_statement(state: &AppState, account: i64) {
    state
        .store
        .finish_statement_reconciliation(
            &StatementFinish {
                account_id: account,
                period: Period::new("2026-09-01".parse().unwrap(), "2026-09-30".parse().unwrap()).unwrap(),
                statement_start: None,
                statement_end: None,
                ending_value: Some("84089.71".parse().unwrap()),
                source: ReconcileSource::StatementPdf,
                matched: vec![],
                add: vec![tx("2026-09-05", "Cash Dividend", "18.50")],
                add_principal: vec![],
                matched_principal: vec![],
                holdings: vec![],
                statement_shares: None,
                layout: None,
            },
            chrono::Local::now().naive_local(),
        )
        .unwrap();
}

#[test]
fn reconciling_an_older_month_by_hand_starts_from_the_month_before_it() {
    let (state, dir) = profile("as-of");
    let brokerage = state.store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let july = state
        .store
        .save_transactions_with_ids(brokerage, &[tx("2026-07-10", "Interest", "5.00")])
        .unwrap();
    state.store.set_transactions_cleared(&july, true).unwrap();
    reconcile_by_hand(&state, brokerage, "2026-07-31", Some("100.00"), "105.00");
    finish_september_investment_statement(&state, brokerage);
    let august = state
        .store
        .save_transactions_with_ids(brokerage, &[tx("2026-08-10", "Interest", "10.00")])
        .unwrap();
    state.store.set_transactions_cleared(&august, true).unwrap();

    let status = reconcile_status_for(&state, brokerage, "2026-08-31", None, "115.00").unwrap();
    assert_eq!(
        status.starting_point.as_deref(),
        Some("105.00"),
        "July's balance, before September's dividend"
    );
    assert_eq!(status.difference.as_deref(), Some("0.00"));
    let october = reconcile_status_for(&state, brokerage, "2026-10-31", None, "123.50").unwrap();
    assert_eq!(october.starting_point.as_deref(), Some("123.50"), "105.00 + 18.50");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn reconcile_status_refuses_a_date_that_is_not_a_date() {
    let (state, dir) = profile("as-of-bad-date");
    let checking = state.store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    assert_eq!(
        reconcile_status_for(&state, checking, "not a date", None, "1.00").err().unwrap(),
        "invalid date: not a date"
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_last_reconciliation_shown_is_never_an_investment_statements_total_value() {
    let (state, dir) = profile("last-reconciliation");
    let brokerage = state.store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    finish_september_investment_statement(&state, brokerage);
    assert!(
        last_reconciliation_for(&state, brokerage).unwrap().is_none(),
        "an investment statement states no balance to pick up from"
    );

    reconcile_by_hand(&state, brokerage, "2026-07-31", Some("100.00"), "100.00");
    let last = last_reconciliation_for(&state, brokerage).unwrap().unwrap();
    assert_eq!((last.statement_date.as_str(), last.statement_balance.as_str()), ("2026-07-31", "100.00"));
    let _ = std::fs::remove_dir_all(dir);
}
