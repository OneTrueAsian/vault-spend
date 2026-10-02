use super::*;

// Transfer candidate dismissal — "stop suggesting this exact pair" (the
// Dismiss actions in TransferReviewDialog). Distinct from
// transfer_link_rejections (remembers an Unlink so auto-linking won't
// redo it); a dismissal only ever affects candidate/auto-link
// suggestions, never a transaction's data or totals.

#[test]
fn a_notes_only_edit_changes_nothing_else_about_the_transaction() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-11");
    store.link_transfer(out_id, in_id).unwrap();
    let before = store.all_transactions().unwrap().into_iter().find(|t| t.id == out_id).unwrap();
    let before_fingerprint: String = store
        .conn
        .query_row("SELECT fingerprint FROM transactions WHERE id = ?1", params![out_id], |row| row.get(0))
        .unwrap();

    store.update_transaction_notes(out_id, Some("just a note")).unwrap();

    let after = store.all_transactions().unwrap().into_iter().find(|t| t.id == out_id).unwrap();
    let after_fingerprint: String = store
        .conn
        .query_row("SELECT fingerprint FROM transactions WHERE id = ?1", params![out_id], |row| row.get(0))
        .unwrap();
    assert_eq!(after.transaction.amount, before.transaction.amount);
    assert_eq!(after.transaction.category, before.transaction.category);
    assert_eq!(
        after.transfer_counterpart_id, before.transfer_counterpart_id,
        "the transfer link must survive a notes-only edit"
    );
    assert_eq!(after_fingerprint, before_fingerprint, "the import fingerprint must not depend on notes");
    assert_eq!(after.notes, Some("just a note".to_string()));
}

#[test]
fn link_transfer_records_each_leg_as_the_others_counterpart() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-11");
    assert_eq!(counterpart_of(&store, out_id), None);

    assert!(store.link_transfer(out_id, in_id).unwrap());

    assert_eq!(counterpart_of(&store, out_id), Some(in_id));
    assert_eq!(counterpart_of(&store, in_id), Some(out_id));
}

#[test]
fn link_transfer_accepts_the_ids_in_either_order() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");

    assert!(store.link_transfer(in_id, out_id).unwrap());

    assert_eq!(counterpart_of(&store, out_id), Some(in_id));
}

#[test]
fn link_transfer_refuses_two_legs_in_the_same_account() {
    let store = Store::open_in_memory().unwrap();
    let (checking, _) = checking_and_savings(&store);
    store
        .save_transactions(checking, &[tx("2026-08-10", "Out", "-500.00"), tx("2026-08-10", "In", "500.00")])
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();

    assert!(
        !store.link_transfer(ids[0], ids[1]).unwrap(),
        "moving money to the same account isn't a transfer"
    );
}

#[test]
fn link_transfer_refuses_two_legs_that_both_go_the_same_direction() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = checking_and_savings(&store);
    store.save_transactions(checking, &[tx("2026-08-10", "One", "-500.00")]).unwrap();
    store.save_transactions(savings, &[tx("2026-08-10", "Two", "-500.00")]).unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();

    assert!(!store.link_transfer(ids[0], ids[1]).unwrap());
}

#[test]
fn link_transfer_refuses_a_leg_that_is_already_linked_or_gone() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
    assert!(store.link_transfer(out_id, in_id).unwrap());

    assert!(!store.link_transfer(out_id, in_id).unwrap(), "already linked");
    assert!(!store.link_transfer(out_id, 9999).unwrap(), "no such transaction");
}

#[test]
fn unlink_transfer_works_from_either_leg_and_is_a_no_op_when_not_linked() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
    store.link_transfer(out_id, in_id).unwrap();

    store.unlink_transfer(in_id).unwrap();

    assert_eq!(counterpart_of(&store, out_id), None);
    assert_eq!(counterpart_of(&store, in_id), None);
    store.unlink_transfer(in_id).unwrap(); // harmless
}

#[test]
fn transfer_candidates_pairs_opposite_equal_amounts_in_different_accounts_within_three_days() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-13"); // 3 days apart: ok

    let candidates = store.transfer_candidates().unwrap();

    assert_eq!(candidates, vec![TransferCandidate { out_id, in_id }]);
}

#[test]
fn transfer_candidates_ignores_far_apart_already_linked_and_unequal_pairs() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = checking_and_savings(&store);
    store
        .save_transactions(
            checking,
            &[
                tx("2026-08-01", "Far", "-100.00"),
                tx("2026-08-10", "Linked out", "-200.00"),
                tx("2026-08-20", "Unequal", "-300.00"),
            ],
        )
        .unwrap();
    store
        .save_transactions(
            savings,
            &[
                tx("2026-08-09", "Far in", "100.00"), // 8 days from "Far"
                tx("2026-08-10", "Linked in", "200.00"),
                tx("2026-08-20", "Unequal in", "299.00"),
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    store.link_transfer(ids[1], ids[4]).unwrap();

    assert!(store.transfer_candidates().unwrap().is_empty());
}

#[test]
fn transfer_candidates_uses_each_transaction_at_most_once_preferring_the_closest_date() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = checking_and_savings(&store);
    store.save_transactions(checking, &[tx("2026-08-10", "Out", "-500.00")]).unwrap();
    store
        .save_transactions(savings, &[tx("2026-08-12", "In two days later", "500.00")])
        .unwrap();
    store.save_transactions(savings, &[tx("2026-08-10", "In same day", "500.00")]).unwrap();
    let out_id = id_of(&store, "Out", "2026-08-10");
    let same_day_in = id_of(&store, "In same day", "2026-08-10");

    let candidates = store.transfer_candidates().unwrap();

    assert_eq!(candidates, vec![TransferCandidate { out_id, in_id: same_day_in }]);
}

#[test]
fn dismissing_a_pair_removes_it_from_candidates_and_survives_repeated_requests() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-11");
    assert_eq!(store.transfer_candidates().unwrap(), vec![TransferCandidate { out_id, in_id }]);

    let newly = store.dismiss_transfer_candidates(&[(out_id, in_id)]).unwrap();
    assert_eq!(newly, vec![TransferCandidate { out_id, in_id }]);
    assert!(store.transfer_candidates().unwrap().is_empty());
    assert!(
        store.auto_link_transfers().unwrap().is_empty(),
        "auto-linking must also honor an explicit dismissal"
    );

    let newly_again = store.dismiss_transfer_candidates(&[(out_id, in_id)]).unwrap();
    assert!(
        newly_again.is_empty(),
        "a pair already dismissed should not be reported as newly dismissed again"
    );

    assert_eq!(
        store.all_transactions().unwrap().len(),
        2,
        "dismissal must never touch the transactions themselves"
    );
}

#[test]
fn dismissal_accepts_either_leg_order_and_persists_across_reopen() {
    let dir = std::env::temp_dir().join(format!("vaultspend-dismiss-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("test.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).unwrap();
    }
    {
        let store = Store::open(&db_path).unwrap();
        let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-11");
        // Incoming leg passed first — orientation must be normalized by sign, not argument order.
        store.dismiss_transfer_candidates(&[(in_id, out_id)]).unwrap();
    }

    let reopened = Store::open(&db_path).unwrap();
    assert!(
        reopened.transfer_candidates().unwrap().is_empty(),
        "the dismissal must survive reopening the database"
    );
    drop(reopened);
    std::fs::remove_file(&db_path).unwrap();
}

#[test]
fn dismissing_one_alternate_pair_leaves_the_other_leg_available() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = checking_and_savings(&store);
    let backup = store.get_or_create_account("Backup Savings", AccountType::Savings).unwrap();
    store
        .save_transactions(checking, &[tx("2026-08-10", "Emergency transfer", "-300.00")])
        .unwrap();
    store
        .save_transactions(savings, &[tx("2026-08-10", "From checking A", "300.00")])
        .unwrap();
    store.save_transactions(backup, &[tx("2026-08-10", "From checking B", "300.00")]).unwrap();
    let out_id = id_of(&store, "Emergency transfer", "2026-08-10");
    let in_a = id_of(&store, "From checking A", "2026-08-10");
    let in_b = id_of(&store, "From checking B", "2026-08-10");

    assert_eq!(
        store.transfer_candidates().unwrap(),
        vec![TransferCandidate { out_id, in_id: in_a }],
        "closest/first match wins by default"
    );

    store.dismiss_transfer_candidates(&[(out_id, in_a)]).unwrap();

    assert_eq!(
        store.transfer_candidates().unwrap(),
        vec![TransferCandidate { out_id, in_id: in_b }],
        "dismissing A\u{2192}B must not dismiss A\u{2192}C \u{2014} the alternate pairing must surface"
    );
}

#[test]
fn dismiss_all_scope_includes_alternates_hidden_by_closest_match_selection() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = checking_and_savings(&store);
    let backup = store.get_or_create_account("Backup Savings", AccountType::Savings).unwrap();
    store
        .save_transactions(checking, &[tx("2026-08-10", "Emergency transfer", "-300.00")])
        .unwrap();
    store
        .save_transactions(savings, &[tx("2026-08-10", "From checking A", "300.00")])
        .unwrap();
    store.save_transactions(backup, &[tx("2026-08-10", "From checking B", "300.00")]).unwrap();
    let out_id = id_of(&store, "Emergency transfer", "2026-08-10");
    let in_a = id_of(&store, "From checking A", "2026-08-10");
    let in_b = id_of(&store, "From checking B", "2026-08-10");

    let mut all_pairs = store.list_all_transfer_candidate_pairs().unwrap();
    all_pairs.sort_by_key(|c| c.in_id);
    assert_eq!(
        all_pairs,
        vec![TransferCandidate { out_id, in_id: in_a }, TransferCandidate { out_id, in_id: in_b }],
        "the full eligible set must include the alternate pairing hidden by closest-match selection"
    );

    let pairs_to_dismiss: Vec<(i64, i64)> = all_pairs.iter().map(|c| (c.out_id, c.in_id)).collect();
    store.dismiss_transfer_candidates(&pairs_to_dismiss).unwrap();

    assert!(
        store.transfer_candidates().unwrap().is_empty(),
        "dismissing the complete eligible set must really clear the list, alternates included"
    );
}

#[test]
fn dismissal_skips_a_pair_that_is_no_longer_eligible_without_erroring_the_batch() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-11");
    let (out_id2, in_id2) = seed_transfer_pair(&store, "2026-09-01", "2026-09-02");
    assert!(
        store.link_transfer(out_id2, in_id2).unwrap(),
        "the second pair is now linked \u{2014} no longer an eligible candidate"
    );

    let newly = store.dismiss_transfer_candidates(&[(out_id, in_id), (out_id2, in_id2)]).unwrap();

    assert_eq!(
        newly,
        vec![TransferCandidate { out_id, in_id }],
        "an already-linked pair must be skipped, not dismissed"
    );
    assert!(store.transfer_candidates().unwrap().is_empty());
}

#[test]
fn dismissal_of_a_nonexistent_transaction_rolls_back_the_whole_batch() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-11");

    let result = store.dismiss_transfer_candidates(&[(out_id, in_id), (999_999, 999_998)]);

    assert!(
        result.is_err(),
        "a pair naming a transaction that doesn't exist at all must fail the whole batch"
    );
    assert_eq!(
        store.transfer_candidates().unwrap(),
        vec![TransferCandidate { out_id, in_id }],
        "nothing from the batch should have been persisted \u{2014} including the otherwise-valid pair"
    );
}

#[test]
fn restore_transfer_candidates_undoes_only_the_named_pairs() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-11");
    let (out_id2, in_id2) = seed_transfer_pair(&store, "2026-09-01", "2026-09-02");
    store.dismiss_transfer_candidates(&[(out_id, in_id), (out_id2, in_id2)]).unwrap();
    assert!(store.transfer_candidates().unwrap().is_empty());

    store.restore_transfer_candidates(&[(out_id, in_id)]).unwrap();

    assert_eq!(
        store.transfer_candidates().unwrap(),
        vec![TransferCandidate { out_id, in_id }],
        "restoring one pair must not also restore the other"
    );
}

#[test]
fn auto_link_links_a_clear_cut_pair_and_puts_it_on_the_review_list() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-11");
    assert!(store.auto_linked_transfers_to_review().unwrap().is_empty());

    let linked = store.auto_link_transfers().unwrap();

    assert_eq!(linked, vec![TransferCandidate { out_id, in_id }]);
    assert_eq!(counterpart_of(&store, out_id), Some(in_id));
    assert_eq!(counterpart_of(&store, in_id), Some(out_id));
    assert_eq!(
        store.auto_linked_transfers_to_review().unwrap(),
        vec![TransferCandidate { out_id, in_id }]
    );
    assert!(store.transfer_candidates().unwrap().is_empty(), "a linked pair is no longer a suggestion");
}

#[test]
fn auto_link_leaves_a_pair_for_a_person_when_either_side_has_more_than_one_match() {
    // One outgoing leg, two equal deposits within three days.
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = checking_and_savings(&store);
    store.save_transactions(checking, &[tx("2026-08-10", "Move out", "-500.00")]).unwrap();
    store
        .save_transactions(
            savings,
            &[tx("2026-08-10", "Deposit A", "500.00"), tx("2026-08-11", "Deposit B", "500.00")],
        )
        .unwrap();
    assert!(store.auto_link_transfers().unwrap().is_empty());
    assert_eq!(store.transfer_candidates().unwrap().len(), 1, "still offered as a suggestion");

    // Two outgoing legs, one deposit.
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = checking_and_savings(&store);
    store
        .save_transactions(
            checking,
            &[tx("2026-08-10", "Move out A", "-500.00"), tx("2026-08-11", "Move out B", "-500.00")],
        )
        .unwrap();
    store.save_transactions(savings, &[tx("2026-08-10", "Deposit", "500.00")]).unwrap();
    assert!(store.auto_link_transfers().unwrap().is_empty());
    assert_eq!(
        store
            .all_transactions()
            .unwrap()
            .iter()
            .filter(|t| t.transfer_counterpart_id.is_some())
            .count(),
        0
    );
}

#[test]
fn auto_link_follows_the_same_rules_as_suggestions() {
    let store = Store::open_in_memory().unwrap();
    let (checking, savings) = checking_and_savings(&store);
    store
        .save_transactions(
            checking,
            &[
                tx("2026-08-01", "Far", "-100.00"),
                tx("2026-08-20", "Unequal", "-300.00"),
                tx("2026-08-25", "Same account out", "-40.00"),
            ],
        )
        .unwrap();
    store
        .save_transactions(savings, &[tx("2026-08-09", "Far in", "100.00"), tx("2026-08-20", "Unequal in", "299.00")])
        .unwrap();
    store
        .save_transactions(checking, &[tx("2026-08-25", "Same account in", "40.00")])
        .unwrap();

    assert!(store.auto_link_transfers().unwrap().is_empty());
}

#[test]
fn unlinking_an_auto_link_takes_it_off_the_list_and_it_is_never_auto_linked_again() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
    store.auto_link_transfers().unwrap();

    store.unlink_transfer(in_id).unwrap();

    assert!(store.auto_linked_transfers_to_review().unwrap().is_empty());
    assert!(store.auto_link_transfers().unwrap().is_empty(), "the next pass must not undo the unlink");
    // A person can still link it by hand, and that link is theirs, not "auto".
    assert_eq!(store.transfer_candidates().unwrap(), vec![TransferCandidate { out_id, in_id }]);
    assert!(store.link_transfer(out_id, in_id).unwrap());
    assert!(store.auto_linked_transfers_to_review().unwrap().is_empty());
}

#[test]
fn a_pair_unlinked_by_hand_is_not_auto_linked_later() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
    store.link_transfer(out_id, in_id).unwrap();
    store.unlink_transfer(out_id).unwrap();

    assert!(store.auto_link_transfers().unwrap().is_empty());
}

#[test]
fn a_rejected_pair_does_not_make_the_next_best_match_look_ambiguous() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, first_in) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
    store.link_transfer(out_id, first_in).unwrap();
    store.unlink_transfer(out_id).unwrap(); // "that isn't a transfer"
    let (_, savings) = checking_and_savings(&store);
    store.save_transactions(savings, &[tx("2026-08-11", "Second deposit", "500.00")]).unwrap();
    let second_in = id_of(&store, "Second deposit", "2026-08-11");

    let linked = store.auto_link_transfers().unwrap();

    assert_eq!(linked, vec![TransferCandidate { out_id, in_id: second_in }]);
    assert_eq!(counterpart_of(&store, first_in), None);
}

#[test]
fn marking_auto_links_reviewed_clears_the_list_but_keeps_the_link() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
    store.auto_link_transfers().unwrap();

    assert_eq!(store.mark_transfer_links_reviewed(&[out_id]).unwrap(), 1);

    assert!(store.auto_linked_transfers_to_review().unwrap().is_empty());
    assert_eq!(counterpart_of(&store, out_id), Some(in_id));
    assert_eq!(store.mark_transfer_links_reviewed(&[out_id]).unwrap(), 0, "nothing left to mark");
}

#[test]
fn the_review_list_skips_a_pair_with_a_deleted_leg_and_shows_it_again_on_undo() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
    store.auto_link_transfers().unwrap();

    store.delete_transaction(out_id, "2026-08-12T00:00:00".parse().unwrap()).unwrap();
    assert!(store.auto_linked_transfers_to_review().unwrap().is_empty());

    store.restore_transactions(&[out_id]).unwrap();
    assert_eq!(
        store.auto_linked_transfers_to_review().unwrap(),
        vec![TransferCandidate { out_id, in_id }]
    );
}

#[test]
fn a_link_made_by_hand_is_never_on_the_review_list() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");

    store.link_transfer(out_id, in_id).unwrap();

    assert!(store.auto_linked_transfers_to_review().unwrap().is_empty());
}

#[test]
fn auto_link_if_enabled_does_nothing_while_the_setting_is_off() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");

    assert!(store.auto_link_transfers_if_enabled().unwrap().is_empty());
    assert_eq!(counterpart_of(&store, out_id), None);

    store.set_auto_link_transfers(true).unwrap();
    assert_eq!(store.auto_link_transfers_if_enabled().unwrap(), vec![TransferCandidate { out_id, in_id }]);
    assert_eq!(counterpart_of(&store, out_id), Some(in_id));
}

#[test]
fn a_database_from_before_auto_linking_gains_the_new_columns_and_keeps_its_links() {
    let store = Store::open_in_memory().unwrap();
    let (out_id, in_id) = seed_transfer_pair(&store, "2026-08-10", "2026-08-10");
    store.link_transfer(out_id, in_id).unwrap();
    // Put the tables back the way an older version left them.
    store.conn.execute_batch("ALTER TABLE transfer_links DROP COLUMN auto; ALTER TABLE transfer_links DROP COLUMN reviewed; ALTER TABLE app_settings DROP COLUMN auto_link_transfers; DROP TABLE transfer_link_rejections;").unwrap();

    store.init_schema().unwrap();

    assert_eq!(counterpart_of(&store, out_id), Some(in_id), "an existing link survives");
    assert!(store.auto_linked_transfers_to_review().unwrap().is_empty(), "and counts as reviewed");
    assert!(!store.get_app_settings().unwrap().auto_link_transfers);
    store.unlink_transfer(out_id).unwrap();
    store.set_auto_link_transfers(true).unwrap();
    assert!(store.auto_link_transfers().unwrap().is_empty(), "the unlink was remembered");
}
