use super::*;

#[test]
fn debt_payoff_projection_with_no_debt_resolves_immediately() {
    let store = Store::open_in_memory().unwrap();
    store.get_or_create_account("Checking", AccountType::Checking).unwrap();

    let plan = store
        .debt_payoff_projection("snowball", Decimal::ZERO, &[], "2026-08-20".parse().unwrap())
        .unwrap();

    assert!(plan.per_account.is_empty());
    assert_eq!(plan.total_months, Some(0));
    assert_eq!(plan.total_interest_paid, Decimal::ZERO);
}

#[test]
fn debt_payoff_projection_pays_off_a_zero_interest_loan_using_only_the_minimum() {
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "1200.00".parse().unwrap()).unwrap();

    let plan = store
        .debt_payoff_projection(
            "snowball",
            Decimal::ZERO,
            &[(loan, "100.00".parse().unwrap())],
            "2026-08-20".parse().unwrap(),
        )
        .unwrap();

    assert_eq!(plan.per_account.len(), 1);
    assert_eq!(plan.per_account[0].payoff_date, Some("2027-08-20".parse().unwrap()));
    assert_eq!(plan.per_account[0].total_interest_paid, Decimal::ZERO);
    assert_eq!(plan.total_months, Some(12));
}

#[test]
fn debt_payoff_projection_snowball_pays_off_the_smaller_balance_first_and_rolls_its_minimum_forward() {
    let store = Store::open_in_memory().unwrap();
    let small = store.get_or_create_account("Small Debt", AccountType::Loan).unwrap();
    store.set_account_starting_balance(small, "100.00".parse().unwrap()).unwrap();
    let big = store.get_or_create_account("Big Debt", AccountType::Loan).unwrap();
    store.set_account_starting_balance(big, "1000.00".parse().unwrap()).unwrap();

    let plan = store
        .debt_payoff_projection(
            "snowball",
            Decimal::ZERO,
            &[(small, "100.00".parse().unwrap()), (big, "10.00".parse().unwrap())],
            "2026-08-20".parse().unwrap(),
        )
        .unwrap();

    let small_line = plan.per_account.iter().find(|l| l.account_id == small).unwrap();
    assert!(plan.per_account.iter().any(|l| l.account_id == big));

    // Small Debt clears in month 1 (its $100 minimum covers the whole
    // $100 balance in one shot).
    assert_eq!(small_line.payoff_date, Some("2026-09-20".parse().unwrap()));
    // Once freed, Small Debt's $100 minimum rolls into Big Debt on top
    // of its own $10 — $110/month clears $1000 in well under the ~100
    // months a flat $10/month alone would take.
    let big_months = plan.total_months.unwrap();
    assert!(
        big_months < 20,
        "expected the rolled-over minimum to accelerate payoff, got {big_months} months"
    );
}

#[test]
fn debt_payoff_projection_extra_payment_shortens_the_timeline() {
    let store = Store::open_in_memory().unwrap();
    let loan = store.get_or_create_account("Loan", AccountType::Loan).unwrap();
    store.set_account_starting_balance(loan, "5000.00".parse().unwrap()).unwrap();

    let without_extra = store
        .debt_payoff_projection(
            "snowball",
            Decimal::ZERO,
            &[(loan, "100.00".parse().unwrap())],
            "2026-08-20".parse().unwrap(),
        )
        .unwrap()
        .total_months
        .unwrap();
    let with_extra = store
        .debt_payoff_projection(
            "snowball",
            "200.00".parse().unwrap(),
            &[(loan, "100.00".parse().unwrap())],
            "2026-08-20".parse().unwrap(),
        )
        .unwrap()
        .total_months
        .unwrap();

    assert!(with_extra < without_extra);
}

#[test]
fn cash_flow_forecast_stays_flat_with_no_transaction_history() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 30).unwrap();

    assert_eq!(points.len(), 31);
    assert!(points.iter().all(|p| p.balance == "1000.00".parse().unwrap()));
    assert_eq!(points[0].date, "2026-08-20".parse().unwrap());
    assert_eq!(points[30].date, "2026-09-19".parse().unwrap());
}

#[test]
fn cash_flow_forecast_projects_the_trailing_average_daily_net_forward() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "0.00".parse().unwrap()).unwrap();
    // Earliest activity is 10 days before "today" (clamps the window to
    // 10 days, not the full 90) — balance there is $1000. Two more
    // transactions bring it to $1800 by today: a net gain of $800 over
    // 10 days = $80/day.
    store
        .save_transactions(
            checking,
            &[
                tx("2026-08-10", "Opening balance", "1000.00"),
                tx("2026-08-15", "Paycheck", "500.00"),
                tx("2026-08-20", "Side income", "300.00"),
            ],
        )
        .unwrap();

    let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 10).unwrap();

    assert_eq!(points[0].balance, "1800.00".parse().unwrap());
    assert_eq!(points[1].balance, "1880.00".parse().unwrap());
    assert_eq!(points[10].balance, "2600.00".parse().unwrap());
}

#[test]
fn cash_flow_forecast_clamps_the_window_to_available_history_not_a_blind_90_days() {
    // If the $80/day-net test above instead divided by a blind 90 days
    // (rather than the 10 days of history that actually exist), the
    // slope would come out roughly 9x too shallow — this pins the
    // clamping behavior specifically.
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "0.00".parse().unwrap()).unwrap();
    store
        .save_transactions(
            checking,
            &[tx("2026-08-19", "Opening balance", "100.00"), tx("2026-08-20", "Deposit", "50.00")],
        )
        .unwrap();

    let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 1).unwrap();

    // 1 day of history, $50 net over that day -> $50/day slope.
    assert_eq!(points[0].balance, "150.00".parse().unwrap());
    assert_eq!(points[1].balance, "200.00".parse().unwrap());
}

#[test]
fn cash_flow_forecast_with_zero_days_returns_just_todays_balance() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();

    let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 0).unwrap();

    assert_eq!(points.len(), 1);
    assert_eq!(points[0].balance, "1000.00".parse().unwrap());
}

#[test]
fn cash_flow_forecast_only_starts_from_cash_group_accounts() {
    let store = Store::open_in_memory().unwrap();
    let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    store.set_account_starting_balance(checking, "1000.00".parse().unwrap()).unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    store.set_account_starting_balance(brokerage, "5000.00".parse().unwrap()).unwrap();

    let points = store.cash_flow_forecast("2026-08-20".parse().unwrap(), 5).unwrap();

    assert_eq!(points[0].balance, "1000.00".parse().unwrap(), "investment balance must not count");
}

#[test]
fn average_monthly_spend_is_zero_with_no_transaction_history() {
    let store = Store::open_in_memory().unwrap();

    let avg = store.average_monthly_spend("2026-08-20".parse().unwrap()).unwrap();

    assert_eq!(avg, Decimal::ZERO);
}

#[test]
fn average_monthly_spend_divides_trailing_window_spend_by_months_in_that_window() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    // 30 days of history, $900 spent, $500 deposited — spend only,
    // income must not offset it.
    store
        .save_transactions(
            account,
            &[tx("2026-07-21", "Rent", "-900.00"), tx("2026-07-25", "Payroll Deposit", "500.00")],
        )
        .unwrap();

    let avg = store.average_monthly_spend("2026-08-20".parse().unwrap()).unwrap();

    // Window clamps to the 30 days of actual history (earliest tx to
    // today), not the full 90-day cap — 900 spent / (30/30) months.
    assert_eq!(avg, "900.00".parse().unwrap());
}

#[test]
fn average_monthly_spend_clamps_the_window_to_available_history_not_a_blind_90_days() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    // Only 10 days of history — the window must clamp to that, not
    // divide by a full 90/30 = 3 months' worth.
    store.save_transactions(account, &[tx("2026-08-10", "Rent", "-300.00")]).unwrap();

    let avg = store.average_monthly_spend("2026-08-20".parse().unwrap()).unwrap();

    // 300 spent over a 10-day window == 1/3 month -> 900/month average.
    assert_eq!(avg, "900.00".parse().unwrap());
}

#[test]
fn average_monthly_spend_excludes_transfers() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-07-21", "Rent", "-900.00"),
                Transaction {
                    category: Some("Transfer".to_string()),
                    ..tx("2026-07-25", "To Savings", "-2000.00")
                },
            ],
        )
        .unwrap();

    let avg = store.average_monthly_spend("2026-08-20".parse().unwrap()).unwrap();

    assert_eq!(avg, "900.00".parse().unwrap(), "a $2,000 move to savings is not $2,000 of spending");
}

#[test]
fn bill_aware_forecast_falls_back_to_the_trend_forecast_when_there_are_no_recurring_items() {
    let store = Store::open_in_memory().unwrap();
    let account = checking_with_balance(&store, "1000.00");
    store
        .save_transactions(account, &[tx("2026-08-25", "Payroll Deposit", "600.00")])
        .unwrap();

    let forecast = store.bill_aware_forecast(forecast_today(), 30).unwrap();

    assert!(!forecast.uses_recurring);
    assert!(forecast.events.is_empty());
    assert_eq!(forecast.points, store.cash_flow_forecast(forecast_today(), 30).unwrap());
}

#[test]
fn a_recurring_bill_lands_on_its_due_date_and_not_before() {
    let store = Store::open_in_memory().unwrap();
    let account = checking_with_balance(&store, "3000.00");
    store
        .create_recurring(
            "Union Realty",
            Some("Rent"),
            "-1000.00".parse().unwrap(),
            "monthly",
            "2026-09-28".parse().unwrap(),
            Some(account),
        )
        .unwrap();

    let forecast = store.bill_aware_forecast(forecast_today(), 30).unwrap();

    assert!(forecast.uses_recurring);
    assert_eq!(forecast.start_balance, "3000.00".parse().unwrap());
    assert_eq!(balance_on(&forecast, "2026-09-18"), "3000.00".parse().unwrap());
    assert_eq!(balance_on(&forecast, "2026-09-27"), "3000.00".parse().unwrap());
    assert_eq!(balance_on(&forecast, "2026-09-28"), "2000.00".parse().unwrap());
    assert_eq!(
        balance_on(&forecast, "2026-10-18"),
        "2000.00".parse().unwrap(),
        "next month's rent is past the 30-day horizon"
    );
    assert_eq!(forecast.points.len(), 31, "today plus one point per day");
    assert_eq!(
        forecast.events,
        vec![ForecastEvent {
            date: "2026-09-28".parse().unwrap(),
            label: "Union Realty".to_string(),
            amount: "-1000.00".parse().unwrap()
        }]
    );
}

#[test]
fn the_forecast_skips_a_bill_due_today_that_has_already_posted() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    netflix_with(&store, account, "-15.49", &[("2026-08-03", "-15.49"), ("2026-09-03", "-15.49")]);

    let forecast = store.bill_aware_forecast(day("2026-09-03"), 10).unwrap();

    assert!(
        !forecast.events.iter().any(|e| e.label == "Netflix" && e.date == day("2026-09-03")),
        "a charge that already hit the account must not be counted again: {:?}",
        forecast.events
    );
}

#[test]
fn the_forecast_still_counts_a_bill_due_today_that_has_not_posted() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    netflix_with(&store, account, "-15.49", &[("2026-08-03", "-15.49")]);

    let forecast = store.bill_aware_forecast(day("2026-09-03"), 10).unwrap();

    assert!(forecast.events.iter().any(|e| e.label == "Netflix" && e.date == day("2026-09-03")));
}
