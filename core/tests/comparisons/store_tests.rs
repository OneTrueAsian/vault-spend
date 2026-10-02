use super::setup_tests::{amount, base_setup, person, today};
use budget_core::comparisons::setup::*;
use budget_core::comparisons::types::{AgeInput, MetricId, Universe};
use budget_core::models::AccountType;
use budget_core::store::{ComparisonSetupError, DatabaseKey, Store};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::path::PathBuf;

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("vaultspend-comparisons-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A store with a partner and a roommate, so `base_setup()`-style references are real.
fn store_with_people() -> (Store, i64, i64) {
    let store = Store::open_in_memory().unwrap();
    let partner = store.create_family_member("Partner").unwrap();
    let roommate = store.create_family_member("Roommate").unwrap();
    (store, partner, roommate)
}

fn setup_for(partner: i64, roommate: i64) -> ComparisonSetup {
    let mut s = base_setup();
    s.people[1].person = person(partner);
    s.people[2].person = person(roommate);
    s
}

fn save(store: &Store, expected: i64, setup: &ComparisonSetup) -> Result<budget_core::store::StoredComparisonSetup, ComparisonSetupError> {
    store.save_comparison_setup(expected, setup, today())
}

#[test]
fn an_unconfigured_profile_reports_revision_zero_and_no_setup() {
    let store = Store::open_in_memory().unwrap();
    let stored = store.get_comparison_setup().unwrap();
    assert_eq!(stored.revision, 0);
    assert!(stored.setup.is_none());
    assert!(stored.repairs.is_empty());
}

#[test]
fn saving_round_trips_and_advances_the_revision() {
    let (store, partner, roommate) = store_with_people();
    let mut setup = setup_for(partner, roommate);
    setup.income.household_total = Some(amount("120000.50"));
    let first = save(&store, 0, &setup).unwrap();
    assert_eq!(first.revision, 1);
    assert_eq!(first.setup.as_ref(), Some(&setup));
    assert_eq!(store.get_comparison_setup().unwrap().setup, Some(setup.clone()));

    setup.people[0].age = Some(AgeConfirmation { age: AgeInput::Band { min: 25, max: Some(34) }, confirmed_on: "2026-09-30".into() });
    assert_eq!(save(&store, 1, &setup).unwrap().revision, 2);
    assert_eq!(store.get_comparison_setup().unwrap().setup, Some(setup));
}

#[test]
fn a_stale_revision_is_a_conflict_and_changes_nothing() {
    let (store, partner, roommate) = store_with_people();
    let original = setup_for(partner, roommate);
    save(&store, 0, &original).unwrap();
    let mut changed = original.clone();
    changed.household_reference_person = None;

    match save(&store, 0, &changed) {
        Err(ComparisonSetupError::Conflict { current_revision }) => assert_eq!(current_revision, 1),
        other => panic!("{other:?}"),
    }
    let stored = store.get_comparison_setup().unwrap();
    assert_eq!((stored.revision, stored.setup), (1, Some(original)));
}

#[test]
fn an_invalid_setup_is_refused_and_leaves_the_previous_revision_untouched() {
    let (store, partner, roommate) = store_with_people();
    let good = setup_for(partner, roommate);
    save(&store, 0, &good).unwrap();
    let mut bad = good.clone();
    bad.people[0].age = Some(AgeConfirmation { age: AgeInput::Exact { age: 3 }, confirmed_on: "2026-09-01".into() });
    match save(&store, 1, &bad) {
        Err(ComparisonSetupError::Invalid(problems)) => assert!(problems.iter().any(|p| p.field == "people[0].age"), "{problems:?}"),
        other => panic!("{other:?}"),
    }
    let stored = store.get_comparison_setup().unwrap();
    assert_eq!((stored.revision, stored.setup), (1, Some(good)));
}

#[test]
fn the_first_save_must_expect_revision_zero() {
    let (store, partner, roommate) = store_with_people();
    assert!(matches!(
        save(&store, 5, &setup_for(partner, roommate)),
        Err(ComparisonSetupError::Conflict { current_revision: 0 })
    ));
}

#[test]
fn references_are_checked_against_real_accounts_assets_and_members() {
    let (store, partner, roommate) = store_with_people();
    let account = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let asset = store.create_asset("Car", "vehicle", Decimal::from(9000), NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(), None).unwrap();
    let mut s = setup_for(partner, roommate);
    s.allocations = vec![
        Allocation { source: SourceRef::Account { id: account }, person: PersonRef::Owner, basis_points: 6000 },
        Allocation { source: SourceRef::Asset { id: asset }, person: person(partner), basis_points: 10000 },
    ];
    s.spending.account_ids = vec![account];
    assert!(save(&store, 0, &s).is_ok());

    let mut ghost = s.clone();
    ghost.allocations[0].source = SourceRef::Account { id: account + 1000 };
    assert!(matches!(save(&store, 1, &ghost), Err(ComparisonSetupError::Invalid(_))));
}

#[test]
fn cohort_choices_are_checked_against_the_bundled_package() {
    let (store, partner, roommate) = store_with_people();
    let mut s = setup_for(partner, roommate);
    s.cohort_choices = vec![CohortChoice {
        metric: MetricId::Income,
        reference_id: "cps_hinc02_money_income_median:25-29".into(),
    }];
    s.universe_preferences = vec![UniversePreference { metric: MetricId::Savings, universe: Universe::Holders }];
    assert!(save(&store, 0, &s).is_ok());
    s.cohort_choices[0].reference_id = "retired:25-29".into();
    assert!(matches!(save(&store, 1, &s), Err(ComparisonSetupError::Invalid(_))));
}

#[test]
fn deleting_a_member_leaves_the_setup_alone_and_reports_a_repair() {
    let (store, partner, roommate) = store_with_people();
    let mut s = setup_for(partner, roommate);
    s.income.per_person = vec![PersonIncome { person: person(partner), gross_annual: amount("50000") }];
    save(&store, 0, &s).unwrap();
    store.delete_family_member(partner).unwrap();

    let stored = store.get_comparison_setup().unwrap();
    assert_eq!(stored.setup, Some(s.clone()), "nothing is reassigned to anyone else");
    assert!(stored.repairs.contains(&Repair::MissingPerson { field: "income.perPerson[0].person".into(), person: person(partner) }));
    // The stale setup cannot be saved back: no resurrection of a deleted member.
    assert!(matches!(save(&store, 1, &s), Err(ComparisonSetupError::Invalid(_))));
}

#[test]
fn deleting_an_account_reports_only_the_dependent_inputs() {
    let (store, partner, roommate) = store_with_people();
    let keep = store.get_or_create_account("Savings", AccountType::Savings).unwrap();
    let old_card = store.get_or_create_account("Old card", AccountType::Credit).unwrap();
    let mut s = setup_for(partner, roommate);
    s.spending.account_ids = vec![keep];
    s.debt_exclusions = vec![SourceRef::Account { id: old_card }];
    save(&store, 0, &s).unwrap();
    store.delete_account(old_card).unwrap();
    let repairs = store.get_comparison_setup().unwrap().repairs;
    assert_eq!(repairs, vec![Repair::MissingSource { field: "debtExclusions[0]".into(), source: SourceRef::Account { id: old_card } }]);
}

#[test]
fn the_setup_survives_a_restart_and_reopening_twice() {
    let dir = temp_dir("restart");
    let path = dir.join("vaultspend.db");
    let setup = {
        let store = Store::open(&path).unwrap();
        let partner = store.create_family_member("Partner").unwrap();
        let roommate = store.create_family_member("Roommate").unwrap();
        let s = setup_for(partner, roommate);
        save(&store, 0, &s).unwrap();
        s
    };
    for _ in 0..2 {
        let store = Store::open(&path).unwrap();
        let stored = store.get_comparison_setup().unwrap();
        assert_eq!((stored.revision, stored.setup), (1, Some(setup.clone())));
    }
}

#[test]
fn an_older_database_without_the_table_gains_it_without_touching_existing_data() {
    let dir = temp_dir("migrate");
    let path = dir.join("old.db");
    {
        let store = Store::open(&path).unwrap();
        store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.create_family_member("Partner").unwrap();
    }
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("DROP TABLE comparison_setup;").unwrap();
    }
    let store = Store::open(&path).unwrap();
    assert!(store.find_account_by_name("Checking").unwrap().is_some());
    assert_eq!(store.list_family_members().unwrap().len(), 1);
    let stored = store.get_comparison_setup().unwrap();
    assert_eq!((stored.revision, stored.setup.is_none()), (0, true));
}

#[test]
fn profiles_never_share_a_setup() {
    let (a, partner, roommate) = store_with_people();
    let b = Store::open_in_memory().unwrap();
    save(&a, 0, &setup_for(partner, roommate)).unwrap();
    assert!(b.get_comparison_setup().unwrap().setup.is_none());
}

#[test]
fn a_backup_copy_carries_the_setup() {
    let dir = temp_dir("backup");
    let path = dir.join("vaultspend.db");
    let store = Store::open(&path).unwrap();
    let partner = store.create_family_member("Partner").unwrap();
    let roommate = store.create_family_member("Roommate").unwrap();
    let s = setup_for(partner, roommate);
    save(&store, 0, &s).unwrap();
    let copy = dir.join("backup.db");
    store.backup_to(&copy).unwrap();
    let restored = Store::open(&copy).unwrap();
    assert_eq!(restored.get_comparison_setup().unwrap().setup, Some(s));
}

#[test]
fn an_encrypted_copy_carries_the_setup_and_is_not_readable_as_plain_text() {
    let dir = temp_dir("encrypted");
    let path = dir.join("vaultspend.db");
    let store = Store::open(&path).unwrap();
    let partner = store.create_family_member("Partner").unwrap();
    let roommate = store.create_family_member("Roommate").unwrap();
    let mut s = setup_for(partner, roommate);
    s.income.household_total = Some(amount("987654.32"));
    save(&store, 0, &s).unwrap();

    let key = [7u8; 32];
    let protected = dir.join("protected.db");
    store.export_encrypted_copy(&protected, &key).unwrap();
    let opened = Store::open_with_key(&protected, DatabaseKey::Raw(&key)).unwrap();
    assert_eq!(opened.get_comparison_setup().unwrap().setup, Some(s));
    let raw = std::fs::read(&protected).unwrap();
    assert!(!raw.windows(9).any(|w| w == b"987654.32"), "private amounts must not appear in the file");
}

#[test]
fn a_stored_setup_from_a_newer_app_is_reported_not_misread() {
    let dir = temp_dir("future");
    let path = dir.join("future.db");
    drop(Store::open(&path).unwrap());
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute(
            "INSERT INTO comparison_setup (id, format_version, revision, payload, updated_at) VALUES (1, 99, 4, '{}', 'x')",
            [],
        )
        .unwrap();
    }
    let store = Store::open(&path).unwrap();
    assert!(matches!(store.get_comparison_setup(), Err(ComparisonSetupError::Unsupported { found: 99 })));
}

#[test]
fn a_damaged_payload_is_reported_as_corrupt() {
    let dir = temp_dir("corrupt");
    let path = dir.join("corrupt.db");
    drop(Store::open(&path).unwrap());
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute(
            "INSERT INTO comparison_setup (id, format_version, revision, payload, updated_at) VALUES (1, 1, 2, '{not json', 'x')",
            [],
        )
        .unwrap();
    }
    let store = Store::open(&path).unwrap();
    assert!(matches!(store.get_comparison_setup(), Err(ComparisonSetupError::Corrupt(_))));
}

#[test]
fn the_table_allows_only_one_row() {
    let dir = temp_dir("singleton");
    let path = dir.join("single.db");
    drop(Store::open(&path).unwrap());
    let conn = rusqlite::Connection::open(&path).unwrap();
    let second = conn.execute(
        "INSERT INTO comparison_setup (id, format_version, revision, payload, updated_at) VALUES (2, 1, 1, '{}', 'x')",
        [],
    );
    assert!(second.is_err());
}

#[test]
fn an_oversized_payload_is_refused() {
    let (store, partner, roommate) = store_with_people();
    let mut s = setup_for(partner, roommate);
    s.spending.category_mappings = (0..3000)
        .map(|i| CategoryMapping { category: format!("Category number {i} with a fairly long descriptive name"), component: "food".into() })
        .collect();
    assert!(matches!(save(&store, 0, &s), Err(ComparisonSetupError::Invalid(_))));
    assert_eq!(store.get_comparison_setup().unwrap().revision, 0);
}

#[test]
fn a_version_1_setup_saved_in_one_person_mode_loads_as_a_household_setup() {
    let dir = temp_dir("v1-upgrade");
    let path = dir.join("v1.db");
    let partner = {
        let store = Store::open(&path).unwrap();
        store.create_family_member("Partner").unwrap()
    };
    let v1 = serde_json::json!({
        "formatVersion": 1,
        "mode": "individual",
        "householdReferencePerson": { "kind": "owner" },
        "individualPerson": { "kind": "member", "id": partner },
        "people": [
            { "person": { "kind": "owner" }, "age": { "age": { "kind": "exact", "age": 42 }, "confirmedOn": "2026-09-01" }, "inHousehold": true },
            { "person": { "kind": "member", "id": partner }, "age": null, "inHousehold": true }
        ],
        "income": { "householdMethod": "by_person", "householdTotal": null, "perPerson": [] },
        "spending": { "period": null, "accountIds": [], "completenessConfirmed": false, "manualAnnual": null, "categoryMappings": [] },
        "savingsOverrides": [], "investmentClasses": [], "debtClasses": [], "debtExclusions": [], "allocations": [],
        "balanceConfirmations": [],
        "manualOverrides": [
            { "metric": "savings", "subject": null, "amount": { "value": "25000", "measuredOn": "2026-09-01", "explanation": "Statement" } },
            { "metric": "debt", "subject": { "kind": "member", "id": partner }, "amount": { "value": "900", "measuredOn": "2026-09-01", "explanation": "Card" } }
        ],
        "cohortChoices": [
            { "mode": "household", "metric": "income", "referenceId": "cps_hinc02_money_income_median:40-44" },
            { "mode": "individual", "metric": "income", "referenceId": "cps_pinc01_money_income_median:40-44" }
        ],
        "universePreferences": []
    });
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute(
            "INSERT INTO comparison_setup (id, format_version, revision, payload, updated_at) VALUES (1, 1, 4, ?1, 'x')",
            [v1.to_string()],
        )
        .unwrap();
    }
    let store = Store::open(&path).unwrap();
    let stored = store.get_comparison_setup().expect("a version 1 setup still loads");
    assert_eq!(stored.revision, 4);
    let setup = stored.setup.unwrap();
    assert_eq!(setup.format_version, SETUP_FORMAT_VERSION);
    assert_eq!(setup.household_reference_person, Some(PersonRef::Owner));
    assert_eq!(setup.manual_overrides.len(), 1, "the one-person typed total is dropped");
    assert_eq!(setup.manual_overrides[0].metric, MetricId::Savings);
    assert_eq!(
        setup.cohort_choices,
        vec![CohortChoice { metric: MetricId::Income, reference_id: "cps_hinc02_money_income_median:40-44".into() }]
    );
}
