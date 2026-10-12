use super::*;

// One month of awkward data checked against every screen's own total: the same dollars must be
// counted the same way by Budget, Reports, Cash Flow and the Budget drill-down. Each query has its
// own SQL, so a rule fixed in one and missed in another only shows up when they are compared.

fn d(text: &str) -> Decimal {
    text.parse().unwrap()
}

/// Checking + savings + a loan, with: payroll; two grocery buys on the first and last day of the
/// month; a buy on each neighbouring month's boundary day; a linked transfer pair into savings
/// (categorized like a budgeted goal); a split purchase; a loan payment applied to the debt; and a
/// deleted purchase.
fn awkward_month(store: &Store) {
    let (checking, savings) = checking_and_savings(store);
    let loan = store.create_account("Car Loan", AccountType::Loan).unwrap().unwrap();
    store
        .save_transactions(
            checking,
            &[
                Transaction {
                    category: Some("Income".into()),
                    ..tx("2026-08-01", "Payroll", "3000.00")
                },
                Transaction {
                    category: Some("Groceries".into()),
                    ..tx("2026-08-01", "First day groceries", "-100.00")
                },
                Transaction {
                    category: Some("Groceries".into()),
                    ..tx("2026-08-31", "Last day groceries", "-50.00")
                },
                Transaction {
                    category: Some("Groceries".into()),
                    ..tx("2026-07-31", "Previous month groceries", "-70.00")
                },
                Transaction {
                    category: Some("Groceries".into()),
                    ..tx("2026-09-01", "Next month groceries", "-40.00")
                },
                Transaction {
                    category: Some("Savings Goal".into()),
                    ..tx("2026-08-10", "Move to savings", "-500.00")
                },
                tx("2026-08-12", "Big box store", "-200.00"),
                Transaction {
                    category: Some("Imported".into()),
                    ..tx("2026-08-15", "Loan payment", "-300.00")
                },
                Transaction {
                    category: Some("Groceries".into()),
                    ..tx("2026-08-20", "Deleted groceries", "-999.00")
                },
            ],
        )
        .unwrap();
    store
        .save_transactions(
            savings,
            &[Transaction {
                category: Some("Savings Goal".into()),
                ..tx("2026-08-11", "Deposit from checking", "500.00")
            }],
        )
        .unwrap();
    let id = |description: &str| {
        store
            .all_transactions()
            .unwrap()
            .into_iter()
            .find(|t| t.transaction.description == description)
            .unwrap()
            .id
    };
    store.link_transfer(id("Move to savings"), id("Deposit from checking")).unwrap();
    store
        .set_transaction_splits(
            id("Big box store"),
            &[
                ("Groceries".to_string(), d("-120.00"), None),
                ("Household".to_string(), d("-80.00"), None),
            ],
        )
        .unwrap();
    store
        .apply_debt_payment(id("Loan payment"), loan, d("300.00"), "2026-08-15".parse().unwrap())
        .unwrap();
    store.delete_transaction(id("Deleted groceries"), test_now()).unwrap();
    for category in ["Groceries", "Household", "Savings Goal"] {
        store.set_budget(category, "0000-01", d("1000.00"), "flexible").unwrap();
    }
}

#[test]
fn every_total_counts_the_same_august_spending() {
    let store = Store::open_in_memory().unwrap();
    awkward_month(&store);
    let first: NaiveDate = "2026-08-01".parse().unwrap();
    let last: NaiveDate = "2026-08-31".parse().unwrap();

    let (income, expense) = store.monthly_totals(2026, 8).unwrap();
    let ranged = store.monthly_totals_for_range(2026, 8, 2026, 8).unwrap();
    let by_category: Decimal = store.spending_by_category(first, last).unwrap().iter().map(|(_, amount)| *amount).sum();
    let by_month: Decimal = store
        .category_spending_by_month(2026, 8, 2026, 8)
        .unwrap()
        .iter()
        .map(|row| row.amount)
        .sum();
    let by_day: Decimal = store.daily_spending(2026, 8, 2026, 8).unwrap().iter().map(|row| row.amount).sum();
    let merchants: Decimal = store.top_merchants(first, last, 100).unwrap().iter().map(|(_, amount)| *amount).sum();
    let compared: Decimal = store
        .comparison_snapshot(last, first)
        .unwrap()
        .spend_rows
        .iter()
        .map(|row| row.amount)
        .sum();
    let budget: std::collections::BTreeMap<String, Decimal> = store
        .monthly_budget_actuals(2026, 8)
        .unwrap()
        .into_iter()
        .map(|line| (line.category, line.actual))
        .collect();

    // Payroll in; groceries 100 + 50, split purchase 200, loan payment 300 out. The transfer pair
    // and the generated debt row are not spending, and neighbouring months and deleted rows are out.
    assert_eq!(income, d("3000.00"));
    assert_eq!(expense, d("650.00"));
    assert_eq!(ranged.get(&(2026, 8)).copied(), Some((income, expense)));
    assert_eq!(by_category, expense, "Reports' category breakdown must add up to the month's expense");
    assert_eq!(by_month, expense, "Reports' category-by-month table must add up to the month's expense");
    assert_eq!(compared, expense, "Comparisons' spending rows must add up to the month's expense");
    assert_eq!(by_day, expense, "Reports' daily heatmap must add up to the month's expense");
    // Merchants list whole purchases (the split purchase is one merchant row), so it is the same
    // total as long as the transfer and the generated debt row stay out of it.
    assert_eq!(merchants, expense, "Reports' top merchants must add up to the month's expense");
    assert_eq!(budget["Groceries"], d("270.00"), "Budget: groceries 150 plus the 120 split line");
    assert_eq!(budget["Household"], d("80.00"));
    assert_eq!(
        budget["Savings Goal"],
        Decimal::ZERO,
        "Budget must not count the two legs of a linked transfer as spending, as every other screen does"
    );
}

#[test]
fn the_budget_drill_down_lists_the_same_dollars_as_the_budget_line() {
    let store = Store::open_in_memory().unwrap();
    awkward_month(&store);
    for category in ["Groceries", "Household", "Savings Goal"] {
        let line = store
            .monthly_budget_actuals(2026, 8)
            .unwrap()
            .into_iter()
            .find(|line| line.category == category)
            .unwrap();
        let listed: Decimal = store
            .spending_transactions_for_category_in_month(category, 2026, 8)
            .unwrap()
            .iter()
            .map(|row| -row.amount)
            .filter(|amount| *amount > Decimal::ZERO)
            .sum();
        assert_eq!(listed, line.actual, "{category}: the list behind a budget line must add up to the line");
    }
}
