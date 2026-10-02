use super::*;

// Setup-data import (see setup_import.rs for the parser's own tests).

/// The `member_id` of the single transaction on `account_id` — for
/// tests inspecting an `apply_debt_payment`-generated row directly,
/// which `all_transactions()` no longer surfaces (see its doc comment).
fn raw_transaction_member_id(store: &Store, account_id: i64) -> Option<i64> {
    store
        .conn
        .query_row("SELECT member_id FROM transactions WHERE account_id = ?1", params![account_id], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn get_or_create_account_creates_then_reuses_by_name() {
    let store = Store::open_in_memory().unwrap();
    let first = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    let second = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

    assert_eq!(first, second, "re-using an existing account name should return the same id");

    let accounts = store.list_accounts(far_future()).unwrap();
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].account.name, "Everyday Checking");
    assert_eq!(accounts[0].account.account_type, AccountType::Checking);
}

#[test]
fn create_account_refuses_a_name_already_in_use_and_leaves_that_account_alone() {
    // "Add account" used get_or_create_account, so "CAR LOAN" quietly returned the existing
    // Car Loan and the dialog's balance and details were written over it (2026-10-02 QA, H1).
    let store = Store::open_in_memory().unwrap();
    let loan = store
        .create_account("Car Loan", AccountType::Loan)
        .unwrap()
        .expect("a new name is created");
    store.set_account_starting_balance(loan, Decimal::from(14500)).unwrap();

    assert_eq!(store.create_account("CAR LOAN", AccountType::Checking).unwrap(), None);
    assert_eq!(
        store.create_account("  car loan ", AccountType::Checking).unwrap(),
        None,
        "surrounding spaces don't make a new name"
    );

    let accounts = store.list_accounts(far_future()).unwrap();
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].account.account_type, AccountType::Loan);
    assert_eq!(accounts[0].starting_balance, Decimal::from(14500));
    assert!(store.create_account("Car Loan 2", AccountType::Loan).unwrap().is_some());
}

#[test]
fn find_account_by_name_never_creates_one() {
    let store = Store::open_in_memory().unwrap();
    store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

    assert_eq!(store.find_account_by_name("Nonexistent").unwrap(), None);
    assert!(
        store.find_account_by_name("everyday checking").unwrap().is_some(),
        "lookup should be case-insensitive"
    );
    assert_eq!(
        store.list_accounts(far_future()).unwrap().len(),
        1,
        "a missed lookup must not create anything"
    );
}

#[test]
fn different_account_names_get_different_ids() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    let credit = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();

    assert_ne!(checking, credit);
    assert_eq!(store.list_accounts(far_future()).unwrap().len(), 2);
}

#[test]
fn a_new_accounts_starting_balance_defaults_to_zero() {
    let store = Store::open_in_memory().unwrap();
    store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();

    assert_eq!(accounts[0].starting_balance, Decimal::ZERO);
    assert_eq!(accounts[0].current_balance, Decimal::ZERO);
}

#[test]
fn current_balance_reflects_starting_balance_plus_its_own_transactions() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "5000.00".parse().unwrap()).unwrap();
    store
        .save_transactions(
            checking,
            &[
                tx("2026-08-01", "Payroll Deposit", "3120.00"),
                tx("2026-08-05", "Green Leaf Grocers", "-86.42"),
            ],
        )
        .unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();

    assert_eq!(accounts[0].starting_balance, "5000.00".parse().unwrap());
    assert_eq!(accounts[0].current_balance, "8033.58".parse().unwrap());
}

#[test]
fn a_credit_accounts_available_credit_moves_with_charges_and_payments() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
    store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap();
    store
        .save_transactions(
            card,
            &[
                tx("2026-08-01", "Grocery Store", "-300.00"), // a charge reduces available credit
                tx("2026-08-15", "Card Payment", "100.00"),   // a payment restores it
            ],
        )
        .unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();

    assert_eq!(
        accounts[0].current_balance,
        "1800.00".parse().unwrap(),
        "2000 limit - 300 charge + 100 payment = 1800 available"
    );
}

#[test]
fn each_accounts_balance_is_independent() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    store.set_account_starting_balance(card, "500.00".parse().unwrap()).unwrap();
    store
        .save_transactions(checking, &[tx("2026-08-01", "Payroll Deposit", "200.00")])
        .unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();
    let checking_balance = accounts.iter().find(|a| a.id == checking).unwrap().current_balance;
    let card_balance = accounts.iter().find(|a| a.id == card).unwrap().current_balance;

    assert_eq!(checking_balance, "1200.00".parse().unwrap());
    assert_eq!(card_balance, "500.00".parse().unwrap(), "untouched by checking's transaction");
}

#[test]
fn set_account_starting_balance_updates_it_and_recomputes_current_balance() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    store.set_account_starting_balance(checking, "1500.00".parse().unwrap()).unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();
    assert_eq!(accounts[0].starting_balance, "1500.00".parse().unwrap());
    assert_eq!(accounts[0].current_balance, "1500.00".parse().unwrap());
}

#[test]
fn set_account_starting_balance_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.set_account_starting_balance(999, "100.00".parse().unwrap()).unwrap();
}

#[test]
fn set_account_balance_override_becomes_the_new_baseline_going_forward() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-09-05", "Coffee", "-5.00")]).unwrap();

    store
        .set_account_balance_override(checking, "2000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();

    let accounts = store.list_accounts("2026-09-10".parse().unwrap()).unwrap();
    assert_eq!(
        accounts[0].current_balance,
        "1995.00".parse().unwrap(),
        "override + the transaction dated after it, ignoring the original starting balance entirely"
    );
}

#[test]
fn set_account_balance_override_does_not_change_balance_as_of_a_date_before_it() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-09-01", "Payroll", "500.00")]).unwrap();

    store
        .set_account_balance_override(checking, "9999.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();

    let accounts = store.list_accounts("2026-09-02".parse().unwrap()).unwrap();
    assert_eq!(
        accounts[0].current_balance,
        "1500.00".parse().unwrap(),
        "a date before the override must be unaffected by it"
    );
}

#[test]
fn set_account_balance_override_on_the_same_day_replaces_rather_than_stacks() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    store
        .set_account_balance_override(checking, "5000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();
    store
        .set_account_balance_override(checking, "3000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();

    let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
    assert_eq!(accounts[0].current_balance, "3000.00".parse().unwrap());
}

#[test]
fn set_account_balance_override_wins_over_the_current_months_automatic_rollover() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
    store
        .set_account_balance_override(checking, "7500.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();

    let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
    assert_eq!(
        accounts[0].current_balance,
        "7500.00".parse().unwrap(),
        "the manual override is dated after the monthly rollover's checkpoint, so it must win"
    );
}

#[test]
fn set_account_balance_override_on_an_unknown_account_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store
        .set_account_balance_override(999, "100.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();
}

#[test]
fn set_account_balance_override_nets_out_a_transaction_already_posted_the_same_day() {
    // Reproduces the exact real-world confusion reported: an account
    // already has a same-day transaction (a leftover purchase from
    // testing, not deleted) when the balance is corrected. Typing
    // "$20,000" must show exactly $20,000 immediately — not $18,500,
    // requiring the user to have remembered and mentally subtracted a
    // transaction they may not even recall exists.
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-09-04", "barbor shop", "-1500.00")]).unwrap();

    store
        .set_account_balance_override(checking, "20000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();

    let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
    assert_eq!(
        accounts[0].current_balance,
        "20000.00".parse().unwrap(),
        "a transaction already posted the same day must be netted out, so the typed amount is exactly what shows"
    );
}

#[test]
fn set_account_balance_override_still_lets_a_new_same_day_transaction_move_the_balance_after_netting() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-09-04", "barbor shop", "-1500.00")]).unwrap();

    store
        .set_account_balance_override(checking, "20000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();
    // A genuinely new transaction, added *after* the correction, dated
    // the same day — must still move the balance from here, exactly
    // like the already-posted one must not.
    store.save_transactions(checking, &[tx("2026-09-04", "Coffee", "-100.00")]).unwrap();

    let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
    assert_eq!(accounts[0].current_balance, "19900.00".parse().unwrap());
}

#[test]
fn set_account_balance_override_nets_out_a_same_day_transaction_on_a_loan_account() {
    // Same scenario as the cash-account version above, but for a loan
    // — where a same-day transaction must be netted the *other*
    // direction (added back, not subtracted) since a loan's
    // current_balance is netted by subtracting transactions, not
    // adding them (see account_balance_as_of).
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
    store.save_transactions(loan, &[tx("2026-09-04", "Payment", "500.00")]).unwrap();

    store
        .set_account_balance_override(loan, "8000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();

    let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
    assert_eq!(
        accounts[0].current_balance,
        "8000.00".parse().unwrap(),
        "a payment already posted the same day must be netted out, so the typed amount owed is exactly what shows"
    );
}

#[test]
fn set_account_balance_override_still_lets_a_new_same_day_transaction_move_a_loans_balance_after_netting() {
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
    store.save_transactions(loan, &[tx("2026-09-04", "Payment", "500.00")]).unwrap();

    store
        .set_account_balance_override(loan, "8000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();
    // A genuinely new payment, added *after* the correction, dated the
    // same day — must still reduce what's owed from here.
    store.save_transactions(loan, &[tx("2026-09-04", "Extra Payment", "200.00")]).unwrap();

    let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
    assert_eq!(accounts[0].current_balance, "7800.00".parse().unwrap());
}

#[test]
fn set_account_balance_override_counts_a_transaction_dated_the_same_day_added_afterward() {
    // Regression test: a correction and a transaction landing on the
    // exact same calendar date — the correction happens first, then a
    // transaction dated that same day is added afterward — must not
    // silently exclude that transaction (it did, before this test was
    // added: the checkpoint was originally stored dated `as_of` itself,
    // so `date > since_date` filtered out anything dated `as_of` too).
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Rewards Credit Card", AccountType::Credit).unwrap();
    store.set_account_starting_balance(card, "0.00".parse().unwrap()).unwrap();

    store
        .set_account_balance_override(card, "0.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();
    store.save_transactions(card, &[tx("2026-09-04", "test500", "-500.00")]).unwrap();

    let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
    assert_eq!(
        accounts.iter().find(|a| a.id == card).unwrap().current_balance,
        "-500.00".parse().unwrap(),
        "a transaction dated the same day as the override, added afterward, must still count"
    );
}

#[test]
fn set_account_balance_override_ignores_a_soft_deleted_transaction_dated_after_it() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    store
        .set_account_balance_override(checking, "2000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();
    let ids = store
        .save_transactions_with_ids(checking, &[tx("2026-09-05", "Refund", "300.00")])
        .unwrap();
    store.delete_transaction(ids[0], "2026-09-05T12:00:00".parse().unwrap()).unwrap();

    let accounts = store.list_accounts("2026-09-10".parse().unwrap()).unwrap();
    assert_eq!(
        accounts[0].current_balance,
        "2000.00".parse().unwrap(),
        "a soft-deleted transaction dated after the override must not count toward the new baseline either"
    );
}

#[test]
fn a_stale_pre_fix_manual_override_self_heals_on_the_next_launch_with_no_user_action() {
    // Reproduces the exact real-world scenario found via live testing:
    // a balance was corrected by the pre-fix build (checkpoint dated
    // `as_of` itself), the app is later relaunched running the fixed
    // code, and a transaction dated the same day as that old
    // correction is added. The stale row must self-heal the moment
    // the store reopens — the fix must not require the user to
    // manually re-correct the balance to unstick it.
    let dir = std::env::temp_dir().join(format!("vaultspend-stale-override-migration-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("stale_override.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }

    let checking = {
        let store = Store::open(&db_path).unwrap();
        let id = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
        store.set_account_starting_balance(id, "1000.00".parse().unwrap()).unwrap();
        // Directly simulates what the pre-fix `set_account_balance_override`
        // wrote — bypassing the (now-fixed) method, since it can no
        // longer produce this shape itself.
        store
            .conn
            .execute(
                "INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?1, 'manual:2026-09-04', '2026-09-04', '20000.00')",
                params![id],
            )
            .unwrap();
        id
    }; // old store dropped here — simulates the app closing

    let store = Store::open(&db_path).unwrap(); // the next real launch, running the fixed code
    store.save_transactions(checking, &[tx("2026-09-04", "Groceries", "-40.00")]).unwrap();

    let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
    assert_eq!(
        accounts.iter().find(|a| a.id == checking).unwrap().current_balance,
        "19960.00".parse().unwrap(),
        "a stale pre-fix override must self-heal on reopen and count a same-day transaction, with no manual re-correction"
    );

    drop(store);
    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn migrate_fix_stale_manual_balance_override_reset_dates_leaves_correctly_anchored_rows_alone() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    store
        .set_account_balance_override(checking, "5000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();

    // The migration already ran once as part of opening this store;
    // running it again explicitly must be a genuine no-op against a
    // row the (already-fixed) override method itself just wrote.
    store.migrate_fix_stale_manual_balance_override_reset_dates().unwrap();

    let reset_date: String = store
        .conn
        .query_row(
            "SELECT reset_date FROM balance_resets WHERE account_id = ?1 AND period = 'manual:2026-09-04'",
            params![checking],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(reset_date, "2026-09-03");
}

#[test]
fn set_account_balance_override_wins_a_same_day_tie_against_the_automatic_rollovers_own_checkpoint() {
    // Regression test for a real bug found via live QA: the automatic
    // monthly rollover and a manual override both anchor their
    // `reset_date` to "yesterday relative to whenever they ran" — so
    // a rollover that already fired this app launch (the common case)
    // and a same-day manual override land on the *exact same*
    // `reset_date`. Without a deterministic tiebreaker, `ORDER BY
    // reset_date DESC LIMIT 1` picked whichever row SQLite happened to
    // return first among the tie, which was the *stale* rollover
    // value in practice — silently discarding the override.
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    // The rollover runs first (as it does on every real app launch),
    // landing a "2026-09" reset dated 2026-09-03 with the pre-override
    // balance.
    store.roll_forward_monthly_balances("2026-09-04".parse().unwrap()).unwrap();
    // The user then corrects the balance later the same day — its
    // checkpoint is *also* dated 2026-09-03 under the yesterday-anchor
    // scheme, tying with the rollover's row exactly.
    store
        .set_account_balance_override(checking, "2500.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();

    let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
    assert_eq!(
        accounts[0].current_balance,
        "2500.00".parse().unwrap(),
        "the manual override must win a same-`reset_date` tie against an earlier automatic rollover"
    );
}

#[test]
fn set_account_balance_override_is_correctly_absorbed_by_a_later_monthly_rollover() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    store
        .set_account_balance_override(checking, "5000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();
    store.save_transactions(checking, &[tx("2026-09-10", "Groceries", "-40.00")]).unwrap();

    // Next month's automatic rollover has no idea a manual override ever
    // happened — it just calls `account_balance_as_of` like any other
    // reader, which already picks the override up transparently.
    let rolled = store.roll_forward_monthly_balances("2026-10-01".parse().unwrap()).unwrap();

    assert_eq!(rolled.len(), 1);
    assert_eq!(
        rolled[0].2,
        "4960.00".parse().unwrap(),
        "the monthly rollover must compose on top of the manual override, not ignore or double-count it"
    );
}

#[test]
fn set_account_balance_override_accepts_zero_and_negative_values() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    store
        .set_account_balance_override(checking, "0.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();
    assert_eq!(
        store.list_accounts("2026-09-04".parse().unwrap()).unwrap()[0].current_balance,
        "0.00".parse().unwrap()
    );

    // A negative balance is legitimate (overdraft, or a credit
    // account's "available" going past its limit) — must not be
    // rejected or clamped.
    store
        .set_account_balance_override(checking, "-250.00".parse().unwrap(), "2026-09-05".parse().unwrap())
        .unwrap();
    assert_eq!(
        store.list_accounts("2026-09-05".parse().unwrap()).unwrap()[0].current_balance,
        "-250.00".parse().unwrap()
    );
}

#[test]
fn set_account_balance_override_never_touches_starting_balance() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Rewards Credit Card", AccountType::Credit).unwrap();
    store.set_account_starting_balance(card, "3000.00".parse().unwrap()).unwrap(); // credit limit

    store
        .set_account_balance_override(card, "-1870.96".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();

    let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
    assert_eq!(
        accounts[0].starting_balance,
        "3000.00".parse().unwrap(),
        "correcting the balance must never move the credit limit — they're independently editable"
    );
    assert_eq!(accounts[0].current_balance, "-1870.96".parse().unwrap());
}

#[test]
fn set_account_balance_override_two_corrections_on_different_days_both_apply_in_order() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    store
        .set_account_balance_override(checking, "2000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();
    store.save_transactions(checking, &[tx("2026-09-05", "Coffee", "-5.00")]).unwrap();
    store
        .set_account_balance_override(checking, "3000.00".parse().unwrap(), "2026-09-08".parse().unwrap())
        .unwrap();
    store.save_transactions(checking, &[tx("2026-09-09", "Groceries", "-40.00")]).unwrap();

    // A date between the two corrections must still reflect the first
    // one plus whatever landed before the second (dates picked with a
    // clear day of slack on either side of each correction, so this
    // isn't accidentally testing the same-day-absorption boundary
    // covered by the other tests).
    assert_eq!(
        store.list_accounts("2026-09-06".parse().unwrap()).unwrap()[0].current_balance,
        "1995.00".parse().unwrap(),
        "a date after the first correction but before the second must not see the second"
    );
    // The latest date must reflect the second correction plus only
    // what's dated after *it*, not double-counting anything absorbed
    // into the second correction's own typed value.
    assert_eq!(
        store.list_accounts("2026-09-10".parse().unwrap()).unwrap()[0].current_balance,
        "2960.00".parse().unwrap()
    );
}

#[test]
fn set_account_balance_override_pred_opt_handles_a_leap_day_boundary_correctly() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    // 2028 is a leap year — the day before March 1st is Feb 29th, not
    // Feb 28th. A transaction dated the leap day itself, entered before
    // the override, must be absorbed (not double-counted); one dated
    // the override's own day, entered after, must still count.
    store
        .save_transactions(checking, &[tx("2028-02-29", "Leap day charge", "-15.00")])
        .unwrap();

    store
        .set_account_balance_override(checking, "2000.00".parse().unwrap(), "2028-03-01".parse().unwrap())
        .unwrap();
    store
        .save_transactions(checking, &[tx("2028-03-01", "Same-day charge", "-25.00")])
        .unwrap();

    assert_eq!(
        store.list_accounts("2028-03-01".parse().unwrap()).unwrap()[0].current_balance,
        "1975.00".parse().unwrap()
    );
}

#[test]
fn set_account_balance_override_does_not_affect_a_different_account() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    let savings = store.get_or_create_account("Emergency Savings", AccountType::Savings).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    store.set_account_starting_balance(savings, "500.00".parse().unwrap()).unwrap();

    store
        .set_account_balance_override(checking, "9999.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();

    let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
    assert_eq!(
        accounts.iter().find(|a| a.id == savings).unwrap().current_balance,
        "500.00".parse().unwrap(),
        "correcting one account's balance must not affect any other account"
    );
}

#[test]
fn update_account_type_corrects_a_mistakenly_created_account() {
    let store = Store::open_in_memory().unwrap();
    let id = store.get_or_create_account("Sapphire Rewards", AccountType::Savings).unwrap();

    store.update_account_type(id, AccountType::Credit).unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();
    assert_eq!(accounts[0].account.account_type, AccountType::Credit);
}

#[test]
fn update_account_type_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.update_account_type(999, AccountType::Credit).unwrap();
}

#[test]
fn delete_account_removes_it_and_its_transactions() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    let savings = store.get_or_create_account("Nest Egg", AccountType::Savings).unwrap();
    store
        .save_transactions(
            checking,
            &[
                tx("2026-08-01", "Payroll Deposit", "3000.00"),
                tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
            ],
        )
        .unwrap();
    store.save_transactions(savings, &[tx("2026-08-01", "Transfer In", "500.00")]).unwrap();

    let affected = store.delete_account(checking).unwrap();

    assert_eq!(affected, 2, "both of checking's transactions were removed");
    let accounts = store.list_accounts(far_future()).unwrap();
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].id, savings);
    let remaining = store.all_transactions().unwrap();
    assert_eq!(remaining.len(), 1, "savings' own transaction must be untouched");
    assert_eq!(remaining[0].account_id, savings);
}

#[test]
fn delete_account_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.delete_account(999).unwrap();
}

#[test]
fn delete_account_removes_a_balance_reset_snapshot_taken_against_it() {
    // Regression test: `roll_forward_monthly_balances` leaves a
    // `balance_resets` row (`account_id NOT NULL REFERENCES
    // accounts(id)`) behind for every account it touches. Deleting an
    // account that has one used to trip a foreign key constraint
    // instead of succeeding.
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Test", AccountType::Checking).unwrap();
    store.roll_forward_monthly_balances("2026-08-01".parse().unwrap()).unwrap();

    store.delete_account(checking).unwrap();

    assert!(store.list_accounts(far_future()).unwrap().is_empty());
}

#[test]
fn delete_family_member_nulls_member_id_on_the_accounts_it_owns() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let checking = test_account(&store);
    store.set_account_member(checking, Some(member)).unwrap();

    store.delete_family_member(member).unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();
    assert_eq!(accounts[0].member_id, None);
}

#[test]
fn delete_family_member_leaves_a_different_members_rows_untouched() {
    let store = Store::open_in_memory().unwrap();
    let alex = store.create_family_member("Alex").unwrap();
    let sam = store.create_family_member("Sam").unwrap();
    let checking = test_account(&store);
    store.set_account_member(checking, Some(sam)).unwrap();

    store.delete_family_member(alex).unwrap();

    assert_eq!(store.list_accounts(far_future()).unwrap()[0].member_id, Some(sam));
}

#[test]
fn save_transactions_gives_a_new_transaction_its_accounts_member_by_default() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let checking = test_account(&store);
    store.set_account_member(checking, Some(member)).unwrap();

    store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();

    assert_eq!(store.all_transactions().unwrap()[0].member_id, Some(member));
}

#[test]
fn create_transaction_defaults_the_member_from_the_account_like_import_does() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let checking = test_account(&store);
    store.set_account_member(checking, Some(member)).unwrap();

    store.create_transaction(checking, &tx("2026-08-01", "Cash tip", "-20.00"), None).unwrap();

    assert_eq!(store.all_transactions().unwrap()[0].member_id, Some(member));
}

#[test]
fn apply_debt_payment_gives_the_generated_transaction_the_debt_accounts_member() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let checking = test_account(&store);
    let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
    store.set_account_member(loan, Some(member)).unwrap();
    store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")]).unwrap();
    let source_id = store.all_transactions().unwrap()[0].id;

    store
        .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
        .unwrap();

    assert_eq!(raw_transaction_member_id(&store, loan), Some(member));
}

#[test]
fn set_account_member_assigns_and_clears_a_member() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let checking = test_account(&store);

    store.set_account_member(checking, Some(member)).unwrap();
    assert_eq!(store.list_accounts(far_future()).unwrap()[0].member_id, Some(member));

    store.set_account_member(checking, None).unwrap();
    assert_eq!(store.list_accounts(far_future()).unwrap()[0].member_id, None);
}

#[test]
fn list_accounts_includes_its_members_name() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let checking = test_account(&store);
    store.set_account_member(checking, Some(member)).unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();

    assert_eq!(accounts[0].member_name, Some("Alex".to_string()));
}

#[test]
fn list_accounts_falls_back_to_transaction_balance_for_an_investment_account_with_no_holdings() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    store.set_account_starting_balance(brokerage, "5000.00".parse().unwrap()).unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();

    assert_eq!(accounts[0].current_balance, "5000.00".parse().unwrap());
}

#[test]
fn a_new_accounts_institution_and_mask_default_to_none() {
    let store = Store::open_in_memory().unwrap();
    store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();

    assert_eq!(accounts[0].institution, None);
    assert_eq!(accounts[0].mask, None);
}

#[test]
fn set_account_details_persists_institution_and_mask() {
    let store = Store::open_in_memory().unwrap();
    let id = store.get_or_create_account("Sapphire Preferred", AccountType::Credit).unwrap();

    store.set_account_details(id, Some("Chase"), Some("4821")).unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();
    assert_eq!(accounts[0].institution, Some("Chase".to_string()));
    assert_eq!(accounts[0].mask, Some("4821".to_string()));
}

#[test]
fn set_account_details_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.set_account_details(999, Some("Chase"), Some("4821")).unwrap();
}

#[test]
fn opening_a_pre_institution_database_migrates_it_without_losing_data() {
    // Simulates a database from before institution/mask existed: an
    // `accounts` table without those two columns.
    let dir = std::env::temp_dir().join(format!("meadow-institution-migration-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("pre_institution.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }

    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    account_type TEXT NOT NULL,
                    starting_balance TEXT NOT NULL DEFAULT '0'
                );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '0')",
            [],
        )
        .unwrap();
    } // old-style connection dropped here

    let store = Store::open(&db_path).unwrap();
    let accounts = store.list_accounts(far_future()).unwrap();

    assert_eq!(accounts.len(), 1, "the pre-existing account must survive the migration");
    assert_eq!(accounts[0].institution, None);

    drop(store);
    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn opening_a_pre_balance_database_migrates_it_without_losing_data() {
    // Simulates a real database created before account balances
    // existed: an `accounts` table with no `starting_balance` column.
    let dir = std::env::temp_dir().join(format!("meadow-balance-migration-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("pre_balance.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }

    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    account_type TEXT NOT NULL
                );",
        )
        .unwrap();
        conn.execute("INSERT INTO accounts (name, account_type) VALUES ('Everyday Checking', 'checking')", [])
            .unwrap();
    } // old-style connection dropped here

    let store = Store::open(&db_path).unwrap();
    let accounts = store.list_accounts(far_future()).unwrap();

    assert_eq!(accounts.len(), 1, "the pre-existing account must survive the migration");
    assert_eq!(accounts[0].account.name, "Everyday Checking");
    assert_eq!(accounts[0].starting_balance, Decimal::ZERO);

    drop(store);
    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn an_in_memory_store_never_creates_an_activity_log() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.save_transactions(checking, &[tx("2026-08-05", "Groceries", "-60.00")]).unwrap();

    assert_eq!(store.activity_log_path, None);
}

#[test]
fn a_loan_transaction_with_no_principal_override_still_uses_its_full_amount() {
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "300000.00".parse().unwrap()).unwrap();
    store
        .save_transactions(loan, &[tx("2026-08-05", "Extra Principal Payment", "500.00")])
        .unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();
    assert_eq!(accounts[0].current_balance, "299500.00".parse().unwrap());
}

fn setup_data(text: &str) -> crate::setup_import::SetupImportResult {
    // The parser is private-by-file; round-tripping through a temp file
    // exercises the same public load_setup_csv path the app uses. Tests
    // run in parallel within this one process, so the file path must be
    // unique per *call*, not just per process — an earlier version
    // derived it from the text's length plus byte sum, which gave two
    // calls passing the identical `FULL_TEMPLATE` (used by more than
    // one test below) the exact same path. That let their
    // write/read/delete sequences race: one test's `setup_data` could
    // observe another's in-flight write or have its file deleted out
    // from under it, intermittently reading back the wrong (or
    // momentarily missing) content — observed in practice as
    // `apply_setup_import_creates_every_section_through_the_normal_paths`
    // occasionally seeing zero accounts instead of two. A monotonic
    // counter guarantees every call gets its own file regardless of
    // content.
    static CALL_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = CALL_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("vaultspend-setup-import-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(format!("template-{n:x}.csv"));
    std::fs::write(&path, text).unwrap();
    let result = crate::setup_import::load_setup_csv(&path).unwrap();
    std::fs::remove_file(&path).ok();
    result
}

const FULL_TEMPLATE: &str = "Accounts\n\
        Name,Type,Starting Balance,Institution,Mask\n\
        Everyday Checking,checking,1000.00,Ally,1234\n\
        Car Loan,loan,10000.00,,\n\
        \n\
        Categories\n\
        Name\n\
        Coffee Shops\n\
        \n\
        Budgets\n\
        Category,Group,Monthly Amount,Period\n\
        Coffee Shops,flexible,50.00,2026-08\n\
        \n\
        Buckets\n\
        Name,Target Amount,Target Date,Linked Account\n\
        Emergency Fund,5000.00,,Everyday Checking\n";

#[test]
fn apply_setup_import_creates_every_section_through_the_normal_paths() {
    let store = Store::open_in_memory().unwrap();
    let data = setup_data(FULL_TEMPLATE);
    assert!(data.errors.is_empty(), "template must parse cleanly: {:?}", data.errors);

    let outcome = store.apply_setup_import(&data, "2026-08").unwrap();

    assert_eq!(outcome.accounts_created, 2);
    assert_eq!(outcome.categories_created, 1);
    assert_eq!(outcome.budgets_set, 1);
    assert_eq!(outcome.buckets_created, 1);
    assert!(outcome.skipped.is_empty(), "nothing should be skipped: {:?}", outcome.skipped);

    let accounts = store.list_accounts(far_future()).unwrap();
    let checking = accounts.iter().find(|a| a.account.name == "Everyday Checking").unwrap();
    assert_eq!(checking.account.account_type, AccountType::Checking);
    assert_eq!(checking.starting_balance, "1000.00".parse().unwrap());
    assert_eq!(checking.institution, Some("Ally".to_string()));
    assert_eq!(checking.mask, Some("1234".to_string()));
    assert!(accounts.iter().any(|a| a.account.name == "Car Loan"));

    assert!(store.list_categories().unwrap().contains(&"Coffee Shops".to_string()));

    let budgets = store.list_budgets("2026-08").unwrap();
    let coffee = budgets.iter().find(|b| b.category == "Coffee Shops").unwrap();
    assert_eq!(coffee.monthly_amount, "50.00".parse().unwrap());
    assert_eq!(coffee.budget_group, "flexible");

    let buckets = store.list_buckets().unwrap();
    assert_eq!(buckets.len(), 1);
    assert_eq!(buckets[0].name, "Emergency Fund");
    assert_eq!(buckets[0].target_amount, Some("5000.00".parse().unwrap()));
    // linked by name to the account this same import created
    assert_eq!(buckets[0].account_id, Some(checking.id));
}

#[test]
fn applying_the_same_template_twice_does_not_error_or_duplicate() {
    let store = Store::open_in_memory().unwrap();
    let data = setup_data(FULL_TEMPLATE);

    store.apply_setup_import(&data, "2026-08").unwrap();
    let second = store.apply_setup_import(&data, "2026-08").unwrap();

    // accounts/categories/budgets settle into the same state...
    assert_eq!(store.list_accounts(far_future()).unwrap().len(), 2);
    assert_eq!(store.list_buckets().unwrap().len(), 1);
    let budgets = store.list_budgets("2026-08").unwrap();
    assert_eq!(budgets.iter().filter(|b| b.category == "Coffee Shops").count(), 1);
    // ...and the second run's accounts and bucket land in skipped, not a hard error
    assert_eq!(second.accounts_created, 0);
    assert_eq!(second.buckets_created, 0);
    assert_eq!(second.skipped.len(), 3, "{:?}", second.skipped);
    assert!(second.skipped.iter().any(|s| s.contains("Everyday Checking")));
    assert!(second.skipped.iter().any(|s| s.contains("Emergency Fund")));
}

#[test]
fn a_setup_import_never_overwrites_an_existing_account() {
    // Same overwrite as "Add account" (2026-10-02 QA, H1): a file row named like an existing
    // account used to reset its balance and details and count as created.
    let store = Store::open_in_memory().unwrap();
    let mine = store.create_account("Everyday Checking", AccountType::Checking).unwrap().unwrap();
    store.set_account_starting_balance(mine, "2500.00".parse().unwrap()).unwrap();
    store.set_account_details(mine, Some("Chase"), Some("4821")).unwrap();

    let outcome = store.apply_setup_import(&setup_data(FULL_TEMPLATE), "2026-08").unwrap();

    assert_eq!(outcome.accounts_created, 1, "only Car Loan is new");
    assert!(
        outcome
            .skipped
            .iter()
            .any(|s| s == "Everyday Checking: an account with this name already exists"),
        "{:?}",
        outcome.skipped
    );
    let accounts = store.list_accounts(far_future()).unwrap();
    let checking = accounts.iter().find(|a| a.id == mine).unwrap();
    assert_eq!(checking.starting_balance, "2500.00".parse().unwrap());
    assert_eq!(checking.institution.as_deref(), Some("Chase"));
    assert_eq!(checking.mask.as_deref(), Some("4821"));
    // the file's bucket still links to the existing account by name
    assert_eq!(store.list_buckets().unwrap()[0].account_id, Some(mine));
}

#[test]
fn a_blank_budget_period_lands_in_the_default_period() {
    let store = Store::open_in_memory().unwrap();
    let data = setup_data("Budgets\nCategory,Group,Monthly Amount,Period\nGroceries,flexible,400.00,\n");

    store.apply_setup_import(&data, "2026-09").unwrap();

    let budgets = store.list_budgets("2026-09").unwrap();
    assert_eq!(budgets.len(), 1);
    assert_eq!(budgets[0].category, "Groceries");
}

#[test]
fn a_buckets_unknown_linked_account_is_skipped_but_the_bucket_is_still_created() {
    let store = Store::open_in_memory().unwrap();
    let data = setup_data("Buckets\nName,Target Amount,Target Date,Linked Account\nVacation,1000.00,,No Such Account\n");

    let outcome = store.apply_setup_import(&data, "2026-08").unwrap();

    assert_eq!(outcome.buckets_created, 1);
    assert_eq!(outcome.skipped.len(), 1);
    assert!(outcome.skipped[0].contains("No Such Account"));
    let buckets = store.list_buckets().unwrap();
    assert_eq!(buckets[0].name, "Vacation");
    assert_eq!(buckets[0].account_id, None);
}

#[test]
fn apply_setup_import_creates_holdings_linked_by_account_name() {
    let store = Store::open_in_memory().unwrap();
    let data = setup_data(
        "Accounts\nName,Type,Starting Balance,Institution,Mask\nBrokerage,investment,,,\n\
             \n\
             Holdings\nAccount,Symbol,Name,Shares,Price,Cost Basis,Asset Class\n\
             Brokerage,AAPL,Apple Inc.,10,231.20,1450.00,US Stocks\n",
    );

    let outcome = store.apply_setup_import(&data, "2026-08").unwrap();

    assert_eq!(outcome.holdings_created, 1);
    assert!(outcome.skipped.is_empty());
    let holdings = store.list_holdings(test_now().date()).unwrap();
    assert_eq!(holdings.len(), 1);
    assert_eq!(holdings[0].symbol, "AAPL");
    assert_eq!(holdings[0].name, "Apple Inc.");
    assert_eq!(holdings[0].shares, "10".parse().unwrap());
    assert_eq!(holdings[0].price, "231.20".parse().unwrap());
    assert_eq!(holdings[0].cost_basis, "1450.00".parse().unwrap());
    assert_eq!(holdings[0].asset_class, Some("US Stocks".to_string()));
}

#[test]
fn a_holdings_unknown_account_is_skipped_entirely_not_created_without_one() {
    let store = Store::open_in_memory().unwrap();
    let data = setup_data(
        "Holdings\nAccount,Symbol,Name,Shares,Price,Cost Basis,Asset Class\n\
             No Such Account,AAPL,,10,231.20,1450.00,\n",
    );

    let outcome = store.apply_setup_import(&data, "2026-08").unwrap();

    assert_eq!(outcome.holdings_created, 0);
    assert_eq!(outcome.skipped.len(), 1);
    assert!(outcome.skipped[0].contains("No Such Account"));
    assert!(outcome.skipped[0].contains("AAPL"));
    assert!(store.list_holdings(test_now().date()).unwrap().is_empty());
}

#[test]
fn a_holdings_row_with_non_positive_shares_or_price_is_skipped_not_created() {
    let store = Store::open_in_memory().unwrap();
    let data = setup_data(
        "Accounts\nName,Type,Starting Balance,Institution,Mask\nBrokerage,investment,,,\n\
             \n\
             Holdings\nAccount,Symbol,Name,Shares,Price,Cost Basis,Asset Class\n\
             Brokerage,NEG,,-10,100.00,1000.00,\n\
             Brokerage,ZERO,,0,100.00,1000.00,\n",
    );

    let outcome = store.apply_setup_import(&data, "2026-08").unwrap();

    assert_eq!(outcome.holdings_created, 0);
    assert_eq!(outcome.skipped.len(), 2);
    assert!(outcome.skipped[0].contains("NEG"));
    assert!(outcome.skipped[1].contains("ZERO"));
    assert!(store.list_holdings(test_now().date()).unwrap().is_empty());
}

#[test]
fn a_blank_holding_name_defaults_to_the_symbol() {
    let store = Store::open_in_memory().unwrap();
    let data = setup_data(
        "Accounts\nName,Type,Starting Balance,Institution,Mask\nBrokerage,investment,,,\n\
             \n\
             Holdings\nAccount,Symbol,Name,Shares,Price,Cost Basis,Asset Class\n\
             Brokerage,VTI,,5,220.00,1000.00,\n",
    );

    store.apply_setup_import(&data, "2026-08").unwrap();

    let holdings = store.list_holdings(test_now().date()).unwrap();
    assert_eq!(holdings[0].name, "VTI");
}

#[test]
fn importing_a_budget_registers_its_category_too() {
    // A budget row for a category the user never separately listed in
    // the Categories section must still leave that category selectable
    // everywhere, same as creating a budget line through the UI does.
    let store = Store::open_in_memory().unwrap();
    let data = setup_data("Budgets\nCategory,Group,Monthly Amount,Period\nBrand New Category,fixed,100.00,2026-08\n");

    store.apply_setup_import(&data, "2026-08").unwrap();

    assert!(store.list_categories().unwrap().contains(&"Brand New Category".to_string()));
}

#[test]
fn debt_payoff_projection_excludes_an_account_marked_excluded_from_debt_payoff() {
    // A credit card the user pays off in full every month shouldn't be
    // dragged into a payoff plan just because it happens to carry a
    // balance at the moment they check.
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Paid Off Monthly Card", AccountType::Loan).unwrap();
    store.set_account_starting_balance(card, "500.00".parse().unwrap()).unwrap();
    store.set_account_excluded_from_debt_payoff(card, true).unwrap();

    let plan = store
        .debt_payoff_projection(
            "snowball",
            Decimal::ZERO,
            &[(card, "50.00".parse().unwrap())],
            "2026-08-20".parse().unwrap(),
        )
        .unwrap();

    assert!(plan.per_account.is_empty());
    assert_eq!(plan.total_months, Some(0));
}

#[test]
fn set_account_excluded_from_debt_payoff_can_be_reversed() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Card", AccountType::Loan).unwrap();
    store.set_account_starting_balance(card, "500.00".parse().unwrap()).unwrap();
    store.set_account_excluded_from_debt_payoff(card, true).unwrap();
    store.set_account_excluded_from_debt_payoff(card, false).unwrap();

    let plan = store
        .debt_payoff_projection(
            "snowball",
            Decimal::ZERO,
            &[(card, "50.00".parse().unwrap())],
            "2026-08-20".parse().unwrap(),
        )
        .unwrap();

    assert_eq!(plan.per_account.len(), 1, "re-including the account should bring it back into the plan");
}

#[test]
fn debt_payoff_projection_avalanche_prioritizes_the_higher_rate_debt() {
    let store = Store::open_in_memory().unwrap();
    let high_rate = store.get_or_create_account("High Rate Card", AccountType::Loan).unwrap();
    store.set_account_starting_balance(high_rate, "1000.00".parse().unwrap()).unwrap();
    store.set_account_interest_rate(high_rate, Some("25.00".parse().unwrap())).unwrap();
    let low_rate = store.get_or_create_account("Low Rate Card", AccountType::Loan).unwrap();
    store.set_account_starting_balance(low_rate, "1000.00".parse().unwrap()).unwrap();
    store.set_account_interest_rate(low_rate, Some("5.00".parse().unwrap())).unwrap();

    let plan = store
        .debt_payoff_projection(
            "avalanche",
            "200.00".parse().unwrap(),
            &[(high_rate, "10.00".parse().unwrap()), (low_rate, "10.00".parse().unwrap())],
            "2026-08-20".parse().unwrap(),
        )
        .unwrap();

    let high_line = plan.per_account.iter().find(|l| l.account_id == high_rate).unwrap();
    let low_line = plan.per_account.iter().find(|l| l.account_id == low_rate).unwrap();
    assert!(
        high_line.payoff_date.unwrap() < low_line.payoff_date.unwrap(),
        "avalanche should clear the higher-rate card first: {high_line:?} vs {low_line:?}"
    );
}

#[test]
fn debt_payoff_projection_accrues_interest_on_an_apr_bearing_debt() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Card", AccountType::Loan).unwrap();
    store.set_account_starting_balance(card, "1200.00".parse().unwrap()).unwrap();
    store.set_account_interest_rate(card, Some("24.00".parse().unwrap())).unwrap();

    let plan = store
        .debt_payoff_projection(
            "snowball",
            Decimal::ZERO,
            &[(card, "110.00".parse().unwrap())],
            "2026-08-20".parse().unwrap(),
        )
        .unwrap();

    assert!(plan.total_interest_paid > Decimal::ZERO);
    assert!(plan.per_account[0].payoff_date.is_some());
}

#[test]
fn debt_payoff_projection_never_resolves_when_the_minimum_does_not_cover_interest() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Card", AccountType::Loan).unwrap();
    store.set_account_starting_balance(card, "1000.00".parse().unwrap()).unwrap();
    store.set_account_interest_rate(card, Some("36.00".parse().unwrap())).unwrap();

    // 36% APR = 3%/month = $30/month in interest on $1000 — a $5
    // minimum with no extra payment can never make a dent.
    let plan = store
        .debt_payoff_projection(
            "snowball",
            Decimal::ZERO,
            &[(card, "5.00".parse().unwrap())],
            "2026-08-20".parse().unwrap(),
        )
        .unwrap();

    assert_eq!(plan.total_months, None);
    assert_eq!(plan.per_account[0].payoff_date, None);
}

#[test]
fn roll_forward_monthly_balances_makes_current_balance_the_new_baseline() {
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "300000.00".parse().unwrap()).unwrap();
    store.save_transactions(loan, &[tx("2026-08-05", "Payment", "1000.00")]).unwrap(); // owed drops to 299000 during August

    let rolled = store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();

    assert_eq!(rolled.len(), 1);
    assert_eq!(rolled[0].1, "Mortgage");
    assert_eq!(rolled[0].2, "299000.00".parse().unwrap());

    // "now" (well into September, no further transactions) reflects the reset directly.
    let accounts = store.list_accounts("2026-09-15".parse().unwrap()).unwrap();
    assert_eq!(accounts[0].current_balance, "299000.00".parse().unwrap());
}

#[test]
fn a_transaction_dated_the_same_day_as_the_rollover_still_counts_that_day() {
    // Reproduces a real user-reported bug: the monthly rollover ran
    // (say, on app launch the morning of 2026-09-01) before a credit
    // card statement got imported later that same day. The payment
    // must still reduce what's owed *today* — not sit invisible until
    // 2026-09-02 just because it landed on the same calendar day the
    // reset itself was taken.
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Credit Card", AccountType::Credit).unwrap();
    store.set_account_starting_balance(card, "5000.00".parse().unwrap()).unwrap(); // $5000 limit

    store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();

    // Imported (or applied) after the rollover already ran, but still dated today.
    store.save_transactions(card, &[tx("2026-09-01", "Payment", "500.00")]).unwrap();

    let accounts = store.list_accounts("2026-09-01".parse().unwrap()).unwrap();
    let owed = "5000.00".parse::<Decimal>().unwrap() - accounts[0].current_balance;
    assert_eq!(owed, "-500.00".parse().unwrap(), "today's payment must already reduce what's owed today");
}

#[test]
fn roll_forward_monthly_balances_is_a_no_op_the_second_time_in_the_same_month() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    let first = store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
    let second = store.roll_forward_monthly_balances("2026-09-20".parse().unwrap()).unwrap();

    assert_eq!(first.len(), 1);
    assert!(second.is_empty(), "same month, already rolled — must not roll again or double-report");
}

#[test]
fn roll_forward_monthly_balances_adds_a_fresh_reset_for_a_later_month() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-09-10", "Deposit", "200.00")]).unwrap();
    let october_roll = store.roll_forward_monthly_balances("2026-10-01".parse().unwrap()).unwrap();

    assert_eq!(october_roll.len(), 1);
    assert_eq!(october_roll[0].2, "1200.00".parse().unwrap());
}

#[test]
fn list_accounts_only_sums_transactions_after_the_latest_reset() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-08-10", "Deposit", "500.00")]).unwrap();

    store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-09-05", "Deposit", "100.00")]).unwrap();

    let accounts = store.list_accounts("2026-09-30".parse().unwrap()).unwrap();

    // 1500 (reset baseline) + 100 (September's only transaction) = 1600,
    // NOT 1000 + 500 + 100 = 1600 double-counted differently, and
    // definitely not re-summing August's 500 on top of the reset.
    assert_eq!(accounts[0].current_balance, "1600.00".parse().unwrap());
}

#[test]
fn list_accounts_exposes_the_account_s_latest_checkpoint_date() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    let accounts = store.list_accounts("2026-08-15".parse().unwrap()).unwrap();
    assert_eq!(
        accounts[0].checkpoint_date, None,
        "no rollover or manual correction has happened yet — every transaction ever recorded should still count"
    );

    // Rolling forward on 2026-09-01 anchors the new checkpoint to the
    // day before (see roll_forward_monthly_balances's own comment).
    store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
    let accounts = store.list_accounts("2026-09-30".parse().unwrap()).unwrap();
    assert_eq!(accounts[0].checkpoint_date, Some("2026-08-31".parse().unwrap()));

    // A later manual correction moves the checkpoint further still —
    // same anchor-to-the-day-before convention.
    store
        .set_account_balance_override(checking, "2000.00".parse().unwrap(), "2026-09-15".parse().unwrap())
        .unwrap();
    let accounts = store.list_accounts("2026-09-30".parse().unwrap()).unwrap();
    assert_eq!(accounts[0].checkpoint_date, Some("2026-09-14".parse().unwrap()));
}

#[test]
fn list_accounts_exposes_the_account_s_icon_key_override() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();

    let accounts = store.list_accounts("2026-08-15".parse().unwrap()).unwrap();
    assert_eq!(accounts[0].icon_key, None, "no explicit icon chosen yet");

    store.set_account_icon(checking, Some("crypto")).unwrap();
    let accounts = store.list_accounts("2026-08-15".parse().unwrap()).unwrap();
    assert_eq!(accounts[0].icon_key, Some("crypto".to_string()));

    store.set_account_icon(checking, None).unwrap();
    let accounts = store.list_accounts("2026-08-15".parse().unwrap()).unwrap();
    assert_eq!(
        accounts[0].icon_key, None,
        "clearing it back to None goes back to guessing from account_type"
    );
}

#[test]
fn set_account_icon_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.set_account_icon(999, Some("mortgage")).unwrap();
}

#[test]
fn a_balance_correction_moves_the_balance_but_not_what_was_contributed() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    put(&store, acct, "2026-08-03", "Deposit", "500.00");
    store.set_account_balance_override(acct, dec("12000.00"), day("2026-09-01")).unwrap();

    let c = store.account_contributions(acct, day("2026-09-20")).unwrap();

    assert_eq!((c.total_in, c.total_out, c.net), (dec("500.00"), dec("0"), dec("500.00")));
    assert_eq!(c.months, vec![month("2026-08", "500.00", "0")]);
}

/// A checking account opening at `start` with a few known transactions;
/// returns (account, [+200 on 07-15, -50 on 08-10, -30 on 09-05]).
fn reconcilable(store: &Store, start: &str) -> (i64, [i64; 3]) {
    let acct = store.get_or_create_account("Statement Checking", AccountType::Checking).unwrap();
    store
        .conn
        .execute("UPDATE accounts SET starting_balance = ?1 WHERE id = ?2", params![start, acct])
        .unwrap();
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
fn the_cleared_balance_is_the_opening_balance_plus_the_transactions_marked_cleared() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, _gas]) = reconcilable(&store, "1000.00");
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();

    let status = store.reconciliation_status(acct, dec("1150.00")).unwrap();

    assert_eq!(status.cleared_balance, dec("1150.00"));
    assert_eq!(status.difference, Decimal::ZERO);
    assert_eq!(status.cleared_count, 2);
}

#[test]
fn the_difference_is_what_the_statement_says_minus_what_has_cleared() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, _coffee, _gas]) = reconcilable(&store, "1000.00");
    store.set_transactions_cleared(&[deposit], true).unwrap();

    let status = store.reconciliation_status(acct, dec("1150.00")).unwrap();

    assert_eq!(status.cleared_balance, dec("1200.00"));
    assert_eq!(status.difference, dec("-50.00"));
}

#[test]
fn clearing_can_be_undone_and_a_deleted_transaction_stops_counting() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, _gas]) = reconcilable(&store, "1000.00");
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();

    store.set_transactions_cleared(&[coffee], false).unwrap();
    assert_eq!(store.reconciliation_status(acct, dec("0")).unwrap().cleared_balance, dec("1200.00"));

    store.delete_transaction(deposit, test_now()).unwrap();
    assert_eq!(store.reconciliation_status(acct, dec("0")).unwrap().cleared_balance, dec("1000.00"));
}

#[test]
fn a_reconciliation_can_only_be_finished_when_the_difference_is_zero() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, _gas]) = reconcilable(&store, "1000.00");
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();

    let refused = store.finish_reconciliation(acct, day("2026-08-31"), dec("1200.00"), test_now()).unwrap();
    assert!(!refused);
    assert_eq!(store.last_reconciliation(acct).unwrap(), None);

    let accepted = store.finish_reconciliation(acct, day("2026-08-31"), dec("1150.00"), test_now()).unwrap();
    assert!(accepted);
    assert_eq!(store.last_reconciliation(acct).unwrap(), Some((day("2026-08-31"), dec("1150.00"))));
}

#[test]
fn the_latest_reconciliation_is_the_one_reported() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = reconcilable(&store, "1000.00");
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
    store.finish_reconciliation(acct, day("2026-08-31"), dec("1150.00"), test_now()).unwrap();
    store.set_transactions_cleared(&[gas], true).unwrap();
    store.finish_reconciliation(acct, day("2026-09-30"), dec("1120.00"), test_now()).unwrap();

    assert_eq!(store.last_reconciliation(acct).unwrap(), Some((day("2026-09-30"), dec("1120.00"))));
}

#[test]
fn reconcile_candidates_are_uncleared_rows_plus_anything_cleared_since_the_last_reconciliation() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = reconcilable(&store, "1000.00");
    store.set_transactions_cleared(&[deposit, coffee], true).unwrap();
    store.finish_reconciliation(acct, day("2026-08-31"), dec("1150.00"), test_now()).unwrap();
    store.set_transactions_cleared(&[gas], true).unwrap();

    // Everything up to Sep 30: the reconciled July/Aug rows are settled and drop out; September's shows.
    let candidates = store.reconcile_candidates(acct, day("2026-09-30")).unwrap();

    assert_eq!(candidates.iter().map(|c| c.id).collect::<Vec<_>>(), vec![gas]);
    assert!(candidates[0].cleared);
}

#[test]
fn reconcile_candidates_stop_at_the_statement_date() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, _gas]) = reconcilable(&store, "1000.00");

    let candidates = store.reconcile_candidates(acct, day("2026-08-31")).unwrap();

    assert_eq!(
        candidates.iter().map(|c| c.id).collect::<Vec<_>>(),
        vec![coffee, deposit],
        "newest first, none after the statement date"
    );
}

#[test]
fn applied_payment_account_category_follows_source_without_rewriting_generated_row() {
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let card = store.get_or_create_account("Test Card", AccountType::Credit).unwrap();
    let source = store
        .create_transaction(checking, &tx("2026-09-01", "Card payment", "-100.00"), None)
        .unwrap();
    store.set_category(source, "No Category", CategorySource::User, None).unwrap();
    store.apply_debt_payment(source, card, dec("55.35"), day("2026-09-02")).unwrap();
    let before = store.list_account_transactions(card, 10).unwrap()[0].clone();
    let balance = store.account_balance_as_of(card, "credit", Decimal::ZERO, far_future()).unwrap();
    store.set_category(source, "Payment/Credit", CategorySource::User, None).unwrap();
    let after = store.list_account_transactions(card, 10).unwrap()[0].clone();
    assert_eq!(after.category.as_deref(), Some("Payment/Credit"));
    assert_eq!(after.id, before.id);
    assert_eq!(after.amount, dec("55.35"));
    assert_eq!(after.date, day("2026-09-02"));
    assert_eq!(after.payment_source_id, Some(source));
    assert_eq!(after.payment_source_account_id, Some(checking));
    assert_eq!(after.payment_source_date, Some(day("2026-09-01")));
    assert_eq!(
        store.all_transactions().unwrap()[0].applied_to_debt.as_ref().unwrap().date,
        day("2026-09-02")
    );
    assert_eq!(store.account_balance_as_of(card, "credit", Decimal::ZERO, far_future()).unwrap(), balance);
    assert_eq!(store.all_transactions().unwrap().len(), 1);
    let stored: String = store
        .conn
        .query_row("SELECT category FROM transactions WHERE id = ?1", [after.id], |r| r.get(0))
        .unwrap();
    assert_eq!(stored, "No Category");
    store
        .conn
        .execute("UPDATE transactions SET category = NULL WHERE id = ?1", [source])
        .unwrap();
    assert_eq!(store.list_account_transactions(card, 10).unwrap()[0].category, None);
    assert_eq!(store.reconcile_candidates(card, day("2026-09-01")).unwrap().len(), 0);
    assert_eq!(store.reconcile_candidates(card, day("2026-09-02")).unwrap().len(), 1);
    store.set_category(source, "Payment/Credit", CategorySource::User, None).unwrap();
    store.rename_category("Payment/Credit", "Card payment").unwrap();
    assert_eq!(
        store.list_account_transactions(card, 10).unwrap()[0].category.as_deref(),
        Some("Card payment")
    );
    store.delete_category("Card payment").unwrap();
    assert_eq!(store.list_account_transactions(card, 10).unwrap()[0].category, None);
    store.create_category("Rule payment", None).unwrap();
    store
        .set_category_if_registered(source, "Rule payment", CategorySource::Rule, None)
        .unwrap();
    assert_eq!(
        store.list_account_transactions(card, 10).unwrap()[0].category.as_deref(),
        Some("Rule payment")
    );
    store.delete_transaction(source, day("2026-09-03").and_hms_opt(0, 0, 0).unwrap()).unwrap();
    assert!(store.list_account_transactions(card, 10).unwrap().is_empty());
    store.restore_transactions(&[source]).unwrap();
    assert_eq!(store.list_account_transactions(card, 10).unwrap()[0].payment_source_id, Some(source));
    store
        .conn
        .execute("UPDATE transactions SET deleted_at = '2026-09-03' WHERE id = ?1", [source])
        .unwrap();
    let unavailable = store.list_account_transactions(card, 10).unwrap().remove(0);
    assert_eq!(unavailable.payment_source_id, None);
    assert_eq!(unavailable.category.as_deref(), Some("No Category"));
    store.restore_transactions(&[source]).unwrap();
    store.unapply_debt_payment(source).unwrap();
    assert!(store.list_account_transactions(card, 10).unwrap().is_empty());
}

#[test]
fn applied_payment_category_survives_reopen_and_does_not_match_descriptions() {
    let dir = std::env::temp_dir().join(format!("vault-payment-read-model-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("test.db");
    let (source, card);
    {
        let store = Store::open(&path).unwrap();
        let checking = test_account(&store);
        card = store.get_or_create_account("Test Card", AccountType::Credit).unwrap();
        source = store
            .create_transaction(checking, &tx("2026-09-01", "Card payment", "-100.00"), None)
            .unwrap();
        store.set_category(source, "No Category", CategorySource::User, None).unwrap();
        store.apply_debt_payment(source, card, dec("55.35"), day("2026-09-02")).unwrap();
        store.set_category(source, "Payment/Credit", CategorySource::User, None).unwrap();
        let ordinary = store
            .create_transaction(card, &tx("2026-09-03", "Payment applied from: Card payment", "2.00"), None)
            .unwrap();
        store.set_category(ordinary, "Ordinary category", CategorySource::User, None).unwrap();
    }
    {
        let store = Store::open(&path).unwrap();
        let rows = store.list_account_transactions(card, 10).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].category.as_deref(), Some("Ordinary category"));
        assert_eq!(rows[0].payment_source_id, None);
        assert_eq!(rows[1].category.as_deref(), Some("Payment/Credit"));
        assert_eq!(rows[1].payment_source_id, Some(source));
        assert_eq!(store.list_account_transactions(card, 1).unwrap().len(), 1);
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn list_account_transactions_is_newest_first_carries_the_cleared_flag_and_honors_the_limit() {
    let store = Store::open_in_memory().unwrap();
    let (acct, [deposit, coffee, gas]) = reconcilable(&store, "1000.00");
    store.set_transactions_cleared(&[deposit], true).unwrap();

    let all = store.list_account_transactions(acct, 10).unwrap();
    assert_eq!(all.iter().map(|t| t.id).collect::<Vec<_>>(), vec![gas, coffee, deposit]);
    assert_eq!(all.iter().map(|t| t.cleared).collect::<Vec<_>>(), vec![false, false, true]);

    assert_eq!(store.list_account_transactions(acct, 2).unwrap().len(), 2);
}

#[test]
fn balance_history_gives_month_end_balances_ending_with_today() {
    let store = Store::open_in_memory().unwrap();
    let (acct, _) = reconcilable(&store, "1000.00");

    let history = store.account_balance_history(acct, day("2026-09-18"), 3).unwrap();

    assert_eq!(
        history,
        vec![
            (day("2026-07-31"), dec("1200.00")),
            (day("2026-08-31"), dec("1150.00")),
            (day("2026-09-18"), dec("1120.00")),
        ]
    );
}

#[test]
fn balance_history_repeats_the_balance_through_a_quiet_month() {
    let store = Store::open_in_memory().unwrap();
    let (acct, _) = reconcilable(&store, "1000.00");

    let history = store.account_balance_history(acct, day("2026-11-10"), 3).unwrap();

    assert_eq!(
        history.iter().map(|(_, b)| *b).collect::<Vec<_>>(),
        vec![dec("1120.00"), dec("1120.00"), dec("1120.00")]
    );
}
