use super::*;

// Transaction notes — freeform per-transaction annotations, never used
// for categorization, transfer matching, or the import fingerprint.

#[test]
fn saves_and_reads_back_transactions() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let txns = vec![
        tx("2026-08-20", "Union Realty", "-1850.00"),
        tx("2026-08-26", "Payroll Deposit", "3120.00"),
    ];

    let report = store.save_transactions(account, &txns).unwrap();
    assert_eq!(report.inserted, 2);

    let stored = store.all_transactions().unwrap();
    assert_eq!(stored.len(), 2);
    assert_eq!(stored[0].transaction.description, "Union Realty");
    assert_eq!(stored[1].transaction.amount, "3120.00".parse().unwrap());
}

#[test]
fn save_transactions_with_ids_returns_each_rows_new_id_in_order() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let txns = vec![
        tx("2026-08-20", "Union Realty", "-1850.00"),
        tx("2026-08-26", "Payroll Deposit", "3120.00"),
    ];

    let ids = store.save_transactions_with_ids(account, &txns).unwrap();

    assert_eq!(ids.len(), 2);
    assert_ne!(ids[0], ids[1]);
    let stored = store.all_transactions().unwrap();
    assert_eq!(stored.iter().find(|s| s.id == ids[0]).unwrap().transaction.description, "Union Realty");
    assert_eq!(stored.iter().find(|s| s.id == ids[1]).unwrap().transaction.description, "Payroll Deposit");
}

// Regression test for a real O(n²) bug: `save_transactions_with_ids`
// used to recompute a full `account_balance_as_of` scan of the account
// before *and* after every single row it inserted, purely to build a
// debug-only log line that's discarded unread whenever there's no
// activity log path (every release build, and this in-memory test
// store — see `Store::open`/`log_activity`). Importing N transactions
// into an account that already has many cost O(N × existing-count),
// not O(N) — a large CSV import into a well-used account measurably
// took minutes instead of seconds. 2,000 sequential inserts into one
// account, even in an unoptimized debug test binary, must stay well
// under a second if the per-row cost is genuinely O(1); the generous
// 5s ceiling only exists to keep this non-flaky on a loaded CI box —
// a reintroduced quadratic scan here would blow far past it, not
// brush up against it.
#[test]
fn saving_many_transactions_into_one_account_does_not_cost_quadratic_time() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let txns: Vec<Transaction> = (0..2000).map(|i| tx("2026-01-01", &format!("Transaction {i}"), "-10.00")).collect();

    let start = std::time::Instant::now();
    let ids = store.save_transactions_with_ids(account, &txns).unwrap();
    let elapsed = start.elapsed();

    assert_eq!(ids.len(), 2000);
    assert!(elapsed.as_secs() < 5, "saving 2000 transactions took {elapsed:?} — looks quadratic again");
}

#[test]
fn check_duplicates_flags_a_transaction_already_saved_in_this_account() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let txns = vec![tx("2026-08-20", "Union Realty", "-1850.00")];
    store.save_transactions(account, &txns).unwrap();

    let flags = store.check_duplicates(account, &txns).unwrap();

    assert_eq!(flags, vec![true]);
}

#[test]
fn check_duplicates_distinguishes_new_from_already_seen_in_an_overlapping_batch() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-20", "Union Realty", "-1850.00")]).unwrap();

    let second_batch = vec![
        tx("2026-08-20", "Union Realty", "-1850.00"),     // already saved
        tx("2026-08-21", "Green Leaf Grocers", "-86.42"), // new
    ];
    let flags = store.check_duplicates(account, &second_batch).unwrap();

    assert_eq!(flags, vec![true, false]);
}

#[test]
fn save_transactions_inserts_a_flagged_duplicate_when_asked() {
    // Proves the safety valve genuinely works: the caller can choose to
    // keep a row `check_duplicates` flagged, rather than dedup being
    // silently enforced regardless of what the user wants.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let txns = vec![tx("2026-08-20", "Union Realty", "-1850.00")];

    store.save_transactions(account, &txns).unwrap();
    let second = store.save_transactions(account, &txns).unwrap();

    assert_eq!(second.inserted, 1);
    assert_eq!(store.all_transactions().unwrap().len(), 2);
}

#[test]
fn persists_to_disk_across_reopen() {
    let dir = std::env::temp_dir().join(format!("meadow-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("test.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }

    {
        let store = Store::open(&db_path).unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-20", "Union Realty", "-1850.00")]).unwrap();
    } // store (and its connection) dropped here

    let reopened = Store::open(&db_path).unwrap();
    assert_eq!(reopened.all_transactions().unwrap().len(), 1);
    drop(reopened); // release the file handle before cleanup — Windows can't delete an open file

    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn backup_to_copies_every_row_to_a_new_file() {
    let dir = std::env::temp_dir().join(format!("vaultspend-backup-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let source_path = dir.join("source.db");
    let dest_path = dir.join("dest.db");
    for p in [&source_path, &dest_path] {
        if p.exists() {
            std::fs::remove_file(p).unwrap();
        }
    }

    {
        let store = Store::open(&source_path).unwrap();
        let account = test_account(&store);
        store.save_transactions(account, &[tx("2026-08-20", "Union Realty", "-1850.00")]).unwrap();
        store.backup_to(&dest_path).unwrap();
    } // source store dropped here

    let restored = Store::open(&dest_path).unwrap();
    let stored = restored.all_transactions().unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].transaction.description, "Union Realty");
    drop(restored);

    std::fs::remove_file(&source_path).unwrap();
    std::fs::remove_file(&dest_path).unwrap();
}

#[test]
fn opening_a_pre_accounts_database_migrates_it_without_losing_data() {
    // Simulates a real database created before Step 11 added accounts:
    // a `transactions` table with no `account_id` column at all.
    let dir = std::env::temp_dir().join(format!("meadow-migration-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("pre_accounts.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }

    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    category TEXT,
                    category_source TEXT,
                    fingerprint TEXT NOT NULL UNIQUE
                );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO transactions (date, description, amount, fingerprint)
                 VALUES ('2026-08-20', 'Union Realty', '-1850.00', 'old-fingerprint')",
            [],
        )
        .unwrap();
    } // old-style connection dropped here

    let store = Store::open(&db_path).unwrap();
    let stored = store.all_transactions().unwrap();

    assert_eq!(stored.len(), 1, "the pre-existing transaction must survive the migration");
    assert_eq!(stored[0].transaction.description, "Union Realty");
    assert!(
        !stored[0].account_name.is_empty(),
        "it should land in some fallback account, not be orphaned"
    );

    drop(store);
    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn user_can_correct_a_transactions_category() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;

    store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();

    let stored = store.all_transactions().unwrap();
    assert_eq!(stored[0].transaction.category, Some("Dining Out".to_string()));
    assert_eq!(stored[0].category_source, Some(CategorySource::User));
}

#[test]
fn correcting_again_overwrites_the_previous_category() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;

    store.set_category(id, "Groceries", CategorySource::Rule, None).unwrap();
    store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();

    let stored = store.all_transactions().unwrap();
    assert_eq!(stored[0].transaction.category, Some("Dining Out".to_string()));
    assert_eq!(stored[0].category_source, Some(CategorySource::User));
}

#[test]
fn a_classifiers_confidence_is_persisted_and_read_back() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Mystery Merchant", "-10.00")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;

    store.set_category(id, "Groceries", CategorySource::Classifier, Some(0.73)).unwrap();

    let stored = store.all_transactions().unwrap();
    assert_eq!(stored[0].confidence, Some(0.73));
}

#[test]
fn a_rule_or_user_categorization_has_no_confidence() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;

    store.set_category(id, "Dining Out", CategorySource::Rule, None).unwrap();

    assert_eq!(store.all_transactions().unwrap()[0].confidence, None);
}

#[test]
fn a_transactions_own_category_column_is_registered_immediately_on_import() {
    // The low-level insert: a category on a transaction handed to
    // `save_transactions` lands on the row and is registered right away, no
    // restart needed. This is NOT what stops an import adopting a bank's own
    // "Category" column ("Merchandise", ...) — `commit_import` settles those first
    // (`budget_core::import_resolution`), so only categories the person has (or
    // chose to add) ever reach this insert.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let mut imported = tx("2026-09-02", "HOMEDEPOT.COM", "-1056.37");
    imported.category = Some("Merchandise".to_string());

    store.save_transactions(account, &[imported]).unwrap();

    assert!(store.list_categories().unwrap().contains(&"Merchandise".to_string()));
}

#[test]
fn assigning_a_brand_new_category_to_a_transaction_registers_it_for_every_other_row() {
    // The original bug this guards against: typing a new category for
    // one transaction didn't make it selectable for any other one.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;

    store.set_category(id, "Health", CategorySource::User, None).unwrap();

    assert!(store.list_categories().unwrap().contains(&"Health".to_string()));
}

#[test]
fn transactions_by_ids_returns_exactly_those_rows_as_the_full_ledger_shows_them() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-01", "A", "-1.00"),
                tx("2026-08-02", "B", "-2.00"),
                tx("2026-08-03", "C", "-3.00"),
            ],
        )
        .unwrap();
    let all = store.all_transactions().unwrap();
    let (a, c) = (all[0].id, all[2].id);
    store.add_tag(a, "coffee").unwrap();
    store.delete_transaction(all[1].id, "2026-08-09T00:00:00".parse().unwrap()).unwrap();

    let some = store.transactions_by_ids(&[c, a, all[1].id, 9999]).unwrap();
    let full = store.all_transactions().unwrap();
    assert_eq!(
        some.iter().map(|t| t.id).collect::<Vec<_>>(),
        vec![a, c],
        "ordered by id; deleted and unknown ids left out"
    );
    assert_eq!(&some[0], full.iter().find(|t| t.id == a).unwrap(), "same fields as the full ledger");
    assert_eq!(some[0].tags, vec!["coffee".to_string()]);
    assert!(store.transactions_by_ids(&[]).unwrap().is_empty());
}

#[test]
fn category_counts_and_description_lookup_match_the_full_ledger() {
    // get_stats and correct_category used to load every transaction (0.4 s each at 50,000 rows,
    // 2026-10-02 QA, M1). Their narrow queries must see exactly the rows all_transactions lists.
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let loan = store.create_account("Car Loan", AccountType::Loan).unwrap().unwrap();
    store
        .save_transactions(
            checking,
            &[
                tx("2026-08-01", "Corner Coffee", "-4.75"),
                tx("2026-08-02", "Grocer", "-60.00"),
                tx("2026-08-03", "Mystery", "-9.00"),
                tx("2026-08-04", "Payroll", "2000.00"),
                tx("2026-08-05", "Loan payment", "-300.00"),
                tx("2026-08-06", "Deleted one", "-1.00"),
            ],
        )
        .unwrap();
    let id = |d: &str| {
        store
            .all_transactions()
            .unwrap()
            .into_iter()
            .find(|t| t.transaction.description == d)
            .unwrap()
            .id
    };
    store.set_category(id("Corner Coffee"), "Dining Out", CategorySource::User, None).unwrap();
    store.set_category(id("Grocer"), "Groceries", CategorySource::Rule, None).unwrap();
    store
        .set_category(id("Payroll"), "Income", CategorySource::Classifier, Some(0.9))
        .unwrap();
    store
        .conn
        .execute("UPDATE transactions SET category = 'Imported' WHERE id = ?1", params![id("Loan payment")])
        .unwrap();
    store
        .apply_debt_payment(id("Loan payment"), loan, "300.00".parse().unwrap(), "2026-08-05".parse().unwrap())
        .unwrap();
    let deleted = id("Deleted one");
    store.delete_transaction(deleted, "2026-08-07T00:00:00".parse().unwrap()).unwrap();

    let all = store.all_transactions().unwrap();
    let expected = CategoryCounts {
        total: all.len(),
        uncategorized: all.iter().filter(|t| t.transaction.category.is_none()).count(),
        user_confirmed: all
            .iter()
            .filter(|t| t.transaction.category.is_some() && t.category_source == Some(CategorySource::User))
            .count(),
        auto_categorized: all
            .iter()
            .filter(|t| t.transaction.category.is_some() && t.category_source != Some(CategorySource::User))
            .count(),
    };
    assert_eq!(store.category_counts().unwrap(), expected);
    assert_eq!(expected.total, 5, "the deleted row and the debt payment's generated row are left out");

    assert_eq!(store.transaction_description(id("Grocer")).unwrap().as_deref(), Some("Grocer"));
    assert_eq!(store.transaction_description(deleted).unwrap(), None, "a deleted transaction isn't found");
    assert_eq!(store.transaction_description(9999).unwrap(), None);
}

#[test]
fn delete_account_holding_the_source_of_a_debt_payment_also_removes_the_generated_transaction() {
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")]).unwrap();
    let source_id = store.all_transactions().unwrap()[0].id;
    store
        .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
        .unwrap();
    assert_eq!(raw_transaction_count(&store), 2);

    store.delete_account(checking).unwrap();

    assert_eq!(raw_transaction_count(&store), 0, "the generated debt-account transaction must go too");
}

#[test]
fn delete_family_member_nulls_member_id_on_the_transactions_it_owns() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let checking = test_account(&store);
    store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();
    let transaction_id = store.all_transactions().unwrap()[0].id;
    store.set_transaction_member(transaction_id, Some(member)).unwrap();

    store.delete_family_member(member).unwrap();

    assert_eq!(store.all_transactions().unwrap()[0].member_id, None);
}

#[test]
fn save_transactions_leaves_member_null_when_the_account_has_none() {
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);

    store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();

    assert_eq!(store.all_transactions().unwrap()[0].member_id, None);
}

#[test]
fn create_transaction_returns_the_new_rows_id() {
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);

    let id = store.create_transaction(checking, &tx("2026-08-01", "Cash tip", "-20.00"), None).unwrap();

    let all = store.all_transactions().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, id);
    assert_eq!(all[0].transaction.description, "Cash tip");
}

#[test]
fn set_transaction_member_assigns_and_clears_a_member() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let checking = test_account(&store);
    store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();
    let transaction_id = store.all_transactions().unwrap()[0].id;

    store.set_transaction_member(transaction_id, Some(member)).unwrap();
    assert_eq!(store.all_transactions().unwrap()[0].member_id, Some(member));

    store.set_transaction_member(transaction_id, None).unwrap();
    assert_eq!(store.all_transactions().unwrap()[0].member_id, None);
}

#[test]
fn bulk_set_transaction_member_applies_to_every_id_given() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let checking = test_account(&store);
    store
        .save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00"), tx("2026-08-02", "Gas", "-40.00")])
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();

    store.bulk_set_transaction_member(&ids, Some(member)).unwrap();

    let all = store.all_transactions().unwrap();
    assert!(all.iter().all(|t| t.member_id == Some(member)));
}

#[test]
fn all_transactions_includes_its_members_name() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let checking = test_account(&store);
    store.save_transactions(checking, &[tx("2026-08-01", "Groceries", "-50.00")]).unwrap();
    let transaction_id = store.all_transactions().unwrap()[0].id;
    store.set_transaction_member(transaction_id, Some(member)).unwrap();

    let transactions = store.all_transactions().unwrap();

    assert_eq!(transactions[0].member_name, Some("Alex".to_string()));
}

#[test]
fn opening_a_pre_principal_amount_database_migrates_it_without_losing_data() {
    // Simulates a real database created before the loan
    // principal-override column existed: a `transactions` table with
    // no `principal_amount` column, already holding a real row.
    let dir = std::env::temp_dir().join(format!("vaultspend-principal-migration-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("pre_principal_amount.db");
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
                );
                CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id INTEGER NOT NULL,
                    date TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    category TEXT,
                    category_source TEXT,
                    confidence REAL,
                    fingerprint TEXT
                );",
        )
        .unwrap();
        conn.execute("INSERT INTO accounts (name, account_type) VALUES ('Everyday Checking', 'checking')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO transactions (account_id, date, description, amount) VALUES (1, '2026-08-05', 'Groceries', '-60.00')",
            [],
        )
        .unwrap();
    } // old-style connection dropped here

    let store = Store::open(&db_path).unwrap();
    let transactions = store.all_transactions().unwrap();

    assert_eq!(transactions.len(), 1, "the pre-existing transaction must survive the migration");
    assert_eq!(transactions[0].transaction.amount, "-60.00".parse().unwrap());
    assert_eq!(
        transactions[0].principal_amount, None,
        "a pre-existing row must default to no override, not a corrupted/garbage value"
    );

    drop(store);
    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn opening_a_pre_notes_database_migrates_it_twice_without_losing_data() {
    // Simulates a real database created before transaction notes
    // existed: no `notes` column, already holding a linked transfer
    // pair, a split, and a tag — every kind of data the migration must
    // not disturb.
    let dir = std::env::temp_dir().join(format!("vaultspend-notes-migration-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("pre_notes.db");
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
                );
                CREATE TABLE transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id INTEGER NOT NULL,
                    date TEXT NOT NULL,
                    description TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    category TEXT,
                    category_source TEXT,
                    confidence REAL,
                    fingerprint TEXT
                );
                CREATE TABLE transaction_splits (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    transaction_id INTEGER NOT NULL,
                    category TEXT,
                    amount TEXT NOT NULL,
                    note TEXT
                );
                CREATE TABLE transaction_tags (
                    transaction_id INTEGER NOT NULL,
                    tag TEXT NOT NULL COLLATE NOCASE,
                    PRIMARY KEY (transaction_id, tag)
                );
                CREATE TABLE transfer_links (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    out_transaction_id INTEGER NOT NULL UNIQUE,
                    in_transaction_id INTEGER NOT NULL UNIQUE,
                    auto INTEGER NOT NULL DEFAULT 0,
                    reviewed INTEGER NOT NULL DEFAULT 1
                );",
        )
        .unwrap();
        conn.execute("INSERT INTO accounts (name, account_type) VALUES ('Everyday Checking', 'checking')", [])
            .unwrap();
        conn.execute("INSERT INTO accounts (name, account_type) VALUES ('Savings', 'savings')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO transactions (account_id, date, description, amount, fingerprint) VALUES (1, '2026-08-05', 'Costco', '-150.00', 'fp-costco')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO transaction_splits (transaction_id, category, amount) VALUES (1, 'Groceries', '-100.00')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO transaction_tags (transaction_id, tag) VALUES (1, 'reimbursable')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO transactions (account_id, date, description, amount, fingerprint) VALUES (1, '2026-08-06', 'Move out', '-500.00', 'fp-out')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO transactions (account_id, date, description, amount, fingerprint) VALUES (2, '2026-08-06', 'Move in', '500.00', 'fp-in')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO transfer_links (out_transaction_id, in_transaction_id) VALUES (2, 3)", [])
            .unwrap();
    } // old-style connection dropped here

    let store = Store::open(&db_path).unwrap();
    drop(store);
    // Reopen a second time — the migration must be idempotent, not just survivable once.
    let store = Store::open(&db_path).unwrap();
    let transactions = store.all_transactions().unwrap();

    let costco = transactions.iter().find(|t| t.transaction.description == "Costco").unwrap();
    assert_eq!(costco.id, 1, "ids must survive the migration");
    assert_eq!(costco.transaction.amount, "-150.00".parse().unwrap());
    assert_eq!(costco.split_count, 1, "the split must survive");
    assert_eq!(costco.tags, vec!["reimbursable".to_string()], "the tag must survive");
    assert_eq!(
        costco.notes, None,
        "a pre-existing row must default to no note, not a corrupted/garbage value"
    );

    let move_out = transactions.iter().find(|t| t.transaction.description == "Move out").unwrap();
    assert!(move_out.transfer_counterpart_id.is_some(), "the transfer link must survive");

    drop(store);
    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn notes_validation_maps_empty_and_whitespace_to_null_and_trims() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = store.create_transaction(account, &tx("2026-08-05", "Coffee", "-4.50"), None).unwrap();

    for input in [Some(""), Some("   "), None] {
        store.update_transaction_notes(id, input).unwrap();
        assert_eq!(store.all_transactions().unwrap()[0].notes, None, "input {input:?} must store as NULL");
    }

    store.update_transaction_notes(id, Some("  padded on both sides  ")).unwrap();
    assert_eq!(store.all_transactions().unwrap()[0].notes, Some("padded on both sides".to_string()));
}

#[test]
fn notes_preserve_internal_newlines_exactly() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = store.create_transaction(account, &tx("2026-08-05", "Coffee", "-4.50"), None).unwrap();

    store.update_transaction_notes(id, Some("Receipt checked\nReimbursed by Sam")).unwrap();

    assert_eq!(
        store.all_transactions().unwrap()[0].notes,
        Some("Receipt checked\nReimbursed by Sam".to_string())
    );
}

#[test]
fn notes_at_exactly_the_limit_are_accepted_one_over_is_rejected_and_leaves_the_old_value() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = store.create_transaction(account, &tx("2026-08-05", "Coffee", "-4.50"), None).unwrap();
    let at_limit = "\u{e9}".repeat(NOTES_MAX_CHARS); // multi-byte char: proves this counts Unicode scalar values, not bytes
    store.update_transaction_notes(id, Some(&at_limit)).unwrap();
    assert_eq!(store.all_transactions().unwrap()[0].notes, Some(at_limit.clone()));

    let over_limit = "\u{e9}".repeat(NOTES_MAX_CHARS + 1);
    let result = store.update_transaction_notes(id, Some(&over_limit));

    assert!(result.is_err(), "one character over the limit must be rejected");
    assert_eq!(
        store.all_transactions().unwrap()[0].notes,
        Some(at_limit),
        "a rejected update must leave the old value untouched, not truncate"
    );
}

#[test]
fn update_transaction_notes_rejects_a_missing_or_deleted_transaction() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = store.create_transaction(account, &tx("2026-08-05", "Coffee", "-4.50"), None).unwrap();

    assert!(
        store.update_transaction_notes(999_999, Some("note")).is_err(),
        "an id that never existed must error"
    );

    store.delete_transaction(id, test_now()).unwrap();
    assert!(
        store.update_transaction_notes(id, Some("note")).is_err(),
        "a soft-deleted transaction must error, not silently succeed"
    );
}

#[test]
fn create_transaction_with_an_over_limit_note_creates_nothing_at_all() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let over_limit = "x".repeat(NOTES_MAX_CHARS + 1);

    let result = store.create_transaction(account, &tx("2026-08-05", "Coffee", "-4.50"), Some(&over_limit));

    assert!(result.is_err());
    assert!(
        store.all_transactions().unwrap().is_empty(),
        "the whole insert must roll back, not create a noteless row"
    );
}

#[test]
fn create_transaction_atomically_saves_the_note_with_the_row() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);

    let id = store
        .create_transaction(account, &tx("2026-08-05", "Coffee", "-4.50"), Some("Split with Jordan"))
        .unwrap();

    assert_eq!(store.all_transactions().unwrap()[0].id, id);
    assert_eq!(store.all_transactions().unwrap()[0].notes, Some("Split with Jordan".to_string()));
}

#[test]
fn notes_land_on_the_right_row_even_when_the_insert_also_registers_a_brand_new_category() {
    // Found by code review: create_transaction used to read
    // self.conn.last_insert_rowid() *after* calling save_transactions,
    // which — whenever the transaction's own category doesn't already
    // exist in the categories table — runs its own
    // "INSERT OR IGNORE INTO categories" right after the transaction
    // insert. last_insert_rowid() then returns the *category* table's
    // rowid, not the transaction's, and the note gets written onto
    // whatever transaction happens to already have that id (or onto
    // nothing at all).
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let mut with_new_category = tx("2026-08-05", "Coffee", "-4.50");
    with_new_category.category = Some("Brand New Category".to_string());

    let id = store.create_transaction(account, &with_new_category, Some("Split with Jordan")).unwrap();

    let saved = store.all_transactions().unwrap();
    assert_eq!(saved.len(), 1, "exactly one transaction should exist");
    assert_eq!(saved[0].id, id, "create_transaction must return this row's own id");
    assert_eq!(
        saved[0].notes,
        Some("Split with Jordan".to_string()),
        "the note must land on the transaction that was actually created"
    );
}

#[test]
fn notes_survive_soft_delete_and_undo() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let id = store
        .create_transaction(account, &tx("2026-08-05", "Coffee", "-4.50"), Some("keep me"))
        .unwrap();

    store.delete_transaction(id, test_now()).unwrap();
    store.restore_transactions(&[id]).unwrap();

    assert_eq!(store.all_transactions().unwrap()[0].notes, Some("keep me".to_string()));
}

#[test]
fn account_changes_get_logged_to_a_file_next_to_a_real_on_disk_database() {
    let dir = std::env::temp_dir().join(format!("vaultspend-activity-log-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("activity_log_test.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }
    let log_path = dir.join("account-changes.log");
    if log_path.exists() {
        std::fs::remove_file(&log_path).unwrap();
    }

    let store = Store::open(&db_path).unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "300000.00".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-08-05", "Groceries", "-60.00")]).unwrap();
    let id = store.all_transactions().unwrap().iter().find(|t| t.account_id == checking).unwrap().id;
    store.update_transaction_amount(id, "-65.00".parse().unwrap()).unwrap();
    store.save_transactions(loan, &[tx("2026-08-05", "Mortgage Payment", "2500.00")]).unwrap();
    let mortgage_tx_id = store.all_transactions().unwrap().iter().find(|t| t.account_id == loan).unwrap().id;
    store
        .update_transaction_principal_amount(mortgage_tx_id, Some("500.00".parse().unwrap()))
        .unwrap();
    // Correcting the raw `amount` of a transaction whose principal
    // override is still set must report no balance movement at all —
    // the override, not `amount`, is what counts toward the loan.
    store.update_transaction_amount(mortgage_tx_id, "2600.00".parse().unwrap()).unwrap();
    store
        .delete_transaction(id, chrono::NaiveDate::from_ymd_opt(2026, 8, 6).unwrap().and_hms_opt(0, 0, 0).unwrap())
        .unwrap();
    store.restore_transactions(&[id]).unwrap();
    drop(store);

    let contents = std::fs::read_to_string(&log_path).expect("account-changes.log must exist next to the database");
    assert!(contents.contains("Everyday Checking: transaction added"), "log was:\n{contents}");
    assert!(contents.contains("balance 0 -> -60.00"), "log was:\n{contents}");
    assert!(contents.contains("amount corrected: -60.00 -> -65.00"), "log was:\n{contents}");
    assert!(contents.contains("balance -60.00 -> -65.00"), "log was:\n{contents}");
    assert!(contents.contains("Mortgage: transaction added"), "log was:\n{contents}");
    assert!(contents.contains("owed 300000.00 -> 297500.00"), "log was:\n{contents}");
    assert!(contents.contains("principal override: full amount -> 500.00"), "log was:\n{contents}");
    assert!(
        contents.contains("owed 297500.00 -> 299500.00"),
        "reducing how much of the mortgage payment counts as principal should raise what's still owed relative to before the override:\n{contents}"
    );
    assert!(
        contents.contains("amount corrected: 2500.00 -> 2600.00 — owed 299500.00 -> 299500.00"),
        "correcting the raw amount of a transaction whose principal override is still set must leave owed unchanged:\nlog was:\n{contents}"
    );
    assert!(contents.contains("deleted — balance -65.00 -> 0"), "log was:\n{contents}");
    assert!(contents.contains("restored — balance 0 -> -65.00"), "log was:\n{contents}");

    std::fs::remove_file(&db_path).unwrap();
    std::fs::remove_file(&log_path).unwrap();
}

#[test]
fn check_duplicates_does_not_flag_the_same_content_in_a_different_account() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    let credit = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();

    let same_content = vec![tx("2026-08-20", "Transfer", "-100.00")];
    store.save_transactions(checking, &same_content).unwrap();

    let flags = store.check_duplicates(credit, &same_content).unwrap();

    assert_eq!(flags, vec![false], "same content in a different account is not a duplicate");
}

#[test]
fn all_transactions_reports_which_account_each_row_belongs_to() {
    let store = Store::open_in_memory().unwrap();
    let credit = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
    store.save_transactions(credit, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")]).unwrap();

    let stored = store.all_transactions().unwrap();
    assert_eq!(stored[0].account_id, credit);
    assert_eq!(stored[0].account_name, "Sapphire Rewards");
}

#[test]
fn update_transaction_amount_persists_the_new_amount() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;

    store.update_transaction_amount(id, "-7.25".parse().unwrap()).unwrap();

    assert_eq!(store.all_transactions().unwrap()[0].transaction.amount, "-7.25".parse().unwrap());
}

/// Regression test for a real reporting-inconsistency bug: editing a
/// split transaction's parent amount used to leave its splits summing
/// to the *old* amount, so the transaction and its own split
/// breakdown silently disagreed with each other. The fix rescales
/// every split proportionally so they still sum to exactly the new
/// amount, preserving each one's relative share of the total.
#[test]
fn update_transaction_amount_rescales_splits_that_no_longer_sum_to_the_new_amount() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-20", "Groceries run", "-100.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store
        .set_transaction_splits(
            id,
            &[
                ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                ("Household".to_string(), "-40.00".parse().unwrap(), None),
            ],
        )
        .unwrap();

    let splits_reconciled = store.update_transaction_amount(id, "-200.00".parse().unwrap()).unwrap();

    assert!(splits_reconciled, "expected the now-mismatched splits to be reported as reconciled");
    assert_eq!(store.all_transactions().unwrap()[0].transaction.amount, "-200.00".parse().unwrap());
    let splits = store.list_transaction_splits(id).unwrap();
    assert_eq!(splits.len(), 2, "reconciling must not drop either split");
    // Same 60/40 relative share as before, just doubled along with the total.
    assert_eq!(splits[0].category.as_deref(), Some("Groceries"));
    assert_eq!(splits[0].amount, "-120.00".parse().unwrap());
    assert_eq!(splits[1].category.as_deref(), Some("Household"));
    assert_eq!(splits[1].amount, "-80.00".parse().unwrap());
    let total: rust_decimal::Decimal = splits.iter().map(|s| s.amount).sum();
    assert_eq!(
        total,
        "-200.00".parse().unwrap(),
        "splits must sum to exactly the new amount, not just approximately"
    );
}

#[test]
fn update_transaction_amount_splits_a_zero_sum_breakdown_evenly() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-20", "Wash", "0.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store
        .set_transaction_splits(
            id,
            &[
                ("Refund".to_string(), "-50.00".parse().unwrap(), None),
                ("Fee".to_string(), "50.00".parse().unwrap(), None),
            ],
        )
        .unwrap();

    store.update_transaction_amount(id, "-100.00".parse().unwrap()).unwrap();

    let splits = store.list_transaction_splits(id).unwrap();
    let total: rust_decimal::Decimal = splits.iter().map(|s| s.amount).sum();
    assert_eq!(
        total,
        "-100.00".parse().unwrap(),
        "a zero-sum breakdown has no ratio to scale by, so it splits evenly instead"
    );
}

#[test]
fn update_transaction_amount_rescaling_handles_a_remainder_penny_exactly() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Split three ways", "-100.00")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store
        .set_transaction_splits(
            id,
            &[
                ("A".to_string(), "-33.34".parse().unwrap(), None),
                ("B".to_string(), "-33.33".parse().unwrap(), None),
                ("C".to_string(), "-33.33".parse().unwrap(), None),
            ],
        )
        .unwrap();

    // A ratio that doesn't divide evenly into cents (-10.00 / -100.00 =
    // 0.1) is exactly the case naive per-split rounding can drift on.
    store.update_transaction_amount(id, "-10.00".parse().unwrap()).unwrap();

    let splits = store.list_transaction_splits(id).unwrap();
    let total: rust_decimal::Decimal = splits.iter().map(|s| s.amount).sum();
    assert_eq!(
        total,
        "-10.00".parse().unwrap(),
        "the last split must absorb any rounding remainder so the total is exact"
    );
}

#[test]
fn update_transaction_amount_keeps_splits_that_still_sum_correctly() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-20", "Groceries run", "-100.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store
        .set_transaction_splits(
            id,
            &[
                ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                ("Household".to_string(), "-40.00".parse().unwrap(), None),
            ],
        )
        .unwrap();

    // Same total, just re-entered — a no-op edit shouldn't disturb an
    // already-consistent split breakdown.
    let splits_reconciled = store.update_transaction_amount(id, "-100.00".parse().unwrap()).unwrap();

    assert!(!splits_reconciled);
    assert_eq!(store.list_transaction_splits(id).unwrap().len(), 2);
}

#[test]
fn update_transaction_amount_keeps_dedup_working_against_the_corrected_value() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.update_transaction_amount(id, "-7.25".parse().unwrap()).unwrap();

    // re-importing the same file (still says -6.75) should look new now,
    // since the stored row's fingerprint moved with the corrected amount
    let flags = store.check_duplicates(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")]).unwrap();
    assert_eq!(flags, vec![false]);

    let flags = store.check_duplicates(account, &[tx("2026-08-20", "Ferrywood Coffee", "-7.25")]).unwrap();
    assert_eq!(flags, vec![true]);
}

#[test]
fn update_transaction_amount_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.update_transaction_amount(999, "1.00".parse().unwrap()).unwrap();
}

#[test]
fn a_loan_transactions_principal_override_is_what_actually_moves_the_balance() {
    // A mortgage payment bundles principal, interest, and escrow — only
    // $500 of a $2500 payment recorded directly on the loan account
    // should reduce what's owed.
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "300000.00".parse().unwrap()).unwrap();
    store.save_transactions(loan, &[tx("2026-08-05", "Mortgage Payment", "2500.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;

    store.update_transaction_principal_amount(id, Some("500.00".parse().unwrap())).unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();
    assert_eq!(
        accounts[0].current_balance,
        "299500.00".parse().unwrap(),
        "only the $500 principal override should reduce what's owed, not the full $2500"
    );
}

#[test]
fn update_transaction_principal_amount_can_be_cleared_back_to_none() {
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "300000.00".parse().unwrap()).unwrap();
    store.save_transactions(loan, &[tx("2026-08-05", "Mortgage Payment", "2500.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.update_transaction_principal_amount(id, Some("500.00".parse().unwrap())).unwrap();

    store.update_transaction_principal_amount(id, None).unwrap();

    assert_eq!(store.all_transactions().unwrap()[0].principal_amount, None);
    let accounts = store.list_accounts(far_future()).unwrap();
    assert_eq!(
        accounts[0].current_balance,
        "297500.00".parse().unwrap(),
        "clearing the override reverts to the full $2500 payment reducing what's owed"
    );
}

#[test]
fn update_transaction_principal_amount_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.update_transaction_principal_amount(999, Some("1.00".parse().unwrap())).unwrap();
}

#[test]
fn set_account_balance_override_nets_out_a_same_day_loan_transactions_principal_override() {
    // Same idea as set_account_balance_override_nets_out_a_same_day_transaction_on_a_loan_account,
    // but the same-day transaction has a principal override smaller
    // than its own amount — the override, not the full amount, is what
    // must be netted out.
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
    store.save_transactions(loan, &[tx("2026-09-04", "Mortgage Payment", "2500.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.update_transaction_principal_amount(id, Some("500.00".parse().unwrap())).unwrap();

    store
        .set_account_balance_override(loan, "8000.00".parse().unwrap(), "2026-09-04".parse().unwrap())
        .unwrap();

    let accounts = store.list_accounts("2026-09-04".parse().unwrap()).unwrap();
    assert_eq!(
        accounts[0].current_balance,
        "8000.00".parse().unwrap(),
        "the $500 principal override, not the $2500 full amount, must be netted out"
    );
}

#[test]
fn update_transaction_account_moves_it_to_the_new_account() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    let savings = store.get_or_create_account("Nest Egg", AccountType::Savings).unwrap();
    store
        .save_transactions(checking, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;

    store.update_transaction_account(id, savings).unwrap();

    let stored = store.all_transactions().unwrap();
    assert_eq!(stored[0].account_id, savings);
    assert_eq!(stored[0].account_name, "Nest Egg");
}

#[test]
fn update_transaction_account_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.update_transaction_account(999, account).unwrap();
}

#[test]
fn update_transaction_date_persists_the_new_date() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;

    store.update_transaction_date(id, "2026-08-21".parse().unwrap()).unwrap();

    assert_eq!(
        store.all_transactions().unwrap()[0].transaction.date,
        "2026-08-21".parse::<NaiveDate>().unwrap()
    );
}

#[test]
fn update_transaction_date_keeps_dedup_working_against_the_corrected_value() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.update_transaction_date(id, "2026-08-21".parse().unwrap()).unwrap();

    let flags = store.check_duplicates(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")]).unwrap();
    assert_eq!(
        flags,
        vec![false],
        "re-importing the original date should look new now that the stored row moved"
    );

    let flags = store.check_duplicates(account, &[tx("2026-08-21", "Ferrywood Coffee", "-6.75")]).unwrap();
    assert_eq!(flags, vec![true]);
}

#[test]
fn update_transaction_date_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.update_transaction_date(999, "2026-08-20".parse().unwrap()).unwrap();
}

#[test]
fn update_transaction_description_persists_the_new_description() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;

    store.update_transaction_description(id, "Ferrywood Coffee Co.").unwrap();

    assert_eq!(store.all_transactions().unwrap()[0].transaction.description, "Ferrywood Coffee Co.");
}

#[test]
fn update_transaction_description_keeps_dedup_working_against_the_corrected_value() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.update_transaction_description(id, "Ferrywood Coffee Co.").unwrap();

    let flags = store.check_duplicates(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")]).unwrap();
    assert_eq!(
        flags,
        vec![false],
        "re-importing the original description should look new now that the stored row moved"
    );

    let flags = store
        .check_duplicates(account, &[tx("2026-08-20", "Ferrywood Coffee Co.", "-6.75")])
        .unwrap();
    assert_eq!(flags, vec![true]);
}

#[test]
fn update_transaction_description_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.update_transaction_description(999, "New description").unwrap();
}

#[test]
fn delete_transaction_removes_only_that_row() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-20", "Ferrywood Coffee", "-6.75"),
                tx("2026-08-21", "Green Leaf Grocers", "-40.00"),
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();

    store.delete_transaction(ids[0], test_now()).unwrap();

    let remaining = store.all_transactions().unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, ids[1]);
}

#[test]
fn delete_transaction_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.delete_transaction(999, test_now()).unwrap();
}

#[test]
fn restoring_a_deleted_transaction_brings_back_its_tags_too() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.add_tag(id, "reimbursable").unwrap();

    store.delete_transaction(id, test_now()).unwrap();
    assert_eq!(
        store.list_all_tags().unwrap(),
        Vec::<String>::new(),
        "a deleted transaction's tags don't leak into autocomplete"
    );

    store.restore_transactions(&[id]).unwrap();

    assert_eq!(store.list_all_tags().unwrap(), vec!["reimbursable".to_string()]);
}

#[test]
fn restore_transactions_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.restore_transactions(&[999]).unwrap();
}

#[test]
fn restore_transactions_restores_every_id_given_at_once() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-05", "Target", "-50.00"), tx("2026-08-06", "Costco", "-75.00")])
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    for &id in &ids {
        store.delete_transaction(id, test_now()).unwrap();
    }
    assert!(store.all_transactions().unwrap().is_empty());

    store.restore_transactions(&ids).unwrap();

    assert_eq!(store.all_transactions().unwrap().len(), 2);
}

#[test]
fn applying_a_payment_reduces_a_loans_balance() {
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")]).unwrap();
    let source_id = store.all_transactions().unwrap()[0].id;

    store
        .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
        .unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();
    let loan_account = accounts.iter().find(|a| a.id == loan).unwrap();
    assert_eq!(loan_account.current_balance, "9500.00".parse().unwrap());
}

#[test]
fn applying_a_payment_increases_a_credit_cards_available_balance() {
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let credit_card = store.get_or_create_account("Visa", AccountType::Credit).unwrap();
    store.set_account_starting_balance(credit_card, "2000.00".parse().unwrap()).unwrap(); // credit limit
    store.save_transactions(credit_card, &[tx("2026-08-15", "Groceries", "-300.00")]).unwrap();
    store
        .save_transactions(checking, &[tx("2026-08-20", "Credit Card Payment", "-200.00")])
        .unwrap();
    let source_id = store
        .all_transactions()
        .unwrap()
        .into_iter()
        .find(|t| t.transaction.description == "Credit Card Payment")
        .unwrap()
        .id;

    store
        .apply_debt_payment(source_id, credit_card, "200.00".parse().unwrap(), "2026-08-20".parse().unwrap())
        .unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();
    let card = accounts.iter().find(|a| a.id == credit_card).unwrap();
    // 2000 limit - 300 charge + 200 payment = 1900 available.
    assert_eq!(card.current_balance, "1900.00".parse().unwrap());
}

#[test]
fn applying_a_payment_with_a_different_amount_than_the_source_transaction_uses_the_given_amount() {
    // A mortgage payment bundles principal + interest + escrow — only
    // the principal portion should reduce what's tracked as owed.
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let mortgage = store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    store.set_account_starting_balance(mortgage, "300000.00".parse().unwrap()).unwrap();
    store
        .save_transactions(checking, &[tx("2026-08-01", "Mortgage Payment", "-1500.00")])
        .unwrap();
    let source_id = store.all_transactions().unwrap()[0].id;

    store
        .apply_debt_payment(source_id, mortgage, "900.00".parse().unwrap(), "2026-08-01".parse().unwrap())
        .unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();
    let mortgage_account = accounts.iter().find(|a| a.id == mortgage).unwrap();
    assert_eq!(mortgage_account.current_balance, "299100.00".parse().unwrap());
}

#[test]
fn unapplying_a_payment_removes_the_generated_transaction_and_restores_the_balance() {
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")]).unwrap();
    let source_id = store.all_transactions().unwrap()[0].id;
    store
        .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
        .unwrap();

    store.unapply_debt_payment(source_id).unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();
    let loan_account = accounts.iter().find(|a| a.id == loan).unwrap();
    assert_eq!(loan_account.current_balance, "10000.00".parse().unwrap());
    assert_eq!(store.all_transactions().unwrap().len(), 1);
}

#[test]
fn unapplying_a_payment_that_was_never_applied_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.unapply_debt_payment(999).unwrap();
}

#[test]
fn deleting_the_source_transaction_also_soft_deletes_its_generated_debt_payment() {
    // Soft-delete: both rows physically survive (so restoring the
    // source brings its debt-payment twin back too — see
    // `delete_transaction`'s own doc comment) but neither is visible
    // through the app's own filtered read.
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")]).unwrap();
    let source_id = store.all_transactions().unwrap()[0].id;
    store
        .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
        .unwrap();
    assert_eq!(raw_transaction_count(&store), 2);

    store.delete_transaction(source_id, test_now()).unwrap();

    assert_eq!(raw_transaction_count(&store), 2, "both rows must physically survive a soft delete");
    assert!(store.all_transactions().unwrap().is_empty(), "but neither should be visible");

    store.restore_transactions(&[source_id]).unwrap();

    assert_eq!(store.all_transactions().unwrap().len(), 1, "restoring the source brings both back");
}

#[test]
fn all_transactions_reports_which_transactions_are_applied_to_a_debt() {
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-08-20", "Loan Payment", "-500.00")]).unwrap();
    let source_id = store.all_transactions().unwrap()[0].id;

    let before = store.all_transactions().unwrap();
    assert!(before.iter().find(|t| t.id == source_id).unwrap().applied_to_debt.is_none());

    store
        .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
        .unwrap();

    let after = store.all_transactions().unwrap();
    let applied = after.iter().find(|t| t.id == source_id).unwrap().applied_to_debt.as_ref().unwrap();
    assert_eq!(applied.debt_account_id, loan);
    assert_eq!(applied.debt_account_name, "Car Loan");
    assert_eq!(applied.amount, "500.00".parse().unwrap());
}

#[test]
fn setting_splits_replaces_any_previous_set() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;

    store
        .set_transaction_splits(
            id,
            &[
                ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                ("Household".to_string(), "-40.00".parse().unwrap(), None),
            ],
        )
        .unwrap();
    assert_eq!(store.list_transaction_splits(id).unwrap().len(), 2);

    // Replacing with a different set, including clearing entirely.
    store
        .set_transaction_splits(id, &[("Groceries".to_string(), "-100.00".parse().unwrap(), None)])
        .unwrap();
    let splits = store.list_transaction_splits(id).unwrap();
    assert_eq!(splits.len(), 1);
    assert_eq!(splits[0].category, Some("Groceries".to_string()));

    store.set_transaction_splits(id, &[]).unwrap();
    assert_eq!(store.list_transaction_splits(id).unwrap().len(), 0);
}

#[test]
fn all_transactions_reports_split_count() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    assert_eq!(store.all_transactions().unwrap()[0].split_count, 0);

    store
        .set_transaction_splits(
            id,
            &[
                ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                ("Household".to_string(), "-40.00".parse().unwrap(), None),
            ],
        )
        .unwrap();

    assert_eq!(store.all_transactions().unwrap()[0].split_count, 2);
}

#[test]
fn deleting_a_transaction_leaves_its_splits_intact_for_restore() {
    // Soft-delete: splits are deliberately *not* removed, so
    // `restore_transactions` brings a split transaction back exactly
    // as it was, not with its splits lost — see `delete_transaction`'s
    // own doc comment for why.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store
        .set_transaction_splits(id, &[("Groceries".to_string(), "-100.00".parse().unwrap(), None)])
        .unwrap();

    store.delete_transaction(id, test_now()).unwrap();

    assert_eq!(store.list_transaction_splits(id).unwrap().len(), 1, "splits must survive a soft delete");
    assert!(
        store.all_transactions().unwrap().is_empty(),
        "but the transaction itself must not be listed"
    );

    store.restore_transactions(&[id]).unwrap();

    assert_eq!(store.list_transaction_splits(id).unwrap().len(), 1, "and still be there after restore");
    assert_eq!(store.all_transactions().unwrap().len(), 1, "with the transaction visible again");
}

#[test]
fn renaming_a_category_updates_it_within_transaction_splits_too() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store
        .set_transaction_splits(id, &[("Groceries".to_string(), "-100.00".parse().unwrap(), None)])
        .unwrap();

    store.rename_category("Groceries", "Food").unwrap();

    assert_eq!(store.list_transaction_splits(id).unwrap()[0].category, Some("Food".to_string()));
}

#[test]
fn deleting_a_category_nulls_it_out_within_transaction_splits_too() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store
        .set_transaction_splits(id, &[("Groceries".to_string(), "-100.00".parse().unwrap(), None)])
        .unwrap();

    store.delete_category("Groceries").unwrap();

    assert_eq!(store.list_transaction_splits(id).unwrap()[0].category, None);
}

#[test]
fn adding_and_removing_tags_on_a_transaction() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;

    store.add_tag(id, "reimbursable").unwrap();
    store.add_tag(id, "vacation").unwrap();
    let tags = store.all_transactions().unwrap()[0].tags.clone();
    assert_eq!(tags.len(), 2);
    assert!(tags.contains(&"reimbursable".to_string()));
    assert!(tags.contains(&"vacation".to_string()));

    store.remove_tag(id, "vacation").unwrap();
    let tags = store.all_transactions().unwrap()[0].tags.clone();
    assert_eq!(tags, vec!["reimbursable".to_string()]);
}

#[test]
fn adding_the_same_tag_twice_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;

    store.add_tag(id, "reimbursable").unwrap();
    store.add_tag(id, "reimbursable").unwrap();

    assert_eq!(store.all_transactions().unwrap()[0].tags, vec!["reimbursable".to_string()]);
}

#[test]
fn list_all_tags_returns_distinct_tags_across_transactions() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-05", "Target", "-100.00"), tx("2026-08-06", "Costco", "-200.00")])
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    store.add_tag(ids[0], "reimbursable").unwrap();
    store.add_tag(ids[1], "reimbursable").unwrap();
    store.add_tag(ids[1], "vacation").unwrap();

    let all_tags = store.list_all_tags().unwrap();

    assert_eq!(all_tags, vec!["reimbursable".to_string(), "vacation".to_string()]);
}

#[test]
fn deleting_a_transaction_removes_its_tags() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.add_tag(id, "reimbursable").unwrap();

    store.delete_transaction(id, test_now()).unwrap();

    assert_eq!(store.list_all_tags().unwrap(), Vec::<String>::new());
}

#[test]
fn spending_by_category_excludes_a_transfer_split_line_but_keeps_the_rest_of_the_split() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-05", "Warehouse Club", "-100.00")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store
        .set_transaction_splits(
            id,
            &[
                ("Transfer".to_string(), "-60.00".parse().unwrap(), None),
                ("Groceries".to_string(), "-40.00".parse().unwrap(), None),
            ],
        )
        .unwrap();

    let spend = store
        .spending_by_category("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
        .unwrap();

    assert_eq!(spend, vec![("Groceries".to_string(), "40.00".parse().unwrap())]);
}

#[test]
fn apply_rule_to_existing_skips_a_split_transaction() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-01", "Warehouse Club", "-100.00")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store
        .set_transaction_splits(
            id,
            &[
                ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                ("Household".to_string(), "-40.00".parse().unwrap(), None),
            ],
        )
        .unwrap();

    let changed = store.apply_rule_to_existing("warehouse", "Shopping").unwrap();

    assert_eq!(changed, 0, "a split purchase is categorized line by line, not as one lump");
}

#[test]
fn a_link_only_excludes_while_both_legs_are_still_live() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
    store.link_transfer(out_id, in_id).unwrap();

    // Delete just the outgoing leg: the surviving deposit is real money in again.
    store.delete_transaction(out_id, "2026-08-12T00:00:00".parse().unwrap()).unwrap();
    let (income, _) = store.monthly_totals(2026, 8).unwrap();
    assert_eq!(income, "500.00".parse().unwrap());
    assert_eq!(counterpart_of(&store, in_id), None, "a deleted leg isn't a counterpart");

    // Undo restores the link's effect.
    store.restore_transactions(&[out_id]).unwrap();
    let (income, expense) = store.monthly_totals(2026, 8).unwrap();
    assert_eq!((income, expense), (Decimal::ZERO, Decimal::ZERO));
    assert_eq!(counterpart_of(&store, in_id), Some(out_id));
}

#[test]
fn month_review_ignores_categorized_deleted_and_split_transactions_when_counting_uncategorized() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-02", "Kroger", "-40.00"),
                tx("2026-08-03", "Gone", "-10.00"),
                tx("2026-08-04", "Costco", "-100.00"),
            ],
        )
        .unwrap();
    store
        .set_category(id_of(&store, "Kroger", "2026-08-02"), "Groceries", CategorySource::User, None)
        .unwrap();
    store.delete_transaction(id_of(&store, "Gone", "2026-08-03"), test_now()).unwrap();
    let costco = id_of(&store, "Costco", "2026-08-04");
    store
        .set_transaction_splits(
            costco,
            &[
                ("Groceries".to_string(), dec("-60.00"), None),
                ("Household".to_string(), dec("-40.00"), None),
            ],
        )
        .unwrap();

    let r = store.month_review(2026, 8).unwrap();

    assert_eq!(r.uncategorized_count, 0);
}

#[test]
fn contributions_skip_deleted_rows_and_other_accounts() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    let other = store.get_or_create_account("Sam's 529", AccountType::Investment).unwrap();
    put(&store, acct, "2026-08-03", "Kept", "500.00");
    put(&store, acct, "2026-08-04", "Entered by mistake", "999.00");
    put(&store, other, "2026-08-03", "Someone else's deposit", "300.00");
    store
        .delete_transaction(id_of(&store, "Entered by mistake", "2026-08-04"), test_now())
        .unwrap();

    let c = store.account_contributions(acct, day("2026-09-20")).unwrap();

    assert_eq!(c.total_in, dec("500.00"));
    assert_eq!(c.deposit_count, 1);
}

#[test]
fn category_spending_ignores_income_transfers_and_deleted_rows_and_lists_uncategorized_spend() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-01", "Paycheck", "2000.00"),
                tx("2026-08-02", "To Savings", "-500.00"),
                tx("2026-08-03", "Gone", "-15.00"),
                tx("2026-08-04", "Mystery", "-22.00"),
            ],
        )
        .unwrap();
    store
        .set_category(id_of(&store, "To Savings", "2026-08-02"), "Transfer", CategorySource::User, None)
        .unwrap();
    store.delete_transaction(id_of(&store, "Gone", "2026-08-03"), test_now()).unwrap();

    let rows = store.category_spending_by_month(2026, 8, 2026, 8).unwrap();

    assert_eq!(rows.len(), 1, "only the uncategorized spend is left: {rows:?}");
    assert_eq!(month_cell(&rows, "2026-08", "Uncategorized"), Some(dec("22.00")));
}

#[test]
fn category_spending_counts_a_split_purchase_through_its_lines() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-05", "Costco", "-100.00")]).unwrap();
    let costco = id_of(&store, "Costco", "2026-08-05");
    store.set_category(costco, "Groceries", CategorySource::User, None).unwrap();
    store
        .set_transaction_splits(
            costco,
            &[
                ("Groceries".to_string(), dec("-60.00"), None),
                ("Household".to_string(), dec("-40.00"), None),
            ],
        )
        .unwrap();

    let rows = store.category_spending_by_month(2026, 8, 2026, 8).unwrap();

    assert_eq!(month_cell(&rows, "2026-08", "Groceries"), Some(dec("60.00")));
    assert_eq!(month_cell(&rows, "2026-08", "Household"), Some(dec("40.00")));
}

#[test]
fn daily_spending_ignores_income_transfers_and_deleted_rows() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-01", "Paycheck", "2000.00"),
                tx("2026-08-02", "To Savings", "-500.00"),
                tx("2026-08-03", "Gone", "-15.00"),
                tx("2026-08-04", "Mystery", "-22.00"),
            ],
        )
        .unwrap();
    store
        .set_category(id_of(&store, "To Savings", "2026-08-02"), "Transfer", CategorySource::User, None)
        .unwrap();
    store.delete_transaction(id_of(&store, "Gone", "2026-08-03"), test_now()).unwrap();

    let rows = store.daily_spending(2026, 8, 2026, 8).unwrap();

    assert_eq!(rows.len(), 1, "only the uncategorized spend is left: {rows:?}");
    assert_eq!(day_cell(&rows, "2026-08-04"), Some(dec("22.00")));
}

#[test]
fn daily_spending_counts_a_split_purchase_through_its_lines() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-05", "Costco", "-100.00")]).unwrap();
    let costco = id_of(&store, "Costco", "2026-08-05");
    store.set_category(costco, "Groceries", CategorySource::User, None).unwrap();
    store
        .set_transaction_splits(
            costco,
            &[
                ("Groceries".to_string(), dec("-60.00"), None),
                ("Household".to_string(), dec("-40.00"), None),
            ],
        )
        .unwrap();

    let rows = store.daily_spending(2026, 8, 2026, 8).unwrap();

    assert_eq!(day_cell(&rows, "2026-08-05"), Some(dec("100.00")));
}

#[test]
fn a_bill_due_today_that_has_already_posted_is_not_reminded() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    bill(&store, "Netflix", "-15.49", "2026-08-18");
    store
        .save_transactions(
            account,
            &[tx("2026-08-18", "NETFLIX.COM", "-15.49"), tx("2026-09-18", "NETFLIX.COM", "-15.49")],
        )
        .unwrap();

    assert!(reminder_names(&store, "2026-09-18", 3).is_empty());
}
