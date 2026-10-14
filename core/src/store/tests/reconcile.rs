use super::*;
use crate::store::{FinishReconciliation, ReconcileSource};

fn finish(store: &Store, acct: i64, date: &str, start: Option<&str>, end: &str) -> Option<i64> {
    store
        .finish_reconciliation(
            &FinishReconciliation {
                account_id: acct,
                period_start: None,
                statement_date: day(date),
                statement_start: start.map(dec),
                statement_end: dec(end),
                source: ReconcileSource::Manual,
            },
            test_now(),
        )
        .unwrap()
}

/// A checking account with +200 (07-15), -50 (08-10), -30 (09-05).
fn checking(store: &Store) -> (i64, [i64; 3]) {
    let acct = store.get_or_create_account("Statement Checking", AccountType::Checking).unwrap();
    store
        .save_transactions(
            acct,
            &[
                tx("2026-07-15", "Deposit", "200.00"),
                tx("2026-08-10", "Coffee", "-50.00"),
                tx("2026-09-05", "Gas", "-30.00"),
            ],
        )
        .unwrap();
    (
        acct,
        [
            id_of(store, "Deposit", "2026-07-15"),
            id_of(store, "Coffee", "2026-08-10"),
            id_of(store, "Gas", "2026-09-05"),
        ],
    )
}

#[test]
fn the_first_reconciliation_starts_from_the_statements_starting_balance() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, _]) = checking(&store);
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();

    let without = store.reconcile_status(acct, day("2026-08-31"), None, dec("1150.00")).unwrap();
    assert!(without.needs_starting_balance);
    assert_eq!(without.difference, None, "no starting point yet, so no difference");

    let with = store
        .reconcile_status(acct, day("2026-08-31"), Some(dec("1000.00")), dec("1150.00"))
        .unwrap();
    assert_eq!(with.starting_point, Some(dec("1000.00")));
    assert_eq!(with.ticked_change, dec("150.00"));
    assert_eq!(with.ticked_count, 2);
    assert_eq!(with.difference, Some(Decimal::ZERO));
}

#[test]
fn later_reconciliations_pick_up_from_the_last_ending_balance_and_ignore_a_typed_start() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
    assert!(finish(&store, acct, "2026-08-31", Some("1000.00"), "1150.00").is_some());

    store.set_transactions_cleared(&[gas], true).unwrap();
    let status = store
        .reconcile_status(acct, day("2026-09-30"), Some(dec("9999.00")), dec("1120.00"))
        .unwrap();
    assert!(!status.needs_starting_balance);
    assert_eq!(status.starting_point, Some(dec("1150.00")));
    assert_eq!(status.ticked_change, dec("-30.00"), "only what the last reconciliation didn't settle");
    assert_eq!(status.difference, Some(Decimal::ZERO));
}

#[test]
fn a_late_item_dated_before_the_last_statement_still_counts_once() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, _]) = checking(&store);
    store.set_transactions_cleared(&[deposit], true).unwrap();
    assert!(finish(&store, acct, "2026-08-31", Some("1000.00"), "1200.00").is_some());

    // Coffee (08-10) only showed up on September's statement.
    store.set_transactions_cleared(&[coffee], true).unwrap();
    let status = store.reconcile_status(acct, day("2026-09-30"), None, dec("1150.00")).unwrap();
    assert_eq!(status.difference, Some(Decimal::ZERO));
}

#[test]
fn finishing_refuses_a_nonzero_difference_and_writes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, _, _]) = checking(&store);
    store.set_transactions_cleared(&[deposit], true).unwrap();

    assert_eq!(finish(&store, acct, "2026-08-31", Some("1000.00"), "1150.00"), None);
    assert_eq!(store.last_reconciliation(acct).unwrap(), None);
    let linked: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM transactions WHERE reconciliation_id IS NOT NULL", [], |r| r.get(0))
        .unwrap();
    assert_eq!(linked, 0);
}

#[test]
fn finishing_records_the_details_and_settles_the_ticked_rows() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
    let id = store
        .finish_reconciliation(
            &FinishReconciliation {
                account_id: acct,
                period_start: Some(day("2026-07-01")),
                statement_date: day("2026-08-31"),
                statement_start: Some(dec("1000.00")),
                statement_end: dec("1150.00"),
                source: ReconcileSource::Manual,
            },
            test_now(),
        )
        .unwrap()
        .expect("balances");

    let (period_start, starting, source): (Option<String>, Option<String>, Option<String>) = store
        .conn
        .query_row(
            "SELECT period_start, starting_balance, source FROM reconciliations WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(
        (period_start.as_deref(), starting.as_deref(), source.as_deref()),
        (Some("2026-07-01"), Some("1000.00"), Some("manual"))
    );
    let settled = |tid: i64| -> Option<i64> {
        store
            .conn
            .query_row("SELECT reconciliation_id FROM transactions WHERE id = ?1", params![tid], |r| r.get(0))
            .unwrap()
    };
    assert_eq!((settled(deposit), settled(coffee), settled(gas)), (Some(id), Some(id), None));
}

#[test]
fn a_credit_card_reconciles_on_what_is_owed() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Card", AccountType::Credit).unwrap();
    // A card added while it already owed $300: the app's limit-based balance never matters here.
    store
        .save_transactions(card, &[tx("2026-08-03", "Groceries", "-80.00"), tx("2026-08-20", "Payment", "300.00")])
        .unwrap();
    let ids = [id_of(&store, "Groceries", "2026-08-03"), id_of(&store, "Payment", "2026-08-20")];
    store.set_transactions_cleared(&ids, true).unwrap();

    let status = store
        .reconcile_status(card, day("2026-08-31"), Some(dec("300.00")), dec("80.00"))
        .unwrap();
    assert_eq!(status.ticked_change, dec("-220.00"), "a charge raises what is owed; a payment lowers it");
    assert_eq!(status.difference, Some(Decimal::ZERO));
}

#[test]
fn a_loan_reconciles_on_outstanding_principal() {
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    store.save_transactions(loan, &[tx("2026-09-01", "Payment", "2405.94")]).unwrap();
    let payment = id_of(&store, "Payment", "2026-09-01");
    store
        .conn
        .execute("UPDATE transactions SET principal_amount = '355.17' WHERE id = ?1", params![payment])
        .unwrap();
    store.set_transactions_cleared(&[payment], true).unwrap();

    let status = store
        .reconcile_status(loan, day("2026-09-30"), Some(dec("317195.46")), dec("316840.29"))
        .unwrap();
    assert_eq!(status.ticked_change, dec("-355.17"));
    assert_eq!(status.difference, Some(Decimal::ZERO));
}

#[test]
fn balance_change_follows_each_account_kind() {
    use crate::store::{AccountKind, balance_change};
    assert_eq!(balance_change(AccountKind::Cash, dec("-5"), None), dec("-5"));
    assert_eq!(balance_change(AccountKind::Investment, dec("12"), None), dec("12"));
    assert_eq!(balance_change(AccountKind::Credit, dec("-5"), None), dec("5"));
    assert_eq!(balance_change(AccountKind::Loan, dec("100"), Some(dec("40"))), dec("-40"));
    assert_eq!(balance_change(AccountKind::Loan, dec("100"), None), dec("-100"));
}

#[test]
fn candidates_drop_rows_settled_by_any_reconciliation_even_late_ones() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
    finish(&store, acct, "2026-08-31", Some("1000.00"), "1150.00").unwrap();
    store.set_transactions_cleared(&[gas], true).unwrap();

    let candidates = store.reconcile_candidates(acct, day("2026-09-30")).unwrap();
    assert_eq!(candidates.iter().map(|c| c.id).collect::<Vec<_>>(), vec![gas]);
}

#[test]
fn a_deleted_ticked_transaction_stops_counting() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, _]) = checking(&store);
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
    store.delete_transaction(deposit, test_now()).unwrap();
    let status = store
        .reconcile_status(acct, day("2026-08-31"), Some(dec("1000.00")), dec("950.00"))
        .unwrap();
    assert_eq!((status.ticked_change, status.ticked_count), (dec("-50.00"), 1));
}

#[test]
fn an_unknown_stored_account_type_is_an_error_not_a_cash_account() {
    let store = Store::open_in_memory().unwrap();
    let (acct, _) = checking(&store);
    store
        .conn
        .execute("UPDATE accounts SET account_type = 'mystery' WHERE id = ?1", params![acct])
        .unwrap();

    assert!(store.account_kind(acct).is_err());
    assert!(
        store
            .reconcile_status(acct, day("2026-08-31"), Some(dec("1000.00")), dec("1000.00"))
            .is_err()
    );
}

#[test]
fn finishing_while_the_caller_holds_a_transaction_fails_and_writes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, _, _]) = checking(&store);
    store.set_transactions_cleared(&[deposit], true).unwrap();

    let _held = store.conn.unchecked_transaction().unwrap();
    let result = store.finish_reconciliation(
        &FinishReconciliation {
            account_id: acct,
            period_start: None,
            statement_date: day("2026-08-31"),
            statement_start: Some(dec("1000.00")),
            statement_end: dec("1200.00"),
            source: ReconcileSource::Manual,
        },
        test_now(),
    );

    assert!(result.is_err(), "a nested transaction is refused, not silently run");
    drop(_held);
    let recorded: i64 = store.conn.query_row("SELECT COUNT(*) FROM reconciliations", [], |r| r.get(0)).unwrap();
    assert_eq!(recorded, 0);
    let linked: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM transactions WHERE reconciliation_id IS NOT NULL", [], |r| r.get(0))
        .unwrap();
    assert_eq!(linked, 0);
}

#[test]
fn a_first_reconciliation_without_a_statement_start_cannot_finish() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, _]) = checking(&store);
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();

    assert_eq!(finish(&store, acct, "2026-08-31", None, "1150.00"), None);
    let recorded: i64 = store.conn.query_row("SELECT COUNT(*) FROM reconciliations", [], |r| r.get(0)).unwrap();
    assert_eq!(recorded, 0);
    let linked: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM transactions WHERE reconciliation_id IS NOT NULL", [], |r| r.get(0))
        .unwrap();
    assert_eq!(linked, 0);
}

#[test]
fn a_credit_card_can_be_finished_on_what_is_owed() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Card", AccountType::Credit).unwrap();
    store
        .save_transactions(card, &[tx("2026-08-03", "Groceries", "-80.00"), tx("2026-08-20", "Payment", "300.00")])
        .unwrap();
    let groceries = id_of(&store, "Groceries", "2026-08-03");
    let payment = id_of(&store, "Payment", "2026-08-20");
    store.set_transactions_cleared(&[groceries, payment], true).unwrap();

    let id = finish(&store, card, "2026-08-31", Some("300.00"), "80.00").expect("balances");
    let settled = |tid: i64| -> Option<i64> {
        store
            .conn
            .query_row("SELECT reconciliation_id FROM transactions WHERE id = ?1", params![tid], |r| r.get(0))
            .unwrap()
    };
    assert_eq!((settled(groceries), settled(payment)), (Some(id), Some(id)));
}

#[test]
fn a_loan_can_be_finished_on_outstanding_principal() {
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    store.save_transactions(loan, &[tx("2026-09-01", "Payment", "2405.94")]).unwrap();
    let payment = id_of(&store, "Payment", "2026-09-01");
    store
        .conn
        .execute("UPDATE transactions SET principal_amount = '355.17' WHERE id = ?1", params![payment])
        .unwrap();
    store.set_transactions_cleared(&[payment], true).unwrap();

    let id = finish(&store, loan, "2026-09-30", Some("317195.46"), "316840.29").expect("balances");
    let settled: Option<i64> = store
        .conn
        .query_row("SELECT reconciliation_id FROM transactions WHERE id = ?1", params![payment], |r| r.get(0))
        .unwrap();
    assert_eq!(settled, Some(id));
}

#[test]
fn candidates_keep_a_ticked_row_dated_after_the_statement_but_drop_settled_ones() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
    finish(&store, acct, "2026-08-31", Some("1000.00"), "1150.00").unwrap();
    // Ticked, dated after the statement date, not yet settled: stays so the tick can be undone.
    store.set_transactions_cleared(&[gas], true).unwrap();

    let candidates = store.reconcile_candidates(acct, day("2026-08-31")).unwrap();
    assert_eq!(candidates.iter().map(|c| c.id).collect::<Vec<_>>(), vec![gas]);
}

// Statement reconciling: candidates, the review signature and the one-step finish.

use crate::statement::Period;
use crate::store::{HoldingChange, LayoutSaveError, StatementFinish, StatementFinishError};

fn august() -> Period {
    Period::new(day("2026-08-01"), day("2026-08-31")).unwrap()
}

fn finish_cash(acct: i64, matched: Vec<i64>, add: Vec<Transaction>, start: &str, end: &str) -> StatementFinish {
    StatementFinish {
        account_id: acct,
        period: august(),
        statement_start: Some(dec(start)),
        statement_end: Some(dec(end)),
        ending_value: None,
        source: ReconcileSource::StatementPdf,
        matched,
        add,
        add_principal: vec![],
        matched_principal: vec![],
        holdings: vec![],
        statement_shares: None,
        layout: None,
    }
}

/// An investment statement for August worth `ending_value`, checking the given share counts.
fn finish_investment(
    acct: i64,
    add: Vec<Transaction>,
    holdings: Vec<HoldingChange>,
    statement_shares: Option<Vec<(String, Decimal)>>,
) -> StatementFinish {
    StatementFinish {
        account_id: acct,
        period: august(),
        statement_start: None,
        statement_end: None,
        ending_value: Some(dec("84089.71")),
        source: ReconcileSource::StatementPdf,
        matched: vec![],
        add,
        add_principal: vec![],
        matched_principal: vec![],
        holdings,
        statement_shares,
        layout: None,
    }
}

fn shares(list: &[(&str, &str)]) -> Option<Vec<(String, Decimal)>> {
    Some(list.iter().map(|(symbol, n)| (symbol.to_string(), dec(n))).collect())
}

fn settled_by(store: &Store, id: i64) -> Option<i64> {
    store
        .conn
        .query_row("SELECT reconciliation_id FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

fn is_ticked(store: &Store, id: i64) -> bool {
    store
        .conn
        .query_row("SELECT cleared FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

fn count(store: &Store, sql: &str) -> i64 {
    store.conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// Nothing a refused finish could have written is there: no reconciliation, no settled transaction,
/// no extra transaction and no saved layout.
fn assert_nothing_written(store: &Store, transactions_before: i64) {
    assert_eq!(count(store, "SELECT COUNT(*) FROM reconciliations"), 0, "no reconciliation recorded");
    assert_eq!(
        count(store, "SELECT COUNT(*) FROM transactions WHERE reconciliation_id IS NOT NULL"),
        0,
        "no transaction settled"
    );
    assert_eq!(raw_transaction_count(store), transactions_before, "no transaction added");
    assert_eq!(count(store, "SELECT COUNT(*) FROM statement_layouts"), 0, "no layout saved");
}

#[test]
fn candidates_are_unsettled_rows_near_the_period_with_their_balance_change() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Card", AccountType::Credit).unwrap();
    store
        .save_transactions(
            card,
            &[
                tx("2026-07-20", "Too early", "-1.00"),
                tx("2026-07-28", "Leeway", "-2.00"),
                tx("2026-08-15", "Inside", "-3.00"),
            ],
        )
        .unwrap();
    let c = store.statement_candidates(card, &august()).unwrap();
    assert_eq!(c.iter().map(|x| x.description.as_str()).collect::<Vec<_>>(), vec!["Leeway", "Inside"]);
    assert_eq!(c[1].change, dec("3.00"), "a card charge raises what is owed");
}

#[test]
fn candidates_leave_out_settled_deleted_and_other_accounts_rows() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, _]) = checking(&store);
    let other = store.get_or_create_account("Other", AccountType::Checking).unwrap();
    store.save_transactions(other, &[tx("2026-08-11", "Elsewhere", "-9.00")]).unwrap();
    store
        .save_transactions(acct, &[tx("2026-08-12", "Gone", "-4.00"), tx("2026-08-13", "Kept", "-6.00")])
        .unwrap();
    store.delete_transaction(id_of(&store, "Gone", "2026-08-12"), test_now()).unwrap();
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
    finish(&store, acct, "2026-08-10", Some("1000.00"), "1150.00").expect("balances");

    let c = store.statement_candidates(acct, &august()).unwrap();
    // Gas (09-05) is within the week after the period.
    assert_eq!(c.iter().map(|x| x.description.as_str()).collect::<Vec<_>>(), vec!["Kept", "Gas"]);
    assert_eq!((c[0].amount, c[0].change, c[0].date), (dec("-6.00"), dec("-6.00"), day("2026-08-13")));
}

#[test]
fn a_statement_finish_ticks_adds_settles_and_unticks_what_was_not_on_it() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[gas], true).unwrap(); // ticked early; not on this statement
    let done = store
        .finish_statement_reconciliation(
            &finish_cash(acct, vec![coffee], vec![tx("2026-08-20", "Bank fee", "-5.00")], "1200.00", "1145.00"),
            test_now(),
        )
        .unwrap();
    assert_eq!(done.added, 1);
    assert_eq!(done.layout_id, None);
    assert_eq!(settled_by(&store, coffee), Some(done.reconciliation_id));
    assert_eq!(settled_by(&store, id_of(&store, "Bank fee", "2026-08-20")), Some(done.reconciliation_id));
    assert_eq!(settled_by(&store, gas), None);
    assert!(!is_ticked(&store, gas));
    assert!(!is_ticked(&store, deposit));
    assert_eq!(settled_by(&store, deposit), None);
    let (source, period_start, starting, ending, date): (String, Option<String>, Option<String>, String, String) = store
        .conn
        .query_row(
            "SELECT source, period_start, starting_balance, statement_balance, statement_date FROM reconciliations WHERE id = ?1",
            params![done.reconciliation_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap();
    assert_eq!(
        (
            source.as_str(),
            period_start.as_deref(),
            starting.as_deref(),
            ending.as_str(),
            date.as_str()
        ),
        ("statement_pdf", Some("2026-08-01"), Some("1200.00"), "1145.00", "2026-08-31")
    );
}

#[test]
fn a_statement_finish_that_does_not_balance_writes_nothing_at_all() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, _]) = checking(&store);
    let result = store.finish_statement_reconciliation(
        &finish_cash(acct, vec![coffee], vec![tx("2026-08-20", "Bank fee", "-5.00")], "1200.00", "9999.00"),
        test_now(),
    );
    assert!(matches!(result, Err(StatementFinishError::DoesNotBalance)));
    let fee: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM transactions WHERE description = 'Bank fee'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fee, 0, "the added transaction was rolled back");
    assert_eq!(store.last_reconciliation(acct).unwrap(), None);
    assert!(!is_ticked(&store, coffee), "the tick was rolled back too");
}

#[test]
fn finishing_the_same_statement_twice_is_refused() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, _]) = checking(&store);
    let f = finish_cash(acct, vec![coffee], vec![], "1200.00", "1150.00");
    store.finish_statement_reconciliation(&f, test_now()).unwrap();
    let again = store.finish_statement_reconciliation(&f, test_now());
    assert!(matches!(again, Err(StatementFinishError::AlreadyReconciled)));
    let records: i64 = store.conn.query_row("SELECT COUNT(*) FROM reconciliations", [], |r| r.get(0)).unwrap();
    assert_eq!(records, 1);
}

#[test]
fn a_cash_finish_without_an_ending_balance_does_not_balance() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, _]) = checking(&store);
    let mut f = finish_cash(acct, vec![coffee], vec![], "1200.00", "1150.00");
    f.statement_end = None;
    let result = store.finish_statement_reconciliation(&f, test_now());
    assert!(matches!(result, Err(StatementFinishError::DoesNotBalance)));
    assert_nothing_written(&store, 3);
}

#[test]
fn a_transaction_from_another_account_is_refused() {
    let store = Store::open_in_memory().unwrap();
    let (acct, _) = checking(&store);
    let other = store.get_or_create_account("Other", AccountType::Checking).unwrap();
    store.save_transactions(other, &[tx("2026-08-10", "Elsewhere", "-50.00")]).unwrap();
    let elsewhere = id_of(&store, "Elsewhere", "2026-08-10");
    let result = store.finish_statement_reconciliation(&finish_cash(acct, vec![elsewhere], vec![], "1200.00", "1150.00"), test_now());
    assert!(matches!(result, Err(StatementFinishError::NotThisAccount)));
    assert_nothing_written(&store, 4);
}

#[test]
fn an_already_settled_deleted_unknown_or_repeated_match_is_refused() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[deposit], true).unwrap();
    let earlier = finish(&store, acct, "2026-07-31", Some("1000.00"), "1200.00").expect("balances");
    store.delete_transaction(gas, test_now()).unwrap();

    for matched in [vec![deposit], vec![gas], vec![999_999], vec![coffee, coffee]] {
        let result = store.finish_statement_reconciliation(&finish_cash(acct, matched.clone(), vec![], "1200.00", "1150.00"), test_now());
        assert!(matches!(result, Err(StatementFinishError::NotThisAccount)), "{matched:?} must be refused");
    }
    assert_eq!(
        count(&store, "SELECT COUNT(*) FROM reconciliations"),
        1,
        "only the earlier reconciliation"
    );
    assert_eq!(settled_by(&store, deposit), Some(earlier));
    assert_eq!((settled_by(&store, coffee), is_ticked(&store, coffee)), (None, false));
}

#[test]
fn adding_a_transaction_that_is_already_in_the_app_is_refused_and_writes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[gas], true).unwrap();
    // Gas is in the app, unsettled and not matched to any statement row: adding it again would double it.
    let f = finish_cash(
        acct,
        vec![coffee],
        vec![tx("2026-08-20", "Bank fee", "-5.00"), tx("2026-09-05", " GAS ", "-30.00")],
        "1200.00",
        "1115.00",
    );
    let result = store.finish_statement_reconciliation(&f, test_now());
    assert!(matches!(result, Err(StatementFinishError::AlreadyInApp)));
    assert_nothing_written(&store, 3);
    assert!(is_ticked(&store, gas), "the earlier tick is untouched");
    assert!(!is_ticked(&store, coffee));
}

#[test]
fn a_second_identical_charge_can_be_added_when_the_first_is_matched() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, _]) = checking(&store);
    // The statement shows the same coffee twice; the app had it once.
    let done = store
        .finish_statement_reconciliation(
            &finish_cash(acct, vec![coffee], vec![tx("2026-08-10", "Coffee", "-50.00")], "1200.00", "1100.00"),
            test_now(),
        )
        .unwrap();
    assert_eq!(done.added, 1);
    assert_eq!(
        count(
            &store,
            "SELECT COUNT(*) FROM transactions WHERE description = 'Coffee' AND reconciliation_id IS NOT NULL"
        ),
        2
    );
}

#[test]
fn a_failure_after_adding_transactions_rolls_everything_back() {
    use crate::statement::layout::{GENERAL_ID, built_in_layouts};
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[gas], true).unwrap();
    let layout = built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap();

    // Balances, but the learned layout to update is gone: the very last step fails.
    let mut f = finish_cash(acct, vec![coffee], vec![tx("2026-08-20", "Bank fee", "-5.00")], "1200.00", "1145.00");
    f.layout = Some((Some(424_242), "Riverbend".into(), layout.clone()));
    let result = store.finish_statement_reconciliation(&f, test_now());
    assert!(matches!(result, Err(StatementFinishError::Layout(LayoutSaveError::Missing))));
    assert_nothing_written(&store, 3);
    assert!(is_ticked(&store, gas), "the untick was rolled back");
    assert!(!is_ticked(&store, coffee), "the tick was rolled back");

    // A name the app won't keep fails the same way.
    f.layout = Some((None, "Account 12345678".into(), layout));
    let result = store.finish_statement_reconciliation(&f, test_now());
    assert!(matches!(result, Err(StatementFinishError::Layout(LayoutSaveError::Name))));
    assert_nothing_written(&store, 3);
    assert!(is_ticked(&store, gas));
}

#[test]
fn a_failing_holdings_change_rolls_back_the_added_transactions_and_other_holding_changes() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let other = store.get_or_create_account("Other Brokerage", AccountType::Investment).unwrap();
    let held = store
        .create_holding(brokerage, "ABCD", "Alpha", dec("49"), dec("300"), dec("10000"), None)
        .unwrap();
    let elsewhere = store
        .create_holding(other, "WXYZ", "Other", dec("5"), dec("10"), dec("50"), None)
        .unwrap();
    store.save_transactions(brokerage, &[tx("2026-07-30", "Old dividend", "3.00")]).unwrap();
    let old = id_of(&store, "Old dividend", "2026-07-30");
    store.set_transactions_cleared(&[old], true).unwrap();

    let f = StatementFinish {
        account_id: brokerage,
        period: august(),
        statement_start: None,
        statement_end: None,
        ending_value: Some(dec("15000.00")),
        source: ReconcileSource::StatementPdf,
        matched: vec![],
        add: vec![tx("2026-08-05", "Cash Dividend", "18.50")],
        add_principal: vec![],
        matched_principal: vec![],
        holdings: vec![
            HoldingChange::SetShares {
                holding_id: held,
                shares: dec("50"),
            },
            HoldingChange::Add {
                symbol: "EFGH".into(),
                name: "Example Income".into(),
                shares: dec("1"),
                price: dec("9.47"),
                cost_basis: dec("9"),
            },
            HoldingChange::Remove { holding_id: elsewhere },
        ],
        statement_shares: Some(vec![("ABCD".into(), dec("50")), ("EFGH".into(), dec("1"))]),
        layout: None,
    };
    let result = store.finish_statement_reconciliation(&f, test_now());
    assert!(matches!(result, Err(StatementFinishError::NotThisAccount)));
    assert_nothing_written(&store, 1);
    assert!(is_ticked(&store, old), "the untick was rolled back");
    let holdings = store.list_holdings(far_future()).unwrap();
    assert_eq!(holdings.len(), 2, "no holding added or removed");
    let abcd = holdings.iter().find(|h| h.id == held).unwrap();
    assert_eq!(abcd.shares, dec("49"), "the share change was rolled back");
}

#[test]
fn holdings_changes_on_an_account_that_is_not_an_investment_account_are_refused() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, _]) = checking(&store);
    let mut f = finish_cash(acct, vec![coffee], vec![], "1200.00", "1150.00");
    f.holdings = vec![HoldingChange::Add {
        symbol: "ABCD".into(),
        name: "Alpha".into(),
        shares: dec("1"),
        price: dec("1"),
        cost_basis: dec("1"),
    }];
    let result = store.finish_statement_reconciliation(&f, test_now());
    assert!(matches!(result, Err(StatementFinishError::NotThisAccount)));
    assert_nothing_written(&store, 3);
    assert!(store.list_holdings(far_future()).unwrap().is_empty());
}

#[test]
fn an_investment_finish_fixes_share_counts_and_requires_them_to_match() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let held = store
        .create_holding(brokerage, "ABCD", "Alpha", dec("49"), dec("300"), dec("10000"), None)
        .unwrap();
    let base = StatementFinish {
        account_id: brokerage,
        period: august(),
        statement_start: None,
        statement_end: None,
        ending_value: Some(dec("84089.71")),
        source: ReconcileSource::StatementPdf,
        matched: vec![],
        add: vec![tx("2026-08-05", "Cash Dividend", "18.50")],
        add_principal: vec![],
        matched_principal: vec![],
        holdings: vec![],
        statement_shares: Some(vec![("ABCD".into(), dec("50.000")), ("EFGH".into(), dec("252.523"))]),
        layout: None,
    };

    let refused = store.finish_statement_reconciliation(&base, test_now());
    assert!(matches!(refused, Err(StatementFinishError::SharesDiffer(ref s)) if s == "ABCD"));
    assert_nothing_written(&store, 0);

    let fixed = StatementFinish {
        holdings: vec![
            HoldingChange::SetShares {
                holding_id: held,
                shares: dec("50"),
            },
            HoldingChange::Add {
                symbol: "EFGH".into(),
                name: "Example Income".into(),
                shares: dec("252.523"),
                price: dec("9.47"),
                cost_basis: dec("2400"),
            },
        ],
        ..base
    };
    let done = store.finish_statement_reconciliation(&fixed, test_now()).unwrap();
    let (checked, balance, starting): (Option<i64>, String, Option<String>) = store
        .conn
        .query_row(
            "SELECT holdings_checked, statement_balance, starting_balance FROM reconciliations WHERE id = ?1",
            params![done.reconciliation_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!((checked, balance.as_str(), starting), (Some(1), "84089.71", None));
    assert_eq!(store.list_holdings(far_future()).unwrap().len(), 2);
    assert_eq!(
        settled_by(&store, id_of(&store, "Cash Dividend", "2026-08-05")),
        Some(done.reconciliation_id)
    );
}

#[test]
fn an_investment_finish_allows_app_only_holdings_and_records_when_holdings_were_not_checked() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    store
        .create_holding(brokerage, "ABCD", "Alpha", dec("49"), dec("300"), dec("10000"), None)
        .unwrap();
    // An app-only holding the person chose to leave, and a holding listed twice on the statement (two lots).
    store
        .create_holding(brokerage, "KEEP", "Kept", dec("3"), dec("1"), dec("1"), None)
        .unwrap();
    let mut f = StatementFinish {
        account_id: brokerage,
        period: august(),
        statement_start: None,
        statement_end: None,
        ending_value: Some(dec("100.00")),
        source: ReconcileSource::StatementDownload,
        matched: vec![],
        add: vec![],
        add_principal: vec![],
        matched_principal: vec![],
        holdings: vec![],
        statement_shares: Some(vec![("abcd ".into(), dec("20")), ("ABCD".into(), dec("29.0"))]),
        layout: None,
    };
    let done = store.finish_statement_reconciliation(&f, test_now()).unwrap();
    let checked: Option<i64> = store
        .conn
        .query_row(
            "SELECT holdings_checked FROM reconciliations WHERE id = ?1",
            params![done.reconciliation_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(checked, Some(1));

    f.statement_shares = None;
    let done = store.finish_statement_reconciliation(&f, test_now()).unwrap();
    let checked: Option<i64> = store
        .conn
        .query_row(
            "SELECT holdings_checked FROM reconciliations WHERE id = ?1",
            params![done.reconciliation_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(checked, Some(0), "finished without checking holdings");
}

#[test]
fn a_learned_layout_is_saved_in_the_same_step_and_rolled_back_with_it() {
    use crate::statement::layout::{GENERAL_ID, built_in_layouts};
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, _]) = checking(&store);
    let layout = built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap();
    let mut f = finish_cash(acct, vec![coffee], vec![], "1200.00", "9999.00");
    f.layout = Some((None, "Riverbend".into(), layout.clone()));
    assert!(store.finish_statement_reconciliation(&f, test_now()).is_err());
    assert!(store.list_statement_layouts().unwrap().is_empty());

    f.statement_end = Some(dec("1150.00"));
    let done = store.finish_statement_reconciliation(&f, test_now()).unwrap();
    assert!(done.layout_id.is_some());
    let saved = store.list_statement_layouts().unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!((Some(saved[0].id), saved[0].name.as_str()), (done.layout_id, "Riverbend"));
}

#[test]
fn a_credit_card_statement_finishes_on_what_is_owed() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Card", AccountType::Credit).unwrap();
    store
        .save_transactions(card, &[tx("2026-08-03", "Groceries", "-80.00"), tx("2026-08-20", "Payment", "300.00")])
        .unwrap();
    let groceries = id_of(&store, "Groceries", "2026-08-03");
    let payment = id_of(&store, "Payment", "2026-08-20");
    // Owed 300; the payment of 300 lowers it, two charges (80 and an added 12.34) raise it: 92.34 owed.
    let f = finish_cash(
        card,
        vec![groceries, payment],
        vec![tx("2026-08-25", "Late fee", "-12.34")],
        "300.00",
        "92.34",
    );
    let done = store.finish_statement_reconciliation(&f, test_now()).unwrap();
    assert_eq!(settled_by(&store, payment), Some(done.reconciliation_id));
    assert_eq!(store.last_reconciliation(card).unwrap(), Some((day("2026-08-31"), dec("92.34"))));

    // Reading the charge with the app's own sign (lowering what is owed) does not balance.
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Card", AccountType::Credit).unwrap();
    store.save_transactions(card, &[tx("2026-08-03", "Groceries", "-80.00")]).unwrap();
    let groceries = id_of(&store, "Groceries", "2026-08-03");
    let result = store.finish_statement_reconciliation(&finish_cash(card, vec![groceries], vec![], "300.00", "220.00"), test_now());
    assert!(matches!(result, Err(StatementFinishError::DoesNotBalance)));
}

#[test]
fn a_loan_statement_finishes_on_outstanding_principal() {
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    store.save_transactions(loan, &[tx("2026-08-01", "Payment", "2405.94")]).unwrap();
    let payment = id_of(&store, "Payment", "2026-08-01");
    store.update_transaction_principal_amount(payment, Some(dec("355.17"))).unwrap();
    // An extra principal payment the app didn't have, added from the statement, lowers it by its amount.
    let f = finish_cash(
        loan,
        vec![payment],
        vec![tx("2026-08-15", "Extra principal", "100.00")],
        "317195.46",
        "316740.29",
    );
    let done = store.finish_statement_reconciliation(&f, test_now()).unwrap();
    assert_eq!(settled_by(&store, payment), Some(done.reconciliation_id));
    assert_eq!(store.last_reconciliation(loan).unwrap(), Some((day("2026-08-31"), dec("316740.29"))));
}

#[test]
fn a_later_statement_picks_up_from_the_last_one_and_ignores_a_typed_start() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[deposit], true).unwrap();
    finish(&store, acct, "2026-07-31", Some("1000.00"), "1200.00").expect("balances");
    let mut f = finish_cash(acct, vec![coffee], vec![], "5.00", "1150.00");
    store.finish_statement_reconciliation(&f, test_now()).unwrap();

    f.period = Period::new(day("2026-09-01"), day("2026-09-30")).unwrap();
    f.matched = vec![gas];
    f.statement_end = Some(dec("1120.00"));
    let done = store.finish_statement_reconciliation(&f, test_now()).unwrap();
    assert_eq!(settled_by(&store, gas), Some(done.reconciliation_id));
}

#[test]
fn a_statement_finish_while_the_caller_holds_a_transaction_fails_and_writes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, _]) = checking(&store);
    {
        let _held = store.conn.unchecked_transaction().unwrap();
        let result = store.finish_statement_reconciliation(
            &finish_cash(acct, vec![coffee], vec![tx("2026-08-20", "Bank fee", "-5.00")], "1200.00", "1145.00"),
            test_now(),
        );
        assert!(matches!(result, Err(StatementFinishError::Db(_))));
    }
    assert_nothing_written(&store, 3);
}

#[test]
fn statement_finish_errors_read_plainly() {
    let messages = [
        StatementFinishError::DoesNotBalance.to_string(),
        StatementFinishError::SharesDiffer("ABCD".into()).to_string(),
        StatementFinishError::NotThisAccount.to_string(),
        StatementFinishError::AlreadyInApp.to_string(),
        StatementFinishError::Layout(LayoutSaveError::Missing).to_string(),
        StatementFinishError::Db(rusqlite::Error::QueryReturnedNoRows).to_string(),
        StatementFinishError::HoldingsNotChecked.to_string(),
    ];
    assert!(messages[0].contains("$0.00"));
    assert!(messages[1].contains("ABCD"));
    for m in &messages {
        assert_plain(m);
    }
}

/// User-visible text: not empty, and none of the words the app avoids.
fn assert_plain(message: &str) {
    assert!(!message.trim().is_empty());
    let lower = message.to_lowercase();
    for jargon in ["layout", "parse", "cleared", "unmatched", "tracked", "published", "sql", "query", "rows"] {
        assert!(!lower.contains(jargon), "{message:?} uses {jargon:?}");
    }
}

#[test]
fn the_review_signature_changes_when_the_account_changes() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = checking(&store);
    let other = store.get_or_create_account("Other", AccountType::Checking).unwrap();
    let sig = |s: &Store| s.reconcile_signature(acct).unwrap();
    let mut before = sig(&store);
    assert_eq!(before, sig(&store), "stable while nothing changes");

    let mut changes = |what: &str, change: &dyn Fn(&Store)| {
        change(&store);
        let after = sig(&store);
        assert_ne!(before, after, "{what} must change the signature");
        before = after;
    };
    changes("ticking", &|s: &Store| s.set_transactions_cleared(&[deposit], true).unwrap());
    changes("unticking", &|s: &Store| s.set_transactions_cleared(&[deposit], false).unwrap());
    changes("adding", &|s: &Store| {
        s.save_transactions(acct, &[tx("2026-08-21", "New", "-1.00")]).unwrap();
    });
    changes("editing an amount", &|s: &Store| {
        s.update_transaction_amount(coffee, dec("-51.00")).unwrap();
    });
    changes("editing a date", &|s: &Store| {
        s.update_transaction_date(coffee, day("2026-08-11")).unwrap()
    });
    changes("editing a description", &|s: &Store| {
        s.update_transaction_description(coffee, "Cafe").unwrap()
    });
    changes("editing a principal part", &|s: &Store| {
        s.update_transaction_principal_amount(coffee, Some(dec("-1"))).unwrap()
    });
    changes("deleting", &|s: &Store| s.delete_transaction(gas, test_now()).unwrap());
    changes("restoring", &|s: &Store| s.restore_transactions(&[gas]).unwrap());
    changes("moving a transaction out", &|s: &Store| s.update_transaction_account(gas, other).unwrap());
    changes("finishing a reconciliation", &|s: &Store| {
        s.set_transactions_cleared(&[deposit], true).unwrap();
        finish(s, acct, "2026-07-31", Some("1000.00"), "1200.00").expect("balances");
    });
    changes("adding a holding", &|s: &Store| {
        s.create_holding(acct, "ABCD", "Alpha", dec("1"), dec("1"), dec("1"), None).unwrap();
    });

    // Nothing in another account matters.
    store.save_transactions(other, &[tx("2026-08-22", "Elsewhere", "-2.00")]).unwrap();
    let elsewhere = id_of(&store, "Elsewhere", "2026-08-22");
    store.set_transactions_cleared(&[elsewhere], true).unwrap();
    store.update_transaction_amount(elsewhere, dec("-3.00")).unwrap();
    store.delete_transaction(elsewhere, test_now()).unwrap();
    store.create_holding(other, "WXYZ", "Other", dec("1"), dec("1"), dec("1"), None).unwrap();
    assert_eq!(before, sig(&store), "another account's changes don't count");
}

// Review round 1.

fn holdings_checked(store: &Store, reconciliation_id: i64) -> Option<i64> {
    store
        .conn
        .query_row(
            "SELECT holdings_checked FROM reconciliations WHERE id = ?1",
            params![reconciliation_id],
            |r| r.get(0),
        )
        .unwrap()
}

#[test]
fn an_investment_statement_finish_is_not_a_starting_point_for_later_reconciling() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let done = store
        .finish_statement_reconciliation(&finish_investment(brokerage, vec![], vec![], None), test_now())
        .unwrap();
    assert_eq!(holdings_checked(&store, done.reconciliation_id), Some(0));
    assert_eq!(
        store.last_reconciliation(brokerage).unwrap(),
        Some((day("2026-08-31"), dec("84089.71"))),
        "still the latest record of any kind, for showing its date"
    );
    assert_eq!(store.last_balance_reconciliation(brokerage).unwrap(), None);

    store.save_transactions(brokerage, &[tx("2026-09-03", "Dividend", "10.00")]).unwrap();
    store.set_transactions_cleared(&[id_of(&store, "Dividend", "2026-09-03")], true).unwrap();
    let status = store
        .reconcile_status(brokerage, day("2026-09-30"), Some(dec("500.00")), dec("510.00"))
        .unwrap();
    assert!(status.needs_starting_balance);
    assert_eq!(status.starting_point, Some(dec("500.00")), "the typed start, not the total value");
    assert_eq!(status.difference, Some(Decimal::ZERO));
}

#[test]
fn a_manual_reconciliation_stays_the_starting_point_after_an_investment_statement_finish() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    store.save_transactions(brokerage, &[tx("2026-07-10", "Interest", "5.00")]).unwrap();
    store.set_transactions_cleared(&[id_of(&store, "Interest", "2026-07-10")], true).unwrap();
    finish(&store, brokerage, "2026-07-31", Some("100.00"), "105.00").expect("balances");
    store
        .finish_statement_reconciliation(&finish_investment(brokerage, vec![], vec![], shares(&[])), test_now())
        .unwrap();
    assert_eq!(
        store.last_balance_reconciliation(brokerage).unwrap(),
        Some((day("2026-07-31"), dec("105.00")))
    );

    store.save_transactions(brokerage, &[tx("2026-09-03", "Dividend", "10.00")]).unwrap();
    store.set_transactions_cleared(&[id_of(&store, "Dividend", "2026-09-03")], true).unwrap();
    let status = store.reconcile_status(brokerage, day("2026-09-30"), None, dec("115.00")).unwrap();
    assert!(!status.needs_starting_balance);
    assert_eq!(status.starting_point, Some(dec("105.00")));
    assert_eq!(status.difference, Some(Decimal::ZERO));
}

#[test]
fn a_cash_statement_finish_is_the_starting_point_for_the_next_reconciliation() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, gas]) = checking(&store);
    let done = store
        .finish_statement_reconciliation(&finish_cash(acct, vec![coffee], vec![], "1200.00", "1150.00"), test_now())
        .unwrap();
    assert_eq!(holdings_checked(&store, done.reconciliation_id), None);
    assert_eq!(
        store.last_balance_reconciliation(acct).unwrap(),
        Some((day("2026-08-31"), dec("1150.00")))
    );

    store.set_transactions_cleared(&[gas], true).unwrap();
    let status = store
        .reconcile_status(acct, day("2026-09-30"), Some(dec("9999.00")), dec("1120.00"))
        .unwrap();
    assert!(!status.needs_starting_balance);
    assert_eq!(status.starting_point, Some(dec("1150.00")));
    assert_eq!(status.difference, Some(Decimal::ZERO));

    // A later record on the same statement date wins the tie.
    finish(&store, acct, "2026-08-31", None, "1120.00").expect("balances");
    assert_eq!(
        store.last_balance_reconciliation(acct).unwrap(),
        Some((day("2026-08-31"), dec("1120.00")))
    );
}

#[test]
fn cash_rows_settled_by_a_later_investment_statement_carry_into_the_next_starting_point() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    store.save_transactions(brokerage, &[tx("2026-07-10", "Interest", "5.00")]).unwrap();
    store.set_transactions_cleared(&[id_of(&store, "Interest", "2026-07-10")], true).unwrap();
    finish(&store, brokerage, "2026-07-31", Some("100.00"), "105.00").expect("balances");

    // August's investment statement settles an added dividend of 18.50 and a matched fee of -2.00.
    store.save_transactions(brokerage, &[tx("2026-08-20", "Fee", "-2.00")]).unwrap();
    let fee = id_of(&store, "Fee", "2026-08-20");
    let mut august_statement = finish_investment(brokerage, vec![tx("2026-08-05", "Cash Dividend", "18.50")], vec![], None);
    august_statement.matched = vec![fee];
    let done = store.finish_statement_reconciliation(&august_statement, test_now()).unwrap();
    assert_eq!(settled_by(&store, fee), Some(done.reconciliation_id));

    let status = store
        .reconcile_status(brokerage, day("2026-09-30"), Some(dec("9999.00")), dec("121.50"))
        .unwrap();
    assert!(!status.needs_starting_balance);
    assert_eq!(status.starting_point, Some(dec("121.50")), "105.00 + 18.50 - 2.00");
    assert_eq!(status.difference, Some(Decimal::ZERO));

    store.save_transactions(brokerage, &[tx("2026-09-03", "Dividend", "10.00")]).unwrap();
    store.set_transactions_cleared(&[id_of(&store, "Dividend", "2026-09-03")], true).unwrap();
    let september = finish(&store, brokerage, "2026-09-30", None, "131.50").expect("balances from 121.50");
    let starting: Option<String> = store
        .conn
        .query_row("SELECT starting_balance FROM reconciliations WHERE id = ?1", params![september], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(starting.as_deref(), Some("121.50"));

    // Rows the manual September reconciliation settled itself are in its ending balance, not carried twice.
    let status = store.reconcile_status(brokerage, day("2026-10-31"), None, dec("131.50")).unwrap();
    assert_eq!(status.starting_point, Some(dec("131.50")));
}

#[test]
fn rows_settled_by_an_investment_statement_before_the_last_balance_record_are_not_carried() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    store
        .finish_statement_reconciliation(
            &finish_investment(brokerage, vec![tx("2026-08-05", "Cash Dividend", "18.50")], vec![], None),
            test_now(),
        )
        .unwrap();
    // The first manual reconciliation starts from its statement's own starting balance.
    store.save_transactions(brokerage, &[tx("2026-09-03", "Dividend", "10.00")]).unwrap();
    store.set_transactions_cleared(&[id_of(&store, "Dividend", "2026-09-03")], true).unwrap();
    finish(&store, brokerage, "2026-09-30", Some("500.00"), "510.00").expect("balances");

    let status = store.reconcile_status(brokerage, day("2026-10-31"), None, dec("510.00")).unwrap();
    assert_eq!(status.starting_point, Some(dec("510.00")), "the earlier dividend is not added again");
}

fn mortgage(store: &Store) -> i64 {
    store.get_or_create_account("Mortgage", AccountType::Loan).unwrap()
}

/// August's mortgage statement: principal owed falls from 317,195.46 to 316,840.29.
fn mortgage_finish(loan: i64, add: Vec<Transaction>, add_principal: Vec<Option<Decimal>>, end: &str) -> StatementFinish {
    StatementFinish {
        add_principal,
        ..finish_cash(loan, vec![], add, "317195.46", end)
    }
}

#[test]
fn an_added_loan_payment_can_carry_its_principal_part() {
    let store = Store::open_in_memory().unwrap();
    let loan = mortgage(&store);
    let f = mortgage_finish(loan, vec![tx("2026-08-01", "Payment", "2405.94")], vec![Some(dec("355.17"))], "316840.29");
    let done = store.finish_statement_reconciliation(&f, test_now()).unwrap();
    let payment = id_of(&store, "Payment", "2026-08-01");
    let principal: Option<String> = store
        .conn
        .query_row("SELECT principal_amount FROM transactions WHERE id = ?1", params![payment], |r| r.get(0))
        .unwrap();
    assert_eq!(principal.as_deref(), Some("355.17"));
    assert_eq!(settled_by(&store, payment), Some(done.reconciliation_id));

    // Mixed: one added row with a principal part and one without (counted at its full amount).
    let store = Store::open_in_memory().unwrap();
    let loan = mortgage(&store);
    let f = mortgage_finish(
        loan,
        vec![tx("2026-08-01", "Payment", "2405.94"), tx("2026-08-15", "Extra principal", "100.00")],
        vec![Some(dec("355.17")), None],
        "316740.29",
    );
    store.finish_statement_reconciliation(&f, test_now()).unwrap();
}

#[test]
fn an_added_loan_payment_without_its_principal_part_does_not_balance() {
    let store = Store::open_in_memory().unwrap();
    let loan = mortgage(&store);
    let f = mortgage_finish(loan, vec![tx("2026-08-01", "Payment", "2405.94")], vec![], "316840.29");
    let result = store.finish_statement_reconciliation(&f, test_now());
    assert!(matches!(result, Err(StatementFinishError::DoesNotBalance)));
    assert_nothing_written(&store, 0);

    // With the principal part but the wrong ending balance: nothing is kept, principal included.
    let f = mortgage_finish(loan, vec![tx("2026-08-01", "Payment", "2405.94")], vec![Some(dec("355.17"))], "316000.00");
    let result = store.finish_statement_reconciliation(&f, test_now());
    assert!(matches!(result, Err(StatementFinishError::DoesNotBalance)));
    assert_nothing_written(&store, 0);
    assert_eq!(count(&store, "SELECT COUNT(*) FROM transactions WHERE principal_amount IS NOT NULL"), 0);
}

#[test]
fn a_principal_part_that_does_not_fit_is_refused_and_writes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let loan = mortgage(&store);
    let payment = || vec![tx("2026-08-01", "Payment", "2405.94")];
    let mut short = mortgage_finish(loan, payment(), vec![Some(dec("355.17"))], "316740.29");
    short.add.push(tx("2026-08-15", "Extra principal", "100.00"));
    let refused = [
        (
            "larger than the payment",
            mortgage_finish(loan, payment(), vec![Some(dec("2405.95"))], "316840.29"),
        ),
        ("negative", mortgage_finish(loan, payment(), vec![Some(dec("-1.00"))], "316840.29")),
        (
            "more entries than rows to add",
            mortgage_finish(loan, payment(), vec![Some(dec("355.17")), None], "316840.29"),
        ),
        ("fewer entries than rows to add", short),
    ];
    for (why, f) in refused {
        let result = store.finish_statement_reconciliation(&f, test_now());
        match result {
            Err(e @ StatementFinishError::BadInput(_)) => assert_plain(&e.to_string()),
            other => panic!("{why}: expected BadInput, got {other:?}"),
        }
        assert_nothing_written(&store, 0);
    }

    // A principal part on an account that is not a loan.
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, _]) = checking(&store);
    let mut f = finish_cash(acct, vec![coffee], vec![tx("2026-08-20", "Bank fee", "-5.00")], "1200.00", "1145.00");
    f.add_principal = vec![Some(dec("1.00"))];
    let result = store.finish_statement_reconciliation(&f, test_now());
    assert!(matches!(result, Err(StatementFinishError::BadInput(_))), "{result:?}");
    assert_nothing_written(&store, 3);
}

#[test]
fn a_row_ticked_earlier_outside_the_statement_window_is_unticked_not_settled() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [_, coffee, _]) = checking(&store);
    store.save_transactions(acct, &[tx("2026-06-01", "Long ago", "-7.00")]).unwrap();
    let long_ago = id_of(&store, "Long ago", "2026-06-01");
    store.set_transactions_cleared(&[long_ago], true).unwrap();
    assert!(
        !store.statement_candidates(acct, &august()).unwrap().iter().any(|c| c.id == long_ago),
        "the review never shows it"
    );

    store
        .finish_statement_reconciliation(&finish_cash(acct, vec![coffee], vec![], "1200.00", "1150.00"), test_now())
        .unwrap();
    assert_eq!((is_ticked(&store, long_ago), settled_by(&store, long_ago)), (false, None));
}

#[test]
fn holdings_changes_need_share_counts_to_check_them_against() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let held = store
        .create_holding(brokerage, "ABCD", "Alpha", dec("49"), dec("300"), dec("10000"), None)
        .unwrap();
    let change = vec![HoldingChange::SetShares {
        holding_id: held,
        shares: dec("50"),
    }];
    for statement_shares in [None, shares(&[])] {
        let f = finish_investment(
            brokerage,
            vec![tx("2026-08-05", "Cash Dividend", "18.50")],
            change.clone(),
            statement_shares,
        );
        let result = store.finish_statement_reconciliation(&f, test_now());
        assert!(matches!(result, Err(StatementFinishError::HoldingsNotChecked)), "{result:?}");
        assert_nothing_written(&store, 0);
        assert_eq!(store.list_holdings(far_future()).unwrap()[0].shares, dec("49"));
    }
}

#[test]
fn holdings_changes_with_impossible_values_are_refused() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let held = store
        .create_holding(brokerage, "ABCD", "Alpha", dec("49"), dec("300"), dec("10000"), None)
        .unwrap();
    let add = |symbol: &str, shares: &str, price: &str, cost_basis: &str| HoldingChange::Add {
        symbol: symbol.into(),
        name: "Example".into(),
        shares: dec(shares),
        price: dec(price),
        cost_basis: dec(cost_basis),
    };
    let cases = [
        (
            "negative shares to set",
            HoldingChange::SetShares {
                holding_id: held,
                shares: dec("-1"),
            },
        ),
        ("negative shares to add", add("EFGH", "-1", "9.47", "10")),
        ("zero price", add("EFGH", "1", "0", "10")),
        ("negative price", add("EFGH", "1", "-9.47", "10")),
        ("zero cost basis", add("EFGH", "1", "9.47", "0")),
        ("negative cost basis", add("EFGH", "1", "9.47", "-10")),
        ("empty symbol", add("   ", "1", "9.47", "10")),
    ];
    for (why, change) in cases {
        let f = finish_investment(
            brokerage,
            vec![tx("2026-08-05", "Cash Dividend", "18.50")],
            vec![change],
            shares(&[("ABCD", "49")]),
        );
        match store.finish_statement_reconciliation(&f, test_now()) {
            Err(e @ StatementFinishError::InvalidHolding(_)) => assert_plain(&e.to_string()),
            other => panic!("{why}: expected InvalidHolding, got {other:?}"),
        }
        assert_nothing_written(&store, 0);
        let holdings = store.list_holdings(far_future()).unwrap();
        assert_eq!((holdings.len(), holdings[0].shares), (1, dec("49")), "{why}");
    }
}

#[test]
fn holdings_are_recorded_as_checked_only_when_there_were_share_counts_to_check() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    store
        .create_holding(brokerage, "ABCD", "Alpha", dec("49"), dec("300"), dec("10000"), None)
        .unwrap();
    let recorded = |statement_shares| {
        let done = store
            .finish_statement_reconciliation(&finish_investment(brokerage, vec![], vec![], statement_shares), test_now())
            .unwrap();
        holdings_checked(&store, done.reconciliation_id)
    };
    assert_eq!(recorded(shares(&[])), Some(0), "an empty list checks nothing");
    assert_eq!(recorded(None), Some(0));
    assert_eq!(recorded(shares(&[("ABCD", "49")])), Some(1));
}

#[test]
fn an_unknown_account_is_refused_as_not_this_account() {
    let store = Store::open_in_memory().unwrap();
    let result = store.finish_statement_reconciliation(&finish_cash(999_999, vec![], vec![], "0.00", "0.00"), test_now());
    assert!(matches!(result, Err(StatementFinishError::NotThisAccount)), "{result:?}");
    assert_nothing_written(&store, 0);
}

#[test]
fn setting_one_lot_of_a_symbol_held_in_two_lots_is_checked_on_the_sum() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let first_lot = store
        .create_holding(brokerage, "ABCD", "Alpha", dec("30"), dec("300"), dec("6000"), None)
        .unwrap();
    store
        .create_holding(brokerage, "ABCD", "Alpha", dec("19"), dec("300"), dec("4000"), None)
        .unwrap();
    let set_first_lot = |n: &str| {
        finish_investment(
            brokerage,
            vec![],
            vec![HoldingChange::SetShares {
                holding_id: first_lot,
                shares: dec(n),
            }],
            shares(&[("ABCD", "50")]),
        )
    };

    let result = store.finish_statement_reconciliation(&set_first_lot("50"), test_now());
    assert!(
        matches!(result, Err(StatementFinishError::SharesDiffer(ref s)) if s == "ABCD"),
        "50 + 19 is 69"
    );
    assert_nothing_written(&store, 0);

    store.finish_statement_reconciliation(&set_first_lot("31"), test_now()).unwrap();
    let total: Decimal = store.list_holdings(far_future()).unwrap().iter().map(|h| h.shares).sum();
    assert_eq!(total, dec("50"));
}

// Review round 3.

/// An investment statement for `start..=end` that adds `add`, without checking share counts.
fn investment_statement(acct: i64, start: &str, end: &str, add: Vec<Transaction>) -> StatementFinish {
    StatementFinish {
        period: Period::new(day(start), day(end)).unwrap(),
        ..finish_investment(acct, add, vec![], None)
    }
}

/// A brokerage account whose July statement was reconciled by hand from 100.00 to 105.00.
fn brokerage_reconciled_in_july(store: &Store) -> i64 {
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    store.save_transactions(brokerage, &[tx("2026-07-10", "Interest", "5.00")]).unwrap();
    store.set_transactions_cleared(&[id_of(store, "Interest", "2026-07-10")], true).unwrap();
    finish(store, brokerage, "2026-07-31", Some("100.00"), "105.00").expect("balances");
    brokerage
}

#[test]
fn a_newer_investment_statement_finished_before_an_older_balance_record_still_carries() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    // September's investment statement is finished first.
    store
        .finish_statement_reconciliation(
            &investment_statement(brokerage, "2026-09-01", "2026-09-30", vec![tx("2026-09-05", "Cash Dividend", "18.50")]),
            test_now(),
        )
        .unwrap();
    // Then July's statement is reconciled by hand (the account's first balance).
    store.save_transactions(brokerage, &[tx("2026-07-10", "Interest", "5.00")]).unwrap();
    store.set_transactions_cleared(&[id_of(&store, "Interest", "2026-07-10")], true).unwrap();
    finish(&store, brokerage, "2026-07-31", Some("100.00"), "105.00").expect("balances");

    let status = store.reconcile_status(brokerage, day("2026-10-31"), None, dec("123.50")).unwrap();
    assert!(!status.needs_starting_balance);
    assert_eq!(
        status.starting_point,
        Some(dec("123.50")),
        "September's dividend came after July's balance: 105.00 + 18.50"
    );
    assert_eq!(status.difference, Some(Decimal::ZERO));
}

#[test]
fn an_older_investment_statement_finished_after_a_newer_balance_record_is_not_carried() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    // September's statement is reconciled by hand first.
    store.save_transactions(brokerage, &[tx("2026-09-10", "Interest", "5.00")]).unwrap();
    store.set_transactions_cleared(&[id_of(&store, "Interest", "2026-09-10")], true).unwrap();
    finish(&store, brokerage, "2026-09-30", Some("100.00"), "105.00").expect("balances");
    // Then August's investment statement is finished.
    store
        .finish_statement_reconciliation(
            &investment_statement(brokerage, "2026-08-01", "2026-08-31", vec![tx("2026-08-05", "Cash Dividend", "18.50")]),
            test_now(),
        )
        .unwrap();

    let status = store.reconcile_status(brokerage, day("2026-10-31"), None, dec("105.00")).unwrap();
    assert_eq!(
        status.starting_point,
        Some(dec("105.00")),
        "September's balance already covers August: the dividend is not counted twice"
    );

    // An investment statement on the same date as the balance, finished after it, does carry.
    store
        .finish_statement_reconciliation(
            &investment_statement(brokerage, "2026-09-01", "2026-09-30", vec![tx("2026-09-20", "Fee", "-2.00")]),
            test_now(),
        )
        .unwrap();
    let status = store.reconcile_status(brokerage, day("2026-10-31"), None, dec("103.00")).unwrap();
    assert_eq!(status.starting_point, Some(dec("103.00")), "105.00 - 2.00");
}

#[test]
fn two_investment_statements_between_balance_records_both_carry_until_the_next_balance() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = brokerage_reconciled_in_july(&store);
    store
        .finish_statement_reconciliation(
            &investment_statement(brokerage, "2026-08-01", "2026-08-31", vec![tx("2026-08-05", "Cash Dividend", "18.50")]),
            test_now(),
        )
        .unwrap();
    store
        .finish_statement_reconciliation(
            &investment_statement(brokerage, "2026-09-01", "2026-09-30", vec![tx("2026-09-20", "Fee", "-2.00")]),
            test_now(),
        )
        .unwrap();

    let status = store.reconcile_status(brokerage, day("2026-10-31"), None, dec("121.50")).unwrap();
    assert_eq!(status.starting_point, Some(dec("121.50")), "105.00 + 18.50 - 2.00");

    store.save_transactions(brokerage, &[tx("2026-10-03", "Dividend", "10.00")]).unwrap();
    store.set_transactions_cleared(&[id_of(&store, "Dividend", "2026-10-03")], true).unwrap();
    finish(&store, brokerage, "2026-10-31", None, "131.50").expect("balances from 121.50");

    let status = store.reconcile_status(brokerage, day("2026-11-30"), None, dec("131.50")).unwrap();
    assert_eq!(status.starting_point, Some(dec("131.50")), "October's balance includes both statements");
}

#[test]
fn a_row_deleted_after_an_investment_statement_settled_it_still_carries() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = brokerage_reconciled_in_july(&store);
    store
        .finish_statement_reconciliation(
            &investment_statement(brokerage, "2026-08-01", "2026-08-31", vec![tx("2026-08-05", "Cash Dividend", "18.50")]),
            test_now(),
        )
        .unwrap();
    let dividend = id_of(&store, "Cash Dividend", "2026-08-05");
    store.delete_transaction(dividend, test_now()).unwrap();

    let status = store.reconcile_status(brokerage, day("2026-09-30"), None, dec("123.50")).unwrap();
    assert_eq!(
        status.starting_point,
        Some(dec("123.50")),
        "the statement settled it, so it stays in the balance, just as a balance record keeps it"
    );
    assert_eq!(status.ticked_count, 0);
}

#[test]
fn editing_a_row_an_investment_statement_settled_changes_the_next_starting_point() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = brokerage_reconciled_in_july(&store);
    store
        .finish_statement_reconciliation(
            &investment_statement(brokerage, "2026-08-01", "2026-08-31", vec![tx("2026-08-05", "Cash Dividend", "18.50")]),
            test_now(),
        )
        .unwrap();
    let dividend = id_of(&store, "Cash Dividend", "2026-08-05");
    store.update_transaction_amount(dividend, dec("20.00")).unwrap();

    let status = store.reconcile_status(brokerage, day("2026-09-30"), None, dec("125.00")).unwrap();
    assert_eq!(
        status.starting_point,
        Some(dec("125.00")),
        "the carried change is read from the row as it is now"
    );
}

#[test]
fn a_principal_part_on_a_loan_row_that_is_not_a_payment_is_refused_and_writes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let loan = mortgage(&store);
    let late_fee = || vec![tx("2026-08-01", "Late fee", "-50.00")];
    let refused = [
        ("a charge", mortgage_finish(loan, late_fee(), vec![Some(dec("10.00"))], "317245.46")),
        (
            "a charge with a zero principal part",
            mortgage_finish(loan, late_fee(), vec![Some(Decimal::ZERO)], "317245.46"),
        ),
        (
            "a zero amount",
            mortgage_finish(loan, vec![tx("2026-08-01", "Adjustment", "0.00")], vec![Some(Decimal::ZERO)], "317195.46"),
        ),
    ];
    for (why, f) in refused {
        let result = store.finish_statement_reconciliation(&f, test_now());
        match result {
            Err(e @ StatementFinishError::BadInput(_)) => {
                let message = e.to_string();
                assert_plain(&message);
                assert!(message.contains("payment"), "{why}: {message:?}");
            }
            other => panic!("{why}: expected BadInput, got {other:?}"),
        }
        assert_nothing_written(&store, 0);
    }

    // The same charge without a principal part is fine: it raises what is owed by its full amount.
    let f = mortgage_finish(loan, late_fee(), vec![None], "317245.46");
    store.finish_statement_reconciliation(&f, test_now()).unwrap();
}

// Task 19: the starting point is taken as of the statement being reconciled.

#[test]
fn reconciling_an_older_month_by_hand_after_a_newer_investment_statement_starts_before_it() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = brokerage_reconciled_in_july(&store);
    // September's investment statement is finished before August is reconciled by hand.
    store
        .finish_statement_reconciliation(
            &investment_statement(brokerage, "2026-09-01", "2026-09-30", vec![tx("2026-09-05", "Cash Dividend", "18.50")]),
            test_now(),
        )
        .unwrap();
    store.save_transactions(brokerage, &[tx("2026-08-10", "Interest", "10.00")]).unwrap();
    store.set_transactions_cleared(&[id_of(&store, "Interest", "2026-08-10")], true).unwrap();

    let august = store.reconcile_status(brokerage, day("2026-08-31"), None, dec("115.00")).unwrap();
    assert!(!august.needs_starting_balance);
    assert_eq!(
        august.starting_point,
        Some(dec("105.00")),
        "July's balance, without September's dividend, which came after August"
    );
    assert_eq!(august.difference, Some(Decimal::ZERO));
    finish(&store, brokerage, "2026-08-31", None, "115.00").expect("August balances from July's 105.00");

    // October continues from August's balance plus September's dividend.
    let october = store.reconcile_status(brokerage, day("2026-10-31"), None, dec("133.50")).unwrap();
    assert_eq!(october.starting_point, Some(dec("133.50")), "115.00 + 18.50");
    assert_eq!(october.difference, Some(Decimal::ZERO));
}

#[test]
fn reconciling_an_older_month_after_a_newer_balance_record_starts_from_the_balance_before_it() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = checking(&store);
    store.set_transactions_cleared(&[deposit], true).unwrap();
    finish(&store, acct, "2026-07-31", Some("1000.00"), "1200.00").expect("July balances");
    store.set_transactions_cleared(&[gas], true).unwrap();
    finish(&store, acct, "2026-09-30", None, "1170.00").expect("September balances from July");

    // August is reconciled last, by uploading its statement.
    let august = store.reconcile_status(acct, day("2026-08-31"), None, dec("1150.00")).unwrap();
    assert_eq!(august.starting_point, Some(dec("1200.00")), "July's balance, not September's");
    let done = store
        .finish_statement_reconciliation(&finish_cash(acct, vec![coffee], vec![], "1200.00", "1150.00"), test_now())
        .expect("August balances from July's 1200.00");
    let starting: Option<String> = store
        .conn
        .query_row(
            "SELECT starting_balance FROM reconciliations WHERE id = ?1",
            params![done.reconciliation_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(starting.as_deref(), Some("1200.00"));

    // Later months still pick up from the latest balance, September's.
    let october = store.reconcile_status(acct, day("2026-10-31"), None, dec("1170.00")).unwrap();
    assert_eq!(october.starting_point, Some(dec("1170.00")));
}

#[test]
fn a_month_before_every_balance_record_needs_its_own_starting_balance() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, _, _]) = checking(&store);
    finish(&store, acct, "2026-09-30", Some("1000.00"), "1000.00").expect("September balances");
    store.set_transactions_cleared(&[deposit], true).unwrap();

    let july = store.reconcile_status(acct, day("2026-07-31"), None, dec("1200.00")).unwrap();
    assert!(july.needs_starting_balance, "nothing was reconciled before July");
    assert_eq!(july.starting_point, None);
    let july = store
        .reconcile_status(acct, day("2026-07-31"), Some(dec("1000.00")), dec("1200.00"))
        .unwrap();
    assert_eq!(july.difference, Some(Decimal::ZERO));
}

#[test]
fn an_investment_statement_dated_the_same_day_as_the_statement_being_reconciled_counts_toward_it() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = brokerage_reconciled_in_july(&store);
    store
        .finish_statement_reconciliation(
            &investment_statement(brokerage, "2026-09-01", "2026-09-30", vec![tx("2026-09-05", "Cash Dividend", "18.50")]),
            test_now(),
        )
        .unwrap();
    let same_day = store.reconcile_status(brokerage, day("2026-09-30"), None, dec("123.50")).unwrap();
    assert_eq!(
        same_day.starting_point,
        Some(dec("123.50")),
        "dated on the statement's end date, so it is included"
    );
    let day_before = store.reconcile_status(brokerage, day("2026-09-29"), None, dec("105.00")).unwrap();
    assert_eq!(day_before.starting_point, Some(dec("105.00")), "dated after this statement, so it is not");
}

/// A mortgage whose 2,405.94 payment is already in the app, saved without its principal part.
fn mortgage_with_a_payment(store: &Store) -> (i64, i64) {
    let loan = mortgage(store);
    let ids = store.save_transactions_with_ids(loan, &[tx("2026-08-01", "Payment", "2405.94")]).unwrap();
    (loan, ids[0])
}

fn principal_of(store: &Store, id: i64) -> Option<String> {
    store
        .conn
        .query_row("SELECT principal_amount FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

#[test]
fn a_matched_loan_payment_takes_its_principal_part_from_the_statement() {
    let store = Store::open_in_memory().unwrap();
    let (loan, payment) = mortgage_with_a_payment(&store);
    let without = finish_cash(loan, vec![payment], vec![], "317195.46", "316840.29");
    assert!(matches!(
        store.finish_statement_reconciliation(&without, test_now()),
        Err(StatementFinishError::DoesNotBalance)
    ));
    let f = StatementFinish {
        matched_principal: vec![Some(dec("355.17"))],
        ..finish_cash(loan, vec![payment], vec![], "317195.46", "316840.29")
    };
    let done = store.finish_statement_reconciliation(&f, test_now()).unwrap();
    assert_eq!(principal_of(&store, payment).as_deref(), Some("355.17"));
    assert_eq!(settled_by(&store, payment), Some(done.reconciliation_id));
}

#[test]
fn a_matched_principal_part_that_does_not_fit_is_refused_and_changes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let (loan, payment) = mortgage_with_a_payment(&store);
    let fee = store.save_transactions_with_ids(loan, &[tx("2026-08-10", "Late fee", "-50.00")]).unwrap()[0];
    let with = |matched: Vec<i64>, principal: Vec<Option<Decimal>>| StatementFinish {
        matched_principal: principal,
        ..finish_cash(loan, matched, vec![], "317195.46", "316840.29")
    };
    let refused = [
        ("larger than the payment", with(vec![payment], vec![Some(dec("2405.95"))])),
        ("negative", with(vec![payment], vec![Some(dec("-1.00"))])),
        ("not one per match", with(vec![payment], vec![Some(dec("355.17")), None])),
        ("on a charge", with(vec![payment, fee], vec![Some(dec("355.17")), Some(dec("-50.00"))])),
    ];
    for (why, f) in refused {
        match store.finish_statement_reconciliation(&f, test_now()) {
            Err(e @ StatementFinishError::BadInput(_)) => assert_plain(&e.to_string()),
            other => panic!("{why}: expected BadInput, got {other:?}"),
        }
        assert_eq!(principal_of(&store, payment), None, "{why}");
        assert_eq!(count(&store, "SELECT COUNT(*) FROM reconciliations"), 0);
    }

    // A balance that doesn't come out rolls the principal part back too.
    let wrong_end = StatementFinish {
        matched_principal: vec![Some(dec("355.17"))],
        ..finish_cash(loan, vec![payment], vec![], "317195.46", "316000.00")
    };
    assert!(matches!(
        store.finish_statement_reconciliation(&wrong_end, test_now()),
        Err(StatementFinishError::DoesNotBalance)
    ));
    assert_eq!(principal_of(&store, payment), None);

    // Only a loan payment can have one.
    let (acct, [_, coffee, _]) = checking(&store);
    let f = StatementFinish {
        matched_principal: vec![Some(dec("1.00"))],
        ..finish_cash(acct, vec![coffee], vec![], "1200.00", "1150.00")
    };
    assert!(matches!(
        store.finish_statement_reconciliation(&f, test_now()),
        Err(StatementFinishError::BadInput(_))
    ));
}
