use super::*;

#[test]
fn create_family_member_then_list_family_members_returns_it() {
    let store = Store::open_in_memory().unwrap();
    let id = store.create_family_member("Alex").unwrap();

    let members = store.list_family_members().unwrap();

    assert_eq!(
        members,
        vec![FamilyMember {
            id,
            name: "Alex".to_string()
        }]
    );
}

#[test]
fn create_family_member_rejects_a_duplicate_name_case_insensitively() {
    let store = Store::open_in_memory().unwrap();
    store.create_family_member("Alex").unwrap();

    let result = store.create_family_member("ALEX");

    assert!(result.is_err());
}

#[test]
fn rename_family_member_updates_its_name() {
    let store = Store::open_in_memory().unwrap();
    let id = store.create_family_member("Alex").unwrap();

    store.rename_family_member(id, "Alexandra").unwrap();

    let members = store.list_family_members().unwrap();
    assert_eq!(members[0].name, "Alexandra");
}

#[test]
fn rename_family_member_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.rename_family_member(999, "Nobody").unwrap();
}

#[test]
fn delete_family_member_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.delete_family_member(999).unwrap();
}
