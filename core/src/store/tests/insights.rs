use super::*;

// Boundary cases for the sliding-window/bucketed rewrite of
// `anomaly_flags` — a wrong rewrite here would silently change which
// transactions get flagged, so these exercise the exact edges of
// every threshold in its doc comment.

#[test]
fn flags_a_transaction_far_above_its_categorys_recent_average_as_large() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    // Three prior Dining Out transactions averaging $20, all within
    // the trailing 180 days of the one being tested.
    store
        .save_transactions(
            account,
            &[
                tx("2026-07-01", "Cafe One", "-15.00"),
                tx("2026-07-10", "Cafe Two", "-20.00"),
                tx("2026-07-20", "Cafe Three", "-25.00"),
                tx("2026-08-01", "Fancy Steakhouse", "-200.00"), // way above the $20 average
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    for id in &ids {
        store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
    }

    let flags = store.anomaly_flags().unwrap();

    let large_flags: Vec<_> = flags.iter().filter(|f| f.kind == "large").collect();
    assert_eq!(large_flags.len(), 1);
    assert_eq!(large_flags[0].transaction_id, *ids.last().unwrap());
}

#[test]
fn does_not_flag_a_large_transaction_in_a_category_with_too_little_history() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    // Only two prior transactions — below the 3-transaction minimum.
    store
        .save_transactions(
            account,
            &[
                tx("2026-07-01", "Cafe One", "-15.00"),
                tx("2026-07-10", "Cafe Two", "-20.00"),
                tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    for id in &ids {
        store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
    }

    let flags = store.anomaly_flags().unwrap();

    assert!(flags.iter().all(|f| f.kind != "large"), "too little history to judge, got {flags:?}");
}

#[test]
fn flags_two_same_amount_similarly_described_transactions_within_a_few_days_as_duplicates_even_across_accounts() {
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let savings = store.get_or_create_account("Savings", AccountType::Savings).unwrap();
    store.save_transactions(checking, &[tx("2026-08-05", "Netflix 4471", "-15.99")]).unwrap();
    store.save_transactions(savings, &[tx("2026-08-06", "Netflix 8823", "-15.99")]).unwrap();

    let flags = store.anomaly_flags().unwrap();

    let dup_flags: Vec<_> = flags.iter().filter(|f| f.kind == "duplicate").collect();
    assert_eq!(dup_flags.len(), 2, "both sides of the pair should be flagged, got {flags:?}");
}

#[test]
fn does_not_flag_transactions_that_only_share_amount_but_not_description() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-08-05", "Netflix", "-15.99"), tx("2026-08-06", "Spotify", "-15.99")])
        .unwrap();

    let flags = store.anomaly_flags().unwrap();

    assert!(flags.iter().all(|f| f.kind != "duplicate"), "different merchants, got {flags:?}");
}

#[test]
fn duplicate_anomaly_time_window_matrix() {
    struct Case {
        label: &'static str,
        second_date: &'static str,
        expect_duplicate_flags: bool,
    }
    let cases = [
        Case {
            label: "exactly 3 days apart must still flag both sides",
            second_date: "2026-08-04",
            expect_duplicate_flags: true,
        },
        Case {
            label: "4 days apart is one day past the window",
            second_date: "2026-08-05",
            expect_duplicate_flags: false,
        },
        Case {
            label: "19 days apart is a normal monthly bill",
            second_date: "2026-08-20",
            expect_duplicate_flags: false,
        },
    ];

    for case in cases {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[tx("2026-08-01", "Netflix", "-15.99"), tx(case.second_date, "Netflix", "-15.99")],
            )
            .unwrap();

        let flags = store.anomaly_flags().unwrap();
        if case.expect_duplicate_flags {
            assert_eq!(
                flags.iter().filter(|f| f.kind == "duplicate").count(),
                2,
                "case: {} — got {flags:?}",
                case.label
            );
        } else {
            assert!(flags.iter().all(|f| f.kind != "duplicate"), "case: {} — got {flags:?}", case.label);
        }
    }
}

#[test]
fn a_transaction_gets_one_duplicate_flag_naming_its_closest_match_and_how_many_more() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-08-01", "Corner Coffee", "-4.75"),
                tx("2026-08-02", "Corner Coffee", "-4.75"),
                tx("2026-08-04", "Corner Coffee", "-4.75"),
                tx("2026-08-20", "Corner Coffee", "-4.75"),
            ],
        )
        .unwrap();
    let id_on = |date: &str| {
        store
            .all_transactions()
            .unwrap()
            .into_iter()
            .find(|t| t.transaction.date.to_string() == date)
            .unwrap()
            .id
    };
    let flags = store.anomaly_flags().unwrap();
    let detail_for = |date: &str| -> Vec<String> {
        let id = id_on(date);
        flags
            .iter()
            .filter(|f| f.kind == "duplicate" && f.transaction_id == id)
            .map(|f| f.detail.clone())
            .collect()
    };

    assert_eq!(
        detail_for("2026-08-01"),
        ["Possible duplicate of the Corner Coffee transaction on 2026-08-02 (and 1 more)"]
    );
    // 08-01 and 08-04 are both in range; 08-01 is the closer one
    assert_eq!(
        detail_for("2026-08-02"),
        ["Possible duplicate of the Corner Coffee transaction on 2026-08-01 (and 1 more)"]
    );
    assert_eq!(
        detail_for("2026-08-04"),
        ["Possible duplicate of the Corner Coffee transaction on 2026-08-02 (and 1 more)"]
    );
    assert!(
        detail_for("2026-08-20").is_empty(),
        "16 days from the rest is a normal repeat, got {flags:?}"
    );
}

#[test]
fn many_look_alike_transactions_get_one_duplicate_flag_each_not_one_per_pair() {
    // 3,000 same-amount, same-merchant rows in four weeks: every one has look-alikes within 3 days.
    // Flagging every pair would be millions of flags (the 2026-10-02 QA load stall); one per row is 3,000.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let rows: Vec<Transaction> = (0..3000)
        .map(|i| tx(&format!("2026-08-{:02}", i % 28 + 1), &format!("Parking meter {i}"), "-2.50"))
        .collect();
    store.save_transactions(account, &rows).unwrap();

    let flags = store.anomaly_flags().unwrap();

    let duplicates = flags.iter().filter(|f| f.kind == "duplicate").count();
    assert_eq!(duplicates, 3000);
    let ids: std::collections::HashSet<i64> = flags.iter().filter(|f| f.kind == "duplicate").map(|f| f.transaction_id).collect();
    assert_eq!(ids.len(), 3000, "one flag per transaction");
}

#[test]
fn large_anomaly_history_window_matrix() {
    struct Case {
        label: &'static str,
        // Date of the oldest ("Cafe Zero"/"Cafe One") history row.
        oldest_history_date: &'static str,
        expect_large_flag: bool,
    }
    let cases = [
        Case {
            // Exactly 180 days before 2026-08-01 is 2026-02-02 — must
            // still count (the window is `>=`, not `>`).
            label: "a history item exactly 180 days back must still count",
            oldest_history_date: "2026-02-02",
            expect_large_flag: true,
        },
        Case {
            // 181 days before 2026-08-01 is 2026-02-01 — one day too
            // old, so only 2 of these 3 fall in-window, leaving too
            // little history to judge (< 3).
            label: "181 days back is one day outside the window, too little history to judge",
            oldest_history_date: "2026-02-01",
            expect_large_flag: false,
        },
    ];

    for case in cases {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx(case.oldest_history_date, "Cafe One", "-20.00"),
                    tx("2026-03-01", "Cafe Two", "-20.00"),
                    tx("2026-04-01", "Cafe Three", "-20.00"),
                    tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let flags = store.anomaly_flags().unwrap();
        if case.expect_large_flag {
            assert!(
                flags.iter().any(|f| f.kind == "large" && f.transaction_id == *ids.last().unwrap()),
                "case: {} — got {flags:?}",
                case.label
            );
        } else {
            assert!(
                flags.iter().all(|f| f.transaction_id != *ids.last().unwrap()),
                "case: {} — got {flags:?}",
                case.label
            );
        }
    }
}

#[test]
fn large_anomaly_amount_floor_matrix() {
    // Baseline is $10 (2.5x = $25) — small enough that the $50 floor,
    // not the multiple, is the binding constraint being tested. The
    // floor check is a strict `>` (see anomaly_flags), so exactly
    // $50.00 must not flag either — only $49.99 and $50.01 were
    // originally covered here; $50.00 pins that the boundary itself
    // is excluded, not just "at or below."
    struct Case {
        label: &'static str,
        amount: &'static str,
        expect_large_flag: bool,
    }
    let cases = [
        Case {
            label: "$49.99 is over the 2.5x multiple but under the $50 floor, must not flag",
            amount: "-49.99",
            expect_large_flag: false,
        },
        Case {
            label: "$50.00 exactly is still not over the floor (strict greater-than)",
            amount: "-50.00",
            expect_large_flag: false,
        },
        Case {
            label: "$50.01 clears both the multiple and the floor",
            amount: "-50.01",
            expect_large_flag: true,
        },
    ];

    for case in cases {
        let store = Store::open_in_memory().unwrap();
        let account = test_account(&store);
        store
            .save_transactions(
                account,
                &[
                    tx("2026-07-01", "Cafe One", "-10.00"),
                    tx("2026-07-10", "Cafe Two", "-10.00"),
                    tx("2026-07-20", "Cafe Three", "-10.00"),
                    tx("2026-08-01", "Boundary Transaction", case.amount),
                ],
            )
            .unwrap();
        let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
        for id in &ids {
            store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
        }

        let flags = store.anomaly_flags().unwrap();
        if case.expect_large_flag {
            assert!(
                flags.iter().any(|f| f.kind == "large" && f.transaction_id == *ids.last().unwrap()),
                "case: {} — got {flags:?}",
                case.label
            );
        } else {
            assert!(
                flags.iter().all(|f| f.transaction_id != *ids.last().unwrap()),
                "case: {} — got {flags:?}",
                case.label
            );
        }
    }
}

#[test]
fn the_sliding_window_keeps_two_categories_independent_when_interleaved_out_of_date_order() {
    // Regression guard for the rewrite specifically: rows are grouped
    // by category and sorted by date *within* the rewrite, but stored
    // (and originally iterated) in insertion/id order — this
    // interleaves two categories' dates and inserts them out of
    // chronological order within each category, so a grouping or
    // sort bug would either cross-contaminate the two baselines or
    // miscompute a window.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-07-20", "Cafe Three", "-20.00"),          // Dining Out, out of date order
                tx("2026-07-01", "Gas Station A", "-40.00"),       // Transportation
                tx("2026-07-01", "Cafe One", "-20.00"),            // Dining Out
                tx("2026-07-15", "Gas Station B", "-40.00"),       // Transportation
                tx("2026-07-10", "Cafe Two", "-20.00"),            // Dining Out
                tx("2026-07-25", "Gas Station C", "-40.00"),       // Transportation
                tx("2026-08-01", "Fancy Steakhouse", "-200.00"),   // Dining Out anomaly
                tx("2026-08-01", "Airport Car Rental", "-400.00"), // Transportation anomaly
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    let dining_ids = [ids[0], ids[2], ids[4], ids[6]];
    let transport_ids = [ids[1], ids[3], ids[5], ids[7]];
    for id in dining_ids {
        store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
    }
    for id in transport_ids {
        store.set_category(id, "Transportation", CategorySource::User, None).unwrap();
    }

    let flags = store.anomaly_flags().unwrap();
    let large_flags: std::collections::HashSet<i64> = flags.iter().filter(|f| f.kind == "large").map(|f| f.transaction_id).collect();

    assert_eq!(
        large_flags,
        std::collections::HashSet::from([ids[6], ids[7]]),
        "each category's own anomaly must be flagged, with no cross-contamination: {flags:?}"
    );
}

#[test]
fn large_expenses_in_range_includes_a_large_anomaly_dated_within_the_range() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-07-01", "Cafe One", "-15.00"),
                tx("2026-07-10", "Cafe Two", "-20.00"),
                tx("2026-07-20", "Cafe Three", "-25.00"),
                tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    for id in &ids {
        store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
    }

    let result = store
        .large_expenses_in_range("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
        .unwrap();

    assert_eq!(result.len(), 1);
    assert_eq!(result[0].transaction_id, *ids.last().unwrap());
    assert_eq!(result[0].description, "Fancy Steakhouse");
    assert_eq!(result[0].amount, "-200.00".parse().unwrap());
    assert_eq!(result[0].category.as_deref(), Some("Dining Out"));
    assert!(result[0].detail.contains("Dining Out"), "detail should explain why: {}", result[0].detail);
}

#[test]
fn large_expenses_in_range_excludes_a_large_anomaly_dated_outside_the_range() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-07-01", "Cafe One", "-15.00"),
                tx("2026-07-10", "Cafe Two", "-20.00"),
                tx("2026-07-20", "Cafe Three", "-25.00"),
                tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    for id in &ids {
        store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
    }

    let result = store
        .large_expenses_in_range("2026-07-01".parse().unwrap(), "2026-07-31".parse().unwrap())
        .unwrap();

    assert!(result.is_empty(), "the large expense is dated in August, not July: {result:?}");
}

#[test]
fn large_expenses_in_range_excludes_duplicate_flags() {
    let store = Store::open_in_memory().unwrap();
    let checking = test_account(&store);
    let savings = store.get_or_create_account("Savings", AccountType::Savings).unwrap();
    store.save_transactions(checking, &[tx("2026-08-05", "Netflix 4471", "-15.99")]).unwrap();
    store.save_transactions(savings, &[tx("2026-08-06", "Netflix 8823", "-15.99")]).unwrap();

    let result = store
        .large_expenses_in_range("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
        .unwrap();

    assert!(result.is_empty(), "duplicates aren't large expenses: {result:?}");
}

#[test]
fn large_expenses_in_range_sorts_by_amount_descending() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-07-01", "Cafe One", "-15.00"),
                tx("2026-07-10", "Cafe Two", "-20.00"),
                tx("2026-07-20", "Cafe Three", "-25.00"),
                tx("2026-08-01", "Fancy Steakhouse", "-200.00"),
                tx("2026-08-15", "Fanciest Steakhouse", "-500.00"),
            ],
        )
        .unwrap();
    let ids: Vec<i64> = store.all_transactions().unwrap().iter().map(|t| t.id).collect();
    for id in &ids {
        store.set_category(*id, "Dining Out", CategorySource::User, None).unwrap();
    }

    let result = store
        .large_expenses_in_range("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap())
        .unwrap();

    assert_eq!(result.len(), 2);
    assert_eq!(result[0].description, "Fanciest Steakhouse");
    assert_eq!(result[1].description, "Fancy Steakhouse");
}

#[test]
fn dashboard_insights_is_empty_for_a_quiet_month() {
    let store = Store::open_in_memory().unwrap();
    let insights = store.dashboard_insights("2026-08-20".parse().unwrap()).unwrap();
    assert!(insights.is_empty());
}

#[test]
fn dashboard_insights_does_not_pace_project_a_fixed_expense_paid_in_full_at_the_start_of_the_month() {
    // Reproduces a real report: a $2405.94 mortgage payment posted on
    // the 1st showed a Dashboard warning projecting $12,029.70 by
    // month end (naive `actual * days_in_month / days_elapsed` —
    // 2405.94 / 6 * 30 — applied to a bill that was already paid in
    // full for the month, not one that accrues day by day).
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.set_budget("Mortgage", "2026-09", "2405.94".parse().unwrap(), "fixed").unwrap();
    store
        .save_transactions(account, &[tx("2026-09-01", "LMCU Mortgage", "-2405.94")])
        .unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Mortgage", CategorySource::User, None).unwrap();
    }

    let insights = store.dashboard_insights("2026-09-06".parse().unwrap()).unwrap();

    assert!(
        !insights.iter().any(|i| i.kind == "pace" && i.message.contains("Mortgage")),
        "expected no pace insight for a fully-paid fixed expense: {insights:?}"
    );
}

#[test]
fn dashboard_insights_flags_a_month_over_month_category_jump() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(account, &[tx("2026-07-05", "Grocer", "-100.00"), tx("2026-08-05", "Grocer", "-200.00")])
        .unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Groceries", CategorySource::User, None).unwrap();
    }

    let insights = store.dashboard_insights("2026-08-05".parse().unwrap()).unwrap();

    assert!(
        insights.iter().any(|i| i.kind == "category_jump" && i.message.contains("Groceries")),
        "expected a category-jump insight for Groceries: {insights:?}"
    );
}

#[test]
fn dashboard_insights_flags_a_month_over_month_category_drop_as_a_positive_insight() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[tx("2026-07-05", "Boutique", "-200.00"), tx("2026-08-05", "Boutique", "-50.00")],
        )
        .unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Shopping", CategorySource::User, None).unwrap();
    }

    let insights = store.dashboard_insights("2026-08-05".parse().unwrap()).unwrap();

    let drop = insights.iter().find(|i| i.kind == "category_drop");
    assert!(drop.is_some(), "expected a category-drop insight for Shopping: {insights:?}");
    let drop = drop.unwrap();
    assert_eq!(drop.severity, "positive");
    assert!(drop.message.contains("Shopping"), "expected the message to name the category: {drop:?}");
}

#[test]
fn dashboard_insights_flags_a_category_dropping_to_zero_spend_as_a_positive_insight() {
    // The drop check walks *last* month's categories looking them up in
    // *this* month's map — a category entirely absent this month (not
    // just smaller) must default to $0 spent rather than being skipped,
    // since "stopped spending on it altogether" is the clearest case.
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store.save_transactions(account, &[tx("2026-07-05", "Boutique", "-200.00")]).unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Shopping", CategorySource::User, None).unwrap();
    }

    let insights = store.dashboard_insights("2026-08-05".parse().unwrap()).unwrap();

    assert!(
        insights.iter().any(|i| i.kind == "category_drop" && i.message.contains("Shopping")),
        "expected a category-drop insight when spend stopped entirely: {insights:?}"
    );
}

#[test]
fn dashboard_insights_does_not_flag_a_modest_month_over_month_decrease() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-07-05", "Boutique", "-100.00"),
                // A $15 (15%) drop clears neither the 30% nor the $50 floor.
                tx("2026-08-05", "Boutique", "-85.00"),
            ],
        )
        .unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Shopping", CategorySource::User, None).unwrap();
    }

    let insights = store.dashboard_insights("2026-08-05".parse().unwrap()).unwrap();

    assert!(
        !insights.iter().any(|i| i.kind == "category_drop"),
        "expected no category-drop insight for a modest decrease: {insights:?}"
    );
}

#[test]
fn dashboard_insights_sorts_warning_before_info_before_positive() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                // category_jump -> warning
                tx("2026-07-05", "Grocer", "-100.00"),
                tx("2026-08-05", "Grocer", "-200.00"),
                // category_drop -> positive
                tx("2026-07-05", "Boutique", "-200.00"),
                tx("2026-08-05", "Boutique", "-50.00"),
            ],
        )
        .unwrap();
    for t in store.all_transactions().unwrap() {
        let category = if t.transaction.description == "Grocer" {
            "Groceries"
        } else {
            "Shopping"
        };
        store.set_category(t.id, category, CategorySource::User, None).unwrap();
    }

    let insights = store.dashboard_insights("2026-08-05".parse().unwrap()).unwrap();
    let severities: Vec<&str> = insights.iter().map(|i| i.severity.as_str()).collect();
    let warning_pos = severities.iter().position(|s| *s == "warning");
    let positive_pos = severities.iter().position(|s| *s == "positive");
    assert!(
        warning_pos.is_some() && positive_pos.is_some() && warning_pos < positive_pos,
        "expected warning to sort before positive: {severities:?}"
    );
}

#[test]
fn dashboard_insights_surfaces_a_large_expense_in_the_current_month() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    store
        .save_transactions(
            account,
            &[
                tx("2026-05-01", "Cafe One", "-15.00"),
                tx("2026-06-01", "Cafe Two", "-20.00"),
                tx("2026-07-01", "Cafe Three", "-25.00"),
                tx("2026-08-05", "Fancy Steakhouse", "-200.00"),
            ],
        )
        .unwrap();
    for id in store.all_transactions().unwrap().iter().map(|t| t.id).collect::<Vec<_>>() {
        store.set_category(id, "Dining Out", CategorySource::User, None).unwrap();
    }

    let insights = store.dashboard_insights("2026-08-20".parse().unwrap()).unwrap();

    assert!(
        insights
            .iter()
            .any(|i| i.kind == "large_expense" && i.message.contains("Fancy Steakhouse")),
        "expected a large-expense insight: {insights:?}"
    );
}

#[test]
fn anomaly_flags_do_not_flag_an_unusually_large_transfer() {
    let store = Store::open_in_memory().unwrap();
    let account = test_account(&store);
    let mut rows: Vec<Transaction> = ["2026-06-02", "2026-07-02", "2026-08-02"]
        .iter()
        .map(|d| Transaction {
            category: Some("Transfer".to_string()),
            ..tx(d, "Transfer to Savings", "-100.00")
        })
        .collect();
    rows.push(Transaction {
        category: Some("Transfer".to_string()),
        ..tx("2026-08-20", "Transfer to Savings", "-5000.00")
    });
    store.save_transactions(account, &rows).unwrap();

    let flags = store.anomaly_flags().unwrap();

    assert!(
        flags.iter().all(|f| f.kind != "large"),
        "moving a big sum between your own accounts isn't an unusually large expense: {flags:?}"
    );
}

fn duplicate_pair(store: &Store) -> (i64, i64) {
    let account = test_account(store);
    store
        .save_transactions(account, &[tx("2026-09-10", "Netflix", "-15.49"), tx("2026-09-12", "Netflix", "-15.49")])
        .unwrap();
    (id_of(store, "Netflix", "2026-09-10"), id_of(store, "Netflix", "2026-09-12"))
}

#[test]
fn a_dismissed_flag_leaves_the_open_list_but_not_the_full_anomaly_scan() {
    let store = Store::open_in_memory().unwrap();
    let (first, second) = duplicate_pair(&store);
    assert_eq!(store.open_anomaly_flags().unwrap().len(), 2, "both rows of a duplicate pair are flagged");

    store.dismiss_anomaly(first, "duplicate").unwrap();

    let open = store.open_anomaly_flags().unwrap();
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].transaction_id, second);
    assert_eq!(store.anomaly_flags().unwrap().len(), 2, "other features still see every anomaly");
}

#[test]
fn dismissing_one_kind_leaves_the_other_kinds_on_that_transaction() {
    let store = Store::open_in_memory().unwrap();
    let (first, _) = duplicate_pair(&store);

    // "large" was never raised for this row, so dismissing it changes nothing.
    store.dismiss_anomaly(first, "large").unwrap();

    assert_eq!(store.open_anomaly_flags().unwrap().len(), 2);
}

#[test]
fn dismissing_twice_is_harmless() {
    let store = Store::open_in_memory().unwrap();
    let (first, _) = duplicate_pair(&store);

    store.dismiss_anomaly(first, "duplicate").unwrap();
    store.dismiss_anomaly(first, "duplicate").unwrap();

    assert_eq!(store.open_anomaly_flags().unwrap().len(), 1);
}
