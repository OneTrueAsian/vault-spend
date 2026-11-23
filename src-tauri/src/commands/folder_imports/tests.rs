use super::*;
use budget_core::models::AccountType;
use budget_core::store::FolderImportMappingInput;

fn profile(name: &str) -> (AppState, i64, i64, i64) {
    let dir = std::env::temp_dir().join(format!("vaultspend-folder-cmd-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let state = AppState::open(dir.join("profile.db")).unwrap();
    let checking = state.store.get_or_create_account("Max Checking", AccountType::Checking).unwrap();
    let savings = state.store.get_or_create_account("Savings", AccountType::Savings).unwrap();
    let mapping = state
        .store
        .save_folder_import_mapping(&FolderImportMappingInput {
            id: None,
            account_id: checking,
            stem: "Bank Max Checking".to_string(),
            extensions: vec!["csv".to_string()],
            invert_amounts: true,
            initial_cutoff: None,
        })
        .unwrap();
    (state, checking, savings, mapping)
}

// A Plaid-style export: lowercase, reordered, extra metadata, an Account column naming another of
// the person's accounts, positive charges, and one row the bank still shows as pending.
const EXPORT: &str = "bank,transaction_id,date,account,description,amount,currency,pending\n\
Practice Bank,t1,2026-11-17,Savings,Corner Cafe,12.50,USD,false\n\
Practice Bank,t2,2026-11-18,Savings,Bravo Market,40.00,USD,true\n\
Practice Bank,t3,2026-11-18,Savings,Employer Payroll,-1500.00,USD,false\n";

fn stage(state: &AppState, checking: i64, mapping: i64, bytes: &str) -> i64 {
    match state
        .store
        .stage_folder_import(&StageInput {
            mapping_id: mapping,
            account_id: checking,
            file_name: "Bank Max Checking_2026-11-18.csv",
            digest: &discovery::digest(bytes.as_bytes()),
            content: bytes.as_bytes(),
            export_start: chrono::NaiveDate::from_ymd_opt(2026, 11, 18).unwrap(),
            export_end: chrono::NaiveDate::from_ymd_opt(2026, 11, 18).unwrap(),
            now: "2026-11-22T10:00:00",
        })
        .unwrap()
    {
        StageOutcome::Queued(id) => id,
        other => panic!("{other:?}"),
    }
}

/// "Leave uncategorized" for each included row the review would ask about (no file match and no sure guess).
fn choices_for(preview: &ImportPreview, included: &[usize]) -> HashMap<usize, Option<String>> {
    included
        .iter()
        .copied()
        .filter(|&i| {
            let row = &preview.rows[i];
            let sure = row.suggestion.as_ref().is_some_and(|s| match s.confidence {
                None => s.source == "rule",
                Some(c) => c >= preview.choice_below,
            });
            row.matched_category.is_none() && !sure
        })
        .map(|i| (i, None))
        .collect()
}

fn request(preview: &ImportPreview, included: Vec<usize>, invert: bool, checking: i64) -> CommitImportRequest {
    CommitImportRequest {
        path: String::new(),
        invert_amounts: invert,
        default_account_id: checking,
        review_token: preview.review_token.clone(),
        row_choices: choices_for(preview, &included),
        included_indices: included,
        account_overrides: HashMap::new(),
        category_choices: None,
        column_map: None,
        column_headers: None,
    }
}

#[test]
fn a_saved_export_previews_and_commits_into_its_mapped_account_with_its_receipt_and_watermark() {
    let (mut state, checking, _savings, mapping) = profile("commit");
    let id = stage(&state, checking, mapping, EXPORT);
    let bytes = state.store.folder_import_batch_content(id).unwrap().unwrap();
    let source = ImportSource::Saved {
        file_name: "Bank Max Checking_2026-11-18.csv",
        bytes: &bytes,
    };
    let preview = preview_source(&mut state, &source, true, checking, None, None).unwrap();
    assert_eq!(preview.rows.len(), 3);
    assert_eq!(preview.rows[0].amount, "-12.50", "the mapping's convention: a positive charge is money out");
    assert_eq!(preview.rows[2].amount, "1500.00");
    assert!(preview.rows.iter().all(|r| r.account_name.is_none()), "the file can't send rows to another account");
    assert_eq!(preview.rows.iter().map(|r| r.source_pending).collect::<Vec<_>>(), vec![false, true, false]);
    assert!(state.store.all_transactions().unwrap().is_empty(), "previewing writes nothing");

    let summary = commit_source(&mut state, &source, Some(StagedCommit { batch_id: id, row_version: 1 }), request(&preview, vec![0, 2], true, checking)).unwrap();
    assert_eq!(summary.inserted, 2);
    let rows = state.store.all_transactions().unwrap();
    assert!(rows.iter().all(|r| r.account_id == checking), "every row lands in the mapped account");
    let batch = state.store.folder_import_batch(id).unwrap().unwrap();
    assert_eq!(batch.status, BatchStatus::Imported);
    assert_eq!(
        state.store.folder_import_mapping(mapping).unwrap().unwrap().watermark.map(|d| d.to_string()),
        Some("2026-11-18".to_string())
    );
    let account = state.store.list_accounts(chrono::Local::now().date_naive()).unwrap().into_iter().find(|a| a.id == checking).unwrap();
    assert_eq!(account.import_flip_signs, None, "the folder convention isn't saved as the manual answer");
    let again = commit_source(
        &mut state,
        &source,
        Some(StagedCommit { batch_id: id, row_version: 1 }),
        request(&preview, vec![1], true, checking),
    );
    assert!(again.is_err(), "a finished export can't be approved twice");
    assert_eq!(state.store.all_transactions().unwrap().len(), 2);
}

#[test]
fn changing_the_amount_convention_needs_a_new_review_and_never_touches_imported_rows() {
    let (mut state, checking, _savings, mapping) = profile("flip");
    let id = stage(&state, checking, mapping, EXPORT);
    let bytes = state.store.folder_import_batch_content(id).unwrap().unwrap();
    let source = ImportSource::Saved {
        file_name: "Bank Max Checking_2026-11-18.csv",
        bytes: &bytes,
    };
    let as_charges = preview_source(&mut state, &source, true, checking, None, None).unwrap();
    let as_written = preview_source(&mut state, &source, false, checking, None, None).unwrap();
    assert_ne!(as_charges.review_token, as_written.review_token);
    assert_eq!(as_written.rows[0].amount, "12.50");
    let stale = commit_source(
        &mut state,
        &source,
        Some(StagedCommit { batch_id: id, row_version: 1 }),
        request(&as_charges, vec![0], false, checking),
    );
    assert!(stale.unwrap_err().contains("changed"), "the reviewed interpretation is the only one that can be approved");
    assert!(state.store.all_transactions().unwrap().is_empty());
    assert_eq!(state.store.folder_import_batch(id).unwrap().unwrap().status, BatchStatus::Pending);
}

#[test]
fn an_overlapping_export_flags_rows_already_imported_as_duplicates() {
    let (mut state, checking, _savings, mapping) = profile("overlap");
    state
        .store
        .save_transactions(
            checking,
            &[budget_core::models::Transaction {
                date: chrono::NaiveDate::from_ymd_opt(2026, 11, 17).unwrap(),
                description: "Corner Cafe".to_string(),
                amount: Decimal::from_str("-12.50").unwrap(),
                category: None,
            }],
        )
        .unwrap();
    let id = stage(&state, checking, mapping, EXPORT);
    let bytes = state.store.folder_import_batch_content(id).unwrap().unwrap();
    let source = ImportSource::Saved {
        file_name: "Bank Max Checking_2026-11-18.csv",
        bytes: &bytes,
    };
    let preview = preview_source(&mut state, &source, true, checking, None, None).unwrap();
    assert_eq!(preview.rows.iter().map(|r| r.is_duplicate).collect::<Vec<_>>(), vec![true, false, false]);
}

#[test]
fn an_export_whose_account_was_hidden_since_can_not_be_reviewed_or_imported() {
    let (state, checking, _savings, mapping) = profile("hidden-account");
    let id = stage(&state, checking, mapping, EXPORT);
    state.store.set_account_hidden(checking, true).unwrap();
    let err = pending_source(&state, id).unwrap_err();
    assert!(err.contains("deleted or hidden"), "{err}");
    state.store.set_account_hidden(checking, false).unwrap();
    assert!(pending_source(&state, id).is_ok());
}

#[test]
fn a_folder_on_a_network_share_keeps_its_ordinary_spelling() {
    assert_eq!(plain_folder_path(r"\\?\UNC\nas\share\Exports"), r"\\nas\share\Exports");
    assert_eq!(plain_folder_path(r"\\?\D:\Exports"), r"D:\Exports");
    assert_eq!(plain_folder_path(r"D:\Exports"), r"D:\Exports");
}
