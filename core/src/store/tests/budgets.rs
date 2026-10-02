use super::*;
use crate::store::budgets::month_key_back;

#[test]
fn rename_category_carries_its_budget_line_forward() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Dining Out", "0000-01", "150.00".parse().unwrap(), "flexible").unwrap();

    store.rename_category("Dining Out", "Food & Drink").unwrap();

    let budgets = store.list_budgets("0000-01").unwrap();
    assert_eq!(budgets.len(), 1);
    assert_eq!(budgets[0].category, "Food & Drink");
    assert_eq!(budgets[0].monthly_amount, "150.00".parse().unwrap());
}

#[test]
fn renaming_into_a_category_that_already_has_a_budget_keeps_the_targets_budget() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Coffee", "0000-01", "40.00".parse().unwrap(), "flexible").unwrap();
    store.set_budget("Dining Out", "0000-01", "150.00".parse().unwrap(), "flexible").unwrap();

    store.rename_category("Coffee", "Dining Out").unwrap();

    let budgets = store.list_budgets("0000-01").unwrap();
    assert_eq!(
        budgets.len(),
        1,
        "the existing target's budget should win, not be overwritten or duplicated"
    );
    assert_eq!(budgets[0].category, "Dining Out");
    assert_eq!(budgets[0].monthly_amount, "150.00".parse().unwrap());
}

#[test]
fn delete_category_also_removes_its_budget_line() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Pet Care", "0000-01", "50.00".parse().unwrap(), "flexible").unwrap();

    store.delete_category("Pet Care").unwrap();

    assert_eq!(store.list_budgets("0000-01").unwrap(), vec![]);
}

#[test]
fn applying_a_debt_payment_does_not_double_count_it_as_spending() {
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "10000.00".parse().unwrap()).unwrap();
    store
        .save_transactions(
            checking,
            &[Transaction {
                category: Some("Auto Loan".to_string()),
                ..tx("2026-08-20", "Loan Payment", "-500.00")
            }],
        )
        .unwrap();
    let source_id = store.all_transactions().unwrap()[0].id;

    store
        .apply_debt_payment(source_id, loan, "500.00".parse().unwrap(), "2026-08-20".parse().unwrap())
        .unwrap();

    // Only the source transaction should ever be visible or counted —
    // the generated one on `loan` exists purely to move that account's
    // balance (see `all_transactions`'s doc comment).
    assert_eq!(store.all_transactions().unwrap().len(), 1);
    assert_eq!(raw_transaction_count(&store), 2, "the generated transaction still exists, just hidden");

    let spend = store
        .spending_by_category("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
        .unwrap();
    assert_eq!(spend, vec![("Auto Loan".to_string(), "500.00".parse().unwrap())]);

    let actuals = store.monthly_budget_actuals(2026, 8).unwrap();
    assert!(actuals.is_empty(), "no budget line was set for Auto Loan, so nothing to assert on here");

    store.set_budget("Auto Loan", "2026-08", "500.00".parse().unwrap(), "expense").unwrap();
    let actuals = store.monthly_budget_actuals(2026, 8).unwrap();
    assert_eq!(actuals[0].actual, "500.00".parse().unwrap());

    let (_, expense) = store.monthly_totals(2026, 8).unwrap();
    assert_eq!(expense, "500.00".parse().unwrap());
}

#[test]
fn monthly_budget_actuals_counts_split_lines_toward_their_own_categories_instead_of_the_parents() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Groceries", "0000-01", "200.00".parse().unwrap(), "flexible").unwrap();
    store.set_budget("Household", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
    store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Groceries", CategorySource::User, None).unwrap();
    store
        .set_transaction_splits(
            id,
            &[
                ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                ("Household".to_string(), "-40.00".parse().unwrap(), None),
            ],
        )
        .unwrap();

    let actuals = store.monthly_budget_actuals(2026, 8).unwrap();
    let groceries = actuals.iter().find(|a| a.category == "Groceries").unwrap();
    let household = actuals.iter().find(|a| a.category == "Household").unwrap();

    // Split lines count toward their own categories (60 + 40); the
    // parent transaction's own "Groceries" category must not also
    // contribute its full $100, or Groceries would double-count.
    assert_eq!(groceries.actual, "60.00".parse().unwrap());
    assert_eq!(household.actual, "40.00".parse().unwrap());
}

#[test]
fn set_budget_creates_then_list_budgets_returns_it_sorted() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
    store.set_budget("Dining Out", "0000-01", "150.00".parse().unwrap(), "flexible").unwrap();

    let budgets = store.list_budgets("0000-01").unwrap();
    assert_eq!(budgets.len(), 2);
    assert_eq!(budgets[0].category, "Dining Out");
    assert_eq!(budgets[0].monthly_amount, "150.00".parse().unwrap());
    assert_eq!(budgets[1].category, "Groceries");
    assert_eq!(budgets[1].monthly_amount, "400.00".parse().unwrap());
}

#[test]
fn set_budget_persists_the_group() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Paycheck", "0000-01", "6000.00".parse().unwrap(), "income").unwrap();

    assert_eq!(store.list_budgets("0000-01").unwrap()[0].budget_group, "income");
}

#[test]
fn budget_upsert_field_matrix() {
    struct Case {
        label: &'static str,
        first_amount: &'static str,
        first_group: &'static str,
        second_amount: &'static str,
        second_group: &'static str,
        expected_amount: &'static str,
        expected_group: &'static str,
    }
    let cases = [
        Case {
            label: "re-setting the amount updates rather than duplicates",
            first_amount: "400.00",
            first_group: "flexible",
            second_amount: "450.00",
            second_group: "flexible",
            expected_amount: "450.00",
            expected_group: "flexible",
        },
        Case {
            label: "re-setting the group updates it too",
            first_amount: "400.00",
            first_group: "flexible",
            second_amount: "400.00",
            second_group: "nonmonthly",
            expected_amount: "400.00",
            expected_group: "nonmonthly",
        },
    ];

    for case in cases {
        let store = Store::open_in_memory().unwrap();
        store
            .set_budget("Groceries", "0000-01", case.first_amount.parse().unwrap(), case.first_group)
            .unwrap();
        store
            .set_budget("Groceries", "0000-01", case.second_amount.parse().unwrap(), case.second_group)
            .unwrap();

        let budgets = store.list_budgets("0000-01").unwrap();
        assert_eq!(budgets.len(), 1, "case: {}", case.label);
        assert_eq!(budgets[0].monthly_amount, case.expected_amount.parse().unwrap(), "case: {}", case.label);
        assert_eq!(budgets[0].budget_group, case.expected_group, "case: {}", case.label);
    }
}

#[test]
fn delete_budget_removes_it() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();

    store.delete_budget("Groceries", "0000-01").unwrap();

    assert_eq!(store.list_budgets("0000-01").unwrap(), vec![]);
}

#[test]
fn delete_budget_on_an_unknown_category_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.delete_budget("Nonexistent", "0000-01").unwrap();
}

#[test]
fn list_budgets_starts_empty_when_theres_nothing_earlier_to_copy_from() {
    let store = Store::open_in_memory().unwrap();
    assert_eq!(store.list_budgets("2026-08").unwrap(), vec![]);
}

#[test]
fn a_new_month_copies_the_most_recent_earlier_periods_budget_as_a_starting_point() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Groceries", "2026-08", "400.00".parse().unwrap(), "flexible").unwrap();

    let september = store.list_budgets("2026-09").unwrap();

    assert_eq!(september.len(), 1);
    assert_eq!(september[0].category, "Groceries");
    assert_eq!(september[0].monthly_amount, "400.00".parse().unwrap());
}

#[test]
fn editing_one_months_budget_does_not_affect_a_different_month() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Groceries", "2026-08", "400.00".parse().unwrap(), "flexible").unwrap();
    store.list_budgets("2026-09").unwrap(); // materialize September from August, same as just viewing it

    store.set_budget("Groceries", "2026-09", "600.00".parse().unwrap(), "flexible").unwrap();

    let august = store.list_budgets("2026-08").unwrap();
    let september = store.list_budgets("2026-09").unwrap();

    assert_eq!(
        august[0].monthly_amount,
        "400.00".parse().unwrap(),
        "editing September must not change August"
    );
    assert_eq!(september[0].monthly_amount, "600.00".parse().unwrap());
}

#[test]
fn editing_a_months_budget_does_not_retroactively_change_an_earlier_month() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Groceries", "2026-07", "300.00".parse().unwrap(), "flexible").unwrap();
    store.list_budgets("2026-08").unwrap(); // materialize August from July

    store.set_budget("Groceries", "2026-08", "500.00".parse().unwrap(), "flexible").unwrap();

    let july = store.list_budgets("2026-07").unwrap();
    assert_eq!(july[0].monthly_amount, "300.00".parse().unwrap(), "editing August must not change July");
}

#[test]
fn deleting_a_budget_line_in_one_month_does_not_delete_it_in_another() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Groceries", "2026-08", "400.00".parse().unwrap(), "flexible").unwrap();
    store.list_budgets("2026-09").unwrap(); // materialize September too

    store.delete_budget("Groceries", "2026-09").unwrap();

    assert_eq!(
        store.list_budgets("2026-08").unwrap().len(),
        1,
        "August's line must survive deleting September's"
    );
    assert_eq!(store.list_budgets("2026-09").unwrap(), vec![]);
}

#[test]
fn opening_a_pre_period_scoped_budgets_database_migrates_it_without_losing_data() {
    // Simulates a real database created before budgets were split per
    // month: a `budgets` table with `category` as its sole primary key.
    let dir = std::env::temp_dir().join(format!("meadow-budget-migration-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("pre_period_budgets.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }

    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE budgets (
                    category TEXT PRIMARY KEY,
                    monthly_amount TEXT NOT NULL,
                    budget_group TEXT NOT NULL DEFAULT 'flexible'
                );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO budgets (category, monthly_amount, budget_group) VALUES ('Groceries', '400.00', 'flexible')",
            [],
        )
        .unwrap();
    } // old-style connection dropped here

    let store = Store::open(&db_path).unwrap();
    let budgets = store.list_budgets("2026-08").unwrap();

    assert_eq!(budgets.len(), 1, "the pre-existing budget must survive the migration");
    assert_eq!(budgets[0].category, "Groceries");
    assert_eq!(budgets[0].monthly_amount, "400.00".parse().unwrap());

    drop(store);
    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn opening_a_database_with_period_scoped_budgets_but_no_tracking_table_still_finds_them() {
    // Simulates a database already migrated to the (category, period)
    // schema by an earlier build that predates `budget_periods` —
    // the tracker must be backfilled from what's actually in
    // `budgets`, not just seeded at migration time, or these rows
    // silently look untouched and become invisible.
    let dir = std::env::temp_dir().join(format!("meadow-budget-tracker-backfill-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("period_scoped_no_tracker.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }

    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE budgets (
                    category TEXT NOT NULL,
                    period TEXT NOT NULL,
                    monthly_amount TEXT NOT NULL,
                    budget_group TEXT NOT NULL DEFAULT 'flexible',
                    PRIMARY KEY (category, period)
                );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES ('Groceries', '0000-01', '400.00', 'flexible')",
            [],
        )
        .unwrap();
        // deliberately no `budget_periods` table at all yet
    }

    let store = Store::open(&db_path).unwrap();
    let budgets = store.list_budgets("2026-08").unwrap();

    assert_eq!(budgets.len(), 1, "the pre-existing row must still be found and copied forward");
    assert_eq!(budgets[0].category, "Groceries");
    assert_eq!(budgets[0].monthly_amount, "400.00".parse().unwrap());

    drop(store);
    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn total_saved_is_zero_with_no_buckets() {
    let store = Store::open_in_memory().unwrap();
    assert_eq!(store.total_saved().unwrap(), Decimal::ZERO);
}

#[test]
fn income_total_sums_every_positive_non_transfer_transaction_regardless_of_category() {
    // Not "sums only the Income category" — a paycheck categorized
    // "Salary" (or left uncategorized) must count exactly like one
    // categorized "Income", matching monthly_totals on the backend.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-01", "Payroll Deposit", "3000.00"),
                tx("2026-08-15", "Payroll Deposit", "3000.00"),
                tx("2026-08-20", "Green Leaf Grocers", "-80.00"),
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    store.set_category(ids[0], "Income", CategorySource::User, None).unwrap();
    store.set_category(ids[1], "Salary", CategorySource::User, None).unwrap();
    store.set_category(ids[2], "Groceries", CategorySource::User, None).unwrap();

    assert_eq!(store.income_total().unwrap(), "6000.00".parse().unwrap());
}

#[test]
fn income_total_excludes_transfers_and_credit_loan_balance_entries() {
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let credit_card = store.get_or_create_account("Visa", AccountType::Credit).unwrap();
    let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
    store
        .save_transactions(
            checking,
            &[
                tx("2026-08-01", "Payroll Deposit", "3000.00"),
                Transaction {
                    category: Some("Transfer".to_string()),
                    ..tx("2026-08-10", "From Savings", "500.00")
                },
            ],
        )
        .unwrap();
    store
        .save_transactions(credit_card, &[tx("2026-08-21", "VISA ONLINE PYMT", "200.00")])
        .unwrap();
    store.save_transactions(loan, &[tx("2026-08-22", "Escrow Refund", "75.00")]).unwrap();

    assert_eq!(
        store.income_total().unwrap(),
        "3000.00".parse().unwrap(),
        "only the paycheck counts — the transfer-in, credit card credit, and loan refund must not"
    );
}

#[test]
fn monthly_budget_actuals_reports_only_this_months_spend_per_budgeted_category() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                tx("2026-08-20", "Fresh Market", "-60.00"),
                tx("2026-07-25", "Old Month Grocers", "-999.00"), // different month, excluded
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    store.set_category(ids[0], "Groceries", CategorySource::User, None).unwrap();
    store.set_category(ids[1], "Groceries", CategorySource::User, None).unwrap();
    store.set_category(ids[2], "Groceries", CategorySource::User, None).unwrap();

    let actuals = store.monthly_budget_actuals(2026, 8).unwrap();

    assert_eq!(actuals.len(), 1);
    assert_eq!(actuals[0].category, "Groceries");
    assert_eq!(actuals[0].budget_group, "flexible");
    assert_eq!(actuals[0].budgeted, "400.00".parse().unwrap());
    assert_eq!(actuals[0].actual, "140.00".parse().unwrap());
}

#[test]
fn monthly_budget_actuals_reports_zero_spend_for_a_budgeted_category_with_no_transactions_yet() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Pet Care", "0000-01", "50.00".parse().unwrap(), "flexible").unwrap();

    let actuals = store.monthly_budget_actuals(2026, 8).unwrap();

    assert_eq!(actuals.len(), 1);
    assert_eq!(actuals[0].category, "Pet Care");
    assert_eq!(actuals[0].budgeted, "50.00".parse().unwrap());
    assert_eq!(actuals[0].actual, Decimal::ZERO);
}

#[test]
fn monthly_budget_actuals_works_for_a_month_other_than_the_current_one() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
    store.save_transactions(account, &[tx("2025-03-10", "Old Grocers", "-55.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Groceries", CategorySource::User, None).unwrap();

    let march_2025 = store.monthly_budget_actuals(2025, 3).unwrap();
    let august_2026 = store.monthly_budget_actuals(2026, 8).unwrap();

    assert_eq!(march_2025[0].actual, "55.00".parse().unwrap());
    assert_eq!(august_2026[0].actual, Decimal::ZERO, "a different month must not see March's spend");
}

#[test]
fn monthly_budget_actuals_reports_a_positive_actual_for_an_income_budget_line() {
    // Income transactions are stored as positive deposits, unlike
    // expense transactions which are negative — an income budget
    // line's "actual" must not be negated the way an expense line's is.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Paycheck", "0000-01", "5000.00".parse().unwrap(), "income").unwrap();
    store.save_transactions(account, &[tx("2026-08-05", "Employer Inc", "1200.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Paycheck", CategorySource::User, None).unwrap();

    let actuals = store.monthly_budget_actuals(2026, 8).unwrap();

    assert_eq!(actuals[0].actual, "1200.00".parse().unwrap());
}

#[test]
fn monthly_budget_actuals_by_member_splits_one_categorys_actual_across_two_members() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let alex = store.create_family_member("Alex").unwrap();
    let jordan = store.create_family_member("Jordan").unwrap();
    store.set_budget("Groceries", "0000-01", "300.00".parse().unwrap(), "flexible").unwrap();
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-05", "Green Leaf Grocers", "-60.00"),
                tx("2026-08-06", "Corner Store", "-40.00"),
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    for id in &ids {
        store.set_category(*id, "Groceries", CategorySource::User, None).unwrap();
    }
    store.set_transaction_member(ids[0], Some(alex)).unwrap();
    store.set_transaction_member(ids[1], Some(jordan)).unwrap();

    let by_member = store.monthly_budget_actuals_by_member(2026, 8).unwrap();

    assert_eq!(by_member.len(), 2, "got {by_member:?}");
    let alex_row = by_member.iter().find(|m| m.member_id == Some(alex)).unwrap();
    let jordan_row = by_member.iter().find(|m| m.member_id == Some(jordan)).unwrap();
    assert_eq!(alex_row.actual, "60.00".parse().unwrap());
    assert_eq!(
        alex_row.budgeted,
        "300.00".parse().unwrap(),
        "the shared budget target repeats on every member row"
    );
    assert_eq!(jordan_row.actual, "40.00".parse().unwrap());
}

#[test]
fn monthly_budget_actuals_by_member_attributes_a_split_line_to_its_parent_transactions_member() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let alex = store.create_family_member("Alex").unwrap();
    store.set_budget("Groceries", "0000-01", "200.00".parse().unwrap(), "flexible").unwrap();
    store.set_budget("Household", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
    store.save_transactions(account, &[tx("2026-08-05", "Target", "-100.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Groceries", CategorySource::User, None).unwrap();
    store.set_transaction_member(id, Some(alex)).unwrap();
    store
        .set_transaction_splits(
            id,
            &[
                ("Groceries".to_string(), "-60.00".parse().unwrap(), None),
                ("Household".to_string(), "-40.00".parse().unwrap(), None),
            ],
        )
        .unwrap();

    let by_member = store.monthly_budget_actuals_by_member(2026, 8).unwrap();

    let groceries = by_member.iter().find(|m| m.category == "Groceries").unwrap();
    let household = by_member.iter().find(|m| m.category == "Household").unwrap();
    assert_eq!(
        groceries.member_id,
        Some(alex),
        "a split line has no member of its own — it's the parent's"
    );
    assert_eq!(household.member_id, Some(alex));
}

#[test]
fn monthly_budget_actuals_by_member_buckets_an_unattributed_transaction_as_unassigned() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Groceries", "0000-01", "200.00".parse().unwrap(), "flexible").unwrap();
    store
        .save_transactions(account, &[tx("2026-08-05", "Green Leaf Grocers", "-60.00")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Groceries", CategorySource::User, None).unwrap();

    let by_member = store.monthly_budget_actuals_by_member(2026, 8).unwrap();

    assert_eq!(by_member.len(), 1);
    assert_eq!(by_member[0].member_id, None);
    assert_eq!(by_member[0].member_name, None);
    assert_eq!(by_member[0].actual, "60.00".parse().unwrap());
}

#[test]
fn monthly_budget_actuals_by_member_sums_to_the_same_total_monthly_budget_actuals_reports_per_category() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let alex = store.create_family_member("Alex").unwrap();
    store.set_budget("Groceries", "0000-01", "300.00".parse().unwrap(), "flexible").unwrap();
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-05", "Green Leaf Grocers", "-60.00"),
                tx("2026-08-06", "Corner Store", "-40.00"),
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    for id in &ids {
        store.set_category(*id, "Groceries", CategorySource::User, None).unwrap();
    }
    store.set_transaction_member(ids[0], Some(alex)).unwrap(); // ids[1] left unattributed

    let whole_total = store.monthly_budget_actuals(2026, 8).unwrap()[0].actual;
    let by_member_total: Decimal = store.monthly_budget_actuals_by_member(2026, 8).unwrap().iter().map(|m| m.actual).sum();

    assert_eq!(
        by_member_total, whole_total,
        "the per-member rows must reconcile with the category's own total"
    );
}

#[test]
fn month_key_back_walks_backward_across_a_year_boundary() {
    assert_eq!(month_key_back(2026, 8, 0), "2026-08");
    assert_eq!(month_key_back(2026, 8, 1), "2026-07");
    assert_eq!(month_key_back(2026, 8, 8), "2025-12");
    assert_eq!(month_key_back(2026, 1, 1), "2025-12");
}

#[test]
fn budget_actuals_trend_returns_one_point_per_month_oldest_first() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
    store
        .save_transactions(
            account,
            &[
                tx("2026-06-05", "Grocers", "-100.00"),
                tx("2026-07-05", "Grocers", "-150.00"),
                tx("2026-08-05", "Grocers", "-200.00"),
            ],
        )
        .unwrap();
    for t in store.all_transactions().unwrap() {
        store.set_category(t.id, "Groceries", CategorySource::User, None).unwrap();
    }

    let trend = store.budget_actuals_trend("Groceries", 2026, 8, 3).unwrap();

    assert_eq!(
        trend,
        vec![
            ("2026-06".to_string(), "100.00".parse().unwrap()),
            ("2026-07".to_string(), "150.00".parse().unwrap()),
            ("2026-08".to_string(), "200.00".parse().unwrap()),
        ]
    );
}

#[test]
fn budget_actuals_trend_reports_zero_not_a_missing_point_for_a_month_with_no_spend() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Pet Care", "0000-01", "50.00".parse().unwrap(), "flexible").unwrap();

    let trend = store.budget_actuals_trend("Pet Care", 2026, 8, 4).unwrap();

    assert_eq!(trend.len(), 4);
    assert!(trend.iter().all(|(_, amount)| *amount == Decimal::ZERO));
}

#[test]
fn budget_actuals_trend_reports_a_positive_actual_for_an_income_category() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Paycheck", "0000-01", "5000.00".parse().unwrap(), "income").unwrap();
    store.save_transactions(account, &[tx("2026-08-05", "Employer Inc", "1200.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Paycheck", CategorySource::User, None).unwrap();

    let trend = store.budget_actuals_trend("Paycheck", 2026, 8, 1).unwrap();

    assert_eq!(trend, vec![("2026-08".to_string(), "1200.00".parse().unwrap())]);
}

#[test]
fn transactions_for_category_in_month_returns_whole_transactions_in_that_category_and_month() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-05", "City Power & Light", "-120.00"),
                tx("2026-08-20", "Groceries R Us", "-60.00"),      // different category
                tx("2025-07-05", "City Power & Light", "-110.00"), // different month
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    store.set_category(ids[0], "Utilities", CategorySource::User, None).unwrap();
    store.set_category(ids[1], "Groceries", CategorySource::User, None).unwrap();
    store.set_category(ids[2], "Utilities", CategorySource::User, None).unwrap();

    let result = store.transactions_for_category_in_month("Utilities", 2026, 8).unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].transaction_id, ids[0]);
    assert_eq!(result[0].description, "City Power & Light");
    assert_eq!(result[0].amount, "-120.00".parse().unwrap());
    assert_eq!(result[0].account_name, "Test Checking");
    assert!(!result[0].is_split);
    assert_eq!(result[0].split_note, None);
}

#[test]
fn transactions_for_category_in_month_includes_a_splits_own_line_instead_of_the_parent() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-08-10", "Costco", "-150.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Shopping", CategorySource::User, None).unwrap();
    store
        .set_transaction_splits(
            id,
            &[
                ("Groceries".to_string(), "-100.00".parse().unwrap(), None),
                ("Household".to_string(), "-50.00".parse().unwrap(), Some("paper towels".to_string())),
            ],
        )
        .unwrap();

    let groceries = store.transactions_for_category_in_month("Groceries", 2026, 8).unwrap();
    let shopping = store.transactions_for_category_in_month("Shopping", 2026, 8).unwrap();

    assert_eq!(groceries.len(), 1);
    assert_eq!(groceries[0].transaction_id, id);
    assert_eq!(groceries[0].amount, "-100.00".parse().unwrap());
    assert!(groceries[0].is_split);
    assert_eq!(groceries[0].split_note, None);

    let household = store.transactions_for_category_in_month("Household", 2026, 8).unwrap();
    assert_eq!(household[0].split_note.as_deref(), Some("paper towels"));

    assert!(
        shopping.is_empty(),
        "a split transaction no longer counts under its own original category"
    );
}

#[test]
fn transactions_for_category_in_month_sorts_oldest_first() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[tx("2026-08-20", "Later Bill", "-40.00"), tx("2026-08-05", "Earlier Bill", "-30.00")],
        )
        .unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Utilities", CategorySource::User, None).unwrap();
    }

    let result = store.transactions_for_category_in_month("Utilities", 2026, 8).unwrap();

    assert_eq!(result.len(), 2);
    assert_eq!(result[0].description, "Earlier Bill");
    assert_eq!(result[1].description, "Later Bill");
}

#[test]
fn budget_alerts_for_month_uncapped_threshold_matrix() {
    struct Case {
        label: &'static str,
        spent: &'static str,
        expect_alert: bool,
        expected_category: Option<&'static str>,
        expected_level: Option<&'static str>,
        expected_pct: Option<&'static str>,
    }
    let cases = [
        Case {
            label: "25% spent should not alert",
            spent: "-100.00",
            expect_alert: false,
            expected_category: None,
            expected_level: None,
            expected_pct: None,
        },
        Case {
            label: "80% spent is a warning",
            spent: "-320.00",
            expect_alert: true,
            expected_category: Some("Groceries"),
            expected_level: Some("warning"),
            expected_pct: None,
        },
        // Landing exactly on budget (remaining == $0.00) isn't
        // overspending — only spending *past* it is. "over" is
        // reserved for that.
        Case {
            label: "spent down to exactly the budget is a warning, not over",
            spent: "-400.00",
            expect_alert: true,
            expected_category: None,
            expected_level: Some("warning"),
            expected_pct: Some("100"),
        },
        Case {
            label: "spent past the budget is over",
            spent: "-450.00",
            expect_alert: true,
            expected_category: None,
            expected_level: Some("over"),
            expected_pct: None,
        },
    ];

    for case in cases {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store.set_budget("Groceries", "0000-01", "400.00".parse().unwrap(), "flexible").unwrap();
        store
            .save_transactions(account, &[tx("2026-08-05", "Green Leaf Grocers", case.spent)])
            .unwrap();
        let id = store.all_transactions().unwrap()[0].id;
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();

        let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

        if !case.expect_alert {
            assert!(alerts.is_empty(), "case: {} — got {alerts:?}", case.label);
            continue;
        }
        assert_eq!(alerts.len(), 1, "case: {}", case.label);
        if let Some(category) = case.expected_category {
            assert_eq!(alerts[0].category, category, "case: {}", case.label);
        }
        if let Some(level) = case.expected_level {
            assert_eq!(alerts[0].level, level, "case: {}", case.label);
        }
        if let Some(pct) = case.expected_pct {
            assert_eq!(alerts[0].pct, pct.parse().unwrap(), "case: {}", case.label);
        }
    }
}

#[test]
fn budget_alerts_for_month_never_flags_an_income_line() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Paycheck", "0000-01", "5000.00".parse().unwrap(), "income").unwrap();
    store.save_transactions(account, &[tx("2026-08-05", "Employer Inc", "9000.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Paycheck", CategorySource::User, None).unwrap();

    let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

    assert!(alerts.is_empty(), "exceeding an income budget should never alert, got {alerts:?}");
}

#[test]
fn budget_alerts_for_month_sorts_most_severe_first() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    // A "warning" (85%), a mildly-"over" (110%), and a badly-"over"
    // (200%) category — inserted in an order that doesn't already
    // match the expected output, so a passing test can't be an
    // accident of insertion order.
    store.set_budget("Warning Cat", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
    store.set_budget("Mild Over", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
    store.set_budget("Bad Over", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-01", "Warning Merchant", "-85.00"),
                tx("2026-08-02", "Mild Over Merchant", "-110.00"),
                tx("2026-08-03", "Bad Over Merchant", "-200.00"),
            ],
        )
        .unwrap();
    for t in store.all_transactions().unwrap() {
        let category = if t.transaction.description.contains("Warning") {
            "Warning Cat"
        } else if t.transaction.description.contains("Mild") {
            "Mild Over"
        } else {
            "Bad Over"
        };
        store.set_category(t.id, category, CategorySource::User, None).unwrap();
    }

    let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

    let names: Vec<&str> = alerts.iter().map(|a| a.category.as_str()).collect();
    assert_eq!(names, vec!["Bad Over", "Mild Over", "Warning Cat"], "got {alerts:?}");
}

#[test]
fn budget_alerts_for_month_never_flags_a_zero_budgeted_line() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Miscellaneous", "0000-01", "0.00".parse().unwrap(), "flexible").unwrap();
    store.save_transactions(account, &[tx("2026-08-05", "Odds and Ends", "-50.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Miscellaneous", CategorySource::User, None).unwrap();

    let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

    assert!(alerts.is_empty(), "a zero-budgeted line has nothing to alert against, got {alerts:?}");
}

#[test]
fn budget_alerts_for_month_does_not_yet_warn_a_capped_category_below_90_percent_even_though_an_uncapped_category_at_the_same_spend_already_would() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Dining Out", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
    store.set_budget_cap("Dining Out", "0000-01", true).unwrap();
    store.set_budget("Groceries", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
    store
        .save_transactions(
            account,
            &[tx("2026-08-01", "Restaurant", "-85.00"), tx("2026-08-02", "Green Leaf Grocers", "-85.00")],
        )
        .unwrap();
    for t in store.all_transactions().unwrap() {
        let category = if t.transaction.description == "Restaurant" {
            "Dining Out"
        } else {
            "Groceries"
        };
        store.set_category(t.id, category, CategorySource::User, None).unwrap();
    }

    let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

    assert_eq!(
        alerts.len(),
        1,
        "85% clears the uncapped 80% bar but not the capped 90% one, got {alerts:?}"
    );
    assert_eq!(alerts[0].category, "Groceries");
}

#[test]
fn budget_alerts_for_month_flags_a_capped_category_once_it_reaches_90_percent() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Dining Out", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
    store.set_budget_cap("Dining Out", "0000-01", true).unwrap();
    store.save_transactions(account, &[tx("2026-08-01", "Restaurant", "-92.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();

    let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

    assert_eq!(alerts.len(), 1);
    assert_eq!(alerts[0].category, "Dining Out");
    assert_eq!(alerts[0].level, "warning");
    assert!(alerts[0].cap_enabled);
}

#[test]
fn turning_off_the_envelope_caps_feature_suspends_a_categorys_cap_without_clearing_it() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Dining Out", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
    store.set_budget_cap("Dining Out", "0000-01", true).unwrap();
    store.save_transactions(account, &[tx("2026-08-01", "Restaurant", "-85.00")]).unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();

    store.set_envelope_caps_enabled(false).unwrap();
    let alerts = store.budget_alerts_for_month(2026, 8).unwrap();
    assert_eq!(alerts.len(), 1, "with the feature off, 85% must fall back to the plain 80% threshold");
    assert!(!alerts[0].cap_enabled, "the effective cap reported here should read as off too");

    // Turning it back on restores the 90% threshold — the category's
    // own cap_enabled flag was never touched by the feature toggle.
    store.set_envelope_caps_enabled(true).unwrap();
    let alerts = store.budget_alerts_for_month(2026, 8).unwrap();
    assert!(alerts.is_empty(), "85% is back below the capped 90% bar once the feature is re-enabled");
}

#[test]
fn budget_alerts_for_month_still_uses_80_percent_for_a_category_that_never_opted_into_a_cap() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Groceries", "0000-01", "100.00".parse().unwrap(), "flexible").unwrap();
    store
        .save_transactions(account, &[tx("2026-08-05", "Green Leaf Grocers", "-85.00")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Groceries", CategorySource::User, None).unwrap();

    let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

    assert_eq!(alerts.len(), 1, "85% must still warn an uncapped category, got {alerts:?}");
    assert!(!alerts[0].cap_enabled);
}

#[test]
fn list_budgets_carries_a_categorys_cap_setting_forward_into_a_new_month() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Dining Out", "2026-08", "100.00".parse().unwrap(), "flexible").unwrap();
    store.set_budget_cap("Dining Out", "2026-08", true).unwrap();

    // Touching September for the first time materializes it by copying
    // August forward — the cap setting must come along, not silently
    // reset to off.
    let september = store.list_budgets("2026-09").unwrap();

    assert_eq!(september.len(), 1);
    assert!(september[0].cap_enabled, "the cap setting must carry forward with the rest of the line");
}

#[test]
fn set_budget_cap_on_a_category_with_no_budget_line_this_period_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget_cap("Groceries", "2026-08", true).unwrap();
}

// Materialization is first-touch-wins, same as it's always been for
// monthly_amount/budget_group: a later period copies whatever the
// source period looks like *the moment it's first viewed*, then never
// re-syncs. Browsing ahead to a future month before finishing an edit
// in the current month freezes that future month at the stale value —
// pre-existing behavior that cap_enabled inherits by riding along in
// the same copy-forward mechanism, not a regression this feature added.
#[test]
fn a_period_materialized_before_a_sources_cap_is_set_does_not_retroactively_pick_it_up() {
    let store = Store::open_in_memory().unwrap();
    store.set_budget("Groceries", "2026-09", "550.00".parse().unwrap(), "flexible").unwrap();

    let _ = store.list_budgets("2026-10").unwrap();

    store.set_budget_cap("Groceries", "2026-09", true).unwrap();

    let september = store.list_budgets("2026-09").unwrap();
    assert!(september.iter().find(|b| b.category == "Groceries").unwrap().cap_enabled);

    let october = store.list_budgets("2026-10").unwrap();
    assert!(!october.iter().find(|b| b.category == "Groceries").unwrap().cap_enabled);
}

#[test]
fn dashboard_insights_flags_a_category_on_pace_to_exceed_its_budget() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Dining Out", "2026-08", "200.00".parse().unwrap(), "flexible").unwrap();
    // $100 spent in the first 10 days of a 31-day August projects to
    // $310 — well past the $200 budget (>1.1x).
    store.save_transactions(account, &[tx("2026-08-05", "Cafe", "-100.00")]).unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
    }

    let insights = store.dashboard_insights("2026-08-10".parse().unwrap()).unwrap();

    assert!(
        insights.iter().any(|i| i.kind == "pace" && i.message.contains("Dining Out")),
        "expected a pace insight for Dining Out: {insights:?}"
    );
}

#[test]
fn dashboard_insights_skips_pace_projection_before_day_5_of_the_month() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Dining Out", "2026-08", "200.00".parse().unwrap(), "flexible").unwrap();
    store.save_transactions(account, &[tx("2026-08-02", "Cafe", "-100.00")]).unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
    }

    // Only 3 days into the month — too little signal to project from.
    let insights = store.dashboard_insights("2026-08-03".parse().unwrap()).unwrap();

    assert!(
        !insights.iter().any(|i| i.kind == "pace"),
        "expected no early-month pace insight: {insights:?}"
    );
}

#[test]
fn dashboard_insights_still_pace_projects_a_flexible_category_that_front_loaded_its_spend() {
    // The fix must not become "skip pace for anything paid early" —
    // a flexible category that happens to spend a lot on day 1 (e.g.
    // a big grocery haul) is exactly the case pace projection exists
    // for, and should still fire.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Groceries", "2026-09", "300.00".parse().unwrap(), "flexible").unwrap();
    store.save_transactions(account, &[tx("2026-09-01", "Costco", "-250.00")]).unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();
    }

    let insights = store.dashboard_insights("2026-09-06".parse().unwrap()).unwrap();

    assert!(
        insights.iter().any(|i| i.kind == "pace" && i.message.contains("Groceries")),
        "expected a pace insight for a front-loaded flexible category: {insights:?}"
    );
}

#[test]
fn dashboard_insights_skips_pace_projection_for_a_flexible_category_whose_history_is_a_single_lump_sum_each_month() {
    // Reproduces a real report: "Pet Care" is budgeted flexible, but
    // in practice it's one irregular vet/grooming charge a month, not
    // many small ones — its own history says so. A single $298.60
    // charge on day 2 must not be extrapolated into a nonsensical
    // month-end projection.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Pet Care", "2026-09", "150.00".parse().unwrap(), "flexible").unwrap();
    store
        .save_transactions(
            account,
            &[
                tx("2026-06-03", "Vet Clinic", "-120.00"),
                tx("2026-07-14", "Vet Clinic", "-140.00"),
                tx("2026-08-02", "Vet Clinic", "-130.00"),
                tx("2026-09-02", "Vet Clinic", "-298.60"),
            ],
        )
        .unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Pet Care", CategorySource::User, None).unwrap();
    }

    let insights = store.dashboard_insights("2026-09-06".parse().unwrap()).unwrap();

    assert!(
        !insights.iter().any(|i| i.kind == "pace" && i.message.contains("Pet Care")),
        "expected no pace insight for a category that's historically one lump sum a month: {insights:?}"
    );
}

#[test]
fn dashboard_insights_still_pace_projects_a_flexible_category_whose_history_shows_spend_spread_across_many_days() {
    // Contrast case: a category that's historically many small
    // charges spread across the month (typical Dining Out) must keep
    // getting paced even when, this month, it happens to front-load
    // onto one big early charge — the history-based skip must not
    // become "skip pacing for anything paid early" either.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Dining Out", "2026-09", "200.00".parse().unwrap(), "flexible").unwrap();
    store
        .save_transactions(
            account,
            &[
                tx("2026-06-03", "Cafe", "-20.00"),
                tx("2026-06-10", "Cafe", "-20.00"),
                tx("2026-06-18", "Cafe", "-20.00"),
                tx("2026-07-04", "Cafe", "-20.00"),
                tx("2026-07-12", "Cafe", "-20.00"),
                tx("2026-07-20", "Cafe", "-20.00"),
                tx("2026-08-02", "Cafe", "-20.00"),
                tx("2026-08-09", "Cafe", "-20.00"),
                tx("2026-08-17", "Cafe", "-20.00"),
                tx("2026-09-01", "Fancy Dinner", "-250.00"),
            ],
        )
        .unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
    }

    let insights = store.dashboard_insights("2026-09-06".parse().unwrap()).unwrap();

    assert!(
        insights.iter().any(|i| i.kind == "pace" && i.message.contains("Dining Out")),
        "expected a pace insight for a historically-recurring category even when front-loaded: {insights:?}"
    );
}

#[test]
fn dashboard_insights_skips_pace_projection_for_a_brand_new_category_dominated_by_one_outsized_purchase() {
    // Reproduces a real report: "Household" (budgeted $100, flexible)
    // had never been used before, then got a single $1,500 flooring
    // charge on day 2. With zero trailing history,
    // `average_spend_days_per_active_month` returns `None` — but
    // unlike a modest first charge (see
    // `dashboard_insights_flags_a_category_on_pace_to_exceed_its_budget`,
    // which must still pace-project), a lone transaction that already
    // dwarfs the entire monthly budget reads as a one-off big-ticket
    // purchase even without prior months to confirm it.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Household", "2026-09", "100.00".parse().unwrap(), "flexible").unwrap();
    store.save_transactions(account, &[tx("2026-09-02", "Flooring Co", "-1500.00")]).unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Household", CategorySource::User, None).unwrap();
    }

    let insights = store.dashboard_insights("2026-09-07".parse().unwrap()).unwrap();

    assert!(
        !insights.iter().any(|i| i.kind == "pace" && i.message.contains("Household")),
        "expected no pace insight for a brand-new category dominated by one outsized purchase: {insights:?}"
    );
}

#[test]
fn dashboard_insights_still_pace_projects_a_brand_new_category_once_spend_spans_more_than_one_day() {
    // Contrast case: the brand-new-category dampener above must not
    // become "skip pacing for any big first month" — once a
    // history-less category has spend on 2+ distinct days this month,
    // it's no longer a single dominating purchase, so the existing
    // permissive default (still project) applies even though the
    // running total is well past the budget.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Household", "2026-09", "100.00".parse().unwrap(), "flexible").unwrap();
    store
        .save_transactions(
            account,
            &[tx("2026-09-02", "Flooring Co", "-800.00"), tx("2026-09-05", "Hardware Store", "-800.00")],
        )
        .unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Household", CategorySource::User, None).unwrap();
    }

    let insights = store.dashboard_insights("2026-09-07".parse().unwrap()).unwrap();

    assert!(
        insights.iter().any(|i| i.kind == "pace" && i.message.contains("Household")),
        "expected a pace insight once a brand-new category's spend spans more than one day: {insights:?}"
    );
}

fn suggested(suggestions: &BudgetSuggestions, category: &str) -> Option<Decimal> {
    suggestions.lines.iter().find(|l| l.category == category).map(|l| l.suggested)
}

#[test]
fn suggest_budgets_averages_the_three_full_months_before_the_period() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    spend_on(&store, account, "2026-05-10", "Grocers May", "300.00", "Groceries");
    spend_on(&store, account, "2026-06-10", "Grocers Jun", "450.00", "Groceries");
    spend_on(&store, account, "2026-07-10", "Grocers Jul", "600.00", "Groceries");
    // The month being budgeted isn't part of its own average.
    spend_on(&store, account, "2026-08-02", "Grocers Aug", "9999.00", "Groceries");

    let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

    assert_eq!(s.months_used, 3);
    assert_eq!(suggested(&s, "Groceries"), Some("450".parse().unwrap()));
}

#[test]
fn suggest_budgets_rounds_to_a_whole_dollar() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    spend_on(&store, account, "2026-05-10", "Cafe May", "10.00", "Dining Out");
    spend_on(&store, account, "2026-06-10", "Cafe Jun", "10.00", "Dining Out");
    spend_on(&store, account, "2026-07-10", "Cafe Jul", "11.00", "Dining Out");

    let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

    // 31 / 3 = 10.33...
    assert_eq!(suggested(&s, "Dining Out"), Some("10".parse().unwrap()));
}

#[test]
fn suggest_budgets_counts_a_month_with_no_spend_as_zero() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    spend_on(&store, account, "2026-05-10", "Dentist", "60.00", "Health");
    // Give the account history in June and July so all three months count.
    spend_on(&store, account, "2026-06-10", "Grocers Jun", "10.00", "Groceries");
    spend_on(&store, account, "2026-07-10", "Grocers Jul", "10.00", "Groceries");

    let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

    assert_eq!(suggested(&s, "Health"), Some("20".parse().unwrap()));
}

#[test]
fn suggest_budgets_ignores_transfers_and_income() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    spend_on(&store, account, "2026-06-10", "To Savings", "500.00", "Transfer");
    store.save_transactions(account, &[tx("2026-06-15", "Paycheck", "2000.00")]).unwrap();
    let pay = id_of(&store, "Paycheck", "2026-06-15");
    store.set_category(pay, "Income", CategorySource::User, None).unwrap();
    spend_on(&store, account, "2026-06-20", "Grocers", "90.00", "Groceries");

    let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

    assert_eq!(suggested(&s, "Transfer"), None);
    assert_eq!(suggested(&s, "Income"), None);
    assert!(suggested(&s, "Groceries").is_some());
}

#[test]
fn suggest_budgets_reports_the_current_budget_and_group_of_a_budgeted_category() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Rent", "2026-08", "1500.00".parse().unwrap(), "fixed").unwrap();
    spend_on(&store, account, "2026-06-01", "Landlord Jun", "1500.00", "Rent");
    spend_on(&store, account, "2026-07-01", "Landlord Jul", "1500.00", "Rent");
    spend_on(&store, account, "2026-07-12", "Grocers", "300.00", "Groceries");

    let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

    let rent = s.lines.iter().find(|l| l.category == "Rent").unwrap();
    assert_eq!(rent.current, Some("1500.00".parse().unwrap()));
    assert_eq!(rent.budget_group, "fixed");
    let groceries = s.lines.iter().find(|l| l.category == "Groceries").unwrap();
    assert_eq!(groceries.current, None);
    assert_eq!(groceries.budget_group, "flexible");
}

#[test]
fn suggest_budgets_uses_only_the_months_that_have_history() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    // The first-ever transaction is in June, so May doesn't dilute the average.
    spend_on(&store, account, "2026-06-10", "Grocers Jun", "200.00", "Groceries");
    spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");

    let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

    assert_eq!(s.months_used, 2);
    assert_eq!(suggested(&s, "Groceries"), Some("250".parse().unwrap()));
}

#[test]
fn suggest_budgets_is_empty_when_there_is_no_history_before_the_period() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    spend_on(&store, account, "2026-08-05", "Grocers", "80.00", "Groceries");

    let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

    assert_eq!(s.months_used, 0);
    assert!(s.lines.is_empty());
}

#[test]
fn suggest_budgets_window_crosses_a_year_boundary() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    spend_on(&store, account, "2025-11-10", "Grocers Nov", "100.00", "Groceries");
    spend_on(&store, account, "2025-12-10", "Grocers Dec", "200.00", "Groceries");
    spend_on(&store, account, "2026-01-10", "Grocers Jan", "300.00", "Groceries");

    // Budgeting February looks back at Nov, Dec, Jan.
    let s = store.suggest_budgets_from_average(2026, 2, 3).unwrap();

    assert_eq!(s.months_used, 3);
    assert_eq!(suggested(&s, "Groceries"), Some("200".parse().unwrap()));
}

#[test]
fn suggest_budgets_lists_the_biggest_average_first_and_drops_sub_dollar_noise() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    spend_on(&store, account, "2026-07-01", "Grocers", "300.00", "Groceries");
    spend_on(&store, account, "2026-07-02", "Cafe", "90.00", "Dining Out");
    spend_on(&store, account, "2026-07-03", "Gum", "0.40", "Candy");

    let s = store.suggest_budgets_from_average(2026, 8, 3).unwrap();

    let names: Vec<&str> = s.lines.iter().map(|l| l.category.as_str()).collect();
    assert_eq!(names, vec!["Groceries", "Dining Out"]);
}

#[test]
fn month_review_reports_the_months_income_and_spending_beside_the_month_before() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-07-05", "Paycheck", "3000.00"),
                tx("2026-07-10", "Rent", "-1200.00"),
                tx("2026-08-05", "Paycheck", "3200.00"),
                tx("2026-08-10", "Rent", "-1200.00"),
                tx("2026-08-15", "Kroger", "-300.00"),
            ],
        )
        .unwrap();

    let r = store.month_review(2026, 8).unwrap();

    assert_eq!((r.income, r.expenses), (dec("3200.00"), dec("1500.00")));
    assert_eq!((r.prev_income, r.prev_expenses), (dec("3000.00"), dec("1200.00")));
}

#[test]
fn month_review_of_january_compares_with_the_previous_december() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2025-12-20", "Gifts", "-250.00"), tx("2026-01-05", "Kroger", "-100.00")])
        .unwrap();

    let r = store.month_review(2026, 1).unwrap();

    assert_eq!(r.prev_expenses, dec("250.00"));
    assert_eq!(r.expenses, dec("100.00"));
}

#[test]
fn month_review_lists_only_expense_categories_that_went_over_budget_biggest_overage_first() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Dining Out", "2026-08", dec("100"), "flexible").unwrap();
    store.set_budget("Groceries", "2026-08", dec("400"), "flexible").unwrap();
    store.set_budget("Gas", "2026-08", dec("150"), "flexible").unwrap();
    store.set_budget("Paycheck", "2026-08", dec("3000"), "income").unwrap();
    spend_on(&store, account, "2026-08-03", "Cafe", "260.00", "Dining Out");
    spend_on(&store, account, "2026-08-04", "Kroger", "430.00", "Groceries");
    spend_on(&store, account, "2026-08-05", "Shell", "90.00", "Gas");

    let r = store.month_review(2026, 8).unwrap();

    let over: Vec<(&str, Decimal, Decimal)> = r.over_budget.iter().map(|l| (l.category.as_str(), l.budgeted, l.actual)).collect();
    assert_eq!(
        over,
        vec![("Dining Out", dec("100"), dec("260.00")), ("Groceries", dec("400"), dec("430.00"))]
    );
}

#[test]
fn month_review_counts_the_months_uncategorized_transactions_and_their_total() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-02", "Mystery Vendor", "-40.00"),
                tx("2026-08-20", "Deposit", "25.00"),
                tx("2026-07-30", "Last Month Mystery", "-99.00"),
                tx("2026-09-01", "Next Month Mystery", "-77.00"),
            ],
        )
        .unwrap();

    let r = store.month_review(2026, 8).unwrap();

    assert_eq!(r.uncategorized_count, 2);
    assert_eq!(r.uncategorized_total, dec("65.00"));
}

#[test]
fn a_month_is_reviewed_only_once_marked_and_marking_twice_is_harmless() {
    let store = Store::open_in_memory().unwrap();
    assert!(!store.month_review(2026, 8).unwrap().reviewed);

    store.set_month_reviewed(2026, 8).unwrap();
    store.set_month_reviewed(2026, 8).unwrap();

    assert!(store.month_review(2026, 8).unwrap().reviewed);
    assert!(!store.month_review(2026, 7).unwrap().reviewed);
    assert_eq!(store.list_reviewed_months().unwrap(), vec!["2026-08".to_string()]);
}

/// Groceries budgeted `amount` in each of `months`, with rollover switched
/// on for the ones in `rolling`.
fn budget_groceries(store: &Store, months: &[&str], amount: &str, rolling: &[&str]) {
    for m in months {
        store.set_budget("Groceries", m, dec(amount), "flexible").unwrap();
    }
    for m in rolling {
        store.set_budget_rollover("Groceries", m, true).unwrap();
    }
}

fn groceries_line(store: &Store, year: i32, month: u32) -> BudgetActual {
    store
        .monthly_budget_actuals(year, month)
        .unwrap()
        .into_iter()
        .find(|l| l.category == "Groceries")
        .expect("a Groceries budget line")
}

#[test]
fn unspent_budget_rolls_into_the_next_month_when_rollover_is_on() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-07", "2026-08"]);
    spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");

    let aug = groceries_line(&store, 2026, 8);

    assert_eq!(aug.rollover, dec("100"));
    assert_eq!(aug.budgeted, dec("400"), "the budget itself is unchanged");
    assert!(aug.rollover_enabled);
}

#[test]
fn turning_the_rollover_feature_off_stops_money_carrying_and_touches_no_stored_choice() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-07", "2026-08"]);
    spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");
    let budgets_before = store.list_budgets("2026-08").unwrap();
    assert_eq!(groceries_line(&store, 2026, 8).rollover, dec("100"));

    store.set_rollover_enabled(false).unwrap();

    let aug = groceries_line(&store, 2026, 8);
    assert_eq!(aug.rollover, Decimal::ZERO, "nothing rolls in while the feature is off");
    assert_eq!(aug.budgeted, dec("400"));
    assert!(aug.rollover_enabled, "the category's own choice is remembered, not cleared");
    assert_eq!(store.list_budgets("2026-08").unwrap(), budgets_before, "toggling rewrites no budget row");
    assert_eq!(store.list_budgets("2026-07").unwrap().len(), 1, "earlier months keep their rows too");

    store.set_rollover_enabled(true).unwrap();
    assert_eq!(
        groceries_line(&store, 2026, 8).rollover,
        dec("100"),
        "turning it back on restores what was carried"
    );
}

#[test]
fn with_the_rollover_feature_off_alerts_and_the_month_review_use_the_plain_budget() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-07", "2026-08"]);
    spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");
    // August spending of 450 is over 400 but inside 400 + the 100 carried in.
    spend_on(&store, account, "2026-08-10", "Grocers Aug", "450.00", "Groceries");
    assert!(
        store.month_review(2026, 8).unwrap().over_budget.is_empty(),
        "the carried-in 100 covers it"
    );

    store.set_rollover_enabled(false).unwrap();

    let over = store.month_review(2026, 8).unwrap().over_budget;
    assert_eq!(over.len(), 1, "without the carry, August is over budget");
    assert_eq!(over[0].category, "Groceries");
    assert_eq!(over[0].budgeted, dec("400"));
}

#[test]
fn an_overspent_month_carries_nothing_forward() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-07", "2026-08"]);
    spend_on(&store, account, "2026-07-10", "Grocers Jul", "450.00", "Groceries");

    assert_eq!(groceries_line(&store, 2026, 8).rollover, Decimal::ZERO);
}

#[test]
fn without_rollover_nothing_carries_even_when_money_was_left() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    budget_groceries(&store, &["2026-07", "2026-08"], "400", &[]);
    spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");

    let aug = groceries_line(&store, 2026, 8);

    assert_eq!(aug.rollover, Decimal::ZERO);
    assert!(!aug.rollover_enabled);
}

#[test]
fn switching_rollover_on_starts_fresh_last_months_leftover_does_not_come_along() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-08"]);
    spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");

    assert_eq!(groceries_line(&store, 2026, 8).rollover, Decimal::ZERO);
}

#[test]
fn rollover_chains_across_several_months_counting_what_was_carried_in() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    budget_groceries(&store, &["2026-06", "2026-07", "2026-08"], "400", &["2026-06", "2026-07", "2026-08"]);
    spend_on(&store, account, "2026-06-10", "Grocers Jun", "300.00", "Groceries"); // 100 left
    spend_on(&store, account, "2026-07-10", "Grocers Jul", "350.00", "Groceries"); // 400 + 100 - 350 = 150 left

    assert_eq!(groceries_line(&store, 2026, 7).rollover, dec("100"));
    assert_eq!(groceries_line(&store, 2026, 8).rollover, dec("150"));
}

#[test]
fn a_gap_in_the_budget_breaks_the_chain() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    budget_groceries(&store, &["2026-06", "2026-08"], "400", &["2026-06", "2026-08"]);
    // July was touched but Groceries was deleted from it.
    store.set_budget("Rent", "2026-07", dec("1000"), "fixed").unwrap();
    spend_on(&store, account, "2026-06-10", "Grocers Jun", "100.00", "Groceries");

    assert_eq!(groceries_line(&store, 2026, 8).rollover, Decimal::ZERO);
}

#[test]
fn income_lines_never_roll_over() {
    let store = Store::open_in_memory().unwrap();
    for m in ["2026-07", "2026-08"] {
        store.set_budget("Paycheck", m, dec("3000"), "income").unwrap();
        store.set_budget_rollover("Paycheck", m, true).unwrap();
    }

    let aug = store
        .monthly_budget_actuals(2026, 8)
        .unwrap()
        .into_iter()
        .find(|l| l.category == "Paycheck")
        .unwrap();

    assert_eq!(aug.rollover, Decimal::ZERO);
}

#[test]
fn a_new_month_inherits_the_rollover_setting() {
    let store = Store::open_in_memory().unwrap();
    budget_groceries(&store, &["2026-08"], "400", &["2026-08"]);

    let september = store.list_budgets("2026-09").unwrap();

    assert!(september.iter().find(|b| b.category == "Groceries").unwrap().rollover_enabled);
}

#[test]
fn alerts_measure_spending_against_the_budget_plus_what_rolled_in() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-07", "2026-08"]);
    spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");
    spend_on(&store, account, "2026-08-10", "Grocers Aug", "450.00", "Groceries");

    let alerts = store.budget_alerts_for_month(2026, 8).unwrap();

    // 450 of 400 would be over; 450 of 500 is only a warning.
    assert_eq!(alerts.len(), 1);
    assert_eq!(alerts[0].level, "warning");
    assert_eq!(alerts[0].budgeted, dec("500"));
}

#[test]
fn the_month_review_counts_rolled_in_money_as_part_of_the_budget() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    budget_groceries(&store, &["2026-07", "2026-08"], "400", &["2026-07", "2026-08"]);
    spend_on(&store, account, "2026-07-10", "Grocers Jul", "300.00", "Groceries");
    spend_on(&store, account, "2026-08-10", "Grocers Aug", "450.00", "Groceries");
    assert!(store.month_review(2026, 8).unwrap().over_budget.is_empty(), "450 of 500 isn't over");

    spend_on(&store, account, "2026-08-20", "Grocers Aug 2", "100.00", "Groceries");
    let over = store.month_review(2026, 8).unwrap().over_budget;

    assert_eq!(over.len(), 1);
    assert_eq!((over[0].budgeted, over[0].actual), (dec("500"), dec("550.00")));
}

#[test]
fn setting_rollover_on_a_missing_line_is_harmless() {
    let store = Store::open_in_memory().unwrap();

    store.set_budget_rollover("Nope", "2026-08", true).unwrap();

    assert!(store.list_budgets("2026-08").unwrap().is_empty());
}

#[test]
fn spending_drilldown_reconciles_split_lines_to_the_category_chart() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-05", "Market", "-100.00"),
                tx("2026-08-06", "Grocer", "-25.00"),
                tx("2026-08-07", "Refund", "10.00"),
            ],
        )
        .unwrap();
    let market = id_of(&store, "Market", "2026-08-05");
    store.set_category(market, "Groceries", CategorySource::User, None).unwrap();
    store
        .set_transaction_splits(
            market,
            &[
                ("Groceries".to_string(), dec("-60.00"), None),
                ("Household".to_string(), dec("-40.00"), None),
            ],
        )
        .unwrap();
    store
        .set_category(id_of(&store, "Grocer", "2026-08-06"), "Groceries", CategorySource::User, None)
        .unwrap();
    store
        .set_category(id_of(&store, "Refund", "2026-08-07"), "Groceries", CategorySource::User, None)
        .unwrap();

    let rows = store.spending_transactions_for_category_in_month("Groceries", 2026, 8).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().any(|row| row.is_split && row.amount == dec("-60.00")));
    let detail_total: Decimal = rows.iter().map(|row| -row.amount).sum();
    let chart_total = store
        .spending_by_category(day("2026-08-01"), day("2026-08-31"))
        .unwrap()
        .into_iter()
        .find(|(category, _)| category == "Groceries")
        .unwrap()
        .1;
    assert_eq!(detail_total, chart_total);
    assert_eq!(chart_total, dec("85.00"));
    assert!(
        store
            .spending_transactions_for_category_in_month("Groceries", 2026, 7)
            .unwrap()
            .is_empty()
    );
}
