use super::*;

#[test]
fn delete_family_member_nulls_member_id_on_the_buckets_it_owns() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let bucket_id = store.create_bucket("Emergency Fund", None, None, None, None, None, None).unwrap();
    store.set_bucket_member(bucket_id, Some(member)).unwrap();

    store.delete_family_member(member).unwrap();

    assert_eq!(store.list_buckets().unwrap()[0].member_id, None);
}

#[test]
fn set_bucket_member_assigns_and_clears_a_member() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let bucket_id = store.create_bucket("Emergency Fund", None, None, None, None, None, None).unwrap();

    store.set_bucket_member(bucket_id, Some(member)).unwrap();
    assert_eq!(store.list_buckets().unwrap()[0].member_id, Some(member));

    store.set_bucket_member(bucket_id, None).unwrap();
    assert_eq!(store.list_buckets().unwrap()[0].member_id, None);
}

#[test]
fn list_buckets_includes_its_members_name() {
    let store = Store::open_in_memory().unwrap();
    let member = store.create_family_member("Alex").unwrap();
    let bucket_id = store.create_bucket("Emergency Fund", None, None, None, None, None, None).unwrap();
    store.set_bucket_member(bucket_id, Some(member)).unwrap();

    let buckets = store.list_buckets().unwrap();

    assert_eq!(buckets[0].member_name, Some("Alex".to_string()));
}

#[test]
fn a_fresh_bucket_has_zero_saved_and_the_target_it_was_given() {
    let store = Store::open_in_memory().unwrap();
    let id = store
        .create_bucket("Emergency Fund", Some("1000.00".parse().unwrap()), None, None, None, None, None)
        .unwrap();

    let buckets = store.list_buckets().unwrap();
    assert_eq!(buckets.len(), 1);
    assert_eq!(buckets[0].id, id);
    assert_eq!(buckets[0].name, "Emergency Fund");
    assert_eq!(buckets[0].target_amount, Some("1000.00".parse().unwrap()));
    assert_eq!(buckets[0].saved_amount, "0".parse().unwrap());
    assert_eq!(buckets[0].target_date, None);
    assert_eq!(buckets[0].account_id, None);
}

#[test]
fn a_bucket_with_no_target_has_none() {
    let store = Store::open_in_memory().unwrap();
    store.create_bucket("Rainy Day", None, None, None, None, None, None).unwrap();

    assert_eq!(store.list_buckets().unwrap()[0].target_amount, None);
}

#[test]
fn a_bucket_can_have_a_target_date_and_a_linked_account() {
    let store = Store::open_in_memory().unwrap();
    let savings = store.get_or_create_account("Nest Egg", AccountType::Savings).unwrap();
    let target_date: NaiveDate = "2027-04-15".parse().unwrap();

    store
        .create_bucket(
            "Japan Trip",
            Some("6000.00".parse().unwrap()),
            Some(target_date),
            Some(savings),
            None,
            None,
            None,
        )
        .unwrap();

    let bucket = &store.list_buckets().unwrap()[0];
    assert_eq!(bucket.target_date, Some(target_date));
    assert_eq!(bucket.account_id, Some(savings));
    assert_eq!(bucket.account_name, Some("Nest Egg".to_string()));
}

#[test]
fn update_bucket_details_changes_target_and_linked_account() {
    let store = Store::open_in_memory().unwrap();
    let id = store.create_bucket("Japan Trip", None, None, None, None, None, None).unwrap();
    let savings = store.get_or_create_account("Nest Egg", AccountType::Savings).unwrap();
    let target_date: NaiveDate = "2027-04-15".parse().unwrap();

    store
        .update_bucket_details(id, Some("6000.00".parse().unwrap()), Some(target_date), Some(savings), None, None, None)
        .unwrap();

    let bucket = &store.list_buckets().unwrap()[0];
    assert_eq!(bucket.target_amount, Some("6000.00".parse().unwrap()));
    assert_eq!(bucket.target_date, Some(target_date));
    assert_eq!(bucket.account_name, Some("Nest Egg".to_string()));
}

#[test]
fn update_bucket_details_on_an_unknown_id_is_a_harmless_no_op() {
    let store = Store::open_in_memory().unwrap();
    store
        .update_bucket_details(999, Some("100.00".parse().unwrap()), None, None, None, None, None)
        .unwrap();
}

#[test]
fn a_bucket_created_with_a_color_reports_it_back() {
    let store = Store::open_in_memory().unwrap();
    store.create_bucket("Vacation", None, None, None, None, Some("#8A5FB0"), None).unwrap();

    assert_eq!(store.list_buckets().unwrap()[0].color, Some("#8A5FB0".to_string()));
}

#[test]
fn update_bucket_details_changes_the_color() {
    let store = Store::open_in_memory().unwrap();
    let id = store.create_bucket("Vacation", None, None, None, None, Some("#8A5FB0"), None).unwrap();

    store.update_bucket_details(id, None, None, None, None, Some("#4E8FC9"), None).unwrap();

    assert_eq!(store.list_buckets().unwrap()[0].color, Some("#4E8FC9".to_string()));
}

#[test]
fn contributions_accumulate_into_the_saved_amount_withdrawals_included() {
    let store = Store::open_in_memory().unwrap();
    let id = store.create_bucket("Vacation", None, None, None, None, None, None).unwrap();

    store
        .add_bucket_contribution(id, "2026-08-01".parse().unwrap(), "200.00".parse().unwrap(), None)
        .unwrap();
    store
        .add_bucket_contribution(id, "2026-08-15".parse().unwrap(), "150.00".parse().unwrap(), Some("bonus"))
        .unwrap();
    store
        .add_bucket_contribution(id, "2026-08-20".parse().unwrap(), "-50.00".parse().unwrap(), None)
        .unwrap();

    assert_eq!(store.list_buckets().unwrap()[0].saved_amount, "300.00".parse().unwrap());
}

#[test]
fn each_buckets_saved_amount_is_independent() {
    let store = Store::open_in_memory().unwrap();
    let vacation = store.create_bucket("Vacation", None, None, None, None, None, None).unwrap();
    let emergency = store.create_bucket("Emergency Fund", None, None, None, None, None, None).unwrap();

    store
        .add_bucket_contribution(vacation, "2026-08-01".parse().unwrap(), "200.00".parse().unwrap(), None)
        .unwrap();
    store
        .add_bucket_contribution(emergency, "2026-08-01".parse().unwrap(), "500.00".parse().unwrap(), None)
        .unwrap();

    let buckets = store.list_buckets().unwrap();
    let vacation_saved = buckets.iter().find(|b| b.id == vacation).unwrap().saved_amount;
    let emergency_saved = buckets.iter().find(|b| b.id == emergency).unwrap().saved_amount;
    assert_eq!(vacation_saved, "200.00".parse().unwrap());
    assert_eq!(emergency_saved, "500.00".parse().unwrap());
}

#[test]
fn deleting_a_bucket_removes_its_contributions_too() {
    let store = Store::open_in_memory().unwrap();
    let id = store.create_bucket("Vacation", None, None, None, None, None, None).unwrap();
    store
        .add_bucket_contribution(id, "2026-08-01".parse().unwrap(), "200.00".parse().unwrap(), None)
        .unwrap();

    store.delete_bucket(id).unwrap();

    assert_eq!(store.list_buckets().unwrap().len(), 0);
    // re-creating a bucket of the same name must not resurrect the old contributions
    let new_id = store.create_bucket("Vacation", None, None, None, None, None, None).unwrap();
    assert_eq!(store.list_buckets().unwrap()[0].saved_amount, "0".parse().unwrap());
    assert_ne!(id, new_id);
}

#[test]
fn a_bucket_with_no_sinking_amount_is_left_untouched_by_apply_sinking_fund_contributions() {
    let store = Store::open_in_memory().unwrap();
    store.create_bucket("Vacation", None, None, None, None, None, None).unwrap();

    let applied = store.apply_sinking_fund_contributions("2026-09-04".parse().unwrap()).unwrap();

    assert!(applied.is_empty());
    assert_eq!(store.list_buckets().unwrap()[0].saved_amount, Decimal::ZERO);
}

#[test]
fn sinking_fund_contribution_is_a_no_op_the_second_time_in_the_same_month() {
    let store = Store::open_in_memory().unwrap();
    store
        .create_bucket("Car Insurance", None, None, None, Some("50.00".parse().unwrap()), None, None)
        .unwrap();

    let first = store.apply_sinking_fund_contributions("2026-09-04".parse().unwrap()).unwrap();
    let second = store.apply_sinking_fund_contributions("2026-09-20".parse().unwrap()).unwrap();

    assert_eq!(first.len(), 1);
    assert_eq!(first[0].2, "50.00".parse().unwrap());
    assert!(second.is_empty(), "already contributed this month, must not fire twice");
    assert_eq!(store.list_buckets().unwrap()[0].saved_amount, "50.00".parse().unwrap());
}

#[test]
fn a_sinking_fund_contribution_still_allows_a_manual_contribution_the_same_month() {
    let store = Store::open_in_memory().unwrap();
    let id = store
        .create_bucket("Car Insurance", None, None, None, Some("50.00".parse().unwrap()), None, None)
        .unwrap();

    store.apply_sinking_fund_contributions("2026-09-04".parse().unwrap()).unwrap();
    store
        .add_bucket_contribution(id, "2026-09-10".parse().unwrap(), "25.00".parse().unwrap(), Some("extra"))
        .unwrap();

    assert_eq!(store.list_buckets().unwrap()[0].saved_amount, "75.00".parse().unwrap());
}

#[test]
fn deleting_a_bucket_also_clears_its_auto_contribution_guard() {
    let store = Store::open_in_memory().unwrap();
    let id = store
        .create_bucket("Car Insurance", None, None, None, Some("50.00".parse().unwrap()), None, None)
        .unwrap();
    store.apply_sinking_fund_contributions("2026-09-04".parse().unwrap()).unwrap();

    store.delete_bucket(id).unwrap();

    // Re-creating a same-named sinking-fund bucket must be able to
    // auto-contribute this exact month again — proving the old
    // bucket's guard row didn't survive the delete.
    let new_id = store
        .create_bucket("Car Insurance", None, None, None, Some("50.00".parse().unwrap()), None, None)
        .unwrap();
    let applied = store.apply_sinking_fund_contributions("2026-09-04".parse().unwrap()).unwrap();
    assert_eq!(applied.len(), 1);
    assert_eq!(applied[0].0, new_id);
}

#[test]
fn total_saved_sums_contributions_across_every_bucket() {
    let store = Store::open_in_memory().unwrap();
    let vacation = store.create_bucket("Vacation", None, None, None, None, None, None).unwrap();
    let emergency = store.create_bucket("Emergency Fund", None, None, None, None, None, None).unwrap();
    store
        .add_bucket_contribution(vacation, "2026-08-01".parse().unwrap(), "200.00".parse().unwrap(), None)
        .unwrap();
    store
        .add_bucket_contribution(emergency, "2026-08-01".parse().unwrap(), "500.00".parse().unwrap(), None)
        .unwrap();
    store
        .add_bucket_contribution(vacation, "2026-08-15".parse().unwrap(), "-50.00".parse().unwrap(), None)
        .unwrap();

    assert_eq!(store.total_saved().unwrap(), "650.00".parse().unwrap());
}

fn goal(store: &Store, today: &str, name: &str) -> StoredBucket {
    store
        .list_buckets_as_of(day(today))
        .unwrap()
        .into_iter()
        .find(|b| b.name == name)
        .unwrap_or_else(|| panic!("no goal {name:?}"))
}

fn savings_with_start(store: &Store, name: &str, start: &str) -> i64 {
    let id = store.get_or_create_account(name, AccountType::Savings).unwrap();
    store
        .conn
        .execute("UPDATE accounts SET starting_balance = ?1 WHERE id = ?2", params![start, id])
        .unwrap();
    id
}

#[test]
fn goal_pace_is_the_last_90_days_of_contributions_per_month() {
    let store = Store::open_in_memory().unwrap();
    let id = store
        .create_bucket("Trip", Some("3000".parse().unwrap()), None, None, None, None, None)
        .unwrap();
    store
        .add_bucket_contribution(id, day("2026-09-08"), "300".parse().unwrap(), None)
        .unwrap();
    store
        .add_bucket_contribution(id, day("2026-08-09"), "300".parse().unwrap(), None)
        .unwrap();
    // 100 days back: outside the window.
    store
        .add_bucket_contribution(id, day("2026-06-10"), "300".parse().unwrap(), None)
        .unwrap();

    assert_eq!(goal(&store, "2026-09-18", "Trip").monthly_pace, "200".parse().unwrap());
}

#[test]
fn goal_pace_counts_withdrawals_against_it() {
    let store = Store::open_in_memory().unwrap();
    let id = store.create_bucket("Trip", None, None, None, None, None, None).unwrap();
    store
        .add_bucket_contribution(id, day("2026-09-01"), "300".parse().unwrap(), None)
        .unwrap();
    store
        .add_bucket_contribution(id, day("2026-09-05"), "-90".parse().unwrap(), None)
        .unwrap();

    assert_eq!(goal(&store, "2026-09-18", "Trip").monthly_pace, "70".parse().unwrap());
}

#[test]
fn goal_pace_is_zero_without_recent_contributions() {
    let store = Store::open_in_memory().unwrap();
    let id = store.create_bucket("Trip", None, None, None, None, None, None).unwrap();
    store
        .add_bucket_contribution(id, day("2026-01-01"), "500".parse().unwrap(), None)
        .unwrap();

    let g = goal(&store, "2026-09-18", "Trip");
    assert_eq!(g.monthly_pace, Decimal::ZERO);
    assert_eq!(g.saved_amount, "500".parse().unwrap());
}

#[test]
fn a_goal_tracking_an_account_reports_that_balance_as_saved() {
    let store = Store::open_in_memory().unwrap();
    let savings = savings_with_start(&store, "High-Yield Savings", "1000.00");
    store.save_transactions(savings, &[tx("2026-08-01", "Deposit", "200.00")]).unwrap();
    let id = store
        .create_bucket("Emergency Fund", Some("5000".parse().unwrap()), None, Some(savings), None, None, None)
        .unwrap();
    store.set_bucket_tracks_account(id, true).unwrap();
    // A manual contribution no longer counts: the balance is the truth.
    store.add_bucket_contribution(id, day("2026-09-01"), "50".parse().unwrap(), None).unwrap();

    let g = goal(&store, "2026-09-18", "Emergency Fund");

    assert!(g.tracks_account);
    assert_eq!(g.saved_amount, "1200".parse().unwrap());
}

#[test]
fn a_linked_goal_that_is_not_tracking_keeps_its_contribution_total() {
    let store = Store::open_in_memory().unwrap();
    let savings = savings_with_start(&store, "High-Yield Savings", "1000.00");
    let id = store.create_bucket("Trip", None, None, Some(savings), None, None, None).unwrap();
    store.add_bucket_contribution(id, day("2026-09-01"), "75".parse().unwrap(), None).unwrap();

    let g = goal(&store, "2026-09-18", "Trip");

    assert!(!g.tracks_account);
    assert_eq!(g.saved_amount, "75".parse().unwrap());
}

#[test]
fn tracking_with_no_linked_account_falls_back_to_contributions() {
    let store = Store::open_in_memory().unwrap();
    let id = store.create_bucket("Trip", None, None, None, None, None, None).unwrap();
    store.set_bucket_tracks_account(id, true).unwrap();
    store.add_bucket_contribution(id, day("2026-09-01"), "75".parse().unwrap(), None).unwrap();

    assert_eq!(goal(&store, "2026-09-18", "Trip").saved_amount, "75".parse().unwrap());
}

#[test]
fn a_tracked_balance_never_reports_below_zero() {
    let store = Store::open_in_memory().unwrap();
    let savings = savings_with_start(&store, "Overdrawn", "0.00");
    store.save_transactions(savings, &[tx("2026-08-01", "Withdrawal", "-500.00")]).unwrap();
    let id = store.create_bucket("Fund", None, None, Some(savings), None, None, None).unwrap();
    store.set_bucket_tracks_account(id, true).unwrap();

    assert_eq!(goal(&store, "2026-09-18", "Fund").saved_amount, Decimal::ZERO);
}

#[test]
fn a_tracking_goals_pace_is_its_accounts_net_change_per_month() {
    let store = Store::open_in_memory().unwrap();
    let savings = savings_with_start(&store, "High-Yield Savings", "1000.00");
    store
        .save_transactions(
            savings,
            &[
                tx("2026-09-03", "Deposit A", "300.00"),
                tx("2026-08-01", "Deposit B", "300.00"),
                tx("2026-03-01", "Deposit C", "5000.00"),
            ],
        )
        .unwrap();
    let id = store
        .create_bucket("Emergency Fund", None, None, Some(savings), None, None, None)
        .unwrap();
    store.set_bucket_tracks_account(id, true).unwrap();

    assert_eq!(goal(&store, "2026-09-18", "Emergency Fund").monthly_pace, "200".parse().unwrap());
}

#[test]
fn set_bucket_tracks_account_can_be_turned_back_off() {
    let store = Store::open_in_memory().unwrap();
    let savings = savings_with_start(&store, "High-Yield Savings", "1000.00");
    let id = store.create_bucket("Fund", None, None, Some(savings), None, None, None).unwrap();
    store.set_bucket_tracks_account(id, true).unwrap();
    store.set_bucket_tracks_account(id, false).unwrap();

    assert!(!goal(&store, "2026-09-18", "Fund").tracks_account);
    // An unknown id is a harmless no-op.
    store.set_bucket_tracks_account(9999, true).unwrap();
}
