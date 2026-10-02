use super::*;

#[test]
fn upserted_rules_persist_and_load_back() {
    let store = Store::open_in_memory().unwrap();
    store.upsert_rule("coffee", "Dining Out").unwrap();

    let rules = store.load_rules().unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules.categorize("Local Coffee Shop"), Some("Dining Out".to_string()));
}

#[test]
fn upserting_the_same_pattern_again_updates_rather_than_duplicates() {
    let store = Store::open_in_memory().unwrap();
    store.upsert_rule("Ferrywood Coffee", "Dining Out").unwrap();
    store.upsert_rule("Ferrywood Coffee", "Business Expense").unwrap();

    let rules = store.load_rules().unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules.categorize("Ferrywood Coffee"), Some("Business Expense".to_string()));
}

#[test]
fn a_fresh_store_has_no_persisted_rules() {
    let store = Store::open_in_memory().unwrap();
    assert_eq!(store.load_rules().unwrap().len(), 0);
}

#[test]
fn labeled_history_includes_only_categorized_transactions() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-20", "Ferrywood Coffee", "-6.75"),
                tx("2026-08-21", "Mystery Merchant", "-10.00"),
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    store.set_category(ids[0], "Dining Out", CategorySource::User, None).unwrap();
    // ids[1] ("Mystery Merchant") is deliberately left uncategorized

    let history = store.labeled_history().unwrap();
    assert_eq!(history, vec![("Ferrywood Coffee".to_string(), "Dining Out".to_string())]);
}

#[test]
fn labeled_history_excludes_the_classifiers_own_guesses() {
    // A classifier guess is not ground truth — training the *next*
    // classifier on it would let one early wrong guess reinforce
    // itself indefinitely, since every later import's training corpus
    // would include it as if a human had confirmed it.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-20", "Ferrywood Coffee", "-6.75"),
                tx("2026-08-21", "Mystery Merchant", "-10.00"),
                tx("2026-08-22", "Another Merchant", "-5.00"),
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    store.set_category(ids[0], "Dining Out", CategorySource::User, None).unwrap();
    store.set_category(ids[1], "Groceries", CategorySource::Rule, None).unwrap();
    store
        .set_category(ids[2], "Entertainment", CategorySource::Classifier, Some(0.5))
        .unwrap();

    let history = store.labeled_history().unwrap();
    assert_eq!(history.len(), 2, "the classifier's own guess must not become training data");
    assert!(history.contains(&("Ferrywood Coffee".to_string(), "Dining Out".to_string())));
    assert!(history.contains(&("Mystery Merchant".to_string(), "Groceries".to_string())));
}

fn rule_patterns(store: &Store) -> Vec<String> {
    store.list_rules().unwrap().into_iter().map(|r| r.pattern).collect()
}

#[test]
fn seed_default_rules_once_seeds_a_fresh_store_exactly_once() {
    let store = Store::open_in_memory().unwrap();
    assert!(store.list_rules().unwrap().is_empty(), "a brand-new store starts with no rules");

    assert!(store.seed_default_rules_once().unwrap(), "first call seeds");
    let seeded = store.list_rules().unwrap().len();
    assert_eq!(seeded, RuleSet::seeded().len());

    assert!(!store.seed_default_rules_once().unwrap(), "second call is a no-op");
    assert_eq!(store.list_rules().unwrap().len(), seeded);
}

#[test]
fn seed_default_rules_once_does_not_bring_defaults_back_after_the_user_deletes_them_all() {
    let store = Store::open_in_memory().unwrap();
    store.seed_default_rules_once().unwrap();
    for pattern in rule_patterns(&store) {
        store.delete_rule(&pattern).unwrap();
    }

    assert!(!store.seed_default_rules_once().unwrap());

    assert!(store.list_rules().unwrap().is_empty(), "deleting every rule must stick");
}

#[test]
fn seed_default_rules_once_leaves_a_store_that_already_has_rules_alone() {
    // An existing database from before this flag existed: it already has
    // learned rules (and lost the in-memory starter set the moment its
    // first rule was saved). Seeding defaults now would surprise it.
    let store = Store::open_in_memory().unwrap();
    store.upsert_rule("Ferrywood Coffee", "Dining Out").unwrap();

    assert!(!store.seed_default_rules_once().unwrap());

    assert_eq!(rule_patterns(&store), vec!["Ferrywood Coffee".to_string()]);
}

#[test]
fn list_rules_reports_how_many_transactions_each_pattern_matches() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-01", "Ferrywood Coffee #12", "-4.00"),
                tx("2026-08-02", "FERRYWOOD COFFEE #40", "-5.00"),
                tx("2026-08-03", "Green Leaf Grocers", "-30.00"),
            ],
        )
        .unwrap();
    store.upsert_rule("ferrywood coffee", "Dining Out").unwrap();
    store.upsert_rule("payroll", "Income").unwrap();

    let rules = store.list_rules().unwrap();

    let coffee = rules.iter().find(|r| r.pattern == "ferrywood coffee").unwrap();
    assert_eq!(coffee.match_count, 2, "matching is case-insensitive substring, like RuleSet::categorize");
    assert_eq!(rules.iter().find(|r| r.pattern == "payroll").unwrap().match_count, 0);
}

#[test]
fn a_rules_match_count_and_preview_agree_with_how_the_categorizer_matches() {
    // Learned from one store number, the rule categorizes every store; the rules manager's count and
    // the "would change" preview must say the same, not just count exact-substring matches.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-01", "SPEEDWAY 44289", "-40.00"),
                tx("2026-08-02", "SPEEDWAY 51230", "-35.00"),
                tx("2026-08-03", "Shell", "-20.00"),
            ],
        )
        .unwrap();
    store.upsert_rule("SPEEDWAY 44289", "Gas").unwrap();

    let listed = store.list_rules().unwrap();
    assert_eq!(listed.iter().find(|r| r.pattern == "SPEEDWAY 44289").unwrap().match_count, 2);
    let preview = store.preview_rule("SPEEDWAY 44289", "Gas", None).unwrap();
    assert_eq!((preview.matching, preview.would_change), (2, 2));
    assert!(store.load_rules().unwrap().categorize("SPEEDWAY 51230").is_some());
}

#[test]
fn delete_rule_removes_it_case_insensitively_and_leaves_the_others() {
    let store = Store::open_in_memory().unwrap();
    store.upsert_rule("Ferrywood Coffee", "Dining Out").unwrap();
    store.upsert_rule("payroll", "Income").unwrap();

    store.delete_rule("ferrywood COFFEE").unwrap();

    assert_eq!(rule_patterns(&store), vec!["payroll".to_string()]);
    store.delete_rule("never existed").unwrap(); // harmless no-op
}

#[test]
fn rename_rule_can_change_both_the_pattern_and_the_category_in_one_step() {
    let store = Store::open_in_memory().unwrap();
    store.upsert_rule("ferrywood", "Dining Out").unwrap();

    store.rename_rule("ferrywood", "ferrywood coffee", "Coffee").unwrap();

    let rules = store.list_rules().unwrap();
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].pattern, "ferrywood coffee");
    assert_eq!(rules[0].category, "Coffee");
}

#[test]
fn preview_rule_counts_only_transactions_the_rule_would_actually_change() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-01", "Ferrywood Coffee #1", "-4.00"), // uncategorized -> would change
                tx("2026-08-02", "Ferrywood Coffee #2", "-4.00"), // guessed by the classifier -> would change
                tx("2026-08-03", "Ferrywood Coffee #3", "-4.00"), // you set it yourself -> never touched
                tx("2026-08-04", "Ferrywood Coffee #4", "-4.00"), // already Dining Out -> nothing to change
                tx("2026-08-05", "Green Leaf Grocers", "-30.00"), // doesn't match
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    store.set_category(ids[1], "Groceries", CategorySource::Classifier, Some(0.6)).unwrap();
    store.set_category(ids[2], "Groceries", CategorySource::User, None).unwrap();
    store.set_category(ids[3], "Dining Out", CategorySource::Rule, None).unwrap();

    let preview = store.preview_rule("ferrywood coffee", "Dining Out", None).unwrap();

    assert_eq!(preview.matching, 4);
    assert_eq!(preview.would_change, 2);
}

#[test]
fn preview_rule_leaves_transactions_a_more_specific_rule_already_owns() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-01", "Ferrywood Coffee", "-4.00"),
                tx("2026-08-02", "Corner Coffee Cart", "-3.00"),
            ],
        )
        .unwrap();
    store.upsert_rule("ferrywood coffee", "Groceries").unwrap(); // longer = wins for the first row

    let preview = store.preview_rule("coffee", "Dining Out", None).unwrap();

    assert_eq!(preview.matching, 2);
    assert_eq!(preview.would_change, 1, "the Ferrywood row belongs to its own, more specific rule");
}

#[test]
fn preview_rule_ignores_deleted_transactions_and_an_empty_pattern() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-01", "Ferrywood Coffee", "-4.00")])
        .unwrap();
    let id = store.all_transactions().unwrap()[0].id;
    store.delete_transaction(id, "2026-08-02T00:00:00".parse().unwrap()).unwrap();

    assert_eq!(store.preview_rule("ferrywood", "Dining Out", None).unwrap().would_change, 0);
    let empty = store.preview_rule("   ", "Dining Out", None).unwrap();
    assert_eq!(
        (empty.matching, empty.would_change),
        (0, 0),
        "a blank pattern would match everything -- treat it as nothing"
    );
}

#[test]
fn preview_rule_when_editing_ignores_the_rule_being_replaced() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-01", "Ferrywood Coffee", "-4.00")])
        .unwrap();
    // The old rule is *longer*, so left in place it would shadow the edited one.
    store.upsert_rule("ferrywood coffee", "Groceries").unwrap();

    let preview = store.preview_rule("ferrywood", "Dining Out", Some("ferrywood coffee")).unwrap();

    assert_eq!(preview.would_change, 1);
}

#[test]
fn apply_rule_to_existing_recategorizes_the_previewed_transactions_as_rule_sourced() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-01", "Ferrywood Coffee #1", "-4.00"),
                tx("2026-08-02", "Ferrywood Coffee #2", "-4.00"),
                tx("2026-08-03", "Ferrywood Coffee #3", "-4.00"),
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    store.set_category(ids[2], "Groceries", CategorySource::User, None).unwrap();
    store.upsert_rule("ferrywood coffee", "Dining Out").unwrap();

    let changed = store.apply_rule_to_existing("ferrywood coffee", "Dining Out").unwrap();

    assert_eq!(changed, 2);
    let all = store.all_transactions().unwrap();
    let by_id = |id: i64| all.iter().find(|t| t.id == id).unwrap();
    assert_eq!(by_id(ids[0]).transaction.category.as_deref(), Some("Dining Out"));
    assert_eq!(by_id(ids[0]).category_source, Some(CategorySource::Rule));
    assert_eq!(
        by_id(ids[2]).transaction.category.as_deref(),
        Some("Groceries"),
        "your own choice is never overwritten"
    );
}
