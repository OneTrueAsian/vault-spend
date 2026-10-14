use super::*;

// The import review screen sends one choice per unfamiliar file category, keyed by the
// file's name for it. This is the exact shape the frontend (`CategoryChoice` in
// ImportCategoryReconcile.tsx) produces.
#[test]
fn the_review_screens_category_choices_are_read_as_sent() {
    let sent = r#"{
            "Dining": { "action": "map_to", "category": "Dining Out" },
            "Pet Care": { "action": "create" },
            "Merchandise": { "action": "skip" }
        }"#;

    let mut choices: std::collections::HashMap<String, CategoryChoiceDto> = serde_json::from_str(sent).unwrap();

    assert_eq!(
        ImportCategoryChoice::from(choices.remove("Dining").unwrap()),
        ImportCategoryChoice::MapTo("Dining Out".to_string())
    );
    assert_eq!(
        ImportCategoryChoice::from(choices.remove("Pet Care").unwrap()),
        ImportCategoryChoice::Create
    );
    assert_eq!(
        ImportCategoryChoice::from(choices.remove("Merchandise").unwrap()),
        ImportCategoryChoice::Skip
    );
}

#[test]
fn a_choice_with_an_unknown_action_is_refused_rather_than_guessed() {
    let result: Result<std::collections::HashMap<String, CategoryChoiceDto>, _> = serde_json::from_str(r#"{"Dining": {"action": "adopt"}}"#);
    assert!(result.is_err());
}

// ---- import review: what the screen is told about each row (2026-10-04) ----

/// A fresh profile in its own temp folder, with an import file holding `csv`.
fn import_fixture(name: &str, csv: &str) -> (AppState, std::path::PathBuf, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("vaultspend-import-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let state = AppState::open(dir.join("profile.db")).unwrap();
    let file = dir.join("bank.csv");
    std::fs::write(&file, csv).unwrap();
    (state, file, dir)
}

fn checking(state: &AppState) -> i64 {
    state.store.get_or_create_account("Everyday Checking", AccountType::Checking).unwrap()
}

const BANK_CSV: &str = "Date,Description,Amount,Category\n\
        2026-01-05,SUNNY MARKET,-20.00,groceries\n\
        2026-01-06,HOMEGOODS 123,-45.00,Merchandise\n\
        2026-01-07,ZZQX UNKNOWABLE,-9.99,\n";

#[test]
fn the_preview_tells_the_screen_each_rows_match_guess_and_remembered_choice() {
    let (mut state, file, dir) = import_fixture("preview-facts", BANK_CSV);
    state.store.create_category("Groceries", None).unwrap();
    state.store.create_category("Shopping", None).unwrap();
    state.store.set_import_category_mapping("MERCHANDISE", "Shopping").unwrap();
    let account = checking(&state);

    let preview = preview_import_for(&mut state, file.to_str().unwrap(), false, account, None, None).unwrap();

    assert_eq!(preview.rows[0].matched_category.as_deref(), Some("Groceries"));
    assert!(preview.rows[0].suggestion.is_none());
    assert_eq!(preview.rows[1].matched_category, None);
    assert_eq!(preview.unmatched_categories.len(), 1);
    assert_eq!(preview.unmatched_categories[0].remembered_category.as_deref(), Some("Shopping"));
    assert_eq!(preview.rows[2].matched_category, None);
    assert_eq!(preview.choice_below, budget_core::import_resolution::IMPORT_CHOICE_BELOW);
    assert_eq!(preview.review_token.len(), 64);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_rule_suggestion_reaches_the_screen_as_rule_and_a_classifier_one_as_guess() {
    let rule = SuggestionDto::from(budget_core::import_resolution::Suggestion {
        category: "Dining".into(),
        source: CategorySource::Rule,
        confidence: None,
    });
    let guess = SuggestionDto::from(budget_core::import_resolution::Suggestion {
        category: "Dining".into(),
        source: CategorySource::Classifier,
        confidence: Some(0.42),
    });
    let rule = serde_json::to_value(rule).unwrap();
    let guess = serde_json::to_value(guess).unwrap();
    assert_eq!(rule, serde_json::json!({"category": "Dining", "source": "rule", "confidence": null}));
    assert_eq!(guess, serde_json::json!({"category": "Dining", "source": "guess", "confidence": 0.42}));
}

#[test]
fn previewing_an_import_changes_nothing() {
    let (mut state, file, dir) = import_fixture("preview-read-only", BANK_CSV);
    state.store.create_category("Groceries", None).unwrap();
    let account = checking(&state);
    let categories_before = state.store.list_categories().unwrap();
    let today = chrono::Local::now().date_naive();
    let accounts_before = state.store.list_accounts(today).unwrap().len();
    let rules_before = format!("{:?}", state.store.load_rules().unwrap());

    preview_import_for(&mut state, file.to_str().unwrap(), true, account, None, None).unwrap();

    assert_eq!(state.store.list_categories().unwrap(), categories_before);
    assert_eq!(state.store.list_accounts(today).unwrap().len(), accounts_before);
    assert_eq!(format!("{:?}", state.store.load_rules().unwrap()), rules_before);
    assert!(state.store.import_category_mappings().unwrap().is_empty());
    assert!(state.store.all_transactions().unwrap().is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_review_token_changes_when_the_file_changes() {
    let (mut state, file, dir) = import_fixture("preview-token", BANK_CSV);
    let account = checking(&state);
    let first = preview_import_for(&mut state, file.to_str().unwrap(), false, account, None, None)
        .unwrap()
        .review_token;
    let again = preview_import_for(&mut state, file.to_str().unwrap(), false, account, None, None)
        .unwrap()
        .review_token;
    assert_eq!(first, again);
    std::fs::write(&file, BANK_CSV.replace("SUNNY MARKET", "SUNNY MART")).unwrap();
    let changed = preview_import_for(&mut state, file.to_str().unwrap(), false, account, None, None)
        .unwrap()
        .review_token;
    assert_ne!(first, changed);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---- import commit: every row settled, all or nothing (2026-10-04) ----

// Nonsense merchants, so no starter rule guesses them and a fresh profile has no history.
const REVIEW_CSV: &str = "Date,Description,Amount,Category\n\
        2026-01-05,QQXZ MARKET,-20.00,groceries\n\
        2026-01-06,QQXZ HOMEGOODS,-45.00,Merchandise\n\
        2026-01-07,QQXZ UNKNOWABLE,-9.99,\n";

fn review_state(name: &str, csv: &str) -> (AppState, std::path::PathBuf, std::path::PathBuf, i64) {
    let (state, file, dir) = import_fixture(name, csv);
    for c in ["Groceries", "Shopping", "Home", "Dining"] {
        state.store.create_category(c, None).unwrap();
    }
    let account = checking(&state);
    (state, file, dir, account)
}

fn panel(entries: &[(&str, &str)]) -> Option<std::collections::HashMap<String, CategoryChoiceDto>> {
    let json = serde_json::Value::Object(
        entries
            .iter()
            .map(|(name, choice)| {
                let v = match *choice {
                    "skip" => serde_json::json!({"action": "skip"}),
                    "create" => serde_json::json!({"action": "create"}),
                    target => serde_json::json!({"action": "map_to", "category": target}),
                };
                (name.to_string(), v)
            })
            .collect(),
    );
    Some(serde_json::from_value(json).unwrap())
}

fn picks(entries: &[(usize, Option<&str>)]) -> std::collections::HashMap<usize, Option<String>> {
    entries.iter().map(|(i, c)| (*i, c.map(str::to_string))).collect()
}

fn request(
    state: &mut AppState,
    file: &std::path::Path,
    account: i64,
    included: &[usize],
    category_choices: Option<std::collections::HashMap<String, CategoryChoiceDto>>,
    row_choices: std::collections::HashMap<usize, Option<String>>,
) -> CommitImportRequest {
    let review_token = preview_import_for(state, file.to_str().unwrap(), false, account, None, None)
        .unwrap()
        .review_token;
    CommitImportRequest {
        path: file.to_str().unwrap().to_string(),
        invert_amounts: false,
        default_account_id: account,
        review_token,
        included_indices: included.to_vec(),
        account_overrides: std::collections::HashMap::new(),
        category_choices,
        row_choices,
        column_map: None,
        column_headers: None,
    }
}

/// Everything an import could change, so a refusal can be shown to change none of it.
fn everything(state: &AppState) -> String {
    format!(
        "{:?}|{:?}|{:?}|{:?}|{}|{}",
        state.store.list_categories().unwrap(),
        state
            .store
            .import_category_mappings()
            .unwrap()
            .into_iter()
            .collect::<std::collections::BTreeMap<_, _>>(),
        state.store.load_rules().unwrap(),
        state.rules,
        state.store.list_accounts(chrono::Local::now().date_naive()).unwrap().len(),
        state.store.all_transactions().unwrap().len(),
    )
}

fn category_of(state: &AppState, id: i64) -> (Option<String>, Option<CategorySource>) {
    let t = state.store.transactions_by_ids(&[id]).unwrap().remove(0);
    (t.transaction.category, t.category_source)
}

#[test]
fn an_import_with_a_row_still_needing_a_choice_is_refused_and_writes_nothing() {
    let (mut state, file, dir, account) = review_state("commit-unsettled", REVIEW_CSV);
    let before = everything(&state);
    let req = request(&mut state, &file, account, &[0, 1, 2], panel(&[("Merchandise", "skip")]), picks(&[]));
    let err = commit_import_for(&mut state, req).unwrap_err();
    assert!(err.contains("Choose a category"), "got {err}");
    assert_eq!(everything(&state), before);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_import_whose_file_changed_after_review_is_refused() {
    let (mut state, file, dir, account) = review_state("commit-changed", REVIEW_CSV);
    let req = request(&mut state, &file, account, &[0, 2], None, picks(&[(2, None)]));
    std::fs::write(&file, REVIEW_CSV.replace("QQXZ MARKET", "QQXZ MART")).unwrap();
    let before = everything(&state);
    let err = commit_import_for(&mut state, req).unwrap_err();
    assert_eq!(err, "This file changed. Review it again before importing.");
    assert_eq!(everything(&state), before);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_import_naming_a_row_or_account_that_does_not_exist_is_refused() {
    let (mut state, file, dir, account) = review_state("commit-bad-index", REVIEW_CSV);
    let before = everything(&state);
    let req = request(&mut state, &file, account, &[0, 7], None, picks(&[]));
    assert!(commit_import_for(&mut state, req).is_err());
    let mut req = request(&mut state, &file, account, &[0], None, picks(&[]));
    req.account_overrides.insert(0, account + 999);
    assert!(commit_import_for(&mut state, req).is_err());
    assert_eq!(everything(&state), before);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_import_choosing_a_category_the_person_does_not_have_is_refused() {
    let (mut state, file, dir, account) = review_state("commit-unknown-pick", REVIEW_CSV);
    let before = everything(&state);
    let req = request(&mut state, &file, account, &[2], None, picks(&[(2, Some("Nope"))]));
    let err = commit_import_for(&mut state, req).unwrap_err();
    assert!(err.contains("Nope"), "got {err}");
    assert_eq!(everything(&state), before);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_choice_sent_for_a_row_that_did_not_need_one_is_refused() {
    // Row 0's file category matches Groceries, so a leftover pick for it must not override that.
    let (mut state, file, dir, account) = review_state("commit-stale-pick", REVIEW_CSV);
    let before = everything(&state);
    let req = request(&mut state, &file, account, &[0, 2], None, picks(&[(0, Some("Dining")), (2, None)]));
    assert!(commit_import_for(&mut state, req).is_err());
    assert_eq!(everything(&state), before);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn two_choices_for_one_file_category_under_different_casing_are_refused() {
    let (mut state, file, dir, account) = review_state("commit-conflict", REVIEW_CSV);
    let before = everything(&state);
    let req = request(
        &mut state,
        &file,
        account,
        &[1],
        panel(&[("Merchandise", "skip"), ("MERCHANDISE", "create")]),
        picks(&[(1, None)]),
    );
    assert!(commit_import_for(&mut state, req).is_err());
    assert_eq!(everything(&state), before);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_settled_import_saves_every_row_remembers_the_mapping_and_learns_the_pick() {
    let (mut state, file, dir, account) = review_state("commit-success", REVIEW_CSV);
    let req = request(
        &mut state,
        &file,
        account,
        &[0, 1, 2],
        panel(&[("Merchandise", "Shopping")]),
        picks(&[(2, Some("dining"))]),
    );
    let summary = commit_import_for(&mut state, req).unwrap();

    assert_eq!(summary.inserted, 3);
    let ids = &summary.inserted_ids;
    assert_eq!(category_of(&state, ids[0]), (Some("Groceries".into()), None));
    assert_eq!(category_of(&state, ids[1]), (Some("Shopping".into()), None));
    assert_eq!(category_of(&state, ids[2]), (Some("Dining".into()), Some(CategorySource::User)));
    assert_eq!(state.rules.categorize("QQXZ UNKNOWABLE").as_deref(), Some("Dining"), "taught in memory");
    assert_eq!(
        state.store.import_category_mappings().unwrap().get("merchandise").map(String::as_str),
        Some("Shopping")
    );

    // and it all survives a restart
    drop(state);
    let reopened = AppState::open(dir.join("profile.db")).unwrap();
    assert_eq!(reopened.rules.categorize("QQXZ UNKNOWABLE").as_deref(), Some("Dining"));
    assert_eq!(
        reopened.store.import_category_mappings().unwrap().get("merchandise").map(String::as_str),
        Some("Shopping")
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_row_left_uncategorized_stays_that_way_even_when_the_same_import_teaches_a_matching_rule() {
    let csv = "Date,Description,Amount\n\
            2026-01-05,QQXZ PIZZA,-20.00\n\
            2026-01-06,QQXZ PIZZA,-21.00\n";
    let (mut state, file, dir, account) = review_state("commit-leave", csv);
    // An older uncategorized row from before this import still gets the usual pass afterwards.
    state
        .store
        .save_transactions(
            account,
            &[budget_core::models::Transaction {
                date: chrono::NaiveDate::from_ymd_opt(2025, 12, 1).unwrap(),
                description: "QQXZ PIZZA OLD".into(),
                amount: rust_decimal::Decimal::new(-500, 2),
                category: None,
            }],
        )
        .unwrap();
    let req = request(&mut state, &file, account, &[0, 1], None, picks(&[(0, Some("Dining")), (1, None)]));
    let summary = commit_import_for(&mut state, req).unwrap();

    assert_eq!(category_of(&state, summary.inserted_ids[0]).0.as_deref(), Some("Dining"));
    assert_eq!(category_of(&state, summary.inserted_ids[1]), (None, None));
    let old = state
        .store
        .all_transactions()
        .unwrap()
        .into_iter()
        .find(|t| t.transaction.description == "QQXZ PIZZA OLD")
        .unwrap();
    assert_eq!(old.transaction.category.as_deref(), Some("Dining"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn letting_the_app_guess_forgets_a_remembered_mapping() {
    let (mut state, file, dir, account) = review_state("commit-forget", REVIEW_CSV);
    state.store.set_import_category_mapping("Merchandise", "Shopping").unwrap();
    let req = request(&mut state, &file, account, &[1], panel(&[("Merchandise", "skip")]), picks(&[(1, None)]));
    commit_import_for(&mut state, req).unwrap();
    assert!(state.store.import_category_mappings().unwrap().is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_choice_for_a_file_category_only_unchecked_rows_use_changes_no_memory() {
    let (mut state, file, dir, account) = review_state("commit-excluded", REVIEW_CSV);
    state.store.set_import_category_mapping("Merchandise", "Shopping").unwrap();
    let req = request(&mut state, &file, account, &[0], panel(&[("Merchandise", "Home")]), picks(&[]));
    commit_import_for(&mut state, req).unwrap();
    assert_eq!(
        state.store.import_category_mappings().unwrap().get("merchandise").map(String::as_str),
        Some("Shopping")
    );
    let _ = std::fs::remove_dir_all(&dir);
}

// ---- what the old reconcile_import_categories tests covered, on the commit path ----

const CASINGS_CSV: &str = "Date,Description,Amount,Category\n\
        2026-01-05,QQXZ A,-1.00,Pet Care\n\
        2026-01-06,QQXZ B,-2.00,pet care\n\
        2026-01-07,QQXZ C,-3.00,GROCERIES\n\
        2026-01-08,QQXZ D,-4.00,groceries\n";

#[test]
fn an_import_never_adds_a_category_unless_told_to() {
    let (mut state, file, dir, account) = review_state("commit-no-adopt", CASINGS_CSV);
    let before = state.store.list_categories().unwrap();
    let req = request(
        &mut state,
        &file,
        account,
        &[0, 1, 2, 3],
        panel(&[("Pet Care", "skip")]),
        picks(&[(0, None), (1, None)]),
    );
    commit_import_for(&mut state, req).unwrap();
    assert_eq!(state.store.list_categories().unwrap(), before);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn every_casing_of_a_matching_file_category_uses_the_persons_spelling() {
    let (mut state, file, dir, account) = review_state("commit-spelling", CASINGS_CSV);
    let req = request(&mut state, &file, account, &[2, 3], None, picks(&[]));
    let summary = commit_import_for(&mut state, req).unwrap();
    for id in &summary.inserted_ids {
        assert_eq!(category_of(&state, *id).0.as_deref(), Some("Groceries"));
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn adding_a_file_category_adds_it_once_for_every_casing() {
    let (mut state, file, dir, account) = review_state("commit-create-once", CASINGS_CSV);
    let req = request(&mut state, &file, account, &[0, 1], panel(&[("Pet Care", "create")]), picks(&[]));
    let summary = commit_import_for(&mut state, req).unwrap();
    for id in &summary.inserted_ids {
        assert_eq!(category_of(&state, *id).0.as_deref(), Some("Pet Care"));
    }
    let pet_care = state
        .store
        .list_categories()
        .unwrap()
        .into_iter()
        .filter(|c| c.eq_ignore_ascii_case("pet care"))
        .count();
    assert_eq!(pet_care, 1);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn mapping_every_casing_of_a_file_category_creates_nothing() {
    let (mut state, file, dir, account) = review_state("commit-map-casings", CASINGS_CSV);
    let before = state.store.list_categories().unwrap();
    let req = request(&mut state, &file, account, &[0, 1], panel(&[("Pet Care", "Home")]), picks(&[]));
    let summary = commit_import_for(&mut state, req).unwrap();
    for id in &summary.inserted_ids {
        assert_eq!(category_of(&state, *id).0.as_deref(), Some("Home"));
    }
    assert_eq!(state.store.list_categories().unwrap(), before);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn mapping_to_a_category_that_does_not_exist_is_refused_and_writes_nothing() {
    let (mut state, file, dir, account) = review_state("commit-map-missing", CASINGS_CSV);
    let before = everything(&state);
    let req = request(&mut state, &file, account, &[0, 1], panel(&[("Pet Care", "Nope")]), picks(&[]));
    let err = commit_import_for(&mut state, req).unwrap_err();
    assert!(err.contains("Nope"), "got {err}");
    assert_eq!(everything(&state), before);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---- the import decides from what the review showed (2026-10-04) ----

#[test]
fn a_rule_learned_while_the_review_is_open_does_not_overrule_the_screen() {
    // Row 2 needed a choice when previewed. A rule learned elsewhere in the app before Import is
    // pressed must not turn the person's pick into a "stale" refusal: the import settles rows
    // the way the screen showed them.
    let (mut state, file, dir, account) = review_state("commit-cached-facts", REVIEW_CSV);
    let req = request(&mut state, &file, account, &[2], None, picks(&[(2, Some("Dining"))]));
    state.store.upsert_rule("QQXZ UNKNOWABLE", "Home").unwrap();
    state.rules = state.store.load_rules().unwrap();
    let summary = commit_import_for(&mut state, req).unwrap();
    assert_eq!(
        category_of(&state, summary.inserted_ids[0]),
        (Some("Dining".into()), Some(CategorySource::User))
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_preview_is_remembered_by_its_review_token_and_cleared_by_a_successful_import() {
    let (mut state, file, dir, account) = review_state("commit-cache-life", REVIEW_CSV);
    let req = request(&mut state, &file, account, &[0], None, picks(&[]));
    assert_eq!(state.import_review.as_ref().map(|r| r.token.as_str()), Some(req.review_token.as_str()));
    commit_import_for(&mut state, req).unwrap();
    assert!(state.import_review.is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_failed_import_keeps_the_preview_for_a_retry() {
    let (mut state, file, dir, account) = review_state("commit-cache-retry", REVIEW_CSV);
    let req = request(&mut state, &file, account, &[2], None, picks(&[(2, Some("Nope"))]));
    let token = req.review_token.clone();
    assert!(commit_import_for(&mut state, req).is_err());
    assert_eq!(state.import_review.as_ref().map(|r| r.token.as_str()), Some(token.as_str()));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn without_a_remembered_preview_the_import_works_the_rows_out_again() {
    let (mut state, file, dir, account) = review_state("commit-no-cache", REVIEW_CSV);
    let req = request(&mut state, &file, account, &[0, 2], None, picks(&[(2, None)]));
    state.import_review = None;
    let summary = commit_import_for(&mut state, req).unwrap();
    assert_eq!(summary.inserted, 2);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_category_deleted_while_the_review_is_open_refuses_the_import_and_names_it() {
    let (mut state, file, dir, account) = review_state("commit-deleted-category", REVIEW_CSV);
    let before_rows = state.store.all_transactions().unwrap().len();
    let req = request(&mut state, &file, account, &[0], None, picks(&[]));
    state.store.delete_category("Groceries").unwrap();
    let err = commit_import_for(&mut state, req).unwrap_err();
    assert!(err.contains("Groceries"), "got {err}");
    assert_eq!(state.store.all_transactions().unwrap().len(), before_rows);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn adding_a_file_category_files_its_rows_under_it() {
    let (mut state, file, dir, account) = review_state("commit-create", REVIEW_CSV);
    let req = request(&mut state, &file, account, &[1], panel(&[("Merchandise", "create")]), picks(&[]));
    let summary = commit_import_for(&mut state, req).unwrap();
    assert_eq!(category_of(&state, summary.inserted_ids[0]).0.as_deref(), Some("Merchandise"));
    assert!(state.store.import_category_mappings().unwrap().is_empty(), "adding needs no memory");
    let _ = std::fs::remove_dir_all(&dir);
}

// ---- matching an unfamiliar file's columns (2026-10-13) ----

const ODD_CSV: &str = "Posted,Memo,Amt\n\
        2026-01-05,SUNNY MARKET,-20.00\n\
        2026-01-06,HOMEGOODS 123,-45.00\n\
        2026-01-07,GAS STATION,-30.00\n\
        2026-01-08,COFFEE,-4.50\n\
        2026-01-09,BOOKS,-12.00\n\
        2026-01-10,PHARMACY,-8.25\n\
        2026-01-11,PARKING,-3.00\n";

fn odd_map() -> budget_core::csv_loader::ColumnMap {
    budget_core::csv_loader::ColumnMap {
        date: 0,
        description: 1,
        amount: budget_core::csv_loader::AmountColumns::Single { column: 2 },
        category: None,
    }
}

fn odd_names() -> budget_core::csv_loader::ColumnNames {
    budget_core::csv_loader::ColumnNames {
        date: "Posted".to_string(),
        description: "Memo".to_string(),
        amount: budget_core::csv_loader::AmountNames::Single { column: "Amt".to_string() },
        category: None,
    }
}

#[test]
fn inspect_reports_ok_for_a_recognised_csv() {
    let (state, file, dir, account) = review_state("inspect-ok", BANK_CSV);
    let dto = inspect_import_columns_for(&state, file.to_str().unwrap(), account).unwrap();
    assert_eq!(dto.status, "ok");
    assert!(dto.map.is_none());
    assert!(dto.missing.is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn inspect_reports_needs_mapping_for_unknown_headers() {
    let (state, file, dir, account) = review_state("inspect-needs", ODD_CSV);
    let dto = inspect_import_columns_for(&state, file.to_str().unwrap(), account).unwrap();
    assert_eq!(dto.status, "needs_mapping");
    assert_eq!(dto.headers, vec!["Posted", "Memo", "Amt"]);
    // "Posted" is not a header the importer recognises as the date either.
    assert_eq!(dto.missing, vec!["date", "description", "amount"]);
    assert_eq!(dto.sample_rows.len(), 5);
    assert!(dto.map.is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn inspect_applies_a_saved_choice_when_the_headers_still_match() {
    let (state, file, dir, account) = review_state("inspect-saved", ODD_CSV);
    state.store.set_account_import_columns(account, &odd_names()).unwrap();
    let dto = inspect_import_columns_for(&state, file.to_str().unwrap(), account).unwrap();
    assert_eq!(dto.status, "saved");
    assert_eq!(dto.map, Some(odd_map()));

    let renamed = ODD_CSV.replace("Amt", "Total");
    std::fs::write(&file, renamed).unwrap();
    let dto = inspect_import_columns_for(&state, file.to_str().unwrap(), account).unwrap();
    assert_eq!(dto.status, "needs_mapping");
    assert!(dto.map.is_none());
    // The remembered names that are still in the file start the picker; the renamed one is left open.
    assert_eq!(dto.guess.date, Some(0));
    assert_eq!(dto.guess.description, Some(1));
    assert_eq!(dto.guess.amount, None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn inspect_prefills_only_the_kind_of_amount_that_was_remembered() {
    use budget_core::csv_loader::{AmountNames, ColumnNames};
    // A file with a header the importer itself would guess as "Amount" next to the renamed ones.
    let csv = "Posted,Memo,Amount,Out,In\n2026-01-05,SUNNY MARKET,-20.00,20.00,\n";
    let (state, file, dir, account) = review_state("inspect-kind", csv);
    let names = |amount| ColumnNames {
        date: "Posted".to_string(),
        description: "Notes".to_string(),
        amount,
        category: None,
    };

    state
        .store
        .set_account_import_columns(
            account,
            &names(AmountNames::DebitCredit {
                debit: "Out".to_string(),
                credit: "In".to_string(),
            }),
        )
        .unwrap();
    let dto = inspect_import_columns_for(&state, file.to_str().unwrap(), account).unwrap();
    assert_eq!(dto.status, "needs_mapping");
    assert_eq!((dto.guess.debit, dto.guess.credit), (Some(3), Some(4)));
    assert_eq!(
        dto.guess.amount, None,
        "a remembered debit/credit choice does not pre-fill a single amount"
    );

    state
        .store
        .set_account_import_columns(
            account,
            &names(AmountNames::Single {
                column: "Amount".to_string(),
            }),
        )
        .unwrap();
    let dto = inspect_import_columns_for(&state, file.to_str().unwrap(), account).unwrap();
    assert_eq!(dto.guess.amount, Some(2));
    assert_eq!(
        (dto.guess.debit, dto.guess.credit),
        (None, None),
        "a remembered single choice does not pre-fill debit/credit"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn inspect_treats_other_file_types_as_ok() {
    let (state, _csv, dir, account) = review_state("inspect-ofx", "Date,Description,Amount\n");
    let ofx = dir.join("bank.ofx");
    std::fs::write(&ofx, "not read at all").unwrap();
    let dto = inspect_import_columns_for(&state, ofx.to_str().unwrap(), account).unwrap();
    assert_eq!(dto.status, "ok");
    assert!(dto.map.is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

fn mapped_request(state: &mut AppState, file: &std::path::Path, account: i64) -> CommitImportRequest {
    let map = odd_map();
    let review_token = preview_import_for(state, file.to_str().unwrap(), false, account, Some(&map), None)
        .unwrap()
        .review_token;
    CommitImportRequest {
        path: file.to_str().unwrap().to_string(),
        invert_amounts: false,
        default_account_id: account,
        review_token,
        included_indices: vec![0, 1],
        account_overrides: std::collections::HashMap::new(),
        category_choices: None,
        row_choices: picks(&[(1, None)]),
        column_map: Some(map),
        column_headers: None,
    }
}

#[test]
fn preview_and_commit_with_the_same_map_agree_on_the_review_token() {
    let (mut state, file, dir, account) = review_state("map-token", ODD_CSV);
    let req = mapped_request(&mut state, &file, account);
    let summary = commit_import_for(&mut state, req).unwrap();
    assert_eq!(summary.inserted, 2);

    let (mut state2, file2, dir2, account2) = review_state("map-token-none", ODD_CSV);
    let mut req = mapped_request(&mut state2, &file2, account2);
    req.column_map = None;
    assert!(commit_import_for(&mut state2, req).is_err());
    assert!(state2.store.all_transactions().unwrap().is_empty());
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&dir2);
}

#[test]
fn committing_with_a_map_saves_it_for_the_account() {
    let (mut state, file, dir, account) = review_state("map-save", ODD_CSV);
    let req = mapped_request(&mut state, &file, account);
    commit_import_for(&mut state, req).unwrap();
    assert_eq!(state.store.account_import_columns(account).unwrap(), Some(odd_names()));

    let (mut stale, file2, dir2, account2) = review_state("map-save-stale", ODD_CSV);
    let mut req = mapped_request(&mut stale, &file2, account2);
    req.review_token = "stale".to_string();
    assert!(commit_import_for(&mut stale, req).is_err());
    assert_eq!(stale.store.account_import_columns(account2).unwrap(), None);
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&dir2);
}

fn request_with_map(
    state: &mut AppState,
    file: &std::path::Path,
    account: i64,
    map: budget_core::csv_loader::ColumnMap,
    included: &[usize],
) -> CommitImportRequest {
    let review_token = preview_import_for(state, file.to_str().unwrap(), false, account, Some(&map), None)
        .unwrap()
        .review_token;
    CommitImportRequest {
        path: file.to_str().unwrap().to_string(),
        invert_amounts: false,
        default_account_id: account,
        review_token,
        included_indices: included.to_vec(),
        account_overrides: std::collections::HashMap::new(),
        category_choices: None,
        row_choices: picks(&[]),
        column_map: Some(map),
        column_headers: None,
    }
}

#[test]
fn a_mapped_file_with_an_account_column_imports_into_the_chosen_account() {
    let csv: String = ODD_CSV
        .lines()
        .enumerate()
        .map(|(i, line)| {
            format!(
                "{line},{}
",
                if i == 0 { "Account" } else { "XXXX1234" }
            )
        })
        .collect();
    let (mut state, file, dir, account) = review_state("map-account-column", &csv);
    let today = chrono::Local::now().date_naive();
    let accounts_before = state.store.list_accounts(today).unwrap().len();
    let loaded = budget_core::importer::load_transactions(&file, false, Some(&odd_map())).unwrap();
    assert!(loaded.account_names.iter().all(Option::is_none));
    let req = mapped_request(&mut state, &file, account);
    let summary = commit_import_for(&mut state, req).unwrap();
    assert_eq!(summary.inserted, 2);
    assert_eq!(
        state.store.list_accounts(today).unwrap().len(),
        accounts_before,
        "no account was created from the file's Account column"
    );
    assert!(state.store.all_transactions().unwrap().iter().all(|t| t.account_id == account));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_choice_made_from_other_headers_is_refused_on_preview_and_commit() {
    let (mut state, file, dir, account) = review_state("map-headers-changed", ODD_CSV);
    let chosen_from: Vec<String> = ["Posted", "Memo", "Amt"].iter().map(|h| h.to_string()).collect();
    let path = file.to_str().unwrap();
    // The same headers: fine.
    assert!(preview_import_for(&mut state, path, false, account, Some(&odd_map()), Some(&chosen_from)).is_ok());
    let mut req = request_with_map(&mut state, &file, account, odd_map(), &[0]);
    req.column_headers = Some(chosen_from.clone());
    req.row_choices = picks(&[(0, None)]);
    // The file's header row is edited after the choice was made.
    std::fs::write(&file, ODD_CSV.replace("Memo", "Details")).unwrap();
    let err = preview_import_for(&mut state, path, false, account, Some(&odd_map()), Some(&chosen_from))
        .err()
        .unwrap();
    assert_eq!(err, "This file changed. Start the import again.");
    let err = commit_import_for(&mut state, req).unwrap_err();
    assert_eq!(err, "This file changed. Start the import again.");
    assert!(state.store.all_transactions().unwrap().is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_header_check_ignores_a_bom_and_padding_but_not_a_real_difference() {
    let csv = "\u{feff}Posted ,Memo,Amt\n2026-01-05,SUNNY MARKET,-20.00\n";
    let (mut state, file, dir, account) = review_state("map-bom", csv);
    let path = file.to_str().unwrap();
    // What the screen sends: the headers inspection reported for this same file.
    let from_inspection = budget_core::csv_loader::inspect_csv(path).unwrap().headers;
    assert!(preview_import_for(&mut state, path, false, account, Some(&odd_map()), Some(&from_inspection)).is_ok());
    let different: Vec<String> = ["Posted", "Other", "Amt"].iter().map(|h| h.to_string()).collect();
    let err = preview_import_for(&mut state, path, false, account, Some(&odd_map()), Some(&different))
        .err()
        .unwrap();
    assert_eq!(err, "This file changed. Start the import again.");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn commit_remembers_the_choice_by_the_headers_of_the_file_it_loaded() {
    let (mut state, file, dir, account) = review_state("map-names-from-load", ODD_CSV);
    let mut req = mapped_request(&mut state, &file, account);
    req.column_headers = Some(["Posted", "Memo", "Amt"].iter().map(|h| h.to_string()).collect());
    commit_import_for(&mut state, req).unwrap();
    assert_eq!(state.store.account_import_columns(account).unwrap(), Some(odd_names()));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_map_that_reuses_a_column_is_refused_by_preview_and_commit() {
    let (mut state, file, dir, account) = review_state("map-reused-column", ODD_CSV);
    let map = budget_core::csv_loader::ColumnMap {
        date: 0,
        description: 0,
        amount: budget_core::csv_loader::AmountColumns::Single { column: 2 },
        category: None,
    };
    let err = preview_import_for(&mut state, file.to_str().unwrap(), false, account, Some(&map), None)
        .err()
        .unwrap();
    assert_eq!(err, "Pick a different column for each question.");
    let mut req = request_with_map(&mut state, &file, account, odd_map(), &[]);
    req.column_map = Some(map);
    assert_eq!(
        commit_import_for(&mut state, req).unwrap_err(),
        "Pick a different column for each question."
    );
    assert_eq!(state.store.account_import_columns(account).unwrap(), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_map_sent_with_an_ofx_file_imports_normally_and_saves_nothing() {
    let (mut state, _csv, dir, account) = review_state("map-ofx", ODD_CSV);
    let ofx = dir.join("bank.ofx");
    std::fs::write(
        &ofx,
        "<OFX>\n<BANKMSGSRSV1>\n<STMTTRNRS>\n<STMTRS>\n<BANKTRANLIST>\n<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20260105\n\
         <TRNAMT>-5.00\n<FITID>1\n<NAME>COFFEE\n</STMTTRN>\n</BANKTRANLIST>\n</STMTRS>\n</STMTTRNRS>\n</BANKMSGSRSV1>\n</OFX>\n",
    )
    .unwrap();
    let req = request_with_map(&mut state, &ofx, account, odd_map(), &[0]);
    let summary = commit_import_for(&mut state, req).unwrap();
    assert_eq!(summary.inserted, 1);
    assert_eq!(state.store.account_import_columns(account).unwrap(), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_map_whose_names_would_pick_another_column_saves_nothing_but_still_imports() {
    // Two columns are both called "Memo": the name alone would find the first, not the chosen one.
    let csv = "Posted,Memo,Amt,Memo\n2026-01-05,x,-20.00,SUNNY MARKET\n2026-01-06,y,-45.00,HOMEGOODS\n";
    let (mut state, file, dir, account) = review_state("map-dup", csv);
    let map = budget_core::csv_loader::ColumnMap {
        date: 0,
        description: 3,
        amount: budget_core::csv_loader::AmountColumns::Single { column: 2 },
        category: None,
    };
    let req = request_with_map(&mut state, &file, account, map, &[]);
    commit_import_for(&mut state, req).unwrap();
    assert_eq!(state.store.account_import_columns(account).unwrap(), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_map_pointing_past_the_end_of_the_file_is_a_plain_error_and_changes_nothing() {
    let (mut state, file, dir, account) = review_state("map-range", ODD_CSV);
    let map = budget_core::csv_loader::ColumnMap {
        date: 0,
        description: 1,
        amount: budget_core::csv_loader::AmountColumns::Single { column: 9 },
        category: None,
    };
    let path = file.to_str().unwrap();
    assert!(preview_import_for(&mut state, path, false, account, Some(&map), None).is_err());
    let mut req = request_with_map(&mut state, &file, account, odd_map(), &[]);
    req.column_map = Some(map);
    assert!(commit_import_for(&mut state, req).is_err());
    assert!(state.store.all_transactions().unwrap().is_empty());
    assert_eq!(state.store.account_import_columns(account).unwrap(), None);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_map_using_a_blank_header_still_imports_and_saves_nothing() {
    let csv = "Posted,,Amt\n2026-01-05,SUNNY MARKET,-20.00\n";
    let (mut state, file, dir, account) = review_state("map-blank", csv);
    let req = request_with_map(&mut state, &file, account, odd_map(), &[]);
    commit_import_for(&mut state, req).unwrap();
    assert_eq!(state.store.account_import_columns(account).unwrap(), None);
    let _ = std::fs::remove_dir_all(&dir);
}
