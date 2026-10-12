//! Pairing statement rows with the account's not-yet-settled transactions, one to one. An amount must
//! be exactly equal; a date within 3 days matches automatically, 4–10 days (or a tie between two
//! different candidates) is only a possible match the person confirms.

use super::layout::SignRules;
use super::model::Period;
pub use crate::store::AccountKind;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::collections::HashSet;

pub const AUTO_DAYS: i64 = 3;
pub const POSSIBLE_DAYS: i64 = 10;

/// Statement amount (statement's own terms) → the app's sign for this kind of account.
pub fn to_app_amount(printed: Decimal, kind: AccountKind, signs: &SignRules, flip: bool) -> Decimal {
    let (base, layout_flip) = match kind {
        AccountKind::Cash => (printed, signs.flip_cash),
        AccountKind::Credit => (-printed, signs.flip_credit),
        AccountKind::Loan => (printed, signs.flip_loan),
        AccountKind::Investment => (printed, signs.flip_investment),
    };
    if layout_flip != flip { -base } else { base }
}

#[derive(Debug, Clone, PartialEq)]
pub struct StatementItem {
    pub index: usize,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AppItem {
    pub id: i64,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct MatchResult {
    pub matched: Vec<(usize, i64)>,
    pub possible: Vec<(usize, Vec<i64>)>,
    pub missing: Vec<usize>,
    pub not_on_statement: Vec<i64>,
}

/// (days apart, -similarity, item position, app position)
type Pair = (i64, i64, usize, usize);

fn words(s: &str) -> HashSet<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() >= 3)
        .map(str::to_string)
        .collect()
}

/// Shared-word share of two descriptions, 0–1000.
fn similarity(a: &str, b: &str) -> i64 {
    let (a, b) = (words(a), words(b));
    let union = a.union(&b).count();
    (a.intersection(&b).count() * 1000).checked_div(union).unwrap_or(0) as i64
}

pub fn match_items(items: &[StatementItem], app: &[AppItem], period: &Period) -> MatchResult {
    let mut pairs: Vec<Pair> = Vec::new();
    // Only transactions inside the period (with a week of leeway) are ever candidates.
    let eligible: Vec<bool> = app.iter().map(|a| period.contains_with_leeway(a.date)).collect();
    for (ii, item) in items.iter().enumerate() {
        for (ai, a) in app.iter().enumerate() {
            if !eligible[ai] {
                continue;
            }
            let days = (a.date - item.date).num_days().abs();
            if a.amount == item.amount && days <= AUTO_DAYS {
                pairs.push((days, -similarity(&item.description, &a.description), ii, ai));
            }
        }
    }
    pairs.sort();
    let same_app = |x: usize, y: usize| {
        app[x].date == app[y].date && app[x].amount == app[y].amount && app[x].description.eq_ignore_ascii_case(&app[y].description)
    };

    let mut result = MatchResult::default();
    let mut used_item = vec![false; items.len()];
    let mut used_app = vec![false; app.len()];
    let mut in_possible: HashSet<usize> = HashSet::new();
    for &(days, sim, ii, ai) in &pairs {
        if used_item[ii] || used_app[ai] {
            continue;
        }
        let ties: Vec<usize> = pairs
            .iter()
            .filter(|&&(d, s, i, a)| i == ii && a != ai && d == days && s == sim && !used_app[a] && !same_app(a, ai))
            .map(|&(_, _, _, a)| a)
            .collect();
        used_item[ii] = true;
        if ties.is_empty() {
            used_app[ai] = true;
            result.matched.push((items[ii].index, app[ai].id));
        } else {
            let mut ids: Vec<i64> = std::iter::once(ai).chain(ties.iter().copied()).map(|a| app[a].id).collect();
            ids.sort();
            in_possible.extend(std::iter::once(ai).chain(ties));
            result.possible.push((items[ii].index, ids));
        }
    }
    for (ii, item) in items.iter().enumerate() {
        if used_item[ii] {
            continue;
        }
        let ids: Vec<i64> = app
            .iter()
            .enumerate()
            .filter(|(ai, a)| eligible[*ai] && !used_app[*ai] && a.amount == item.amount && (a.date - item.date).num_days().abs() <= POSSIBLE_DAYS)
            .map(|(ai, a)| {
                in_possible.insert(ai);
                a.id
            })
            .collect();
        if ids.is_empty() {
            result.missing.push(item.index)
        } else {
            result.possible.push((item.index, ids))
        }
    }
    // A transaction taken by an automatic match is never also offered as a possibility.
    let taken: HashSet<i64> = app.iter().enumerate().filter(|(ai, _)| used_app[*ai]).map(|(_, a)| a.id).collect();
    let mut still_possible = Vec::new();
    for (idx, mut ids) in std::mem::take(&mut result.possible) {
        ids.retain(|id| !taken.contains(id));
        if ids.is_empty() {
            result.missing.push(idx);
        } else {
            still_possible.push((idx, ids));
        }
    }
    result.possible = still_possible;
    result.missing.sort();
    result.matched.sort();
    result.possible.sort();
    result.not_on_statement = app
        .iter()
        .enumerate()
        .filter(|(ai, a)| !used_app[*ai] && !in_possible.contains(ai) && period.contains(a.date))
        .map(|(_, a)| a.id)
        .collect();
    result
}

/// Suggest reversing every sign when that matches strictly more rows and at least half of them.
pub fn suggest_flip(items: &[StatementItem], app: &[AppItem], period: &Period) -> bool {
    let normal = match_items(items, app, period).matched.len();
    let flipped: Vec<StatementItem> = items
        .iter()
        .map(|i| StatementItem {
            amount: -i.amount,
            ..i.clone()
        })
        .collect();
    let reversed = match_items(&flipped, app, period).matched.len();
    reversed > normal && reversed * 2 >= items.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn d(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }
    fn p() -> Period {
        Period::new(d("2026-08-01"), d("2026-08-31")).unwrap()
    }
    fn item(i: usize, date: &str, desc: &str, amt: Decimal) -> StatementItem {
        StatementItem {
            index: i,
            date: d(date),
            description: desc.into(),
            amount: amt,
        }
    }
    fn app(id: i64, date: &str, desc: &str, amt: Decimal) -> AppItem {
        AppItem {
            id,
            date: d(date),
            description: desc.into(),
            amount: amt,
        }
    }

    #[test]
    fn signs_follow_the_account_kind() {
        let s = SignRules::default();
        assert_eq!(to_app_amount(dec!(7.40), AccountKind::Credit, &s, false), dec!(-7.40));
        assert_eq!(to_app_amount(dec!(-43.08), AccountKind::Credit, &s, false), dec!(43.08));
        assert_eq!(to_app_amount(dec!(-10.84), AccountKind::Cash, &s, false), dec!(-10.84));
        assert_eq!(to_app_amount(dec!(2405.94), AccountKind::Loan, &s, false), dec!(2405.94));
        assert_eq!(to_app_amount(dec!(-10.84), AccountKind::Cash, &s, true), dec!(10.84));
        let flipped = SignRules {
            flip_credit: true,
            ..Default::default()
        };
        assert_eq!(to_app_amount(dec!(7.40), AccountKind::Credit, &flipped, false), dec!(7.40));
    }

    #[test]
    fn exact_amount_within_three_days_matches_closest_date_first() {
        let r = match_items(
            &[item(0, "2026-08-10", "COFFEE SHOP", dec!(-4.50))],
            &[app(1, "2026-08-13", "Coffee", dec!(-4.50)), app(2, "2026-08-11", "Coffee", dec!(-4.50))],
            &p(),
        );
        assert_eq!(r.matched, vec![(0, 2)]);
        assert_eq!(r.not_on_statement, vec![1]);
    }

    #[test]
    fn a_cent_off_never_matches() {
        let r = match_items(
            &[item(0, "2026-08-10", "Gas", dec!(-30.00))],
            &[app(1, "2026-08-10", "Gas", dec!(-30.01))],
            &p(),
        );
        assert_eq!((r.matched.len(), r.missing), (0, vec![0]));
    }

    #[test]
    fn four_to_ten_days_off_is_only_possible() {
        let r = match_items(
            &[item(0, "2026-08-10", "Rent", dec!(-900))],
            &[app(1, "2026-08-17", "Rent", dec!(-900))],
            &p(),
        );
        assert_eq!(r.possible, vec![(0, vec![1])]);
        assert!(r.matched.is_empty() && r.not_on_statement.is_empty());
    }

    #[test]
    fn two_different_equally_good_candidates_are_possible_not_guessed() {
        let r = match_items(
            &[item(0, "2026-08-10", "TRANSFER", dec!(-50))],
            &[app(1, "2026-08-09", "Savings", dec!(-50)), app(2, "2026-08-11", "Gift", dec!(-50))],
            &p(),
        );
        assert_eq!(r.possible, vec![(0, vec![1, 2])]);
    }

    #[test]
    fn the_better_description_breaks_a_date_tie() {
        let r = match_items(
            &[item(0, "2026-08-10", "CORNER CAFE SPRINGFIELD", dec!(-4.50))],
            &[
                app(1, "2026-08-11", "Bakery", dec!(-4.50)),
                app(2, "2026-08-09", "Corner Cafe", dec!(-4.50)),
            ],
            &p(),
        );
        assert_eq!(r.matched, vec![(0, 2)]);
    }

    #[test]
    fn identical_twins_match_one_to_one_instead_of_staying_possible() {
        let r = match_items(
            &[item(0, "2026-08-10", "COFFEE", dec!(-4.50)), item(1, "2026-08-10", "COFFEE", dec!(-4.50))],
            &[app(5, "2026-08-10", "Coffee", dec!(-4.50)), app(6, "2026-08-10", "Coffee", dec!(-4.50))],
            &p(),
        );
        assert_eq!(r.matched, vec![(0, 5), (1, 6)]);
        assert!(r.possible.is_empty());
    }

    #[test]
    fn a_flip_is_suggested_only_when_clearly_better() {
        let items = [item(0, "2026-08-03", "A", dec!(7.40)), item(1, "2026-08-04", "B", dec!(2.99))];
        let app_items = [app(1, "2026-08-03", "A", dec!(-7.40)), app(2, "2026-08-04", "B", dec!(-2.99))];
        assert!(suggest_flip(&items, &app_items, &p()));
        let right = [item(0, "2026-08-03", "A", dec!(-7.40)), item(1, "2026-08-04", "B", dec!(-2.99))];
        assert!(!suggest_flip(&right, &app_items, &p()));
    }

    #[test]
    fn transactions_outside_the_period_leeway_are_never_candidates() {
        let r = match_items(
            &[item(0, "2026-08-02", "Gas", dec!(-30))],
            &[app(1, "2026-07-20", "Gas", dec!(-30))],
            &p(),
        );
        assert_eq!(r.missing, vec![0]);
        assert!(r.matched.is_empty() && r.possible.is_empty() && r.not_on_statement.is_empty());
    }

    #[test]
    fn accented_and_dashed_descriptions_do_not_panic() {
        let r = match_items(
            &[item(0, "2026-08-10", "CAF\u{c9}\u{a0}\u{2013} R\u{c9}SUM\u{c9}", dec!(-4.50))],
            &[app(1, "2026-08-10", "Caf\u{e9} r\u{e9}sum\u{e9}", dec!(-4.50))],
            &p(),
        );
        assert_eq!(r.matched, vec![(0, 1)]);
    }

    #[test]
    fn a_transaction_matched_automatically_is_not_also_offered_as_possible() {
        let r = match_items(
            &[item(0, "2026-08-10", "X", dec!(-50)), item(1, "2026-08-11", "Y", dec!(-50))],
            &[app(1, "2026-08-10", "Savings", dec!(-50)), app(2, "2026-08-12", "Gift", dec!(-50))],
            &p(),
        );
        for (_, ids) in &r.possible {
            assert!(!r.matched.iter().any(|m| ids.contains(&m.1)));
        }
        let mut ids: Vec<i64> = r.matched.iter().map(|m| m.1).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), r.matched.len());
    }

    #[test]
    fn no_flip_when_fewer_than_half_would_match() {
        let items = [
            item(0, "2026-08-03", "A", dec!(7.40)),
            item(1, "2026-08-04", "B", dec!(1)),
            item(2, "2026-08-05", "C", dec!(2)),
            item(3, "2026-08-06", "D", dec!(3)),
        ];
        let app_items = [app(1, "2026-08-03", "A", dec!(-7.40))];
        assert!(!suggest_flip(&items, &app_items, &p()));
    }
}
