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
        holdings: vec![],
        statement_shares: None,
        layout: None,
    }
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
        statement_shares: None,
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
    ];
    assert!(messages[0].contains("$0.00"));
    assert!(messages[1].contains("ABCD"));
    for m in &messages {
        let lower = m.to_lowercase();
        for jargon in ["layout", "parse", "cleared", "unmatched", "tracked", "published", "sql", "query", "rows"] {
            assert!(!lower.contains(jargon), "{m:?} uses {jargon:?}");
        }
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
