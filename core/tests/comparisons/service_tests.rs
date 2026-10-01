use super::setup_tests::{amount, base_setup, person, today};
use budget_core::comparisons::service::{get_comparisons, get_setup, save_setup, SaveResponse};
use budget_core::comparisons::setup::*;
use budget_core::comparisons::types::{CardStatus, MetricId};
use budget_core::models::AccountType;
use budget_core::store::Store;
use serde_json::json;

fn store_with_people() -> (Store, ComparisonSetup) {
    let store = Store::open_in_memory().unwrap();
    let partner = store.create_family_member("Partner").unwrap();
    let roommate = store.create_family_member("Roommate").unwrap();
    let mut s = base_setup();
    s.people[1].person = person(partner);
    s.people[2].person = person(roommate);
    (store, s)
}

#[test]
fn an_unconfigured_profile_reports_no_setup_and_no_report() {
    let store = Store::open_in_memory().unwrap();
    let r = get_comparisons(&store, today()).unwrap();
    assert!(!r.configured && r.report.is_none() && r.setup_revision == 0);
    let s = get_setup(&store).unwrap();
    assert_eq!((s.revision, s.setup.is_none()), (0, true));
}

#[test]
fn saving_then_reading_gives_the_same_setup_and_a_report() {
    let (store, mut setup) = store_with_people();
    setup.income.household_total = Some(amount("100000"));
    match save_setup(&store, 0, &setup, today()).unwrap() {
        SaveResponse::Saved { revision, setup: saved } => assert_eq!((revision, *saved), (1, setup.clone())),
        other => panic!("{other:?}"),
    }
    let r = get_comparisons(&store, today()).unwrap();
    assert!(r.configured);
    assert_eq!(r.setup_revision, 1);
    let report = r.report.unwrap();
    let income = report.cards.iter().find(|c| c.result.metric == MetricId::Income).unwrap();
    assert_eq!(income.result.status, CardStatus::Comparable);
}

#[test]
fn a_stale_save_is_a_conflict_response_not_an_error() {
    let (store, setup) = store_with_people();
    save_setup(&store, 0, &setup, today()).unwrap();
    assert!(matches!(save_setup(&store, 0, &setup, today()).unwrap(), SaveResponse::Conflict { current_revision: 1 }));
}

#[test]
fn an_invalid_save_lists_every_problem_and_changes_nothing() {
    let (store, mut setup) = store_with_people();
    setup.spending.account_ids = vec![404];
    setup.allocations = vec![Allocation { source: SourceRef::Account { id: 404 }, person: PersonRef::Owner, basis_points: 1 }];
    match save_setup(&store, 0, &setup, today()).unwrap() {
        SaveResponse::Invalid { problems } => assert!(problems.len() >= 2, "{problems:?}"),
        other => panic!("{other:?}"),
    }
    assert_eq!(get_setup(&store).unwrap().revision, 0);
}

#[test]
fn the_report_reflects_the_ledger_the_moment_it_is_read() {
    let (store, mut setup) = store_with_people();
    setup.balance_confirmations = vec![BalanceConfirmation { metric: MetricId::Savings, confirmed_on: "2026-09-30".into() }];
    save_setup(&store, 0, &setup, today()).unwrap();
    let savings = |store: &Store| {
        let r = get_comparisons(store, today()).unwrap().report.unwrap();
        r.cards.into_iter().find(|c| c.result.metric == MetricId::Savings).unwrap().result.local_value
    };
    let account = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    assert_eq!(savings(&store).map(|v| v.to_string()), Some("0".into()));
    store
        .save_transactions(
            account,
            &[budget_core::models::Transaction {
                date: chrono::NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
                description: "Deposit".into(),
                amount: rust_decimal::Decimal::from(750),
                category: None,
            }],
        )
        .unwrap();
    assert_eq!(savings(&store).map(|v| v.to_string()), Some("750".into()));
}

#[test]
fn responses_serialise_in_the_shape_the_frontend_reads() {
    let (store, setup) = store_with_people();
    let saved = serde_json::to_value(save_setup(&store, 0, &setup, today()).unwrap()).unwrap();
    assert_eq!(saved["status"], json!("saved"));
    assert_eq!(saved["revision"], json!(1));
    let stale = serde_json::to_value(save_setup(&store, 0, &setup, today()).unwrap()).unwrap();
    assert_eq!(stale, json!({"status": "conflict", "currentRevision": 1}));
    let read = serde_json::to_value(get_comparisons(&store, today()).unwrap()).unwrap();
    assert_eq!(read["configured"], json!(true));
    assert_eq!(read["setupRevision"], json!(1));
    assert!(read["report"]["cards"].is_array());
}

#[test]
fn a_stored_setup_that_cannot_be_read_is_an_error_not_an_empty_page() {
    let dir = std::env::temp_dir().join(format!("vaultspend-cmp-service-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("v.db");
    drop(Store::open(&path).unwrap());
    rusqlite::Connection::open(&path)
        .unwrap()
        .execute("INSERT INTO comparison_setup (id, format_version, revision, payload, updated_at) VALUES (1, 1, 3, '{nope', 'x')", [])
        .unwrap();
    let store = Store::open(&path).unwrap();
    assert!(get_comparisons(&store, today()).is_err());
    assert!(get_setup(&store).is_err());
}
