use super::*;
use crate::models::AccountType;
use crate::rules::RuleSet;
use chrono::NaiveDateTime;

use crate::models::Transaction;

use chrono::NaiveDate;
mod accounts;
mod assets;
mod buckets;
mod budgets;
mod categories;
mod family;
mod forecast;
mod insights;
mod investments;
mod recurring;
mod reports;
mod rules;
mod schema;
mod settings;
mod transactions;
mod transfers;

fn tx(date: &str, description: &str, amount: &str) -> Transaction {
    Transaction {
        date: NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap(),
        description: description.to_string(),
        amount: amount.parse().unwrap(),
        category: None,
    }
}

/// A fixed, arbitrary "now" for tests exercising `delete_transaction`/
/// `delete_account` — `core` never reads the system clock itself (see
/// `delete_transaction`'s doc comment), so every caller supplies one.
fn test_now() -> NaiveDateTime {
    NaiveDateTime::parse_from_str("2026-08-20 12:00:00", "%Y-%m-%d %H:%M:%S").unwrap()
}

/// Most tests don't care about accounts — just need *an* account id to
/// save into.
fn test_account(store: &Store) -> i64 {
    store.get_or_create_account("Test Checking", AccountType::Checking).unwrap()
}

/// `list_accounts` now takes a `today` for reset-awareness; tests that
/// don't care about monthly resets just need *a* date safely after
/// every transaction date used anywhere in the store tests.
fn far_future() -> NaiveDate {
    "2099-12-31".parse().unwrap()
}

/// Raw row count in `transactions`, unlike `all_transactions()` this
/// does *not* exclude `apply_debt_payment`'s generated rows — for
/// tests asserting on that cascade-delete/creation behavior itself
/// rather than on what the Transactions tab shows.
fn raw_transaction_count(store: &Store) -> i64 {
    store.conn.query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0)).unwrap()
}

#[test]
fn looks_like_a_vault_spend_database_accepts_a_real_database_file() {
    let dir = std::env::temp_dir().join(format!("vaultspend-validate-real-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("real.db");
    if path.exists() {
        std::fs::remove_file(&path).unwrap();
    }
    drop(Store::open(&path).unwrap()); // close it before re-opening read-only below

    assert!(looks_like_a_vault_spend_database(&path).is_ok());

    std::fs::remove_file(&path).unwrap();
}

/// Regression test for the real bug this function exists to prevent:
/// `Store::open` migrates a missing table into existence rather than
/// rejecting the file, so an empty or unrelated SQLite file would look
/// identical to real data *after* being opened that way. This must be
/// caught by inspecting the file exactly as found, before that healing
/// has a chance to run.
#[test]
fn looks_like_a_vault_spend_database_rejects_a_file_with_no_matching_tables() {
    let dir = std::env::temp_dir().join(format!("vaultspend-validate-unrelated-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("unrelated.db");
    if path.exists() {
        std::fs::remove_file(&path).unwrap();
    }
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE some_other_apps_table (id INTEGER PRIMARY KEY);")
            .unwrap();
    }

    let result = looks_like_a_vault_spend_database(&path);

    assert!(result.is_err());
    assert!(
        result.unwrap_err().contains("accounts"),
        "expected the message to name a missing core table"
    );

    std::fs::remove_file(&path).unwrap();
}

#[test]
fn looks_like_a_vault_spend_database_rejects_a_file_that_isnt_sqlite_at_all() {
    let dir = std::env::temp_dir().join(format!("vaultspend-validate-not-sqlite-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("not-a-database.txt");
    std::fs::write(&path, b"this is plainly not a SQLite file").unwrap();

    assert!(looks_like_a_vault_spend_database(&path).is_err());

    std::fs::remove_file(&path).unwrap();
}

#[test]
fn next_occurrence_matches_cadence_and_calendar_cases() {
    let cases = [
        ("future anchor", "monthly", "2026-09-01", "2026-08-20", "2026-09-01"),
        ("weekly", "weekly", "2026-08-01", "2026-08-20", "2026-08-22"),
        ("biweekly", "biweekly", "2026-08-01", "2026-08-20", "2026-08-29"),
        ("monthly rollover", "monthly", "2026-06-15", "2026-08-20", "2026-09-15"),
        // February has no 31st — must clamp, not panic or skip to March.
        ("short month clamp", "monthly", "2026-01-31", "2026-02-15", "2026-02-28"),
        ("annual rollover", "annual", "2024-03-01", "2026-08-20", "2027-03-01"),
    ];

    for (label, cadence, anchor, today, expected) in cases {
        assert_eq!(
            next_occurrence(anchor.parse().unwrap(), cadence, today.parse().unwrap()),
            expected.parse::<NaiveDate>().unwrap(),
            "case: {label}",
        );
    }
}

// Linked transfers: two transactions in different accounts that are the
// two legs of one move of money between the user's own accounts.

fn checking_and_savings(store: &Store) -> (i64, i64) {
    (
        store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap(),
        store.get_or_create_account("High-Yield Savings", AccountType::Savings).unwrap(),
    )
}

/// The id of the live transaction with this description on this date.
/// (Not `last_insert_rowid()`: saving a transaction also registers its
/// category, and that insert is the *last* one.)
fn id_of(store: &Store, description: &str, date: &str) -> i64 {
    store
        .all_transactions()
        .unwrap()
        .into_iter()
        .find(|t| t.transaction.description == description && t.transaction.date.to_string() == date)
        .unwrap_or_else(|| panic!("no transaction {description:?} on {date}"))
        .id
}

/// Checking -500 on `out_date`, Savings +500 on `in_date`, both under an
/// ordinary (non-"Transfer") category so only the *link* can exclude them.
fn seed_transfer_pair(store: &Store, out_date: &str, in_date: &str) -> (i64, i64) {
    let (checking, savings) = checking_and_savings(store);
    store
        .save_transactions(
            checking,
            &[Transaction {
                category: Some("Savings Goal".to_string()),
                ..tx(out_date, "Move to savings", "-500.00")
            }],
        )
        .unwrap();
    store
        .save_transactions(
            savings,
            &[Transaction {
                category: Some("Savings Goal".to_string()),
                ..tx(in_date, "Deposit from checking", "500.00")
            }],
        )
        .unwrap();
    (id_of(store, "Move to savings", out_date), id_of(store, "Deposit from checking", in_date))
}

fn counterpart_of(store: &Store, id: i64) -> Option<i64> {
    store
        .all_transactions()
        .unwrap()
        .into_iter()
        .find(|t| t.id == id)
        .and_then(|t| t.transfer_counterpart_id)
}

fn forecast_today() -> NaiveDate {
    "2026-09-18".parse().unwrap()
}

fn checking_with_balance(store: &Store, balance: &str) -> i64 {
    let id = test_account(store);
    store.set_account_starting_balance(id, balance.parse().unwrap()).unwrap();
    id
}

fn balance_on(forecast: &BillAwareForecast, date: &str) -> Decimal {
    let date: NaiveDate = date.parse().unwrap();
    forecast
        .points
        .iter()
        .find(|p| p.date == date)
        .unwrap_or_else(|| panic!("no forecast point for {date}"))
        .balance
}

/// One categorized expense — `amount` is the positive dollars spent.
fn spend_on(store: &Store, account: i64, date: &str, description: &str, amount: &str, category: &str) {
    store.save_transactions(account, &[tx(date, description, &format!("-{amount}"))]).unwrap();
    let id = id_of(store, description, date);
    store.set_category(id, category, CategorySource::User, None).unwrap();
}

fn day(s: &str) -> NaiveDate {
    s.parse().unwrap()
}

fn dec(s: &str) -> Decimal {
    s.parse().unwrap()
}

/// A monthly bill on the 3rd, first due 2026-06-03, plus the charges the
/// bank actually posted — `(date, amount)` pairs on `desc`.
fn netflix_with(store: &Store, account: i64, stored_amount: &str, posted: &[(&str, &str)]) -> i64 {
    let id = store
        .create_recurring("Netflix", Some("Subscriptions"), dec(stored_amount), "monthly", day("2026-06-03"), None)
        .unwrap();
    for (date, amount) in posted {
        store.save_transactions(account, &[tx(date, "NETFLIX.COM 866-579", amount)]).unwrap();
    }
    id
}

fn roth(store: &Store) -> i64 {
    store.get_or_create_account("Joey Roth IRA", AccountType::Investment).unwrap()
}

fn put(store: &Store, account: i64, date: &str, description: &str, amount: &str) {
    store.save_transactions(account, &[tx(date, description, amount)]).unwrap();
}

fn month(m: &str, money_in: &str, money_out: &str) -> ContributionMonth {
    ContributionMonth {
        month: m.to_string(),
        money_in: dec(money_in),
        money_out: dec(money_out),
    }
}

fn month_cell(rows: &[CategoryMonthAmount], month: &str, category: &str) -> Option<Decimal> {
    rows.iter().find(|r| r.month == month && r.category == category).map(|r| r.amount)
}

fn day_cell(rows: &[DailySpendAmount], date: &str) -> Option<Decimal> {
    rows.iter().find(|r| r.date == date).map(|r| r.amount)
}

fn bill(store: &Store, merchant: &str, amount: &str, anchor: &str) -> i64 {
    store.create_recurring(merchant, None, dec(amount), "monthly", day(anchor), None).unwrap()
}

fn reminder_names(store: &Store, today: &str, window: i64) -> Vec<String> {
    store
        .reminders_to_send(day(today), window)
        .unwrap()
        .into_iter()
        .map(|r| r.merchant)
        .collect()
}
