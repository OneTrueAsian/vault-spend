//! Choosing how to read a statement: a recognised layout (learned first, then built-in) when it adds up;
//! otherwise the best of every layout, each also tried with money in/out reversed.

use super::checks::{SectionChecks, check_section};
use super::layout::{GENERAL_ID, GENERAL_INVESTMENT_ID, StatementLayout};
use super::model::{Period, StatementLine, StatementSection};
use super::sections::read_statement;
use super::text::squash;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutOrigin {
    Learned { id: i64 },
    BuiltIn { id: String },
}

#[derive(Debug, Clone)]
pub struct Reading {
    pub layout: StatementLayout,
    pub origin: LayoutOrigin,
    pub recognized: bool,
    pub recognized_but_failed: bool,
    pub sections: Vec<StatementSection>,
    pub checks: Vec<SectionChecks>,
}

pub fn recognizes(layout: &StatementLayout, lines: &[StatementLine]) -> bool {
    if layout.recognize.is_empty() {
        return false;
    }
    let first_page = squash(
        &lines
            .iter()
            .filter(|l| l.page == 0)
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join(" "),
    );
    layout.recognize.iter().all(|p| first_page.contains(&squash(p)))
}

pub fn read_with(lines: &[StatementLine], layout: &StatementLayout, period: &Period) -> (Vec<StatementSection>, Vec<SectionChecks>) {
    let sections = read_statement(lines, layout, period);
    let checks = sections.iter().map(check_section).collect();
    (sections, checks)
}

/// How good a reading is: checks passed, then how many sections it found balances for (a reading that
/// finds nothing at all must not beat one that found the balances and can see they don't add up), then
/// fewer failures, more rows and holdings, fewer unread lines.
fn score(sections: &[StatementSection], checks: &[SectionChecks]) -> (usize, usize, i64, usize, i64) {
    let passed = checks.iter().map(SectionChecks::passed).sum();
    let with_balances = sections
        .iter()
        .filter(|s| s.ending_balance.is_some() || s.ending_value.is_some() || s.holdings_total.is_some() || s.activity_totals.is_some())
        .count();
    let failed = checks.iter().map(SectionChecks::failed).sum::<usize>() as i64;
    let items = sections.iter().map(|s| s.rows.len() + s.holdings.len()).sum();
    let unread = sections.iter().map(|s| s.unread.len()).sum::<usize>() as i64;
    (passed, with_balances, -failed, items, -unread)
}

fn acceptable(sections: &[StatementSection], checks: &[SectionChecks]) -> bool {
    checks.iter().all(|c| c.failed() == 0)
        && sections
            .iter()
            .any(|s| !s.rows.is_empty() || !s.holdings.is_empty() || s.ending_balance.is_some())
}

pub fn choose(
    lines: &[StatementLine],
    period: &Period,
    learned: &[(i64, StatementLayout)],
    built_ins: &[StatementLayout],
    investment: bool,
) -> Reading {
    let mut recognized_but_failed = false;
    let candidates: Vec<(LayoutOrigin, &StatementLayout)> = learned
        .iter()
        .map(|(id, l)| (LayoutOrigin::Learned { id: *id }, l))
        .chain(built_ins.iter().map(|l| (LayoutOrigin::BuiltIn { id: l.id.clone() }, l)))
        .collect();

    for (origin, layout) in &candidates {
        if recognizes(layout, lines) {
            let (sections, checks) = read_with(lines, layout, period);
            if acceptable(&sections, &checks) {
                return Reading {
                    layout: (*layout).clone(),
                    origin: origin.clone(),
                    recognized: true,
                    recognized_but_failed: false,
                    sections,
                    checks,
                };
            }
            recognized_but_failed = true;
        }
    }

    // Generals first (the investment one first for an investment account), then everything else.
    let rank = |l: &StatementLayout| match (l.id.as_str(), investment) {
        (GENERAL_INVESTMENT_ID, true) | (GENERAL_ID, false) => 0,
        (GENERAL_ID, true) | (GENERAL_INVESTMENT_ID, false) => 1,
        _ => 2,
    };
    let mut ordered = candidates.clone();
    ordered.sort_by_key(|(_, l)| rank(l));

    let mut best: Option<(_, Reading)> = None;
    for (origin, layout) in ordered {
        for reversed in [layout.rows.reversed, !layout.rows.reversed] {
            let mut tried = layout.clone();
            tried.rows.reversed = reversed;
            let (sections, checks) = read_with(lines, &tried, period);
            let s = score(&sections, &checks);
            if best.as_ref().is_none_or(|(b, _)| s > *b) {
                best = Some((
                    s,
                    Reading {
                        layout: tried,
                        origin: origin.clone(),
                        recognized: false,
                        recognized_but_failed,
                        sections,
                        checks,
                    },
                ));
            }
        }
    }
    best.expect("there is always at least one built-in layout").1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::fixture_pdf::fixture_lines;
    use crate::statement::layout::{GENERAL_ID, built_in_layouts};

    fn builtins() -> Vec<StatementLayout> {
        built_in_layouts()
    }

    #[test]
    fn a_recognised_layout_is_used_when_it_adds_up() {
        let (lines, period) = fixture_lines("card-b");
        let r = choose(&lines, &period, &[], &builtins(), false);
        assert_eq!((r.layout.id.as_str(), r.recognized), ("chase-card", true));
    }

    #[test]
    fn an_unrecognised_statement_gets_the_best_reading() {
        let (lines, period) = fixture_lines("card-c");
        let r = choose(&lines, &period, &[], &builtins(), false);
        assert!(!r.recognized);
        assert!(r.checks.iter().all(|c| c.failed() == 0));
    }

    #[test]
    fn learned_layouts_win_over_built_ins() {
        let (lines, period) = fixture_lines("card-b");
        let mut mine = builtins().into_iter().find(|l| l.id == "chase-card").unwrap();
        mine.id = "learned".into();
        let r = choose(&lines, &period, &[(7, mine)], &builtins(), false);
        assert_eq!(r.origin, LayoutOrigin::Learned { id: 7 });
    }

    #[test]
    fn a_recognised_layout_that_stopped_adding_up_is_reported() {
        let (lines, period) = fixture_lines("card-b");
        let mut broken = builtins().into_iter().find(|l| l.id == "chase-card").unwrap();
        broken.id = "learned".into();
        broken.skip_sections.clear();
        broken.ignore_lines.clear();
        let general = builtins().into_iter().filter(|l| l.id == GENERAL_ID).collect::<Vec<_>>();
        let r = choose(&lines, &period, &[(3, broken)], &general, false);
        assert!(r.recognized_but_failed);
    }

    #[test]
    fn a_statement_that_cannot_be_read_is_reported_as_failing_rather_than_as_empty() {
        // The day-first dates fall outside the period under every built-in reading. A layout that finds
        // nothing at all must not beat one that found the balances and can see they don't add up.
        let (lines, period) = fixture_lines("unknown-bank");
        let r = choose(&lines, &period, &[], &builtins(), false);
        assert!(r.sections.iter().any(|s| s.starting_balance.is_some() && s.ending_balance.is_some()));
        assert!(r.checks.iter().any(|c| c.failed() > 0), "the reading should say it doesn't add up");
    }

    #[test]
    fn a_reversed_bank_is_read_the_right_way_round() {
        let (lines, period) = fixture_lines("unknown-bank");
        // Day-first dates aren't in the general layout, so this one needs teaching (Task 15);
        // with the format added, choosing finds the reversed reading by itself.
        let mut general = builtins().into_iter().find(|l| l.id == GENERAL_ID).unwrap();
        general.dates.formats = vec![crate::statement::layout::DateFormat::DdMmYyyy];
        let r = choose(&lines, &period, &[], &[general], false);
        assert!(r.layout.rows.reversed);
        assert_eq!(r.checks[0].activity, crate::statement::checks::CheckOutcome::Passed);
    }
}
