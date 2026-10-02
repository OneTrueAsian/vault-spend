use super::*;

// Transfers between the user's own accounts are neither spending nor
// income -- `monthly_totals` already excluded them, but every other
// spend-shaped query below (category breakdown, top merchants,
// recurring suggestions, runway's average spend, "unusually large"
// flags) counted them as ordinary spending, so a monthly savings
// transfer showed up as a $500 "Transfer" slice of the spending donut,
// ranked as a "merchant", and got suggested as a recurring bill.

#[test]
fn adding_an_asset_does_not_change_historical_net_worth() {
    // Locks in the deliberate design decision: manual assets carry only
    // a current value, so retroactively applying it to every past point
    // on the net-worth trend would misrepresent history — they feed the
    // *current* net-worth figure only (computed client-side from
    // `total_assets_value`), never `net_worth_as_of`.
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    let before = store.net_worth_as_of("2026-08-20".parse().unwrap()).unwrap();

    store
        .create_asset("Home", "real_estate", "350000.00".parse().unwrap(), "2026-08-01".parse().unwrap(), None)
        .unwrap();

    let after = store.net_worth_as_of("2026-08-20".parse().unwrap()).unwrap();

    assert_eq!(before, after);
}

#[test]
fn monthly_totals_sums_income_and_expense_separately_for_one_month() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-01", "Payroll Deposit", "3000.00"),
                tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                tx("2026-08-10", "Fresh Market", "-40.00"),
                tx("2026-07-25", "Old Month Payroll", "2000.00"), // different month, excluded
            ],
        )
        .unwrap();

    let (income, expense) = store.monthly_totals(2026, 8).unwrap();

    assert_eq!(income, "3000.00".parse().unwrap());
    assert_eq!(expense, "120.00".parse().unwrap());
}

#[test]
fn monthly_totals_excludes_transactions_categorized_transfer_on_both_sides() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-01", "Payroll Deposit", "3000.00"),
                tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                Transaction {
                    category: Some("Transfer".to_string()),
                    ..tx("2026-08-10", "To Savings", "-6000.00")
                },
                Transaction {
                    category: Some("Transfer".to_string()),
                    ..tx("2026-08-10", "From Checking", "6000.00")
                },
            ],
        )
        .unwrap();

    let (income, expense) = store.monthly_totals(2026, 8).unwrap();

    assert_eq!(income, "3000.00".parse().unwrap(), "the $6,000 transfer-in must not count as income");
    assert_eq!(expense, "80.00".parse().unwrap(), "the $6,000 transfer-out must not count as spending");
}

#[test]
fn monthly_totals_for_range_matches_calling_monthly_totals_once_per_month() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-06-01", "Payroll Deposit", "3000.00"),
                tx("2026-06-05", "Green Leaf Grocers", "-80.00"),
                tx("2026-07-01", "Payroll Deposit", "3000.00"),
                // August has zero transactions -- must still report as
                // (0, 0) via the caller's default, not be a crash or a
                // dropped month.
                tx("2026-09-01", "Payroll Deposit", "3000.00"),
                tx("2026-09-10", "Fresh Market", "-40.00"),
            ],
        )
        .unwrap();

    let batched = store.monthly_totals_for_range(2026, 6, 2026, 9).unwrap();

    for (year, month) in [(2026, 6), (2026, 7), (2026, 8), (2026, 9)] {
        let expected = store.monthly_totals(year, month).unwrap();
        let actual = batched.get(&(year, month)).copied().unwrap_or((Decimal::ZERO, Decimal::ZERO));
        assert_eq!(actual, expected, "mismatch for {year}-{month:02}");
    }
    assert!(
        !batched.contains_key(&(2026, 8)),
        "a zero-activity month should have no entry, not a (0,0) row"
    );
}

#[test]
fn monthly_totals_for_range_also_excludes_transfer_categorized_transactions() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-06-01", "Payroll Deposit", "3000.00"),
                Transaction {
                    category: Some("Transfer".to_string()),
                    ..tx("2026-06-15", "To Savings", "-500.00")
                },
                Transaction {
                    category: Some("Transfer".to_string()),
                    ..tx("2026-06-15", "From Checking", "500.00")
                },
            ],
        )
        .unwrap();

    let batched = store.monthly_totals_for_range(2026, 6, 2026, 6).unwrap();

    assert_eq!(batched.get(&(2026, 6)).copied().unwrap(), ("3000.00".parse().unwrap(), Decimal::ZERO));
}

#[test]
fn monthly_totals_never_counts_a_positive_credit_card_transaction_as_income() {
    // A credit card payment recorded as an ordinary deposit (not
    // linked via apply_debt_payment) — the real production shape that
    // inflated a family member's reported income by over 50x. The
    // charge on checking (an expense) still counts normally.
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let credit_card = store.get_or_create_account("Visa", AccountType::Credit).unwrap();
    store
        .save_transactions(checking, &[tx("2026-08-20", "WITHDRAWAL VISA", "-200.00")])
        .unwrap();
    store
        .save_transactions(credit_card, &[tx("2026-08-21", "VISA ONLINE PYMT", "200.00")])
        .unwrap();

    let (income, expense) = store.monthly_totals(2026, 8).unwrap();

    assert_eq!(income, Decimal::ZERO, "the credit card deposit must not count as income");
    assert_eq!(expense, "200.00".parse().unwrap(), "the checking withdrawal still counts as spending");
}

#[test]
fn monthly_totals_still_counts_a_credit_card_charge_as_spending() {
    let store = Store::open_in_memory().unwrap();
    let credit_card = store.get_or_create_account("Visa", AccountType::Credit).unwrap();
    store.save_transactions(credit_card, &[tx("2026-08-20", "Groceries", "-80.00")]).unwrap();

    let (income, expense) = store.monthly_totals(2026, 8).unwrap();

    assert_eq!(income, Decimal::ZERO);
    assert_eq!(
        expense,
        "80.00".parse().unwrap(),
        "a charge is still real spending, only positive amounts are excluded"
    );
}

#[test]
fn monthly_totals_never_counts_a_positive_loan_transaction_as_income() {
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
    store.save_transactions(loan, &[tx("2026-08-20", "Escrow Refund", "75.00")]).unwrap();

    let (income, _) = store.monthly_totals(2026, 8).unwrap();

    assert_eq!(income, Decimal::ZERO);
}

#[test]
fn monthly_totals_for_range_also_never_counts_a_credit_card_payment_as_income() {
    let store = Store::open_in_memory().unwrap();
    let credit_card = store.get_or_create_account("Visa", AccountType::Credit).unwrap();
    store
        .save_transactions(credit_card, &[tx("2026-06-10", "VISA ONLINE PYMT", "200.00")])
        .unwrap();

    let batched = store.monthly_totals_for_range(2026, 6, 2026, 6).unwrap();

    assert_eq!(batched.get(&(2026, 6)).copied().unwrap(), (Decimal::ZERO, Decimal::ZERO));
}

#[test]
fn spending_by_category_sums_expenses_within_a_date_range_sorted_descending() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                tx("2026-08-10", "Fresh Market", "-40.00"),
                tx("2026-08-12", "Ferrywood Coffee", "-200.00"),
                tx("2026-08-15", "Payroll Deposit", "3000.00"), // income, excluded
                tx("2026-07-01", "Old Grocers", "-999.00"),     // outside range, excluded
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    store.set_category(ids[0], "Groceries", CategorySource::User, None).unwrap();
    store.set_category(ids[1], "Groceries", CategorySource::User, None).unwrap();
    store.set_category(ids[2], "Dining Out", CategorySource::User, None).unwrap();

    let spend = store
        .spending_by_category("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
        .unwrap();

    assert_eq!(
        spend,
        vec![
            ("Dining Out".to_string(), "200.00".parse().unwrap()),
            ("Groceries".to_string(), "120.00".parse().unwrap()),
        ]
    );
}

#[test]
fn top_merchants_ranks_by_total_spend_and_respects_the_limit() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                tx("2026-08-10", "Green Leaf Grocers", "-40.00"),
                tx("2026-08-12", "Ferrywood Coffee", "-200.00"),
                tx("2026-08-14", "Corner Store", "-10.00"),
                tx("2026-08-15", "Payroll Deposit", "3000.00"), // income, excluded
            ],
        )
        .unwrap();

    let top = store
        .top_merchants("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap(), 2)
        .unwrap();

    assert_eq!(
        top,
        vec![
            ("Ferrywood Coffee".to_string(), "200.00".parse().unwrap()),
            ("Green Leaf Grocers".to_string(), "120.00".parse().unwrap()),
        ]
    );
}

#[test]
fn spending_by_category_excludes_the_transfer_category() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                Transaction {
                    category: Some("Transfer".to_string()),
                    ..tx("2026-08-10", "To Savings", "-500.00")
                },
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    store.set_category(ids[0], "Groceries", CategorySource::User, None).unwrap();

    let spend = store
        .spending_by_category("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
        .unwrap();

    assert_eq!(spend, vec![("Groceries".to_string(), "80.00".parse().unwrap())]);
}

#[test]
fn top_merchants_excludes_transactions_categorized_transfer() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-05", "Green Leaf Grocers", "-80.00"),
                Transaction {
                    category: Some("Transfer".to_string()),
                    ..tx("2026-08-10", "Transfer to Savings", "-500.00")
                },
            ],
        )
        .unwrap();

    let top = store
        .top_merchants("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap(), 5)
        .unwrap();

    assert_eq!(top, vec![("Green Leaf Grocers".to_string(), "80.00".parse().unwrap())]);
}

#[test]
fn a_linked_pair_is_neither_income_nor_spending_whatever_its_category() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
    let (checking, _) = checking_and_savings(&store);
    store
        .save_transactions(checking, &[tx("2026-08-01", "Payroll Deposit", "3000.00")])
        .unwrap();

    // Before linking, the pair counts as $500 of spending and $500 of income.
    let (income, expense) = store.monthly_totals(2026, 8).unwrap();
    assert_eq!((income, expense), ("3500.00".parse().unwrap(), "500.00".parse().unwrap()));

    store.link_transfer(out_id, in_id).unwrap();

    let (income, expense) = store.monthly_totals(2026, 8).unwrap();
    assert_eq!(income, "3000.00".parse().unwrap());
    assert_eq!(expense, Decimal::ZERO);
    let ranged = store.monthly_totals_for_range(2026, 8, 2026, 8).unwrap();
    assert_eq!(ranged[&(2026, 8)], ("3000.00".parse().unwrap(), Decimal::ZERO));
    assert_eq!(store.income_total().unwrap(), "3000.00".parse().unwrap());
    let (first, last) = ("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap());
    assert!(store.spending_by_category(first, last).unwrap().is_empty());
    assert!(store.top_merchants(first, last, 5).unwrap().is_empty());
    assert_eq!(store.average_monthly_spend("2026-08-31".parse().unwrap()).unwrap(), Decimal::ZERO);
}

#[test]
fn net_worth_as_of_only_counts_transactions_up_to_that_date() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    store
        .save_transactions(
            checking,
            &[
                tx("2026-07-15", "Payroll Deposit", "500.00"),
                tx("2026-08-15", "Payroll Deposit", "500.00"), // after the cutoff below
            ],
        )
        .unwrap();

    let as_of_july: NaiveDate = "2026-07-31".parse().unwrap();
    let as_of_august: NaiveDate = "2026-08-31".parse().unwrap();

    assert_eq!(store.net_worth_as_of(as_of_july).unwrap(), "1500.00".parse().unwrap());
    assert_eq!(store.net_worth_as_of(as_of_august).unwrap(), "2000.00".parse().unwrap());
}

#[test]
fn net_worth_as_of_counts_debt_as_negative() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
    store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap(); // limit
    store
        .save_transactions(card, &[tx("2026-08-05", "Grocery Store", "-300.00")]) // a charge -> $300 owed
        .unwrap();

    let net_worth = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

    // 1000 cash - 300 owed on the card = 700
    assert_eq!(net_worth, "700.00".parse().unwrap());
}

#[test]
fn net_worth_breakdown_as_of_splits_cash_debt_and_investments() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
    store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap(); // limit
    store.save_transactions(card, &[tx("2026-08-05", "Grocery Store", "-300.00")]).unwrap(); // $300 owed
    let loan = store.get_or_create_account("Auto Loan", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "15000.00".parse().unwrap()).unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    store.set_account_starting_balance(brokerage, "5000.00".parse().unwrap()).unwrap();

    let breakdown = store.net_worth_breakdown_as_of("2026-08-31".parse().unwrap()).unwrap();

    assert_eq!(breakdown.cash, "1000.00".parse().unwrap());
    // -300 (card) + -15000 (loan) = -15300 owed
    assert_eq!(breakdown.debt, "-15300.00".parse().unwrap());
    assert_eq!(breakdown.investments, "5000.00".parse().unwrap());
    // 1000 cash - 300 owed - 15000 owed + 5000 investments = -9300
    assert_eq!(breakdown.net_worth, "-9300.00".parse().unwrap());
    assert_eq!(breakdown.net_worth, store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap());
}

#[test]
fn account_contribution_deltas_flags_the_account_that_actually_changed() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
    store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap(); // limit
    let loan = store.get_or_create_account("Auto Loan", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "15000.00".parse().unwrap()).unwrap();
    // Only the card gets a new charge between the two dates; the loan sits untouched.
    store.save_transactions(card, &[tx("2026-08-05", "Grocery Store", "-300.00")]).unwrap();

    let deltas = store
        .account_contribution_deltas("2026-07-31".parse().unwrap(), "2026-08-31".parse().unwrap())
        .unwrap();

    assert_eq!(deltas.len(), 1, "expected only the card to show a change: {deltas:?}");
    assert_eq!(deltas[0].name, "Sapphire Rewards");
    assert_eq!(deltas[0].group, "credit");
    // Owing $300 more is a $300 drop in net-worth contribution.
    assert_eq!(deltas[0].delta, "-300.00".parse().unwrap());
}

#[test]
fn account_contribution_deltas_excludes_an_account_with_no_net_change() {
    let store = Store::open_in_memory().unwrap();
    let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
    store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap();
    // Charged, then paid back in full before the "to" date — net change is zero.
    store
        .save_transactions(
            card,
            &[tx("2026-08-05", "Grocery Store", "-300.00"), tx("2026-08-10", "Payment", "300.00")],
        )
        .unwrap();

    let deltas = store
        .account_contribution_deltas("2026-07-31".parse().unwrap(), "2026-08-31".parse().unwrap())
        .unwrap();

    assert!(deltas.is_empty(), "a net-zero change shouldn't be reported: {deltas:?}");
}

#[test]
fn account_contribution_deltas_sums_to_the_same_change_the_aggregate_breakdown_reports() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    let card = store.get_or_create_account("Sapphire Rewards", AccountType::Credit).unwrap();
    store.set_account_starting_balance(card, "2000.00".parse().unwrap()).unwrap();
    let loan = store.get_or_create_account("Auto Loan", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "15000.00".parse().unwrap()).unwrap();
    store.save_transactions(card, &[tx("2026-08-05", "Grocery Store", "-300.00")]).unwrap();
    store.save_transactions(loan, &[tx("2026-08-10", "Loan Payment", "500.00")]).unwrap();

    let from: NaiveDate = "2026-07-31".parse().unwrap();
    let to: NaiveDate = "2026-08-31".parse().unwrap();
    let deltas = store.account_contribution_deltas(from, to).unwrap();
    let breakdown_from = store.net_worth_breakdown_as_of(from).unwrap();
    let breakdown_to = store.net_worth_breakdown_as_of(to).unwrap();

    let debt_delta_sum: Decimal = deltas.iter().filter(|d| d.group == "credit" || d.group == "loan").map(|d| d.delta).sum();
    assert_eq!(debt_delta_sum, breakdown_to.debt - breakdown_from.debt);
}

#[test]
fn net_worth_as_of_counts_a_loans_starting_balance_as_debt_from_day_one() {
    // A loan's `starting_balance` is the amount already owed (unlike a
    // credit account's, which is a limit and starts at $0 owed) — so
    // with no transactions yet, the whole thing must count as debt.
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    let loan = store.get_or_create_account("Auto Loan", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "15000.00".parse().unwrap()).unwrap();

    let net_worth = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

    // 1000 cash - 15000 owed on the loan = -14000
    assert_eq!(net_worth, "-14000.00".parse().unwrap());
}

#[test]
fn net_worth_as_of_reduces_loan_debt_as_payments_are_made() {
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Auto Loan", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "15000.00".parse().unwrap()).unwrap();
    store.save_transactions(loan, &[tx("2026-08-05", "Loan Payment", "500.00")]).unwrap();

    let net_worth = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

    // Owed drops from 15000 to 14500 after a 500 payment.
    assert_eq!(net_worth, "-14500.00".parse().unwrap());
}

#[test]
fn net_worth_as_of_before_a_reset_is_unaffected_by_it() {
    // The whole point of resetting via a new row instead of mutating
    // starting_balance in place: a past lookup must keep using
    // whatever was true back then, never a later reset's value.
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-08-10", "Deposit", "500.00")]).unwrap();
    let before_reset = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

    // Roll forward into September, then add a large September transaction.
    store.roll_forward_monthly_balances("2026-09-01".parse().unwrap()).unwrap();
    store.save_transactions(checking, &[tx("2026-09-15", "Big Deposit", "50000.00")]).unwrap();

    let after_reset_and_more_activity = store.net_worth_as_of("2026-08-31".parse().unwrap()).unwrap();

    assert_eq!(before_reset, "1500.00".parse().unwrap());
    assert_eq!(
        after_reset_and_more_activity, before_reset,
        "an August lookup must be untouched by a September reset or later transactions"
    );
}

#[test]
fn category_spending_is_totaled_per_month_and_category_as_positive_amounts() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    spend_on(&store, account, "2026-07-05", "Kroger", "80.00", "Groceries");
    spend_on(&store, account, "2026-07-19", "Aldi", "40.00", "Groceries");
    spend_on(&store, account, "2026-07-20", "Cafe", "12.50", "Dining Out");
    spend_on(&store, account, "2026-08-02", "Kroger", "95.00", "Groceries");

    let rows = store.category_spending_by_month(2026, 7, 2026, 8).unwrap();

    assert_eq!(month_cell(&rows, "2026-07", "Groceries"), Some(dec("120.00")));
    assert_eq!(month_cell(&rows, "2026-07", "Dining Out"), Some(dec("12.50")));
    assert_eq!(month_cell(&rows, "2026-08", "Groceries"), Some(dec("95.00")));
    assert_eq!(
        month_cell(&rows, "2026-08", "Dining Out"),
        None,
        "a category with no spend that month has no row"
    );
}

#[test]
fn category_spending_stays_inside_the_range_including_across_a_year_end() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    spend_on(&store, account, "2025-11-30", "Too early", "10.00", "Groceries");
    spend_on(&store, account, "2025-12-15", "In", "20.00", "Groceries");
    spend_on(&store, account, "2026-01-31", "Also in", "30.00", "Groceries");
    spend_on(&store, account, "2026-02-01", "Too late", "40.00", "Groceries");

    let rows = store.category_spending_by_month(2025, 12, 2026, 1).unwrap();

    assert_eq!(rows.len(), 2);
    assert_eq!(month_cell(&rows, "2025-12", "Groceries"), Some(dec("20.00")));
    assert_eq!(month_cell(&rows, "2026-01", "Groceries"), Some(dec("30.00")));
}

#[test]
fn daily_spending_is_totaled_per_day_across_categories() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    spend_on(&store, account, "2026-07-05", "Kroger", "80.00", "Groceries");
    spend_on(&store, account, "2026-07-05", "Cafe", "12.50", "Dining Out");
    spend_on(&store, account, "2026-07-06", "Aldi", "40.00", "Groceries");

    let rows = store.daily_spending(2026, 7, 2026, 7).unwrap();

    assert_eq!(day_cell(&rows, "2026-07-05"), Some(dec("92.50")));
    assert_eq!(day_cell(&rows, "2026-07-06"), Some(dec("40.00")));
    assert_eq!(day_cell(&rows, "2026-07-07"), None, "a day with no spend has no row");
}

#[test]
fn daily_spending_stays_inside_the_range_including_across_a_year_end() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    spend_on(&store, account, "2025-11-30", "Too early", "10.00", "Groceries");
    spend_on(&store, account, "2025-12-15", "In", "20.00", "Groceries");
    spend_on(&store, account, "2026-01-31", "Also in", "30.00", "Groceries");
    spend_on(&store, account, "2026-02-01", "Too late", "40.00", "Groceries");

    let rows = store.daily_spending(2025, 12, 2026, 1).unwrap();

    assert_eq!(rows.len(), 2);
    assert_eq!(day_cell(&rows, "2025-12-15"), Some(dec("20.00")));
    assert_eq!(day_cell(&rows, "2026-01-31"), Some(dec("30.00")));
}
