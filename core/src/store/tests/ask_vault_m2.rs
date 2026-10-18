//! Ask the Vault version 2 engine: family members, several categories, months and which of them can be trusted, averages, and
//! aligned comparisons. Every expected number was added up by hand from the rows written in each test.
use super::*;
use crate::models::{AccountType, Transaction};
use crate::store::{ask_comparison, AskAlignment, AskAverageKind, AskGroupBy, AskMonthCoverage, AskMonthCoverage::*, AskSpendFilter, AskSpendResult};

fn account(store: &Store, name: &str) -> i64 {
    store.create_account(name, AccountType::Checking).unwrap().expect("new account")
}

/// One recorded transaction; `cents` is negative for spending. Returns its id.
fn record(store: &Store, account: i64, date: &str, description: &str, cents: i64, category: Option<&str>, member: Option<i64>) -> i64 {
    let id = store
        .create_transaction(
            account,
            &Transaction {
                date: day(date),
                description: description.to_string(),
                amount: Decimal::new(cents, 2),
                category: category.map(str::to_string),
            },
            None,
        )
        .unwrap();
    store.set_transaction_member(id, member).unwrap();
    id
}

fn split(store: &Store, id: i64, lines: &[(&str, i64)]) {
    let lines: Vec<(String, Decimal, Option<String>)> = lines.iter().map(|(c, cents)| (c.to_string(), Decimal::new(*cents, 2), None)).collect();
    store.set_transaction_splits(id, &lines).unwrap();
}

fn ask(store: &Store, filter: AskSpendFilter) -> AskSpendResult {
    store.ask_spending(&filter).unwrap()
}

fn months_of(result: &AskSpendResult) -> Vec<(&str, Decimal, usize, AskMonthCoverage, usize)> {
    result
        .months
        .iter()
        .map(|m| (m.month.as_str(), m.total, m.purchase_count, m.coverage, m.record_count))
        .collect()
}

/// Today is 10 July 2026. Everyday records from 5 January and Card only from 12 February; nothing at all was recorded in March;
/// everything stops on 10 June; Savings holds a single transfer in. Groceries by month: Jan 100.00, Feb 120.00 + 30.00,
/// Mar none, Apr 90.00 + 20.00, May 110.00 + 25.00, Jun 80.00 + 15.00.
fn gap_household() -> (Store, i64, i64) {
    let store = Store::open_in_memory().unwrap();
    let (everyday, card, savings) = (account(&store, "Everyday"), account(&store, "Card"), account(&store, "Savings"));
    for category in ["Groceries", "Travel"] {
        let _ = store.create_category(category, None);
    }
    let groceries = Some("Groceries");
    record(&store, everyday, "2026-01-05", "KROGER", -10000, groceries, None);
    record(&store, everyday, "2026-02-06", "KROGER", -12000, groceries, None);
    record(&store, card, "2026-02-12", "ALDI", -3000, groceries, None);
    record(&store, everyday, "2026-04-04", "KROGER", -9000, groceries, None);
    record(&store, card, "2026-04-20", "ALDI", -2000, groceries, None);
    record(&store, everyday, "2026-05-05", "KROGER", -11000, groceries, None);
    record(&store, card, "2026-05-18", "ALDI", -2500, groceries, None);
    record(&store, everyday, "2026-06-03", "KROGER", -8000, groceries, None);
    record(&store, card, "2026-06-10", "ALDI", -1500, groceries, None);
    record(&store, savings, "2026-06-01", "TRANSFER IN", 5000, Some("Transfer"), None);
    (store, everyday, card)
}

fn by_month(accounts: Vec<i64>, category: &str, average: AskAverageKind) -> AskSpendFilter {
    AskSpendFilter {
        from: day("2026-01-01"),
        to: day("2026-06-30"),
        as_of: day("2026-07-10"),
        account_ids: accounts,
        categories: vec![category.to_string()],
        group_by: if average == AskAverageKind::None {
            AskGroupBy::Month
        } else {
            AskGroupBy::None
        },
        average,
        ..Default::default()
    }
}

#[test]
fn months_nothing_recorded_or_not_yet_recording_are_never_zero_months() {
    let (store, _, _) = gap_household();
    let result = ask(&store, by_month(vec![], "Groceries", AskAverageKind::None));
    // Evidence accounts: Everyday (records 5 Jan to 3 Jun) and Card (12 Feb to 10 Jun); Savings holds no groceries, so it is ignored.
    assert_eq!(result.recorded_from, Some(day("2026-02-12")));
    assert_eq!(result.recorded_through, Some(day("2026-06-03"))); // the earlier of Everyday (3 Jun) and Card (10 Jun)
    assert_eq!(result.total, dec("590.00"));
    assert_eq!(
        months_of(&result),
        vec![
            ("2026-01", dec("100.00"), 1, BeforeRecords, 1),
            ("2026-02", dec("150.00"), 2, PartlyRecorded, 2),
            ("2026-03", dec("0.00"), 0, NoRecords, 0),
            ("2026-04", dec("110.00"), 2, Complete, 2),
            ("2026-05", dec("135.00"), 2, Complete, 2),
            // Every account counts for "was anything recorded", so the Savings transfer is June's third record.
            ("2026-06", dec("95.00"), 2, RecordsEnd, 3),
        ]
    );
}

#[test]
fn average_per_month_uses_only_the_months_that_can_be_trusted() {
    let (store, _, _) = gap_household();
    let average = ask(&store, by_month(vec![], "Groceries", AskAverageKind::PerMonth))
        .average
        .expect("an average was asked for");
    // April 110.00 and May 135.00 only: 245.00 / 2 = 122.50. The empty March is left out, not counted as zero.
    assert_eq!(
        (average.numerator, average.denominator, average.value),
        (dec("245.00"), 2, Some(dec("122.50")))
    );
    assert_eq!(average.unavailable, None);
    assert_eq!(average.months_used, ["2026-04", "2026-05"]);
    assert_eq!(
        average.months_left_out,
        vec![
            ("2026-01".to_string(), BeforeRecords),
            ("2026-02".to_string(), PartlyRecorded),
            ("2026-03".to_string(), NoRecords),
            ("2026-06".to_string(), RecordsEnd),
        ]
    );
}

#[test]
fn one_account_is_judged_by_its_own_records() {
    let (store, everyday, _) = gap_household();
    let result = ask(&store, by_month(vec![everyday], "Groceries", AskAverageKind::None));
    assert_eq!(
        (result.recorded_from, result.recorded_through),
        (Some(day("2026-01-05")), Some(day("2026-06-03")))
    );
    let coverage: Vec<_> = result.months.iter().map(|m| m.coverage).collect();
    assert_eq!(coverage, [PartlyRecorded, Complete, NoRecords, Complete, Complete, RecordsEnd]);
    let average = ask(&store, by_month(vec![everyday], "Groceries", AskAverageKind::PerMonth))
        .average
        .unwrap();
    // February 120.00, April 90.00, May 110.00: 320.00 / 3 = 106.666..., shown 106.67.
    assert_eq!(
        (average.numerator, average.denominator, average.value),
        (dec("320.00"), 3, Some(dec("106.67")))
    );
}

#[test]
fn a_question_nothing_ever_matched_has_no_evidence_and_no_average() {
    let (store, _, _) = gap_household();
    let result = ask(&store, by_month(vec![], "Travel", AskAverageKind::None));
    assert_eq!((result.recorded_from, result.recorded_through), (None, None));
    assert!(result.months.iter().all(|m| m.coverage == NoRecords && m.total == Decimal::ZERO));
    let average = ask(&store, by_month(vec![], "Travel", AskAverageKind::PerMonth)).average.unwrap();
    assert_eq!(
        (average.value, average.unavailable, average.denominator),
        (None, Some("no-complete-months"), 0)
    );
}

#[test]
fn a_quiet_month_for_one_account_still_counts_as_zero_when_another_account_has_records() {
    // The documented limit: Sam's card has no fuel and no records in January, but Joint has records that month.
    let store = Store::open_in_memory().unwrap();
    let (joint, card) = (account(&store, "Joint"), account(&store, "Sam Card"));
    for category in ["Fuel", "Rent"] {
        let _ = store.create_category(category, None);
    }
    record(&store, joint, "2025-11-15", "RENT", -90000, Some("Rent"), None);
    record(&store, card, "2025-11-20", "SHELL", -4000, Some("Fuel"), None);
    record(&store, joint, "2026-01-10", "RENT", -90000, Some("Rent"), None);
    record(&store, card, "2026-02-05", "SHELL", -4500, Some("Fuel"), None);
    record(&store, card, "2026-03-03", "SHELL", -5000, Some("Fuel"), None);
    let filter = AskSpendFilter {
        from: day("2025-12-01"),
        to: day("2026-02-28"),
        as_of: day("2026-03-30"),
        categories: vec!["Fuel".into()],
        average: AskAverageKind::PerMonth,
        ..Default::default()
    };
    let result = ask(&store, filter);
    // December has no record in any account, so it is left out. January has Joint's rent record, so Sam's card having no fuel that
    // month counts as a real zero: (0.00 + 45.00) / 2 = 22.50.
    let average = result.average.unwrap();
    assert_eq!(result.months[0].coverage, NoRecords);
    assert_eq!(average.months_used, ["2026-01", "2026-02"]);
    assert_eq!((average.numerator, average.value), (dec("45.00"), Some(dec("22.50"))));
}

#[test]
fn a_range_after_today_cannot_ask_for_months_or_an_average() {
    let (store, _, _) = gap_household();
    let mut filter = by_month(vec![], "Groceries", AskAverageKind::None);
    filter.as_of = day("2026-06-20");
    assert!(store.ask_spending(&filter).is_err());
}

#[test]
fn months_are_limited_to_fifty_rows() {
    let (store, _, _) = gap_household();
    let mut filter = by_month(vec![], "Groceries", AskAverageKind::None);
    filter.from = day("2022-04-01");
    assert!(store.ask_spending(&filter).is_err(), "51 months must be refused");
    filter.from = day("2022-05-01");
    assert_eq!(ask(&store, filter).months.len(), 50);
}

/// Sam (1), Alex (2) and Robin (3, no purchases). Hand totals below.
fn family_household() -> (Store, i64, i64, i64) {
    let store = Store::open_in_memory().unwrap();
    let (sam, alex, robin) = (
        store.create_family_member("Sam").unwrap(),
        store.create_family_member("Alex").unwrap(),
        store.create_family_member("Robin").unwrap(),
    );
    let joint = account(&store, "Joint");
    for category in ["Groceries", "Shopping", "Fuel"] {
        let _ = store.create_category(category, None);
    }
    record(&store, joint, "2026-03-01", "KROGER", -9000, Some("Groceries"), Some(sam)); // Sam 90.00
    record(&store, joint, "2026-03-03", "SHELL", -5000, Some("Fuel"), Some(sam)); // Sam 50.00
                                                                                  // 200.00 split 80.00 groceries / 120.00 shopping, recorded against Alex: all of it is Alex's.
    let target = record(&store, joint, "2026-03-05", "TARGET", -20000, None, Some(alex));
    split(&store, target, &[("Groceries", -8000), ("Shopping", -12000)]);
    record(&store, joint, "2026-03-18", "PHARMACY", -2200, Some("Groceries"), None); // unassigned 22.00
    record(&store, joint, "2026-03-20", "RETURN", 5000, Some("Shopping"), Some(alex)); // a refund, never spending
    (store, sam, alex, robin)
}

fn march() -> AskSpendFilter {
    AskSpendFilter {
        from: day("2026-03-01"),
        to: day("2026-03-30"),
        as_of: day("2026-03-30"),
        ..Default::default()
    }
}

#[test]
fn a_split_purchase_belongs_wholly_to_the_member_on_the_purchase() {
    let (store, _, alex, _) = family_household();
    let shopping = ask(
        &store,
        AskSpendFilter {
            member_ids: vec![alex],
            categories: vec!["Shopping".into()],
            ..march()
        },
    );
    assert_eq!((shopping.total, shopping.purchase_count), (dec("120.00"), 1));
    let everything = ask(
        &store,
        AskSpendFilter {
            member_ids: vec![alex],
            ..march()
        },
    );
    assert_eq!((everything.total, everything.purchase_count), (dec("200.00"), 1));
}

#[test]
fn several_members_are_an_or_and_unassigned_is_chosen_separately() {
    let (store, sam, alex, _) = family_household();
    let both = ask(
        &store,
        AskSpendFilter {
            member_ids: vec![sam, alex],
            ..march()
        },
    );
    assert_eq!((both.total, both.purchase_count), (dec("340.00"), 3));
    let unassigned = ask(
        &store,
        AskSpendFilter {
            include_unassigned: true,
            ..march()
        },
    );
    assert_eq!((unassigned.total, unassigned.purchase_count), (dec("22.00"), 1));
    let sam_and_unassigned = ask(
        &store,
        AskSpendFilter {
            member_ids: vec![sam],
            include_unassigned: true,
            ..march()
        },
    );
    assert_eq!(sam_and_unassigned.total, dec("162.00"));
}

#[test]
fn a_member_with_no_purchases_is_zero_not_missing() {
    let (store, _, _, robin) = family_household();
    let result = ask(
        &store,
        AskSpendFilter {
            member_ids: vec![robin],
            ..march()
        },
    );
    assert_eq!((result.total, result.purchase_count), (Decimal::ZERO, 0));
}

#[test]
fn grouping_by_member_lists_everyone_largest_first_and_adds_back() {
    let (store, sam, alex, robin) = family_household();
    let result = ask(
        &store,
        AskSpendFilter {
            group_by: AskGroupBy::Member,
            ..march()
        },
    );
    let lines: Vec<_> = result
        .member_totals
        .iter()
        .map(|m| (m.member_id, m.name.as_deref(), m.total, m.purchase_count))
        .collect();
    assert_eq!(
        lines,
        vec![
            (Some(alex), Some("Alex"), dec("200.00"), 1),
            (Some(sam), Some("Sam"), dec("140.00"), 2),
            (None, None, dec("22.00"), 1),
            (Some(robin), Some("Robin"), dec("0.00"), 0),
        ]
    );
    assert_eq!(result.total, dec("362.00"));
}

#[test]
fn members_must_exist_and_be_distinct() {
    let (store, sam, _, _) = family_household();
    assert!(store
        .ask_spending(&AskSpendFilter {
            member_ids: vec![99],
            ..march()
        })
        .is_err());
    assert!(store
        .ask_spending(&AskSpendFilter {
            member_ids: vec![sam, sam],
            ..march()
        })
        .is_err());
    assert!(store
        .ask_spending(&AskSpendFilter {
            member_ids: vec![0],
            ..march()
        })
        .is_err());
}

#[test]
fn several_categories_are_an_or_and_a_split_purchase_can_sit_in_two_lines() {
    let (store, _, _, _) = family_household();
    let result = ask(
        &store,
        AskSpendFilter {
            categories: vec!["Groceries".into(), "Shopping".into()],
            ..march()
        },
    );
    // Groceries 90.00 + 80.00 + 22.00 = 192.00 over 3 purchases; Shopping 120.00 over 1 (the split one); the refund is not spending.
    let lines: Vec<_> = result
        .category_totals
        .iter()
        .map(|c| (c.category.as_str(), c.total.to_string(), c.purchase_count))
        .collect();
    assert_eq!(lines, vec![("Groceries", "192.00".to_string(), 3), ("Shopping", "120.00".to_string(), 1)]);
    assert_eq!((result.total, result.purchase_count, result.shared_purchase_count), (dec("312.00"), 3, 1));
}

#[test]
fn categories_and_members_and_accounts_are_each_an_or_and_together_an_and() {
    let (store, sam, alex, _) = family_household();
    let result = ask(
        &store,
        AskSpendFilter {
            member_ids: vec![sam, alex],
            categories: vec!["Groceries".into(), "Fuel".into()],
            ..march()
        },
    );
    // Sam 90.00 + 50.00 and Alex's 80.00 groceries line; Alex's shopping line and the unassigned pharmacy are outside.
    assert_eq!((result.total, result.purchase_count), (dec("220.00"), 3));
}

#[test]
fn the_average_per_purchase_rounds_half_away_from_zero_and_never_invents_zero() {
    let store = Store::open_in_memory().unwrap();
    let everyday = account(&store, "Everyday");
    store.create_category("Shopping", None).unwrap();
    for (date, cents) in [
        ("2026-05-01", -20000),
        ("2026-05-02", -20050),
        ("2026-05-03", -2000),
        ("2026-05-04", -3000),
    ] {
        record(&store, everyday, date, "MALL", cents, Some("Shopping"), None);
    }
    let filter = AskSpendFilter {
        from: day("2026-05-01"),
        to: day("2026-05-31"),
        as_of: day("2026-06-15"),
        average: AskAverageKind::PerPurchase,
        ..Default::default()
    };
    let average = ask(&store, filter.clone()).average.unwrap();
    // 450.50 / 4 = 112.625, which rounds up to 112.63; the exact numbers travel with it.
    assert_eq!(
        (average.numerator, average.denominator, average.value),
        (dec("450.50"), 4, Some(dec("112.63")))
    );
    let empty = ask(
        &store,
        AskSpendFilter {
            from: day("2026-06-01"),
            to: day("2026-06-10"),
            ..filter
        },
    )
    .average
    .unwrap();
    assert_eq!((empty.value, empty.unavailable, empty.denominator), (None, Some("no-purchases"), 0));
}

#[test]
fn choices_that_do_not_combine_are_refused() {
    let (store, _, _, _) = family_household();
    let member_average = AskSpendFilter {
        group_by: AskGroupBy::Member,
        average: AskAverageKind::PerPurchase,
        ..march()
    };
    assert!(store.ask_spending(&member_average).is_err());
    let too_many = AskSpendFilter {
        categories: (0..21).map(|i| format!("Category {i}")).collect(),
        ..march()
    };
    assert!(store.ask_spending(&too_many).is_err());
}

fn compare(
    alignment: AskAlignment,
    first: (&str, &str),
    second: (&str, &str),
    a: &str,
    b: &str,
) -> Result<crate::store::AskComparisonResult, String> {
    ask_comparison(alignment, (day(first.0), day(first.1)), (day(second.0), day(second.1)), dec(a), dec(b))
}

#[test]
fn comparing_the_same_days_stops_at_the_end_of_a_shorter_month_and_gives_no_percentage() {
    let result = compare(
        AskAlignment::SameDaysPreviousMonth,
        ("2026-03-01", "2026-03-30"),
        ("2026-02-01", "2026-02-28"),
        "212.00",
        "130.00",
    )
    .unwrap();
    assert_eq!(result.clamped, Some((30, 28)));
    assert_eq!(
        (
            result.comparable,
            result.not_comparable_reason,
            result.percent_outcome,
            result.percent_change
        ),
        (false, Some("clamped"), "not-comparable", None)
    );
    assert_eq!((result.elapsed_days, result.absolute_change), (30, dec("82.00")));
}

#[test]
fn comparing_equal_lengths_gives_a_percentage_to_one_decimal_rounded_half_away_from_zero() {
    let plain = compare(
        AskAlignment::AsRequested,
        ("2026-06-01", "2026-06-15"),
        ("2026-05-01", "2026-05-15"),
        "30.00",
        "20.00",
    )
    .unwrap();
    assert_eq!((plain.percent_outcome, plain.percent_change), ("changed", Some(dec("50.0"))));
    let up = compare(
        AskAlignment::AsRequested,
        ("2026-06-01", "2026-06-15"),
        ("2026-05-01", "2026-05-15"),
        "200.50",
        "200.00",
    )
    .unwrap();
    assert_eq!(up.percent_change.map(|p| p.to_string()), Some("0.3".to_string())); // 0.25
    let down = compare(
        AskAlignment::AsRequested,
        ("2026-06-01", "2026-06-15"),
        ("2026-05-01", "2026-05-15"),
        "199.50",
        "200.00",
    )
    .unwrap();
    assert_eq!(down.percent_change.map(|p| p.to_string()), Some("-0.3".to_string())); // -0.25
    let to_zero = compare(
        AskAlignment::AsRequested,
        ("2026-06-01", "2026-06-15"),
        ("2026-05-01", "2026-05-15"),
        "0.00",
        "100.00",
    )
    .unwrap();
    assert_eq!(to_zero.percent_change.map(|p| p.to_string()), Some("-100.0".to_string()));
}

#[test]
fn a_zero_baseline_has_no_percentage_and_two_zeros_are_no_change() {
    let from_zero = compare(
        AskAlignment::AsRequested,
        ("2026-06-01", "2026-06-15"),
        ("2026-05-01", "2026-05-15"),
        "80.00",
        "0.00",
    )
    .unwrap();
    assert_eq!((from_zero.percent_outcome, from_zero.percent_change), ("from-zero", None));
    let both = compare(
        AskAlignment::AsRequested,
        ("2026-06-01", "2026-06-15"),
        ("2026-05-01", "2026-05-15"),
        "0.00",
        "0.00",
    )
    .unwrap();
    assert_eq!(
        (both.percent_outcome, both.percent_change.map(|p| p.to_string())),
        ("no-change", Some("0.0".to_string()))
    );
}

#[test]
fn unequal_lengths_are_not_comparable() {
    let result = compare(
        AskAlignment::AsRequested,
        ("2026-03-01", "2026-03-31"),
        ("2026-02-01", "2026-02-28"),
        "100.00",
        "50.00",
    )
    .unwrap();
    assert_eq!(
        (result.comparable, result.not_comparable_reason, result.percent_outcome),
        (false, Some("unequal-lengths"), "not-comparable")
    );
}

#[test]
fn an_aligned_comparison_must_be_exactly_the_alignment() {
    assert!(compare(
        AskAlignment::SameDaysPreviousMonth,
        ("2026-03-01", "2026-03-30"),
        ("2026-02-01", "2026-02-27"),
        "1",
        "1"
    )
    .is_err());
    assert!(compare(
        AskAlignment::SameDaysPreviousMonth,
        ("2026-03-05", "2026-03-30"),
        ("2026-02-05", "2026-02-28"),
        "1",
        "1"
    )
    .is_err());
    assert!(compare(
        AskAlignment::SameDaysPreviousYear,
        ("2026-01-01", "2026-03-30"),
        ("2025-01-01", "2025-03-29"),
        "1",
        "1"
    )
    .is_err());
    let ok = compare(
        AskAlignment::SameDaysPreviousMonth,
        ("2026-01-01", "2026-01-20"),
        ("2025-12-01", "2025-12-20"),
        "10.00",
        "20.00",
    )
    .unwrap();
    assert_eq!(
        (ok.percent_outcome, ok.percent_change.map(|p| p.to_string())),
        ("changed", Some("-50.0".to_string()))
    );
}

#[test]
fn the_previous_year_of_29_february_is_28_february() {
    let result = compare(
        AskAlignment::SameDaysPreviousYear,
        ("2028-01-01", "2028-02-29"),
        ("2027-01-01", "2027-02-28"),
        "60.00",
        "55.00",
    )
    .unwrap();
    assert_eq!(
        (result.clamped, result.not_comparable_reason, result.comparable),
        (Some((60, 59)), Some("clamped"), false)
    );
}

#[test]
fn an_account_that_keeps_recording_cannot_hide_another_that_stopped() {
    let (store, _, _) = gap_household();
    // Card's June purchase is removed, so Card's last record is 18 May while Everyday continues into June.
    let june = store
        .conn
        .query_row("SELECT id FROM transactions WHERE date='2026-06-10'", [], |r| r.get::<_, i64>(0))
        .unwrap();
    store.conn.execute("DELETE FROM transactions WHERE id=?1", [june]).unwrap();
    let result = ask(&store, by_month(vec![], "Groceries", AskAverageKind::PerMonth));
    assert_eq!(
        (result.recorded_from, result.recorded_through),
        (Some(day("2026-02-12")), Some(day("2026-05-18")))
    );
    let coverage: Vec<_> = result.months.iter().map(|m| m.coverage).collect();
    assert_eq!(coverage, [BeforeRecords, PartlyRecorded, NoRecords, Complete, RecordsEnd, RecordsEnd]);
    let average = result.average.unwrap();
    // Only April is trusted: 110.00 / 1. May is left out because Card may have stopped importing; the total still holds all spending.
    assert_eq!(
        (average.numerator, average.denominator, average.value),
        (dec("110.00"), 1, Some(dec("110.00")))
    );
    assert_eq!(result.total, dec("575.00"));
}

#[test]
fn accounts_whose_recording_never_overlaps_give_no_average() {
    let store = Store::open_in_memory().unwrap();
    let (early, late) = (account(&store, "Early"), account(&store, "Late"));
    let _ = store.create_category("Groceries", None);
    record(&store, early, "2026-01-05", "KROGER", -10000, Some("Groceries"), None);
    record(&store, late, "2026-05-18", "ALDI", -2500, Some("Groceries"), None);
    let result = ask(&store, by_month(vec![], "Groceries", AskAverageKind::PerMonth));
    // Latest first record 18 May, earliest last record 5 Jan: the dates cross, are kept as they are, and no month is complete.
    assert_eq!(
        (result.recorded_from, result.recorded_through),
        (Some(day("2026-05-18")), Some(day("2026-01-05")))
    );
    let average = result.average.unwrap();
    assert_eq!(
        (average.value, average.unavailable, average.denominator),
        (None, Some("no-complete-months"), 0)
    );
}

#[test]
fn a_split_by_family_member_is_refused_past_fifty_lines_rather_than_cut_off() {
    let store = Store::open_in_memory().unwrap();
    for i in 0..50 {
        store.create_family_member(&format!("Person {i}")).unwrap();
    }
    // 50 people plus the unassigned line is 51 lines, which cannot be shown without leaving some out.
    assert!(store
        .ask_spending(&AskSpendFilter {
            group_by: AskGroupBy::Member,
            ..march()
        })
        .is_err());
    // Choosing a few people is fine however many the household has.
    let few = AskSpendFilter {
        group_by: AskGroupBy::Member,
        member_ids: vec![1, 2],
        ..march()
    };
    assert_eq!(ask(&store, few).member_totals.len(), 2);
}

#[test]
fn a_split_by_family_member_of_forty_nine_people_still_fits() {
    let store = Store::open_in_memory().unwrap();
    for i in 0..49 {
        store.create_family_member(&format!("Person {i}")).unwrap();
    }
    assert_eq!(
        ask(
            &store,
            AskSpendFilter {
                group_by: AskGroupBy::Member,
                ..march()
            }
        )
        .member_totals
        .len(),
        50
    );
}

#[test]
fn accounts_with_matching_purchases_only_outside_the_period_still_set_the_evidence() {
    let store = Store::open_in_memory().unwrap();
    let (early, late, later) = (account(&store, "Early"), account(&store, "Late"), account(&store, "Later"));
    let _ = store.create_category("Groceries", None);
    let groceries = Some("Groceries");
    // Early's only matching purchase is before the period, Late's are in and around it, Later's only one is after it.
    record(&store, early, "2025-12-05", "KROGER", -1000, groceries, None);
    record(&store, late, "2026-01-10", "ALDI", -2000, groceries, None);
    record(&store, late, "2026-02-03", "ALDI", -3000, groceries, None);
    record(&store, later, "2026-03-10", "MEIJER", -4000, groceries, None);
    let result = ask(
        &store,
        AskSpendFilter {
            from: day("2026-02-01"),
            to: day("2026-02-28"),
            as_of: day("2026-03-30"),
            categories: vec!["Groceries".into()],
            group_by: AskGroupBy::Month,
            ..Default::default()
        },
    );
    // Latest first record: Later's 10 March. Earliest last record: Early's 5 December.
    assert_eq!(
        (result.recorded_from, result.recorded_through),
        (Some(day("2026-03-10")), Some(day("2025-12-05")))
    );
    assert_eq!(result.total, dec("30.00"));
    assert_eq!(result.months.iter().map(|m| m.coverage).collect::<Vec<_>>(), [BeforeRecords]);
}

#[test]
fn m4_batch_matches_independent_categories_with_distinct_coverage_and_outside_evidence() {
    let (store, _, _) = gap_household();
    let categories = vec!["Travel".to_string(), "Groceries".to_string()];
    let batch = store.ask_baseline_bundle(&categories, day("2026-07-10")).expect("batch baseline");
    assert_eq!(batch.iter().map(|r| r.0.as_str()).collect::<Vec<_>>(), ["Travel", "Groceries"]);
    for (name, result) in batch {
        let old = ask(
            &store,
            AskSpendFilter {
                from: day("2026-04-01"),
                to: day("2026-06-30"),
                as_of: day("2026-07-10"),
                categories: vec![name],
                group_by: AskGroupBy::Month,
                average: AskAverageKind::PerMonth,
                ..Default::default()
            },
        );
        assert_eq!(result.months, old.months);
        assert_eq!(result.total, old.total);
        assert_eq!(result.purchase_count, old.purchase_count);
        assert_eq!(result.recorded_from, old.recorded_from);
        assert_eq!(result.recorded_through, old.recorded_through);
        assert_eq!(result.average, old.average);
    }
}
#[test]
fn m4_batch_fresh_transfer_and_generated_payment_fixture_keeps_source_purchase_once() {
    let store = Store::open_in_memory().unwrap();
    let (a, b) = (account(&store, "Current"), account(&store, "Savings"));
    let loan = store.get_or_create_account("Loan", AccountType::Loan).unwrap();
    store.create_category("Fixture", None).unwrap();
    store.create_category("Other", None).unwrap();
    for (date, cents, cat) in [
        ("2026-03-01", 0, "Fixture"),
        ("2026-04-10", -1234, "Fixture"),
        ("2026-05-10", -2345, "Fixture"),
        ("2026-06-10", -3456, "Fixture"),
        ("2026-07-10", 0, "Fixture"),
    ] {
        record(&store, a, date, "ordinary", cents, Some(cat), None);
    }
    let out = record(&store, a, "2026-05-12", "linked out", -3000, Some("Fixture"), None);
    let incoming = record(&store, b, "2026-05-12", "linked in", 3000, Some("Other"), None);
    assert!(store.link_transfer(out, incoming).unwrap());
    // A split on an excluded transfer leg must not reintroduce it.
    store
        .conn
        .execute(
            "INSERT INTO transaction_splits(transaction_id,category,amount) VALUES (?1,'Fixture','-30.00')",
            [out],
        )
        .unwrap();
    record(&store, a, "2026-05-12", "category transfer", -4000, Some("Transfer"), None);
    let source = record(&store, a, "2026-05-13", "source payment", -1000, Some("Fixture"), None);
    store.apply_debt_payment(source, loan, Decimal::from(10), day("2026-05-13")).unwrap();
    let generated: i64 = store
        .conn
        .query_row(
            "SELECT generated_transaction_id FROM debt_payments WHERE source_transaction_id=?1",
            [source],
            |r| r.get(0),
        )
        .unwrap();
    // Make the generated leg negative and split: sign alone must never be the exclusion.
    store
        .conn
        .execute("UPDATE transactions SET category='Fixture',amount='-999.00' WHERE id=?1", [generated])
        .unwrap();
    store
        .conn
        .execute(
            "INSERT INTO transaction_splits(transaction_id,category,amount) VALUES (?1,'Fixture','-999.00')",
            [generated],
        )
        .unwrap();
    let read = || store.ask_baseline_bundle(&["Fixture".into(), "Other".into()], day("2026-07-10")).unwrap();
    let before = store.read_revision().unwrap();
    let batch = read();
    assert_eq!(store.read_revision().unwrap(), before);
    assert_eq!(
        batch[0].1.months.iter().map(|r| r.total).collect::<Vec<_>>(),
        [dec("12.34"), dec("33.45"), dec("34.56")]
    );
    assert_eq!(batch[0].1.total, dec("80.35"));
    assert_eq!(batch[1].1.total, Decimal::ZERO);
    let old = ask(
        &store,
        AskSpendFilter {
            from: day("2026-04-01"),
            to: day("2026-06-30"),
            as_of: day("2026-07-10"),
            categories: vec!["Fixture".into()],
            group_by: AskGroupBy::Month,
            average: AskAverageKind::PerMonth,
            ..Default::default()
        },
    );
    assert_eq!(batch[0].1.months, old.months);
    store
        .delete_transaction(incoming, day("2026-07-10").and_hms_opt(0, 0, 0).unwrap())
        .unwrap();
    assert_eq!(read()[0].1.total, dec("110.35"));
    store.restore_transactions(&[incoming]).unwrap();
    assert_eq!(read()[0].1.total, dec("80.35"));
}
#[test]
fn m4_batch_rejects_invalid_selections_without_partial_answers() {
    let store = Store::open_in_memory().unwrap();
    store.create_category("A", None).unwrap();
    for names in [
        vec![],
        vec!["A".into(), "A".into()],
        vec!["missing".into()],
        vec![" ".into()],
        (0..21).map(|i| format!("C{i}")).collect(),
    ] {
        assert!(store.ask_baseline_bundle(&names, day("2026-07-10")).is_err());
    }
}

#[test]
fn m4_batch_twenty_categories_differential_covers_split_refund_deleted_and_outside_rows() {
    for seed in 0..12 {
        let store = Store::open_in_memory().unwrap();
        let accounts = [account(&store, "A"), account(&store, "B"), account(&store, "C")];
        let categories: Vec<String> = (0..20).map(|i| format!("Category {i:02}")).collect();
        for c in &categories {
            store.create_category(c, None).unwrap();
        }
        for i in 0..120 {
            let c = &categories[(i + seed) % 20];
            let date = format!("2026-{:02}-{:02}", 1 + (i * 7 + seed) % 10, 1 + (i * 11) % 27);
            let id = record(
                &store,
                accounts[(i + seed) % 3],
                &date,
                "fixture",
                if i % 11 == 0 { 900 } else { -((i + seed + 1) as i64) },
                Some(c),
                None,
            );
            if i % 17 == 0 {
                split(&store, id, &[(c.as_str(), -30), (categories[(i + seed + 1) % 20].as_str(), -40)]);
            }
            if i % 23 == 0 {
                store.delete_transaction(id, day("2026-10-16").and_hms_opt(0, 0, 0).unwrap()).unwrap();
            }
        }
        // Greater than JS safe integer plus sub-cent native precision, in a category without overflow.
        store
            .conn
            .execute(
                "UPDATE transactions SET amount='-9007199254740993.001' WHERE id=(SELECT MAX(id) FROM transactions WHERE deleted_at IS NULL)",
                [],
            )
            .unwrap();
        let before = store.read_revision().unwrap();
        let bundle = store.ask_baseline_bundle(&categories, day("2026-10-16")).unwrap();
        assert_eq!(before, store.read_revision().unwrap());
        for (c, batch) in bundle {
            let old = ask(
                &store,
                AskSpendFilter {
                    from: day("2026-07-01"),
                    to: day("2026-09-30"),
                    as_of: day("2026-10-16"),
                    categories: vec![c],
                    group_by: AskGroupBy::Month,
                    average: AskAverageKind::PerMonth,
                    ..Default::default()
                },
            );
            assert_eq!(batch.months, old.months);
            assert_eq!(batch.average, old.average);
            assert_eq!(batch.total, old.total);
            assert_eq!(batch.purchase_count, old.purchase_count);
            assert_eq!(batch.category_count, old.category_count);
            assert_eq!(batch.recorded_from, old.recorded_from);
            assert_eq!(batch.recorded_through, old.recorded_through);
            assert_eq!(batch.earliest_record, old.earliest_record);
        }
    }
}
