use super::common::*;
use budget_core::comparisons::package::Package;
use budget_core::comparisons::setup::*;
use budget_core::comparisons::types::{AgeInput, MetricId, Universe};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde_json::json;
use std::collections::HashSet;
use std::str::FromStr;

pub fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 9, 30).unwrap()
}

pub fn amount(value: &str) -> ManualAmount {
    ManualAmount {
        value: Decimal::from_str(value).unwrap(),
        measured_on: "2026-09-01".into(),
        explanation: "From my pay stubs".into(),
    }
}

pub fn person(id: i64) -> PersonRef {
    PersonRef::Member { id }
}

/// Owner plus members 7 (partner, in the household) and 8 (roommate, not in it).
pub fn base_setup() -> ComparisonSetup {
    let mut s = ComparisonSetup::empty();
    s.people = vec![
        PersonSetup {
            person: PersonRef::Owner,
            age: Some(AgeConfirmation {
                age: AgeInput::Exact { age: 42 },
                confirmed_on: "2026-09-01".into(),
            }),
            in_household: true,
        },
        PersonSetup {
            person: person(7),
            age: None,
            in_household: true,
        },
        PersonSetup {
            person: person(8),
            age: None,
            in_household: false,
        },
    ];
    s.household_reference_person = Some(PersonRef::Owner);
    s
}

struct Fixture {
    package: Package,
    members: HashSet<i64>,
    accounts: HashSet<i64>,
    assets: HashSet<i64>,
}

impl Fixture {
    fn new() -> Self {
        let package = package_with(vec![
            reference("h25", "income", "household", "d", 25, Some(34), "100"),
            reference("i25", "income", "individual", "d", 25, Some(34), "90"),
        ]);
        Fixture {
            package,
            members: [7, 8].into(),
            accounts: [1, 2].into(),
            assets: [5].into(),
        }
    }

    fn ctx(&self) -> SetupContext<'_> {
        SetupContext {
            package: Some(&self.package),
            today: today(),
            member_ids: &self.members,
            account_ids: &self.accounts,
            asset_ids: &self.assets,
        }
    }

    fn problems(&self, setup: &ComparisonSetup) -> Vec<String> {
        validate_setup(setup, &self.ctx())
            .into_iter()
            .map(|p| format!("{}: {}", p.field, p.message))
            .collect()
    }

    fn assert_rejected(&self, setup: &ComparisonSetup, field: &str) {
        let problems = validate_setup(setup, &self.ctx());
        assert!(
            problems.iter().any(|p| p.field.starts_with(field)),
            "expected a problem on {field}, got {problems:?}"
        );
    }
}

#[test]
fn empty_and_base_setups_are_valid() {
    let f = Fixture::new();
    assert!(f.problems(&ComparisonSetup::empty()).is_empty());
    assert_eq!(f.problems(&base_setup()), Vec::<String>::new());
}

#[test]
fn an_unsupported_format_version_is_rejected() {
    let mut s = base_setup();
    s.format_version = 99;
    Fixture::new().assert_rejected(&s, "formatVersion");
}

#[test]
fn exact_ages_and_bands_are_both_accepted_within_the_adult_range() {
    let f = Fixture::new();
    for age in [
        AgeInput::Exact { age: 18 },
        AgeInput::Exact { age: 120 },
        AgeInput::Band { min: 25, max: Some(34) },
        AgeInput::Band { min: 65, max: None },
    ] {
        let mut s = base_setup();
        s.people[0].age = Some(AgeConfirmation {
            age,
            confirmed_on: "2026-09-01".into(),
        });
        assert!(f.problems(&s).is_empty(), "{age:?}");
    }
}

#[test]
fn out_of_range_or_reversed_ages_are_rejected() {
    let f = Fixture::new();
    for age in [
        AgeInput::Exact { age: 17 },
        AgeInput::Exact { age: 121 },
        AgeInput::Band { min: 40, max: Some(30) },
        AgeInput::Band { min: 10, max: Some(30) },
    ] {
        let mut s = base_setup();
        s.people[0].age = Some(AgeConfirmation {
            age,
            confirmed_on: "2026-09-01".into(),
        });
        f.assert_rejected(&s, "people[0].age");
    }
}

#[test]
fn an_age_confirmed_in_the_future_or_with_a_bad_date_is_rejected() {
    let f = Fixture::new();
    for date in ["2026-10-01", "not a date", "2026-13-01", ""] {
        let mut s = base_setup();
        s.people[0].age = Some(AgeConfirmation {
            age: AgeInput::Exact { age: 42 },
            confirmed_on: date.into(),
        });
        f.assert_rejected(&s, "people[0].age");
    }
}

#[test]
fn people_must_be_unique_and_real() {
    let f = Fixture::new();
    let mut dup = base_setup();
    dup.people.push(PersonSetup {
        person: PersonRef::Owner,
        age: None,
        in_household: true,
    });
    f.assert_rejected(&dup, "people");
    let mut ghost = base_setup();
    ghost.people.push(PersonSetup {
        person: person(99),
        age: None,
        in_household: true,
    });
    f.assert_rejected(&ghost, "people[3].person");
}

#[test]
fn the_household_reference_person_must_be_in_the_household() {
    let f = Fixture::new();
    let mut roommate = base_setup();
    roommate.household_reference_person = Some(person(8));
    f.assert_rejected(&roommate, "householdReferencePerson");
    let mut stranger = base_setup();
    stranger.household_reference_person = Some(person(99));
    f.assert_rejected(&stranger, "householdReferencePerson");
    let mut partner = base_setup();
    partner.household_reference_person = Some(person(7));
    assert!(f.problems(&partner).is_empty());
}

#[test]
fn income_may_be_negative_but_needs_a_dated_amount_with_an_optional_note() {
    let f = Fixture::new();
    let mut s = base_setup();
    s.income.household_total = Some(amount("-1250.50"));
    assert!(f.problems(&s).is_empty(), "money income can legitimately be negative");

    for blank_note in ["", "   "] {
        let mut blank = base_setup();
        let mut a = amount("50000");
        a.explanation = blank_note.into();
        blank.income.household_total = Some(a);
        assert!(f.problems(&blank).is_empty(), "the note is optional: {blank_note:?}");
    }

    let mut future = base_setup();
    let mut a = amount("50000");
    a.measured_on = "2026-12-01".into();
    future.income.household_total = Some(a);
    f.assert_rejected(&future, "income.householdTotal");

    let mut long = base_setup();
    let mut a = amount("50000");
    a.explanation = "x".repeat(MAX_EXPLANATION_CHARS + 1);
    long.income.household_total = Some(a);
    f.assert_rejected(&long, "income.householdTotal");
}

#[test]
fn inactive_per_person_income_is_kept_alongside_the_household_total() {
    let f = Fixture::new();
    let mut s = base_setup();
    s.income.household_method = HouseholdIncomeMethod::Total;
    s.income.household_total = Some(amount("120000"));
    s.income.per_person = vec![
        PersonIncome {
            person: PersonRef::Owner,
            gross_annual: amount("70000"),
        },
        PersonIncome {
            person: person(7),
            gross_annual: amount("50000"),
        },
    ];
    assert!(f.problems(&s).is_empty());
}

#[test]
fn per_person_income_needs_a_listed_unique_person() {
    let f = Fixture::new();
    let mut s = base_setup();
    s.income.per_person = vec![PersonIncome {
        person: person(99),
        gross_annual: amount("1"),
    }];
    f.assert_rejected(&s, "income.perPerson[0].person");
    let mut dup = base_setup();
    dup.income.per_person = vec![
        PersonIncome {
            person: PersonRef::Owner,
            gross_annual: amount("1"),
        },
        PersonIncome {
            person: PersonRef::Owner,
            gross_annual: amount("2"),
        },
    ];
    f.assert_rejected(&dup, "income.perPerson");
}

#[test]
fn spending_rules() {
    let f = Fixture::new();
    let mut ok = base_setup();
    ok.spending.period = Some(SpendingPeriod {
        from: "2025-09-01".into(),
        to: "2026-08-31".into(),
    });
    ok.spending.account_ids = vec![1, 2];
    ok.spending.manual_annual = Some(amount("48000"));
    ok.spending.category_mappings = vec![CategoryMapping {
        category: "Groceries".into(),
        component: "food".into(),
    }];
    assert!(f.problems(&ok).is_empty());

    let mut reversed = ok.clone();
    reversed.spending.period = Some(SpendingPeriod {
        from: "2026-08-31".into(),
        to: "2025-09-01".into(),
    });
    f.assert_rejected(&reversed, "spending.period");
    let mut future = ok.clone();
    future.spending.period = Some(SpendingPeriod {
        from: "2026-01-01".into(),
        to: "2026-12-31".into(),
    });
    f.assert_rejected(&future, "spending.period");
    let mut negative = ok.clone();
    negative.spending.manual_annual = Some(amount("-1"));
    f.assert_rejected(&negative, "spending.manualAnnual");
    let mut ghost = ok.clone();
    ghost.spending.account_ids = vec![1, 404];
    f.assert_rejected(&ghost, "spending.accountIds");
    let mut dup = ok.clone();
    dup.spending.category_mappings.push(CategoryMapping {
        category: "groceries".into(),
        component: "other".into(),
    });
    f.assert_rejected(&dup, "spending.categoryMappings");
}

fn alloc(source: SourceRef, who: PersonRef, bp: u32) -> Allocation {
    Allocation {
        source,
        person: who,
        basis_points: bp,
    }
}

#[test]
fn allocations_may_total_up_to_ten_thousand_basis_points_but_not_more() {
    let f = Fixture::new();
    let acct = SourceRef::Account { id: 1 };
    let mut exact = base_setup();
    exact.allocations = vec![alloc(acct.clone(), PersonRef::Owner, 6000), alloc(acct.clone(), person(7), 4000)];
    assert!(f.problems(&exact).is_empty());
    let mut under = base_setup();
    under.allocations = vec![alloc(acct.clone(), PersonRef::Owner, 6000)];
    assert!(f.problems(&under).is_empty(), "the remainder is reported as unallocated, not rejected");
    let mut over = base_setup();
    over.allocations = vec![alloc(acct.clone(), PersonRef::Owner, 6000), alloc(acct, person(7), 4001)];
    f.assert_rejected(&over, "allocations");
}

#[test]
fn allocation_entries_must_be_positive_unique_and_point_at_real_things() {
    let f = Fixture::new();
    let acct = SourceRef::Account { id: 1 };
    let mut zero = base_setup();
    zero.allocations = vec![alloc(acct.clone(), PersonRef::Owner, 0)];
    f.assert_rejected(&zero, "allocations[0]");
    let mut dup = base_setup();
    dup.allocations = vec![alloc(acct.clone(), PersonRef::Owner, 100), alloc(acct.clone(), PersonRef::Owner, 200)];
    f.assert_rejected(&dup, "allocations");
    let mut ghost_source = base_setup();
    ghost_source.allocations = vec![alloc(SourceRef::Account { id: 404 }, PersonRef::Owner, 100)];
    f.assert_rejected(&ghost_source, "allocations[0].source");
    let mut ghost_person = base_setup();
    ghost_person.allocations = vec![alloc(acct, person(99), 100)];
    f.assert_rejected(&ghost_person, "allocations[0].person");
}

#[test]
fn an_account_and_an_asset_with_the_same_number_do_not_collide() {
    let f = Fixture::new();
    let mut s = base_setup();
    s.allocations = vec![
        alloc(SourceRef::Account { id: 1 }, PersonRef::Owner, 10000),
        alloc(SourceRef::Asset { id: 5 }, PersonRef::Owner, 10000),
    ];
    assert!(f.problems(&s).is_empty());
    let mut asset_as_account = base_setup();
    asset_as_account.allocations = vec![alloc(SourceRef::Account { id: 5 }, PersonRef::Owner, 100)];
    f.assert_rejected(&asset_as_account, "allocations[0].source");
}

#[test]
fn debt_classification_and_exclusions_apply_to_accounts_only() {
    let f = Fixture::new();
    let mut s = base_setup();
    s.debt_classes = vec![DebtClassification {
        source: SourceRef::Account { id: 1 },
        class: DebtClass::Mortgage,
    }];
    s.debt_exclusions = vec![SourceRef::Account { id: 2 }];
    assert!(f.problems(&s).is_empty());
    let mut asset = base_setup();
    asset.debt_classes = vec![DebtClassification {
        source: SourceRef::Asset { id: 5 },
        class: DebtClass::Other,
    }];
    f.assert_rejected(&asset, "debtClasses[0].source");
    let mut ghost = base_setup();
    ghost.debt_exclusions = vec![SourceRef::Account { id: 404 }];
    f.assert_rejected(&ghost, "debtExclusions[0]");
    let mut dup = base_setup();
    dup.debt_classes = vec![
        DebtClassification {
            source: SourceRef::Account { id: 1 },
            class: DebtClass::Mortgage,
        },
        DebtClassification {
            source: SourceRef::Account { id: 1 },
            class: DebtClass::CreditCard,
        },
    ];
    f.assert_rejected(&dup, "debtClasses");
}

#[test]
fn investment_classes_cover_accounts_and_assets_once_each() {
    let f = Fixture::new();
    let mut s = base_setup();
    s.investment_classes = vec![
        InvestmentClassification {
            source: SourceRef::Account { id: 1 },
            class: InvestmentClass::Retirement,
        },
        InvestmentClassification {
            source: SourceRef::Asset { id: 5 },
            class: InvestmentClass::Exclude,
        },
    ];
    assert!(f.problems(&s).is_empty());
    s.investment_classes.push(InvestmentClassification {
        source: SourceRef::Account { id: 1 },
        class: InvestmentClass::Taxable,
    });
    f.assert_rejected(&s, "investmentClasses");
}

#[test]
fn savings_overrides_reference_real_unique_accounts() {
    let f = Fixture::new();
    let mut s = base_setup();
    s.savings_overrides = vec![SavingsOverride {
        source: SourceRef::Account { id: 1 },
        include: true,
    }];
    assert!(f.problems(&s).is_empty());
    s.savings_overrides.push(SavingsOverride {
        source: SourceRef::Account { id: 1 },
        include: false,
    });
    f.assert_rejected(&s, "savingsOverrides");
}

#[test]
fn cohort_choices_must_name_a_published_household_cohort_for_that_metric() {
    let f = Fixture::new();
    let choice = |metric, id: &str| CohortChoice {
        metric,
        reference_id: id.into(),
    };
    let mut ok = base_setup();
    ok.cohort_choices = vec![choice(MetricId::Income, "h25")];
    assert!(f.problems(&ok).is_empty());
    for bad in [
        choice(MetricId::Income, "gone"),
        choice(MetricId::Income, "i25"),
        choice(MetricId::Debt, "h25"),
    ] {
        let mut s = base_setup();
        s.cohort_choices = vec![bad];
        f.assert_rejected(&s, "cohortChoices[0]");
    }
    let mut dup = base_setup();
    dup.cohort_choices = vec![choice(MetricId::Income, "h25"), choice(MetricId::Income, "h25")];
    f.assert_rejected(&dup, "cohortChoices");
}

#[test]
fn universe_preferences_are_unique_per_metric() {
    let f = Fixture::new();
    let mut s = base_setup();
    s.universe_preferences = vec![UniversePreference {
        metric: MetricId::Savings,
        universe: Universe::Holders,
    }];
    assert!(f.problems(&s).is_empty());
    s.universe_preferences.push(UniversePreference {
        metric: MetricId::Savings,
        universe: Universe::All,
    });
    f.assert_rejected(&s, "universePreferences");
}

#[test]
fn manual_overrides_follow_each_metrics_sign_rules_and_are_unique() {
    let f = Fixture::new();
    let ov = |metric, v: &str| ManualOverride { metric, amount: amount(v) };
    let mut ok = base_setup();
    ok.manual_overrides = vec![ov(MetricId::Income, "-500"), ov(MetricId::Savings, "-20"), ov(MetricId::Debt, "0")];
    assert!(f.problems(&ok).is_empty());
    for metric in [MetricId::Debt, MetricId::Investments, MetricId::Spending] {
        let mut s = base_setup();
        s.manual_overrides = vec![ov(metric, "-1")];
        f.assert_rejected(&s, "manualOverrides[0]");
    }
    let mut dup = base_setup();
    dup.manual_overrides = vec![ov(MetricId::Debt, "1"), ov(MetricId::Debt, "2")];
    f.assert_rejected(&dup, "manualOverrides");
}

#[test]
fn balance_confirmations_are_dated_and_unique_per_metric() {
    let f = Fixture::new();
    let mut s = base_setup();
    s.balance_confirmations = vec![BalanceConfirmation {
        metric: MetricId::Savings,
        confirmed_on: "2026-09-30".into(),
    }];
    assert!(f.problems(&s).is_empty());
    s.balance_confirmations.push(BalanceConfirmation {
        metric: MetricId::Savings,
        confirmed_on: "2026-09-29".into(),
    });
    f.assert_rejected(&s, "balanceConfirmations");
    let mut future = base_setup();
    future.balance_confirmations = vec![BalanceConfirmation {
        metric: MetricId::Debt,
        confirmed_on: "2027-01-01".into(),
    }];
    f.assert_rejected(&future, "balanceConfirmations[0]");
}

#[test]
fn a_missing_benchmark_package_only_blocks_cohort_choices() {
    let f = Fixture::new();
    let ctx = SetupContext { package: None, ..f.ctx() };
    assert!(validate_setup(&base_setup(), &ctx).is_empty());
    let mut s = base_setup();
    s.cohort_choices = vec![CohortChoice {
        metric: MetricId::Income,
        reference_id: "h25".into(),
    }];
    assert!(!validate_setup(&s, &ctx).is_empty());
}

#[test]
fn many_problems_are_all_reported_together() {
    let f = Fixture::new();
    let mut s = base_setup();
    s.people[0].age = Some(AgeConfirmation {
        age: AgeInput::Exact { age: 5 },
        confirmed_on: "2026-09-01".into(),
    });
    s.spending.account_ids = vec![404];
    s.allocations = vec![alloc(SourceRef::Account { id: 404 }, PersonRef::Owner, 100)];
    assert!(validate_setup(&s, &f.ctx()).len() >= 3);
}

#[test]
fn repairs_report_deleted_people_and_sources_without_changing_the_setup() {
    let mut f = Fixture::new();
    let mut s = base_setup();
    s.income.per_person = vec![PersonIncome {
        person: person(7),
        gross_annual: amount("1000"),
    }];
    s.allocations = vec![
        alloc(SourceRef::Account { id: 1 }, person(7), 5000),
        alloc(SourceRef::Asset { id: 5 }, PersonRef::Owner, 5000),
    ];
    s.spending.account_ids = vec![2];
    s.debt_exclusions = vec![SourceRef::Account { id: 1 }];
    assert!(find_repairs(&s, &f.ctx()).is_empty());

    f.members.remove(&7);
    f.accounts.remove(&1);
    f.assets.remove(&5);
    let before = s.clone();
    let repairs = find_repairs(&s, &f.ctx());
    assert_eq!(s, before);
    assert!(repairs.contains(&Repair::MissingPerson {
        field: "people[1].person".into(),
        person: person(7)
    }));
    assert!(repairs.contains(&Repair::MissingPerson {
        field: "income.perPerson[0].person".into(),
        person: person(7)
    }));
    assert!(repairs.contains(&Repair::MissingSource {
        field: "allocations[0].source".into(),
        source: SourceRef::Account { id: 1 }
    }));
    assert!(repairs.contains(&Repair::MissingSource {
        field: "allocations[1].source".into(),
        source: SourceRef::Asset { id: 5 }
    }));
    assert!(repairs.contains(&Repair::MissingSource {
        field: "debtExclusions[0]".into(),
        source: SourceRef::Account { id: 1 }
    }));
    assert!(
        !repairs
            .iter()
            .any(|r| matches!(r, Repair::MissingSource { field, .. } if field.starts_with("spending"))),
        "account 2 still exists"
    );
}

#[test]
fn a_stored_setup_with_a_deleted_reference_is_not_silently_valid() {
    let mut f = Fixture::new();
    let s = base_setup();
    f.members.remove(&7);
    assert!(
        !validate_setup(&s, &f.ctx()).is_empty(),
        "no resurrection of deleted members through a stale save"
    );
}

#[test]
fn setup_json_is_strict() {
    let good = serde_json::to_value(base_setup()).unwrap();
    assert!(serde_json::from_value::<ComparisonSetup>(good.clone()).is_ok());
    let mut extra = good.clone();
    extra["surprise"] = json!(1);
    assert!(serde_json::from_value::<ComparisonSetup>(extra).is_err(), "unknown fields are refused");
    let mut float_money = serde_json::to_value({
        let mut s = base_setup();
        s.income.household_total = Some(amount("1"));
        s
    })
    .unwrap();
    float_money["income"]["householdTotal"]["value"] = json!(1.5);
    assert!(
        serde_json::from_value::<ComparisonSetup>(float_money).is_err(),
        "money must be a decimal string"
    );
    let mut bad_enum = good;
    bad_enum["mode"] = json!("galactic");
    assert!(serde_json::from_value::<ComparisonSetup>(bad_enum).is_err());
}
