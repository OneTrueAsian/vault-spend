use super::common::*;
use budget_core::comparisons::package::{Package, PackageError};
use budget_core::comparisons::types::{ComparisonMode, MetricId, Statistic};
use rust_decimal::Decimal;
use serde_json::json;
use std::str::FromStr;

fn dec(s: &str) -> Decimal {
    Decimal::from_str(s).unwrap()
}

fn invalid_with(err: &PackageError, needle: &str) -> bool {
    matches!(err, PackageError::Invalid(m) if m.contains(needle))
}

#[test]
fn bundled_package_loads_and_has_individual_income() {
    let pkg = Package::bundled().expect("bundled package must validate");
    let hit = pkg
        .references(MetricId::Income, ComparisonMode::Individual)
        .find(|r| r.age_min == 25 && r.age_max == Some(29))
        .expect("25-29 individual income");
    assert_eq!(hit.value, dec("49870"));
}

#[test]
fn bundled_package_documents_its_gaps() {
    let pkg = Package::bundled().unwrap();
    assert!(pkg.gap_reason(MetricId::Spending, ComparisonMode::Individual).is_some());
    assert!(pkg.references(MetricId::Spending, ComparisonMode::Individual).next().is_none());
    assert!(pkg.gap_reason(MetricId::Income, ComparisonMode::Household).is_none());
    assert!(pkg.gap_reason(MetricId::Spending, ComparisonMode::Household).is_none());
}

#[test]
fn bundled_household_spending_is_the_bls_average_by_age_of_reference_person() {
    let pkg = Package::bundled().unwrap();
    let hit = pkg
        .references(MetricId::Spending, ComparisonMode::Household)
        .find(|r| r.age_min == 35 && r.age_max == Some(44))
        .expect("35-44 household spending");
    assert_eq!(hit.value, dec("91229"));
    assert_eq!(hit.statistic, Statistic::Mean, "the Consumer Expenditure Surveys publish averages, shown as such");
    assert_eq!(hit.definition_id, "bls_ce_total_expenditures_mean");
}

#[test]
fn bundled_cpi_has_the_latest_month_and_the_october_2025_hole() {
    let pkg = Package::bundled().unwrap();
    assert_eq!(pkg.latest_cpi_month(), "2026-08");
    assert_eq!(pkg.cpi("2026-08"), Some(dec("334.98")));
    assert_eq!(pkg.cpi("2025-10"), None);
    assert_eq!(pkg.cpi_annual_average("2025"), None, "an annual average with a missing month must not exist");
    assert!(pkg.cpi_annual_average("2024").is_some());
}

#[test]
fn a_synthetic_package_is_refused() {
    let r = reference("a", "income", "household", "d", 25, Some(34), "100");
    let err = try_package(vec![r], json!({"synthetic": true}), default_cpi()).unwrap_err();
    assert!(invalid_with(&err, "synthetic"), "{err}");
}

#[test]
fn unsupported_format_version_is_refused() {
    let r = reference("a", "income", "household", "d", 25, Some(34), "100");
    let err = try_package(vec![r], json!({"formatVersion": 2}), default_cpi()).unwrap_err();
    assert!(invalid_with(&err, "formatVersion"), "{err}");
}

#[test]
fn tampered_records_fail_the_checksum() {
    let r = reference("a", "income", "household", "d", 25, Some(34), "100");
    let raw = serde_json::to_string_pretty(&vec![r]).unwrap();
    let manifest = manifest_json(&raw, json!({}));
    let tampered = raw.replace("\"100\"", "\"999\"");
    let err = Package::from_json(&manifest.to_string(), &tampered, &default_cpi().to_string()).unwrap_err();
    assert!(invalid_with(&err, "checksum"), "{err}");
}

#[test]
fn duplicate_ids_are_refused() {
    let r = reference("a", "income", "household", "d", 25, Some(34), "100");
    let err = try_package(vec![r.clone(), r], json!({}), default_cpi()).unwrap_err();
    assert!(invalid_with(&err, "duplicate"), "{err}");
}

#[test]
fn overlapping_cohorts_for_one_definition_are_refused() {
    let a = reference("a", "income", "household", "d", 25, Some(34), "100");
    let b = reference("b", "income", "household", "d", 30, Some(39), "110");
    let err = try_package(vec![a, b], json!({}), default_cpi()).unwrap_err();
    assert!(invalid_with(&err, "overlap"), "{err}");
}

#[test]
fn adjacent_cohorts_and_different_definitions_are_fine() {
    let a = reference("a", "income", "household", "d", 25, Some(34), "100");
    let b = reference("b", "income", "household", "d", 35, Some(44), "110");
    let c = reference("c", "income", "household", "other", 30, Some(39), "110");
    assert!(try_package(vec![a, b, c], json!({}), default_cpi()).is_ok());
}

#[test]
fn a_float_value_is_refused_rather_than_rounded() {
    let mut r = reference("a", "income", "household", "d", 25, Some(34), "100");
    r["value"] = json!(100.5);
    assert!(matches!(try_package(vec![r], json!({}), default_cpi()), Err(PackageError::Parse(_))));
}

#[test]
fn a_basis_month_missing_from_the_cpi_series_is_refused() {
    let mut r = reference("a", "income", "household", "d", 25, Some(34), "100");
    r["dollarBasis"] = json!({"kind": "month", "period": "1999-01"});
    let err = try_package(vec![r], json!({}), default_cpi()).unwrap_err();
    assert!(invalid_with(&err, "cpi"), "{err}");
}

#[test]
fn latest_cpi_month_must_exist_in_the_series() {
    let r = reference("a", "income", "household", "d", 25, Some(34), "100");
    let err = try_package(vec![r], json!({"cpi": {"series": "CPIAUCNS", "latestMonth": "2027-01"}}), default_cpi())
        .unwrap_err();
    assert!(invalid_with(&err, "latestMonth"), "{err}");
}

#[test]
fn metrics_the_package_does_not_cover_have_no_references() {
    let r = reference("a", "income", "household", "d", 25, Some(34), "100");
    let pkg = package_with(vec![r]);
    assert!(pkg.references(MetricId::Debt, ComparisonMode::Household).next().is_none());
}
