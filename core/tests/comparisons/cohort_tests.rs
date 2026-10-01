use super::common::*;
use budget_core::comparisons::cohort::{match_cohort, CohortMatch};
use budget_core::comparisons::types::{AgeInput, ComparisonMode, MetricId, Reference};
use serde_json::json;

fn refs(bands: &[(u32, Option<u32>)]) -> Vec<Reference> {
    let records: Vec<_> = bands
        .iter()
        .enumerate()
        .map(|(i, (lo, hi))| reference(&format!("c{i}"), "income", "household", "d", *lo, *hi, "100"))
        .collect();
    let pkg = package_with(records);
    pkg.references(MetricId::Income, ComparisonMode::Household).cloned().collect()
}

fn matched<'a>(all: &'a [Reference], age: AgeInput) -> CohortMatch<'a> {
    let candidates: Vec<&Reference> = all.iter().collect();
    match_cohort(&candidates, age)
}

fn exact(age: u32) -> AgeInput {
    AgeInput::Exact { age }
}

const FIVE_YEAR: &[(u32, Option<u32>)] = &[(25, Some(29)), (30, Some(34)), (35, Some(39)), (75, None)];

#[test]
fn age_bounds_are_inclusive_at_both_ends() {
    let all = refs(FIVE_YEAR);
    for (age, id) in [(25, "c0"), (29, "c0"), (30, "c1"), (34, "c1"), (35, "c2")] {
        match matched(&all, exact(age)) {
            CohortMatch::Exact(r) => assert_eq!(r.id, id, "age {age}"),
            other => panic!("age {age}: {other:?}"),
        }
    }
}

#[test]
fn ages_inside_one_band_share_one_reference() {
    let all = refs(&[(25, Some(34)), (35, Some(44))]);
    let (CohortMatch::Exact(a), CohortMatch::Exact(b)) = (matched(&all, exact(30)), matched(&all, exact(31))) else {
        panic!("both ages should match exactly");
    };
    assert_eq!(a.id, b.id);
}

#[test]
fn an_open_upper_band_matches_every_older_age() {
    let all = refs(FIVE_YEAR);
    for age in [75, 90, 120] {
        assert!(matches!(matched(&all, exact(age)), CohortMatch::Exact(r) if r.id == "c3"), "age {age}");
    }
}

#[test]
fn a_band_that_fits_inside_one_cohort_is_exact() {
    let all = refs(&[(25, Some(34)), (35, Some(44))]);
    assert!(matches!(matched(&all, AgeInput::Band { min: 26, max: Some(33) }), CohortMatch::Exact(r) if r.id == "c0"));
    assert!(matches!(matched(&all, AgeInput::Band { min: 25, max: Some(34) }), CohortMatch::Exact(r) if r.id == "c0"));
}

#[test]
fn a_band_spanning_several_cohorts_asks_the_user_to_choose() {
    let all = refs(FIVE_YEAR);
    match matched(&all, AgeInput::Band { min: 25, max: Some(34) }) {
        CohortMatch::ChoiceRequired { options, approximate } => {
            let ids: Vec<_> = options.iter().map(|r| r.id.as_str()).collect();
            assert_eq!(ids, ["c0", "c1"]);
            assert!(!approximate, "a chosen published cohort is not an approximation");
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn an_open_band_overlaps_every_cohort_from_its_start() {
    let all = refs(FIVE_YEAR);
    match matched(&all, AgeInput::Band { min: 35, max: None }) {
        CohortMatch::ChoiceRequired { options, .. } => assert_eq!(options.len(), 2),
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_band_only_partly_covered_by_its_one_cohort_is_a_warned_substitute() {
    // Cohorts stop at 34; the band reaches 40.
    let all = refs(&[(25, Some(34))]);
    assert!(matches!(
        matched(&all, AgeInput::Band { min: 30, max: Some(40) }),
        CohortMatch::Nearest { reference, distance: 0 } if reference.id == "c0"
    ));
}

#[test]
fn an_age_with_no_cohort_uses_the_uniquely_nearest_one_as_a_substitute() {
    // 37 sits in a gap: 3 above 34, 8 below 45.
    let all = refs(&[(25, Some(34)), (45, Some(54))]);
    assert!(matches!(
        matched(&all, exact(37)),
        CohortMatch::Nearest { reference, distance: 3 } if reference.id == "c0"
    ));
}

#[test]
fn distance_is_measured_to_the_nearest_boundary_of_each_cohort() {
    let all = refs(&[(25, Some(34)), (45, Some(54))]);
    // 42 is 8 above 34 but only 3 below 45.
    assert!(matches!(
        matched(&all, exact(42)),
        CohortMatch::Nearest { reference, distance: 3 } if reference.id == "c1"
    ));
    // Below every cohort.
    assert!(matches!(matched(&all, exact(20)), CohortMatch::Nearest { reference, distance: 5 } if reference.id == "c0"));
    // Above a closed top cohort.
    assert!(matches!(matched(&all, exact(60)), CohortMatch::Nearest { reference, distance: 6 } if reference.id == "c1"));
}

#[test]
fn equally_near_cohorts_ask_the_user_rather_than_guessing() {
    // 40 is 6 above 34 and 6 below 46.
    let all = refs(&[(25, Some(34)), (46, Some(55))]);
    match matched(&all, exact(40)) {
        CohortMatch::ChoiceRequired { options, approximate } => {
            assert_eq!(options.len(), 2);
            assert!(approximate, "choosing between neighbours is still a substitution");
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_band_in_a_gap_uses_the_nearest_cohort_by_gap_size() {
    let all = refs(&[(25, Some(34)), (45, Some(54))]);
    // Band 36-38: 2 above 34, 7 below 45.
    assert!(matches!(
        matched(&all, AgeInput::Band { min: 36, max: Some(38) }),
        CohortMatch::Nearest { reference, distance: 2 } if reference.id == "c0"
    ));
}

#[test]
fn no_candidates_means_no_match() {
    assert!(matches!(match_cohort(&[], exact(30)), CohortMatch::None));
}

#[test]
fn age_input_validity_follows_the_adult_range() {
    assert!(exact(18).is_valid() && exact(120).is_valid());
    assert!(!exact(17).is_valid() && !exact(121).is_valid());
    assert!(AgeInput::Band { min: 25, max: Some(34) }.is_valid());
    assert!(AgeInput::Band { min: 65, max: None }.is_valid());
    assert!(!AgeInput::Band { min: 40, max: Some(30) }.is_valid());
    assert!(!AgeInput::Band { min: 10, max: Some(30) }.is_valid());
}

#[test]
fn age_input_round_trips_through_json() {
    let a: AgeInput = serde_json::from_value(json!({"kind": "band", "min": 65, "max": null})).unwrap();
    assert_eq!(a, AgeInput::Band { min: 65, max: None });
    assert_eq!(serde_json::to_value(exact(42)).unwrap(), json!({"kind": "exact", "age": 42}));
}
