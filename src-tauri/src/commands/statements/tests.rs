use super::*;
use budget_core::models::AccountType;
use budget_core::statement::fixture_pdf::{build_pdf, fixture};
use budget_core::statement::learn::{BalanceMark, HoldingMark, RowMark, TextRef};

fn profile(name: &str) -> (AppState, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("vaultspend-statement-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    (AppState::open(dir.join("profile.db")).unwrap(), dir)
}

/// The app's paths for a profile in generation 1 (what every test's review is bound to).
fn paths(dir: &std::path::Path) -> crate::config::AppPaths {
    crate::config::AppPaths {
        config_path: dir.join("config.json"),
        db_path: std::sync::Mutex::new(dir.join("profile.db")),
        generation: std::sync::atomic::AtomicU64::new(1),
    }
}

fn write_fixture(dir: &std::path::Path, name: &str) -> (String, String, String) {
    let (pages, (start, end)) = fixture(name).unwrap();
    let path = dir.join(format!("{name}.pdf"));
    std::fs::write(&path, build_pdf(&pages)).unwrap();
    (path.to_string_lossy().into_owned(), start.to_string(), end.to_string())
}

fn read(state: &mut AppState, sessions: &Sessions, path: &str, account: i64, start: &str, end: &str) -> Result<StatementReadDto, String> {
    read_statement_for(
        state,
        sessions,
        1,
        ReadStatementArgs {
            path: path.into(),
            account_id: account,
            period_start: start.into(),
            period_end: end.into(),
        },
    )
}

fn tx(date: &str, description: &str, amount: &str) -> budget_core::models::Transaction {
    budget_core::models::Transaction {
        date: date.parse().unwrap(),
        description: description.into(),
        amount: amount.parse().unwrap(),
        category: None,
    }
}

fn add_every_row(review: &StatementReviewDto) -> Vec<AddDecision> {
    review
        .rows
        .iter()
        .map(|r| AddDecision {
            row: r.index,
            date: r.date.clone(),
            description: r.description.clone(),
            amount: r.amount.clone(),
        })
        .collect()
}

fn reconcile_by_hand(state: &AppState, account: i64, date: &str, start: &str, end: &str) {
    let done = state
        .store
        .finish_reconciliation(
            &budget_core::store::FinishReconciliation {
                account_id: account,
                period_start: None,
                statement_date: date.parse().unwrap(),
                statement_start: Some(start.parse().unwrap()),
                statement_end: end.parse().unwrap(),
                source: budget_core::store::ReconcileSource::Manual,
            },
            chrono::Local::now().naive_local(),
        )
        .unwrap();
    assert!(done.is_some(), "the reconciliation through {date} should balance");
}

/// The character position of `word` in the first statement line starting with `prefix`.
fn text_ref(lines: &[StatementLineDto], prefix: &str, word: &str) -> TextRef {
    let l = lines.iter().find(|l| l.text.starts_with(prefix)).unwrap();
    TextRef {
        line: l.index,
        start: l.text[..l.text.find(word).unwrap()].chars().count(),
    }
}

#[test]
fn a_card_statement_is_read_matched_and_finished_and_the_bank_is_learned() {
    let (mut state, dir) = profile("card");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    // Two of the six charges are already in the app, in the app's sign.
    state
        .store
        .save_transactions(card, &[tx("2026-07-24", "Streaming", "-7.40"), tx("2026-08-05", "Autopay", "43.08")])
        .unwrap();
    let (path, start, end) = write_fixture(&dir, "card-a");

    let read = read(&mut state, &sessions, &path, card, &start, &end).unwrap();
    let review = read.review.expect("one section, so the review comes straight back");
    assert_eq!(review.activity_check.outcome, "passed");
    assert!(!review.recognized && review.learnable);
    let matched: Vec<_> = review.rows.iter().filter(|r| r.status == "matched").collect();
    assert_eq!(matched.len(), 2);
    let missing: Vec<_> = review.rows.iter().filter(|r| r.status == "missing").collect();
    assert_eq!(missing.len(), 4);

    let decisions = FinishDecisionsDto {
        matches: matched
            .iter()
            .map(|r| MatchDecision {
                row: r.index,
                transaction_id: r.match_id.unwrap(),
            })
            .collect(),
        add: missing
            .iter()
            .map(|r| AddDecision {
                row: r.index,
                date: r.date.clone(),
                description: r.description.clone(),
                amount: r.amount.clone(),
            })
            .collect(),
        skip: vec![],
        starting_balance: Some("43.08".into()),
        ending_balance: Some("52.36".into()),
        holdings: vec![],
        finish_without_holdings: false,
        ignore_unread: false,
        save_layout: Some(SaveLayoutDecision {
            name: "Northwind".into(),
            phrases: vec!["Northwind Card Services".into()],
        }),
    };
    let done = finish_statement_reconciliation_for(&mut state, &sessions, 1, &review.token, decisions).unwrap();
    assert_eq!(done.added, 4);
    assert_eq!(done.layout_saved.as_deref(), Some("Northwind"));
    assert_eq!(state.store.list_statement_layouts().unwrap().len(), 1);
    // Finishing ends the review.
    assert_eq!(statement_lines_for(&sessions, 1, &review.token).err().unwrap(), STALE);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn read_statement_with_the_wrong_period_says_no_transactions_were_found() {
    let (mut state, dir) = profile("wrong-period");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    let (path, _, _) = write_fixture(&dir, "card-a");
    // Every row falls outside these dates. The review says so (the screen shows "No transactions were
    // found between …") instead of refusing outright, because an unknown bank whose dates were misread
    // looks exactly the same and needs the Teach option.
    let review = read(&mut state, &sessions, &path, card, "2026-05-01", "2026-05-31")
        .unwrap()
        .review
        .unwrap();
    assert!(review.nothing_in_period);
    assert!(review.rows.is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_already_reconciled_period_is_flagged() {
    let (mut state, dir) = profile("already");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    reconcile_by_hand(&state, card, "2026-08-31", "0", "0");
    let (path, start, end) = write_fixture(&dir, "card-a");
    let review = read(&mut state, &sessions, &path, card, &start, &end).unwrap().review.unwrap();
    assert_eq!(review.already_reconciled_through.as_deref(), Some("2026-08-31"));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_previous_balance_is_where_this_statement_picks_up_from() {
    let (mut state, dir) = profile("previous");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    reconcile_by_hand(&state, card, "2026-06-30", "43.08", "43.08");
    // A newer month was reconciled first; this older statement still picks up from June.
    let september = state
        .store
        .save_transactions_with_ids(card, &[tx("2026-09-10", "Later", "-55.92")])
        .unwrap();
    state.store.set_transactions_cleared(&september, true).unwrap();
    reconcile_by_hand(&state, card, "2026-09-30", "43.08", "99.00");
    let (path, start, end) = write_fixture(&dir, "card-a");
    let review = read(&mut state, &sessions, &path, card, &start, &end).unwrap().review.unwrap();
    assert_eq!(review.previous_ending_balance.as_deref(), Some("43.08"));
    assert_eq!(review.already_reconciled_through.as_deref(), Some("2026-09-30"));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn several_sections_are_offered_for_choosing_first() {
    let (mut state, dir) = profile("sections");
    let sessions = Sessions::default();
    let checking = state.store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let (path, start, end) = write_fixture(&dir, "credit-union");
    let read = read(&mut state, &sessions, &path, checking, &start, &end).unwrap();
    assert!(read.review.is_none());
    assert_eq!(read.sections.len(), 2);
    let review = review_statement_for(&mut state, &sessions, 1, &read.token, 1, false).unwrap();
    assert_eq!(review.rows.len(), 5);
    assert_eq!(review.activity_check.outcome, "passed");
    assert_eq!(review.section_index, 1, "the review says which part of the statement it shows");
    assert_ne!(review.token, read.token, "each step renews the review with a new token");
    assert_eq!(
        review_statement_for(&mut state, &sessions, 1, &read.token, 0, false).err().unwrap(),
        STALE,
        "the token from before that step no longer works"
    );
    assert_eq!(
        review_statement_for(&mut state, &sessions, 1, &review.token, 2, false).err().unwrap(),
        "That part of the statement doesn't exist. Read the statement again."
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_stale_token_or_another_profile_generation_is_refused() {
    let (mut state, dir) = profile("stale");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    let (path, start, end) = write_fixture(&dir, "card-a");
    let token = read(&mut state, &sessions, &path, card, &start, &end).unwrap().token;
    // Another token (an old screen) is refused but leaves the open review alone.
    assert_eq!(
        review_statement_for(&mut state, &sessions, 1, "not-the-token", 0, false).err().unwrap(),
        STALE
    );
    assert!(statement_lines_for(&sessions, 1, &token).is_ok());
    // Another profile generation ends the review.
    assert_eq!(review_statement_for(&mut state, &sessions, 2, &token, 0, false).err().unwrap(), STALE);
    assert_eq!(statement_lines_for(&sessions, 1, &token).err().unwrap(), STALE);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_change_to_the_account_while_reviewing_refuses_the_finish() {
    let (mut state, dir) = profile("changed");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    let (path, start, end) = write_fixture(&dir, "card-a");
    let review = read(&mut state, &sessions, &path, card, &start, &end).unwrap().review.unwrap();
    state.store.save_transactions(card, &[tx("2026-08-10", "New", "-1.00")]).unwrap();
    let err = finish_statement_reconciliation_for(&mut state, &sessions, 1, &review.token, FinishDecisionsDto::default())
        .err()
        .unwrap();
    assert_eq!(err, STALE);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn every_row_needs_exactly_one_decision() {
    let (mut state, dir) = profile("decisions");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    let (path, start, end) = write_fixture(&dir, "card-a");
    let review = read(&mut state, &sessions, &path, card, &start, &end).unwrap().review.unwrap();
    let err = finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &review.token,
        FinishDecisionsDto {
            skip: vec![0],
            ..Default::default()
        },
    )
    .err()
    .unwrap();
    assert_eq!(err, "Choose what to do with every line on your statement first.");
    // A row decided twice is refused the same way.
    let mut skip: Vec<usize> = review.rows.iter().map(|r| r.index).collect();
    skip.push(0);
    let err = finish_statement_reconciliation_for(&mut state, &sessions, 1, &review.token, FinishDecisionsDto { skip, ..Default::default() })
        .err()
        .unwrap();
    assert_eq!(err, "Choose what to do with every line on your statement first.");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn teaching_keeps_the_part_being_shown_when_the_taught_statement_still_has_it() {
    let (mut state, dir) = profile("teach-section");
    let sessions = Sessions::default();
    let checking = state.store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let (path, start, end) = write_fixture(&dir, "credit-union");
    let read = read(&mut state, &sessions, &path, checking, &start, &end).unwrap();
    let second = review_statement_for(&mut state, &sessions, 1, &read.token, 1, false).unwrap();
    assert_eq!(second.section_index, 1);
    let lines = statement_lines_for(&sessions, 1, &second.token).unwrap();
    let marks = TeachMarks {
        rows: vec![RowMark {
            date: text_ref(&lines, "Aug 07", "Aug"),
            amount: text_ref(&lines, "$65.00 $209.21", "$65.00"),
        }],
        balances: None,
        holdings: vec![],
    };
    let taught = teach_statement_layout_for(&mut state, &sessions, 1, &second.token, marks).unwrap();
    let shown = sections_of_taught_len(&sessions, &taught.token);
    assert_eq!(
        (shown, taught.section_index),
        (2, 1),
        "the taught layout still has that part, so the review keeps showing it"
    );
    let _ = std::fs::remove_dir_all(dir);
}

fn sections_of_taught_len(sessions: &Sessions, token: &str) -> usize {
    sessions.with(token, 1, |s| Ok(sections_of(s).len())).unwrap()
}

#[test]
fn teaching_an_unknown_bank_then_recognising_it_next_month() {
    let (mut state, dir) = profile("teach");
    let sessions = Sessions::default();
    let checking = state.store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let (path, start, end) = write_fixture(&dir, "unknown-bank");
    let first = read(&mut state, &sessions, &path, checking, &start, &end).unwrap().review.unwrap();
    assert_ne!(first.activity_check.outcome, "passed");
    assert!(first.nothing_in_period, "day-first dates read month-first fall outside the period");
    let lines = statement_lines_for(&sessions, 1, &first.token).unwrap();
    let marks = TeachMarks {
        rows: vec![RowMark {
            date: text_ref(&lines, "03/08", "03/08/2026"),
            amount: text_ref(&lines, "03/08", "54.20"),
        }],
        balances: Some(BalanceMark::StartEnd {
            start: text_ref(&lines, "Opening", "1,250.00"),
            end: text_ref(&lines, "Closing", "3,132.00"),
        }),
        holdings: vec![],
    };
    // A part that the taught reading no longer has: the review starts again at the first part.
    sessions
        .with(&first.token, 1, |s| {
            s.section = 3;
            Ok(())
        })
        .unwrap();
    let taught = teach_statement_layout_for(&mut state, &sessions, 1, &first.token, marks).unwrap();
    assert_eq!(taught.activity_check.outcome, "passed");
    assert!(taught.learnable);
    assert_ne!(taught.token, first.token, "teaching renews the review with a new token");
    assert_eq!(taught.section_index, 0);
    assert_eq!(statement_lines_for(&sessions, 1, &first.token).err().unwrap(), STALE);
    finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &taught.token,
        FinishDecisionsDto {
            add: add_every_row(&taught),
            starting_balance: Some("1250.00".into()),
            ending_balance: Some("3132.00".into()),
            save_layout: Some(SaveLayoutDecision {
                name: "Riverbend".into(),
                phrases: taught.suggested_phrases.clone(),
            }),
            ..Default::default()
        },
    )
    .unwrap();

    let (path, start, end) = write_fixture(&dir, "unknown-bank-next");
    let next = read(&mut state, &sessions, &path, checking, &start, &end).unwrap().review.unwrap();
    assert!(next.recognized);
    assert_eq!(next.layout_name.as_deref(), Some("Riverbend"));
    assert_eq!(next.activity_check.outcome, "passed");
    assert_eq!(next.previous_ending_balance.as_deref(), Some("3132.00"));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_download_file_is_reviewed_without_learning() {
    let (mut state, dir) = profile("download");
    let sessions = Sessions::default();
    let checking = state.store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let csv = dir.join("aug.csv");
    std::fs::write(&csv, "Date,Description,Amount\n2026-08-03,Coffee,-4.50\n2026-07-01,Old,-1.00\n").unwrap();
    let review = read(&mut state, &sessions, &csv.to_string_lossy(), checking, "2026-08-01", "2026-08-31")
        .unwrap()
        .review
        .unwrap();
    assert_eq!((review.source.as_str(), review.rows.len(), review.learnable), ("download", 1, false));
    assert_eq!(review.activity_check.outcome, "not_available");
    assert_eq!(
        teach_statement_layout_for(&mut state, &sessions, 1, &review.token, TeachMarks::default())
            .err()
            .unwrap(),
        "Only a PDF statement can be taught."
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_download_follows_the_accounts_remembered_sign_direction() {
    let (mut state, dir) = profile("download-flip");
    let sessions = Sessions::default();
    let checking = state.store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    state.store.set_account_import_flip_signs(checking, true).unwrap();
    let csv = dir.join("aug.csv");
    std::fs::write(&csv, "Date,Description,Amount\n2026-08-03,Coffee,4.50\n").unwrap();
    let review = read(&mut state, &sessions, &csv.to_string_lossy(), checking, "2026-08-01", "2026-08-31")
        .unwrap()
        .review
        .unwrap();
    assert_eq!(review.rows[0].amount, "-4.50");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn other_files_and_folders_are_refused_plainly() {
    let (mut state, dir) = profile("refused");
    let sessions = Sessions::default();
    let checking = state.store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    let text = dir.join("notes.txt");
    std::fs::write(&text, "hello").unwrap();
    assert_eq!(
        read(&mut state, &sessions, &text.to_string_lossy(), checking, "2026-08-01", "2026-08-31")
            .err()
            .unwrap(),
        "Choose a PDF statement or your bank's CSV, OFX, QFX or QIF download."
    );
    assert_eq!(
        read(&mut state, &sessions, &dir.to_string_lossy(), checking, "2026-08-01", "2026-08-31")
            .err()
            .unwrap(),
        "Choose one statement file, not a folder."
    );
    assert_eq!(
        read(&mut state, &sessions, &text.to_string_lossy(), checking, "2026-08-31", "2026-08-01")
            .err()
            .unwrap(),
        "The statement's start date must be on or before its end date."
    );
    assert_eq!(
        read(
            &mut state,
            &sessions,
            &dir.join("gone.pdf").to_string_lossy(),
            checking,
            "2026-08-01",
            "2026-08-31"
        )
        .err()
        .unwrap(),
        "That file isn't there anymore. Choose your statement again."
    );
    assert_eq!(
        read(&mut state, &sessions, &text.to_string_lossy(), checking, "2026-08-01", "2026-13-01")
            .err()
            .unwrap(),
        "\"2026-13-01\" isn't a date the app can use. Choose a date from the calendar."
    );
    let (path, start, end) = write_fixture(&dir, "card-a");
    assert_eq!(
        read(&mut state, &sessions, &path, checking + 1000, &start, &end).err().unwrap(),
        "That account isn't in the app anymore. Choose another account."
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_unknown_brokerage_compares_share_counts_once_holdings_are_taught() {
    let (mut state, dir) = profile("brokerage");
    let sessions = Sessions::default();
    let account = state.store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    state
        .store
        .create_holding(
            account,
            "QQQZ",
            "Tracker",
            "10".parse().unwrap(),
            "300".parse().unwrap(),
            "2500".parse().unwrap(),
            None,
        )
        .unwrap();
    let (path, start, end) = write_fixture(&dir, "unknown-brokerage");
    let first = read(&mut state, &sessions, &path, account, &start, &end).unwrap().review.unwrap();
    assert_eq!(
        (first.activity_check.outcome.as_str(), first.holdings_check.outcome.as_str()),
        ("passed", "failed")
    );
    let taught = teach_unknown_brokerage_holdings(&mut state, &sessions, &first.token);
    assert_eq!(taught.holdings_check.outcome, "passed");
    let statuses: Vec<(&str, &str)> = taught.holdings.iter().map(|h| (h.symbol.as_str(), h.status)).collect();
    assert_eq!(statuses, vec![("QQQZ", "different"), ("VTIZ", "missing_in_app")]);
    let _ = std::fs::remove_dir_all(dir);
}

fn teach_unknown_brokerage_holdings(state: &mut AppState, sessions: &Sessions, token: &str) -> StatementReviewDto {
    let lines = statement_lines_for(sessions, 1, token).unwrap();
    teach_statement_layout_for(
        state,
        sessions,
        1,
        token,
        TeachMarks {
            rows: vec![],
            balances: None,
            holdings: vec![HoldingMark {
                symbol: text_ref(&lines, "QQQZ", "QQQZ"),
                quantity: text_ref(&lines, "10.5000", "10.5000"),
                price: Some(text_ref(&lines, "10.5000", "$300.25")),
                market_value: text_ref(&lines, "10.5000", "$3,152.63"),
                total: text_ref(&lines, "Total Market Value", "$4,153.03"),
            }],
        },
    )
    .unwrap()
}

#[test]
fn holdings_that_could_not_be_read_are_finished_only_without_checking_them() {
    let (mut state, dir) = profile("holdings-unread");
    let sessions = Sessions::default();
    let account = state.store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let (path, start, end) = write_fixture(&dir, "unknown-brokerage");
    let review = read(&mut state, &sessions, &path, account, &start, &end).unwrap().review.unwrap();
    assert_eq!(review.holdings_check.outcome, "failed");
    let decisions = || FinishDecisionsDto {
        add: add_every_row(&review),
        ..Default::default()
    };
    assert_eq!(
        finish_statement_reconciliation_for(&mut state, &sessions, 1, &review.token, decisions())
            .err()
            .unwrap(),
        "The app couldn't read your holdings correctly. Teach it how to read them, or finish without checking holdings."
    );
    let done = finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &review.token,
        FinishDecisionsDto {
            finish_without_holdings: true,
            ..decisions()
        },
    )
    .unwrap();
    assert_eq!(done.added, 3);

    // An investment statement's record keeps its total value for reference only: it is never offered
    // as a balance to pick up from.
    let (path, start, end) = write_fixture(&dir, "unknown-brokerage-next");
    let next = read(&mut state, &sessions, &path, account, &start, &end).unwrap().review.unwrap();
    assert_eq!(next.previous_ending_balance, None);
    assert_eq!(next.already_reconciled_through, None);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn checked_holdings_cannot_be_skipped() {
    let (mut state, dir) = profile("holdings-skip");
    let sessions = Sessions::default();
    let account = state.store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let (path, start, end) = write_fixture(&dir, "unknown-brokerage");
    let first = read(&mut state, &sessions, &path, account, &start, &end).unwrap().review.unwrap();
    let taught = teach_unknown_brokerage_holdings(&mut state, &sessions, &first.token);
    let err = finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &taught.token,
        FinishDecisionsDto {
            add: add_every_row(&taught),
            finish_without_holdings: true,
            ..Default::default()
        },
    )
    .err()
    .unwrap();
    assert_eq!(err, "Your holdings were read correctly, so check their share counts before finishing.");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_share_count_held_in_two_lots_is_fixed_on_their_sum_and_new_holdings_are_added() {
    let (mut state, dir) = profile("holdings-lots");
    let sessions = Sessions::default();
    let account = state.store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let lot = |shares: &str| {
        state
            .store
            .create_holding(
                account,
                "QQQZ",
                "Tracker",
                shares.parse().unwrap(),
                "300".parse().unwrap(),
                "1000".parse().unwrap(),
                None,
            )
            .unwrap()
    };
    let first_lot = lot("6");
    lot("4");
    let (path, start, end) = write_fixture(&dir, "unknown-brokerage");
    let first = read(&mut state, &sessions, &path, account, &start, &end).unwrap().review.unwrap();
    let taught = teach_unknown_brokerage_holdings(&mut state, &sessions, &first.token);
    let qqqz = taught.holdings.iter().find(|h| h.symbol == "QQQZ").unwrap();
    assert_eq!((qqqz.app_shares.as_deref(), qqqz.status), (Some("10"), "different"), "both lots together");
    assert_eq!(qqqz.app_holding_id, Some(first_lot));

    let done = finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &taught.token,
        FinishDecisionsDto {
            add: add_every_row(&taught),
            holdings: vec![
                HoldingDecision {
                    symbol: "QQQZ".into(),
                    action: "update".into(),
                    holding_id: Some(first_lot),
                    shares: Some("10.5".into()),
                    ..Default::default()
                },
                HoldingDecision {
                    symbol: "VTIZ".into(),
                    action: "add".into(),
                    cost_basis: Some("900".into()),
                    ..Default::default()
                },
            ],
            ..Default::default()
        },
    );
    done.unwrap();
    let today = chrono::Local::now().date_naive();
    let held: Vec<(String, String, String)> = state
        .store
        .list_holdings(today)
        .unwrap()
        .into_iter()
        .filter(|h| h.account_id == account)
        .map(|h| (h.symbol, h.shares.normalize().to_string(), h.price.normalize().to_string()))
        .collect();
    assert!(held.contains(&("QQQZ".into(), "6.5".into(), "300".into())), "{held:?}");
    assert!(held.contains(&("QQQZ".into(), "4".into(), "300".into())), "{held:?}");
    assert!(
        held.contains(&("VTIZ".into(), "4".into(), "250.1".into())),
        "added with the statement's shares and price: {held:?}"
    );
    let _ = std::fs::remove_dir_all(dir);
}

/// A learned copy of the home-loan layout that also reads the principal column of each payment.
fn learn_home_loan_with_principal(state: &AppState) {
    let mut layout = budget_core::statement::layout::built_in_layouts()
        .into_iter()
        .find(|l| l.id == "mortgage")
        .unwrap();
    layout.rows.principal_column = Some(0);
    state
        .store
        .save_statement_layout(None, "Home loan", &layout, chrono::Local::now().naive_local())
        .unwrap();
}

#[test]
fn a_loan_payment_shows_its_principal_part_and_is_added_with_it() {
    let (mut state, dir) = profile("loan");
    let sessions = Sessions::default();
    let loan = state.store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    learn_home_loan_with_principal(&state);
    let (path, start, end) = write_fixture(&dir, "mortgage");
    let review = read(&mut state, &sessions, &path, loan, &start, &end).unwrap().review.unwrap();
    assert!(review.recognized);
    let payment = &review.rows[0];
    assert_eq!((payment.amount.as_str(), payment.principal.as_deref()), ("2405.94", Some("355.17")));

    // 317,110.34 - 355.17 principal + 85.12 insurance = 316,840.29. Without the principal part the
    // whole 2,405.94 payment would count and it would not balance.
    let done = finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &review.token,
        FinishDecisionsDto {
            add: add_every_row(&review),
            starting_balance: Some("317110.34".into()),
            ending_balance: Some("316840.29".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(done.added, 2);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_principal_part_is_shown_only_for_loan_accounts() {
    let (mut state, dir) = profile("not-loan");
    let sessions = Sessions::default();
    let checking = state.store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    learn_home_loan_with_principal(&state);
    let (path, start, end) = write_fixture(&dir, "mortgage");
    let review = read(&mut state, &sessions, &path, checking, &start, &end).unwrap().review.unwrap();
    assert!(review.rows.iter().all(|r| r.principal.is_none()));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_accepted_sign_flip_is_remembered_in_the_learned_statement() {
    let (mut state, dir) = profile("flip");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    let (path, start, end) = write_fixture(&dir, "card-a");
    let review = read(&mut state, &sessions, &path, card, &start, &end).unwrap().review.unwrap();
    let flipped = review_statement_for(&mut state, &sessions, 1, &review.token, 0, true).unwrap();
    assert!(flipped.flipped);
    assert_eq!(
        flipped.rows.iter().find(|r| r.description.contains("AUTOPAY")).unwrap().amount,
        "-43.08",
        "the payment now reads as a charge"
    );
    // Flipped, the six rows lower what is owed by 9.28.
    finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &flipped.token,
        FinishDecisionsDto {
            add: add_every_row(&flipped),
            starting_balance: Some("43.08".into()),
            ending_balance: Some("33.80".into()),
            save_layout: Some(SaveLayoutDecision {
                name: "Northwind".into(),
                phrases: vec!["Northwind Card Services".into()],
            }),
            ..Default::default()
        },
    )
    .unwrap();
    let saved = state.store.list_statement_layouts().unwrap();
    assert!(saved[0].layout.signs.flip_credit);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn saved_statements_are_listed_renamed_and_removed() {
    let (state, dir) = profile("layouts");
    let paths = paths(&dir);
    learn_home_loan_with_principal(&state);
    let listed = list_statement_layouts_for(&state, &paths, 1).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "Home loan");
    rename_statement_layout_for(&state, &paths, 1, listed[0].id, "My mortgage").unwrap();
    assert_eq!(list_statement_layouts_for(&state, &paths, 1).unwrap()[0].name, "My mortgage");
    assert!(rename_statement_layout_for(&state, &paths, 1, listed[0].id, "1234-5678 account").is_err());
    delete_statement_layout_for(&state, &paths, 1, listed[0].id).unwrap();
    assert!(list_statement_layouts_for(&state, &paths, 1).unwrap().is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn added_rows_are_filed_under_a_sure_guess_only_when_that_category_exists() {
    let (mut state, dir) = profile("categories");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    state.store.create_category("Subscriptions", None).unwrap();
    state.rules = budget_core::rules::RuleSet::new(vec![
        budget_core::rules::Rule::new("CLOUD STORAGE", "Subscriptions"),
        budget_core::rules::Rule::new("VIDEO SERVICE", "Not A Category Yet"),
    ]);
    let (path, start, end) = write_fixture(&dir, "card-a");
    let review = read(&mut state, &sessions, &path, card, &start, &end).unwrap().review.unwrap();
    finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &review.token,
        FinishDecisionsDto {
            add: add_every_row(&review),
            starting_balance: Some("43.08".into()),
            ending_balance: Some("52.36".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let category_of = |word: &str| {
        state
            .store
            .all_transactions()
            .unwrap()
            .into_iter()
            .find(|t| t.transaction.description.contains(word))
            .unwrap()
            .transaction
            .category
    };
    assert_eq!(category_of("CLOUD STORAGE").as_deref(), Some("Subscriptions"));
    assert_eq!(category_of("VIDEO SERVICE"), None, "a guess never adds a category to the list");
    assert!(state.store.find_category("Not A Category Yet").unwrap().is_none());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn teaching_a_learned_statement_that_stopped_adding_up_updates_it() {
    let (mut state, dir) = profile("reteach");
    let sessions = Sessions::default();
    let checking = state.store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    // A learned way of reading this bank that no longer reads its dates (the bank changed them).
    let mut stale = budget_core::statement::layout::built_in_layouts()
        .into_iter()
        .find(|l| l.id == budget_core::statement::layout::GENERAL_ID)
        .unwrap();
    stale.recognize = vec!["Riverbend Mutual Bank".into()];
    let id = state
        .store
        .save_statement_layout(None, "Riverbend", &stale, chrono::Local::now().naive_local())
        .unwrap();
    let (path, start, end) = write_fixture(&dir, "unknown-bank");
    let first = read(&mut state, &sessions, &path, checking, &start, &end).unwrap().review.unwrap();
    assert!(first.recognized_but_failed);
    let lines = statement_lines_for(&sessions, 1, &first.token).unwrap();
    let taught = teach_statement_layout_for(
        &mut state,
        &sessions,
        1,
        &first.token,
        TeachMarks {
            rows: vec![RowMark {
                date: text_ref(&lines, "03/08", "03/08/2026"),
                amount: text_ref(&lines, "03/08", "54.20"),
            }],
            balances: Some(BalanceMark::StartEnd {
                start: text_ref(&lines, "Opening", "1,250.00"),
                end: text_ref(&lines, "Closing", "3,132.00"),
            }),
            holdings: vec![],
        },
    )
    .unwrap();
    assert_eq!(taught.activity_check.outcome, "passed");
    finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &taught.token,
        FinishDecisionsDto {
            add: add_every_row(&taught),
            starting_balance: Some("1250.00".into()),
            ending_balance: Some("3132.00".into()),
            save_layout: Some(SaveLayoutDecision {
                name: "Riverbend".into(),
                phrases: vec!["Riverbend Mutual Bank".into()],
            }),
            ..Default::default()
        },
    )
    .unwrap();
    let saved = state.store.list_statement_layouts().unwrap();
    assert_eq!(saved.len(), 1, "the learned one was updated, not copied");
    assert_eq!(saved[0].id, id);
    assert_eq!(
        saved[0].layout.dates.formats[0],
        budget_core::statement::layout::DateFormat::DdMmYyyy,
        "it now reads day-first dates first"
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn every_statement_command_refuses_another_profile_generation() {
    let (mut state, dir) = profile("generations");
    let paths = paths(&dir);
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    learn_home_loan_with_principal(&state);
    let id = list_statement_layouts_for(&state, &paths, 1).unwrap()[0].id;
    let (path, start, end) = write_fixture(&dir, "card-a");
    let token = read(&mut state, &sessions, &path, card, &start, &end).unwrap().token;

    paths.bump_generation(); // The person switched profile.
    assert_eq!(list_statement_layouts_for(&state, &paths, 1).err().unwrap(), PROFILE_CHANGED);
    assert_eq!(
        rename_statement_layout_for(&state, &paths, 1, id, "Other").err().unwrap(),
        PROFILE_CHANGED
    );
    assert_eq!(delete_statement_layout_for(&state, &paths, 1, id).err().unwrap(), PROFILE_CHANGED);
    assert_eq!(cancel_statement_review_for(&paths, &sessions, 1, &token).err().unwrap(), PROFILE_CHANGED);
    assert_eq!(state.store.list_statement_layouts().unwrap()[0].name, "Home loan", "nothing was changed");

    // In the current generation they work.
    assert_eq!(list_statement_layouts_for(&state, &paths, 2).unwrap().len(), 1);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn cancelling_ends_only_the_review_it_names() {
    let (mut state, dir) = profile("cancel");
    let paths = paths(&dir);
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    let (path, start, end) = write_fixture(&dir, "card-a");
    let token = read(&mut state, &sessions, &path, card, &start, &end).unwrap().token;
    cancel_statement_review_for(&paths, &sessions, 1, "an-old-screen").unwrap();
    assert!(statement_lines_for(&sessions, 1, &token).is_ok());
    cancel_statement_review_for(&paths, &sessions, 1, &token).unwrap();
    assert_eq!(statement_lines_for(&sessions, 1, &token).err().unwrap(), STALE);
    let _ = std::fs::remove_dir_all(dir);
}

/// A CSV download for August with one row, into `account`.
fn read_download(state: &mut AppState, sessions: &Sessions, dir: &std::path::Path, account: i64, csv: &str) -> StatementReviewDto {
    let file = dir.join("download.csv");
    std::fs::write(&file, csv).unwrap();
    read(state, sessions, &file.to_string_lossy(), account, "2026-08-01", "2026-08-31")
        .unwrap()
        .review
        .unwrap()
}

#[test]
fn an_investment_statement_without_readable_holdings_needs_finishing_without_checking_them() {
    let (mut state, dir) = profile("investment-unchecked");
    let sessions = Sessions::default();
    let account = state.store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    state
        .store
        .create_holding(
            account,
            "QQQZ",
            "Tracker",
            "10".parse().unwrap(),
            "300".parse().unwrap(),
            "2500".parse().unwrap(),
            None,
        )
        .unwrap();
    // A download lists no holdings, but the app holds some: their share counts can't be checked.
    let review = read_download(
        &mut state,
        &sessions,
        &dir,
        account,
        "Date,Description,Amount\n2026-08-03,Dividend,12.50\n",
    );
    let decisions = || FinishDecisionsDto {
        add: add_every_row(&review),
        starting_balance: Some("100.00".into()),
        ending_balance: Some("112.50".into()),
        ..Default::default()
    };
    assert_eq!(
        finish_statement_reconciliation_for(&mut state, &sessions, 1, &review.token, decisions())
            .err()
            .unwrap(),
        "The app couldn't read your holdings correctly. Teach it how to read them, or finish without checking holdings."
    );
    finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &review.token,
        FinishDecisionsDto {
            finish_without_holdings: true,
            ..decisions()
        },
    )
    .unwrap();
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_investment_statement_finishes_when_neither_it_nor_the_app_lists_holdings() {
    let (mut state, dir) = profile("investment-none");
    let sessions = Sessions::default();
    let account = state.store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let review = read_download(
        &mut state,
        &sessions,
        &dir,
        account,
        "Date,Description,Amount\n2026-08-03,Dividend,12.50\n",
    );
    finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &review.token,
        FinishDecisionsDto {
            add: add_every_row(&review),
            ..Default::default()
        },
    )
    .unwrap();
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_lower_share_count_comes_off_several_lots_without_any_going_below_zero() {
    let (mut state, dir) = profile("holdings-reduce");
    let sessions = Sessions::default();
    let account = state.store.get_or_create_account("Brokerage", AccountType::Investment).unwrap();
    let lot = |shares: &str| {
        state
            .store
            .create_holding(
                account,
                "QQQZ",
                "Tracker",
                shares.parse().unwrap(),
                "300".parse().unwrap(),
                "1000".parse().unwrap(),
                None,
            )
            .unwrap()
    };
    let big = lot("11");
    let small = lot("1");
    let (path, start, end) = write_fixture(&dir, "unknown-brokerage");
    let first = read(&mut state, &sessions, &path, account, &start, &end).unwrap().review.unwrap();
    let taught = teach_unknown_brokerage_holdings(&mut state, &sessions, &first.token);
    let update = |holding_id: i64| HoldingDecision {
        symbol: "QQQZ".into(),
        action: "update".into(),
        holding_id: Some(holding_id),
        shares: Some("10.5".into()),
        ..Default::default()
    };
    let vtiz = || HoldingDecision {
        symbol: "VTIZ".into(),
        action: "add".into(),
        cost_basis: Some("900".into()),
        ..Default::default()
    };

    // Two changes for one symbol would apply the difference twice.
    assert_eq!(
        finish_statement_reconciliation_for(
            &mut state,
            &sessions,
            1,
            &taught.token,
            FinishDecisionsDto {
                add: add_every_row(&taught),
                holdings: vec![update(small), update(big), vtiz()],
                ..Default::default()
            },
        )
        .err()
        .unwrap(),
        "Choose one change for each holding."
    );

    // 12 held, 10.5 on the statement: the chosen 1-share lot goes to 0, the other loses the last 0.5.
    finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &taught.token,
        FinishDecisionsDto {
            add: add_every_row(&taught),
            holdings: vec![update(small), vtiz()],
            ..Default::default()
        },
    )
    .unwrap();
    let today = chrono::Local::now().date_naive();
    let shares_of = |id: i64| {
        state
            .store
            .list_holdings(today)
            .unwrap()
            .into_iter()
            .find(|h| h.id == id)
            .unwrap()
            .shares
            .normalize()
            .to_string()
    };
    assert_eq!((shares_of(big), shares_of(small)), ("10.5".to_string(), "0".to_string()));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_matched_loan_payment_without_its_principal_part_gets_it_from_the_statement() {
    let (mut state, dir) = profile("loan-matched");
    let sessions = Sessions::default();
    let loan = state.store.get_or_create_account("Mortgage", AccountType::Loan).unwrap();
    let payment = state
        .store
        .save_transactions_with_ids(loan, &[tx("2026-09-01", "Mortgage payment", "2405.94")])
        .unwrap()[0];
    learn_home_loan_with_principal(&state);
    let (path, start, end) = write_fixture(&dir, "mortgage");
    let review = read(&mut state, &sessions, &path, loan, &start, &end).unwrap().review.unwrap();
    let row = &review.rows[0];
    assert_eq!((row.status, row.match_id), ("matched", Some(payment)));

    finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &review.token,
        FinishDecisionsDto {
            matches: vec![MatchDecision {
                row: 0,
                transaction_id: payment,
            }],
            add: add_every_row(&review).into_iter().filter(|a| a.row != 0).collect(),
            starting_balance: Some("317110.34".into()),
            ending_balance: Some("316840.29".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let stored = state.store.all_transactions().unwrap().into_iter().find(|t| t.id == payment).unwrap();
    assert_eq!(stored.principal_amount, Some("355.17".parse().unwrap()));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_match_must_have_exactly_the_lines_amount() {
    let (mut state, dir) = profile("match-amount");
    let sessions = Sessions::default();
    let card = state.store.get_or_create_account("Card", AccountType::Credit).unwrap();
    let streaming = state
        .store
        .save_transactions_with_ids(card, &[tx("2026-07-24", "Streaming", "-7.40")])
        .unwrap()[0];
    let (path, start, end) = write_fixture(&dir, "card-a");
    let review = read(&mut state, &sessions, &path, card, &start, &end).unwrap().review.unwrap();
    let other = review.rows.iter().find(|r| r.amount == "-2.99").unwrap().index;
    let err = finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &review.token,
        FinishDecisionsDto {
            matches: vec![MatchDecision {
                row: other,
                transaction_id: streaming,
            }],
            add: add_every_row(&review).into_iter().filter(|a| a.row != other).collect(),
            starting_balance: Some("43.08".into()),
            ending_balance: Some("52.36".into()),
            ..Default::default()
        },
    )
    .err()
    .unwrap();
    assert_eq!(
        err,
        "A transaction you matched has a different amount from its line on your statement. Choose its match again."
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_downloads_own_categories_are_used_through_the_import_category_memory() {
    let (mut state, dir) = profile("download-categories");
    let sessions = Sessions::default();
    let checking = state.store.get_or_create_account("Checking", AccountType::Checking).unwrap();
    state.store.create_category("Dining", None).unwrap();
    state.store.create_category("Groceries", None).unwrap();
    state.store.set_import_category_mapping("Coffee Shops", "Dining").unwrap();
    let review = read_download(
        &mut state,
        &sessions,
        &dir,
        checking,
        "Date,Description,Amount,Category\n2026-08-03,ZZQX CAFE,-4.50,Coffee Shops\n2026-08-04,ZZQX MART,-20.00,groceries\n2026-08-05,ZZQX THING,-1.00,Unknown Stuff\n",
    );
    finish_statement_reconciliation_for(
        &mut state,
        &sessions,
        1,
        &review.token,
        FinishDecisionsDto {
            add: add_every_row(&review),
            starting_balance: Some("100.00".into()),
            ending_balance: Some("74.50".into()),
            ..Default::default()
        },
    )
    .unwrap();
    let category_of = |word: &str| {
        state
            .store
            .all_transactions()
            .unwrap()
            .into_iter()
            .find(|t| t.transaction.description.contains(word))
            .unwrap()
            .transaction
            .category
    };
    assert_eq!(category_of("CAFE").as_deref(), Some("Dining"), "remembered from an earlier import");
    assert_eq!(
        category_of("MART").as_deref(),
        Some("Groceries"),
        "the file's own category, in the person's spelling"
    );
    assert_eq!(category_of("THING"), None, "a file category the person doesn't have is never added");
    assert!(state.store.find_category("Unknown Stuff").unwrap().is_none());
    let _ = std::fs::remove_dir_all(dir);
}
