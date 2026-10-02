use super::*;

#[test]
fn delete_account_unlinks_rather_than_deletes_a_recurring_item_pointing_to_it() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store
        .create_recurring(
            "Netflix",
            None,
            "-15.00".parse().unwrap(),
            "monthly",
            "2026-08-01".parse().unwrap(),
            Some(checking),
        )
        .unwrap();

    store.delete_account(checking).unwrap();

    let recurring = store.list_recurring(far_future()).unwrap();
    assert_eq!(recurring.len(), 1, "the recurring item itself survives");
    assert_eq!(recurring[0].account_id, None);
}

#[test]
fn delete_family_member_nulls_member_id_on_the_recurring_items_it_owns() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let recurring_id = store
        .create_recurring("Netflix", None, "-15.00".parse().unwrap(), "monthly", "2026-08-01".parse().unwrap(), None)
        .unwrap();
    store.set_recurring_member(recurring_id, Some(member)).unwrap();

    store.delete_family_member(member).unwrap();

    assert_eq!(store.list_recurring(far_future()).unwrap()[0].member_id, None);
}

#[test]
fn set_recurring_member_assigns_and_clears_a_member() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let recurring_id = store
        .create_recurring("Netflix", None, "-15.00".parse().unwrap(), "monthly", "2026-08-01".parse().unwrap(), None)
        .unwrap();

    store.set_recurring_member(recurring_id, Some(member)).unwrap();
    assert_eq!(store.list_recurring(far_future()).unwrap()[0].member_id, Some(member));

    store.set_recurring_member(recurring_id, None).unwrap();
    assert_eq!(store.list_recurring(far_future()).unwrap()[0].member_id, None);
}

#[test]
fn list_recurring_includes_its_members_name() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let recurring_id = store
        .create_recurring("Netflix", None, "-15.00".parse().unwrap(), "monthly", "2026-08-01".parse().unwrap(), None)
        .unwrap();
    store.set_recurring_member(recurring_id, Some(member)).unwrap();

    let recurring = store.list_recurring(far_future()).unwrap();

    assert_eq!(recurring[0].member_name, Some("Alex".to_string()));
}

#[test]
fn opening_a_pre_member_id_database_migrates_every_table_without_losing_data() {
    // Simulates a database from before family member attribution
    // existed: accounts/transactions/recurring/buckets/assets with no
    // `member_id` column on any of them.
    let dir = std::env::temp_dir().join(format!("meadow-member-id-migration-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("pre_member_id.db");
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
                    starting_balance TEXT NOT NULL DEFAULT '0',
                    institution TEXT,
                    mask TEXT,
                    interest_rate TEXT,
                    excluded_from_debt_payoff INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id INTEGER NOT NULL REFERENCES accounts(id),
                    date TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    category TEXT,
                    category_source TEXT,
                    confidence REAL,
                    fingerprint TEXT NOT NULL
                );
                CREATE TABLE recurring (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    merchant TEXT NOT NULL,
                    category TEXT,
                    amount TEXT NOT NULL,
                    cadence TEXT NOT NULL,
                    anchor_date TEXT NOT NULL,
                    account_id INTEGER
                );
                CREATE TABLE buckets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    target_amount TEXT,
                    target_date TEXT,
                    account_id INTEGER
                );
                CREATE TABLE assets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    asset_type TEXT NOT NULL,
                    value TEXT NOT NULL,
                    valued_on TEXT NOT NULL,
                    notes TEXT
                );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO accounts (id, name, account_type, starting_balance) VALUES (1, 'Everyday Checking', 'checking', '0')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO transactions (account_id, date, description, amount, fingerprint) VALUES (1, '2026-08-01', 'Groceries', '-50.00', 'fp1')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO recurring (merchant, amount, cadence, anchor_date, account_id) VALUES ('Netflix', '-15.00', 'monthly', '2026-08-01', 1)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO buckets (name, account_id) VALUES ('Emergency Fund', 1)", [])
            .unwrap();
        conn.execute(
            "INSERT INTO assets (name, asset_type, value, valued_on) VALUES ('House', 'Real Estate', '300000.00', '2026-08-01')",
            [],
        )
        .unwrap();
    } // old-style connection dropped here

    let store = Store::open(&db_path).unwrap();
    let member = store.create_family_member("Alex").unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();
    assert_eq!(accounts.len(), 1, "the pre-existing account must survive the migration");
    assert_eq!(accounts[0].member_id, None);
    store.set_account_member(accounts[0].id, Some(member)).unwrap();
    assert_eq!(store.list_accounts(far_future()).unwrap()[0].member_id, Some(member));

    let transactions = store.all_transactions().unwrap();
    assert_eq!(transactions.len(), 1, "the pre-existing transaction must survive the migration");
    store.set_transaction_member(transactions[0].id, Some(member)).unwrap();
    assert_eq!(store.all_transactions().unwrap()[0].member_id, Some(member));

    let recurring = store.list_recurring(far_future()).unwrap();
    assert_eq!(recurring.len(), 1, "the pre-existing recurring item must survive the migration");
    store.set_recurring_member(recurring[0].id, Some(member)).unwrap();
    assert_eq!(store.list_recurring(far_future()).unwrap()[0].member_id, Some(member));

    let buckets = store.list_buckets().unwrap();
    assert_eq!(buckets.len(), 1, "the pre-existing bucket must survive the migration");
    store.set_bucket_member(buckets[0].id, Some(member)).unwrap();
    assert_eq!(store.list_buckets().unwrap()[0].member_id, Some(member));

    let assets = store.list_assets().unwrap();
    assert_eq!(assets.len(), 1, "the pre-existing asset must survive the migration");
    store.set_asset_member(assets[0].id, Some(member)).unwrap();
    assert_eq!(store.list_assets().unwrap()[0].member_id, Some(member));

    drop(store);
    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn create_recurring_then_list_recurring_computes_next_date() {
    let store = Store::open_in_memory().unwrap();
    let id = store
        .create_recurring(
            "Netflix",
            Some("Subscriptions"),
            "-15.49".parse().unwrap(),
            "monthly",
            "2026-06-04".parse().unwrap(),
            None,
        )
        .unwrap();

    let today: NaiveDate = "2026-08-20".parse().unwrap();
    let items = store.list_recurring(today).unwrap();

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, id);
    assert_eq!(items[0].merchant, "Netflix");
    assert_eq!(items[0].category, Some("Subscriptions".to_string()));
    assert_eq!(items[0].next_date, "2026-09-04".parse().unwrap());
}

#[test]
fn list_recurring_includes_the_linked_accounts_name() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store
        .create_recurring(
            "Rocket Mortgage",
            None,
            "-1840.00".parse().unwrap(),
            "monthly",
            "2026-08-01".parse().unwrap(),
            Some(checking),
        )
        .unwrap();

    let items = store.list_recurring("2026-08-20".parse().unwrap()).unwrap();

    assert_eq!(items[0].account_name, Some("Everyday Checking".to_string()));
}

#[test]
fn delete_recurring_removes_it() {
    let store = Store::open_in_memory().unwrap();
    let id = store
        .create_recurring("Netflix", None, "-15.49".parse().unwrap(), "monthly", "2026-06-04".parse().unwrap(), None)
        .unwrap();

    store.delete_recurring(id).unwrap();

    assert_eq!(store.list_recurring("2026-08-20".parse().unwrap()).unwrap().len(), 0);
}

#[test]
fn delete_recurring_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.delete_recurring(999).unwrap();
}

#[test]
fn set_recurring_status_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.set_recurring_status(999, "canceled").unwrap();
}

#[test]
fn recurring_totals_is_zero_with_no_recurring_items() {
    let store = Store::open_in_memory().unwrap();
    let totals = store.recurring_totals().unwrap();
    assert_eq!(totals, RecurringTotals::default());
}

#[test]
fn recurring_totals_sums_every_cadence_onto_a_common_monthly_and_annual_footing() {
    let store = Store::open_in_memory().unwrap();
    // One expense on each cadence, $12 (weekly), $24 (biweekly), $100
    // (monthly), $1200 (annual) — chosen so each cadence's monthly and
    // annual figures are easy to hand-verify.
    store
        .create_recurring(
            "Weekly Thing",
            None,
            "-12.00".parse().unwrap(),
            "weekly",
            "2026-06-01".parse().unwrap(),
            None,
        )
        .unwrap();
    store
        .create_recurring(
            "Biweekly Thing",
            None,
            "-24.00".parse().unwrap(),
            "biweekly",
            "2026-06-01".parse().unwrap(),
            None,
        )
        .unwrap();
    store
        .create_recurring(
            "Monthly Thing",
            None,
            "-100.00".parse().unwrap(),
            "monthly",
            "2026-06-01".parse().unwrap(),
            None,
        )
        .unwrap();
    store
        .create_recurring(
            "Annual Thing",
            None,
            "-1200.00".parse().unwrap(),
            "annual",
            "2026-06-01".parse().unwrap(),
            None,
        )
        .unwrap();

    let totals = store.recurring_totals().unwrap();

    // Monthly: 12*(52/12) + 24*(26/12) + 100 + 1200*(1/12) = 52 + 52 + 100 + 100 = 304
    assert_eq!(totals.monthly_expense, "304.00".parse().unwrap());
    // Annual: 12*52 + 24*26 + 100*12 + 1200 = 624 + 624 + 1200 + 1200 = 3648
    assert_eq!(totals.annual_expense, "3648.00".parse().unwrap());
    assert_eq!(totals.monthly_income, Decimal::ZERO);
    assert_eq!(totals.annual_income, Decimal::ZERO);
}

#[test]
fn recurring_totals_treats_income_and_expense_symmetrically_across_cadences() {
    // Regression test for a client-side bug found during review: an
    // earlier version only normalized non-monthly cadences for
    // *income*, silently dropping weekly/biweekly/annual *expenses*
    // from the displayed monthly total entirely. A weekly expense and
    // a weekly income of the same magnitude must normalize to the same
    // monthly figure (just opposite sign/bucket).
    let store = Store::open_in_memory().unwrap();
    store
        .create_recurring(
            "Weekly Expense",
            None,
            "-12.00".parse().unwrap(),
            "weekly",
            "2026-06-01".parse().unwrap(),
            None,
        )
        .unwrap();
    store
        .create_recurring(
            "Weekly Income",
            None,
            "12.00".parse().unwrap(),
            "weekly",
            "2026-06-08".parse().unwrap(),
            None,
        )
        .unwrap();

    let totals = store.recurring_totals().unwrap();

    assert_eq!(totals.monthly_expense, totals.monthly_income);
    assert_eq!(totals.annual_expense, totals.annual_income);
}

#[test]
fn update_recurring_changes_every_field() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let id = store
        .create_recurring("Netflix", None, "-15.49".parse().unwrap(), "monthly", "2026-06-04".parse().unwrap(), None)
        .unwrap();

    store
        .update_recurring(
            id,
            "Netflix (renamed)",
            Some("Subscriptions"),
            "-18.99".parse().unwrap(),
            "annual",
            "2026-07-01".parse().unwrap(),
            Some(checking),
        )
        .unwrap();

    let items = store.list_recurring("2026-08-20".parse().unwrap()).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].merchant, "Netflix (renamed)");
    assert_eq!(items[0].category, Some("Subscriptions".to_string()));
    assert_eq!(items[0].amount, "-18.99".parse().unwrap());
    assert_eq!(items[0].cadence, "annual");
    assert_eq!(items[0].anchor_date, "2026-07-01".parse().unwrap());
    assert_eq!(items[0].account_name, Some("Checking".to_string()));
}

#[test]
fn update_recurring_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store
        .update_recurring(
            999,
            "Ghost",
            None,
            "-1.00".parse().unwrap(),
            "monthly",
            "2026-08-20".parse().unwrap(),
            None,
        )
        .unwrap();
}

fn seed_txns(store: &Store, account: i64, merchant: &str, amount: &str, dates: &[&str]) {
    for date in dates {
        store.save_transactions(account, &[tx(date, merchant, amount)]).unwrap();
    }
}

#[test]
fn detect_recurring_candidates_finds_a_monthly_pattern() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    seed_txns(
        &store,
        account,
        "Netflix",
        "-15.49",
        &["2026-05-04", "2026-06-04", "2026-07-04", "2026-08-04"],
    );

    let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].merchant, "Netflix");
    assert_eq!(candidates[0].amount, "-15.49".parse().unwrap());
    assert_eq!(candidates[0].cadence, "monthly");
    assert_eq!(candidates[0].occurrence_count, 4);
    assert_eq!(candidates[0].anchor_date, "2026-08-04".parse().unwrap());
}

#[test]
fn detect_recurring_candidates_classifies_a_biweekly_pattern() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    seed_txns(&store, account, "Cleaning Service", "-60.00", &["2026-06-05", "2026-06-19", "2026-07-03"]);

    let candidates = store.detect_recurring_candidates("2026-07-10".parse().unwrap()).unwrap();

    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].cadence, "biweekly");
}

#[test]
fn detect_recurring_candidates_skips_a_pattern_that_looks_stopped() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    seed_txns(&store, account, "Old Gym", "-40.00", &["2026-01-04", "2026-02-04", "2026-03-04"]);

    // Monthly cadence, but the most recent charge was ~5.5 months before
    // "today" — well past 2x the ~30-day cadence, so this reads as a
    // cancelled subscription rather than an active one.
    let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

    assert!(candidates.is_empty());
}

#[test]
fn detect_recurring_candidates_ignores_irregular_gaps() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    seed_txns(&store, account, "Random Store", "-20.00", &["2026-01-05", "2026-03-20", "2026-08-01"]);

    let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

    assert!(candidates.is_empty());
}

#[test]
fn detect_recurring_candidates_requires_at_least_three_occurrences() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    seed_txns(&store, account, "Gym", "-40.00", &["2026-06-01", "2026-07-01"]);

    let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

    assert!(candidates.is_empty());
}

#[test]
fn detect_recurring_candidates_excludes_a_merchant_already_tracked_as_recurring() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    seed_txns(&store, account, "Netflix", "-15.49", &["2026-05-04", "2026-06-04", "2026-07-04"]);
    store
        .create_recurring("Netflix", None, "-15.49".parse().unwrap(), "monthly", "2026-07-04".parse().unwrap(), None)
        .unwrap();

    let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

    assert!(candidates.is_empty());
}

#[test]
fn detect_recurring_candidates_excludes_charges_a_tracked_merchant_already_covers() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    // Tracked as "Hulu"; the statement says "HULU 877-8244858" — the same bill
    // (recurring_matches pairs them), so it isn't offered a second time.
    seed_txns(&store, account, "HULU 877-8244858", "-14.99", &["2026-05-04", "2026-06-04", "2026-07-04"]);
    seed_txns(&store, account, "Spotify Premium", "-9.99", &["2026-05-06", "2026-06-06", "2026-07-06"]);
    store
        .create_recurring("Hulu", None, "-14.99".parse().unwrap(), "monthly", "2026-07-04".parse().unwrap(), None)
        .unwrap();

    let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

    assert_eq!(
        candidates.iter().map(|c| c.merchant.as_str()).collect::<Vec<_>>(),
        vec!["Spotify Premium"]
    );
}

#[test]
fn detect_recurring_candidates_keeps_income_when_only_an_expense_merchant_is_tracked() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    // Same name, opposite direction: a refund pattern isn't the tracked bill.
    seed_txns(
        &store,
        account,
        "Hulu Refund Credit",
        "14.99",
        &["2026-05-04", "2026-06-04", "2026-07-04"],
    );
    store
        .create_recurring("Hulu", None, "-14.99".parse().unwrap(), "monthly", "2026-07-04".parse().unwrap(), None)
        .unwrap();

    let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

    assert_eq!(candidates.len(), 1);
}

#[test]
fn dismiss_recurring_candidate_excludes_it_from_future_detection() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    seed_txns(&store, account, "Spotify", "-9.99", &["2026-05-04", "2026-06-04", "2026-07-04"]);
    assert_eq!(store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap().len(), 1);

    store.dismiss_recurring_candidate("Spotify", "-9.99".parse().unwrap(), "monthly").unwrap();

    assert!(store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap().is_empty());
}

#[test]
fn detect_recurring_candidates_infers_the_majority_category() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    for (date, category) in [
        ("2026-05-04", "Subscriptions"),
        ("2026-06-04", "Subscriptions"),
        ("2026-07-04", "Entertainment"),
    ] {
        let mut t = tx(date, "Netflix", "-15.49");
        t.category = Some(category.to_string());
        store.save_transactions(account, &[t]).unwrap();
    }

    let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

    assert_eq!(candidates[0].category, Some("Subscriptions".to_string()));
}

#[test]
fn detect_recurring_candidates_skips_a_transfer_pattern() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    for date in ["2026-05-02", "2026-06-02", "2026-07-02", "2026-08-02"] {
        store
            .save_transactions(
                account,
                &[Transaction {
                    category: Some("Transfer".to_string()),
                    ..tx(date, "Transfer to Savings", "-500.00")
                }],
            )
            .unwrap();
    }
    seed_txns(
        &store,
        account,
        "Netflix",
        "-15.49",
        &["2026-05-04", "2026-06-04", "2026-07-04", "2026-08-04"],
    );

    let candidates = store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap();

    assert_eq!(candidates.len(), 1, "only Netflix -- moving money between your own accounts isn't a bill");
    assert_eq!(candidates[0].merchant, "Netflix");
}

#[test]
fn a_linked_pair_is_not_suggested_as_a_recurring_bill_or_flagged_as_unusually_large() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = checking_and_savings(&store);
    let mut ids = Vec::new();
    for date in ["2026-05-02", "2026-06-02", "2026-07-02", "2026-08-02"] {
        store.save_transactions(checking, &[tx(date, "Auto Savings Move", "-250.00")]).unwrap();
        store.save_transactions(savings, &[tx(date, "Incoming Move", "250.00")]).unwrap();
        ids.push((id_of(&store, "Auto Savings Move", date), id_of(&store, "Incoming Move", date)));
    }
    assert!(
        !store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap().is_empty(),
        "unlinked, the repeating move looks like a bill"
    );

    for (out_id, in_id) in ids {
        store.link_transfer(out_id, in_id).unwrap();
    }

    assert!(store.detect_recurring_candidates("2026-08-20".parse().unwrap()).unwrap().is_empty());
}

#[test]
fn a_repeating_paycheck_lifts_the_balance_each_time_it_lands_in_the_horizon() {
    let store = Store::open_in_memory().unwrap();
    let account = checking_with_balance(&store, "3000.00");
    store
        .create_recurring(
            "Payroll Deposit",
            Some("Income"),
            "2000.00".parse().unwrap(),
            "biweekly",
            "2026-09-23".parse().unwrap(),
            Some(account),
        )
        .unwrap();

    let forecast = store.bill_aware_forecast(forecast_today(), 30).unwrap();

    assert_eq!(balance_on(&forecast, "2026-09-22"), "3000.00".parse().unwrap());
    assert_eq!(balance_on(&forecast, "2026-09-23"), "5000.00".parse().unwrap());
    assert_eq!(balance_on(&forecast, "2026-10-07"), "7000.00".parse().unwrap());
    assert_eq!(forecast.events.len(), 2, "09-23 and 10-07; the next one (10-21) is past the horizon");
}

#[test]
fn a_canceled_recurring_item_is_left_out_of_the_forecast() {
    let store = Store::open_in_memory().unwrap();
    let account = checking_with_balance(&store, "3000.00");
    let id = store
        .create_recurring(
            "Old Gym",
            None,
            "-50.00".parse().unwrap(),
            "monthly",
            "2026-09-25".parse().unwrap(),
            Some(account),
        )
        .unwrap();
    store.set_recurring_status(id, "canceled").unwrap();

    let forecast = store.bill_aware_forecast(forecast_today(), 30).unwrap();

    assert!(!forecast.uses_recurring, "nothing active left, so it falls back to the trend");
    assert!(forecast.events.is_empty());
}

#[test]
fn a_bill_due_today_is_taken_out_of_todays_balance() {
    let store = Store::open_in_memory().unwrap();
    let account = checking_with_balance(&store, "3000.00");
    store
        .create_recurring(
            "Union Realty",
            Some("Rent"),
            "-1000.00".parse().unwrap(),
            "monthly",
            forecast_today(),
            Some(account),
        )
        .unwrap();

    let forecast = store.bill_aware_forecast(forecast_today(), 7).unwrap();

    assert_eq!(forecast.points[0].balance, "2000.00".parse().unwrap());
    assert_eq!(
        forecast.start_balance,
        "3000.00".parse().unwrap(),
        "the start is what's in the accounts right now"
    );
}

#[test]
fn everyday_spending_is_projected_from_history_but_ignores_recurring_merchants_and_transfers() {
    let store = Store::open_in_memory().unwrap();
    let account = checking_with_balance(&store, "5000.00");
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-19", "Payroll Deposit", "2000.00"), // a recurring paycheck: not baseline
                tx("2026-08-29", "Grocery Run", "-900.00"),     // genuine everyday spending
                Transaction {
                    category: Some("Transfer".to_string()),
                    ..tx("2026-09-08", "Move to savings", "-500.00")
                },
            ],
        )
        .unwrap();
    // Recurring paycheck lands well outside the horizon, so only its
    // *matching* effect on the baseline is under test here.
    store
        .create_recurring(
            "Payroll Deposit",
            Some("Income"),
            "2000.00".parse().unwrap(),
            "monthly",
            "2026-12-01".parse().unwrap(),
            Some(account),
        )
        .unwrap();

    let forecast = store.bill_aware_forecast(forecast_today(), 10).unwrap();

    // 30 days of history (earliest transaction 2026-08-19): -900 / 30 = -30 a day.
    assert_eq!(forecast.daily_baseline, "-30".parse().unwrap());
    let start = forecast.start_balance;
    assert_eq!(start, "5600.00".parse().unwrap()); // 5000 + 2000 - 900 - 500
    assert_eq!(balance_on(&forecast, "2026-09-28"), start - Decimal::from(300));
}

#[test]
fn linked_transfers_are_not_everyday_spending() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = checking_and_savings(&store);
    store.set_account_starting_balance(checking, "5000.00".parse().unwrap()).unwrap();
    store
        .save_transactions(checking, &[tx("2026-08-19", "Move to savings", "-500.00")])
        .unwrap();
    store
        .save_transactions(savings, &[tx("2026-08-19", "Deposit from checking", "500.00")])
        .unwrap();
    store
        .create_recurring(
            "Netflix",
            None,
            "-15.00".parse().unwrap(),
            "monthly",
            "2026-12-01".parse().unwrap(),
            Some(checking),
        )
        .unwrap();
    let out_id = id_of(&store, "Move to savings", "2026-08-19");
    let in_id = id_of(&store, "Deposit from checking", "2026-08-19");
    store.link_transfer(out_id, in_id).unwrap();

    let forecast = store.bill_aware_forecast(forecast_today(), 10).unwrap();

    assert_eq!(forecast.daily_baseline, Decimal::ZERO);
}

#[test]
fn events_are_listed_in_date_order() {
    let store = Store::open_in_memory().unwrap();
    let account = checking_with_balance(&store, "1000.00");
    store
        .create_recurring(
            "Payroll Deposit",
            None,
            "2000.00".parse().unwrap(),
            "monthly",
            "2026-10-01".parse().unwrap(),
            Some(account),
        )
        .unwrap();
    store
        .create_recurring(
            "Union Realty",
            None,
            "-1000.00".parse().unwrap(),
            "monthly",
            "2026-09-28".parse().unwrap(),
            Some(account),
        )
        .unwrap();
    store
        .create_recurring(
            "Geico Auto",
            None,
            "-175.00".parse().unwrap(),
            "monthly",
            "2026-09-20".parse().unwrap(),
            Some(account),
        )
        .unwrap();

    let forecast = store.bill_aware_forecast(forecast_today(), 30).unwrap();

    let labels: Vec<&str> = forecast.events.iter().map(|e| e.label.as_str()).collect();
    // Geico's next one (10-20) is past the 10-18 horizon.
    assert_eq!(labels, vec!["Geico Auto", "Union Realty", "Payroll Deposit"]);
}

fn match_for(store: &Store, today: &str, recurring_id: i64) -> RecurringMatch {
    store
        .recurring_matches(day(today))
        .unwrap()
        .into_iter()
        .find(|m| m.recurring_id == recurring_id)
        .expect("a match row for the recurring item")
}

#[test]
fn a_bill_with_a_charge_near_its_due_date_is_paid() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = netflix_with(
        &store,
        account,
        "-15.49",
        &[("2026-07-03", "-15.49"), ("2026-08-03", "-15.49"), ("2026-09-03", "-15.49")],
    );

    let m = match_for(&store, "2026-09-05", id);

    assert_eq!(m.state, "paid");
    assert_eq!(m.last_due, Some(day("2026-09-03")));
    assert_eq!(m.last_paid_date, Some(day("2026-09-03")));
    assert_eq!(m.last_paid_amount, Some(dec("-15.49")));
}

#[test]
fn a_charge_that_posts_a_few_days_late_still_counts() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = netflix_with(&store, account, "-15.49", &[("2026-08-03", "-15.49"), ("2026-09-06", "-15.49")]);

    assert_eq!(match_for(&store, "2026-09-10", id).state, "paid");
}

#[test]
fn a_bill_past_due_with_no_charge_yet_is_pending_inside_the_grace_period() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = netflix_with(&store, account, "-15.49", &[("2026-07-03", "-15.49"), ("2026-08-03", "-15.49")]);

    let m = match_for(&store, "2026-09-05", id);

    assert_eq!(m.state, "pending");
    assert_eq!(m.last_due, Some(day("2026-09-03")));
    assert_eq!(m.last_paid_date, Some(day("2026-08-03")));
}

#[test]
fn a_bill_well_past_due_with_no_charge_is_missed() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = netflix_with(&store, account, "-15.49", &[("2026-07-03", "-15.49"), ("2026-08-03", "-15.49")]);

    assert_eq!(match_for(&store, "2026-09-20", id).state, "missed");
}

#[test]
fn an_item_with_no_matching_charge_ever_is_unmatched_not_missed() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = netflix_with(&store, account, "-15.49", &[]);
    store.save_transactions(account, &[tx("2026-08-03", "Kroger", "-40.00")]).unwrap();

    let m = match_for(&store, "2026-09-20", id);

    assert_eq!(m.state, "unmatched");
    assert_eq!(m.last_paid_date, None);
}

#[test]
fn an_item_that_has_not_started_yet_is_upcoming() {
    let store = Store::open_in_memory().unwrap();
    let id = store
        .create_recurring("Gym", None, dec("-30"), "monthly", day("2026-10-01"), None)
        .unwrap();

    let m = match_for(&store, "2026-09-18", id);

    assert_eq!(m.state, "upcoming");
    assert_eq!(m.last_due, None);
}

#[test]
fn income_with_the_same_name_does_not_match_a_bill() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = netflix_with(&store, account, "-15.49", &[]);
    store
        .save_transactions(account, &[tx("2026-09-03", "NETFLIX.COM refund", "15.49")])
        .unwrap();

    assert_eq!(match_for(&store, "2026-09-05", id).state, "unmatched");
}

#[test]
fn a_deleted_charge_does_not_count_as_paid() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = netflix_with(&store, account, "-15.49", &[("2026-08-03", "-15.49"), ("2026-09-03", "-15.49")]);
    let tx_id = id_of(&store, "NETFLIX.COM 866-579", "2026-09-03");
    store.delete_transaction(tx_id, test_now()).unwrap();

    assert_eq!(match_for(&store, "2026-09-05", id).state, "pending");
}

#[test]
fn a_price_increase_after_a_steady_run_is_flagged() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = netflix_with(
        &store,
        account,
        "-15.49",
        &[
            ("2026-06-03", "-15.49"),
            ("2026-07-03", "-15.49"),
            ("2026-08-03", "-15.49"),
            ("2026-09-03", "-17.99"),
        ],
    );

    let change = match_for(&store, "2026-09-05", id).price_change.expect("a price change");

    assert_eq!(change.from, dec("-15.49"));
    assert_eq!(change.to, dec("-17.99"));
}

#[test]
fn a_steady_price_is_not_flagged() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = netflix_with(
        &store,
        account,
        "-15.49",
        &[("2026-07-03", "-15.49"), ("2026-08-03", "-15.49"), ("2026-09-03", "-15.49")],
    );

    assert!(match_for(&store, "2026-09-05", id).price_change.is_none());
}

#[test]
fn a_bill_that_varies_every_month_is_never_flagged() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = store
        .create_recurring("City Power", None, dec("-90"), "monthly", day("2026-06-03"), None)
        .unwrap();
    for (date, amount) in [
        ("2026-06-03", "-80.00"),
        ("2026-07-03", "-95.00"),
        ("2026-08-03", "-70.00"),
        ("2026-09-03", "-88.00"),
    ] {
        store.save_transactions(account, &[tx(date, "CITY POWER & LIGHT", amount)]).unwrap();
    }

    assert!(match_for(&store, "2026-09-05", id).price_change.is_none());
}

#[test]
fn a_single_charge_is_compared_against_the_amount_on_file() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = netflix_with(&store, account, "-15.49", &[("2026-09-03", "-17.99")]);

    let change = match_for(&store, "2026-09-05", id).price_change.expect("a price change");

    assert_eq!((change.from, change.to), (dec("-15.49"), dec("-17.99")));
}

#[test]
fn ignored_recurring_price_change_keeps_amount_and_allows_a_different_change() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = netflix_with(&store, account, "-15.49", &[("2026-09-03", "-17.99")]);
    store.dismiss_recurring_price_change(id, dec("-15.490"), dec("-17.990")).unwrap();
    store.dismiss_recurring_price_change(id, dec("-15.49"), dec("-17.99")).unwrap();
    let result = match_for(&store, "2026-09-05", id);
    assert!(result.price_change.is_none());
    assert_eq!(result.state, "paid");
    assert_eq!(
        store
            .list_recurring(day("2026-09-05"))
            .unwrap()
            .iter()
            .find(|r| r.id == id)
            .unwrap()
            .amount,
        dec("-15.49")
    );

    // Another recurring item is not silenced by the same ignored amounts.
    let other = store
        .create_recurring("NETFLIX", None, dec("-15.49"), "monthly", day("2026-09-03"), None)
        .unwrap();
    assert!(match_for(&store, "2026-09-05", other).price_change.is_some());
    store
        .save_transactions(account, &[tx("2026-10-03", "NETFLIX.COM 866-579", "-19.99")])
        .unwrap();
    assert_eq!(match_for(&store, "2026-10-05", id).price_change.unwrap().to, dec("-19.99"));
}

#[test]
fn a_trivial_difference_is_not_a_price_change() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = netflix_with(&store, account, "-15.49", &[("2026-08-03", "-15.49"), ("2026-09-03", "-15.50")]);

    assert!(match_for(&store, "2026-09-05", id).price_change.is_none());
}

#[test]
fn a_blank_merchant_never_matches_everything() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = store.create_recurring("", None, dec("-10"), "monthly", day("2026-06-03"), None).unwrap();
    store
        .save_transactions(account, &[tx("2026-09-03", "Anything at all", "-10.00")])
        .unwrap();

    assert_eq!(match_for(&store, "2026-09-05", id).state, "unmatched");
}

#[test]
fn reminders_cover_bills_due_within_the_window_and_nothing_further_out() {
    let store = Store::open_in_memory().unwrap();
    bill(&store, "Geico Auto", "-120.00", "2026-09-20"); // due in 2 days
    bill(&store, "Netflix", "-15.49", "2026-09-30"); // 12 days
    bill(&store, "Rent", "-1200.00", "2026-09-18"); // today

    assert_eq!(reminder_names(&store, "2026-09-18", 3), vec!["Rent", "Geico Auto"]);
}

#[test]
fn income_and_canceled_items_are_never_reminded() {
    let store = Store::open_in_memory().unwrap();
    bill(&store, "Payroll", "3000.00", "2026-09-19");
    let gym = bill(&store, "Old Gym", "-30.00", "2026-09-19");
    store.set_recurring_status(gym, "canceled").unwrap();

    assert!(reminder_names(&store, "2026-09-18", 3).is_empty());
}

#[test]
fn a_zero_day_window_reminds_only_about_bills_due_today() {
    let store = Store::open_in_memory().unwrap();
    bill(&store, "Rent", "-1200.00", "2026-09-18");
    bill(&store, "Geico Auto", "-120.00", "2026-09-19");

    assert_eq!(reminder_names(&store, "2026-09-18", 0), vec!["Rent"]);
}
