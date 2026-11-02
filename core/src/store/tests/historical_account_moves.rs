use super::transaction_account_move::dump;
use super::*;
use crate::store::{BalanceInput, MoveError, MoveFailpoint, MoveOutcome, MovePreview, MoveRequest};
use rust_decimal::Decimal;

// Historical account moves: the numeric fixtures N01-N14 of the acceptance matrix. Every expected figure is worked
// out by hand in the test (never by calling the planner or the balance reader being tested), and "nothing changed"
// is a dump of every table involved, including the checkpoint versions, the move audit and the revision counter.

pub(super) const T: &str = "2026-10-29";

pub(super) fn d(s: &str) -> Decimal {
    s.parse().unwrap()
}

pub(super) fn day(s: &str) -> NaiveDate {
    s.parse().unwrap()
}

pub(super) fn acct(store: &Store, name: &str, kind: AccountType, starting: &str) -> i64 {
    let id = store.get_or_create_account(name, kind).unwrap();
    store.set_account_starting_balance(id, d(starting)).unwrap();
    id
}

pub(super) fn add(store: &Store, account_id: i64, date: &str, description: &str, amount: &str) -> i64 {
    let fp = fingerprint(account_id, &tx(date, description, amount));
    store
        .conn
        .execute(
            "INSERT INTO transactions (account_id, date, description, amount, category, category_source, confidence, fingerprint)
             VALUES (?1, ?2, ?3, ?4, 'Groceries', 'user', 0.8, ?5)",
            params![account_id, date, description, amount, fp],
        )
        .unwrap();
    store.conn.last_insert_rowid()
}

/// The balance the app reads for the account on `as_of`.
pub(super) fn bal(store: &Store, account_id: i64, as_of: &str) -> Decimal {
    store
        .list_accounts(day(as_of))
        .unwrap()
        .into_iter()
        .find(|a| a.id == account_id)
        .unwrap()
        .current_balance
}

/// A saved balance written the way an old version of the app did: no record of what it counted.
pub(super) fn legacy_reset(store: &Store, account_id: i64, period: &str, cutoff: &str, balance: &str) {
    store
        .conn
        .execute(
            "INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?1, ?2, ?3, ?4)",
            params![account_id, period, cutoff, balance],
        )
        .unwrap();
}

/// (period, cutoff, effective, balance) of every saved balance of an account, oldest first.
pub(super) fn resets(store: &Store, account_id: i64) -> Vec<(String, String, String, Decimal)> {
    let mut stmt = store
        .conn
        .prepare("SELECT period, reset_date, COALESCE(effective_from, reset_date), balance FROM balance_resets WHERE account_id = ?1 ORDER BY id")
        .unwrap();
    stmt.query_map(params![account_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, String>(3)?)))
        .unwrap()
        .map(|r| {
            let (p, c, e, b) = r.unwrap();
            (p, c, e, d(&b))
        })
        .collect()
}

pub(super) fn versions_of(store: &Store, account_id: i64) -> Vec<Decimal> {
    let mut stmt = store
        .conn
        .prepare("SELECT balance FROM balance_reset_versions WHERE account_id = ?1 ORDER BY id")
        .unwrap();
    stmt.query_map(params![account_id], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|b| d(&b.unwrap()))
        .collect()
}

pub(super) fn set(account_id: i64, value: &str) -> BalanceInput {
    BalanceInput {
        account_id,
        keep: false,
        value: Some(value.to_string()),
    }
}

pub(super) fn preview_at(store: &Store, ids: &[i64], to: i64, inputs: &[BalanceInput], on: &str) -> MovePreview {
    store.preview_account_move_with(ids, to, day(on), inputs).unwrap()
}

/// Reviews and commits on `on`; panics unless the review lets the move go ahead.
pub(super) fn go(store: &Store, ids: &[i64], to: i64, inputs: &[BalanceInput], on: &str, operation: &str) -> MoveOutcome {
    let p = preview_at(store, ids, to, inputs, on);
    assert!(
        p.can_commit,
        "status {} blockers {:?} confirmations {:?}",
        p.status, p.blockers, p.confirmations
    );
    store
        .commit_account_move(&MoveRequest {
            ids,
            destination: to,
            expected_token: &p.token,
            today: day(on),
            operation_id: operation,
            balances: inputs,
        })
        .unwrap()
}

pub(super) fn account_of(store: &Store, id: i64) -> i64 {
    store
        .conn
        .query_row("SELECT account_id FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

pub(super) fn two_accounts(store: &Store) -> (i64, i64) {
    (
        acct(store, "A", AccountType::Checking, "1000.00"),
        acct(store, "B", AccountType::Checking, "500.00"),
    )
}

#[test]
fn n01_without_saved_balances_the_move_just_changes_the_two_balances() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("900.00"), d("500.00")));
    let p = preview_at(&store, &[r], b, &[], T);
    assert_eq!((p.status, p.mode), ("ready", "automatic"));
    assert!(matches!(go(&store, &[r], b, &[], T, "n01"), MoveOutcome::Moved(_)));
    assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("1000.00"), d("400.00")));
    assert_eq!(account_of(&store, r), b, "same transaction id, new account");
    assert!(
        resets(&store, a).is_empty() && resets(&store, b).is_empty(),
        "no saved balance is invented"
    );
}

#[test]
fn n02_recorded_checkpoints_are_corrected_and_the_old_values_stay_in_the_history() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    assert_eq!(
        (resets(&store, a)[0].3, resets(&store, b)[0].3),
        (d("900.00"), d("500.00")),
        "recorded at 28 Oct"
    );
    let p = preview_at(&store, &[r], b, &[], T);
    assert_eq!((p.status, p.mode, p.checkpoint_effects.corrected_count), ("ready", "automatic", 2));
    assert!(matches!(go(&store, &[r], b, &[], T, "n02"), MoveOutcome::Moved(_)));
    assert_eq!((resets(&store, a)[0].3, resets(&store, b)[0].3), (d("1000.00"), d("400.00")));
    assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("1000.00"), d("400.00")));
    assert_eq!(versions_of(&store, a), vec![d("900.00"), d("1000.00")], "the 900 version is kept");
    assert_eq!(versions_of(&store, b), vec![d("500.00"), d("400.00")]);
    let corrections: String = store
        .conn
        .query_row(
            "SELECT corrections_json FROM account_move_operations WHERE operation_id = 'n02'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        corrections.contains("\"oldBalance\":\"900.00\"") && corrections.contains("\"newBalance\":\"1000.00\""),
        "{corrections}"
    );
}

#[test]
fn n03_a_late_import_the_saved_balance_never_counted_leaves_the_source_alone() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    store.roll_forward_monthly_balances(day(T)).unwrap(); // A 1000, B 500 recorded, no rows yet
    let r = add(&store, a, "2026-10-20", "Late import", "-100.00");
    assert_eq!(
        bal(&store, a, T),
        d("1000.00"),
        "the saved balance was cut at 28 Oct and never counted this row"
    );
    let p = preview_at(&store, &[r], b, &[], T);
    assert_eq!((p.status, p.mode), ("ready", "automatic"));
    assert_eq!(
        (p.net_before.as_str(), p.net_after.as_str()),
        ("1500.00", "1400.00"),
        "aggregate cash falls by the 100 it is shown to"
    );
    assert!(
        p.checkpoint_effects.notes.iter().any(|n| n.contains("1500.00 to 1400.00")),
        "{:?}",
        p.checkpoint_effects.notes
    );
    go(&store, &[r], b, &[], T, "n03");
    assert_eq!(resets(&store, a)[0].3, d("1000.00"), "no artificial +100 on the source");
    assert_eq!(resets(&store, b)[0].3, d("400.00"));
    assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("1000.00"), d("400.00")));
}

fn opaque_pair() -> (Store, i64, i64, i64) {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    legacy_reset(&store, a, "2026-10", "2026-10-28", "900.00");
    legacy_reset(&store, b, "2026-10", "2026-10-28", "500.00");
    (store, a, b, r)
}

#[test]
fn n04_an_old_checkpoint_needs_confirmed_balances_and_old_values_stay() {
    let (store, a, b, r) = opaque_pair();
    let p = preview_at(&store, &[r], b, &[], T);
    assert_eq!((p.status, p.mode, p.can_commit), ("needs_balance_confirmation", "confirmation", false));
    assert_eq!(
        p.confirmations.iter().map(|c| c.current_display.as_str()).collect::<Vec<_>>(),
        vec!["900.00", "500.00"],
        "the shown balances are a reference only"
    );
    assert!(p.confirmations.iter().all(|c| c.confirmed_display.is_none()));
    go(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T, "n04");
    assert_eq!(account_of(&store, r), b);
    let ra = resets(&store, a);
    assert_eq!(
        (ra[0].1.as_str(), ra[0].3),
        ("2026-10-28", d("900.00")),
        "the old saved balance is untouched"
    );
    assert_eq!(
        (ra[1].1.as_str(), ra[1].2.as_str(), ra[1].3),
        ("2026-10-28", T, d("1000.00")),
        "cut 28 Oct, effective 29 Oct"
    );
    assert_eq!(resets(&store, b)[1].3, d("400.00"));
    assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("1000.00"), d("400.00")));
    assert_eq!(
        (bal(&store, a, "2026-10-28"), bal(&store, b, "2026-10-28")),
        (d("900.00"), d("500.00")),
        "28 Oct still reads the old saved balances"
    );
}

#[test]
fn n05_todays_activity_is_counted_once_in_the_confirmed_baseline() {
    let (store, a, b, r) = opaque_pair();
    add(&store, a, T, "Today A", "-30.00");
    add(&store, b, T, "Today B", "20.00");
    assert_eq!(
        (bal(&store, a, T), bal(&store, b, T)),
        (d("870.00"), d("520.00")),
        "900 - 30 and 500 + 20 before the move"
    );
    go(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T, "n05");
    assert_eq!(
        (resets(&store, a)[1].3, resets(&store, b)[1].3),
        (d("1030.00"), d("380.00")),
        "1000 + 30 and 400 - 20"
    );
    assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("1000.00"), d("400.00")));
    add(&store, a, T, "Later today A", "-10.00");
    add(&store, b, T, "Later today B", "5.00");
    assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("990.00"), d("405.00")));
    // The 30 October rollover captures today's figure once, and the next day starts from it.
    store.roll_forward_monthly_balances(day("2026-10-30")).unwrap();
    let rolled_a = resets(&store, a).into_iter().find(|x| x.0 == "2026-10-30" || x.0 == "2026-10").unwrap();
    let _ = rolled_a;
    assert_eq!((bal(&store, a, "2026-10-30"), bal(&store, b, "2026-10-30")), (d("990.00"), d("405.00")));
}

#[test]
fn n06_two_sources_and_one_target_are_corrected_together() {
    let store = Store::open_in_memory().unwrap();
    let a = acct(&store, "A", AccountType::Checking, "1000.00");
    let b = acct(&store, "B", AccountType::Checking, "500.00");
    let c = acct(&store, "C", AccountType::Checking, "200.00");
    let ra = add(&store, a, "2026-10-20", "From A", "-100.00");
    let rb = add(&store, b, "2026-10-21", "From B", "-50.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    assert_eq!(
        (resets(&store, a)[0].3, resets(&store, b)[0].3, resets(&store, c)[0].3),
        (d("900.00"), d("450.00"), d("200.00"))
    );
    go(&store, &[ra, rb], c, &[], T, "n06");
    assert_eq!(
        (bal(&store, a, T), bal(&store, b, T), bal(&store, c, T)),
        (d("1000.00"), d("500.00"), d("50.00"))
    );
    assert_eq!(bal(&store, a, T) + bal(&store, b, T) + bal(&store, c, T), d("1550.00"), "total unchanged");
}

#[test]
fn n06b_a_failure_on_the_last_row_leaves_every_account_and_saved_balance_as_it_was() {
    let store = Store::open_in_memory().unwrap();
    let a = acct(&store, "A", AccountType::Checking, "1000.00");
    let b = acct(&store, "B", AccountType::Checking, "500.00");
    let c = acct(&store, "C", AccountType::Checking, "200.00");
    let ra = add(&store, a, "2026-10-20", "From A", "-100.00");
    let rb = add(&store, b, "2026-10-21", "From B", "-50.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    let before = dump(&store);
    let p = preview_at(&store, &[ra, rb], c, &[], T);
    let ids = [ra, rb];
    let req = MoveRequest {
        ids: &ids,
        destination: c,
        expected_token: &p.token,
        today: day(T),
        operation_id: "n06b",
        balances: &[],
    };
    assert!(matches!(
        store.commit_account_move_with_failpoint(&req, MoveFailpoint::AfterUpdate(2)),
        Err(MoveError::Injected(_))
    ));
    assert_eq!(dump(&store), before);
}

#[test]
fn n07_loans_move_principal_and_the_confirmation_baseline_uses_the_ledger_sign() {
    // Automatic: opening owed 1000 less a 40 principal payment is 960 owed; the other loan owes 2000.
    let store = Store::open_in_memory().unwrap();
    let la = acct(&store, "Loan A", AccountType::Loan, "1000.00");
    let lb = acct(&store, "Loan B", AccountType::Loan, "2000.00");
    let pay = add(&store, la, "2026-10-20", "Payment", "40.00");
    assert_eq!(bal(&store, la, T), d("960.00"));
    store.roll_forward_monthly_balances(day(T)).unwrap();
    go(&store, &[pay], lb, &[], T, "n07a");
    assert_eq!((bal(&store, la, T), bal(&store, lb, T)), (d("1000.00"), d("1960.00")));
    // Confirmation: legacy checkpoints, plus a 10 principal payment dated today that stays in the first loan.
    let store = Store::open_in_memory().unwrap();
    let la = acct(&store, "Loan A", AccountType::Loan, "1000.00");
    let lb = acct(&store, "Loan B", AccountType::Loan, "2000.00");
    let pay = add(&store, la, "2026-10-20", "Payment", "40.00");
    legacy_reset(&store, la, "2026-10", "2026-10-28", "960.00");
    legacy_reset(&store, lb, "2026-10", "2026-10-28", "2000.00");
    add(&store, la, T, "Payment today", "10.00");
    go(&store, &[pay], lb, &[set(la, "1000.00"), set(lb, "1960.00")], T, "n07b");
    assert_eq!(
        resets(&store, la)[1].3,
        d("1010.00"),
        "raw baseline 1010 (1000 owed + 10 paid today), not 990"
    );
    assert_eq!((bal(&store, la, T), bal(&store, lb, T)), (d("1000.00"), d("1960.00")));
}

#[test]
fn n07c_a_loan_row_cannot_move_to_a_non_loan_with_a_principal_override() {
    let store = Store::open_in_memory().unwrap();
    let la = acct(&store, "Loan A", AccountType::Loan, "1000.00");
    let checking = acct(&store, "Checking", AccountType::Checking, "0.00");
    let pay = add(&store, la, "2026-10-20", "Payment", "40.00");
    store.update_transaction_principal_amount(pay, Some(d("30.00"))).unwrap();
    let p = preview_at(&store, &[pay], checking, &[], T);
    assert!(p.blockers.iter().any(|x| x.code == "principal_override"));
}

#[test]
fn n08_a_card_moves_in_owed_terms_and_the_limit_does_not_change() {
    let store = Store::open_in_memory().unwrap();
    let card = acct(&store, "Card", AccountType::Credit, "1000.00");
    let b = acct(&store, "B", AccountType::Checking, "500.00");
    let selected = add(&store, card, "2026-10-20", "Selected", "-100.00");
    add(&store, card, "2026-10-21", "Other", "-100.00");
    assert_eq!(bal(&store, card, T), d("800.00"), "available credit; owed is 200");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    go(&store, &[selected], b, &[], T, "n08a");
    assert_eq!(
        (bal(&store, card, T), bal(&store, b, T)),
        (d("900.00"), d("400.00")),
        "available 900, owed 100"
    );
    let limit: String = store
        .conn
        .query_row("SELECT starting_balance FROM accounts WHERE id = ?1", params![card], |r| r.get(0))
        .unwrap();
    assert_eq!(d(&limit), d("1000.00"));
    // Confirmation asks for the amount owed and converts it to available credit natively.
    let store = Store::open_in_memory().unwrap();
    let card = acct(&store, "Card", AccountType::Credit, "1000.00");
    let b = acct(&store, "B", AccountType::Checking, "500.00");
    let selected = add(&store, card, "2026-10-20", "Selected", "-100.00");
    add(&store, card, "2026-10-21", "Other", "-100.00");
    legacy_reset(&store, card, "2026-10", "2026-10-28", "800.00");
    legacy_reset(&store, b, "2026-10", "2026-10-28", "500.00");
    let p = preview_at(&store, &[selected], b, &[], T);
    let c = p.confirmations.iter().find(|c| c.account_id == card).unwrap();
    assert_eq!(
        (
            c.input_label,
            c.current_display.as_str(),
            c.credit_limit.as_deref(),
            c.available_credit.as_deref()
        ),
        ("Amount owed", "200.00", Some("1000.00"), Some("800.00"))
    );
    go(&store, &[selected], b, &[set(card, "100.00"), set(b, "400.00")], T, "n08b");
    assert_eq!(bal(&store, card, T), d("900.00"), "owed 100 saved as 900 available");
    assert_eq!(resets(&store, card)[1].3, d("900.00"));
}

#[test]
fn n09_future_automatic_descendants_get_the_correction_once() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    store.roll_forward_monthly_balances(day(T)).unwrap(); // 28 Oct: A 900, B 500
    add(&store, a, "2026-11-05", "A November", "-20.00");
    add(&store, b, "2026-11-05", "B November", "10.00");
    store.roll_forward_monthly_balances(day("2026-12-01")).unwrap(); // 30 Nov: A 880, B 510
    assert_eq!((resets(&store, a)[1].3, resets(&store, b)[1].3), (d("880.00"), d("510.00")));
    go(&store, &[r], b, &[], T, "n09");
    assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("1000.00"), d("400.00")));
    assert_eq!(
        (resets(&store, a)[1].3, resets(&store, b)[1].3),
        (d("980.00"), d("410.00")),
        "1000 - 20 and 400 + 10, the correction once"
    );
    assert_eq!((resets(&store, a)[0].3, resets(&store, b)[0].3), (d("1000.00"), d("400.00")));
}

#[test]
fn n10_a_later_recorded_balance_does_not_make_an_old_typed_one_known() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    store.set_account_balance_override(a, d("900.00"), day("2026-10-25")).unwrap(); // typed, after the purchase date
    store.roll_forward_monthly_balances(day(T)).unwrap(); // a recorded balance built on top of it
    let p = preview_at(&store, &[r], b, &[], T);
    assert_eq!(p.status, "needs_balance_confirmation");
    let reasons = &p.confirmations.iter().find(|c| c.account_id == a).unwrap().reasons;
    assert!(reasons.iter().any(|x| x.contains("balance you set yourself")), "{reasons:?}");
    go(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T, "n10");
    assert_eq!(resets(&store, a)[0].3, d("900.00"), "the typed value stays 900");
    assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("1000.00"), d("400.00")));
}

#[test]
fn n11_an_old_unknown_baseline_does_not_block_a_row_after_it() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    legacy_reset(&store, a, "2026-09", "2026-10-15", "700.00");
    legacy_reset(&store, b, "2026-09", "2026-10-15", "500.00");
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    assert_eq!((resets(&store, a)[1].3, resets(&store, b)[1].3), (d("600.00"), d("500.00")));
    let p = preview_at(&store, &[r], b, &[], T);
    assert_eq!((p.status, p.mode), ("ready", "automatic"), "{:?}", p.confirmations);
    go(&store, &[r], b, &[], T, "n11");
    assert_eq!(
        (resets(&store, a)[0].3, resets(&store, a)[1].3),
        (d("700.00"), d("700.00")),
        "old baseline unchanged, 28 Oct corrected"
    );
    assert_eq!((resets(&store, b)[0].3, resets(&store, b)[1].3), (d("500.00"), d("400.00")));
}

#[test]
fn n12_a_confirmed_balance_outranks_a_monthly_one_with_the_same_cutoff_until_the_next_rollover() {
    let (store, a, b, r) = opaque_pair();
    go(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T, "n12");
    // A monthly balance created afterwards, with the same 28 Oct cutoff and effective 28 Oct, from old history.
    legacy_reset(&store, a, "2026-10b", "2026-10-28", "900.00");
    assert_eq!(bal(&store, a, T), d("1000.00"), "the confirmation (effective 29 Oct) still governs today");
    // The next day's rollover counts today's activity once and may take over.
    store.roll_forward_monthly_balances(day("2026-10-30")).unwrap();
    assert_eq!(bal(&store, a, "2026-10-30"), d("1000.00"));
    assert_eq!(bal(&store, b, "2026-10-30"), d("400.00"));
}

#[test]
fn n13_an_automatic_move_and_its_reverse_restore_the_original_balances() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = two_accounts(&store);
    let r = add(&store, a, "2026-10-20", "Purchase", "-100.00");
    store.roll_forward_monthly_balances(day(T)).unwrap();
    go(&store, &[r], b, &[], T, "n13-forth");
    go(&store, &[r], a, &[], T, "n13-back");
    assert_eq!((bal(&store, a, T), bal(&store, b, T)), (d("900.00"), d("500.00")));
    assert_eq!((resets(&store, a)[0].3, resets(&store, b)[0].3), (d("900.00"), d("500.00")));
    assert_eq!(
        versions_of(&store, a),
        vec![d("900.00"), d("1000.00"), d("900.00")],
        "both moves are in the history"
    );
    let members: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM balance_version_contributions WHERE transaction_id = ?1 AND version_id IN (SELECT current_version_id FROM balance_resets)", params![r], |x| x.get(0))
        .unwrap();
    assert_eq!(members, 1, "the row is counted by exactly one current saved balance");
    let ops: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM account_move_operations", [], |x| x.get(0))
        .unwrap();
    assert_eq!(ops, 2);
}

#[test]
fn n14_future_dated_activity_is_not_netted_out_of_the_confirmed_baseline() {
    let (store, a, b, r) = opaque_pair();
    add(&store, a, "2026-10-30", "Tomorrow", "-25.00");
    go(&store, &[r], b, &[set(a, "1000.00"), set(b, "400.00")], T, "n14");
    assert_eq!(resets(&store, a)[1].3, d("1000.00"), "a row dated tomorrow is not today's activity");
    assert_eq!(bal(&store, a, T), d("1000.00"));
    assert_eq!(bal(&store, a, "2026-10-30"), d("975.00"), "tomorrow: the confirmed amount less 25");
}
