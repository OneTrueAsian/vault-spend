use super::*;
use crate::statement::layout::{BalancePair, GENERAL_ID, LayoutError, TotalsPair, built_in_layouts};

fn general() -> crate::statement::layout::StatementLayout {
    built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap()
}

fn later() -> NaiveDateTime {
    NaiveDateTime::parse_from_str("2026-09-01 09:30:00", "%Y-%m-%d %H:%M:%S").unwrap()
}

fn row_count(store: &Store) -> i64 {
    store.conn.query_row("SELECT COUNT(*) FROM statement_layouts", [], |r| r.get(0)).unwrap()
}

fn insert_raw(store: &Store, name: &str, json: &str) -> i64 {
    store
        .conn
        .execute(
            "INSERT INTO statement_layouts (name, layout, created_at, updated_at) VALUES (?1, ?2, 'x', 'x')",
            rusqlite::params![name, json],
        )
        .unwrap();
    store.conn.last_insert_rowid()
}

#[test]
fn a_learned_layout_is_saved_listed_renamed_and_removed() {
    let store = Store::open_in_memory().unwrap();
    let mut layout = general();
    layout.recognize = vec!["Riverbend Mutual Bank".into()];
    let id = store.save_statement_layout(None, "Riverbend", &layout, test_now()).unwrap();

    let listed = store.list_statement_layouts().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        (listed[0].id, listed[0].name.as_str(), listed[0].layout.name.as_str()),
        (id, "Riverbend", "Riverbend")
    );
    assert_eq!(listed[0].layout.recognize, vec!["Riverbend Mutual Bank".to_string()]);

    store.rename_statement_layout(id, "Riverbend checking", test_now()).unwrap();
    assert_eq!(store.list_statement_layouts().unwrap()[0].name, "Riverbend checking");

    store.delete_statement_layout(id).unwrap();
    assert!(store.list_statement_layouts().unwrap().is_empty());
}

#[test]
fn names_that_look_personal_are_refused() {
    let store = Store::open_in_memory().unwrap();
    assert!(matches!(
        store.save_statement_layout(None, "Card 61006", &general(), test_now()),
        Err(LayoutSaveError::Name)
    ));
    assert!(matches!(
        store.save_statement_layout(None, "  ", &general(), test_now()),
        Err(LayoutSaveError::Name)
    ));
}

#[test]
fn a_stored_layout_that_fails_validation_is_skipped_not_fatal() {
    let store = Store::open_in_memory().unwrap();
    store.save_statement_layout(None, "Good", &general(), test_now()).unwrap();
    insert_raw(&store, "Broken", "{\"schema\":99}");
    let names: Vec<String> = store.list_statement_layouts().unwrap().into_iter().map(|l| l.name).collect();
    assert_eq!(names, vec!["Good".to_string()]);
}

#[test]
fn updating_a_missing_layout_says_so() {
    let store = Store::open_in_memory().unwrap();
    assert!(matches!(
        store.save_statement_layout(Some(999), "Gone", &general(), test_now()),
        Err(LayoutSaveError::Missing)
    ));
}

#[test]
fn a_layout_too_large_to_list_is_refused_and_nothing_is_written() {
    // Every list field at its allowed maximum (32 entries of 80 characters each). validate() accepts
    // this, but the saved JSON is well past the 16 KiB document limit, so listing would skip it.
    let store = Store::open_in_memory().unwrap();
    let long = "x".repeat(80);
    let mut layout = general();
    layout.balances.pairs = (0..32)
        .map(|_| BalancePair {
            start: Some(long.clone()),
            end: long.clone(),
        })
        .collect();
    layout.balances.activity_totals = (0..32)
        .map(|_| TotalsPair {
            additions: long.clone(),
            subtractions: long.clone(),
        })
        .collect();
    layout.recognize = vec![long.clone(); 32];
    layout.skip_sections = vec![long.clone(); 32];
    layout.ignore_lines = vec![long.clone(); 32];
    layout.balances.section_start = vec![long.clone(); 32];
    assert!(
        layout.validate().is_ok(),
        "the fixture must pass validate() so only the size check can refuse it"
    );
    assert!(layout.to_json().len() > crate::statement::layout::MAX_LAYOUT_BYTES);

    assert!(matches!(
        store.save_statement_layout(None, "Too big", &layout, test_now()),
        Err(LayoutSaveError::Layout(LayoutError::TooLarge))
    ));
    assert_eq!(row_count(&store), 0);
    assert!(store.list_statement_layouts().unwrap().is_empty());
}

#[test]
fn an_update_keeps_created_at_and_moves_updated_at() {
    let store = Store::open_in_memory().unwrap();
    let id = store.save_statement_layout(None, "Riverbend", &general(), test_now()).unwrap();
    store.save_statement_layout(Some(id), "Riverbend", &general(), later()).unwrap();

    let (created, updated): (String, String) = store
        .conn
        .query_row("SELECT created_at, updated_at FROM statement_layouts WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(created, test_now().to_string());
    assert_eq!(updated, later().to_string());
}

#[test]
fn an_invalid_layout_is_refused_on_save() {
    let store = Store::open_in_memory().unwrap();
    let mut layout = general();
    layout.schema = 2;
    assert!(matches!(
        store.save_statement_layout(None, "Future", &layout, test_now()),
        Err(LayoutSaveError::Layout(_))
    ));
    assert_eq!(row_count(&store), 0);
}

#[test]
fn renaming_a_valid_layout_keeps_its_stored_name_in_step() {
    let store = Store::open_in_memory().unwrap();
    let id = store.save_statement_layout(None, "Riverbend", &general(), test_now()).unwrap();
    store.rename_statement_layout(id, "Riverbend checking", later()).unwrap();

    let listed = store.list_statement_layouts().unwrap();
    assert_eq!(listed[0].name, "Riverbend checking");
    assert_eq!(listed[0].layout.name, "Riverbend checking");
    assert_eq!(listed[0].updated_at, later().to_string());
}

#[test]
fn renaming_a_damaged_layout_renames_the_row_and_it_stays_skipped() {
    let store = Store::open_in_memory().unwrap();
    store.save_statement_layout(None, "Good", &general(), test_now()).unwrap();
    let id = insert_raw(&store, "Old bank", "{\"schema\":99}");

    store.rename_statement_layout(id, "Old bank checking", later()).unwrap();

    let (name, json): (String, String) = store
        .conn
        .query_row("SELECT name, layout FROM statement_layouts WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(name, "Old bank checking");
    assert_eq!(json, "{\"schema\":99}", "a damaged layout is renamed, not repaired");
    let names: Vec<String> = store.list_statement_layouts().unwrap().into_iter().map(|l| l.name).collect();
    assert_eq!(names, vec!["Good".to_string()]);
}

#[test]
fn renaming_a_missing_layout_says_so() {
    let store = Store::open_in_memory().unwrap();
    assert!(matches!(
        store.rename_statement_layout(999, "Gone", test_now()),
        Err(LayoutSaveError::Missing)
    ));
}

#[test]
fn renaming_to_a_personal_looking_name_is_refused() {
    let store = Store::open_in_memory().unwrap();
    let id = store.save_statement_layout(None, "Riverbend", &general(), test_now()).unwrap();
    assert!(matches!(
        store.rename_statement_layout(id, "Card 61006", later()),
        Err(LayoutSaveError::Name)
    ));
    assert_eq!(store.list_statement_layouts().unwrap()[0].name, "Riverbend");
}

#[test]
fn database_failures_show_a_plain_sentence_with_no_driver_text() {
    let shown = LayoutSaveError::Db(rusqlite::Error::InvalidQuery).to_string();
    assert_eq!(shown, "Something went wrong saving this. Please try again.");
}

#[test]
fn every_error_message_avoids_internal_words() {
    let banned = ["layout", "parse", "cleared", "unmatched", "tracked", "published"];
    let all = [
        LayoutSaveError::Name,
        LayoutSaveError::Missing,
        LayoutSaveError::Layout(LayoutError::TooLarge),
        LayoutSaveError::Layout(LayoutError::Malformed("x".into())),
        LayoutSaveError::Layout(LayoutError::Invalid("A statement setting has a damaged name.")),
        LayoutSaveError::Db(rusqlite::Error::InvalidQuery),
    ];
    for error in all {
        let shown = error.to_string().to_lowercase();
        for word in banned {
            assert!(!shown.contains(word), "{shown:?} contains {word:?}");
        }
    }
}
