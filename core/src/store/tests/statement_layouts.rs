use super::*;
use crate::statement::layout::{GENERAL_ID, built_in_layouts};

fn general() -> crate::statement::layout::StatementLayout {
    built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap()
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
    store
        .conn
        .execute(
            "INSERT INTO statement_layouts (name, layout, created_at, updated_at) VALUES ('Broken', '{\"schema\":99}', 'x', 'x')",
            [],
        )
        .unwrap();
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
