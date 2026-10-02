use super::*;

#[test]
fn delete_account_removes_its_investment_holdings() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    store
        .create_holding(
            brokerage,
            "VTI",
            "Vanguard Total Stock Market",
            "10".parse().unwrap(),
            "100.00".parse().unwrap(),
            "900.00".parse().unwrap(),
            None,
        )
        .unwrap();

    store.delete_account(brokerage).unwrap();

    assert!(store.list_holdings(test_now().date()).unwrap().is_empty());
}

#[test]
fn list_accounts_uses_holdings_value_for_an_investment_account_once_it_has_holdings() {
    // A portfolio tracked entirely through Holdings (no matching
    // deposit transaction ever recorded) used to show as worth
    // whatever its starting_balance happened to be (typically $0) —
    // this is what makes the Investments tab's real value agree with
    // Net Worth/Accounts/Household everywhere else.
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    store.set_account_starting_balance(brokerage, "0".parse().unwrap()).unwrap();
    store
        .create_holding(
            brokerage,
            "VTI",
            "Vanguard Total Stock",
            "10".parse().unwrap(),
            "265.00".parse().unwrap(),
            "2000.00".parse().unwrap(),
            None,
        )
        .unwrap();
    store
        .create_holding(
            brokerage,
            "BND",
            "Vanguard Total Bond",
            "20".parse().unwrap(),
            "71.50".parse().unwrap(),
            "1300.00".parse().unwrap(),
            None,
        )
        .unwrap();

    let accounts = store.list_accounts(far_future()).unwrap();

    // 10*265.00 + 20*71.50 = 2650.00 + 1430.00 = 4080.00
    assert_eq!(accounts[0].current_balance, "4080.00".parse().unwrap());
}

#[test]
fn create_holding_then_list_holdings_computes_value_and_gain() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();

    let id = store
        .create_holding(
            brokerage,
            "AAPL",
            "Apple Inc.",
            "8".parse().unwrap(),
            "231.20".parse().unwrap(),
            "1450.00".parse().unwrap(),
            Some("US Stocks"),
        )
        .unwrap();

    let holdings = store.list_holdings(test_now().date()).unwrap();
    assert_eq!(holdings.len(), 1);
    assert_eq!(holdings[0].id, id);
    assert_eq!(holdings[0].account_name, "Individual Brokerage");
    assert_eq!(holdings[0].value, "1849.60".parse().unwrap());
    assert_eq!(holdings[0].gain_loss, "399.60".parse().unwrap());
}

#[test]
fn a_holding_below_cost_basis_reports_a_loss() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
    store
        .create_holding(
            brokerage,
            "BTC",
            "Bitcoin",
            "0.012".parse().unwrap(),
            "40000".parse().unwrap(),
            "620.00".parse().unwrap(),
            Some("Crypto"),
        )
        .unwrap();

    let holdings = store.list_holdings(test_now().date()).unwrap();
    assert_eq!(holdings[0].value, "480.00".parse().unwrap());
    assert_eq!(holdings[0].gain_loss, "-140.00".parse().unwrap());
}

#[test]
fn update_holding_price_recomputes_value_gain_prev_close_and_day_gain_loss() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
    let id = store
        .create_holding(
            brokerage,
            "VOO",
            "Vanguard S&P 500 ETF",
            "3.6".parse().unwrap(),
            "500.00".parse().unwrap(),
            "1780.00".parse().unwrap(),
            None,
        )
        .unwrap();

    store.update_holding_price(id, "552.10".parse().unwrap(), test_now().date()).unwrap();

    let holdings = store.list_holdings(test_now().date()).unwrap();
    assert_eq!(holdings[0].price, "552.10".parse().unwrap());
    assert_eq!(holdings[0].value, "1987.56".parse().unwrap());
    assert_eq!(holdings[0].prev_close, Some("500.00".parse().unwrap()));
    assert_eq!(holdings[0].day_gain_loss, Some("187.56".parse().unwrap())); // 3.6 * (552.10 - 500.00)
}

#[test]
fn update_holding_price_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.update_holding_price(999, "100.00".parse().unwrap(), test_now().date()).unwrap();
}

#[test]
fn update_holding_price_does_not_move_prev_close_on_a_second_update_the_same_day() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
    let id = store
        .create_holding(
            brokerage,
            "VOO",
            "Vanguard S&P 500 ETF",
            "1".parse().unwrap(),
            "500.00".parse().unwrap(),
            "500.00".parse().unwrap(),
            None,
        )
        .unwrap();

    store.update_holding_price(id, "510.00".parse().unwrap(), test_now().date()).unwrap();
    store.update_holding_price(id, "520.00".parse().unwrap(), test_now().date()).unwrap();

    let holdings = store.list_holdings(test_now().date()).unwrap();
    // prev_close stays pinned to the price from before the *first*
    // update of the day, so day_gain_loss reflects the whole day's
    // move (500 -> 520), not just the second update's delta (510 -> 520).
    assert_eq!(holdings[0].prev_close, Some("500.00".parse().unwrap()));
    assert_eq!(holdings[0].day_gain_loss, Some("20.00".parse().unwrap()));
}

#[test]
fn update_holding_price_re_snapshots_prev_close_on_a_later_calendar_day() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
    let id = store
        .create_holding(
            brokerage,
            "VOO",
            "Vanguard S&P 500 ETF",
            "1".parse().unwrap(),
            "500.00".parse().unwrap(),
            "500.00".parse().unwrap(),
            None,
        )
        .unwrap();
    store.update_holding_price(id, "510.00".parse().unwrap(), test_now().date()).unwrap();

    let next_day = test_now().date() + chrono::Duration::days(1);
    store.update_holding_price(id, "515.00".parse().unwrap(), next_day).unwrap();

    let holdings = store.list_holdings(next_day).unwrap();
    assert_eq!(holdings[0].prev_close, Some("510.00".parse().unwrap()));
    assert_eq!(holdings[0].day_gain_loss, Some("5.00".parse().unwrap()));
}

#[test]
fn list_holdings_day_gain_loss_goes_stale_once_today_moves_past_the_last_update() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
    let id = store
        .create_holding(
            brokerage,
            "VOO",
            "Vanguard S&P 500 ETF",
            "1".parse().unwrap(),
            "500.00".parse().unwrap(),
            "500.00".parse().unwrap(),
            None,
        )
        .unwrap();
    store.update_holding_price(id, "510.00".parse().unwrap(), test_now().date()).unwrap();

    // A day-gain figure computed as of the update's own day is real...
    let holdings = store.list_holdings(test_now().date()).unwrap();
    assert_eq!(holdings[0].day_gain_loss, Some("10.00".parse().unwrap()));

    // ...but asking as of a *later* day must not keep reporting that
    // same stale delta as if it were still "today's" move — the row's
    // price hasn't actually been touched since, so there's no real
    // day-change to report for the later day.
    let next_day = test_now().date() + chrono::Duration::days(1);
    let holdings = store.list_holdings(next_day).unwrap();
    assert_eq!(holdings[0].prev_close, None);
    assert_eq!(holdings[0].day_gain_loss, None);
}

#[test]
fn list_holdings_day_gain_loss_is_none_until_a_price_update_happens() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
    store
        .create_holding(
            brokerage,
            "VOO",
            "Vanguard S&P 500 ETF",
            "1".parse().unwrap(),
            "500.00".parse().unwrap(),
            "500.00".parse().unwrap(),
            None,
        )
        .unwrap();

    let holdings = store.list_holdings(test_now().date()).unwrap();
    assert_eq!(holdings[0].prev_close, None);
    assert_eq!(holdings[0].day_gain_loss, None);
}

#[test]
fn delete_holding_removes_it() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Individual Brokerage", AccountType::Investment).unwrap();
    let id = store
        .create_holding(
            brokerage,
            "AAPL",
            "Apple Inc.",
            "8".parse().unwrap(),
            "231.20".parse().unwrap(),
            "1450.00".parse().unwrap(),
            None,
        )
        .unwrap();

    store.delete_holding(id).unwrap();

    assert_eq!(store.list_holdings(test_now().date()).unwrap().len(), 0);
}

#[test]
fn delete_holding_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.delete_holding(999).unwrap();
}

#[test]
fn list_distinct_holding_symbols_dedupes_across_accounts() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let ira = store.get_or_create_account("IRA", AccountType::Investment).unwrap();
    store
        .create_holding(
            brokerage,
            "AAPL",
            "Apple Inc.",
            "1".parse().unwrap(),
            "200".parse().unwrap(),
            "200".parse().unwrap(),
            None,
        )
        .unwrap();
    store
        .create_holding(
            ira,
            "AAPL",
            "Apple Inc.",
            "2".parse().unwrap(),
            "200".parse().unwrap(),
            "400".parse().unwrap(),
            None,
        )
        .unwrap();
    store
        .create_holding(
            brokerage,
            "MSFT",
            "Microsoft Corp.",
            "1".parse().unwrap(),
            "300".parse().unwrap(),
            "300".parse().unwrap(),
            None,
        )
        .unwrap();

    let symbols = store.list_distinct_holding_symbols().unwrap();

    assert_eq!(symbols, vec!["AAPL".to_string(), "MSFT".to_string()]);
}

#[test]
fn update_holding_prices_for_symbol_updates_all_matching_holdings() {
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let ira = store.get_or_create_account("IRA", AccountType::Investment).unwrap();
    store
        .create_holding(
            brokerage,
            "AAPL",
            "Apple Inc.",
            "1".parse().unwrap(),
            "200".parse().unwrap(),
            "200".parse().unwrap(),
            None,
        )
        .unwrap();
    store
        .create_holding(
            ira,
            "AAPL",
            "Apple Inc.",
            "2".parse().unwrap(),
            "200".parse().unwrap(),
            "400".parse().unwrap(),
            None,
        )
        .unwrap();
    store
        .create_holding(
            brokerage,
            "MSFT",
            "Microsoft Corp.",
            "1".parse().unwrap(),
            "300".parse().unwrap(),
            "300".parse().unwrap(),
            None,
        )
        .unwrap();

    let updated = store
        .update_holding_prices_for_symbol("AAPL", "250".parse().unwrap(), test_now().date())
        .unwrap();

    assert_eq!(updated, 2);
    let holdings = store.list_holdings(test_now().date()).unwrap();
    for h in &holdings {
        if h.symbol == "AAPL" {
            assert_eq!(h.price, "250".parse().unwrap());
            assert_eq!(h.prev_close, Some("200".parse().unwrap()));
        } else {
            assert_eq!(h.price, "300".parse().unwrap());
            assert_eq!(h.prev_close, None);
        }
    }
}

#[test]
fn update_holding_prices_for_symbol_on_unknown_symbol_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    let updated = store
        .update_holding_prices_for_symbol("NOSUCH", "1".parse().unwrap(), test_now().date())
        .unwrap();
    assert_eq!(updated, 0);
}

#[test]
fn net_worth_breakdown_as_of_uses_holdings_value_for_an_investment_account_once_it_has_holdings() {
    // Same gap as `list_accounts`'s own version of this test: a
    // holding has no historical price record, so its current value is
    // applied at every past date too (same "current value applied
    // throughout" convention the Dashboard already uses for Property
    // & Valuables) — a flat approximation, but far less misleading
    // than counting a real, tracked portfolio as $0 everywhere.
    let store = Store::open_in_memory().unwrap();
    let brokerage = store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    store.set_account_starting_balance(brokerage, "0".parse().unwrap()).unwrap();
    store
        .create_holding(
            brokerage,
            "VTI",
            "Vanguard Total Stock",
            "10".parse().unwrap(),
            "265.00".parse().unwrap(),
            "2000.00".parse().unwrap(),
            None,
        )
        .unwrap();

    let breakdown = store.net_worth_breakdown_as_of("2026-01-01".parse().unwrap()).unwrap();

    assert_eq!(breakdown.investments, "2650.00".parse().unwrap());
    assert_eq!(breakdown.net_worth, "2650.00".parse().unwrap());
}

#[test]
fn a_snapshot_records_the_total_value_of_every_holding() {
    let store = Store::open_in_memory().unwrap();
    let acct = brokerage(&store);
    store
        .create_holding(acct, "VTI", "Total Market", dec("10"), dec("250.00"), dec("2000"), Some("US Stocks"))
        .unwrap();
    store
        .create_holding(acct, "BND", "Bonds", dec("20"), dec("75.50"), dec("1400"), Some("Bonds"))
        .unwrap();

    let recorded = store.record_portfolio_snapshot(day("2026-09-18")).unwrap();

    assert!(recorded);
    assert_eq!(store.portfolio_history().unwrap(), vec![(day("2026-09-18"), dec("4010.00"))]);
}

#[test]
fn snapshotting_twice_in_a_day_keeps_the_latest_value() {
    let store = Store::open_in_memory().unwrap();
    let acct = brokerage(&store);
    let id = store
        .create_holding(acct, "VTI", "Total Market", dec("10"), dec("250.00"), dec("2000"), None)
        .unwrap();
    store.record_portfolio_snapshot(day("2026-09-18")).unwrap();

    store.update_holding_price(id, dec("260.00"), day("2026-09-18")).unwrap();
    store.record_portfolio_snapshot(day("2026-09-18")).unwrap();

    assert_eq!(store.portfolio_history().unwrap(), vec![(day("2026-09-18"), dec("2600.00"))]);
}

#[test]
fn history_is_oldest_first_across_days() {
    let store = Store::open_in_memory().unwrap();
    let acct = brokerage(&store);
    let id = store
        .create_holding(acct, "VTI", "Total Market", dec("10"), dec("250.00"), dec("2000"), None)
        .unwrap();
    store.record_portfolio_snapshot(day("2026-09-16")).unwrap();
    store.update_holding_price(id, dec("240.00"), day("2026-09-17")).unwrap();
    store.record_portfolio_snapshot(day("2026-09-17")).unwrap();

    let history = store.portfolio_history().unwrap();

    assert_eq!(history, vec![(day("2026-09-16"), dec("2500.00")), (day("2026-09-17"), dec("2400.00"))]);
}

#[test]
fn with_no_holdings_nothing_is_recorded() {
    let store = Store::open_in_memory().unwrap();

    assert!(!store.record_portfolio_snapshot(day("2026-09-18")).unwrap());
    assert!(store.portfolio_history().unwrap().is_empty());
}

#[test]
fn contributions_group_money_in_and_out_by_calendar_month_and_total_them() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    put(&store, acct, "2026-05-03", "May deposit", "500.00");
    put(&store, acct, "2026-05-20", "May top-up", "100.00");
    // June: nothing arrived.
    put(&store, acct, "2026-07-03", "July deposit", "500.00");
    put(&store, acct, "2026-07-15", "Pulled some out", "-200.00");

    let c = store.account_contributions(acct, day("2026-09-20")).unwrap();

    assert_eq!(
        c.months,
        vec![
            month("2026-05", "600.00", "0"),
            month("2026-06", "0", "0"),
            month("2026-07", "500.00", "200.00")
        ],
        "a missed month between two active ones shows as zero; the empty months after the last activity are not listed"
    );
    assert_eq!(c.total_in, dec("1100.00"));
    assert_eq!(c.total_out, dec("200.00"));
    assert_eq!(c.net, dec("900.00"));
    assert_eq!(c.first_deposit, Some(day("2026-05-03")));
    assert_eq!(c.deposit_count, 3);
}

#[test]
fn contributions_for_an_account_with_no_activity_are_empty() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);

    let c = store.account_contributions(acct, day("2026-09-20")).unwrap();

    assert!(c.months.is_empty());
    assert_eq!((c.total_in, c.total_out, c.net), (dec("0"), dec("0"), dec("0")));
    assert_eq!(c.first_deposit, None);
    assert_eq!(c.deposit_count, 0);
}

#[test]
fn the_first_deposit_is_the_first_money_in_not_the_first_transaction() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    put(&store, acct, "2026-06-01", "A fee", "-5.00");
    put(&store, acct, "2026-07-01", "First real deposit", "300.00");

    let c = store.account_contributions(acct, day("2026-09-20")).unwrap();

    assert_eq!(c.first_deposit, Some(day("2026-07-01")));
    assert_eq!(c.months.first().unwrap().month, "2026-06");
    assert_eq!(c.net, dec("295.00"));
}

#[test]
fn contributions_split_on_the_calendar_month_and_ignore_future_dated_rows() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    put(&store, acct, "2026-01-31", "Last day of January", "100.00");
    put(&store, acct, "2026-02-01", "First day of February", "200.00");
    put(&store, acct, "2026-10-05", "Dated next month", "700.00");

    let c = store.account_contributions(acct, day("2026-09-20")).unwrap();

    assert_eq!(c.months, vec![month("2026-01", "100.00", "0"), month("2026-02", "200.00", "0")]);
    assert_eq!(c.total_in, dec("300.00"), "a row that hasn't happened yet isn't invested yet");
}

#[test]
fn the_current_month_is_listed_once_it_has_activity() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    put(&store, acct, "2026-08-03", "August", "500.00");
    put(&store, acct, "2026-09-05", "September", "500.00");

    let c = store.account_contributions(acct, day("2026-09-20")).unwrap();

    assert_eq!(c.months.last().unwrap().month, "2026-09");
}

#[test]
fn a_linked_transfer_counts_once_on_the_account_that_received_it() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    put(&store, checking, "2026-08-02", "Move to Roth", "-500.00");
    put(&store, acct, "2026-08-02", "From checking", "500.00");
    store
        .link_transfer(id_of(&store, "Move to Roth", "2026-08-02"), id_of(&store, "From checking", "2026-08-02"))
        .unwrap();

    let roth_side = store.account_contributions(acct, day("2026-09-20")).unwrap();
    let checking_side = store.account_contributions(checking, day("2026-09-20")).unwrap();

    assert_eq!(
        (roth_side.total_in, roth_side.total_out, roth_side.deposit_count),
        (dec("500.00"), dec("0"), 1)
    );
    assert_eq!((checking_side.total_in, checking_side.total_out), (dec("0"), dec("500.00")));
}

#[test]
fn any_money_in_counts_including_a_dividend_logged_as_income() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    store
        .save_transactions(
            acct,
            &[
                Transaction {
                    category: Some("Dividends".to_string()),
                    ..tx("2026-08-10", "VTI dividend", "12.40")
                },
                tx("2026-08-11", "Deposit", "500.00"),
            ],
        )
        .unwrap();

    let c = store.account_contributions(acct, day("2026-09-20")).unwrap();

    assert_eq!(c.total_in, dec("512.40"));
    assert_eq!(c.deposit_count, 2);
}

#[test]
fn an_account_with_no_saved_plan_gets_the_defaults() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);

    let plan = store.get_investment_plan(acct).unwrap();

    assert_eq!(
        plan,
        InvestmentPlan {
            monthly_contribution: None,
            annual_return_pct: dec("7"),
            withdraw_month: None,
            withdraw_years: None,
        }
    );
    assert_eq!(plan, InvestmentPlan::default());
}

#[test]
fn a_saved_plan_round_trips_and_the_withdraw_date_is_kept_as_a_month() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    let plan = InvestmentPlan {
        monthly_contribution: Some(dec("450.00")),
        annual_return_pct: dec("5.5"),
        withdraw_month: Some(day("2031-06-15")),
        withdraw_years: Some(4),
    };

    store.set_investment_plan(acct, &plan, day("2026-09-20")).unwrap();

    assert_eq!(
        store.get_investment_plan(acct).unwrap(),
        InvestmentPlan {
            withdraw_month: Some(day("2031-06-01")),
            ..plan.clone()
        }
    );

    // Saving again replaces it, and a blank field really clears.
    let cleared = InvestmentPlan {
        monthly_contribution: None,
        withdraw_month: None,
        withdraw_years: None,
        ..plan
    };
    store.set_investment_plan(acct, &cleared, day("2026-09-20")).unwrap();
    assert_eq!(store.get_investment_plan(acct).unwrap(), cleared);
}

#[test]
fn plans_are_kept_per_account() {
    let store = Store::open_in_memory().unwrap();
    let a = roth(&store);
    let b = store.get_or_create_account("Sam's 529", AccountType::Investment).unwrap();
    store
        .set_investment_plan(
            a,
            &InvestmentPlan {
                annual_return_pct: dec("4"),
                ..InvestmentPlan::default()
            },
            day("2026-09-20"),
        )
        .unwrap();

    assert_eq!(store.get_investment_plan(a).unwrap().annual_return_pct, dec("4"));
    assert_eq!(store.get_investment_plan(b).unwrap(), InvestmentPlan::default());
}

#[test]
fn an_invalid_plan_is_refused_with_a_message_and_nothing_is_saved() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    let today = day("2026-09-20");
    let good = InvestmentPlan {
        monthly_contribution: Some(dec("300")),
        annual_return_pct: dec("6"),
        withdraw_month: Some(day("2030-01-01")),
        withdraw_years: Some(3),
    };
    store.set_investment_plan(acct, &good, today).unwrap();

    let cases = [
        (
            InvestmentPlan {
                annual_return_pct: dec("100.01"),
                ..good.clone()
            },
            "between 0 and 100",
        ),
        (
            InvestmentPlan {
                annual_return_pct: dec("-0.1"),
                ..good.clone()
            },
            "between 0 and 100",
        ),
        (
            InvestmentPlan {
                monthly_contribution: Some(dec("-1")),
                ..good.clone()
            },
            "can't be negative",
        ),
        (
            InvestmentPlan {
                withdraw_month: Some(day("2026-08-15")),
                ..good.clone()
            },
            "in the past",
        ),
        (
            InvestmentPlan {
                withdraw_years: Some(0),
                ..good.clone()
            },
            "1 to 50",
        ),
        (
            InvestmentPlan {
                withdraw_years: Some(51),
                ..good.clone()
            },
            "1 to 50",
        ),
    ];
    for (bad, expected) in cases {
        let err = store.set_investment_plan(acct, &bad, today).unwrap_err();
        assert!(matches!(err, PlanError::Invalid(_)), "{bad:?} should be a validation error");
        assert!(err.to_string().contains(expected), "{bad:?}: {err}");
        assert_eq!(store.get_investment_plan(acct).unwrap(), good, "a refused save must leave the plan alone");
    }
}

#[test]
fn the_current_month_is_a_valid_withdraw_month_and_an_old_saved_one_can_stay() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    let this_month = InvestmentPlan {
        withdraw_month: Some(day("2026-09-28")),
        ..InvestmentPlan::default()
    };
    store.set_investment_plan(acct, &this_month, day("2026-09-20")).unwrap();

    // Months later that date is in the past — but editing the monthly amount
    // must not be blocked by a date the person never touched.
    let edited = InvestmentPlan {
        monthly_contribution: Some(dec("250")),
        ..this_month.clone()
    };
    store.set_investment_plan(acct, &edited, day("2026-12-01")).unwrap();
    assert_eq!(store.get_investment_plan(acct).unwrap().monthly_contribution, Some(dec("250")));

    // Picking a different past month is still refused.
    let other_past = InvestmentPlan {
        withdraw_month: Some(day("2026-10-01")),
        ..edited
    };
    assert!(store.set_investment_plan(acct, &other_past, day("2026-12-01")).is_err());
}

#[test]
fn a_plan_and_an_inflation_are_saved_together() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    let plan = InvestmentPlan {
        annual_return_pct: dec("5"),
        ..InvestmentPlan::default()
    };

    store
        .set_investment_plan_with_inflation(acct, &plan, Some(dec("4")), day("2026-09-20"))
        .unwrap();

    assert_eq!(store.get_investment_plan(acct).unwrap(), plan);
    assert_eq!(store.get_inflation_pct().unwrap(), dec("4"));
}

#[test]
fn a_refused_inflation_saves_nothing_from_the_plan_either() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    let plan = InvestmentPlan {
        annual_return_pct: dec("5"),
        ..InvestmentPlan::default()
    };

    // Just over 100 by an amount a double-precision check can't see.
    let err = store
        .set_investment_plan_with_inflation(acct, &plan, Some(dec("100.0000000000000000001")), day("2026-09-20"))
        .unwrap_err();

    assert!(matches!(err, PlanError::Invalid(_)));
    assert_eq!(
        store.get_investment_plan(acct).unwrap(),
        InvestmentPlan::default(),
        "the plan must not stay saved behind a refused inflation"
    );
    assert_eq!(store.get_inflation_pct().unwrap(), dec("3"));
}

#[test]
fn a_refused_plan_leaves_the_inflation_alone() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    let plan = InvestmentPlan {
        annual_return_pct: dec("150"),
        ..InvestmentPlan::default()
    };

    let err = store
        .set_investment_plan_with_inflation(acct, &plan, Some(dec("4")), day("2026-09-20"))
        .unwrap_err();

    assert!(matches!(err, PlanError::Invalid(_)));
    assert_eq!(
        store.get_inflation_pct().unwrap(),
        dec("3"),
        "a refused plan must not change the shared inflation"
    );
}

#[test]
fn without_an_inflation_only_the_plan_is_saved() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    let plan = InvestmentPlan {
        annual_return_pct: dec("6"),
        ..InvestmentPlan::default()
    };

    store.set_investment_plan_with_inflation(acct, &plan, None, day("2026-09-20")).unwrap();

    assert_eq!(store.get_investment_plan(acct).unwrap(), plan);
    assert_eq!(store.get_inflation_pct().unwrap(), dec("3"));
}

#[test]
fn the_daily_snapshot_also_records_each_investment_account_s_own_value() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    let five29 = store.get_or_create_account("Sam's 529", AccountType::Investment).unwrap();
    let checking = store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap();
    put(&store, checking, "2026-09-01", "Paycheck", "2000.00");
    store
        .create_holding(acct, "VTI", "Total Market", dec("10"), dec("250.00"), dec("2000"), None)
        .unwrap();
    store
        .create_holding(five29, "VXUS", "International", dec("4"), dec("100.00"), dec("300"), None)
        .unwrap();

    store.record_portfolio_snapshot(day("2026-09-18")).unwrap();

    assert_eq!(store.account_value_history(acct).unwrap(), vec![(day("2026-09-18"), dec("2500.00"))]);
    assert_eq!(store.account_value_history(five29).unwrap(), vec![(day("2026-09-18"), dec("400.00"))]);
    assert!(
        store.account_value_history(checking).unwrap().is_empty(),
        "only investment accounts are recorded"
    );
}

#[test]
fn an_account_snapshot_is_once_a_day_oldest_first_and_the_last_write_wins() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    let id = store
        .create_holding(acct, "VTI", "Total Market", dec("10"), dec("250.00"), dec("2000"), None)
        .unwrap();
    store.record_portfolio_snapshot(day("2026-09-17")).unwrap();
    store.record_portfolio_snapshot(day("2026-09-18")).unwrap();
    store.update_holding_price(id, dec("260.00"), day("2026-09-18")).unwrap();
    store.record_portfolio_snapshot(day("2026-09-18")).unwrap();

    assert_eq!(
        store.account_value_history(acct).unwrap(),
        vec![(day("2026-09-17"), dec("2500.00")), (day("2026-09-18"), dec("2600.00"))]
    );
}

#[test]
fn an_investment_account_without_holdings_is_recorded_at_its_transaction_balance() {
    let store = Store::open_in_memory().unwrap();
    let funded = roth(&store);
    let empty = store.get_or_create_account("Alex's 529", AccountType::Investment).unwrap();
    put(&store, funded, "2026-09-01", "Deposit", "500.00");
    put(&store, funded, "2026-09-25", "Not yet", "500.00");

    let recorded_portfolio = store.record_portfolio_snapshot(day("2026-09-18")).unwrap();

    assert!(!recorded_portfolio, "with no holdings the portfolio chart still records nothing");
    assert_eq!(store.account_value_history(funded).unwrap(), vec![(day("2026-09-18"), dec("500.00"))]);
    assert!(
        store.account_value_history(empty).unwrap().is_empty(),
        "an account with no holdings and no balance has nothing worth recording"
    );
}

#[test]
fn an_account_that_is_emptied_records_the_move_to_zero_once() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    let holding = store
        .create_holding(acct, "VTI", "Total Market", dec("10"), dec("250.00"), dec("2000"), None)
        .unwrap();
    store.record_portfolio_snapshot(day("2026-09-17")).unwrap();
    store.delete_holding(holding).unwrap();

    store.record_portfolio_snapshot(day("2026-09-18")).unwrap();
    store.record_portfolio_snapshot(day("2026-09-19")).unwrap();

    assert_eq!(
        store.account_value_history(acct).unwrap(),
        vec![(day("2026-09-17"), dec("2500.00")), (day("2026-09-18"), dec("0"))],
        "the drop to zero is on record for the day it happened, and the empty days after it add no run of zeros"
    );
}

#[test]
fn an_emptied_account_that_is_funded_again_is_recorded_again() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    let first = store
        .create_holding(acct, "VTI", "Total Market", dec("10"), dec("250.00"), dec("2000"), None)
        .unwrap();
    store.record_portfolio_snapshot(day("2026-09-17")).unwrap();
    store.delete_holding(first).unwrap();
    store.record_portfolio_snapshot(day("2026-09-18")).unwrap();
    store
        .create_holding(acct, "VXUS", "International", dec("4"), dec("100.00"), dec("300"), None)
        .unwrap();
    store.record_portfolio_snapshot(day("2026-09-20")).unwrap();

    assert_eq!(
        store.account_value_history(acct).unwrap(),
        vec![
            (day("2026-09-17"), dec("2500.00")),
            (day("2026-09-18"), dec("0")),
            (day("2026-09-20"), dec("400.00"))
        ]
    );
}

#[test]
fn deleting_an_account_removes_its_plan_and_value_history() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    store
        .create_holding(acct, "VTI", "Total Market", dec("10"), dec("250.00"), dec("2000"), None)
        .unwrap();
    store.record_portfolio_snapshot(day("2026-09-18")).unwrap();
    store
        .set_investment_plan(
            acct,
            &InvestmentPlan {
                annual_return_pct: dec("4"),
                ..InvestmentPlan::default()
            },
            day("2026-09-20"),
        )
        .unwrap();

    store.delete_account(acct).unwrap();

    let plan_rows: i64 = store.conn.query_row("SELECT COUNT(*) FROM investment_plans", [], |r| r.get(0)).unwrap();
    let snapshot_rows: i64 = store
        .conn
        .query_row("SELECT COUNT(*) FROM account_value_snapshots", [], |r| r.get(0))
        .unwrap();
    assert_eq!((plan_rows, snapshot_rows), (0, 0));
    // A new account of the same name starts from scratch.
    let again = roth(&store);
    assert_eq!(store.get_investment_plan(again).unwrap(), InvestmentPlan::default());
    assert!(store.account_value_history(again).unwrap().is_empty());
}

#[test]
fn inflation_defaults_to_three_percent_persists_and_refuses_nonsense() {
    let store = Store::open_in_memory().unwrap();
    assert_eq!(store.get_inflation_pct().unwrap(), dec("3"));

    store.set_inflation_pct(dec("2.5")).unwrap();
    assert_eq!(store.get_inflation_pct().unwrap(), dec("2.5"));

    assert!(matches!(store.set_inflation_pct(dec("-1")), Err(PlanError::Invalid(_))));
    assert!(matches!(store.set_inflation_pct(dec("101")), Err(PlanError::Invalid(_))));
    assert_eq!(store.get_inflation_pct().unwrap(), dec("2.5"), "a refused save changes nothing");

    // It lives beside the feature switches without disturbing them.
    let settings = store.get_app_settings().unwrap();
    assert!(settings.apply_to_debt_enabled && settings.rollover_enabled && !settings.auto_link_transfers);
}

#[test]
fn inflation_still_reads_as_three_percent_when_there_is_no_settings_row_at_all() {
    let store = Store::open_in_memory().unwrap();
    store.conn.execute("DELETE FROM app_settings", []).unwrap();

    assert_eq!(store.get_inflation_pct().unwrap(), dec("3"));
    store.set_inflation_pct(dec("2")).unwrap();
    assert_eq!(store.get_inflation_pct().unwrap(), dec("2"), "saving creates the row");
}

#[test]
fn a_database_from_before_phase_4_gains_the_investment_tables_and_the_inflation_setting() {
    let store = Store::open_in_memory().unwrap();
    let acct = roth(&store);
    store
        .conn
        .execute_batch("DROP TABLE investment_plans; DROP TABLE account_value_snapshots; ALTER TABLE app_settings DROP COLUMN inflation_pct;")
        .unwrap();

    store.init_schema().unwrap();

    assert_eq!(store.get_inflation_pct().unwrap(), dec("3"));
    assert_eq!(store.get_investment_plan(acct).unwrap(), InvestmentPlan::default());
    store
        .create_holding(acct, "VTI", "Total Market", dec("1"), dec("100.00"), dec("90"), None)
        .unwrap();
    store.record_portfolio_snapshot(day("2026-09-18")).unwrap();
    assert_eq!(store.account_value_history(acct).unwrap().len(), 1);
}

#[test]
fn allocation_targets_can_be_set_replaced_and_cleared() {
    let store = Store::open_in_memory().unwrap();
    assert!(store.list_allocation_targets().unwrap().is_empty());

    store.set_allocation_target("US Stocks", dec("60")).unwrap();
    store.set_allocation_target("Bonds", dec("40")).unwrap();
    store.set_allocation_target("US Stocks", dec("55")).unwrap();

    assert_eq!(
        store.list_allocation_targets().unwrap(),
        vec![("Bonds".to_string(), dec("40")), ("US Stocks".to_string(), dec("55"))]
    );

    store.set_allocation_target("Bonds", Decimal::ZERO).unwrap();
    assert_eq!(store.list_allocation_targets().unwrap(), vec![("US Stocks".to_string(), dec("55"))]);
}

#[test]
fn a_target_above_100_is_capped_at_100() {
    let store = Store::open_in_memory().unwrap();

    store.set_allocation_target("US Stocks", dec("250")).unwrap();

    assert_eq!(store.list_allocation_targets().unwrap(), vec![("US Stocks".to_string(), dec("100"))]);
}

fn brokerage(store: &Store) -> i64 {
    store.get_or_create_account("Brokerage", AccountType::Investment).unwrap()
}
