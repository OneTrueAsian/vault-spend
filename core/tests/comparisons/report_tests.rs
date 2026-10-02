use super::common::*;
use super::setup_tests::{amount, base_setup, person, today};
use budget_core::comparisons::metrics::{AccountSnap, Snapshot};
use budget_core::comparisons::package::Package;
use budget_core::comparisons::report::{CardView, ComparisonsReport, SecondaryCard, build_report};
use budget_core::comparisons::setup::*;
use budget_core::comparisons::types::{AgeInput, CardStatus, Completeness, MetricId, Reason, Statistic, Universe};
use budget_core::models::AccountType;
use rust_decimal::Decimal;
use serde_json::json;
use std::str::FromStr;

fn dec(s: &str) -> Decimal {
    Decimal::from_str(s).unwrap()
}

fn empty_snapshot() -> Snapshot {
    Snapshot {
        today: today(),
        accounts: vec![],
        assets: vec![],
        spend_rows: vec![],
        first_transaction_date: None,
    }
}

fn age(setup: &mut ComparisonSetup, who: PersonRef, age: AgeInput) {
    let p = setup.people.iter_mut().find(|p| p.person == who).unwrap();
    p.age = Some(AgeConfirmation {
        age,
        confirmed_on: "2026-09-01".into(),
    });
}

fn setup_42() -> ComparisonSetup {
    let mut s = base_setup();
    age(&mut s, PersonRef::Owner, AgeInput::Exact { age: 42 });
    s
}

fn card(report: &ComparisonsReport, metric: MetricId) -> &CardView {
    report.cards.iter().find(|c| c.result.metric == metric).expect("a card for every metric")
}

fn bundled() -> &'static Package {
    Package::bundled().unwrap()
}

#[test]
fn there_is_always_one_card_per_metric_in_the_mockups_order() {
    let report = build_report(bundled(), &setup_42(), &empty_snapshot());
    let order: Vec<_> = report.cards.iter().map(|c| c.result.metric).collect();
    assert_eq!(
        order,
        [
            MetricId::Spending,
            MetricId::Investments,
            MetricId::Income,
            MetricId::Savings,
            MetricId::Debt
        ]
    );
    assert_eq!(report.package_version, bundled().package_version());
}

#[test]
fn household_income_is_compared_with_the_cohort_for_the_reference_persons_age() {
    let mut setup = setup_42();
    setup.income.household_total = Some(amount("100000"));
    let report = build_report(bundled(), &setup, &empty_snapshot());
    let c = card(&report, MetricId::Income);
    assert_eq!(c.result.status, CardStatus::Comparable);
    let r = c.result.reference.as_ref().unwrap();
    assert_eq!(r.reference.definition_id, "cps_hinc02_money_income_median");
    assert!(r.reference.age_min <= 42 && r.reference.age_max.is_some_and(|m| m >= 42));
    assert!(c.visible);
}

#[test]
fn the_reference_persons_age_drives_household_matching_not_someone_elses() {
    let mut setup = setup_42();
    age(&mut setup, person(7), AgeInput::Exact { age: 67 });
    setup.income.household_total = Some(amount("100000"));
    let report = build_report(bundled(), &setup, &empty_snapshot());
    assert!(
        card(&report, MetricId::Income)
            .result
            .reference
            .as_ref()
            .unwrap()
            .reference
            .age_max
            .unwrap()
            < 50
    );
    setup.household_reference_person = Some(person(7));
    let report = build_report(bundled(), &setup, &empty_snapshot());
    assert_eq!(card(&report, MetricId::Income).result.reference.as_ref().unwrap().reference.age_min, 65);
}

#[test]
fn cards_missing_user_input_are_hidden_but_benchmark_gaps_stay_visible() {
    let report = build_report(bundled(), &setup_42(), &empty_snapshot());
    let income = card(&report, MetricId::Income);
    assert_eq!((income.result.status, income.visible), (CardStatus::MissingInput, false));
    let spending = card(&report, MetricId::Spending);
    assert_eq!(
        (spending.result.status, spending.visible),
        (CardStatus::MissingInput, false),
        "household spending has a benchmark now"
    );
}

#[test]
fn household_spending_entered_by_hand_is_compared_with_the_average_for_the_age_group() {
    let mut setup = setup_42();
    setup.spending.manual_annual = Some(amount("87000"));
    let report = build_report(bundled(), &setup, &empty_snapshot());
    let spending = card(&report, MetricId::Spending);
    assert_eq!(spending.result.status, CardStatus::Comparable);
    let r = spending.result.reference.as_ref().unwrap();
    assert_eq!(r.reference.definition_id, "bls_ce_total_expenditures_mean");
    assert_eq!((r.reference.age_min, r.reference.age_max), (35, Some(44)));
    assert_eq!(r.reference.statistic, Statistic::Mean);
    assert!(spending.visible);
}

#[test]
fn without_an_age_every_card_with_a_benchmark_is_hidden() {
    let mut setup = base_setup();
    setup.people[0].age = None;
    setup.income.household_total = Some(amount("100000"));
    let report = build_report(bundled(), &setup, &empty_snapshot());
    assert_eq!(card(&report, MetricId::Income).result.status, CardStatus::MissingInput);
    assert!(!card(&report, MetricId::Income).visible);
}

#[test]
fn an_age_band_spanning_published_cohorts_asks_for_a_choice_and_remembers_it() {
    let mut setup = setup_42();
    age(&mut setup, PersonRef::Owner, AgeInput::Band { min: 40, max: Some(49) });
    setup.income.household_total = Some(amount("100000"));
    let c = card(&build_report(bundled(), &setup, &empty_snapshot()), MetricId::Income).clone();
    assert_eq!(c.result.status, CardStatus::CohortChoiceRequired);
    assert_eq!((c.cohort_options[0].age_min, c.cohort_options[1].age_min), (40, 45));

    setup.cohort_choices = vec![CohortChoice {
        metric: MetricId::Income,
        reference_id: "cps_hinc02_money_income_median:45-49".into(),
    }];
    let chosen = card(&build_report(bundled(), &setup, &empty_snapshot()), MetricId::Income).clone();
    assert_eq!(chosen.result.status, CardStatus::Comparable);
    assert_eq!(chosen.result.reference.unwrap().reference.age_min, 45);
    assert_eq!(chosen.cohort_options.len(), 2, "the choice can be changed later");
}

#[test]
fn zero_debt_is_not_compared_with_the_holders_only_statistic() {
    let mut snap = empty_snapshot();
    snap.accounts = vec![AccountSnap {
        id: 1,
        name: "Visa".into(),
        kind: AccountType::Credit,
        starting_balance: dec("1000"),
        balance: dec("1000"),
    }];
    let mut setup = setup_42();
    setup.balance_confirmations = vec![BalanceConfirmation {
        metric: MetricId::Debt,
        confirmed_on: "2026-09-30".into(),
    }];
    let c = card(&build_report(bundled(), &setup, &snap), MetricId::Debt).clone();
    assert_eq!(c.result.status, CardStatus::NotComparable);
    assert!(c.visible);
}

#[test]
fn debt_with_a_mortgage_adds_a_home_debt_comparison() {
    let mut snap = empty_snapshot();
    snap.accounts = vec![AccountSnap {
        id: 2,
        name: "Home loan".into(),
        kind: AccountType::Loan,
        starting_balance: dec("0"),
        balance: dec("150000"),
    }];
    let mut setup = setup_42();
    setup.balance_confirmations = vec![BalanceConfirmation {
        metric: MetricId::Debt,
        confirmed_on: "2026-09-30".into(),
    }];
    setup.debt_classes = vec![DebtClassification {
        source: SourceRef::Account { id: 2 },
        class: DebtClass::Mortgage,
    }];
    let c = card(&build_report(bundled(), &setup, &snap), MetricId::Debt).clone();
    assert_eq!(c.result.status, CardStatus::Comparable);
    assert_eq!(c.result.reference.as_ref().unwrap().reference.definition_id, "sipp_total_debt_median");
    assert_eq!(c.secondary.len(), 1);
    assert_eq!(c.secondary[0].definition_id, "sipp_home_debt_median");
    assert_eq!(c.secondary[0].result.local_value, Some(dec("150000")));
}

#[test]
fn investments_compare_retirement_first_and_taxable_separately() {
    let mut snap = empty_snapshot();
    snap.accounts = vec![
        AccountSnap {
            id: 10,
            name: "401k".into(),
            kind: AccountType::Investment,
            starting_balance: dec("0"),
            balance: dec("80000"),
        },
        AccountSnap {
            id: 11,
            name: "Brokerage".into(),
            kind: AccountType::Investment,
            starting_balance: dec("0"),
            balance: dec("20000"),
        },
    ];
    let mut setup = setup_42();
    setup.balance_confirmations = vec![BalanceConfirmation {
        metric: MetricId::Investments,
        confirmed_on: "2026-09-30".into(),
    }];
    setup.investment_classes = vec![
        InvestmentClassification {
            source: SourceRef::Account { id: 10 },
            class: InvestmentClass::Retirement,
        },
        InvestmentClassification {
            source: SourceRef::Account { id: 11 },
            class: InvestmentClass::Taxable,
        },
    ];
    let c = card(&build_report(bundled(), &setup, &snap), MetricId::Investments).clone();
    assert_eq!(c.result.local_value, Some(dec("80000")));
    assert_eq!(
        c.result.reference.as_ref().unwrap().reference.definition_id,
        "sipp_retirement_accounts_median"
    );
    assert_eq!(c.secondary[0].definition_id, "sipp_stocks_mutual_funds_median");
    assert_eq!(c.secondary[0].result.local_value, Some(dec("20000")));
}

#[test]
fn an_unconfirmed_balance_is_incomplete_rather_than_compared() {
    let mut snap = empty_snapshot();
    snap.accounts = vec![AccountSnap {
        id: 1,
        name: "Checking".into(),
        kind: AccountType::Checking,
        starting_balance: dec("0"),
        balance: dec("5000"),
    }];
    let c = card(&build_report(bundled(), &setup_42(), &snap), MetricId::Savings).clone();
    assert_eq!(c.result.status, CardStatus::Incomplete);
    assert_eq!(c.result.completeness, Completeness::Unknown);
    assert_eq!(c.metric.value, Some(dec("5000")), "the tracked figure is still shown");
    assert!(
        !c.visible,
        "a figure that was simply never confirmed is waiting on the person, like any missing input"
    );
}

#[test]
fn unclassified_investments_are_hidden_until_the_person_confirms_them() {
    let mut snap = empty_snapshot();
    snap.accounts = vec![AccountSnap {
        id: 10,
        name: "401k".into(),
        kind: AccountType::Investment,
        starting_balance: dec("0"),
        balance: dec("80000"),
    }];
    let c = card(&build_report(bundled(), &setup_42(), &snap), MetricId::Investments).clone();
    assert!(!c.visible, "nothing has been classified or confirmed yet");
    let mut confirmed = setup_42();
    confirmed.balance_confirmations = vec![BalanceConfirmation {
        metric: MetricId::Investments,
        confirmed_on: "2026-09-30".into(),
    }];
    let c = card(&build_report(bundled(), &confirmed, &snap), MetricId::Investments).clone();
    assert!(c.visible, "confirmed but still unclassified: show it so the person can finish");
}

#[test]
fn a_partly_assigned_balance_stays_visible_so_the_person_can_finish_it() {
    let mut snap = empty_snapshot();
    snap.accounts = vec![AccountSnap {
        id: 1,
        name: "Joint".into(),
        kind: AccountType::Checking,
        starting_balance: dec("0"),
        balance: dec("1000"),
    }];
    let mut setup = setup_42();
    setup.balance_confirmations = vec![BalanceConfirmation {
        metric: MetricId::Savings,
        confirmed_on: "2026-09-30".into(),
    }];
    setup.allocations = vec![Allocation {
        source: SourceRef::Account { id: 1 },
        person: PersonRef::Owner,
        basis_points: 6000,
    }];
    let c = card(&build_report(bundled(), &setup, &snap), MetricId::Savings).clone();
    assert_eq!(
        (c.result.status, c.result.completeness, c.visible),
        (CardStatus::Incomplete, Completeness::Partial, true)
    );
}

#[test]
fn the_remembered_population_preference_is_offered_and_applied() {
    // A synthetic package with both populations for savings.
    let mut all = reference(
        "all",
        "savings",
        "household",
        "sipp_financial_institution_assets_median",
        40,
        Some(49),
        "100",
    );
    all["unit"] = json!("usd_balance");
    let mut holders = reference(
        "holders",
        "savings",
        "household",
        "sipp_financial_institution_assets_median",
        40,
        Some(49),
        "300",
    );
    holders["unit"] = json!("usd_balance");
    holders["universe"] = json!("holders");
    let pkg = package_with(vec![all, holders]);
    let mut snap = empty_snapshot();
    snap.accounts = vec![AccountSnap {
        id: 1,
        name: "Checking".into(),
        kind: AccountType::Checking,
        starting_balance: dec("0"),
        balance: dec("200"),
    }];
    let mut setup = setup_42();
    setup.balance_confirmations = vec![BalanceConfirmation {
        metric: MetricId::Savings,
        confirmed_on: "2026-09-30".into(),
    }];
    let c = card(&build_report(&pkg, &setup, &snap), MetricId::Savings).clone();
    assert_eq!(c.universe_options, vec![Universe::All, Universe::Holders]);
    assert_eq!(c.result.reference.as_ref().unwrap().reference.id, "all");
    setup.universe_preferences = vec![UniversePreference {
        metric: MetricId::Savings,
        universe: Universe::Holders,
    }];
    let c = card(&build_report(&pkg, &setup, &snap), MetricId::Savings).clone();
    assert_eq!(c.result.reference.unwrap().reference.id, "holders");
}

#[test]
fn a_definition_dropped_from_a_newer_package_stays_visible_as_removed() {
    // The package still covers income but no longer has the savings definition, and records no gap for it.
    let pkg = package_with(vec![reference(
        "h",
        "income",
        "household",
        "cps_hinc02_money_income_median",
        40,
        Some(49),
        "100",
    )]);
    let mut snap = empty_snapshot();
    snap.accounts = vec![AccountSnap {
        id: 1,
        name: "Checking".into(),
        kind: AccountType::Checking,
        starting_balance: dec("0"),
        balance: dec("5"),
    }];
    let c = card(&build_report(&pkg, &setup_42(), &snap), MetricId::Savings).clone();
    assert_eq!((c.result.status, c.visible), (CardStatus::Unavailable, true));
    assert!(c.result.reasons.contains(&Reason::BenchmarkRemoved));
}

#[test]
fn a_stale_manual_total_is_flagged_on_the_card_but_still_used() {
    let mut setup = setup_42();
    let mut a = amount("150000");
    a.measured_on = "2024-01-01".into();
    setup.income.household_total = Some(a);
    let c = card(&build_report(bundled(), &setup, &empty_snapshot()), MetricId::Income).clone();
    assert_eq!(c.result.status, CardStatus::Comparable);
    assert!(c.stale);
}

#[test]
fn the_report_serialises_for_the_frontend_with_money_as_strings() {
    let mut setup = setup_42();
    setup.income.household_total = Some(amount("100000"));
    let value = serde_json::to_value(build_report(bundled(), &setup, &empty_snapshot())).unwrap();
    let income = &value["cards"][2];
    assert_eq!(income["result"]["metric"], json!("income"));
    assert_eq!(income["result"]["localValue"], json!("100000"));
    assert!(income["result"]["reference"]["adjustedValue"].is_string());
    assert_eq!(income["visible"], json!(true));
    assert!(income["metric"]["contributors"].is_array());
    let debt = serde_json::to_value(build_report(bundled(), &debt_setup(), &debt_snapshot())).unwrap();
    assert_eq!(
        debt["cards"][4]["metric"]["classTotals"]["mortgage"],
        json!("150000"),
        "class totals are decimal strings too"
    );
}

fn debt_snapshot() -> Snapshot {
    let mut snap = empty_snapshot();
    snap.accounts = vec![AccountSnap {
        id: 2,
        name: "Home loan".into(),
        kind: AccountType::Loan,
        starting_balance: dec("0"),
        balance: dec("150000"),
    }];
    snap
}

fn debt_setup() -> ComparisonSetup {
    let mut setup = setup_42();
    setup.debt_classes = vec![DebtClassification {
        source: SourceRef::Account { id: 2 },
        class: DebtClass::Mortgage,
    }];
    setup
}

const PERSONAL: &str = "cps_pinc01_money_income_median";

fn by_person(setup: &mut ComparisonSetup, incomes: &[(PersonRef, &str)]) {
    setup.income.household_method = HouseholdIncomeMethod::ByPerson;
    setup.income.per_person = incomes
        .iter()
        .map(|(p, v)| PersonIncome {
            person: p.clone(),
            gross_annual: amount(v),
        })
        .collect();
}

fn personal_lines(report: &ComparisonsReport) -> Vec<&SecondaryCard> {
    card(report, MetricId::Income)
        .secondary
        .iter()
        .filter(|s| s.definition_id == PERSONAL)
        .collect()
}

#[test]
fn each_household_member_with_an_income_and_an_age_gets_a_personal_line() {
    let mut setup = setup_42();
    age(&mut setup, person(7), AgeInput::Exact { age: 31 });
    by_person(&mut setup, &[(PersonRef::Owner, "78000"), (person(7), "64000")]);
    let report = build_report(bundled(), &setup, &empty_snapshot());
    let lines = personal_lines(&report);
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].person, Some(PersonRef::Owner));
    let owner = lines[0].result.reference.as_ref().unwrap();
    assert_eq!((owner.reference.age_min, owner.reference.age_max), (40, Some(44)));
    assert_eq!(lines[0].result.local_value, Some(dec("78000")));
    assert_eq!(lines[0].result.status, CardStatus::Comparable);
    assert_eq!(lines[1].person, Some(person(7)));
    assert_eq!(lines[1].result.reference.as_ref().unwrap().reference.id, format!("{PERSONAL}:30-34"));
    assert!(!card(&report, MetricId::Income).personal_income_hint);
}

#[test]
fn a_member_without_an_age_or_an_income_gets_no_line_and_a_roommate_never_does() {
    let mut setup = setup_42();
    age(&mut setup, person(8), AgeInput::Exact { age: 29 });
    // 7 shares the finances but has no age; 8 is a roommate with an age and an old income entry.
    by_person(&mut setup, &[(PersonRef::Owner, "78000"), (person(7), "64000"), (person(8), "40000")]);
    let report = build_report(bundled(), &setup, &empty_snapshot());
    let people: Vec<_> = personal_lines(&report).iter().map(|s| s.person.clone()).collect();
    assert_eq!(people, vec![Some(PersonRef::Owner)]);
}

#[test]
fn an_age_range_spanning_two_personal_age_groups_asks_for_an_exact_age_instead_of_guessing() {
    let mut setup = setup_42();
    age(&mut setup, PersonRef::Owner, AgeInput::Band { min: 40, max: Some(49) });
    by_person(&mut setup, &[(PersonRef::Owner, "78000")]);
    let report = build_report(bundled(), &setup, &empty_snapshot());
    let line = personal_lines(&report)[0];
    assert_eq!(line.result.status, CardStatus::CohortChoiceRequired);
    assert!(line.result.dollar_difference.is_none());
}

#[test]
fn a_zero_or_negative_personal_income_is_not_compared_with_people_who_have_income() {
    let mut setup = setup_42();
    by_person(&mut setup, &[(PersonRef::Owner, "-500")]);
    let report = build_report(bundled(), &setup, &empty_snapshot());
    let line = personal_lines(&report)[0];
    assert_eq!(line.result.status, CardStatus::NotComparable);
    assert!(line.result.percent_difference.is_none());
}

#[test]
fn a_household_total_shows_the_hint_and_no_personal_lines_even_with_old_per_person_entries() {
    let mut setup = setup_42();
    by_person(&mut setup, &[(PersonRef::Owner, "78000")]);
    setup.income.household_method = HouseholdIncomeMethod::Total;
    setup.income.household_total = Some(amount("120000"));
    let report = build_report(bundled(), &setup, &empty_snapshot());
    assert!(personal_lines(&report).is_empty());
    assert!(card(&report, MetricId::Income).personal_income_hint);
    assert!(
        !card(&report, MetricId::Savings).personal_income_hint,
        "the hint belongs to the Income card only"
    );
}

#[test]
fn the_per_person_hint_needs_someone_listed() {
    let mut setup = ComparisonSetup::empty();
    setup.income.household_total = Some(amount("120000"));
    let report = build_report(bundled(), &setup, &empty_snapshot());
    assert!(!card(&report, MetricId::Income).personal_income_hint);
}

#[test]
fn personal_lines_follow_the_households_population_choice_for_income() {
    let mut all = reference("p-all:40-44", "income", "individual", PERSONAL, 40, Some(44), "50000");
    let mut holders = reference("p-holders:40-44", "income", "individual", PERSONAL, 40, Some(44), "60000");
    all["universe"] = json!("all");
    holders["universe"] = json!("holders");
    let pkg = package_with(vec![all, holders]);
    let mut setup = setup_42();
    by_person(&mut setup, &[(PersonRef::Owner, "78000")]);
    let line = |setup: &ComparisonSetup| {
        let report = build_report(&pkg, setup, &empty_snapshot());
        personal_lines(&report)[0].result.reference.as_ref().unwrap().reference.id.clone()
    };
    assert_eq!(line(&setup), "p-all:40-44");
    setup.universe_preferences = vec![UniversePreference {
        metric: MetricId::Income,
        universe: Universe::Holders,
    }];
    assert_eq!(line(&setup), "p-holders:40-44");
}

#[test]
fn the_income_card_stays_reachable_while_its_personal_lines_compare() {
    let mut setup = setup_42();
    // The household's age person (7) has no age, so the household comparison waits on it...
    setup.household_reference_person = Some(person(7));
    by_person(&mut setup, &[(PersonRef::Owner, "78000"), (person(7), "64000")]);
    let report = build_report(bundled(), &setup, &empty_snapshot());
    let income = card(&report, MetricId::Income);
    assert_eq!(income.result.status, CardStatus::MissingInput);
    // ...but Me's own line can already be compared, so the card is shown to reach it.
    assert_eq!(personal_lines(&report).len(), 1);
    assert!(income.visible);
}

#[test]
fn an_income_card_with_nothing_to_compare_stays_hidden() {
    let mut setup = setup_42();
    setup.household_reference_person = Some(person(7));
    setup.income.household_total = Some(amount("120000"));
    assert!(!card(&build_report(bundled(), &setup, &empty_snapshot()), MetricId::Income).visible);
}
