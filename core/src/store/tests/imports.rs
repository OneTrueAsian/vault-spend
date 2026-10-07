use super::*;

// ---- writing a reviewed import all at once (2026-10-04) ----
//
// The review screen settles every row before anything is saved; `commit_import_batch` then
// writes the whole import in one go, or nothing at all.

fn row(account: ImportAccount, description: &str, category: RowCategory) -> ImportBatchRow {
    ImportBatchRow {
        account,
        transaction: tx("2026-01-05", description, "-10.00"),
        tags: Vec::new(),
        notes: None,
        category,
    }
}

fn category_of(store: &Store, id: i64) -> (Option<String>, Option<CategorySource>, Option<f64>) {
    let t = store.transactions_by_ids(&[id]).unwrap().remove(0);
    (t.transaction.category, t.category_source, t.confidence)
}

fn snapshot(store: &Store) -> String {
    format!(
        "{:?}|{:?}|{:?}|{:?}|{}",
        store.list_categories().unwrap(),
        store
            .import_category_mappings()
            .unwrap()
            .into_iter()
            .collect::<std::collections::BTreeMap<_, _>>(),
        store.load_rules().unwrap(),
        store.find_account_by_name("Brand New Card").unwrap(),
        raw_transaction_count(store),
    )
}

#[test]
fn each_row_is_saved_with_the_category_and_source_it_was_settled_with() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    for c in ["Groceries", "Dining", "Shopping"] {
        store.create_category(c, None).unwrap();
    }
    let mut filed = row(ImportAccount::Existing(account), "SUNNY MARKET", RowCategory::AsFiled);
    filed.transaction.category = Some("Groceries".into());
    let batch = ImportBatch {
        rows: vec![
            filed,
            row(
                ImportAccount::Existing(account),
                "PIZZA PLACE",
                RowCategory::Guess {
                    category: "Dining".into(),
                    source: CategorySource::Classifier,
                    confidence: Some(0.62),
                },
            ),
            row(ImportAccount::Existing(account), "HOMEGOODS 12", RowCategory::Chosen("Shopping".into())),
            row(ImportAccount::Existing(account), "ZZQX", RowCategory::LeaveUncategorized),
        ],
        ..ImportBatch::default()
    };

    let outcome = store.commit_import_batch(&batch).unwrap();
    let ids = &outcome.inserted_ids;
    assert_eq!(ids.len(), 4);
    assert_eq!(category_of(&store, ids[0]), (Some("Groceries".into()), None, None));
    assert_eq!(
        category_of(&store, ids[1]),
        (Some("Dining".into()), Some(CategorySource::Classifier), Some(0.62))
    );
    assert_eq!(category_of(&store, ids[2]), (Some("Shopping".into()), Some(CategorySource::User), None));
    assert_eq!(category_of(&store, ids[3]), (None, None, None));
}

#[test]
fn a_chosen_category_is_taught_as_a_rule_and_leaving_one_uncategorized_teaches_nothing() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.create_category("Shopping", None).unwrap();
    let rules_before = store.load_rules().unwrap().categorize("HOMEGOODS 12");
    let batch = ImportBatch {
        rows: vec![
            row(ImportAccount::Existing(account), " HOMEGOODS 12 ", RowCategory::Chosen("Shopping".into())),
            row(ImportAccount::Existing(account), "ZZQX", RowCategory::LeaveUncategorized),
        ],
        ..ImportBatch::default()
    };
    let outcome = store.commit_import_batch(&batch).unwrap();

    assert_eq!(outcome.taught, vec![(" HOMEGOODS 12 ".to_string(), "Shopping".to_string())]);
    assert_eq!(rules_before, None);
    assert_eq!(store.load_rules().unwrap().categorize("HOMEGOODS 12").as_deref(), Some("Shopping"));
    assert_eq!(store.load_rules().unwrap().categorize("ZZQX"), None);
}

#[test]
fn teaching_follows_file_order_across_accounts_so_the_last_choice_wins_the_rule() {
    let store = Store::open_in_memory().unwrap();
    let first = test_account(&store);
    let second = store.get_or_create_account("Savings", AccountType::Savings).unwrap();
    store.create_category("Shopping", None).unwrap();
    store.create_category("Home", None).unwrap();
    let batch = ImportBatch {
        rows: vec![
            row(ImportAccount::Existing(second), "HOMEGOODS 12", RowCategory::Chosen("Shopping".into())),
            row(ImportAccount::Existing(first), "HOMEGOODS 12", RowCategory::Chosen("Home".into())),
        ],
        ..ImportBatch::default()
    };
    let outcome = store.commit_import_batch(&batch).unwrap();

    assert_eq!(category_of(&store, outcome.inserted_ids[0]).0.as_deref(), Some("Shopping"));
    assert_eq!(category_of(&store, outcome.inserted_ids[1]).0.as_deref(), Some("Home"));
    assert_eq!(
        outcome.taught.iter().map(|(_, c)| c.as_str()).collect::<Vec<_>>(),
        vec!["Shopping", "Home"]
    );
    assert_eq!(store.load_rules().unwrap().categorize("HOMEGOODS 12").as_deref(), Some("Home"));
}

#[test]
fn a_batch_creates_named_accounts_and_attaches_tags_and_notes() {
    let store = Store::open_in_memory().unwrap();
    let mut r = row(ImportAccount::Named("Brand New Card".into()), "ZZQX", RowCategory::LeaveUncategorized);
    r.tags = vec!["trip".into()];
    r.notes = Some("  paid back  ".into());
    let outcome = store
        .commit_import_batch(&ImportBatch {
            rows: vec![r],
            ..ImportBatch::default()
        })
        .unwrap();

    let card = store.find_account_by_name("brand new card").unwrap().expect("account created");
    let saved = store.transactions_by_ids(&outcome.inserted_ids).unwrap().remove(0);
    assert_eq!(saved.account_id, card);
    assert_eq!(saved.notes.as_deref(), Some("paid back"));
    assert_eq!(saved.tags, vec!["trip".to_string()]);
}

#[test]
fn a_batch_adds_the_categories_it_was_told_to_and_files_rows_under_them() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let mut r = row(ImportAccount::Existing(account), "VET CLINIC", RowCategory::AsFiled);
    r.transaction.category = Some("Pet Care".into());
    let outcome = store
        .commit_import_batch(&ImportBatch {
            rows: vec![r],
            create_categories: vec!["Pet Care".into()],
            ..ImportBatch::default()
        })
        .unwrap();
    assert_eq!(store.find_category("pet care").unwrap().as_deref(), Some("Pet Care"));
    assert_eq!(category_of(&store, outcome.inserted_ids[0]).0.as_deref(), Some("Pet Care"));
}

#[test]
fn a_batch_remembers_and_forgets_file_categories_and_the_sign_answer() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.create_category("Shopping", None).unwrap();
    store.create_category("Home", None).unwrap();
    store.set_import_category_mapping("Hardware", "Home").unwrap();
    store
        .commit_import_batch(&ImportBatch {
            rows: vec![row(ImportAccount::Existing(account), "ZZQX", RowCategory::LeaveUncategorized)],
            remember: vec![("Merchandise".into(), "Shopping".into())],
            forget: vec!["HARDWARE".into()],
            sign_preference: Some((account, true)),
            ..ImportBatch::default()
        })
        .unwrap();
    let mappings = store.import_category_mappings().unwrap();
    assert_eq!(mappings.get("merchandise").map(String::as_str), Some("Shopping"));
    assert!(!mappings.contains_key("hardware"));
    let stored = store.list_accounts(far_future()).unwrap().into_iter().find(|a| a.id == account).unwrap();
    assert_eq!(stored.import_flip_signs, Some(true));
}

#[test]
fn a_batch_naming_an_account_that_does_not_exist_writes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.create_category("Shopping", None).unwrap();
    let before = snapshot(&store);
    let result = store.commit_import_batch(&ImportBatch {
        rows: vec![
            row(
                ImportAccount::Named("Brand New Card".into()),
                "OK ROW",
                RowCategory::Chosen("Shopping".into()),
            ),
            row(ImportAccount::Existing(account + 999), "BAD ROW", RowCategory::LeaveUncategorized),
        ],
        create_categories: vec!["Pet Care".into()],
        remember: vec![("Merchandise".into(), "Shopping".into())],
        ..ImportBatch::default()
    });
    assert!(matches!(result, Err(ImportBatchError::UnknownAccount(_))), "got {result:?}");
    assert_eq!(snapshot(&store), before);
}

#[test]
fn a_batch_choosing_a_category_the_person_does_not_have_writes_nothing() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let before = snapshot(&store);
    let result = store.commit_import_batch(&ImportBatch {
        rows: vec![row(ImportAccount::Existing(account), "ROW", RowCategory::Chosen("Nope".into()))],
        ..ImportBatch::default()
    });
    assert!(
        matches!(result, Err(ImportBatchError::UnknownCategory(ref c)) if c == "Nope"),
        "got {result:?}"
    );
    assert_eq!(snapshot(&store), before);
}

#[test]
fn a_failure_part_way_through_rolls_the_whole_import_back() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.create_category("Shopping", None).unwrap();
    // Reject one row's insert after the earlier rows, a new account, a new category, a learned
    // rule and a mapping have all been written.
    store
        .conn
        .execute_batch(
            "CREATE TRIGGER fail_one BEFORE INSERT ON transactions WHEN NEW.description = 'BOOM'
             BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
        )
        .unwrap();
    let before = snapshot(&store);
    let result = store.commit_import_batch(&ImportBatch {
        rows: vec![
            row(
                ImportAccount::Named("Brand New Card".into()),
                "HOMEGOODS 12",
                RowCategory::Chosen("Shopping".into()),
            ),
            row(ImportAccount::Existing(account), "BOOM", RowCategory::LeaveUncategorized),
        ],
        create_categories: vec!["Pet Care".into()],
        remember: vec![("Merchandise".into(), "Shopping".into())],
        sign_preference: Some((account, true)),
        ..ImportBatch::default()
    });
    assert!(matches!(result, Err(ImportBatchError::Db(_))), "got {result:?}");
    assert_eq!(snapshot(&store), before);
    let stored = store.list_accounts(far_future()).unwrap().into_iter().find(|a| a.id == account).unwrap();
    assert_eq!(stored.import_flip_signs, None);
}
