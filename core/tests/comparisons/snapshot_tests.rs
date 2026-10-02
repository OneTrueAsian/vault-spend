use super::setup_tests::today;
use budget_core::comparisons::metrics::{Snapshot, compute_metric, spending_window};
use budget_core::comparisons::setup::ComparisonSetup;
use budget_core::comparisons::types::MetricId;
use budget_core::models::{AccountType, Transaction};
use budget_core::store::Store;
use chrono::{NaiveDate, NaiveDateTime};
use rust_decimal::Decimal;
use std::str::FromStr;

fn dec(s: &str) -> Decimal {
    Decimal::from_str(s).unwrap()
}

fn d(y: i32, m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, day).unwrap()
}

fn tx(date: NaiveDate, description: &str, amount: &str, category: Option<&str>) -> Transaction {
    Transaction {
        date,
        description: description.into(),
        amount: dec(amount),
        category: category.map(String::from),
    }
}

fn snapshot(store: &Store, from: NaiveDate) -> Snapshot {
    store.comparison_snapshot(today(), from).unwrap()
}

#[test]
fn only_expenses_are_spend_rows_and_each_row_names_its_account() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    store
        .save_transactions(
            checking,
            &[
                tx(d(2026, 7, 1), "Grocer", "-80.00", Some("Groceries")),
                tx(d(2026, 7, 2), "Paycheck", "2000.00", Some("Income")),
                tx(d(2026, 7, 3), "Refund", "15.00", Some("Groceries")),
            ],
        )
        .unwrap();
    let snap = snapshot(&store, d(2026, 1, 1));
    assert_eq!(snap.spend_rows.len(), 1);
    assert_eq!((snap.spend_rows[0].account_id, snap.spend_rows[0].amount), (checking, dec("80.00")));
    assert_eq!(snap.first_transaction_date, Some(d(2026, 7, 1)));
}

#[test]
fn a_split_purchase_counts_through_its_lines_not_its_parent() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let ids = store
        .save_transactions_with_ids(checking, &[tx(d(2026, 7, 1), "Big box", "-100.00", None)])
        .unwrap();
    store
        .set_transaction_splits(
            ids[0],
            &[("Groceries".into(), dec("-60.00"), None), ("Household".into(), dec("-40.00"), None)],
        )
        .unwrap();
    let snap = snapshot(&store, d(2026, 1, 1));
    let total: Decimal = snap.spend_rows.iter().map(|r| r.amount).sum();
    assert_eq!((snap.spend_rows.len(), total), (2, dec("100.00")), "100 once, never parent plus lines");
}

#[test]
fn linked_transfers_and_generated_debt_payments_are_not_spending() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let savings = store.get_or_create_account("Savings", AccountType::Savings).unwrap();
    let loan = store.get_or_create_account("Loan", AccountType::Loan).unwrap();
    let out = store
        .save_transactions_with_ids(checking, &[tx(d(2026, 7, 5), "To savings", "-500.00", None)])
        .unwrap()[0];
    let into = store
        .save_transactions_with_ids(savings, &[tx(d(2026, 7, 5), "From checking", "500.00", None)])
        .unwrap()[0];
    assert!(store.link_transfer(out, into).unwrap());
    let pay = store
        .save_transactions_with_ids(checking, &[tx(d(2026, 7, 6), "Loan payment", "-300.00", None)])
        .unwrap()[0];
    store.apply_debt_payment(pay, loan, dec("300.00"), d(2026, 7, 6)).unwrap();
    let snap = snapshot(&store, d(2026, 1, 1));
    let rows: Vec<_> = snap.spend_rows.iter().map(|r| (r.account_id, r.amount)).collect();
    // The linked pair is gone; the loan payment counts once (the source side), not twice.
    assert_eq!(rows, vec![(checking, dec("300.00"))]);
}

#[test]
fn deleted_transactions_are_not_spending() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let ids = store
        .save_transactions_with_ids(checking, &[tx(d(2026, 7, 1), "Oops", "-10.00", None)])
        .unwrap();
    store
        .delete_transaction(ids[0], NaiveDateTime::new(d(2026, 7, 2), chrono::NaiveTime::MIN))
        .unwrap();
    assert!(snapshot(&store, d(2026, 1, 1)).spend_rows.is_empty());
}

#[test]
fn rows_before_the_requested_start_are_left_out() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    store
        .save_transactions(
            checking,
            &[tx(d(2025, 1, 1), "Old", "-5.00", None), tx(d(2026, 7, 1), "New", "-7.00", None)],
        )
        .unwrap();
    let snap = snapshot(&store, d(2026, 1, 1));
    assert_eq!(snap.spend_rows.len(), 1);
    assert_eq!(
        snap.first_transaction_date,
        Some(d(2025, 1, 1)),
        "the profile's first date is not limited by the window"
    );
}

#[test]
fn account_balances_follow_the_stores_conventions_for_cards_and_loans() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Visa", AccountType::Credit).unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    let invest = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    store.save_transactions(card, &[tx(d(2026, 7, 1), "Charge", "-250.00", None)]).unwrap();
    store.save_transactions(loan, &[tx(d(2026, 7, 1), "Payment", "100.00", None)]).unwrap();
    store
        .create_holding(invest, "VTI", "Total market", dec("10"), dec("200"), dec("1500"), None)
        .unwrap();
    let snap = snapshot(&store, d(2026, 1, 1));
    let by_name = |n: &str| snap.accounts.iter().find(|a| a.name == n).unwrap();
    assert_eq!(by_name("Visa").owed(), dec("250.00"));
    assert_eq!(by_name("Mortgage").kind, AccountType::Loan);
    assert_eq!(by_name("Brokerage").balance, dec("2000"), "holdings value is the balance, counted once");
}

#[test]
fn assets_carry_their_valuation_date() {
    let store = Store::open_in_memory().unwrap();
    store.create_asset("Rental", "property", dec("30000"), d(2026, 9, 1), None).unwrap();
    let snap = snapshot(&store, d(2026, 1, 1));
    assert_eq!((snap.assets[0].value, snap.assets[0].valued_on), (dec("30000"), d(2026, 9, 1)));
}

#[test]
fn the_default_spending_window_is_the_twelve_completed_months() {
    let setup = ComparisonSetup::empty();
    assert_eq!(spending_window(&setup, today()), (d(2025, 9, 1), d(2026, 8, 31)));
}

#[test]
fn a_real_year_of_spending_reconciles_end_to_end() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let mut txns = Vec::new();
    for (y, m) in (9..=12).map(|m| (2025, m)).chain((1..=8).map(|m| (2026, m))) {
        txns.push(tx(d(y, m, 10), "Rent", "-1500.00", Some("Housing")));
        txns.push(tx(d(y, m, 20), "Food", "-500.00", Some("Groceries")));
    }
    store.save_transactions(checking, &txns).unwrap();
    let mut setup = ComparisonSetup::empty();
    setup.spending.completeness_confirmed = true;
    let (from, _) = spending_window(&setup, today());
    let m = compute_metric(&snapshot(&store, from), &setup, MetricId::Spending);
    assert_eq!(m.value, Some(dec("24000.00")));
    assert_eq!(m.contributors[0].counted, dec("24000.00"), "the contributor reconciles to the total");
}
