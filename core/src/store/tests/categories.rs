use super::*;

// ---- reconciling an import's own categories (1.2.8) ----
//
// A bank CSV's "Category" column ("Merchandise", "Gas/Automotive", ...) used to be
// adopted wholesale: every name in the file was registered as a new category.
// An import must now use the categories the person already has; a name they
// don't have is mapped, created, or skipped only when they say so.

#[test]
fn correcting_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    // no transactions saved at all — id 999 doesn't exist
    store.set_category(999, "Dining Out", CategorySource::User, None).unwrap();
}

#[test]
fn a_category_only_a_transaction_still_remembers_is_registered_on_next_launch() {
    // Simulates data that predates this fix (or reached the
    // `transactions` table through some other bypass): the category
    // sits on the row but was never added to the registry.
    let dir = std::env::temp_dir().join(format!("vaultspend-category-backfill-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("test.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }

    {
        let store = Store::open(&db_path).unwrap();
        let account = test_account(&store);
        let mut imported = tx("2026-09-02", "HOMEDEPOT.COM", "-1056.37");
        imported.category = Some("Merchandise".to_string());
        store.save_transactions(account, &[imported]).unwrap();

        // Strip the registry entry back out to reproduce the pre-fix state.
        store
            .conn
            .execute("DELETE FROM categories WHERE name = ?1", params!["Merchandise"])
            .unwrap();
        assert!(!store.list_categories().unwrap().contains(&"Merchandise".to_string()));
    } // store (and its connection) dropped here

    let reopened = Store::open(&db_path).unwrap(); // the next real launch, running the fixed code
    assert!(
        reopened.list_categories().unwrap().contains(&"Merchandise".to_string()),
        "a category only ever seen on a transaction must self-heal into the registry on the next launch"
    );
    drop(reopened); // release the file handle before cleanup — Windows can't delete an open file

    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn the_launch_backfill_never_resurrects_a_deliberately_deleted_category() {
    let dir = std::env::temp_dir().join(format!("vaultspend-category-backfill-delete-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("test.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }

    {
        let store = Store::open(&db_path).unwrap();
        let account = test_account(&store);
        let ids = store
            .save_transactions_with_ids(account, &[tx("2026-09-02", "Old Merchant", "-10.00")])
            .unwrap();
        store.set_category(ids[0], "Junk", CategorySource::User, None).unwrap();
        store.delete_category("Junk").unwrap(); // nulls the transaction's category too
    }

    let reopened = Store::open(&db_path).unwrap();
    assert!(
        !reopened.list_categories().unwrap().contains(&"Junk".to_string()),
        "a deliberately deleted category must not come back just because the launch backfill ran again"
    );
    drop(reopened);

    std::fs::remove_file(&db_path).unwrap();
}

fn tx_in(category: &str, description: &str) -> Transaction {
    let mut t = tx("2026-09-02", description, "-10.00");
    t.category = Some(category.to_string());
    t
}

#[test]
fn find_category_matches_any_casing_and_returns_the_stored_spelling() {
    let store = Store::open_in_memory().unwrap();

    assert_eq!(store.find_category("groceries").unwrap(), Some("Groceries".to_string()));
    assert_eq!(store.find_category("  GROCERIES ").unwrap(), Some("Groceries".to_string()));
    assert_eq!(store.find_category("Merchandise").unwrap(), None);
    assert_eq!(store.find_category("   ").unwrap(), None);
}

#[test]
fn unmatched_import_categories_lists_only_names_the_person_does_not_have() {
    let store = Store::open_in_memory().unwrap();
    let rows = vec![
        tx_in("Groceries", "exists"),
        tx_in("groceries", "exists, other casing"),
        tx_in("Gas/Automotive", "unknown"),
        tx_in("Merchandise", "unknown"),
        tx_in("merchandise", "same unknown name, other casing"),
        tx("2026-09-02", "no category column value", "-1.00"),
        tx_in("   ", "blank"),
    ];

    let unmatched = store.unmatched_import_categories(&rows).unwrap();

    assert_eq!(
        unmatched,
        vec![
            UnmatchedImportCategory {
                name: "Merchandise".to_string(),
                count: 2
            },
            UnmatchedImportCategory {
                name: "Gas/Automotive".to_string(),
                count: 1
            },
        ],
        "biggest first, the file's own spelling, one entry per name however it is cased"
    );
}

#[test]
fn reconciling_an_import_never_creates_a_category_on_its_own() {
    let store = Store::open_in_memory().unwrap();
    let before = store.list_categories().unwrap();
    let mut rows = vec![tx_in("Merchandise", "HOMEDEPOT.COM")];

    store.reconcile_import_categories(&mut rows, &choices(&[])).unwrap();

    assert_eq!(rows[0].category, None, "a category the person doesn't have is left off, not adopted");
    assert_eq!(store.list_categories().unwrap(), before, "and nothing was added to their list");
}

#[test]
fn a_file_category_that_matches_an_existing_one_uses_the_existing_spelling() {
    let store = Store::open_in_memory().unwrap();
    let mut rows = vec![tx_in("GROCERIES", "a"), tx_in("groceries", "b")];

    store.reconcile_import_categories(&mut rows, &choices(&[])).unwrap();

    assert_eq!(rows[0].category.as_deref(), Some("Groceries"));
    assert_eq!(rows[1].category.as_deref(), Some("Groceries"));
    assert_eq!(
        store
            .list_categories()
            .unwrap()
            .iter()
            .filter(|c| c.eq_ignore_ascii_case("groceries"))
            .count(),
        1
    );
}

#[test]
fn mapping_a_file_category_to_an_existing_one_creates_nothing() {
    let store = Store::open_in_memory().unwrap();
    let before = store.list_categories().unwrap();
    let mut rows = vec![tx_in("Dining", "a"), tx_in("dining", "b")];

    store
        .reconcile_import_categories(&mut rows, &choices(&[("Dining", ImportCategoryChoice::MapTo("Dining Out".to_string()))]))
        .unwrap();

    assert_eq!(rows[0].category.as_deref(), Some("Dining Out"));
    assert_eq!(
        rows[1].category.as_deref(),
        Some("Dining Out"),
        "the choice covers every casing of the name"
    );
    assert_eq!(store.list_categories().unwrap(), before);
}

#[test]
fn skipping_a_file_category_imports_the_rows_without_one() {
    let store = Store::open_in_memory().unwrap();
    let before = store.list_categories().unwrap();
    let mut rows = vec![tx_in("Merchandise", "a")];

    store
        .reconcile_import_categories(&mut rows, &choices(&[("Merchandise", ImportCategoryChoice::Skip)]))
        .unwrap();

    assert_eq!(rows[0].category, None);
    assert_eq!(store.list_categories().unwrap(), before);
}

#[test]
fn creating_a_file_category_adds_it_once_with_the_files_spelling() {
    let store = Store::open_in_memory().unwrap();
    let mut rows = vec![tx_in("Pet Care", "a"), tx_in("pet care", "b")];

    store
        .reconcile_import_categories(&mut rows, &choices(&[("Pet Care", ImportCategoryChoice::Create)]))
        .unwrap();

    assert_eq!(rows[0].category.as_deref(), Some("Pet Care"));
    assert_eq!(rows[1].category.as_deref(), Some("Pet Care"));
    assert_eq!(
        store
            .list_categories()
            .unwrap()
            .iter()
            .filter(|c| c.eq_ignore_ascii_case("pet care"))
            .count(),
        1
    );
}

#[test]
fn mapping_to_a_category_that_does_not_exist_is_refused_and_changes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let before = store.list_categories().unwrap();
    let mut rows = vec![tx_in("Dining", "a")];

    let result = store.reconcile_import_categories(&mut rows, &choices(&[("Dining", ImportCategoryChoice::MapTo("Nope".to_string()))]));

    assert!(result.is_err(), "a mapping can only point at a category that already exists");
    assert_eq!(store.list_categories().unwrap(), before);
}

#[test]
fn set_category_if_registered_only_uses_categories_the_person_has() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let ids = store
        .save_transactions_with_ids(account, &[tx("2026-09-02", "STARBUCKS", "-4.50")])
        .unwrap();
    let before = store.list_categories().unwrap();

    let applied = store
        .set_category_if_registered(ids[0], "Coffee Runs", CategorySource::Rule, None)
        .unwrap();
    assert!(!applied, "an automatic guess must not invent a category");
    assert_eq!(store.list_categories().unwrap(), before);
    assert_eq!(store.all_transactions().unwrap()[0].transaction.category, None);

    let applied = store
        .set_category_if_registered(ids[0], "dining out", CategorySource::Rule, None)
        .unwrap();
    assert!(applied);
    assert_eq!(store.all_transactions().unwrap()[0].transaction.category.as_deref(), Some("Dining Out"));
}

#[test]
fn create_category_makes_a_new_category_selectable_before_anything_uses_it() {
    let store = Store::open_in_memory().unwrap();

    store.create_category("Pet Care", None).unwrap();

    assert!(store.list_categories().unwrap().contains(&"Pet Care".to_string()));
}

#[test]
fn creating_the_same_category_twice_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("Pet Care", None).unwrap();

    store.create_category("Pet Care", None).unwrap();

    let matches = store.list_categories().unwrap().iter().filter(|c| *c == "Pet Care").count();
    assert_eq!(matches, 1);
}

#[test]
fn rename_category_updates_matching_transactions_and_rules() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
    store.upsert_rule("coffee", "Dining Out").unwrap();

    let affected = store.rename_category("Dining Out", "Food & Drink").unwrap();

    assert_eq!(affected, 1);
    assert_eq!(
        store.all_transactions().unwrap()[0].transaction.category,
        Some("Food & Drink".to_string())
    );
    assert_eq!(
        store.load_rules().unwrap().categorize("Local Coffee Shop"),
        Some("Food & Drink".to_string())
    );
}

/// Regression test for a real bug: renaming a category into a brand
/// new name used to lose its icon — `INSERT OR IGNORE` created the new
/// registry row bare, and the old (icon-bearing) row was then deleted.
#[test]
fn rename_category_carries_its_icon_forward_to_a_new_name() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("Utilities", Some("utilities")).unwrap();

    store.rename_category("Utilities", "Bills").unwrap();

    let categories = store.list_categories_with_icons().unwrap();
    let bills = categories.iter().find(|c| c.name == "Bills").unwrap();
    assert_eq!(bills.icon_key, Some("utilities".to_string()));
    assert!(categories.iter().all(|c| c.name != "Utilities"));
}

#[test]
fn renaming_into_a_category_that_already_has_an_icon_keeps_the_targets_icon() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("Coffee", Some("groceries")).unwrap();
    store.create_category("Dining Out", Some("restaurant")).unwrap();

    store.rename_category("Coffee", "Dining Out").unwrap();

    let categories = store.list_categories_with_icons().unwrap();
    let dining = categories.iter().find(|c| c.name == "Dining Out").unwrap();
    assert_eq!(
        dining.icon_key,
        Some("restaurant".to_string()),
        "the existing target's icon should win, not be overwritten by the source's"
    );
}

#[test]
fn renaming_into_an_existing_category_with_no_icon_adopts_the_sources_icon() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("Coffee", Some("groceries")).unwrap();
    store.create_category("Dining Out", None).unwrap();

    store.rename_category("Coffee", "Dining Out").unwrap();

    let categories = store.list_categories_with_icons().unwrap();
    let dining = categories.iter().find(|c| c.name == "Dining Out").unwrap();
    assert_eq!(dining.icon_key, Some("groceries".to_string()));
}

#[test]
fn renaming_into_an_existing_category_merges_them() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[tx("2026-08-20", "Ferrywood Coffee", "-6.75"), tx("2026-08-21", "Downtown Cafe", "-12.00")],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    store.set_category(ids[0], "Coffee", CategorySource::User, None).unwrap();
    store.set_category(ids[1], "Dining Out", CategorySource::User, None).unwrap();

    store.rename_category("Coffee", "Dining Out").unwrap();

    let categories = store.list_categories().unwrap();
    assert!(!categories.contains(&"Coffee".to_string()), "the merged-away name must be gone");
    assert_eq!(
        categories.iter().filter(|c| *c == "Dining Out").count(),
        1,
        "merging must leave exactly one entry for the target category, not a duplicate"
    );
}

#[test]
fn delete_category_resets_its_transactions_to_uncategorized_and_removes_its_rules() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-20", "Ferrywood Coffee", "-6.75")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.set_category(id, "Dining Out", CategorySource::Classifier, Some(0.9)).unwrap();
    store.upsert_rule("coffee", "Dining Out").unwrap();

    let affected = store.delete_category("Dining Out").unwrap();

    assert_eq!(affected, 1);
    let stored = &store.all_transactions().unwrap()[0];
    assert_eq!(stored.transaction.category, None);
    assert_eq!(stored.category_source, None);
    assert_eq!(stored.confidence, None);
    assert_eq!(
        store.load_rules().unwrap().categorize("Local Coffee Shop"),
        None,
        "a rule that only pointed at the deleted category must not silently recreate it"
    );
    assert!(
        !store.list_categories().unwrap().contains(&"Dining Out".to_string()),
        "a deleted category must not still show up as a suggestion"
    );
}

#[test]
fn create_category_applies_an_icon_to_a_brand_new_category() {
    let store = Store::open_in_memory().unwrap();

    store.create_category("Utilities", Some("utilities")).unwrap();

    let categories = store.list_categories_with_icons().unwrap();
    let utilities = categories.iter().find(|c| c.name == "Utilities").unwrap();
    assert_eq!(utilities.icon_key, Some("utilities".to_string()));
}

#[test]
fn create_category_with_no_icon_does_not_clobber_an_existing_categorys_icon() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("Utilities", Some("utilities")).unwrap();

    // Re-registering the same category (e.g. because a transaction was
    // filed under it again) without specifying an icon must leave the
    // one already chosen alone.
    store.create_category("Utilities", None).unwrap();

    let categories = store.list_categories_with_icons().unwrap();
    let utilities = categories.iter().find(|c| c.name == "Utilities").unwrap();
    assert_eq!(utilities.icon_key, Some("utilities".to_string()));
}

#[test]
fn set_category_icon_can_clear_an_existing_categorys_icon() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("Utilities", Some("utilities")).unwrap();

    store.set_category_icon("Utilities", None).unwrap();

    let categories = store.list_categories_with_icons().unwrap();
    let utilities = categories.iter().find(|c| c.name == "Utilities").unwrap();
    assert_eq!(utilities.icon_key, None);
}

#[test]
fn list_categories_with_icons_matches_list_categories_by_name() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("Pet Care", None).unwrap();

    let names: Vec<String> = store.list_categories().unwrap();
    let with_icons = store.list_categories_with_icons().unwrap();

    assert_eq!(names, with_icons.iter().map(|c| c.name.clone()).collect::<Vec<_>>());
    assert!(with_icons.iter().any(|c| c.name == "Pet Care" && c.icon_key.is_none()));
}

fn choices(pairs: &[(&str, ImportCategoryChoice)]) -> std::collections::HashMap<String, ImportCategoryChoice> {
    pairs.iter().map(|(name, choice)| (name.to_string(), choice.clone())).collect()
}
