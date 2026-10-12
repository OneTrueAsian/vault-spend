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

    let without = store.reconcile_status(acct, None, dec("1150.00")).unwrap();
    assert!(without.needs_starting_balance);
    assert_eq!(without.difference, None, "no starting point yet, so no difference");

    let with = store.reconcile_status(acct, Some(dec("1000.00")), dec("1150.00")).unwrap();
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
    let status = store.reconcile_status(acct, Some(dec("9999.00")), dec("1120.00")).unwrap();
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
    let status = store.reconcile_status(acct, None, dec("1150.00")).unwrap();
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

    let status = store.reconcile_status(card, Some(dec("300.00")), dec("80.00")).unwrap();
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

    let status = store.reconcile_status(loan, Some(dec("317195.46")), dec("316840.29")).unwrap();
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
    let status = store.reconcile_status(acct, Some(dec("1000.00")), dec("950.00")).unwrap();
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
    assert!(store.reconcile_status(acct, Some(dec("1000.00")), dec("1000.00")).is_err());
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
