use super::*;
use crate::holding_import::HoldingInput;

fn input(symbol: &str) -> HoldingInput {
    HoldingInput {
        symbol: symbol.into(),
        name: symbol.into(),
        shares: "0.125".into(),
        price: "100.10".into(),
        cost_basis: "10".into(),
        asset_class: None,
    }
}

#[test]
fn batch_holding_import_is_exact_and_records_one_snapshot() {
    let store = Store::open_in_memory().unwrap();
    let account = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let ids = store.import_holdings(account, &[input("AAA"), input("BBB")], test_now().date()).unwrap();
    assert_eq!(ids.len(), 2);
    assert_eq!(store.portfolio_history().unwrap().len(), 1);
    assert_eq!(store.account_value_history(account).unwrap()[0].1, dec("25.02500"));
    assert!(store.list_holdings(test_now().date()).unwrap().iter().all(|h| h.prev_close.is_none()));
}

#[test]
fn batch_rejects_noninvestment_and_invalid_rows_without_writes() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    assert!(store.import_holdings(checking, &[input("AAA")], test_now().date()).is_err());
    let account = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let mut bad = input("BBB");
    bad.price = "0".into();
    assert!(store.import_holdings(account, &[input("AAA"), bad], test_now().date()).is_err());
    assert!(store.list_holdings(test_now().date()).unwrap().is_empty());
}

#[test]
fn reimport_and_duplicate_rows_are_rejected_but_other_accounts_allow_same_symbol() {
    let store = Store::open_in_memory().unwrap();
    let a = store.get_or_create_account("One", AccountType::Investment).unwrap();
    let b = store.get_or_create_account("Two", AccountType::Investment).unwrap();
    assert!(store.import_holdings(a, &[input("AAA"), input("AAA")], test_now().date()).is_err());
    store.import_holdings(a, &[input("AAA")], test_now().date()).unwrap();
    assert!(store.import_holdings(a, &[input("AAA")], test_now().date()).is_err());
    store.import_holdings(b, &[input("AAA")], test_now().date()).unwrap();
    assert_eq!(store.list_holdings(test_now().date()).unwrap().len(), 2);
}

#[test]
fn database_failure_rolls_back_earlier_rows_and_snapshots() {
    let store = Store::open_in_memory().unwrap();
    let a = store.get_or_create_account("One", AccountType::Investment).unwrap();
    store
        .conn
        .execute_batch("CREATE TRIGGER fail_second BEFORE INSERT ON holdings WHEN NEW.symbol = 'BBB' BEGIN SELECT RAISE(ABORT, 'test failure'); END;")
        .unwrap();
    assert!(store.import_holdings(a, &[input("AAA"), input("BBB")], test_now().date()).is_err());
    assert!(store.list_holdings(test_now().date()).unwrap().is_empty());
    assert!(store.portfolio_history().unwrap().is_empty());
}

#[test]
fn snapshot_failure_rolls_back_all_holdings() {
    let store = Store::open_in_memory().unwrap();
    let a = store.get_or_create_account("One", AccountType::Investment).unwrap();
    store
        .conn
        .execute_batch("CREATE TRIGGER fail_snapshot BEFORE INSERT ON portfolio_snapshots BEGIN SELECT RAISE(ABORT, 'test failure'); END;")
        .unwrap();
    assert!(store.import_holdings(a, &[input("AAA")], test_now().date()).is_err());
    assert!(store.list_holdings(test_now().date()).unwrap().is_empty());
    assert!(store.account_value_history(a).unwrap().is_empty());
}
