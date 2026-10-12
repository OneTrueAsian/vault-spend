//! Pairing statement rows with the account's not-yet-settled transactions, one to one. An amount must
//! be exactly equal; a date within 3 days matches automatically, 4–10 days (or a tie between two
//! different candidates) is only a possible match the person confirms.

use super::layout::SignRules;
use super::model::Period;
pub use crate::store::AccountKind;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::collections::{BTreeMap, HashSet};

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

/// The one normalisation used for both "are these two the same" and the similarity score: Unicode
/// lowercase, trimmed, runs of whitespace (including non-breaking spaces) collapsed to one space.
fn normalise(s: &str) -> String {
    s.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn words(norm: &str) -> HashSet<&str> {
    norm.split(|c: char| !c.is_alphanumeric()).filter(|w| w.chars().count() >= 3).collect()
}

/// How good an automatic pairing is: fewer days apart wins, then a larger share of shared words.
/// The share is kept as an exact fraction (`shared / total`, total at least 1), never a float.
#[derive(Debug, Clone, Copy)]
struct Key {
    days: i64,
    shared: u64,
    total: u64,
}

impl Key {
    fn beats(&self, other: &Key) -> bool {
        self.days < other.days || (self.days == other.days && self.shared * other.total > other.shared * self.total)
    }
}

/// The candidate that is STRICTLY better than every other one; `None` when the best is tied (or there
/// are no candidates), because a tie must never be settled by guessing.
fn strict_best(candidates: impl Iterator<Item = (usize, Key)>) -> Option<usize> {
    let all: Vec<(usize, Key)> = candidates.collect();
    let mut best = *all.first()?;
    for &c in &all[1..] {
        if c.1.beats(&best.1) {
            best = c;
        }
    }
    all.iter().all(|c| c.0 == best.0 || best.1.beats(&c.1)).then_some(best.0)
}

/// Statement rows (or app items) that are identical in date, amount and description. Their members
/// are interchangeable, so they are handled as one unit.
struct Class {
    date: NaiveDate,
    amount: Decimal,
    norm: String,
    /// Positions in the input slice, ordered by row `index` / app `id`.
    members: Vec<usize>,
}

type ClassKey = (NaiveDate, Decimal, String);

fn classes(entries: impl Iterator<Item = (usize, NaiveDate, Decimal, String, i64)>) -> Vec<Class> {
    let mut map: BTreeMap<ClassKey, Vec<(i64, usize)>> = BTreeMap::new();
    for (pos, date, amount, norm, order) in entries {
        map.entry((date, amount, norm)).or_default().push((order, pos));
    }
    map.into_iter()
        .map(|((date, amount, norm), mut m)| {
            m.sort();
            Class {
                date,
                amount,
                norm,
                members: m.into_iter().map(|(_, pos)| pos).collect(),
            }
        })
        .collect()
}

/// Pair statement rows with the account's transactions, one to one.
///
/// A pairing is automatic only when it is MUTUALLY best: the transaction is strictly the best
/// candidate for the row AND the row is strictly the best candidate for the transaction. Anything
/// tied on either side is left for the person (possible), so the answer never depends on input order.
pub fn match_items(items: &[StatementItem], app: &[AppItem], period: &Period) -> MatchResult {
    let mut rows = classes(
        items
            .iter()
            .enumerate()
            .map(|(i, r)| (i, r.date, r.amount, normalise(&r.description), r.index as i64)),
    );
    let mut apps = classes(
        app.iter()
            .enumerate()
            .map(|(i, a)| (i, a.date, a.amount, normalise(&a.description), a.id)),
    );
    // Only transactions inside the period (with a week of leeway) are ever candidates.
    let eligible: Vec<bool> = apps.iter().map(|a| period.contains_with_leeway(a.date)).collect();

    let keys: Vec<Vec<Option<Key>>> = rows
        .iter()
        .map(|r| {
            let rw = words(&r.norm);
            apps.iter()
                .enumerate()
                .map(|(ai, a)| {
                    let days = (a.date - r.date).num_days().abs();
                    (eligible[ai] && a.amount == r.amount && days <= AUTO_DAYS).then(|| {
                        let aw = words(&a.norm);
                        Key {
                            days,
                            shared: rw.intersection(&aw).count() as u64,
                            total: (rw.union(&aw).count() as u64).max(1),
                        }
                    })
                })
                .collect()
        })
        .collect();

    let mut result = MatchResult::default();
    loop {
        let row_best: Vec<Option<usize>> = (0..rows.len())
            .map(|r| {
                if rows[r].members.is_empty() {
                    return None;
                }
                strict_best(
                    (0..apps.len())
                        .filter(|&a| !apps[a].members.is_empty())
                        .filter_map(|a| keys[r][a].map(|k| (a, k))),
                )
            })
            .collect();
        let app_best: Vec<Option<usize>> = (0..apps.len())
            .map(|a| {
                if apps[a].members.is_empty() {
                    return None;
                }
                strict_best(
                    (0..rows.len())
                        .filter(|&r| !rows[r].members.is_empty())
                        .filter_map(|r| keys[r][a].map(|k| (r, k))),
                )
            })
            .collect();
        let mutual: Vec<(usize, usize)> = row_best
            .iter()
            .enumerate()
            .filter_map(|(r, a)| a.filter(|&a| app_best[a] == Some(r)).map(|a| (r, a)))
            .collect();
        if mutual.is_empty() {
            break;
        }
        for (r, a) in mutual {
            let n = rows[r].members.len().min(apps[a].members.len());
            let (rm, am): (Vec<usize>, Vec<usize>) = (rows[r].members.drain(..n).collect(), apps[a].members.drain(..n).collect());
            for (ri, ai) in rm.into_iter().zip(am) {
                result.matched.push((items[ri].index, app[ai].id));
            }
        }
    }

    // Whatever is left over: possible (exact amount within 10 days, not already taken), or missing.
    let free_app: Vec<usize> = apps
        .iter()
        .enumerate()
        .filter(|(ai, _)| eligible[*ai])
        .flat_map(|(_, a)| a.members.iter().copied())
        .collect();
    let mut offered: HashSet<usize> = HashSet::new();
    for ri in rows.iter().flat_map(|r| r.members.iter().copied()) {
        let item = &items[ri];
        let mut ids: Vec<i64> = free_app
            .iter()
            .filter(|&&ai| app[ai].amount == item.amount && (app[ai].date - item.date).num_days().abs() <= POSSIBLE_DAYS)
            .map(|&ai| {
                offered.insert(ai);
                app[ai].id
            })
            .collect();
        if ids.is_empty() {
            result.missing.push(item.index);
        } else {
            ids.sort();
            result.possible.push((item.index, ids));
        }
    }
    result.not_on_statement = apps
        .iter()
        .flat_map(|a| a.members.iter().copied())
        .filter(|ai| !offered.contains(ai) && period.contains(app[*ai].date))
        .map(|ai| app[ai].id)
        .collect();
    result.matched.sort();
    result.possible.sort();
    result.missing.sort();
    result.not_on_statement.sort();
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

    // ---- round 2: symmetric, order-independent matching ----

    /// Tiny fixed-seed generator so the shuffles need no new dependency and never change between runs.
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> usize {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (self.0 >> 33) as usize
        }
    }
    fn shuffled<T: Clone>(v: &[T], rng: &mut Lcg) -> Vec<T> {
        let mut out = v.to_vec();
        for i in (1..out.len()).rev() {
            out.swap(i, rng.next() % (i + 1));
        }
        out
    }
    fn assert_same_for_every_order(rows: &[StatementItem], apps: &[AppItem]) -> MatchResult {
        let base = match_items(rows, apps, &p());
        let mut rng = Lcg(42);
        for _ in 0..200 {
            let got = match_items(&shuffled(rows, &mut rng), &shuffled(apps, &mut rng), &p());
            assert_eq!(got, base, "result changed with the input order");
        }
        base
    }

    #[test]
    fn row_side_tie_is_never_guessed_whatever_the_order() {
        // X(10) and Y(12) are both one day from A(11); X is also two days from B(8).
        let rows = [item(0, "2026-08-10", "Coffee", dec!(-5)), item(1, "2026-08-12", "Coffee", dec!(-5))];
        let apps = [app(1, "2026-08-11", "Coffee", dec!(-5)), app(2, "2026-08-08", "Coffee", dec!(-5))];
        let r = assert_same_for_every_order(&rows, &apps);
        assert!(r.matched.is_empty());
        assert_eq!(r.possible, vec![(0, vec![1, 2]), (1, vec![1, 2])]);
        assert!(r.missing.is_empty() && r.not_on_statement.is_empty());
    }

    #[test]
    fn two_different_rows_around_one_item_tie() {
        let rows = [item(0, "2026-08-09", "Coffee", dec!(-5)), item(1, "2026-08-11", "Coffee", dec!(-5))];
        let apps = [app(7, "2026-08-10", "Coffee", dec!(-5))];
        let r = assert_same_for_every_order(&rows, &apps);
        assert!(r.matched.is_empty());
        assert_eq!(r.possible, vec![(0, vec![7]), (1, vec![7])]);
        assert!(r.not_on_statement.is_empty());
    }

    #[test]
    fn a_chain_resolves_in_later_passes_in_any_order() {
        // X(10) is best with A(10); that leaves Y(11) with only B(12).
        let rows = [item(0, "2026-08-10", "Coffee", dec!(-5)), item(1, "2026-08-11", "Coffee", dec!(-5))];
        let apps = [app(1, "2026-08-10", "Coffee", dec!(-5)), app(2, "2026-08-12", "Coffee", dec!(-5))];
        let r = assert_same_for_every_order(&rows, &apps);
        assert_eq!(r.matched, vec![(0, 1), (1, 2)]);
        assert!(r.possible.is_empty() && r.missing.is_empty() && r.not_on_statement.is_empty());
    }

    #[test]
    fn identical_twins_pair_in_any_order_but_slightly_different_items_stay_possible() {
        let rows = [
            item(0, "2026-08-10", "COFFEE", dec!(-4.50)),
            item(1, "2026-08-10", "coffee ", dec!(-4.50)),
        ];
        let twins = [app(5, "2026-08-10", "Coffee", dec!(-4.50)), app(6, "2026-08-10", "Coffee", dec!(-4.50))];
        let r = assert_same_for_every_order(&rows, &twins);
        assert_eq!(r.matched, vec![(0, 5), (1, 6)]);
        // Two identical rows but items a day either side: every pairing ties, so nothing is guessed.
        let apart = [app(5, "2026-08-09", "Coffee", dec!(-4.50)), app(6, "2026-08-11", "Coffee", dec!(-4.50))];
        let r = assert_same_for_every_order(&rows, &apart);
        assert!(r.matched.is_empty());
        assert_eq!(r.possible, vec![(0, vec![5, 6]), (1, vec![5, 6])]);
    }

    #[test]
    fn a_mixed_statement_gives_the_same_answer_in_every_order() {
        let rows = [
            item(0, "2026-08-05", "RENT", dec!(-900)),
            item(1, "2026-08-10", "COFFEE", dec!(-4.50)),
            item(2, "2026-08-10", "COFFEE", dec!(-4.50)),
            item(3, "2026-08-15", "GAS", dec!(-30.00)),
            item(4, "2026-08-20", "GYM", dec!(-25)),
            item(5, "2026-08-02", "OLD", dec!(-7)),
        ];
        let apps = [
            app(10, "2026-08-05", "Rent", dec!(-900)),
            app(11, "2026-08-10", "Coffee", dec!(-4.50)),
            app(12, "2026-08-10", "Coffee", dec!(-4.50)),
            app(13, "2026-08-15", "Gas", dec!(-30.01)),
            app(14, "2026-08-28", "Gym", dec!(-25)),
            app(15, "2026-07-20", "Old", dec!(-7)),
            app(16, "2026-08-25", "Other", dec!(-3)),
        ];
        let r = assert_same_for_every_order(&rows, &apps);
        assert_eq!(r.matched, vec![(0, 10), (1, 11), (2, 12)]);
        assert_eq!(r.possible, vec![(4, vec![14])]);
        assert_eq!(r.missing, vec![3, 5]);
        assert_eq!(r.not_on_statement, vec![13, 16]);
    }

    #[test]
    fn leeway_is_seven_days_inclusive_on_both_ends() {
        let start = [item(0, "2026-08-01", "X", dec!(-5))];
        let r = match_items(&start, &[app(1, "2026-07-25", "X", dec!(-5))], &p());
        assert_eq!(r.possible, vec![(0, vec![1])]);
        let r = match_items(&start, &[app(1, "2026-07-24", "X", dec!(-5))], &p());
        assert_eq!(r.missing, vec![0]);
        let end = [item(0, "2026-08-31", "X", dec!(-5))];
        let r = match_items(&end, &[app(1, "2026-09-07", "X", dec!(-5))], &p());
        assert_eq!(r.possible, vec![(0, vec![1])]);
        let r = match_items(&end, &[app(1, "2026-09-08", "X", dec!(-5))], &p());
        assert_eq!(r.missing, vec![0]);
    }

    #[test]
    fn empty_descriptions_are_fine() {
        let r = match_items(&[item(0, "2026-08-10", "", dec!(-5))], &[app(1, "2026-08-10", "", dec!(-5))], &p());
        assert_eq!(r.matched, vec![(0, 1)]);
        let r = match_items(
            &[item(0, "2026-08-10", "  ", dec!(-5))],
            &[app(1, "2026-08-10", "Coffee", dec!(-5))],
            &p(),
        );
        assert_eq!(r.matched, vec![(0, 1)]);
    }

    #[test]
    fn possible_ties_list_every_candidate_but_never_one_matched_elsewhere() {
        let x = [item(0, "2026-08-10", "X", dec!(-5))];
        let apps = [app(1, "2026-08-16", "X", dec!(-5)), app(2, "2026-08-04", "X", dec!(-5))];
        assert_eq!(match_items(&x, &apps, &p()).possible, vec![(0, vec![1, 2])]);
        let both = [item(0, "2026-08-10", "X", dec!(-5)), item(1, "2026-08-16", "X", dec!(-5))];
        let r = match_items(&both, &apps, &p());
        assert_eq!(r.matched, vec![(1, 1)]);
        assert_eq!(r.possible, vec![(0, vec![2])]);
    }

    #[test]
    fn every_kind_follows_the_sign_table_with_both_flip_switches() {
        for kind in [AccountKind::Cash, AccountKind::Credit, AccountKind::Loan, AccountKind::Investment] {
            for layout_flip in [false, true] {
                for user_flip in [false, true] {
                    let signs = SignRules {
                        flip_cash: layout_flip,
                        flip_credit: layout_flip,
                        flip_loan: layout_flip,
                        flip_investment: layout_flip,
                    };
                    let base = if kind == AccountKind::Credit { dec!(-12.34) } else { dec!(12.34) };
                    let want = if layout_flip != user_flip { -base } else { base };
                    assert_eq!(
                        to_app_amount(dec!(12.34), kind, &signs, user_flip),
                        want,
                        "{kind:?} {layout_flip} {user_flip}"
                    );
                }
            }
        }
    }

    #[test]
    fn flip_needs_half_the_rows_and_never_fires_on_nothing() {
        let apps = [app(1, "2026-08-03", "A", dec!(-1)), app(2, "2026-08-04", "B", dec!(-2))];
        let three = [
            item(0, "2026-08-03", "A", dec!(1)),
            item(1, "2026-08-04", "B", dec!(2)),
            item(2, "2026-08-05", "C", dec!(9)),
        ];
        assert!(suggest_flip(&three, &apps, &p()));
        let one_of_three = [
            item(0, "2026-08-03", "A", dec!(1)),
            item(1, "2026-08-04", "B", dec!(8)),
            item(2, "2026-08-05", "C", dec!(9)),
        ];
        assert!(!suggest_flip(&one_of_three, &apps, &p()));
        assert!(!suggest_flip(&[], &apps, &p()));
        assert!(!suggest_flip(&[], &[], &p()));
    }
}
