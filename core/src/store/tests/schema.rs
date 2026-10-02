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
    ] {
        assert!(names.contains(expected), "expected index {expected} to exist, got {names:?}");
    }
}
