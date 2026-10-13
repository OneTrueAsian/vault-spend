//! Splitting a statement into account sections and reading each section's balances, totals, rows
//! and holdings.

use super::holdings::HoldingsReader;
use super::layout::StatementLayout;
use super::model::{Period, StatementLine, StatementRow, StatementSection};
use super::rows::RowReader;
use super::text::{contains_label, contains_phrase, is_label_only, label_end, starts_with_label};
use super::tokens::{find_money, leading_date};
use chrono::NaiveDate;
use rust_decimal::Decimal;

const LOOKAHEAD_LINES: usize = 3;

/// The amount for `label` on line `i`: on the line itself (picking the layout's summary column), or —
/// when the line is the label alone — the first money on one of the next three lines. A leading date
/// ("Aug 01 Beginning Balance $155.05") is skipped before matching.
pub(crate) fn label_amount(lines: &[StatementLine], i: usize, label: &str, layout: &StatementLayout, period: &Period) -> Option<Decimal> {
    let text = lines[i].text.trim();
    let body = leading_date(text, &layout.dates, period).map(|d| d.rest).unwrap_or(text);
    if !starts_with_label(body, label) {
        return anywhere_amount(body, label, layout);
    }
    let money = find_money(body, &layout.amounts);
    if !money.is_empty() {
        let column = (layout.balances.summary_column as usize).min(money.len() - 1);
        return Some(money[column].value);
    }
    if is_label_only(body, label) && layout.balances.amount_before_label {
        let money = find_money(&lines.get(i.checked_sub(1)?)?.text, &layout.amounts);
        let column = (layout.balances.summary_column as usize).min(money.len().saturating_sub(1));
        return money.get(column).map(|m| m.value);
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

/// With `labels_anywhere`: the amount right after `label`, wherever the label sits in the line. Words
/// between the label and the amount mean it is a sentence about the label, not a figure for it.
fn anywhere_amount(body: &str, label: &str, layout: &StatementLayout) -> Option<Decimal> {
    if !layout.balances.labels_anywhere {
        return None;
    }
    let after = &body[label_end(body, label)?..];
    let first = find_money(after, &layout.amounts).into_iter().next()?;
    (!after[..first.start].chars().any(char::is_alphabetic)).then_some(first.value)
}

struct SectionBuilder<'l> {
    section: StatementSection,
    rows: RowReader<'l>,
    holdings: Option<HoldingsReader<'l>>,
    /// Rows for charges the statement prints only as a period total.
    total_rows: Vec<StatementRow>,
    period_end: NaiveDate,
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
            total_rows: Vec::new(),
            period_end: period.end,
            holdings: layout.holdings.as_ref().map(|h| HoldingsReader::new(h, &layout.amounts)),
        }
    }

    fn finish(mut self) -> StatementSection {
        self.rows.flush();
        self.section.rows = self.rows.rows;
        self.section.rows.append(&mut self.total_rows);
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
        for total in &layout.balances.period_totals {
            if let Some(v) = label_amount(lines, i, &total.label, layout, period) {
                hit = true;
                if !v.is_zero() && !self.total_rows.iter().any(|r| r.line == i) {
                    self.total_rows.push(StatementRow {
                        line: i,
                        date: self.period_end,
                        description: total.description.clone(),
                        amount: v,
                        running_balance: None,
                        principal: None,
                    });
                }
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
            // A heading that is only the label names no account (two accounts can open with identical
            // lines), so that case always starts a new section.
            if !label_only && current.as_ref().is_some_and(|open| open.section.name == name) {
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
    fn a_summary_that_prints_each_amount_before_its_label_reads_the_line_above() {
        let lines: Vec<StatementLine> = [
            "$100.00",
            "Previous Balance",
            "-$100.00",
            "Payments and Credits",
            "+$12.50",
            "New Charges",
            "$12.50",
            "New Balance",
        ]
        .iter()
        .map(|t| StatementLine {
            page: 0,
            text: t.to_string(),
        })
        .collect();
        let period = Period::new(
            NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 8, 31).unwrap(),
        )
        .unwrap();
        let mut l = layout("amex");
        l.balances.amount_before_label = true;
        let s = &read_statement(&lines, &l, &period)[0];
        assert_eq!((s.starting_balance, s.ending_balance), (Some(dec!(100.00)), Some(dec!(12.50))));
    }

    #[test]
    fn a_rewards_table_repeating_a_purchase_is_not_read_as_a_second_transaction() {
        let lines: Vec<StatementLine> = [
            "Previous Balance $100.00",
            "08/10 Hardware store 25.00",
            "New Balance $125.00",
            "Date of",
            "Transaction Merchant Name or Transaction Description $ Amount Rewards",
            "PURCHASES AND ADJUSTMENTS",
            "08/10 Hardware store 25.00 25",
        ]
        .iter()
        .map(|t| StatementLine {
            page: 0,
            text: t.to_string(),
        })
        .collect();
        let period = Period::new(
            NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 8, 31).unwrap(),
        )
        .unwrap();
        let s = &read_statement(&lines, &layout("chase-card"), &period)[0];
        assert_eq!(s.rows.len(), 1, "only the real transaction counts");
    }

    #[test]
    fn charges_printed_only_as_period_totals_become_rows_dated_the_last_day() {
        let lines: Vec<StatementLine> = [
            "Previous Balance $100.00",
            "New Balance $112.50",
            "Total Fees for this Period $9.00",
            "Total Interest Charged for this Period $3.50",
        ]
        .iter()
        .map(|t| StatementLine {
            page: 0,
            text: t.to_string(),
        })
        .collect();
        let period = Period::new(
            NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
            NaiveDate::from_ymd_opt(2026, 8, 31).unwrap(),
        )
        .unwrap();
        let sections = read_statement(&lines, &layout("amex"), &period);
        assert_eq!(sections[0].rows.len(), 2);
        assert_eq!((sections[0].rows[0].amount, sections[0].rows[0].date), (dec!(9.00), period.end));
        assert_eq!(sections[0].rows[1].description, "Interest charged");
        let zero: Vec<StatementLine> = ["Total Fees for this Period $0.00"]
            .iter()
            .map(|t| StatementLine {
                page: 0,
                text: t.to_string(),
            })
            .collect();
        assert!(
            read_statement(&zero, &layout("amex"), &period)[0].rows.is_empty(),
            "a zero total adds no row"
        );
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

    #[test]
    fn labels_anywhere_reads_a_summary_that_shares_its_line_with_other_text() {
        use crate::statement::model::StatementLine;
        let line = |text: &str| StatementLine {
            page: 0,
            text: text.to_string(),
        };
        let lines = vec![
            line("For late payments, the Previous Balance $100.00"),
            line("Payments - $20.00"),
            line("If you pay your New Balance in full by the due date you owe no interest"),
            line("their statement total New Balance = $80.00"),
        ];
        let period = crate::statement::model::Period::new("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap()).unwrap();
        let mut l = layout(GENERAL_ID);
        let off = &read_statement(&lines, &l, &period)[0];
        assert_eq!(
            (off.starting_balance, off.ending_balance),
            (None, None),
            "off by default: labels must start the line"
        );
        l.balances.labels_anywhere = true;
        let on = &read_statement(&lines, &l, &period)[0];
        assert_eq!(
            (on.starting_balance, on.ending_balance),
            (Some(dec!(100.00)), Some(dec!(80.00))),
            "the sentence about paying in full is not a balance: words stand between the label and any amount"
        );
    }

    #[test]
    fn a_bare_account_summary_heading_that_repeats_starts_another_account() {
        use crate::statement::model::StatementLine;
        let line = |text: &str| StatementLine {
            page: 0,
            text: text.to_string(),
        };
        // Two accounts whose summaries open with the same heading and the same column captions.
        let lines = vec![
            line("Account Summary"),
            line("Current Month Quarter to Date"),
            line("Total Additions $10.00"),
            line("Total Subtractions - $4.00"),
            line("Account Summary"),
            line("Current Month Quarter to Date"),
            line("Total Additions $7.00"),
            line("Total Subtractions - $1.00"),
        ];
        let period = crate::statement::model::Period::new("2026-08-01".parse().unwrap(), "2026-08-31".parse().unwrap()).unwrap();
        let sections = read_statement(&lines, &layout(GENERAL_INVESTMENT_ID), &period);
        assert_eq!(
            sections.len(),
            2,
            "a heading that is only the label names no account, so it cannot be a continuation"
        );
        assert_eq!(sections[1].activity_totals, Some((dec!(7.00), dec!(-1.00))));
    }
}
