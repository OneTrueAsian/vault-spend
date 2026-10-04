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

// ---- remembered import file categories (2026-10-04) ----
//
// When the person maps a bank's file category ("Merchandise") to one of theirs, the next
// import fills that choice in. Keyed by the file's name trimmed and lower-cased; the target
// is always one of their categories, in their spelling.

#[test]
fn an_import_category_key_is_the_trimmed_lower_cased_name() {
    assert_eq!(import_category_key("  Gas/Automotive "), "gas/automotive");
    assert_eq!(import_category_key("MERCHANDISE"), "merchandise");
}

#[test]
fn a_remembered_mapping_is_read_back_by_its_key_in_the_persons_spelling() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("Shopping", None).unwrap();
    store.set_import_category_mapping(" Merchandise ", "shopping").unwrap();

    let mappings = store.import_category_mappings().unwrap();
    assert_eq!(mappings.len(), 1);
    assert_eq!(mappings.get("merchandise").map(String::as_str), Some("Shopping"));
}

#[test]
fn setting_a_mapping_again_replaces_the_earlier_one() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("Shopping", None).unwrap();
    store.create_category("Home", None).unwrap();
    store.set_import_category_mapping("Merchandise", "Shopping").unwrap();
    store.set_import_category_mapping("MERCHANDISE", "Home").unwrap();

    let mappings = store.import_category_mappings().unwrap();
    assert_eq!(mappings.len(), 1);
    assert_eq!(mappings.get("merchandise").map(String::as_str), Some("Home"));
}

#[test]
fn removing_a_mapping_forgets_it_under_any_casing() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("Shopping", None).unwrap();
    store.set_import_category_mapping("Merchandise", "Shopping").unwrap();
    store.remove_import_category_mapping("  merchandise").unwrap();
    assert!(store.import_category_mappings().unwrap().is_empty());
    // removing one that isn't there is harmless
    store.remove_import_category_mapping("Never Seen").unwrap();
}

#[test]
fn a_mapping_to_a_category_the_person_does_not_have_is_refused() {
    let store = Store::open_in_memory().unwrap();
    let err = store.set_import_category_mapping("Merchandise", "Nope").unwrap_err();
    assert!(
        matches!(err, ImportCategoryError::UnknownCategory(ref name) if name == "Nope"),
        "got {err:?}"
    );
    assert!(store.import_category_mappings().unwrap().is_empty());
    // the refusal must not register the category either
    assert_eq!(store.find_category("Nope").unwrap(), None);
}

#[test]
fn a_mapping_with_an_empty_name_or_target_is_refused() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("Shopping", None).unwrap();
    assert!(store.set_import_category_mapping("   ", "Shopping").is_err());
    assert!(store.set_import_category_mapping("Merchandise", "  ").is_err());
    assert!(store.import_category_mappings().unwrap().is_empty());
}

#[test]
fn a_mapping_follows_its_category_when_it_is_renamed_or_merged() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("Shopping", None).unwrap();
    store.create_category("Household", None).unwrap();
    store.set_import_category_mapping("Merchandise", "Shopping").unwrap();
    store.set_import_category_mapping("Home Improvement", "Household").unwrap();

    store.rename_category("Shopping", "Stuff").unwrap();
    // a merge: rename into a category that already exists
    store.rename_category("Household", "Stuff").unwrap();

    let mappings = store.import_category_mappings().unwrap();
    assert_eq!(mappings.get("merchandise").map(String::as_str), Some("Stuff"));
    assert_eq!(mappings.get("home improvement").map(String::as_str), Some("Stuff"));
}

#[test]
fn deleting_a_category_forgets_the_mappings_that_point_at_it() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("Shopping", None).unwrap();
    store.create_category("Home", None).unwrap();
    store.set_import_category_mapping("Merchandise", "Shopping").unwrap();
    store.set_import_category_mapping("Hardware", "Home").unwrap();
    store.delete_category("Shopping").unwrap();

    let mappings = store.import_category_mappings().unwrap();
    assert_eq!(mappings.len(), 1);
    assert!(!mappings.contains_key("merchandise"));
    let raw: i64 = store
        .conn
        .query_row(
            "SELECT COUNT(*) FROM import_category_mappings WHERE file_category = 'merchandise'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(raw, 0, "the row itself is gone, not just hidden");
}

#[test]
fn a_stale_mapping_is_never_read_back() {
    // A mapping whose target vanished some other way (older data, a direct registry edit)
    // is ignored rather than handed to an import.
    let store = Store::open_in_memory().unwrap();
    store.create_category("Shopping", None).unwrap();
    store.set_import_category_mapping("Merchandise", "Shopping").unwrap();
    store.conn.execute("DELETE FROM categories WHERE name = 'Shopping'", []).unwrap();
    assert!(store.import_category_mappings().unwrap().is_empty());
}

#[test]
fn mappings_are_shared_by_every_account_in_a_profile_but_not_across_profiles() {
    let one = Store::open_in_memory().unwrap();
    let other = Store::open_in_memory().unwrap();
    one.create_category("Shopping", None).unwrap();
    other.create_category("Shopping", None).unwrap();
    // keyed by name only: there is no account in the mapping at all
    one.set_import_category_mapping("Merchandise", "Shopping").unwrap();
    assert_eq!(one.import_category_mappings().unwrap().len(), 1);
    assert!(other.import_category_mappings().unwrap().is_empty());
}

#[test]
fn a_mapping_survives_closing_and_reopening_the_database() {
    let dir = std::env::temp_dir().join(format!("vaultspend-import-mapping-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("test.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }
    {
        let store = Store::open(&db_path).unwrap();
        store.create_category("Shopping", None).unwrap();
        store.set_import_category_mapping("Merchandise", "Shopping").unwrap();
    }
    {
        let store = Store::open(&db_path).unwrap();
        assert_eq!(
            store.import_category_mappings().unwrap().get("merchandise").map(String::as_str),
            Some("Shopping")
        );
    }
    std::fs::remove_dir_all(&dir).ok();
}
