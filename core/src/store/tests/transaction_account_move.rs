use super::*;
use crate::store::{MoveError, MoveFailpoint, MoveOutcome, MovePreview};
use rusqlite::types::Value;

// Moving transactions to another account. Expected balances are worked out by hand in each test (never by
// calling the production preview), and "nothing changed" is checked against a dump of every table.

fn today() -> NaiveDate {
    "2026-10-29".parse().unwrap()
}

fn dec(s: &str) -> rust_decimal::Decimal {
    s.parse().unwrap()
}

fn account(store: &Store, name: &str, kind: AccountType, starting: &str) -> i64 {
    let id = store.get_or_create_account(name, kind).unwrap();
    store.set_account_starting_balance(id, dec(starting)).unwrap();
    id
}

/// A live row with the importer's own fingerprint. Raw so a test can also make the duplicates an import keeps.
fn row(store: &Store, account_id: i64, date: &str, description: &str, amount: &str) -> i64 {
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

fn balance(store: &Store, account_id: i64) -> rust_decimal::Decimal {
    store
        .list_accounts(today())
        .unwrap()
        .into_iter()
        .find(|a| a.id == account_id)
        .unwrap()
        .current_balance
}

/// Every table that a move might touch, as comparable text.
pub(super) fn dump(store: &Store) -> String {
    let mut out = String::new();
    for table in [
        "accounts",
        "transactions",
        "balance_resets",
        "reconciliations",
        "transaction_splits",
        "transaction_tags",
        "transfer_links",
        "transfer_link_rejections",
        "transfer_candidate_dismissals",
        "anomaly_dismissals",
        "debt_payments",
        "holdings",
        "recurring",
        "investment_plans",
        "buckets",
        "balance_reset_versions",
        "balance_version_contributions",
        "account_move_operations",
        "financial_revision_counter",
        "transaction_tombstones",
    ] {
        let mut stmt = store.conn.prepare(&format!("SELECT * FROM {table} ORDER BY 1, 2")).unwrap();
        let columns = stmt.column_count();
        let mut rows = stmt.query([]).unwrap();
        out.push_str(table);
        out.push('\n');
        while let Some(r) = rows.next().unwrap() {
            let values: Vec<Value> = (0..columns).map(|i| r.get(i).unwrap()).collect();
            out.push_str(&format!("{values:?}\n"));
        }
    }
    out
}

fn preview(store: &Store, ids: &[i64], to: i64) -> MovePreview {
    store.preview_account_move(ids, to, today()).unwrap()
}

fn commit(store: &Store, ids: &[i64], to: i64) -> MoveOutcome {
    let p = preview(store, ids, to);
    store.move_transactions_to_account(ids, to, &p.token, today()).unwrap()
}

fn account_of(store: &Store, id: i64) -> i64 {
    store
        .conn
        .query_row("SELECT account_id FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

fn codes(p: &MovePreview) -> Vec<&'static str> {
    p.blockers.iter().map(|b| b.code).collect()
}

fn pair(store: &Store) -> (i64, i64) {
    (
        account(store, "Checking", AccountType::Checking, "1000.00"),
        account(store, "Savings", AccountType::Savings, "500.00"),
    )
}

// ---- ordinary moves and exact balances -----------------------------------------------------------------

#[test]
fn moves_one_debit_with_every_detail_intact_and_exact_balances() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let id = row(&store, checking, "2026-10-05", "Corner Cafe", "-40.25");
    store.update_transaction_notes(id, Some("birthday lunch")).unwrap();
    store.add_tag(id, "treat").unwrap();
    store
        .set_transaction_splits(
            id,
            &[
                ("Dining".to_string(), dec("-30.00"), None),
                ("Tips".to_string(), dec("-10.25"), Some("tip".to_string())),
            ],
        )
        .unwrap();
    let member = store.create_family_member("Ann").unwrap();
    store.set_transaction_member(id, Some(member)).unwrap();
    assert_eq!(balance(&store, checking), dec("959.75"));
    assert_eq!(balance(&store, savings), dec("500.00"));
    let before: (String, String, String, Option<f64>, Option<String>, Option<i64>, String) = store
        .conn
        .query_row(
            "SELECT date, description, amount, confidence, notes, member_id, category FROM transactions WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .unwrap();
    let splits_before: Vec<(i64, String)> = store
        .conn
        .prepare("SELECT id, amount FROM transaction_splits WHERE transaction_id = ?1 ORDER BY id")
        .unwrap()
        .query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    let p = preview(&store, &[id], savings);
    assert!(p.can_commit);
    assert_eq!((p.selected_count, p.effective_count, p.already_there_count), (1, 1, 0));
    let checking_effect = p.effects.iter().find(|e| e.account_id == checking).unwrap();
    let savings_effect = p.effects.iter().find(|e| e.account_id == savings).unwrap();
    assert_eq!(
        (checking_effect.current.as_str(), checking_effect.projected.as_str()),
        ("959.75", "1000.00")
    );
    assert_eq!((savings_effect.current.as_str(), savings_effect.projected.as_str()), ("500.00", "459.75"));
    assert_eq!(p.total, "-40.25");

    match store.move_transactions_to_account(&[id], savings, &p.token, today()).unwrap() {
        MoveOutcome::Moved(s) => assert_eq!((s.moved_ids, s.affected_account_ids), (vec![id], vec![checking, savings])),
        other => panic!("expected a move, got {other:?}"),
    }
    assert_eq!(account_of(&store, id), savings);
    assert_eq!(balance(&store, checking), dec("1000.00"));
    assert_eq!(balance(&store, savings), dec("459.75"));
    let after: (String, String, String, Option<f64>, Option<String>, Option<i64>, String) = store
        .conn
        .query_row(
            "SELECT date, description, amount, confidence, notes, member_id, category FROM transactions WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .unwrap();
    assert_eq!(before, after);
    let splits_after: Vec<(i64, String)> = store
        .conn
        .prepare("SELECT id, amount FROM transaction_splits WHERE transaction_id = ?1 ORDER BY id")
        .unwrap()
        .query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(splits_before, splits_after);
    let tags: Vec<String> = store
        .conn
        .prepare("SELECT tag FROM transaction_tags WHERE transaction_id = ?1")
        .unwrap()
        .query_map(params![id], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(tags, vec!["treat".to_string()]);
    let fp: String = store
        .conn
        .query_row("SELECT fingerprint FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap();
    assert_eq!(fp, fingerprint(savings, &tx("2026-10-05", "Corner Cafe", "-40.25")));
}

#[test]
fn several_signed_zero_and_future_rows_from_two_sources_move_with_the_right_dated_effects() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let card = account(&store, "Card", AccountType::Credit, "2000.00");
    let a = row(&store, checking, "2026-10-02", "Paycheck", "300.00");
    let b = row(&store, checking, "2026-10-03", "Fee", "0.00");
    let c = row(&store, card, "2026-10-04", "Shop", "-125.50");
    let future = row(&store, card, "2026-11-15", "Next month", "-60.00");
    // checking 1000+300+0 = 1300; card (credit, limit 2000) available 2000-125.50-60? the future row is not counted today.
    assert_eq!(balance(&store, checking), dec("1300.00"));
    assert_eq!(balance(&store, card), dec("1874.50"));
    assert_eq!(balance(&store, savings), dec("500.00"));

    let p = preview(&store, &[a, b, c, future], savings);
    assert!(p.can_commit, "{:?}", p.blockers);
    assert_eq!(p.effective_count, 4);
    assert_eq!(p.total, "114.50");
    assert_eq!(
        (p.first_date.as_deref(), p.last_date.as_deref()),
        (Some("2026-10-02"), Some("2026-11-15"))
    );
    let destination = p.effects.iter().find(|e| e.account_id == savings).unwrap();
    // savings gains today's rows only: +300.00 + 0.00 - 125.50 = 174.50
    assert_eq!((destination.current.as_str(), destination.projected.as_str()), ("500.00", "674.50"));
    let source_card = p.effects.iter().find(|e| e.account_id == card).unwrap();
    // a card shows what is owed: it owed 125.50 and now owes 0
    assert_eq!((source_card.current.as_str(), source_card.projected.as_str()), ("125.50", "0.00"));
    assert!(p.warnings.iter().any(|w| w.code == "future_dated"));
    assert!(matches!(commit(&store, &[a, b, c, future], savings), MoveOutcome::Moved(_)));
    assert_eq!(balance(&store, checking), dec("1000.00"));
    assert_eq!(balance(&store, card), dec("2000.00"));
    assert_eq!(balance(&store, savings), dec("674.50"));
    // the future row counts in savings from its own date
    let later: NaiveDate = "2026-11-30".parse().unwrap();
    let savings_later = store
        .list_accounts(later)
        .unwrap()
        .into_iter()
        .find(|a| a.id == savings)
        .unwrap()
        .current_balance;
    assert_eq!(savings_later, dec("614.50"));
}

#[test]
fn rows_already_in_the_destination_are_counted_apart_and_left_exactly_as_they_were() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let moving = row(&store, checking, "2026-10-05", "Moving", "-10.00");
    let there = row(&store, savings, "2026-10-06", "Already", "-20.00");
    store.set_transactions_cleared(&[there], true).unwrap();
    let fp_before: String = store
        .conn
        .query_row("SELECT fingerprint FROM transactions WHERE id = ?1", params![there], |r| r.get(0))
        .unwrap();
    let p = preview(&store, &[moving, there], savings);
    assert_eq!((p.selected_count, p.effective_count, p.already_there_count), (2, 1, 1));
    assert!(
        matches!(commit(&store, &[moving, there], savings), MoveOutcome::Moved(ref s) if s.moved_ids == vec![moving] && s.already_there_ids == vec![there])
    );
    let (cleared, fp): (bool, String) = store
        .conn
        .query_row("SELECT cleared, fingerprint FROM transactions WHERE id = ?1", params![there], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert!(cleared, "a row already there keeps its tick");
    assert_eq!(fp, fp_before);
}

#[test]
fn a_selection_that_is_entirely_in_the_destination_writes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let (_, savings) = pair(&store);
    let there = row(&store, savings, "2026-10-06", "Already", "-20.00");
    store.set_transactions_cleared(&[there], true).unwrap();
    let p = preview(&store, &[there], savings);
    assert!(!p.can_commit);
    assert_eq!(p.effective_count, 0);
    let revision = store.read_revision().unwrap();
    let before = dump(&store);
    assert!(matches!(
        store.move_transactions_to_account(&[there], savings, &p.token, today()).unwrap(),
        MoveOutcome::NothingToMove(_)
    ));
    assert_eq!(dump(&store), before);
    assert_eq!(store.read_revision().unwrap(), revision, "not even a write was attempted");
}

#[test]
fn preview_never_writes() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let id = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    let revision = store.read_revision().unwrap();
    let before = dump(&store);
    for _ in 0..3 {
        preview(&store, &[id], savings);
    }
    assert_eq!(dump(&store), before);
    assert_eq!(store.read_revision().unwrap(), revision);
}

#[test]
fn different_account_kinds_keep_signs_and_report_in_each_accounts_own_terms() {
    let store = Store::open_in_memory().unwrap();
    let checking = account(&store, "Checking", AccountType::Checking, "1000.00");
    let loan = account(&store, "Car loan", AccountType::Loan, "5000.00");
    // A payment recorded in checking: -200. In a loan a payment reduces what is owed, so +200 there would.
    let id = row(&store, checking, "2026-10-05", "Loan payment", "-200.00");
    assert_eq!(balance(&store, checking), dec("800.00"));
    assert_eq!(balance(&store, loan), dec("5000.00"));
    let p = preview(&store, &[id], loan);
    assert!(p.warnings.iter().any(|w| w.code == "account_kind_differs"));
    let loan_effect = p.effects.iter().find(|e| e.account_id == loan).unwrap();
    // the loan's owed amount = 5000 - (-200) = 5200: the sign stays, the account's own rule applies
    assert_eq!(
        (loan_effect.label, loan_effect.current.as_str(), loan_effect.projected.as_str()),
        ("Owed", "5000.00", "5200.00")
    );
    assert!(matches!(commit(&store, &[id], loan), MoveOutcome::Moved(_)));
    assert_eq!(balance(&store, loan), dec("5200.00"));
    assert_eq!(balance(&store, checking), dec("1000.00"));
    let amount: String = store
        .conn
        .query_row("SELECT amount FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap();
    assert_eq!(amount, "-200.00");
}

#[test]
fn an_investment_account_with_holdings_shows_its_holdings_and_keeps_that_value() {
    let store = Store::open_in_memory().unwrap();
    let checking = account(&store, "Checking", AccountType::Checking, "1000.00");
    let brokerage = account(&store, "Brokerage", AccountType::Investment, "0.00");
    store
        .create_holding(brokerage, "VTI", "Total market", dec("10"), dec("250.00"), dec("2000.00"), None)
        .unwrap();
    let id = row(&store, checking, "2026-10-05", "Deposit to brokerage", "-300.00");
    let p = preview(&store, &[id], brokerage);
    let effect = p.effects.iter().find(|e| e.account_id == brokerage).unwrap();
    assert!(effect.holdings_override);
    assert_eq!(
        (effect.label, effect.current.as_str(), effect.projected.as_str()),
        ("Holdings value", "2500.00", "2500.00")
    );
    assert!(p.warnings.iter().any(|w| w.code == "holdings_value"));
    let warning = p.warnings.iter().find(|w| w.code == "holdings_value").unwrap();
    assert!(warning.detail.starts_with("Brokerage shows its holdings value"), "{}", warning.detail);
    assert!(matches!(commit(&store, &[id], brokerage), MoveOutcome::Moved(_)));
    assert_eq!(balance(&store, brokerage), dec("2500.00"));
    assert_eq!(balance(&store, checking), dec("1000.00"));
    // its cash side did take the row
    let cash = store.account_balance_as_of(brokerage, "investment", dec("0.00"), today()).unwrap();
    assert_eq!(cash, dec("-300.00"));
}

#[test]
fn a_loan_principal_override_moves_between_loans_exactly_once() {
    let store = Store::open_in_memory().unwrap();
    let a = account(&store, "Mortgage A", AccountType::Loan, "100000.00");
    let b = account(&store, "Mortgage B", AccountType::Loan, "50000.00");
    let id = row(&store, a, "2026-10-05", "Payment", "1500.00");
    store.update_transaction_principal_amount(id, Some(dec("900.00"))).unwrap();
    assert_eq!(balance(&store, a), dec("99100.00"));
    let p = preview(&store, &[id], b);
    assert!(p.can_commit, "{:?}", p.blockers);
    assert!(matches!(commit(&store, &[id], b), MoveOutcome::Moved(_)));
    assert_eq!(balance(&store, a), dec("100000.00"));
    assert_eq!(balance(&store, b), dec("49100.00"));
    let principal: Option<String> = store
        .conn
        .query_row("SELECT principal_amount FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap();
    assert_eq!(principal.as_deref(), Some("900.00"));
}

#[test]
fn a_principal_override_that_leaves_the_loans_blocks_the_whole_batch() {
    let store = Store::open_in_memory().unwrap();
    let (checking, _) = pair(&store);
    let loan = account(&store, "Mortgage", AccountType::Loan, "100000.00");
    let plain = row(&store, loan, "2026-10-04", "Interest", "10.00");
    let id = row(&store, loan, "2026-10-05", "Payment", "1500.00");
    store.update_transaction_principal_amount(id, Some(dec("900.00"))).unwrap();
    let before = dump(&store);
    let p = preview(&store, &[plain, id], checking);
    assert_eq!(codes(&p), vec!["principal_override"]);
    assert!(!p.can_commit);
    assert!(matches!(
        store.move_transactions_to_account(&[plain, id], checking, &p.token, today()).unwrap(),
        MoveOutcome::Blocked(_)
    ));
    assert_eq!(dump(&store), before);
}

#[test]
fn recorded_investment_values_are_not_touched_by_a_move() {
    let store = Store::open_in_memory().unwrap();
    let checking = account(&store, "Checking", AccountType::Checking, "1000.00");
    let ira = account(&store, "IRA", AccountType::Investment, "0.00");
    let id = row(&store, checking, "2026-10-05", "Deposit", "-300.00");
    for (date, value) in [("2026-10-28", "50.00"), ("2026-10-29", "0.00")] {
        store
            .conn
            .execute(
                "INSERT INTO account_value_snapshots (account_id, date, value) VALUES (?1, ?2, ?3)",
                params![ira, date, value],
            )
            .unwrap();
    }
    let snapshots = |store: &Store| -> Vec<(String, String)> {
        let mut q = store
            .conn
            .prepare("SELECT date, value FROM account_value_snapshots ORDER BY date")
            .unwrap();
        q.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect()
    };
    let before = snapshots(&store);
    commit(&store, &[id], ira);
    assert_eq!(balance(&store, ira), dec("-300.00"));
    assert_eq!(snapshots(&store), before, "a move leaves the saved daily values exactly as they were");
}

// ---- destinations, ids ---------------------------------------------------------------------------------

#[test]
fn a_missing_or_hidden_destination_is_refused_and_a_hidden_source_may_move_out() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let id = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    assert!(matches!(
        store.preview_account_move(&[id], 9999, today()),
        Err(MoveError::InvalidDestination(_))
    ));
    store.set_account_hidden(savings, true).unwrap();
    assert!(matches!(
        store.preview_account_move(&[id], savings, today()),
        Err(MoveError::InvalidDestination(_))
    ));
    store.set_account_hidden(savings, false).unwrap();
    store.set_account_hidden(checking, true).unwrap();
    assert!(matches!(commit(&store, &[id], savings), MoveOutcome::Moved(_)));
}

#[test]
fn a_destination_hidden_after_the_preview_is_refused_at_commit_with_nothing_written() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let id = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    let p = preview(&store, &[id], savings);
    store.set_account_hidden(savings, true).unwrap();
    let before = dump(&store);
    assert!(matches!(
        store.move_transactions_to_account(&[id], savings, &p.token, today()),
        Err(MoveError::InvalidDestination(_))
    ));
    assert_eq!(dump(&store), before);
    assert_eq!(account_of(&store, id), checking);
}

#[test]
fn an_unknown_or_deleted_id_rejects_the_whole_request() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let good = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    let gone = row(&store, checking, "2026-10-06", "Gone", "-5.00");
    store.delete_transaction(gone, test_now()).unwrap();
    let before = dump(&store);
    for bad in [gone, 424242] {
        match store.preview_account_move(&[good, bad], savings, today()) {
            Err(MoveError::UnknownTransactions { ids }) => assert_eq!(ids, vec![bad]),
            other => panic!("expected unknown ids, got {other:?}"),
        }
        assert!(matches!(
            store.move_transactions_to_account(&[good, bad], savings, "token", today()),
            Err(MoveError::UnknownTransactions { .. })
        ));
    }
    assert_eq!(dump(&store), before);
}

#[test]
fn ids_are_validated_and_normalized_before_anything_is_read() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let id = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    assert!(matches!(store.preview_account_move(&[], savings, today()), Err(MoveError::NoSelection)));
    for bad in [0, -3, 9_007_199_254_740_992] {
        assert!(
            matches!(store.preview_account_move(&[id, bad], savings, today()), Err(MoveError::InvalidId)),
            "{bad}"
        );
    }
    let too_many: Vec<i64> = (1..=10_001).collect();
    assert!(matches!(
        store.preview_account_move(&too_many, savings, today()),
        Err(MoveError::TooMany { count: 10_001 })
    ));
    let p = preview(&store, &[id, id, id], savings);
    assert_eq!((p.selected_count, p.normalized_ids.clone()), (1, vec![id]));
    // ten thousand ids is the largest accepted selection (over the shared limit they are only counted as unknown here)
    let at_limit: Vec<i64> = (1..=10_000).collect();
    assert!(matches!(
        store.preview_account_move(&at_limit, savings, today()),
        Err(MoveError::UnknownTransactions { .. })
    ));
}

// ---- links, payments, reconciliation ------------------------------------------------------------------

#[test]
fn a_linked_transfer_blocks_the_batch_from_either_side_and_changes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let other = account(&store, "Other", AccountType::Checking, "0.00");
    let out = row(&store, checking, "2026-10-05", "To savings", "-100.00");
    let inn = row(&store, savings, "2026-10-05", "From checking", "100.00");
    assert!(store.link_transfer(out, inn).unwrap());
    let plain = row(&store, checking, "2026-10-06", "Plain", "-3.00");
    let before = dump(&store);
    for ids in [vec![out, plain], vec![inn, plain], vec![out, inn, plain]] {
        let p = preview(&store, &ids, other);
        assert!(codes(&p).contains(&"linked_transfer"), "{ids:?}");
        assert!(!p.can_commit);
        assert!(matches!(
            store.move_transactions_to_account(&ids, other, &p.token, today()).unwrap(),
            MoveOutcome::Blocked(_)
        ));
    }
    assert_eq!(dump(&store), before);
}

#[test]
fn an_applied_debt_payment_blocks_its_source_and_the_row_it_generated() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let loan = account(&store, "Loan", AccountType::Loan, "1000.00");
    let source = row(&store, checking, "2026-10-05", "Loan payment", "-100.00");
    store
        .apply_debt_payment(source, loan, dec("100.00"), "2026-10-05".parse().unwrap())
        .unwrap();
    let generated: i64 = store
        .conn
        .query_row("SELECT generated_transaction_id FROM debt_payments", [], |r| r.get(0))
        .unwrap();
    let before = dump(&store);
    for id in [source, generated] {
        let p = preview(&store, &[id], savings);
        assert!(codes(&p).contains(&"applied_debt_payment"), "{id}");
        assert!(!p.can_commit);
    }
    assert_eq!(dump(&store), before);
}

#[test]
fn a_category_called_transfer_without_a_link_is_an_ordinary_row() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let id = row(&store, checking, "2026-10-05", "Moved money", "-100.00");
    store
        .conn
        .execute("UPDATE transactions SET category = 'Transfer' WHERE id = ?1", params![id])
        .unwrap();
    assert!(preview(&store, &[id], savings).can_commit);
}

#[test]
fn a_settled_row_blocks_whether_or_not_it_is_ticked() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    store.conn.execute("INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES (?1, '2026-09-30', '900.00', '2026-10-01 10:00:00')", params![checking]).unwrap();
    let reconciliation = store.conn.last_insert_rowid();
    for cleared in [0, 1] {
        let id = row(&store, checking, "2026-09-20", &format!("Settled {cleared}"), "-10.00");
        store
            .conn
            .execute(
                "UPDATE transactions SET reconciliation_id = ?1, cleared = ?2 WHERE id = ?3",
                params![reconciliation, cleared, id],
            )
            .unwrap();
        let before = dump(&store);
        let p = preview(&store, &[id], savings);
        assert_eq!(codes(&p), vec!["settled"], "cleared={cleared}");
        assert!(!p.can_commit);
        assert!(matches!(
            store.move_transactions_to_account(&[id], savings, &p.token, today()).unwrap(),
            MoveOutcome::Blocked(_)
        ));
        assert_eq!(dump(&store), before, "the reconciliation and its rows are untouched");
    }
}

#[test]
fn an_unsettled_ticked_row_warns_and_loses_its_tick_but_a_row_already_there_keeps_it() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let ticked = row(&store, checking, "2026-10-05", "Ticked", "-10.00");
    let there = row(&store, savings, "2026-10-05", "There", "-11.00");
    store.set_transactions_cleared(&[ticked, there], true).unwrap();
    let p = preview(&store, &[ticked, there], savings);
    assert_eq!(p.warnings.iter().find(|w| w.code == "ticks_cleared").map(|w| w.count), Some(1));
    assert!(matches!(commit(&store, &[ticked, there], savings), MoveOutcome::Moved(_)));
    let cleared = |id: i64| -> bool {
        store
            .conn
            .query_row("SELECT cleared FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
            .unwrap()
    };
    assert!(!cleared(ticked));
    assert!(cleared(there));
}

#[test]
fn a_pending_statement_review_of_either_account_no_longer_matches_after_a_move() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let id = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    let (source_before, destination_before) = (store.reconcile_signature(checking).unwrap(), store.reconcile_signature(savings).unwrap());
    commit(&store, &[id], savings);
    assert_ne!(store.reconcile_signature(checking).unwrap(), source_before);
    assert_ne!(store.reconcile_signature(savings).unwrap(), destination_before);
}

#[test]
fn a_row_settled_between_preview_and_commit_makes_the_commit_refuse_everything() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let a = row(&store, checking, "2026-10-05", "A", "-4.00");
    let b = row(&store, checking, "2026-10-06", "B", "-5.00");
    let p = preview(&store, &[a, b], savings);
    store.conn.execute("INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES (?1, '2026-10-06', '1.00', '2026-10-07 10:00:00')", params![checking]).unwrap();
    let rid = store.conn.last_insert_rowid();
    store
        .conn
        .execute("UPDATE transactions SET reconciliation_id = ?1 WHERE id = ?2", params![rid, b])
        .unwrap();
    let before = dump(&store);
    assert!(matches!(
        store.move_transactions_to_account(&[a, b], savings, &p.token, today()).unwrap(),
        MoveOutcome::StalePreview
    ));
    assert_eq!(dump(&store), before);
}

// ---- checkpoints --------------------------------------------------------------------------------------

fn checkpoint(store: &Store, account_id: i64, period: &str, date: &str, balance: &str) {
    store
        .conn
        .execute(
            "INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?1, ?2, ?3, ?4)",
            params![account_id, period, date, balance],
        )
        .unwrap();
}

#[test]
fn a_legacy_checkpoint_asks_for_a_confirmed_balance_instead_of_blocking_and_later_rows_still_move_directly() {
    for (on_source, on_destination) in [(true, false), (false, true), (true, true)] {
        let store = Store::open_in_memory().unwrap();
        let (checking, savings) = pair(&store);
        if on_source {
            checkpoint(&store, checking, "2026-10", "2026-10-01", "900.00");
        }
        if on_destination {
            checkpoint(&store, savings, "2026-10", "2026-10-01", "600.00");
        }
        let before_cut = row(&store, checking, "2026-09-20", "Before", "-10.00");
        let on_cut = row(&store, checking, "2026-10-01", "On", "-11.00");
        let after = row(&store, checking, "2026-10-02", "After", "-12.00");
        let before = dump(&store);
        let p = preview(&store, &[before_cut], savings);
        assert_eq!(p.status, "needs_balance_confirmation", "source={on_source} destination={on_destination}");
        assert_eq!(p.mode, "confirmation");
        assert!(p.blockers.is_empty(), "a saved balance is no longer a blocker: {:?}", p.blockers);
        assert!(!p.can_commit, "the balances have not been confirmed");
        // The destination is asked too: a batch is confirmed as a whole.
        assert_eq!(p.confirmations.len(), 2);
        assert_eq!(preview(&store, &[on_cut], savings).status, "needs_balance_confirmation");
        // A row dated after every saved balance needs nothing.
        let later = preview(&store, &[after], savings);
        assert_eq!(
            (later.status, later.mode, later.can_commit),
            ("ready", "automatic", true),
            "{:?}",
            later.blockers
        );
        assert_eq!(dump(&store), before, "a preview writes nothing");
        assert!(matches!(commit(&store, &[after], savings), MoveOutcome::Moved(_)));
        let resets = |dump: String| {
            dump.split("balance_resets\n")
                .nth(1)
                .unwrap()
                .split("reconciliations")
                .next()
                .unwrap()
                .to_string()
        };
        assert_eq!(
            resets(before),
            resets(dump(&store)),
            "no saved balance is changed by a row after all of them"
        );
    }
}

#[test]
fn one_blocked_row_stops_a_batch_that_also_has_movable_rows() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let old = row(&store, checking, "2026-09-20", "Old", "-10.00");
    let new = row(&store, checking, "2026-10-05", "New", "-12.00");
    store
        .conn
        .execute("INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES (?1, '2026-09-30', '1.00', '2026-10-01 10:00:00')", params![checking])
        .unwrap();
    let rid = store.conn.last_insert_rowid();
    store
        .conn
        .execute("UPDATE transactions SET reconciliation_id = ?1 WHERE id = ?2", params![rid, old])
        .unwrap();
    let before = dump(&store);
    let p = preview(&store, &[old, new], savings);
    assert!(!p.can_commit);
    assert_eq!(p.status, "blocked");
    assert_eq!(p.rows.iter().find(|r| r.id == new).unwrap().status, "move");
    assert_eq!(p.rows.iter().find(|r| r.id == old).unwrap().status, "blocked");
    assert!(matches!(
        store.move_transactions_to_account(&[old, new], savings, &p.token, today()).unwrap(),
        MoveOutcome::Blocked(_)
    ));
    assert_eq!(dump(&store), before);
}

#[test]
fn a_typed_balance_asks_for_confirmation_and_a_future_saved_balance_blocks_that_path() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    checkpoint(&store, checking, "manual:2026-10-20", "2026-10-20", "800.00");
    let a = row(&store, checking, "2026-10-10", "Under manual", "-1.00");
    let pa = preview(&store, &[a], savings);
    assert_eq!(pa.status, "needs_balance_confirmation");
    let checking_reasons = &pa.confirmations.iter().find(|c| c.account_id == checking).unwrap().reasons;
    assert!(
        checking_reasons.iter().any(|r| r.contains("balance you set yourself")),
        "{checking_reasons:?}"
    );
    // A saved balance dated in the future cannot be replaced by a confirmed one that only counts from today.
    checkpoint(&store, savings, "2027-01", "2027-01-01", "700.00");
    let blocked = preview(&store, &[a], savings);
    assert_eq!(blocked.status, "blocked");
    assert_eq!(codes(&blocked), vec!["future_checkpoint"]);
    assert!(blocked.blockers[0].items[0].detail.contains("Jan 1, 2027"));
    // Two saved balances on one day: still asks, still nothing written.
    checkpoint(&store, checking, "manual:2026-10-20b", "2026-10-20", "810.00");
    store.conn.execute("DELETE FROM balance_resets WHERE period = '2027-01'", []).unwrap();
    let before = dump(&store);
    assert_eq!(preview(&store, &[a], savings).status, "needs_balance_confirmation");
    assert_eq!(dump(&store), before);
}

#[test]
fn a_recorded_monthly_carry_forward_corrects_older_rows_and_a_backdated_import_automatically() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let early = row(&store, checking, "2026-09-10", "September", "-50.00");
    store.roll_forward_monthly_balances(today()).unwrap();
    // imported after the carry-forward, but dated before it: the saved balance never counted it
    let backdated = row(&store, checking, "2026-09-12", "Backdated import", "-20.00");
    let early_october = row(&store, checking, "2026-10-12", "October, before the carry-forward", "-30.00");
    // The carry-forward ran when only the -50 existed, so its saved balance is 1000 - 50 = 950 and recorded that row.
    for id in [early, backdated, early_october] {
        let p = preview(&store, &[id], savings);
        assert_eq!((p.status, p.mode, p.can_commit), ("ready", "automatic", true), "{id}: {:?}", p.blockers);
    }
}

// ---- duplicates ---------------------------------------------------------------------------------------

#[test]
fn a_matching_row_already_in_the_destination_blocks_including_a_selected_row_that_is_already_there() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let mover = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    let match_unselected = row(&store, savings, "2026-10-05", "Cafe", "-4.00");
    assert_eq!(codes(&preview(&store, &[mover], savings)), vec!["duplicate_in_destination"]);
    // a selected row that is already there still counts as an existing destination row
    assert_eq!(
        codes(&preview(&store, &[mover, match_unselected], savings)),
        vec!["duplicate_in_destination"]
    );
    // the description comparison ignores case and surrounding spaces, as the importer does
    store
        .conn
        .execute(
            "UPDATE transactions SET description = '  CAFE ', fingerprint = ?1 WHERE id = ?2",
            params![fingerprint(savings, &tx("2026-10-05", "  CAFE ", "-4.00")), match_unselected],
        )
        .unwrap();
    assert_eq!(codes(&preview(&store, &[mover], savings)), vec!["duplicate_in_destination"]);
    let before = dump(&store);
    let p = preview(&store, &[mover], savings);
    assert!(matches!(
        store.move_transactions_to_account(&[mover], savings, &p.token, today()).unwrap(),
        MoveOutcome::Blocked(_)
    ));
    assert_eq!(dump(&store), before);
}

#[test]
fn rows_from_different_accounts_that_would_become_identical_block() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let third = account(&store, "Third", AccountType::Checking, "0.00");
    let a = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    let b = row(&store, third, "2026-10-05", "Cafe", "-4.00");
    let p = preview(&store, &[a, b], savings);
    assert_eq!(codes(&p), vec!["duplicate_across_accounts"]);
    assert_eq!(p.blockers[0].count, 2);
    // moved one account at a time they are fine in turn only until the first lands
    assert!(preview(&store, &[a], savings).can_commit);
}

#[test]
fn an_existing_pair_of_duplicates_in_one_source_moves_together_with_a_warning_and_no_constraint() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let a = row(&store, checking, "2026-10-05", "Coffee", "-4.00");
    let b = row(&store, checking, "2026-10-05", "Coffee", "-4.00");
    let p = preview(&store, &[a, b], savings);
    assert!(p.can_commit, "{:?}", p.blockers);
    assert_eq!(p.warnings.iter().find(|w| w.code == "duplicates_kept").map(|w| w.count), Some(2));
    assert!(matches!(commit(&store, &[a, b], savings), MoveOutcome::Moved(ref s) if s.moved_ids.len() == 2));
    let n: i64 = store
        .conn
        .query_row(
            "SELECT COUNT(*) FROM transactions WHERE account_id = ?1 AND description = 'Coffee'",
            params![savings],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 2, "both rows keep their own id");
    assert_eq!(account_of(&store, a), savings);
    assert_eq!(account_of(&store, b), savings);
}

#[test]
fn a_matching_soft_deleted_row_in_the_destination_is_not_a_collision() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let mover = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    let deleted = row(&store, savings, "2026-10-05", "Cafe", "-4.00");
    store.delete_transaction(deleted, test_now()).unwrap();
    assert!(preview(&store, &[mover], savings).can_commit);
}

#[test]
fn after_a_move_reimporting_into_the_destination_finds_the_rows_and_the_old_account_does_not() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let id = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    commit(&store, &[id], savings);
    let same = [tx("2026-10-05", "Cafe", "-4.00")];
    assert_eq!(
        store.check_duplicates(savings, &same).unwrap(),
        vec![true],
        "the destination now knows the row"
    );
    assert_eq!(
        store.check_duplicates(checking, &same).unwrap(),
        vec![false],
        "the old account no longer does"
    );
}

// ---- review state -------------------------------------------------------------------------------------

#[test]
fn only_account_dependent_review_decisions_about_moved_rows_are_forgotten() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let moved = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    let other = row(&store, checking, "2026-10-06", "Unrelated", "-9.00");
    let peer = row(&store, savings, "2026-10-07", "Cafe", "-4.00");
    store
        .conn
        .execute("INSERT INTO transfer_candidate_dismissals VALUES (?1, ?2)", params![moved, peer])
        .unwrap();
    store
        .conn
        .execute("INSERT INTO transfer_link_rejections VALUES (?1, ?2)", params![peer, moved])
        .unwrap();
    store
        .conn
        .execute("INSERT INTO transfer_candidate_dismissals VALUES (?1, ?2)", params![other, peer])
        .unwrap();
    store.dismiss_anomaly(moved, "duplicate").unwrap();
    store.dismiss_anomaly(moved, "large").unwrap();
    store.dismiss_anomaly(peer, "duplicate").unwrap();
    store.dismiss_anomaly(other, "duplicate").unwrap();
    // `peer` matches `moved` on amount and description within three days, so its answer was about the old neighbours.
    assert!(matches!(commit(&store, &[moved], savings), MoveOutcome::Moved(_)));
    let left = |sql: &str| -> i64 { store.conn.query_row(sql, [], |r| r.get(0)).unwrap() };
    assert_eq!(
        left("SELECT COUNT(*) FROM transfer_candidate_dismissals"),
        1,
        "only the unrelated pair stays"
    );
    assert_eq!(
        left(&format!(
            "SELECT COUNT(*) FROM transfer_candidate_dismissals WHERE out_transaction_id = {other}"
        )),
        1
    );
    assert_eq!(left("SELECT COUNT(*) FROM transfer_link_rejections"), 0);
    assert_eq!(
        left(&format!(
            "SELECT COUNT(*) FROM anomaly_dismissals WHERE transaction_id = {moved} AND kind = 'duplicate'"
        )),
        0
    );
    assert_eq!(
        left(&format!(
            "SELECT COUNT(*) FROM anomaly_dismissals WHERE transaction_id = {moved} AND kind = 'large'"
        )),
        1,
        "an unrelated kind of answer stays"
    );
    assert_eq!(
        left(&format!(
            "SELECT COUNT(*) FROM anomaly_dismissals WHERE transaction_id = {peer} AND kind = 'duplicate'"
        )),
        0,
        "a look-alike next to the moved row"
    );
    assert_eq!(
        left(&format!(
            "SELECT COUNT(*) FROM anomaly_dismissals WHERE transaction_id = {other} AND kind = 'duplicate'"
        )),
        1,
        "a different merchant stays"
    );
}

#[test]
fn recurring_items_and_import_preferences_are_not_touched() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    store.set_account_import_flip_signs(checking, true).unwrap();
    let id = row(&store, checking, "2026-10-05", "Streaming", "-15.00");
    store
        .conn
        .execute(
            "INSERT INTO recurring (merchant, category, amount, cadence, anchor_date) VALUES ('Streaming', NULL, '-15.00', 'monthly', '2026-10-05')",
            [],
        )
        .unwrap();
    let recurring_section = |snapshot: String| {
        snapshot
            .split("recurring\n")
            .nth(1)
            .unwrap()
            .split("investment_plans\n")
            .next()
            .unwrap()
            .to_string()
    };
    let recurring_before = recurring_section(dump(&store));
    commit(&store, &[id], savings);
    let flip: Option<bool> = store
        .conn
        .query_row("SELECT import_flip_signs FROM accounts WHERE id = ?1", params![checking], |r| r.get(0))
        .unwrap();
    assert_eq!(flip, Some(true));
    assert_eq!(recurring_section(dump(&store)), recurring_before);
}

// ---- staleness, races, failures -----------------------------------------------------------------------

#[test]
fn any_relevant_change_after_the_preview_makes_it_stale() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let a = row(&store, checking, "2026-10-05", "A", "-4.00");
    let p = preview(&store, &[a], savings);
    store.update_transaction_description(a, "A renamed").unwrap();
    let before = dump(&store);
    assert!(matches!(
        store.move_transactions_to_account(&[a], savings, &p.token, today()).unwrap(),
        MoveOutcome::StalePreview
    ));
    assert_eq!(dump(&store), before);
    // a different local day (midnight passed) is also a different plan
    let fresh = preview(&store, &[a], savings);
    let tomorrow: NaiveDate = "2026-10-30".parse().unwrap();
    assert!(matches!(
        store.move_transactions_to_account(&[a], savings, &fresh.token, tomorrow).unwrap(),
        MoveOutcome::StalePreview
    ));
    // a different selection or destination cannot borrow the token
    let b = row(&store, checking, "2026-10-06", "B", "-5.00");
    assert!(matches!(
        store.move_transactions_to_account(&[a, b], savings, &fresh.token, today()).unwrap(),
        MoveOutcome::StalePreview
    ));
}

#[test]
fn a_second_connection_adding_a_duplicate_between_preview_and_commit_stops_the_move() {
    let dir = std::env::temp_dir().join(format!("vaultspend-move-race-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("race.db");
    let _ = std::fs::remove_file(&path);
    let store = Store::open(&path).unwrap();
    let other_writer = Store::open(&path).unwrap();
    let (checking, savings) = pair(&store);
    let a = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    let p = preview(&store, &[a], savings);
    row(&other_writer, savings, "2026-10-05", "Cafe", "-4.00");
    let outcome = store.move_transactions_to_account(&[a], savings, &p.token, today()).unwrap();
    assert!(matches!(outcome, MoveOutcome::StalePreview | MoveOutcome::Blocked(_)), "{outcome:?}");
    assert_eq!(account_of(&store, a), checking);
    drop(store);
    drop(other_writer);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_failure_at_any_step_leaves_every_table_exactly_as_it_was() {
    let build = || {
        let store = Store::open_in_memory().unwrap();
        let (checking, savings) = pair(&store);
        let a = row(&store, checking, "2026-10-05", "A", "-4.00");
        let b = row(&store, checking, "2026-10-06", "B", "-5.00");
        let c = row(&store, checking, "2026-10-07", "C", "-6.00");
        store.set_transactions_cleared(&[a, b, c], true).unwrap();
        store
            .conn
            .execute("INSERT INTO transfer_candidate_dismissals VALUES (?1, ?2)", params![a, b])
            .unwrap();
        store.dismiss_anomaly(a, "duplicate").unwrap();
        (store, vec![a, b, c], savings)
    };
    for failpoint in [
        MoveFailpoint::AfterUpdate(1),
        MoveFailpoint::AfterUpdate(2),
        MoveFailpoint::AfterUpdate(3),
        MoveFailpoint::AfterReviewCleanup,
        MoveFailpoint::AfterReadback,
    ] {
        let (store, ids, savings) = build();
        let p = preview(&store, &ids, savings);
        let before = dump(&store);
        let result = store.move_transactions_with_failpoint(&ids, savings, &p.token, today(), failpoint);
        assert!(matches!(result, Err(MoveError::Injected(_))), "{failpoint:?}: {result:?}");
        assert_eq!(dump(&store), before, "{failpoint:?}");
        // the store is usable afterwards and the same plan still commits
        assert!(
            matches!(
                store.move_transactions_to_account(&ids, savings, &p.token, today()).unwrap(),
                MoveOutcome::Moved(_)
            ),
            "{failpoint:?}"
        );
    }
}

#[test]
fn a_second_identical_request_after_success_changes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let a = row(&store, checking, "2026-10-05", "A", "-4.00");
    let p = preview(&store, &[a], savings);
    assert!(matches!(
        store.move_transactions_to_account(&[a], savings, &p.token, today()).unwrap(),
        MoveOutcome::Moved(_)
    ));
    store.set_transactions_cleared(&[a], true).unwrap();
    let before = dump(&store);
    let again = store.move_transactions_to_account(&[a], savings, &p.token, today()).unwrap();
    assert!(matches!(again, MoveOutcome::StalePreview | MoveOutcome::NothingToMove(_)), "{again:?}");
    assert_eq!(dump(&store), before, "the tick set after the first move is not cleared again");
}

#[test]
fn a_large_batch_moves_in_one_transaction_with_exact_totals() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    store.conn.execute_batch("BEGIN").unwrap();
    let mut ids = Vec::new();
    for n in 0..2_600i64 {
        ids.push(row(&store, checking, "2026-10-05", &format!("Row {n}"), "-1.25"));
    }
    store.conn.execute_batch("COMMIT").unwrap();
    assert_eq!(balance(&store, checking), dec("1000.00") - dec("3250.00"));
    let p = preview(&store, &ids, savings);
    assert_eq!(p.effective_count, 2_600);
    assert_eq!(p.total, "-3250.00");
    assert!(matches!(commit(&store, &ids, savings), MoveOutcome::Moved(ref s) if s.moved_ids.len() == 2_600));
    assert_eq!(balance(&store, checking), dec("1000.00"));
    assert_eq!(balance(&store, savings), dec("500.00") - dec("3250.00"));
}

#[test]
fn the_older_single_row_path_refuses_settled_linked_and_principal_override_rows_too() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let loan = account(&store, "Mortgage", AccountType::Loan, "100000.00");
    let settled = row(&store, checking, "2026-10-05", "Settled", "-4.00");
    store
        .conn
        .execute("INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES (?1, '2026-10-06', '1.00', '2026-10-07 10:00:00')", params![checking])
        .unwrap();
    let rid = store.conn.last_insert_rowid();
    store
        .conn
        .execute("UPDATE transactions SET reconciliation_id = ?1 WHERE id = ?2", params![rid, settled])
        .unwrap();
    let out = row(&store, checking, "2026-10-08", "To savings", "-50.00");
    let into = row(&store, savings, "2026-10-08", "From checking", "50.00");
    assert!(store.link_transfer(out, into).unwrap());
    let overridden = row(&store, loan, "2026-10-05", "Payment", "1500.00");
    store.update_transaction_principal_amount(overridden, Some(dec("900.00"))).unwrap();
    let before = dump(&store);
    for (id, to) in [(settled, savings), (out, loan), (into, loan), (overridden, checking)] {
        assert!(matches!(store.update_transaction_account(id, to), Err(MoveError::Blocked(_))), "{id}");
    }
    assert_eq!(dump(&store), before, "nothing moved through the older path");
}

#[test]
fn a_blocker_far_into_a_large_batch_still_stops_every_chunk() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    store.conn.execute_batch("BEGIN").unwrap();
    let mut ids = Vec::new();
    for n in 0..2_600i64 {
        ids.push(row(&store, checking, "2026-10-05", &format!("Row {n}"), "-1.25"));
    }
    store.conn.execute_batch("COMMIT").unwrap();
    // The 2,501st row (in the seventh chunk of 400) is already counted in a finished reconciliation.
    store
        .conn
        .execute("INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES (?1, '2026-10-06', '1.00', '2026-10-07 10:00:00')", params![checking])
        .unwrap();
    let rid = store.conn.last_insert_rowid();
    store
        .conn
        .execute("UPDATE transactions SET reconciliation_id = ?1 WHERE id = ?2", params![rid, ids[2_500]])
        .unwrap();
    let before = dump(&store);
    let p = preview(&store, &ids, savings);
    assert_eq!(codes(&p), vec!["settled"]);
    assert_eq!(p.blockers[0].count, 1);
    assert!(!p.can_commit);
    assert!(matches!(commit(&store, &ids, savings), MoveOutcome::Blocked(_)));
    assert_eq!(dump(&store), before);
}

#[test]
fn the_write_lock_is_taken_before_anything_is_read() {
    let dir = std::env::temp_dir().join(format!("vaultspend-move-lock-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("lock.db");
    let _ = std::fs::remove_file(&path);
    let store = Store::open(&path).unwrap();
    let other = Store::open(&path).unwrap();
    store.conn.busy_timeout(std::time::Duration::from_millis(50)).unwrap();
    let (checking, savings) = pair(&store);
    let id = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    // Another writer holds the lock. A move that only reads (a stale token writes nothing) still has to wait for
    // it: with a plain BEGIN it would answer "stale" without ever touching the lock.
    other.conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    let result = store.move_transactions_to_account(&[id], savings, "not-the-token", today());
    assert!(matches!(result, Err(MoveError::Db(_))), "{result:?}");
    other.conn.execute_batch("ROLLBACK").unwrap();
    assert!(matches!(
        store.move_transactions_to_account(&[id], savings, "not-the-token", today()),
        Ok(MoveOutcome::StalePreview)
    ));
    assert_eq!(account_of(&store, id), checking);
    drop(store);
    drop(other);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_database_failure_is_reported_in_plain_words_without_its_internal_text() {
    let shown = MoveError::Db(rusqlite::Error::ToSqlConversionFailure("account 7 balance would be 1, expected 2".into())).to_string();
    assert!(shown.contains("nothing was changed"), "{shown}");
    for internal in ["account 7", "expected 2", "ToSql", "sqlite"] {
        assert!(!shown.contains(internal), "{shown}");
    }
}

#[test]
fn the_older_single_row_path_follows_the_same_rules() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let id = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    store.set_transactions_cleared(&[id], true).unwrap();
    // same account: a true no-op, the tick stays
    store.update_transaction_account(id, checking).unwrap();
    assert!(
        store
            .conn
            .query_row("SELECT cleared FROM transactions WHERE id = ?1", params![id], |r| r.get::<_, bool>(0))
            .unwrap()
    );
    // an unknown id is still a harmless no-op
    store.update_transaction_account(31337, savings).unwrap();
    // a checkpoint blocks it
    checkpoint(&store, checking, "2026-10", "2026-10-05", "900.00");
    let before = dump(&store);
    assert!(matches!(store.update_transaction_account(id, savings), Err(MoveError::ReviewRequired(_))));
    assert_eq!(dump(&store), before);
    // a hidden destination is refused
    store.conn.execute("DELETE FROM balance_resets", []).unwrap();
    store.set_account_hidden(savings, true).unwrap();
    assert!(matches!(
        store.update_transaction_account(id, savings),
        Err(MoveError::InvalidDestination(_))
    ));
    store.set_account_hidden(savings, false).unwrap();
    // a duplicate in the destination, a settled row and a linked row are all refused too
    let twin = row(&store, savings, "2026-10-05", "Cafe", "-4.00");
    assert!(matches!(store.update_transaction_account(id, savings), Err(MoveError::Blocked(_))));
    store.delete_transaction(twin, test_now()).unwrap();
    store.update_transaction_account(id, savings).unwrap();
    assert_eq!(account_of(&store, id), savings);
    assert!(
        !store
            .conn
            .query_row("SELECT cleared FROM transactions WHERE id = ?1", params![id], |r| r.get::<_, bool>(0))
            .unwrap()
    );
}

#[test]
fn ownership_and_details_survive_a_backup_and_the_copy_is_sound() {
    let dir = std::env::temp_dir().join(format!("vaultspend-move-backup-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("copy.db");
    let _ = std::fs::remove_file(&path);
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = pair(&store);
    let id = row(&store, checking, "2026-10-05", "Cafe", "-4.00");
    store.update_transaction_notes(id, Some("keep me")).unwrap();
    commit(&store, &[id], savings);
    store.backup_to(&path).unwrap();
    let copy = Store::open(&path).unwrap();
    assert_eq!(account_of(&copy, id), savings);
    let integrity: String = copy.conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(integrity, "ok");
    let violations: i64 = copy
        .conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))
        .unwrap();
    assert_eq!(violations, 0);
    let notes: Option<String> = copy
        .conn
        .query_row("SELECT notes FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap();
    assert_eq!(notes.as_deref(), Some("keep me"));
    drop(copy);
    let _ = std::fs::remove_dir_all(&dir);
}
