use super::*;
use crate::store::schema::DEFAULT_CATEGORIES;

#[test]
fn a_fresh_store_already_offers_the_default_category_suggestions() {
    let store = Store::open_in_memory().unwrap();

    let categories = store.list_categories().unwrap();

    assert!(categories.contains(&"Business Expense".to_string()));
    assert!(categories.contains(&"Rent".to_string()));
    assert_eq!(categories.len(), DEFAULT_CATEGORIES.len(), "no transactions yet, so only the defaults");
}

#[test]
fn migrate_flip_loan_transaction_signs_flips_existing_loan_transactions_but_not_others() {
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.save_transactions(checking, &[tx("2026-08-05", "Groceries", "-50.00")]).unwrap();

    // Simulate a pre-flip database: reset the migrated flag and insert
    // a transaction stored under the *old* convention (a loan payment
    // was negative), bypassing save_transactions/apply_debt_payment
    // since both already write under today's flipped convention.
    store
        .conn
        .execute("UPDATE app_settings SET loan_sign_convention_migrated = 0 WHERE id = 1", [])
        .unwrap();
    store
        .conn
        .execute(
            "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint)
                 VALUES (?1, '2026-08-05', 'Old-style Payment', '-500.00', NULL, 'old-style-fp')",
            params![loan],
        )
        .unwrap();

    store.migrate_flip_loan_transaction_signs_if_needed().unwrap();

    let loan_amount: String = store
        .conn
        .query_row("SELECT amount FROM transactions WHERE account_id = ?1", params![loan], |row| row.get(0))
        .unwrap();
    assert_eq!(loan_amount, "500.00", "the old-convention loan transaction must be negated");

    let checking_amount: String = store
        .conn
        .query_row("SELECT amount FROM transactions WHERE account_id = ?1", params![checking], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(checking_amount, "-50.00", "a non-loan account's transactions must be untouched");

    // Idempotent: running it again (as every app launch does) must not
    // flip an already-migrated database a second time.
    store.migrate_flip_loan_transaction_signs_if_needed().unwrap();
    let loan_amount_again: String = store
        .conn
        .query_row("SELECT amount FROM transactions WHERE account_id = ?1", params![loan], |row| row.get(0))
        .unwrap();
    assert_eq!(loan_amount_again, "500.00", "must not flip a second time once already migrated");
}

#[test]
fn init_schema_creates_every_performance_index_including_the_ones_added_after_migrations() {
    let store = Store::open_in_memory().unwrap();
    let mut stmt = store.conn.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").unwrap();
    let names: std::collections::HashSet<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();

    for expected in [
        "idx_transactions_fingerprint",
        "idx_transactions_account_date",
        "idx_transactions_category_date",
        "idx_transactions_date",
        "idx_budgets_period",
        "idx_transaction_splits_transaction_id",
        "idx_debt_payments_generated_transaction_id",
        "idx_transactions_account_reconciliation",
    ] {
        assert!(names.contains(expected), "expected index {expected} to exist, got {names:?}");
    }
}

#[test]
fn a_fresh_store_has_the_reconciliation_link_columns_and_layout_table() {
    let store = Store::open_in_memory().unwrap();
    assert!(store.table_has_column("transactions", "reconciliation_id").unwrap());
    for column in ["period_start", "starting_balance", "source", "holdings_checked"] {
        assert!(store.table_has_column("reconciliations", column).unwrap(), "{column}");
    }
    let count: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM statement_layouts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn existing_reconciliations_settle_the_ticked_rows_dated_on_or_before_them() {
    let store = Store::open_in_memory().unwrap();
    let acct = store.get_or_create_account("Old Checking", AccountType::Checking).unwrap();
    store
        .save_transactions(
            acct,
            &[tx("2026-07-10", "July rent", "-900.00"), tx("2026-08-10", "August rent", "-900.00"), tx("2026-08-12", "Unticked", "-5.00")],
        )
        .unwrap();
    let july = id_of(&store, "July rent", "2026-07-10");
    let august = id_of(&store, "August rent", "2026-08-10");
    let unticked = id_of(&store, "Unticked", "2026-08-12");
    store.set_transactions_cleared(&[july, august], true).unwrap();
    store
        .conn
        .execute_batch(&format!(
            "INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES ({acct}, '2026-07-31', '100.00', '2026-08-01 09:00:00');
             INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES ({acct}, '2026-08-31', '-800.00', '2026-09-01 09:00:00');"
        ))
        .unwrap();

    store.link_existing_reconciliations().unwrap();

    let link = |id: i64| -> Option<i64> {
        store
            .conn
            .query_row("SELECT reconciliation_id FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
            .unwrap()
    };
    let first: i64 = store.conn.query_row("SELECT MIN(id) FROM reconciliations", [], |r| r.get(0)).unwrap();
    assert_eq!(link(july), Some(first), "July's tick belongs to the July reconciliation");
    assert_eq!(link(august), Some(first + 1), "August's tick belongs to the August one");
    assert_eq!(link(unticked), None, "an unticked row is never settled");

    // Running it again changes nothing.
    store.link_existing_reconciliations().unwrap();
    assert_eq!(link(july), Some(first));
}

/// Builds a database shaped like one from before `reconciliation_id` and the richer reconciliation
/// columns existed: one ticked row dated on or before the reconciliation's statement date, one
/// ticked row dated after it, and a finished reconciliation with no link columns filled in.
fn old_shape_store_with_one_reconciliation() -> (Store, i64, i64) {
    let store = Store::open_in_memory().unwrap();
    let acct = store.get_or_create_account("Old Checking", AccountType::Checking).unwrap();
    store
        .save_transactions(acct, &[tx("2026-07-10", "July rent", "-900.00"), tx("2026-08-20", "Later", "-30.00")])
        .unwrap();
    let july = id_of(&store, "July rent", "2026-07-10");
    let later = id_of(&store, "Later", "2026-08-20");
    store.set_transactions_cleared(&[july, later], true).unwrap();
    store
        .conn
        .execute(
            "INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES (?1, '2026-07-31', '100.00', '2026-08-01 09:00:00')",
            params![acct],
        )
        .unwrap();
    store
        .conn
        .execute_batch(
            "DROP INDEX idx_transactions_account_reconciliation;
             ALTER TABLE transactions DROP COLUMN reconciliation_id;
             ALTER TABLE reconciliations DROP COLUMN period_start;
             ALTER TABLE reconciliations DROP COLUMN starting_balance;
             ALTER TABLE reconciliations DROP COLUMN source;
             ALTER TABLE reconciliations DROP COLUMN holdings_checked;",
        )
        .unwrap();
    (store, july, later)
}

fn reconciliation_link(store: &Store, id: i64) -> Option<i64> {
    store
        .conn
        .query_row("SELECT reconciliation_id FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

#[test]
fn an_old_database_gains_the_link_column_and_settles_its_ticked_rows_on_the_next_start() {
    let (store, july, later) = old_shape_store_with_one_reconciliation();
    assert!(!store.table_has_column("transactions", "reconciliation_id").unwrap());

    store.init_schema().unwrap();

    assert!(store.table_has_column("transactions", "reconciliation_id").unwrap());
    for column in ["period_start", "starting_balance", "source", "holdings_checked"] {
        assert!(store.table_has_column("reconciliations", column).unwrap(), "{column}");
    }
    let rec: i64 = store.conn.query_row("SELECT MIN(id) FROM reconciliations", [], |r| r.get(0)).unwrap();
    assert_eq!(reconciliation_link(&store, july), Some(rec), "the ticked row on/before the statement date is linked");
    assert_eq!(reconciliation_link(&store, later), None, "a ticked row after the statement date is not linked");
}

#[test]
fn a_failed_backfill_rolls_back_the_column_so_the_next_start_retries_both() {
    let (store, july, _later) = old_shape_store_with_one_reconciliation();
    store
        .conn
        .execute_batch(
            "CREATE TRIGGER block_backfill AFTER UPDATE ON transactions WHEN NEW.description = 'July rent'
             BEGIN SELECT RAISE(ABORT, 'backfill blocked'); END;",
        )
        .unwrap();

    let err = store.init_schema().unwrap_err();
    assert!(err.to_string().contains("backfill blocked"), "{err}");
    assert!(
        !store.table_has_column("transactions", "reconciliation_id").unwrap(),
        "the ADD COLUMN must roll back together with the failed backfill"
    );

    store.conn.execute_batch("DROP TRIGGER block_backfill;").unwrap();
    store.init_schema().unwrap();

    assert!(store.table_has_column("transactions", "reconciliation_id").unwrap());
    let rec: i64 = store.conn.query_row("SELECT MIN(id) FROM reconciliations", [], |r| r.get(0)).unwrap();
    assert_eq!(reconciliation_link(&store, july), Some(rec));
}
