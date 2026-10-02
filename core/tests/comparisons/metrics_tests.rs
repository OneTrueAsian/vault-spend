use super::setup_tests::{amount, base_setup, person, today};
use budget_core::comparisons::metrics::*;
use budget_core::comparisons::setup::*;
use budget_core::comparisons::types::{Completeness, MetricId, Unit};
use budget_core::models::AccountType;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::str::FromStr;

fn dec(s: &str) -> Decimal {
    Decimal::from_str(s).unwrap()
}

fn d(y: i32, m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, day).unwrap()
}

fn account(id: i64, name: &str, kind: AccountType, balance: &str) -> AccountSnap {
    AccountSnap { id, name: name.into(), kind, starting_balance: Decimal::ZERO, balance: dec(balance) }
}

fn card(id: i64, name: &str, limit: &str, available: &str) -> AccountSnap {
    AccountSnap { id, name: name.into(), kind: AccountType::Credit, starting_balance: dec(limit), balance: dec(available) }
}

fn snapshot(accounts: Vec<AccountSnap>) -> Snapshot {
    Snapshot { today: today(), accounts, assets: vec![], spend_rows: vec![], first_transaction_date: None }
}

fn confirmed(mut s: ComparisonSetup, metrics: &[MetricId]) -> ComparisonSetup {
    for m in metrics {
        s.balance_confirmations.push(BalanceConfirmation { metric: *m, confirmed_on: "2026-09-30".into() });
    }
    s
}

fn acct(id: i64) -> SourceRef {
    SourceRef::Account { id }
}

fn share(source: SourceRef, who: PersonRef, bp: u32) -> Allocation {
    Allocation { source, person: who, basis_points: bp }
}

fn metric(snap: &Snapshot, setup: &ComparisonSetup, m: MetricId) -> MetricComputation {
    compute_metric(snap, setup, m)
}

fn solo_setup() -> ComparisonSetup {
    let mut s = ComparisonSetup::empty();
    s.people = vec![PersonSetup { person: PersonRef::Owner, age: None, in_household: true }];
    s
}

// ---- Savings -----------------------------------------------------------------------------------

#[test]
fn savings_counts_checking_and_savings_and_nothing_else_by_default() {
    let snap = snapshot(vec![
        account(1, "Checking", AccountType::Checking, "1000"),
        account(2, "Rainy day", AccountType::Savings, "4000"),
        account(3, "Brokerage", AccountType::Investment, "90000"),
        card(4, "Card", "5000", "4000"),
        AccountSnap { id: 5, name: "Mortgage".into(), kind: AccountType::Loan, starting_balance: dec("200000"), balance: dec("190000") },
        account(6, "Misc", AccountType::Other, "777"),
    ]);
    let setup = confirmed(solo_setup(), &[MetricId::Savings]);
    let m = metric(&snap, &setup, MetricId::Savings);
    assert_eq!(m.value, Some(dec("5000")));
    assert_eq!(m.unit, Unit::UsdBalance);
    assert_eq!(m.completeness, Completeness::Confirmed);
    assert!(m.holds_item);
    let names: Vec<_> = m.contributors.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(names, ["Checking", "Rainy day"]);
    assert_eq!(m.excluded.len(), 4, "brokerage, card, mortgage and the other account are listed as excluded");
}

#[test]
fn an_other_account_or_brokerage_cash_counts_only_when_explicitly_included() {
    let snap = snapshot(vec![
        account(1, "Checking", AccountType::Checking, "1000"),
        account(6, "Misc", AccountType::Other, "777"),
        account(3, "Brokerage cash", AccountType::Investment, "250"),
    ]);
    let mut setup = confirmed(solo_setup(), &[MetricId::Savings]);
    setup.savings_overrides = vec![
        SavingsOverride { source: acct(6), include: true },
        SavingsOverride { source: acct(3), include: true },
    ];
    assert_eq!(metric(&snap, &setup, MetricId::Savings).value, Some(dec("2027")));
}

#[test]
fn a_default_savings_account_can_be_excluded() {
    let snap = snapshot(vec![account(1, "Checking", AccountType::Checking, "1000"), account(2, "Savings", AccountType::Savings, "500")]);
    let mut setup = confirmed(solo_setup(), &[MetricId::Savings]);
    setup.savings_overrides = vec![SavingsOverride { source: acct(1), include: false }];
    let m = metric(&snap, &setup, MetricId::Savings);
    assert_eq!(m.value, Some(dec("500")));
    assert_eq!(m.excluded[0].reason, ExcludeReason::UserExcluded);
}

#[test]
fn credit_and_loan_accounts_never_count_toward_savings_even_if_included() {
    let snap = snapshot(vec![card(4, "Card", "5000", "4000")]);
    let mut setup = confirmed(solo_setup(), &[MetricId::Savings]);
    setup.savings_overrides = vec![SavingsOverride { source: acct(4), include: true }];
    assert_eq!(metric(&snap, &setup, MetricId::Savings).value, Some(Decimal::ZERO));
}

#[test]
fn savings_is_unconfirmed_until_the_person_confirms_it() {
    let snap = snapshot(vec![account(1, "Checking", AccountType::Checking, "1000")]);
    let m = metric(&snap, &solo_setup(), MetricId::Savings);
    assert_eq!(m.value, Some(dec("1000")));
    assert_eq!(m.completeness, Completeness::Unknown);
}

// ---- Allocation --------------------------------------------------------------------------------

fn couple_setup() -> ComparisonSetup {
    let mut s = base_setup();
    s.people = vec![
        PersonSetup { person: PersonRef::Owner, age: None, in_household: true },
        PersonSetup { person: person(7), age: None, in_household: true },
        PersonSetup { person: person(8), age: None, in_household: false },
    ];
    s
}

#[test]
fn household_totals_count_a_joint_account_once_not_once_per_member() {
    let snap = snapshot(vec![account(1, "Joint checking", AccountType::Checking, "1000")]);
    let mut setup = confirmed(couple_setup(), &[MetricId::Savings]);
    setup.allocations = vec![share(acct(1), PersonRef::Owner, 6000), share(acct(1), person(7), 4000)];
    assert_eq!(metric(&snap, &setup, MetricId::Savings).value, Some(dec("1000")));
}

#[test]
fn a_roommates_share_is_left_out_of_the_household() {
    let snap = snapshot(vec![account(1, "Shared checking", AccountType::Checking, "1000")]);
    let mut setup = confirmed(couple_setup(), &[MetricId::Savings]);
    setup.allocations = vec![share(acct(1), PersonRef::Owner, 7000), share(acct(1), person(8), 3000)];
    assert_eq!(metric(&snap, &setup, MetricId::Savings).value, Some(dec("700")));
}

#[test]
fn an_unallocated_remainder_is_reported_and_blocks_a_confident_result() {
    let snap = snapshot(vec![account(1, "Joint", AccountType::Checking, "1000")]);
    let mut setup = confirmed(couple_setup(), &[MetricId::Savings]);
    setup.allocations = vec![share(acct(1), PersonRef::Owner, 6000)];
    let m = metric(&snap, &setup, MetricId::Savings);
    assert_eq!(m.value, Some(dec("600")));
    assert_eq!(m.unallocated, dec("400"));
    assert_eq!(m.completeness, Completeness::Partial);
}

#[test]
fn a_person_living_alone_owns_unallocated_accounts_outright() {
    let snap = snapshot(vec![account(1, "Checking", AccountType::Checking, "1000")]);
    let setup = confirmed(solo_setup(), &[MetricId::Savings]);
    let m = metric(&snap, &setup, MetricId::Savings);
    assert_eq!((m.value, m.completeness), (Some(dec("1000")), Completeness::Confirmed));
}

#[test]
fn a_share_given_to_a_roommate_is_left_out_of_the_household() {
    let snap = snapshot(vec![account(1, "Shared", AccountType::Checking, "1000")]);
    let mut setup = confirmed(couple_setup(), &[MetricId::Savings]);
    setup.allocations = vec![share(acct(1), PersonRef::Owner, 6000), share(acct(1), person(8), 4000)];
    let m = metric(&snap, &setup, MetricId::Savings);
    assert_eq!(m.value, Some(dec("600")));
}

// ---- Investments -------------------------------------------------------------------------------

#[test]
fn investments_use_the_comparison_classification_and_never_double_count() {
    // The account balance already reflects its holdings (the store prefers holdings over cash),
    // so one account contributes exactly once.
    let snap = snapshot(vec![
        account(10, "401k", AccountType::Investment, "50000"),
        account(11, "Brokerage", AccountType::Investment, "20000"),
        account(12, "529", AccountType::Investment, "5000"),
        account(13, "Crypto", AccountType::Investment, "999"),
    ]);
    let mut setup = confirmed(solo_setup(), &[MetricId::Investments]);
    setup.investment_classes = vec![
        InvestmentClassification { source: acct(10), class: InvestmentClass::Retirement },
        InvestmentClassification { source: acct(11), class: InvestmentClass::Taxable },
        InvestmentClassification { source: acct(12), class: InvestmentClass::Education },
        InvestmentClassification { source: acct(13), class: InvestmentClass::Exclude },
    ];
    let m = metric(&snap, &setup, MetricId::Investments);
    assert_eq!(m.value, Some(dec("50000")), "the headline is retirement balances");
    assert_eq!(m.class_totals.get("retirement"), Some(&dec("50000")));
    assert_eq!(m.class_totals.get("taxable"), Some(&dec("20000")));
    assert_eq!(m.class_totals.get("education"), Some(&dec("5000")));
    assert_eq!(m.excluded.len(), 1);
    assert_eq!(m.completeness, Completeness::Confirmed);
}

#[test]
fn an_unclassified_investment_account_is_listed_and_blocks_a_confident_result() {
    let snap = snapshot(vec![account(10, "401k", AccountType::Investment, "50000")]);
    let setup = confirmed(solo_setup(), &[MetricId::Investments]);
    let m = metric(&snap, &setup, MetricId::Investments);
    assert_eq!(m.value, Some(Decimal::ZERO));
    assert_eq!(m.completeness, Completeness::Partial);
    assert_eq!(m.excluded[0].reason, ExcludeReason::Unclassified);
}

#[test]
fn partial_coverage_only_counts_once_the_person_has_confirmed_the_balance() {
    // Unclassified investment accounts, nothing confirmed yet: the person has not engaged, so this is
    // simply "not confirmed", not "partly done".
    let snap = snapshot(vec![account(10, "401k", AccountType::Investment, "50000")]);
    let before = metric(&snap, &solo_setup(), MetricId::Investments);
    assert_eq!(before.completeness, Completeness::Unknown);
    let after = metric(&snap, &confirmed(solo_setup(), &[MetricId::Investments]), MetricId::Investments);
    assert_eq!(after.completeness, Completeness::Partial);
}

#[test]
fn a_classified_asset_counts_and_an_unclassified_one_does_not() {
    let mut snap = snapshot(vec![]);
    snap.assets = vec![
        AssetSnap { id: 5, name: "Rental".into(), value: dec("30000"), valued_on: d(2026, 9, 1) },
        AssetSnap { id: 6, name: "Car".into(), value: dec("9000"), valued_on: d(2026, 9, 1) },
    ];
    let mut setup = confirmed(solo_setup(), &[MetricId::Investments]);
    setup.investment_classes = vec![InvestmentClassification { source: SourceRef::Asset { id: 5 }, class: InvestmentClass::Retirement }];
    let m = metric(&snap, &setup, MetricId::Investments);
    assert_eq!(m.value, Some(dec("30000")));
    assert!(m.excluded.is_empty(), "plain assets are not investments unless the person says so");
}

#[test]
fn a_stale_asset_valuation_is_called_out() {
    let mut snap = snapshot(vec![]);
    snap.assets = vec![AssetSnap { id: 5, name: "Rental".into(), value: dec("30000"), valued_on: d(2025, 1, 1) }];
    let mut setup = confirmed(solo_setup(), &[MetricId::Investments]);
    setup.investment_classes = vec![InvestmentClassification { source: SourceRef::Asset { id: 5 }, class: InvestmentClass::Taxable }];
    let m = metric(&snap, &setup, MetricId::Investments);
    assert!(m.notes.iter().any(|n| n.code == "stale_valuation"), "{:?}", m.notes);
}

// ---- Debt --------------------------------------------------------------------------------------

#[test]
fn debt_is_what_is_owed_not_limits_or_payments() {
    let snap = snapshot(vec![
        card(1, "Visa", "10000", "7500"),
        AccountSnap { id: 2, name: "Mortgage".into(), kind: AccountType::Loan, starting_balance: dec("250000"), balance: dec("240000") },
        account(3, "Checking", AccountType::Checking, "1000"),
    ]);
    let setup = confirmed(solo_setup(), &[MetricId::Debt]);
    let m = metric(&snap, &setup, MetricId::Debt);
    assert_eq!(m.value, Some(dec("242500")));
    assert!(m.holds_item);
    assert_eq!(m.contributors.len(), 2);
}

#[test]
fn a_card_paid_in_full_counts_zero_and_zero_debt_is_a_valid_zero() {
    let snap = snapshot(vec![card(1, "Visa", "10000", "10000")]);
    let setup = confirmed(solo_setup(), &[MetricId::Debt]);
    let m = metric(&snap, &setup, MetricId::Debt);
    assert_eq!(m.value, Some(Decimal::ZERO));
    assert!(!m.holds_item);
    assert_eq!(m.completeness, Completeness::Confirmed);
}

#[test]
fn an_overpaid_card_never_reduces_debt_below_zero() {
    let snap = snapshot(vec![card(1, "Visa", "10000", "10300")]);
    let m = metric(&snap, &confirmed(solo_setup(), &[MetricId::Debt]), MetricId::Debt);
    assert_eq!(m.value, Some(Decimal::ZERO));
}

#[test]
fn a_card_can_be_excluded_from_the_debt_comparison_only() {
    let snap = snapshot(vec![card(1, "Visa", "10000", "7500"), card(2, "Amex", "5000", "4000")]);
    let mut setup = confirmed(solo_setup(), &[MetricId::Debt]);
    setup.debt_exclusions = vec![acct(2)];
    let m = metric(&snap, &setup, MetricId::Debt);
    assert_eq!(m.value, Some(dec("2500")));
    assert_eq!(m.excluded[0].reason, ExcludeReason::UserExcluded);
}

#[test]
fn debt_is_broken_down_by_type_and_unclassified_loans_are_noted() {
    let snap = snapshot(vec![
        card(1, "Visa", "10000", "9000"),
        AccountSnap { id: 2, name: "Home loan".into(), kind: AccountType::Loan, starting_balance: dec("0"), balance: dec("200000") },
        AccountSnap { id: 3, name: "Student".into(), kind: AccountType::Loan, starting_balance: dec("0"), balance: dec("15000") },
        AccountSnap { id: 4, name: "Mystery".into(), kind: AccountType::Loan, starting_balance: dec("0"), balance: dec("300") },
    ]);
    let mut setup = confirmed(solo_setup(), &[MetricId::Debt]);
    setup.debt_classes = vec![
        DebtClassification { source: acct(2), class: DebtClass::Mortgage },
        DebtClassification { source: acct(3), class: DebtClass::StudentLoan },
    ];
    let m = metric(&snap, &setup, MetricId::Debt);
    assert_eq!(m.value, Some(dec("216300")));
    assert_eq!(m.class_totals.get("credit_card"), Some(&dec("1000")));
    assert_eq!(m.class_totals.get("mortgage"), Some(&dec("200000")));
    assert_eq!(m.class_totals.get("student_loan"), Some(&dec("15000")));
    assert_eq!(m.class_totals.get("unclassified"), Some(&dec("300")));
    assert!(m.notes.iter().any(|n| n.code == "unclassified_debt"));
}

// ---- Income ------------------------------------------------------------------------------------

#[test]
fn income_is_never_estimated_from_tracked_take_home() {
    let m = metric(&snapshot(vec![]), &solo_setup(), MetricId::Income);
    assert_eq!(m.value, None);
    assert_eq!(m.unit, Unit::UsdPerYear);
}

#[test]
fn household_income_uses_exactly_the_selected_method() {
    let mut setup = couple_setup();
    setup.income.household_total = Some(amount("120000"));
    setup.income.per_person = vec![
        PersonIncome { person: PersonRef::Owner, gross_annual: amount("70000") },
        PersonIncome { person: person(7), gross_annual: amount("30000") },
    ];
    setup.income.household_method = HouseholdIncomeMethod::Total;
    assert_eq!(metric(&snapshot(vec![]), &setup, MetricId::Income).value, Some(dec("120000")));
    setup.income.household_method = HouseholdIncomeMethod::ByPerson;
    let by_person = metric(&snapshot(vec![]), &setup, MetricId::Income);
    assert_eq!(by_person.value, Some(dec("100000")), "the inactive total is preserved but not used");
    assert_eq!(by_person.completeness, Completeness::Confirmed);
    setup.income.household_method = HouseholdIncomeMethod::Total;
    assert_eq!(metric(&snapshot(vec![]), &setup, MetricId::Income).value, Some(dec("120000")), "switching back restores it");
}

#[test]
fn by_person_income_ignores_roommates_and_flags_a_missing_member() {
    let mut setup = couple_setup();
    setup.income.household_method = HouseholdIncomeMethod::ByPerson;
    setup.income.per_person = vec![
        PersonIncome { person: PersonRef::Owner, gross_annual: amount("70000") },
        PersonIncome { person: person(8), gross_annual: amount("99999") },
    ];
    let m = metric(&snapshot(vec![]), &setup, MetricId::Income);
    assert_eq!(m.value, Some(dec("70000")));
    assert_eq!(m.completeness, Completeness::Partial, "partner 7 has no entry");
}

// ---- Spending ----------------------------------------------------------------------------------

fn rows_for_last_twelve_months(per_month: &str) -> Vec<SpendRow> {
    // Today is 2026-09-30, so the last 12 completed months are 2025-09 .. 2026-08.
    let mut rows = Vec::new();
    for (y, m) in (9..=12).map(|m| (2025, m)).chain((1..=8).map(|m| (2026, m))) {
        rows.push(SpendRow { account_id: 1, date: d(y, m, 15), amount: dec(per_month) });
    }
    rows
}

fn spending_snapshot(rows: Vec<SpendRow>) -> Snapshot {
    let mut s = snapshot(vec![account(1, "Checking", AccountType::Checking, "0")]);
    s.first_transaction_date = rows.iter().map(|r| r.date).min();
    s.spend_rows = rows;
    s
}

#[test]
fn spending_sums_the_last_twelve_completed_months_once_confirmed() {
    let snap = spending_snapshot(rows_for_last_twelve_months("1000"));
    let mut setup = solo_setup();
    setup.spending.completeness_confirmed = true;
    let m = metric(&snap, &setup, MetricId::Spending);
    assert_eq!(m.value, Some(dec("12000")));
    assert_eq!(m.unit, Unit::UsdPerYear);
    assert_eq!(m.completeness, Completeness::Confirmed);
    let p = m.period.unwrap();
    assert_eq!((p.from.as_str(), p.to.as_str()), ("2025-09-01", "2026-08-31"));
}

#[test]
fn the_current_partial_month_is_not_counted() {
    let mut rows = rows_for_last_twelve_months("1000");
    rows.push(SpendRow { account_id: 1, date: d(2026, 9, 10), amount: dec("5000") });
    let mut setup = solo_setup();
    setup.spending.completeness_confirmed = true;
    assert_eq!(metric(&spending_snapshot(rows), &setup, MetricId::Spending).value, Some(dec("12000")));
}

#[test]
fn spending_is_not_confirmed_until_the_person_says_it_is_complete() {
    let snap = spending_snapshot(rows_for_last_twelve_months("1000"));
    let m = metric(&snap, &solo_setup(), MetricId::Spending);
    assert_eq!(m.value, Some(dec("12000")));
    assert_eq!(m.completeness, Completeness::Unknown);
}

#[test]
fn fewer_than_twelve_months_is_never_annualised() {
    let rows: Vec<_> = rows_for_last_twelve_months("1000").into_iter().skip(6).collect();
    let mut setup = solo_setup();
    setup.spending.completeness_confirmed = true;
    let m = metric(&spending_snapshot(rows), &setup, MetricId::Spending);
    assert_eq!(m.value, None);
    assert!(m.notes.iter().any(|n| n.code == "fewer_than_12_months"), "{:?}", m.notes);
}

#[test]
fn one_missing_imported_month_blocks_a_derived_total_and_names_the_month() {
    let mut rows = rows_for_last_twelve_months("1000");
    rows.retain(|r| r.date.format("%Y-%m").to_string() != "2026-02");
    let mut setup = solo_setup();
    setup.spending.completeness_confirmed = true;
    let m = metric(&spending_snapshot(rows), &setup, MetricId::Spending);
    assert_eq!(m.value, None);
    let note = m.notes.iter().find(|n| n.code == "missing_months").expect("names the gap");
    assert!(note.detail.contains("2026-02"), "{}", note.detail);
}

#[test]
fn a_manual_annual_spending_figure_stands_in_for_short_history() {
    let mut setup = solo_setup();
    setup.spending.manual_annual = Some(amount("48000"));
    let m = metric(&spending_snapshot(vec![]), &setup, MetricId::Spending);
    assert_eq!(m.value, Some(dec("48000")));
    assert_eq!(m.completeness, Completeness::Confirmed);
    assert!(matches!(m.origin, Origin::Entered { .. }));
}

#[test]
fn only_selected_accounts_count_toward_spending() {
    let mut rows = rows_for_last_twelve_months("1000");
    rows.extend(rows_for_last_twelve_months("1000").into_iter().map(|mut r| {
        r.account_id = 2;
        r
    }));
    let mut snap = spending_snapshot(rows);
    snap.accounts.push(account(2, "Card", AccountType::Credit, "0"));
    let mut setup = solo_setup();
    setup.spending.completeness_confirmed = true;
    setup.spending.account_ids = vec![1];
    assert_eq!(metric(&snap, &setup, MetricId::Spending).value, Some(dec("12000")));
    setup.spending.account_ids = vec![];
    assert_eq!(metric(&snap, &setup, MetricId::Spending).value, Some(dec("24000")));
}

// ---- Manual overrides and staleness ---------------------------------------------------------------

#[test]
fn a_manual_override_replaces_the_derived_value_and_keeps_the_tracked_one_visible() {
    let snap = snapshot(vec![account(1, "Checking", AccountType::Checking, "1000")]);
    let mut setup = solo_setup();
    setup.manual_overrides = vec![ManualOverride { metric: MetricId::Savings, amount: amount("25000") }];
    let m = metric(&snap, &setup, MetricId::Savings);
    assert_eq!(m.value, Some(dec("25000")));
    assert_eq!(m.tracked_value, Some(dec("1000")));
    assert_eq!(m.completeness, Completeness::Confirmed, "an entered total is its own confirmation");
    assert!(matches!(m.origin, Origin::Entered { .. }));
}

fn stale_after(metric_id: MetricId, measured_on: &str) -> bool {
    let mut a = amount("100");
    a.measured_on = measured_on.into();
    let mut setup = solo_setup();
    setup.manual_overrides = vec![ManualOverride { metric: metric_id, amount: a }];
    match metric(&snapshot(vec![]), &setup, metric_id).origin {
        Origin::Entered { stale, .. } => stale,
        other => panic!("{other:?}"),
    }
}

#[test]
fn staleness_thresholds_are_a_year_for_flows_and_ninety_days_for_balances() {
    // Today is 2026-09-30.
    assert!(!stale_after(MetricId::Income, "2025-10-01"));
    assert!(stale_after(MetricId::Income, "2025-09-29"));
    assert!(!stale_after(MetricId::Spending, "2025-10-01"));
    assert!(stale_after(MetricId::Spending, "2025-09-29"));
    assert!(!stale_after(MetricId::Savings, "2026-07-02"));
    assert!(stale_after(MetricId::Savings, "2026-07-01"));
    assert!(stale_after(MetricId::Investments, "2026-01-01"));
    assert!(!stale_after(MetricId::Debt, "2026-09-30"));
}

#[test]
fn a_stale_override_still_applies() {
    let mut a = amount("5000");
    a.measured_on = "2020-01-01".into();
    let mut setup = solo_setup();
    setup.manual_overrides = vec![ManualOverride { metric: MetricId::Debt, amount: a }];
    assert_eq!(metric(&snapshot(vec![]), &setup, MetricId::Debt).value, Some(dec("5000")));
}

#[test]
fn an_entered_origin_serialises_with_the_camel_case_keys_the_frontend_reads() {
    let mut setup = solo_setup();
    setup.income.household_total = Some(amount("100000"));
    let m = metric(&snapshot(vec![]), &setup, MetricId::Income);
    let json = serde_json::to_value(&m).unwrap();
    assert_eq!(json["origin"]["kind"], "entered");
    assert_eq!(json["origin"]["measuredOn"], "2026-09-01");
    assert_eq!(json["origin"]["explanation"], "From my pay stubs");
    assert!(json["origin"].get("measured_on").is_none());
}

#[test]
fn all_five_metrics_are_computed_in_order() {
    let all = compute_metrics(&snapshot(vec![]), &solo_setup());
    let ids: Vec<_> = all.iter().map(|m| m.metric).collect();
    assert_eq!(ids, [MetricId::Spending, MetricId::Investments, MetricId::Income, MetricId::Savings, MetricId::Debt]);
}
