//! Splitting a statement into account sections and reading each section's balances, totals, rows
//! and holdings.

use super::holdings::HoldingsReader;
use super::layout::StatementLayout;
use super::model::{Period, StatementLine, StatementSection};
use super::rows::RowReader;
use super::text::{contains_label, contains_phrase, is_label_only, starts_with_label};
use super::tokens::{find_money, leading_date};
use rust_decimal::Decimal;

const LOOKAHEAD_LINES: usize = 3;

/// The amount for `label` on line `i`: on the line itself (picking the layout's summary column), or —
/// when the line is the label alone — the first money on one of the next three lines. A leading date
/// ("Aug 01 Beginning Balance $155.05") is skipped before matching.
pub(crate) fn label_amount(lines: &[StatementLine], i: usize, label: &str, layout: &StatementLayout, period: &Period) -> Option<Decimal> {
    let text = lines[i].text.trim();
    let body = leading_date(text, &layout.dates, period).map(|d| d.rest).unwrap_or(text);
    if !starts_with_label(body, label) {
        return None;
    }
    let money = find_money(body, &layout.amounts);
    if !money.is_empty() {
        let column = (layout.balances.summary_column as usize).min(money.len() - 1);
        return Some(money[column].value);
    }
    if is_label_only(body, label) {
        for next in lines.iter().skip(i + 1).take(LOOKAHEAD_LINES) {
            let money = find_money(&next.text, &layout.amounts);
            if !money.is_empty() {
                let column = (layout.balances.summary_column as usize).min(money.len() - 1);
                return Some(money[column].value);
            }
        }
    }
    None
}

struct SectionBuilder<'l> {
    section: StatementSection,
    rows: RowReader<'l>,
    holdings: Option<HoldingsReader<'l>>,
}

impl<'l> SectionBuilder<'l> {
    fn new(name: String, first_line: usize, layout: &'l StatementLayout, period: Period) -> Self {
        SectionBuilder {
            section: StatementSection {
                name,
                first_line,
                ..Default::default()
            },
            rows: RowReader::new(layout, period),
            holdings: layout.holdings.as_ref().map(|h| HoldingsReader::new(h, &layout.amounts)),
        }
    }

    fn finish(mut self) -> StatementSection {
        self.rows.flush();
        self.section.rows = self.rows.rows;
        self.section.unread = self.rows.unread;
        self.section.dropped_out_of_period = self.rows.dropped;
        if let Some(h) = self.holdings {
            self.section.holdings = h.finish();
        }
        self.section
    }

    /// Reads balance/total/value labels on line `i`; true when the line was a label line.
    fn take_labels(&mut self, lines: &[StatementLine], i: usize, layout: &StatementLayout, period: &Period) -> bool {
        let s = &mut self.section;
        let mut hit = false;
        for pair in &layout.balances.pairs {
            if let Some(start) = &pair.start
                && let Some(v) = label_amount(lines, i, start, layout, period)
            {
                s.starting_balance.get_or_insert(v);
                hit = true;
            }
            if let Some(v) = label_amount(lines, i, &pair.end, layout, period) {
                s.ending_balance.get_or_insert(v);
                hit = true;
            }
        }
        for totals in &layout.balances.activity_totals {
            if let Some(v) = label_amount(lines, i, &totals.additions, layout, period) {
                let entry = s.activity_totals.get_or_insert((v, Decimal::ZERO));
                entry.0 = v;
                hit = true;
            }
            if let Some(v) = label_amount(lines, i, &totals.subtractions, layout, period) {
                let entry = s.activity_totals.get_or_insert((Decimal::ZERO, v));
                entry.1 = v;
                hit = true;
            }
        }
        if let Some(value) = &layout.balances.value {
            if let Some(v) = label_amount(lines, i, &value.end, layout, period) {
                s.ending_value.get_or_insert(v);
                hit = true;
            }
            if value
                .start
                .as_deref()
                .is_some_and(|start| label_amount(lines, i, start, layout, period).is_some())
            {
                hit = true;
            }
        }
        hit
    }
}

pub fn read_statement(lines: &[StatementLine], layout: &StatementLayout, period: &Period) -> Vec<StatementSection> {
    let is_start = |text: &str| layout.balances.section_start.iter().any(|label| contains_label(text, label));
    let use_sections = lines.iter().any(|l| is_start(&l.text));
    let mut sections = Vec::new();
    let mut current = (!use_sections).then(|| SectionBuilder::new("Statement".into(), 0, layout, *period));
    let mut skipping = false;
    let mut in_holdings = false;

    for (i, line) in lines.iter().enumerate() {
        let text = line.text.trim();
        if use_sections && is_start(text) {
            // A heading that is only the label ("Account Summary") takes the account's name from the next line.
            let label_only = layout.balances.section_start.iter().any(|label| is_label_only(text, label));
            let name: String = match (label_only, lines.get(i + 1)) {
                (true, Some(next)) => format!("{text} — {}", next.text.trim()),
                _ => text.to_string(),
            }
            .chars()
            .take(60)
            .collect();
            // Many statements repeat an account's heading at the top of each following page. The same
            // heading again while that account is still open continues it rather than starting another.
            if current.as_ref().is_some_and(|open| open.section.name == name) {
                continue;
            }
            if let Some(done) = current.take() {
                sections.push(done.finish());
            }
            current = Some(SectionBuilder::new(name, i, layout, *period));
            skipping = false;
            in_holdings = false;
            continue;
        }
        let Some(builder) = current.as_mut() else { continue };
        if layout.skip_sections.iter().any(|label| starts_with_label(text, label)) {
            builder.rows.flush();
            skipping = true;
            continue;
        }
        if skipping || text.is_empty() || layout.ignore_lines.iter().any(|p| contains_phrase(text, p)) {
            continue;
        }
        if let Some(rules) = &layout.holdings {
            if rules.heading.iter().any(|label| starts_with_label(text, label)) {
                builder.rows.flush();
                in_holdings = true;
                continue;
            }
            if in_holdings {
                if let Some(total) = rules.total.iter().find_map(|label| label_amount(lines, i, label, layout, period)) {
                    builder.section.holdings_total.get_or_insert(total);
                    in_holdings = false;
                    continue;
                }
                if let Some(cash) = rules.cash.iter().find_map(|label| label_amount(lines, i, label, layout, period)) {
                    builder.section.holdings_cash.get_or_insert(cash);
                    continue;
                }
                if let Some(h) = builder.holdings.as_mut() {
                    h.push_line(i, text);
                }
                continue;
            }
            if let Some(cash) = rules.cash.iter().find_map(|label| label_amount(lines, i, label, layout, period)) {
                builder.section.holdings_cash.get_or_insert(cash);
                continue;
            }
        }
        if builder.take_labels(lines, i, layout, period) {
            continue;
        }
        builder.rows.push_line(i, text);
    }
    if let Some(done) = current {
        sections.push(done.finish());
    }
    sections
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::fixture_pdf::fixture_lines;
    use crate::statement::layout::{BalancePair, GENERAL_ID, GENERAL_INVESTMENT_ID, built_in_layouts};
    use rust_decimal_macros::dec;

    fn layout(id: &str) -> StatementLayout {
        built_in_layouts().into_iter().find(|l| l.id == id).unwrap()
    }

    #[test]
    fn a_label_only_line_takes_its_amount_from_the_next_lines() {
        let (lines, period) = fixture_lines("card-a");
        let sections = read_statement(&lines, &layout(GENERAL_ID), &period);
        assert_eq!(sections.len(), 1);
        assert_eq!(
            (sections[0].starting_balance, sections[0].ending_balance),
            (Some(dec!(43.08)), Some(dec!(52.36)))
        );
        assert_eq!(sections[0].rows.len(), 6);
        assert!(sections[0].unread.is_empty());
    }

    #[test]
    fn section_starts_split_one_pdf_into_accounts_and_balances_after_a_date_still_count() {
        let (lines, period) = fixture_lines("credit-union");
        let mut l = layout(GENERAL_ID);
        l.balances.section_start = vec!["Share Account ID".into()];
        let sections = read_statement(&lines, &l, &period);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].name, "MEMBER SAVINGS Share Account ID 00");
        assert_eq!(
            (sections[1].starting_balance, sections[1].ending_balance),
            (Some(dec!(155.05)), Some(dec!(243.24)))
        );
        assert_eq!(sections[1].rows.len(), 5);
    }

    #[test]
    fn a_section_with_no_rows_still_checks_and_reads() {
        let (lines, period) = fixture_lines("credit-union");
        let mut l = layout(GENERAL_ID);
        l.balances.section_start = vec!["Share Account ID".into()];
        let savings = &read_statement(&lines, &l, &period)[0];
        assert!(savings.rows.is_empty());
        assert_eq!((savings.starting_balance, savings.ending_balance), (Some(dec!(6.44)), Some(dec!(6.44))));
    }

    #[test]
    fn the_first_summary_column_and_activity_totals_and_skipped_sweeps() {
        let (lines, period) = fixture_lines("brokerage");
        let sections = read_statement(&lines, &layout(GENERAL_INVESTMENT_ID), &period);
        assert_eq!(sections.len(), 2, "the portfolio page before the first account is not an account");
        assert_eq!(sections[0].name, "Account Summary — Growth Account");
        assert_eq!(sections[0].activity_totals, Some((dec!(53.68), dec!(-9.98))));
        assert_eq!(sections[0].ending_value, Some(dec!(84089.71)));
        assert_eq!(
            sections[0].rows.iter().map(|r| r.amount).sum::<Decimal>(),
            dec!(43.70),
            "sweep rows are skipped"
        );
        assert_eq!(sections[1].rows.len(), 2);
    }

    #[test]
    fn an_end_only_pair_reads_a_loan_principal() {
        let (lines, period) = fixture_lines("mortgage");
        let mut l = layout(GENERAL_ID);
        l.rows.amount = crate::statement::layout::AmountPosition::Last;
        l.balances.pairs = vec![BalancePair {
            start: None,
            end: "Outstanding Principal".into(),
        }];
        let s = &read_statement(&lines, &l, &period)[0];
        assert_eq!((s.starting_balance, s.ending_balance), (None, Some(dec!(316840.29))));
        assert_eq!(s.rows.iter().map(|r| r.amount).collect::<Vec<_>>(), vec![dec!(2405.94), dec!(-85.12)]);
    }

    #[test]
    fn ignored_lines_are_skipped_wherever_the_phrase_appears() {
        let (lines, period) = fixture_lines("card-b");
        let mut l = layout(GENERAL_ID);
        l.ignore_lines = vec!["Order Number".into()];
        let s = &read_statement(&lines, &l, &period)[0];
        assert!(s.rows.iter().all(|r| !r.description.contains("Order Number")));
    }

    #[test]
    fn an_account_header_repeated_on_the_next_page_continues_the_same_section() {
        use crate::statement::model::StatementLine;
        let line = |page: usize, text: &str| StatementLine {
            page,
            text: text.to_string(),
        };
        let lines = vec![
            line(0, "SAVINGS Share Account ID 01"),
            line(0, "Beginning Balance $10.00"),
            line(0, "08/03/26 Deposit 5.00 15.00"),
            line(1, "SAVINGS Share Account ID 01"),
            line(1, "08/04/26 Deposit 5.00 20.00"),
            line(1, "Ending Balance $20.00"),
            line(1, "CHECKING Share Account ID 02"),
            line(1, "Beginning Balance $1.00"),
            line(1, "Ending Balance $1.00"),
        ];
        let mut l = layout(GENERAL_ID);
        l.balances.section_start = vec!["Share Account ID".into()];
        l.rows.running_balance = true;
        let period = crate::statement::model::Period::new("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap()).unwrap();
        let sections = read_statement(&lines, &l, &period);
        assert_eq!(sections.len(), 2, "the repeated header is the same account, not a new one");
        assert_eq!(sections[0].rows.len(), 2);
        assert_eq!(
            (sections[0].starting_balance, sections[0].ending_balance),
            (Some(dec!(10.00)), Some(dec!(20.00)))
        );
        assert_eq!(sections[1].name, "CHECKING Share Account ID 02");
    }
}
