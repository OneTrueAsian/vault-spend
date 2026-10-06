use super::*;
use crate::{models::AccountType, store::Store};
use chrono::{NaiveDate, TimeZone, Utc};
use rust_decimal::Decimal;

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 10, 4).unwrap()
}
fn context() -> MobileSnapshotContext {
    MobileSnapshotContext {
        installation_id: "installation-test".into(),
        profile_id: "profile-test".into(),
        profile_name: "Personal".into(),
        profile_icon: None,
        epoch: "epoch-test".into(),
        sequence: 1,
        generated_at: Utc.with_ymd_and_hms(2026, 10, 4, 12, 0, 0).unwrap(),
        alias_key: [7; 32],
    }
}

#[test]
fn empty_profile_is_valid_and_does_not_materialize_budgets() {
    let store = Store::open_in_memory().unwrap();
    let before = store.conn.total_changes();
    let snapshot = store.build_mobile_snapshot(&context(), today()).unwrap();
    assert_eq!(snapshot.overview.net_worth, "0");
    assert!(snapshot.accounts.is_empty());
    assert!(snapshot.history.months.is_empty());
    assert_eq!(before, store.conn.total_changes());
    assert!(!store.conn.query_row("PRAGMA query_only", [], |r| r.get::<_, bool>(0)).unwrap());
    crate::mobile_snapshot::serialize_mobile_snapshot(&snapshot).unwrap();
}

#[test]
fn balances_and_full_history_match_desktop_without_exposing_private_fields() {
    let store = Store::open_in_memory().unwrap();
    let cash = store.create_account("Cash", AccountType::Checking).unwrap().unwrap();
    let credit = store.create_account("Card", AccountType::Credit).unwrap().unwrap();
    store.set_account_starting_balance(cash, Decimal::from(1000)).unwrap();
    store.set_account_starting_balance(credit, Decimal::from(5000)).unwrap();
    for (account, date, amount, category, merchant) in [
        (cash, "2020-01-02", "2000", "Salary", "Employer"),
        (cash, "2026-10-02", "-120", "Food", "Shop"),
        (cash, "2026-10-03", "20", "Food", "Refund"),
        (credit, "2026-10-02", "200", "Salary", "Not income"),
        (cash, "2026-10-03", "-50", "Transfer", "Not spending"),
    ] {
        store.conn.execute("INSERT INTO transactions(account_id,date,description,amount,category,notes,fingerprint) VALUES(?1,?2,?3,?4,?5,'private-note-marker','fixture')", rusqlite::params![account,date,merchant,amount,category]).unwrap();
    }
    store.set_budget("Food", "2026-09", Decimal::from(100), "flexible").unwrap();
    let before = store.conn.total_changes();
    let snapshot = store.build_mobile_snapshot(&context(), today()).unwrap();
    assert_eq!(snapshot.history.months.len(), 82);
    let october = snapshot.history.months.last().unwrap();
    let desktop = store.monthly_totals(2026, 10).unwrap();
    assert_eq!(october.income, desktop.0.to_string());
    assert_eq!(october.spending, desktop.1.to_string());
    assert_eq!(
        snapshot.accounts[0].balance,
        store.list_accounts(today()).unwrap()[0].current_balance.to_string()
    );
    let budget = snapshot.budgets.iter().find(|b| b.month == "2026-10").unwrap();
    assert_eq!(budget.source_month.as_deref(), Some("2026-09"));
    assert_eq!(budget.lines[0].actual, "100");
    assert_eq!(before, store.conn.total_changes());
    let json = crate::mobile_snapshot::serialize_mobile_snapshot(&snapshot).unwrap();
    for private in ["private-note-marker", "transactionId", "holdings", "apiKey", "account_id", "aliasKey"] {
        assert!(!json.contains(private), "{private}");
    }
    let mut other = context();
    other.profile_id = "other-profile".into();
    assert_ne!(
        snapshot.accounts[0].id,
        store.build_mobile_snapshot(&other, today()).unwrap().accounts[0].id
    );
}

fn tx(store: &Store, account: i64, date: &str, amount: &str, category: Option<&str>, description: &str) -> i64 {
    let transaction = crate::models::Transaction {
        date: date.parse().unwrap(),
        amount: amount.parse().unwrap(),
        category: category.map(str::to_string),
        description: description.into(),
    };
    store.save_transactions_with_ids(account, &[transaction]).unwrap()[0]
}
/// Contents of every table, including UI state, settings, history, and SQLite sequences.
fn contents(store: &Store) -> Vec<(String, Vec<Vec<String>>)> {
    let names = store
        .conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    names
        .into_iter()
        .map(|name| {
            let escaped = name.replace('"', "\"\"");
            let mut stmt = store.conn.prepare(&format!("SELECT * FROM \"{escaped}\"")).unwrap();
            let columns = stmt.column_count();
            let mut rows = stmt
                .query_map([], |r| {
                    (0..columns)
                        .map(|i| r.get_ref(i).map(|v| format!("{v:?}")))
                        .collect::<rusqlite::Result<Vec<_>>>()
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            rows.sort();
            (name, rows)
        })
        .collect()
}

#[test]
fn mixed_ledger_parity_includes_splits_refunds_transfers_debt_and_members() {
    let store = Store::open_in_memory().unwrap();
    let cash = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let other = store.get_or_create_account("Savings", AccountType::Savings).unwrap();
    let credit = store.get_or_create_account("Credit", AccountType::Credit).unwrap();
    let loan = store.get_or_create_account("Loan", AccountType::Loan).unwrap();
    let member = store.create_family_member("Owner").unwrap();
    store.set_account_member(cash, Some(member)).unwrap();
    store.set_live_price_settings("alpha_vantage", Some("secret-provider-key")).unwrap();
    store.set_backup_copy_dir(Some("E:\\secret-backup-location")).unwrap();
    store.set_account_starting_balance(credit, Money::from(5000)).unwrap();
    store.set_account_starting_balance(loan, Money::from(1000)).unwrap();
    tx(&store, cash, "2026-09-01", "3000", Some("Income"), "Pay");
    tx(&store, cash, "2026-10-01", "3000", Some("Income"), "Pay");
    let split = tx(&store, cash, "2026-10-02", "-100", Some("Food"), "Split merchant");
    store
        .set_transaction_splits(
            split,
            &[
                ("Food".into(), Money::from(-60), Some("secret-split-note".into())),
                ("Utilities".into(), Money::from(-40), None),
            ],
        )
        .unwrap();
    tx(&store, cash, "2026-10-03", "15", Some("Food"), "Refund");
    let refund = tx(&store, cash, "2026-10-03", "10", Some("Food"), "Split refund");
    store
        .set_transaction_splits(
            refund,
            &[("Food".into(), Money::from(5), None), ("Utilities".into(), Money::from(5), None)],
        )
        .unwrap();
    tx(&store, cash, "2026-10-03", "-25", None, "Uncategorized merchant");
    let out = tx(&store, cash, "2026-10-03", "-200", Some("Food"), "Linked outgoing");
    let incoming = tx(&store, other, "2026-10-03", "200", Some("Income"), "Linked incoming");
    assert!(store.link_transfer(out, incoming).unwrap());
    let transfer = tx(&store, cash, "2026-10-03", "-50", Some("Transfer"), "Category transfer");
    store.add_tag(transfer, "Shared tag").unwrap();
    store.add_tag(split, "Shared tag").unwrap();
    store.add_tag(split, "Second tag").unwrap();
    tx(&store, credit, "2026-10-03", "200", Some("Income"), "Credit positive");
    let loan_payment = tx(&store, loan, "2026-10-03", "100", Some("Income"), "Loan positive");
    store
        .conn
        .execute("UPDATE transactions SET principal_amount='80' WHERE id=?1", [loan_payment])
        .unwrap();
    let payment = tx(&store, cash, "2026-10-03", "-80", Some("Payment"), "Payment source");
    store
        .apply_debt_payment(payment, credit, Money::from(80), "2026-10-03".parse().unwrap())
        .unwrap();
    let deleted = tx(&store, cash, "2026-10-03", "-999", Some("Food"), "Deleted");
    store
        .conn
        .execute("UPDATE transactions SET deleted_at='2026-10-04' WHERE id=?1", [deleted])
        .unwrap();
    tx(&store, cash, "2026-11-01", "-900", Some("Food"), "Future row");
    for (category, amount, group) in [
        ("Income", 4000, "income"),
        ("Food", 300, "flexible"),
        ("Utilities", 100, "fixed"),
        ("Payment", 100, "fixed"),
    ] {
        store.set_budget(category, "2026-10", Money::from(amount), group).unwrap();
    }
    let before = contents(&store);
    let snapshot = store.build_mobile_snapshot(&context(), today()).unwrap();
    assert_eq!(before, contents(&store));
    let m = snapshot.history.months.last().unwrap();
    assert_eq!((m.income.clone(), m.spending.clone()), ("3025".into(), "205".into()));
    for desktop in store.list_accounts(today()).unwrap() {
        assert_eq!(
            snapshot.accounts.iter().find(|a| a.name == desktop.account.name).unwrap().balance,
            money(desktop.current_balance)
        );
    }
    for desktop in store.category_spending_by_month(2026, 9, 2026, 10).unwrap() {
        let row = snapshot
            .history
            .categories
            .iter()
            .find(|r| r.month == desktop.month && r.category == desktop.category)
            .unwrap();
        assert_eq!(row.spending, money(desktop.amount));
    }
    for desktop in store.daily_spending(2026, 9, 2026, 10).unwrap() {
        assert_eq!(
            snapshot.history.daily.iter().find(|r| r.date == desktop.date).unwrap().spending,
            money(desktop.amount)
        );
    }
    for desktop in store.monthly_budget_actuals(2026, 10).unwrap() {
        assert_eq!(
            snapshot
                .budgets
                .iter()
                .find(|b| b.month == "2026-10")
                .unwrap()
                .lines
                .iter()
                .find(|l| l.category == desktop.category)
                .unwrap()
                .actual,
            money(desktop.actual)
        );
    }
    assert_eq!(snapshot.history.members.iter().find(|r| r.month == "2026-10").unwrap().income, "3025");
    assert_eq!(snapshot.history.tags.iter().find(|r| r.label == "Shared tag").unwrap().spending, "150");
    let json = contract::serialize_mobile_snapshot(&snapshot).unwrap();
    for secret in [
        "secret-split-note",
        "secret-provider-key",
        "secret-backup-location",
        "Payment applied from:",
        "Future row",
        "Linked outgoing",
        "Deleted",
    ] {
        assert!(!json.contains(secret));
    }
    store
        .conn
        .execute("UPDATE transactions SET deleted_at='2026-10-04' WHERE id=?1", [incoming])
        .unwrap();
    let orphan = store.build_mobile_snapshot(&context(), today()).unwrap();
    assert_eq!(
        orphan.history.months.last().unwrap().spending,
        "405",
        "a surviving orphan transfer leg counts again"
    );
}

#[test]
fn rollover_caps_empty_periods_and_future_budgets_are_read_only() {
    let store = Store::open_in_memory().unwrap();
    let account = store.get_or_create_account("Cash", AccountType::Checking).unwrap();
    store.set_rollover_enabled(true).unwrap();
    store.set_envelope_caps_enabled(true).unwrap();
    store.set_budget("Food", "2026-08", Money::from(100), "flexible").unwrap();
    store.set_budget_rollover("Food", "2026-08", true).unwrap();
    store.set_budget_cap("Food", "2026-08", true).unwrap();
    tx(&store, account, "2026-08-01", "-60", Some("Food"), "Shop");
    tx(&store, account, "2026-09-01", "-80", Some("Food"), "Shop");
    tx(&store, account, "2026-10-01", "-150", Some("Food"), "Shop");
    store.set_budget("Food", "2026-12", Money::from(250), "flexible").unwrap();
    store.set_budget_rollover("Food", "2026-12", true).unwrap();
    let before = contents(&store);
    let snapshot = store.build_mobile_snapshot(&context(), today()).unwrap();
    assert_eq!(before, contents(&store));
    let line = &snapshot.budgets.iter().find(|b| b.month == "2026-10").unwrap().lines[0];
    assert_eq!(
        (&line.rollover, &line.effective_budget, &line.remaining, line.alert.as_str()),
        (&"60".into(), &"160".into(), &"10".into(), "warning")
    );
    let desktop = store.monthly_budget_actuals(2026, 10).unwrap();
    assert_eq!(line.rollover, money(desktop[0].rollover));
    let future = snapshot.budgets.iter().find(|b| b.month == "2026-12").unwrap();
    assert!(future.actual_through.is_none());
    assert_eq!(future.lines[0].actual, "0");
    assert_eq!(future.lines[0].rollover, "0", "future budgets carry plans without invented actual carry");
    store.conn.execute("INSERT INTO budget_periods(period) VALUES('2026-11')", []).unwrap();
    let second = store.build_mobile_snapshot(&context(), today()).unwrap();
    assert!(second.budgets.iter().find(|b| b.month == "2026-11").unwrap().lines.is_empty());
}

#[test]
fn holdings_property_opening_and_checkpoints_match_desktop_without_recording_history() {
    let store = Store::open_in_memory().unwrap();
    let cash = store.get_or_create_account("Cash", AccountType::Checking).unwrap();
    let investment = store.get_or_create_account("Investments", AccountType::Investment).unwrap();
    store.set_account_starting_balance(cash, Money::from(1000)).unwrap();
    tx(&store, cash, "2026-08-01", "-100", Some("Food"), "Shop");
    store
        .set_account_balance_override(cash, Money::from(750), "2026-09-01".parse().unwrap())
        .unwrap();
    tx(&store, cash, "2026-10-01", "-25", Some("Food"), "Shop");
    store.set_account_starting_balance(investment, Money::from(9999)).unwrap();
    let h = store
        .create_holding(
            investment,
            "PRIVATE_SYMBOL",
            "Private holding name",
            Money::from(10),
            Money::from(20),
            Money::from(150),
            None,
        )
        .unwrap();
    store
        .create_asset(
            "House",
            "real_estate",
            Money::from(250000),
            "2026-09-01".parse().unwrap(),
            Some("secret-property-note"),
        )
        .unwrap();
    let before = contents(&store);
    let snapshot = store.build_mobile_snapshot(&context(), today()).unwrap();
    assert_eq!(before, contents(&store));
    assert_eq!(
        snapshot.overview.net_worth,
        money(store.net_worth_as_of(today()).unwrap() + Money::from(250000))
    );
    assert_eq!(snapshot.investments.value, "200");
    assert_eq!(snapshot.investments.unrealized_gain.as_deref(), Some("50"));
    assert!(snapshot.investments.day_change.is_none());
    assert!(snapshot.investments.coverage.quote_timestamp.is_none());
    assert!(snapshot.history.portfolio.is_empty());
    assert_eq!(snapshot.accounts.iter().find(|a| a.name == "Cash").unwrap().balance, "725");
    for point in &snapshot.history.net_worth {
        assert_eq!(
            point.net_worth,
            money(store.net_worth_as_of(point.date.parse().unwrap()).unwrap() + Money::from(250000))
        );
        assert_eq!(point.valuation_basis, "current_saved_values");
    }
    let json = contract::serialize_mobile_snapshot(&snapshot).unwrap();
    for secret in ["PRIVATE_SYMBOL", "Private holding name", "secret-property-note"] {
        assert!(!json.contains(secret));
    }
    store.update_holding_price(h, Money::from(22), today()).unwrap();
    let repriced = store.build_mobile_snapshot(&context(), today()).unwrap();
    assert_eq!(repriced.investments.day_change.as_deref(), Some("20"));
    assert_eq!(repriced.investments.coverage.previous_close_date.as_deref(), Some("2026-10-04"));
    let next = store.build_mobile_snapshot(&context(), today() + Duration::days(1)).unwrap();
    assert!(next.investments.day_change.is_none());
}

#[test]
fn error_and_nested_transaction_restore_connection_and_independent_stores_stay_separate() {
    let store = Store::open_in_memory().unwrap();
    let other = Store::open_in_memory().unwrap();
    let account = store.get_or_create_account("Private account", AccountType::Checking).unwrap();
    store.set_account_starting_balance(account, Money::from(123)).unwrap();
    assert_eq!(other.build_mobile_snapshot(&context(), today()).unwrap().overview.net_worth, "0");
    let mut invalid = context();
    invalid.profile_id = "bad/path".into();
    assert_eq!(
        store.build_mobile_snapshot(&invalid, today()).unwrap_err(),
        MobileSnapshotError::InvalidSnapshot
    );
    assert!(!store.conn.query_row("PRAGMA query_only", [], |r| r.get::<_, bool>(0)).unwrap());
    let transaction = store.conn.unchecked_transaction().unwrap();
    assert_eq!(store.build_mobile_snapshot(&context(), today()).unwrap_err(), MobileSnapshotError::Busy);
    transaction.rollback().unwrap();
    store.conn.pragma_update(None, "query_only", true).unwrap();
    store.build_mobile_snapshot(&context(), today()).unwrap();
    assert!(store.conn.query_row("PRAGMA query_only", [], |r| r.get::<_, bool>(0)).unwrap());
}

#[test]
fn comparison_results_provenance_and_shared_allocations_match_desktop() {
    use crate::comparisons::{
        setup::*,
        types::{AgeInput, MetricId},
    };
    let store = Store::open_in_memory().unwrap();
    let account = store.get_or_create_account("Shared savings", AccountType::Savings).unwrap();
    store.set_account_starting_balance(account, Money::from(1000)).unwrap();
    let roommate = store.create_family_member("Roommate").unwrap();
    let mut setup = ComparisonSetup::empty();
    setup.people = vec![
        PersonSetup {
            person: PersonRef::Owner,
            in_household: true,
            age: Some(AgeConfirmation {
                age: AgeInput::Exact { age: 42 },
                confirmed_on: "2026-10-04".into(),
            }),
        },
        PersonSetup {
            person: PersonRef::Member { id: roommate },
            in_household: false,
            age: None,
        },
    ];
    setup.household_reference_person = Some(PersonRef::Owner);
    setup.income.household_total = Some(ManualAmount {
        value: Money::from(100000),
        measured_on: "2026-10-01".into(),
        explanation: "Pay stubs".into(),
    });
    setup.allocations = vec![
        Allocation {
            source: SourceRef::Account { id: account },
            person: PersonRef::Owner,
            basis_points: 6000,
        },
        Allocation {
            source: SourceRef::Account { id: account },
            person: PersonRef::Member { id: roommate },
            basis_points: 4000,
        },
    ];
    setup.balance_confirmations = vec![BalanceConfirmation {
        metric: MetricId::Savings,
        confirmed_on: "2026-10-04".into(),
    }];
    store.save_comparison_setup(0, &setup, today()).unwrap();
    let before = contents(&store);
    let snapshot = store.build_mobile_snapshot(&context(), today()).unwrap();
    assert_eq!(before, contents(&store));
    let desktop = crate::comparisons::service::get_comparisons(&store, today()).unwrap().report.unwrap();
    assert_eq!(snapshot.comparisons.package_version.as_deref(), Some(desktop.package_version.as_str()));
    assert_eq!(snapshot.comparisons.cards.len(), desktop.cards.len());
    for card in desktop.cards {
        let metric = serde_json::to_value(card.result.metric).unwrap();
        let mobile = snapshot
            .comparisons
            .cards
            .iter()
            .find(|c| c.result.metric == metric.as_str().unwrap())
            .unwrap();
        assert_eq!(mobile.result.local_value, card.result.local_value.map(money));
        assert_eq!(mobile.result.status, serde_json::to_value(card.result.status).unwrap().as_str().unwrap());
        assert_eq!(mobile.result.dollar_difference, card.result.dollar_difference.map(money));
        assert_eq!(mobile.result.percent_difference, card.result.percent_difference);
        if let Some(reference) = card.result.reference {
            let r = mobile.result.reference.as_ref().unwrap();
            assert_eq!(r.adjusted_value, money(reference.adjusted_value));
            assert_eq!(r.source_url, reference.reference.source_url);
        }
    }
    let savings = snapshot.comparisons.cards.iter().find(|c| c.result.metric == "savings").unwrap();
    assert_eq!(savings.result.local_value.as_deref(), Some("600"));
    assert_eq!(savings.contributors[0].counted, "600");
    let json = contract::serialize_mobile_snapshot(&snapshot).unwrap();
    for forbidden in ["basisPoints", "accountIds", "allocations", "householdReferencePerson", "confirmedOn"] {
        assert!(!json.contains(forbidden));
    }
}

#[test]
fn personal_comparison_lines_keep_display_names_without_numeric_person_references() {
    use crate::comparisons::{setup::*, types::AgeInput};
    let store = Store::open_in_memory().unwrap();
    let partner = store.create_family_member("Partner").unwrap();
    let people = [PersonRef::Owner, PersonRef::Member { id: partner }];
    let mut setup = ComparisonSetup::empty();
    setup.household_reference_person = Some(PersonRef::Owner);
    setup.people = people
        .iter()
        .map(|person| PersonSetup {
            person: person.clone(),
            in_household: true,
            age: Some(AgeConfirmation {
                age: AgeInput::Exact { age: 42 },
                confirmed_on: "2026-10-04".into(),
            }),
        })
        .collect();
    setup.income.household_method = HouseholdIncomeMethod::ByPerson;
    setup.income.per_person = people
        .iter()
        .map(|person| PersonIncome {
            person: person.clone(),
            gross_annual: ManualAmount {
                value: Money::from(50000),
                measured_on: "2026-10-01".into(),
                explanation: "Pay stubs".into(),
            },
        })
        .collect();
    store.save_comparison_setup(0, &setup, today()).unwrap();
    let snapshot = store.build_mobile_snapshot(&context(), today()).unwrap();
    let income = snapshot.comparisons.cards.iter().find(|c| c.result.metric == "income").unwrap();
    assert_eq!(
        income.secondary.iter().map(|s| s.label.as_str()).collect::<Vec<_>>(),
        vec!["Me: Personal income", "Partner: Personal income"]
    );
    assert!(income.secondary.iter().all(|s| s.result.local_value.as_deref() == Some("50000")));
    let json = contract::serialize_mobile_snapshot(&snapshot).unwrap();
    assert!(!json.contains("\"person\""));
    assert!(!json.contains("\"source\""));
}

#[test]
fn minimized_calculator_inputs_match_desktop_without_auto_contributions() {
    let store = Store::open_in_memory().unwrap();
    let cash = store.get_or_create_account("Cash", AccountType::Checking).unwrap();
    store.set_account_starting_balance(cash, Money::from(5000)).unwrap();
    let investment = store.get_or_create_account("Investment", AccountType::Investment).unwrap();
    tx(&store, investment, "2026-04-01", "100", None, "Deposit");
    tx(&store, investment, "2026-07-01", "-25", None, "Withdrawal");
    tx(&store, investment, "2026-12-01", "9000", None, "Future deposit");
    let goal = store
        .create_bucket("Holiday", Some(Money::from(1000)), None, None, Some(Money::from(50)), None, None)
        .unwrap();
    store
        .add_bucket_contribution(goal, "2026-09-01".parse().unwrap(), Money::from(90), Some("secret-goal-note"))
        .unwrap();
    store
        .create_recurring("PRIVATE_RECURRING", None, Money::from(-100), "monthly", today(), Some(cash))
        .unwrap();
    let canceled = store
        .create_recurring("CANCELED_RECURRING", None, Money::from(-50), "monthly", today(), Some(cash))
        .unwrap();
    store.set_recurring_status(canceled, "canceled").unwrap();
    let before = contents(&store);
    let snapshot = store.build_mobile_snapshot(&context(), today()).unwrap();
    assert_eq!(before, contents(&store));
    let inputs = &snapshot.calculators.accumulation[0];
    let desktop = store.account_contributions(investment, today()).unwrap();
    assert_eq!(inputs.total_in, money(desktop.total_in));
    assert_eq!(inputs.total_out, money(desktop.total_out));
    assert_eq!(inputs.months.len(), 4);
    assert_eq!(inputs.months[1].money_in, "0");
    assert_eq!(snapshot.calculators.goals[0].saved, "90");
    assert_eq!(snapshot.calculators.goals[0].monthly_pace, "30");
    // Existing desktop recurring_totals includes canceled items; the scheduled forecast does not.
    assert_eq!(
        snapshot.calculators.recurring.monthly_expense,
        money(store.recurring_totals().unwrap().monthly_expense)
    );
    let forecast = store.bill_aware_forecast(today(), 90).unwrap();
    assert_eq!(snapshot.calculators.forecast.start_balance, money(forecast.start_balance));
    assert_eq!(snapshot.calculators.forecast.everyday_daily_net, money(forecast.daily_baseline));
    assert_eq!(snapshot.calculators.forecast.schedule[0].money_out, "100");
    let json = contract::serialize_mobile_snapshot(&snapshot).unwrap();
    for secret in ["secret-goal-note", "PRIVATE_RECURRING", "CANCELED_RECURRING", "Future deposit"] {
        assert!(!json.contains(secret));
    }
}

#[test]
fn switches_income_adjustments_zero_targets_and_36_month_rollover_cap_match_desktop() {
    let store = Store::open_in_memory().unwrap();
    let account = store.get_or_create_account("Cash", AccountType::Checking).unwrap();
    store.set_budget("Food", "2020-01", Money::from(10), "flexible").unwrap();
    store.set_budget_rollover("Food", "2020-01", true).unwrap();
    store.set_budget_cap("Food", "2020-01", true).unwrap();
    store.set_budget("Income", "2020-01", Money::from(100), "income").unwrap();
    store.set_budget("Zero", "2020-01", Money::ZERO, "nonmonthly").unwrap();
    store.set_budget("Flex2", "2020-01", Money::from(20), "flexible").unwrap();
    for (category, amount) in [("Exact", 100), ("Over", 101), ("Threshold", 80)] {
        store.set_budget(category, "2020-01", Money::from(100), "fixed").unwrap();
        store.set_budget_cap(category, "2020-01", true).unwrap();
        tx(&store, account, "2026-10-01", &(-amount).to_string(), Some(category), "Threshold fixture");
    }
    store.set_rollover_enabled(true).unwrap();
    store.set_envelope_caps_enabled(true).unwrap();
    tx(&store, account, "2026-10-01", "-25", Some("Income"), "Income correction");
    tx(&store, account, "2026-10-01", "-5", Some("Zero"), "Zero target spend");
    store
        .set_ui_state(super::super::UiStateKey::CategoryOrder, r#"["Zero","Income","Food"]"#)
        .unwrap();
    let before = contents(&store);
    let snapshot = store.build_mobile_snapshot(&context(), today()).unwrap();
    assert_eq!(before, contents(&store));
    let lines = &snapshot.budgets.iter().find(|m| m.month == "2026-10").unwrap().lines;
    let food = lines.iter().find(|l| l.category == "Food").unwrap();
    assert_eq!(food.rollover, "350");
    let income = lines.iter().find(|l| l.category == "Income").unwrap();
    assert_eq!(income.actual, "-25");
    assert_eq!(income.remaining, "-125");
    assert_eq!(income.alert, "none");
    let zero = lines.iter().find(|l| l.category == "Zero").unwrap();
    assert_eq!(zero.alert, "none");
    assert_eq!(lines[0].category, "Income");
    assert_eq!(
        lines
            .iter()
            .filter(|l| l.group == "flexible")
            .map(|l| l.category.as_str())
            .collect::<Vec<_>>(),
        vec!["Food", "Flex2"]
    );
    assert_eq!(lines.iter().find(|l| l.category == "Exact").unwrap().alert, "warning");
    assert_eq!(lines.iter().find(|l| l.category == "Over").unwrap().alert, "over");
    assert_eq!(lines.iter().find(|l| l.category == "Threshold").unwrap().alert, "none");
    let desktop = store.monthly_budget_actuals(2026, 10).unwrap();
    assert_eq!(food.rollover, money(desktop.iter().find(|l| l.category == "Food").unwrap().rollover));
    store.set_rollover_enabled(false).unwrap();
    store.set_envelope_caps_enabled(false).unwrap();
    let off = store.build_mobile_snapshot(&context(), today()).unwrap();
    let month = off.budgets.iter().find(|m| m.month == "2026-10").unwrap();
    assert!(!month.rollover_feature_enabled && !month.cap_feature_enabled);
    let food = month.lines.iter().find(|l| l.category == "Food").unwrap();
    assert_eq!(food.rollover, "0");
    assert!(food.rollover_enabled && food.cap_enabled);
    assert_eq!(month.lines.iter().find(|l| l.category == "Threshold").unwrap().alert, "warning");
}

#[test]
fn partial_and_ledger_only_investments_never_invent_gain_or_day_change() {
    let store = Store::open_in_memory().unwrap();
    let known = store.get_or_create_account("Known", AccountType::Investment).unwrap();
    let unknown = store.get_or_create_account("Ledger only", AccountType::Investment).unwrap();
    store.set_account_starting_balance(unknown, Money::from(50)).unwrap();
    let first = store
        .create_holding(known, "A", "A", Money::ONE, Money::from(10), Money::from(5), None)
        .unwrap();
    store
        .create_holding(known, "B", "B", Money::ONE, Money::from(20), Money::from(10), None)
        .unwrap();
    store.update_holding_price(first, Money::from(12), today()).unwrap();
    let snapshot = store.build_mobile_snapshot(&context(), today()).unwrap();
    assert_eq!(snapshot.investments.value, "82");
    assert!(snapshot.investments.cost_basis.is_none() && snapshot.investments.unrealized_gain.is_none() && snapshot.investments.day_change.is_none());
    let account = snapshot
        .investments
        .accounts
        .iter()
        .find(|a| a.account_id == context().alias("account", known))
        .unwrap();
    assert_eq!(account.unrealized_gain.as_deref(), Some("17"));
    assert!(account.day_change.is_none());
    assert_eq!(account.coverage.state, "partial");
}

#[test]
fn oversized_snapshot_fails_whole_refresh_without_truncation_or_writes() {
    let store = Store::open_in_memory().unwrap();
    let account = store.get_or_create_account("Cash", AccountType::Checking).unwrap();
    let transaction = store.conn.unchecked_transaction().unwrap();
    {
        let mut statement = store
            .conn
            .prepare("INSERT INTO transactions(account_id,date,description,amount,fingerprint) VALUES(?1,'2026-10-01',?2,'-1','size-fixture')")
            .unwrap();
        for i in 0..17000 {
            statement
                .execute(rusqlite::params![account, format!("Merchant {i:05} {}", "x".repeat(1000))])
                .unwrap();
        }
    }
    transaction.commit().unwrap();
    let before = store.conn.total_changes();
    assert_eq!(
        store.build_mobile_snapshot(&context(), today()).unwrap_err(),
        MobileSnapshotError::InvalidSnapshot
    );
    assert_eq!(before, store.conn.total_changes());
    assert_eq!(
        store
            .conn
            .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        17000
    );
    assert!(store.conn.is_autocommit());
    assert!(!store.conn.query_row("PRAGMA query_only", [], |r| r.get::<_, bool>(0)).unwrap());
}

#[test]
fn database_failure_unwinds_read_transaction_and_restores_query_only() {
    let store = Store::open_in_memory().unwrap();
    store.conn.execute("DROP TABLE holdings", []).unwrap();
    assert_eq!(
        store.build_mobile_snapshot(&context(), today()).unwrap_err(),
        MobileSnapshotError::Database
    );
    assert!(store.conn.is_autocommit());
    assert!(!store.conn.query_row("PRAGMA query_only", [], |r| r.get::<_, bool>(0)).unwrap());
}

#[test]
fn projection_observes_one_sqlite_snapshot_even_when_another_connection_changes_it() {
    let directory = std::env::temp_dir().join(format!("vaultspend-mobile-coherence-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("snapshot.db");
    {
        let reader = Store::open(&path).unwrap();
        reader.conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        let account = reader.get_or_create_account("Cash", AccountType::Checking).unwrap();
        reader.set_account_starting_balance(account, Money::from(100)).unwrap();
        let writer = Store::open(&path).unwrap();
        reader.conn.pragma_update(None, "query_only", true).unwrap();
        let guard = QueryOnly {
            conn: &reader.conn,
            previous: false,
        };
        let transaction = reader.conn.unchecked_transaction().unwrap();
        // The first read fixes the same transaction snapshot used by every projection subreader.
        assert_eq!(reader.list_accounts(today()).unwrap()[0].current_balance, Money::from(100));
        writer.set_account_starting_balance(account, Money::from(200)).unwrap();
        let log_before = std::fs::read(directory.join("account-changes.log")).unwrap();
        let coherent = reader.project_mobile_snapshot(&context(), today()).unwrap();
        assert_eq!(log_before, std::fs::read(directory.join("account-changes.log")).unwrap());
        assert_eq!(coherent.accounts[0].balance, "100");
        assert_eq!(coherent.overview.net_worth, "100");
        assert_eq!(coherent.calculators.forecast.start_balance, "100");
        assert!(
            reader.list_budgets("2026-10").is_err(),
            "query_only must reject accidental materialization"
        );
        transaction.rollback().unwrap();
        drop(guard);
        assert_eq!(reader.build_mobile_snapshot(&context(), today()).unwrap().overview.net_worth, "200");
    }
    std::fs::remove_file(path).unwrap();
    std::fs::remove_file(directory.join("account-changes.log")).unwrap();
    // SQLite removes its WAL/SHM files when the last connection closes.
    std::fs::remove_dir(directory).unwrap();
}
