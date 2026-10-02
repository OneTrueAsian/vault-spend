use super::common::*;
use budget_core::comparisons::engine::{CardQuery, LocalMeasure, compare, convert_unit, dollar_difference, monthly_equivalent, percent_difference};
use budget_core::comparisons::package::Package;
use budget_core::comparisons::types::{AgeInput, CardStatus, ComparisonMode, Completeness, MetricId, Reason, Unit, Universe};
use rust_decimal::Decimal;
use serde_json::{Value, json};
use std::str::FromStr;

fn dec(s: &str) -> Decimal {
    Decimal::from_str(s).unwrap()
}

fn income(id: &str, mode: &str, lo: u32, hi: Option<u32>, value: &str) -> Value {
    reference(id, "income", mode, "income_median", lo, hi, value)
}

fn local(value: &str) -> LocalMeasure {
    LocalMeasure {
        value: Some(dec(value)),
        unit: Unit::UsdPerYear,
        holds_item: true,
        completeness: Completeness::Confirmed,
    }
}

fn query<'a>(mode: ComparisonMode, age: u32, value: &str) -> CardQuery<'a> {
    CardQuery {
        metric: MetricId::Income,
        mode,
        definition_id: Some("income_median"),
        age: Some(AgeInput::Exact { age }),
        selected_cohort: None,
        universe_preference: None,
        local: local(value),
    }
}

fn household_pkg() -> Package {
    package_with(vec![
        income("h25", "household", 25, Some(34), "100"),
        income("h35", "household", 35, Some(44), "200"),
    ])
}

// ---- pure arithmetic -------------------------------------------------------------------------

#[test]
fn golden_differences() {
    assert_eq!(dollar_difference(dec("120.00"), dec("100.00")), dec("20.00"));
    assert_eq!(percent_difference(dec("120.00"), dec("100.00")).as_deref(), Some("20"));
    assert_eq!(dollar_difference(dec("0.00"), dec("100.00")), dec("-100.00"));
    assert_eq!(percent_difference(dec("0.00"), dec("100.00")).as_deref(), Some("-100"));
}

#[test]
fn percent_is_absent_for_a_zero_or_negative_reference() {
    assert_eq!(percent_difference(dec("50"), dec("0")), None);
    assert_eq!(percent_difference(dec("50"), dec("-10")), None);
    assert_eq!(
        dollar_difference(dec("50"), dec("-10")),
        dec("60"),
        "the dollar difference is still valid"
    );
}

#[test]
fn percent_rounds_to_one_decimal_with_midpoints_away_from_zero() {
    assert_eq!(percent_difference(dec("112.55"), dec("100")).as_deref(), Some("12.6"));
    assert_eq!(percent_difference(dec("87.45"), dec("100")).as_deref(), Some("-12.6"));
    assert_eq!(percent_difference(dec("100.04"), dec("100")).as_deref(), Some("0"));
}

#[test]
fn annual_to_monthly_equivalent() {
    assert_eq!(monthly_equivalent(dec("60000.00")), dec("5000.00"));
    assert_eq!(monthly_equivalent(dec("100")), dec("8.33"));
}

#[test]
fn unit_conversion_only_between_flow_units() {
    assert_eq!(convert_unit(dec("5000"), Unit::UsdPerMonth, Unit::UsdPerYear), Some(dec("60000")));
    assert_eq!(convert_unit(dec("60000"), Unit::UsdPerYear, Unit::UsdPerMonth), Some(dec("5000")));
    assert_eq!(convert_unit(dec("10"), Unit::UsdBalance, Unit::UsdBalance), Some(dec("10")));
    assert_eq!(convert_unit(dec("10"), Unit::UsdBalance, Unit::UsdPerYear), None);
}

// ---- card results ----------------------------------------------------------------------------

#[test]
fn a_matching_cohort_gives_a_comparable_card_with_difference() {
    let pkg = household_pkg();
    // Reference 100 priced at 2025-12 (CPI 300), latest 2026-06 (CPI 330): factor 1.1, adjusted 110.
    let card = compare(&pkg, &query(ComparisonMode::Household, 30, "132"));
    assert_eq!(card.status, CardStatus::Comparable);
    let r = card.reference.as_ref().unwrap();
    assert_eq!(r.reference.id, "h25");
    assert_eq!(r.reference.value, dec("100"), "the original value is preserved");
    assert_eq!(r.adjusted_value, dec("110.00"));
    assert_eq!(r.adjusted_basis_month, "2026-06");
    assert_eq!(card.dollar_difference, Some(dec("22.00")));
    assert_eq!(card.percent_difference.as_deref(), Some("20"));
}

#[test]
fn inflation_adjustment_scales_the_uncertainty_too() {
    let card = compare(&household_pkg(), &query(ComparisonMode::Household, 30, "100"));
    let unc = card.reference.unwrap().adjusted_uncertainty.unwrap();
    assert_eq!(unc.value, dec("5.5"));
}

#[test]
fn a_reference_already_in_latest_dollars_is_not_adjusted() {
    let mut r = income("h25", "household", 25, Some(34), "100");
    r["dollarBasis"] = json!({"kind": "month", "period": "2026-06"});
    let card = compare(&package_with(vec![r]), &query(ComparisonMode::Household, 30, "150"));
    assert_eq!(card.reference.unwrap().adjusted_value, dec("100.00"));
    assert!(!card.reasons.iter().any(|r| matches!(r, Reason::InflationAdjusted { .. })));
}

#[test]
fn ages_either_side_of_a_cohort_boundary_pick_different_references() {
    let pkg = household_pkg();
    let at_34 = compare(&pkg, &query(ComparisonMode::Household, 34, "100"));
    let at_35 = compare(&pkg, &query(ComparisonMode::Household, 35, "100"));
    assert_eq!(at_34.reference.unwrap().reference.id, "h25");
    assert_eq!(at_35.reference.unwrap().reference.id, "h35");
}

#[test]
fn a_household_record_is_never_used_for_an_individual_query() {
    let pkg = household_pkg();
    let card = compare(&pkg, &query(ComparisonMode::Individual, 30, "100"));
    assert_eq!(card.status, CardStatus::Unavailable);
    assert!(card.reference.is_none() && card.dollar_difference.is_none());
}

#[test]
fn a_documented_source_gap_is_unavailable_not_missing_input() {
    let gap = json!({"gaps": [{"metric": "spending", "mode": "household", "reason": "no source"}]});
    let pkg = package_with_overrides(vec![income("h25", "household", 25, Some(34), "100")], gap, default_cpi());
    let mut q = query(ComparisonMode::Household, 30, "100");
    q.metric = MetricId::Spending;
    q.definition_id = None;
    let card = compare(&pkg, &q);
    assert_eq!(card.status, CardStatus::Unavailable);
    assert!(card.reasons.contains(&Reason::NoBenchmark));
}

#[test]
fn a_definition_missing_from_the_current_package_is_reported_as_removed() {
    let mut q = query(ComparisonMode::Household, 30, "100");
    q.definition_id = Some("retired_definition");
    let card = compare(&household_pkg(), &q);
    assert_eq!(card.status, CardStatus::Unavailable);
    assert!(card.reasons.contains(&Reason::BenchmarkRemoved));
}

#[test]
fn a_missing_age_is_missing_input_and_shows_no_reference() {
    let mut q = query(ComparisonMode::Household, 30, "100");
    q.age = None;
    let card = compare(&household_pkg(), &q);
    assert_eq!(card.status, CardStatus::MissingInput);
    assert!(card.reference.is_none());
}

#[test]
fn a_missing_local_value_is_missing_input_never_zero() {
    let mut q = query(ComparisonMode::Household, 30, "100");
    q.local.value = None;
    let card = compare(&household_pkg(), &q);
    assert_eq!(card.status, CardStatus::MissingInput);
    assert_eq!(card.local_value, None);
    assert_eq!(card.dollar_difference, None);
}

#[test]
fn unconfirmed_coverage_blocks_a_confident_comparison() {
    for completeness in [Completeness::Partial, Completeness::Unknown] {
        let mut q = query(ComparisonMode::Household, 30, "100");
        q.local.completeness = completeness;
        let card = compare(&household_pkg(), &q);
        assert_eq!(card.status, CardStatus::Incomplete);
        assert_eq!(card.local_value, Some(dec("100")), "the tracked value is still shown");
        assert!(card.dollar_difference.is_none());
    }
}

#[test]
fn an_unreliable_reference_is_not_compared() {
    let mut r = income("h25", "household", 25, Some(34), "100");
    r["reliability"] = json!("unreliable");
    let card = compare(&package_with(vec![r]), &query(ComparisonMode::Household, 30, "100"));
    assert_eq!(card.status, CardStatus::Unreliable);
    assert!(card.reasons.contains(&Reason::ReferenceTooUncertain));
    assert!(card.dollar_difference.is_none());
}

#[test]
fn a_band_spanning_cohorts_requires_a_choice_until_one_is_made() {
    let pkg = household_pkg();
    let mut q = query(ComparisonMode::Household, 30, "100");
    q.age = Some(AgeInput::Band { min: 30, max: Some(40) });
    let card = compare(&pkg, &q);
    assert_eq!(card.status, CardStatus::CohortChoiceRequired);
    assert!(card.reasons.contains(&Reason::CohortChoiceRequired {
        options: vec!["h25".into(), "h35".into()]
    }));
    assert!(card.dollar_difference.is_none());

    q.selected_cohort = Some("h35");
    let chosen = compare(&pkg, &q);
    assert_eq!(chosen.status, CardStatus::Comparable);
    assert_eq!(chosen.reference.unwrap().reference.id, "h35");
}

#[test]
fn a_stale_cohort_choice_that_is_no_longer_an_option_asks_again() {
    let mut q = query(ComparisonMode::Household, 30, "100");
    q.age = Some(AgeInput::Band { min: 30, max: Some(40) });
    q.selected_cohort = Some("a-cohort-from-an-older-package");
    assert_eq!(compare(&household_pkg(), &q).status, CardStatus::CohortChoiceRequired);
}

#[test]
fn a_nearest_cohort_is_approximate_and_names_the_substitute() {
    let pkg = package_with(vec![
        income("h25", "household", 25, Some(34), "100"),
        income("h45", "household", 45, Some(54), "200"),
    ]);
    let card = compare(&pkg, &query(ComparisonMode::Household, 37, "100"));
    assert_eq!(card.status, CardStatus::Approximate);
    assert!(card.reasons.contains(&Reason::NearestCohortUsed { cohort: "h25".into() }));
    assert!(card.dollar_difference.is_some(), "approximate cards still show valid differences");
}

#[test]
fn a_tied_nearest_cohort_asks_and_the_choice_stays_approximate() {
    let pkg = package_with(vec![
        income("h25", "household", 25, Some(34), "100"),
        income("h46", "household", 46, Some(55), "200"),
    ]);
    let mut q = query(ComparisonMode::Household, 40, "100");
    let asked = compare(&pkg, &q);
    assert_eq!(asked.status, CardStatus::CohortChoiceRequired);
    q.selected_cohort = Some("h46");
    let chosen = compare(&pkg, &q);
    assert_eq!(chosen.status, CardStatus::Approximate);
    assert_eq!(chosen.reference.unwrap().reference.id, "h46");
}

// ---- reference populations -------------------------------------------------------------------

fn savings(id: &str, universe: &str, value: &str) -> Value {
    let mut r = reference(id, "savings", "household", "liquid", 25, Some(34), value);
    r["universe"] = json!(universe);
    r["unit"] = json!("usd_balance");
    r
}

fn savings_query<'a>(value: &str) -> CardQuery<'a> {
    CardQuery {
        metric: MetricId::Savings,
        mode: ComparisonMode::Household,
        definition_id: Some("liquid"),
        age: Some(AgeInput::Exact { age: 30 }),
        selected_cohort: None,
        universe_preference: None,
        local: LocalMeasure {
            value: Some(dec(value)),
            unit: Unit::UsdBalance,
            holds_item: dec(value) > Decimal::ZERO,
            completeness: Completeness::Confirmed,
        },
    }
}

#[test]
fn with_both_populations_all_peers_is_the_default() {
    let pkg = package_with(vec![savings("all", "all", "100"), savings("holders", "holders", "300")]);
    let card = compare(&pkg, &savings_query("200"));
    assert_eq!(card.reference.unwrap().reference.id, "all");
}

#[test]
fn the_remembered_population_choice_is_honoured() {
    let pkg = package_with(vec![savings("all", "all", "100"), savings("holders", "holders", "300")]);
    let mut q = savings_query("200");
    q.universe_preference = Some(Universe::Holders);
    assert_eq!(compare(&pkg, &q).reference.unwrap().reference.id, "holders");
}

#[test]
fn a_remembered_choice_that_no_longer_exists_falls_back_to_what_does() {
    let pkg = package_with(vec![savings("all", "all", "100")]);
    let mut q = savings_query("200");
    q.universe_preference = Some(Universe::Holders);
    assert_eq!(compare(&pkg, &q).reference.unwrap().reference.id, "all");
}

#[test]
fn a_holders_only_benchmark_is_used_automatically_and_labelled_when_the_person_holds_the_item() {
    let pkg = package_with(vec![savings("holders", "holders", "300")]);
    let card = compare(&pkg, &savings_query("200"));
    assert_eq!(card.status, CardStatus::Comparable);
    assert!(card.reasons.contains(&Reason::HoldersOnlyUsed));
}

#[test]
fn a_zero_local_value_is_not_compared_with_a_holders_only_statistic() {
    let pkg = package_with(vec![savings("holders", "holders", "300")]);
    let card = compare(&pkg, &savings_query("0"));
    assert_eq!(card.status, CardStatus::NotComparable);
    assert!(card.reasons.contains(&Reason::HoldersOnlyZeroLocal));
    assert!(card.dollar_difference.is_none() && card.percent_difference.is_none());
}

#[test]
fn a_zero_local_value_is_still_compared_with_an_all_population_benchmark() {
    let pkg = package_with(vec![savings("all", "all", "100")]);
    let card = compare(&pkg, &savings_query("0"));
    assert_eq!(card.status, CardStatus::Comparable);
    assert_eq!(card.percent_difference.as_deref(), Some("-100"));
}

// ---- units -----------------------------------------------------------------------------------

#[test]
fn a_monthly_local_value_is_converted_to_the_references_unit() {
    let pkg = household_pkg();
    let mut q = query(ComparisonMode::Household, 30, "11");
    q.local = LocalMeasure {
        value: Some(dec("11")),
        unit: Unit::UsdPerMonth,
        holds_item: true,
        completeness: Completeness::Confirmed,
    };
    let card = compare(&pkg, &q);
    // 11/month = 132/year against the adjusted 110.
    assert_eq!(card.local_value, Some(dec("132")));
    assert_eq!(card.percent_difference.as_deref(), Some("20"));
}

#[test]
fn a_balance_is_never_compared_with_an_annual_flow() {
    let mut q = query(ComparisonMode::Household, 30, "100");
    q.local.unit = Unit::UsdBalance;
    let card = compare(&household_pkg(), &q);
    assert_eq!(card.status, CardStatus::Unavailable);
    assert!(card.reasons.contains(&Reason::UnitMismatch));
    assert!(card.dollar_difference.is_none());
}

#[test]
fn card_results_serialise_money_as_strings() {
    let card = compare(&household_pkg(), &query(ComparisonMode::Household, 30, "132"));
    let json = serde_json::to_value(&card).unwrap();
    assert_eq!(json["localValue"], json!("132"));
    assert_eq!(json["dollarDifference"], json!("22"));
    assert_eq!(json["reference"]["adjustedValue"], json!("110"));
    assert_eq!(json["status"], json!("comparable"));
}
