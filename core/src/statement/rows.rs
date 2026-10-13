//! Grouping statement lines into rows: a row starts at a line beginning with a date and ends at the
//! first line that carries money.

use super::layout::{AmountPosition, StatementLayout};
use super::model::{Period, StatementRow, UnreadLine};
use super::tokens::{Money, find_money, is_date_range, leading_date, without_money};
use chrono::NaiveDate;
use rust_decimal::Decimal;

pub const MAX_EXTRA_LINES: usize = 4;

struct Pending {
    line: usize,
    date: NaiveDate,
    first_text: String,
    description: Vec<String>,
    extra_lines: usize,
}

pub struct RowReader<'l> {
    layout: &'l StatementLayout,
    period: Period,
    pending: Option<Pending>,
    last_row_line: Option<usize>,
    pub rows: Vec<StatementRow>,
    pub unread: Vec<UnreadLine>,
    pub dropped: usize,
}

impl<'l> RowReader<'l> {
    pub fn new(layout: &'l StatementLayout, period: Period) -> Self {
        RowReader {
            layout,
            period,
            pending: None,
            last_row_line: None,
            rows: Vec::new(),
            unread: Vec::new(),
            dropped: 0,
        }
    }

    pub fn push_line(&mut self, index: usize, text: &str) {
        let text = text.trim();
        if let Some(found) = leading_date(text, &self.layout.dates, &self.period) {
            self.flush();
            if is_date_range(found.rest, &self.layout.dates, &self.period) {
                return;
            }
            self.pending = Some(Pending {
                line: index,
                date: found.date,
                first_text: text.to_string(),
                description: Vec::new(),
                extra_lines: 0,
            });
            self.consume(index, found.rest);
            return;
        }
        if self.pending.is_some() {
            self.consume(index, text);
            return;
        }
        if self.layout.rows.description_after_amount
            && !text.is_empty()
            && find_money(text, &self.layout.amounts).is_empty()
            && self.last_row_line.is_some_and(|l| index <= l + 2)
            && let Some(row) = self.rows.last_mut()
        {
            row.description = format!("{} {}", row.description, text).trim().to_string();
        }
    }

    fn consume(&mut self, index: usize, text: &str) {
        let money = find_money(text, &self.layout.amounts);
        let pending = self.pending.as_mut().expect("consume runs with a pending row");
        if money.is_empty() {
            if !text.is_empty() {
                pending.description.push(text.to_string());
            }
            if index != pending.line {
                pending.extra_lines += 1;
            }
            if pending.extra_lines > MAX_EXTRA_LINES {
                self.flush();
            }
            return;
        }
        let (amount, running_balance, principal) = pick(&money, self.layout);
        let rest = without_money(text, &money);
        if !rest.is_empty() {
            pending.description.push(rest);
        }
        let pending = self.pending.take().expect("checked above");
        let (amount, principal) = if self.layout.rows.reversed {
            (-amount, principal.map(|p| -p))
        } else {
            (amount, principal)
        };
        if self.in_period(pending.date) {
            self.rows.push(StatementRow {
                line: pending.line,
                date: pending.date,
                description: pending.description.join(" ").split_whitespace().collect::<Vec<_>>().join(" "),
                amount,
                running_balance,
                principal,
            });
            self.last_row_line = Some(index);
        } else {
            self.dropped += 1;
        }
    }

    fn in_period(&self, date: NaiveDate) -> bool {
        if self.layout.rows.exact_period {
            self.period.contains(date)
        } else {
            self.period.contains_with_leeway(date)
        }
    }

    /// Ends any row still waiting for its amount: it couldn't be read.
    pub fn flush(&mut self) {
        if let Some(p) = self.pending.take() {
            if self.in_period(p.date) {
                self.unread.push(UnreadLine {
                    line: p.line,
                    text: p.first_text,
                });
            } else {
                self.dropped += 1;
            }
        }
    }
}

fn pick(money: &[Money], layout: &StatementLayout) -> (Decimal, Option<Decimal>, Option<Decimal>) {
    let (body, running_balance) = if layout.rows.running_balance && money.len() >= 2 {
        (&money[..money.len() - 1], Some(money[money.len() - 1].value))
    } else {
        (money, None)
    };
    let amount = match layout.rows.amount {
        AmountPosition::First => body[0],
        AmountPosition::Last => body[body.len() - 1],
    };
    let principal = layout.rows.principal_column.and_then(|c| body.get(c as usize)).map(|m| m.value);
    (amount.value, running_balance, principal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::layout::{AmountPosition, GENERAL_ID, built_in_layouts};
    use rust_decimal_macros::dec;

    fn general() -> StatementLayout {
        built_in_layouts().into_iter().find(|l| l.id == GENERAL_ID).unwrap()
    }
    fn period(a: &str, b: &str) -> Period {
        Period::new(a.parse().unwrap(), b.parse().unwrap()).unwrap()
    }
    fn read(layout: &StatementLayout, p: Period, lines: &[&str]) -> RowReader<'static> {
        let layout: &'static StatementLayout = Box::leak(Box::new(layout.clone()));
        let mut r = RowReader::new(layout, p);
        for (i, l) in lines.iter().enumerate() {
            r.push_line(i, l);
        }
        r.flush();
        r
    }

    #[test]
    fn a_loan_line_reads_the_total_as_the_amount_and_the_principal_column_apart_from_it() {
        let mut l = general();
        l.dates.formats = vec![crate::statement::layout::DateFormat::MmDd];
        l.rows.running_balance = true;
        l.rows.principal_column = Some(1);
        let r = read(
            &l,
            period("2026-08-01", "2026-08-31"),
            &["08/10 Payment ($120.00) ($100.00) $15.00 $5.00 $900.00"],
        );
        assert_eq!(r.rows.len(), 1);
        assert_eq!(
            (r.rows[0].amount, r.rows[0].principal, r.rows[0].running_balance),
            (dec!(-120.00), Some(dec!(-100.00)), Some(dec!(900.00)))
        );
    }

    #[test]
    fn exact_period_drops_rows_a_few_days_outside_but_leeway_keeps_them() {
        let mut l = general();
        l.dates.formats = vec![crate::statement::layout::DateFormat::MmDd];
        let lines = ["09/03 Late sale 4.00"];
        let p = period("2026-09-05", "2026-09-30");
        assert_eq!(read(&l, p, &lines).rows.len(), 1);
        l.rows.exact_period = true;
        let strict = read(&l, p, &lines);
        assert_eq!((strict.rows.len(), strict.dropped), (0, 1));
    }

    #[test]
    fn a_row_can_wrap_over_several_lines() {
        let r = read(
            &general(),
            period("2026-07-22", "2026-08-21"),
            &["08/05/26* AUTOPAY PAYMENT RECEIVED", "Sample Bank Branch", "-$43.08"],
        );
        assert_eq!(r.rows.len(), 1);
        assert_eq!(r.rows[0].amount, dec!(-43.08));
        assert_eq!(r.rows[0].description, "AUTOPAY PAYMENT RECEIVED Sample Bank Branch");
        assert_eq!(r.rows[0].line, 0);
    }

    #[test]
    fn a_dated_line_with_no_amount_goes_to_couldnt_read() {
        let r = read(
            &general(),
            period("2026-08-01", "2026-08-31"),
            &["08/10/26 Mystery line", "a", "b", "c", "d", "e", "08/11/26 Coffee 4.50"],
        );
        assert_eq!(r.unread.len(), 1);
        assert_eq!(r.unread[0].text, "08/10/26 Mystery line");
        assert_eq!(r.rows.len(), 1);
    }

    #[test]
    fn a_date_range_line_is_not_a_row() {
        let r = read(
            &general(),
            period("2026-07-25", "2026-08-24"),
            &[
                "Jul 25, 2026 - Aug 24, 2026 | 31 days in Billing Cycle",
                "Jul 31 Jul 31 ONLINE PAYMENT - $3,975.23",
            ],
        );
        assert!(r.unread.is_empty());
        assert_eq!(r.rows.len(), 1);
    }

    #[test]
    fn rows_well_outside_the_period_are_dropped_quietly() {
        let r = read(
            &general(),
            period("2026-08-01", "2026-08-31"),
            &[
                "07/16/26 Bought 1.000 at $5.00 ($5.00)",
                "07/28/26 Late coffee 4.50",
                "08/03/26 Coffee 4.50",
            ],
        );
        assert_eq!(r.dropped, 1, "07-16 is more than 7 days before");
        assert_eq!(r.rows.len(), 2, "07-28 is within the leeway");
    }

    #[test]
    fn the_last_amount_and_a_running_balance() {
        let mut layout = general();
        layout.rows.amount = AmountPosition::Last;
        let r = read(
            &layout,
            period("2026-08-01", "2026-08-31"),
            &["08/03/26 Bought 10.000 at $43.62 ($436.15)"],
        );
        assert_eq!(r.rows[0].amount, dec!(-436.15));

        let mut layout = general();
        layout.rows.running_balance = true;
        let r = read(
            &layout,
            period("2026-08-01", "2026-08-31"),
            &["Aug 06 Aug 06 Withdrawal", "($10.84) $144.21"],
        );
        assert_eq!((r.rows[0].amount, r.rows[0].running_balance), (dec!(-10.84), Some(dec!(144.21))));
    }

    #[test]
    fn reversed_statements_flip_each_row_as_it_is_read() {
        let mut layout = general();
        layout.rows.reversed = true;
        let r = read(
            &layout,
            period("2026-08-01", "2026-08-31"),
            &["08/03/26 Supermarket 54.20", "08/05/26 Salary 2,000.00 CR"],
        );
        assert_eq!(r.rows.iter().map(|x| x.amount).collect::<Vec<_>>(), vec![dec!(-54.20), dec!(2000.00)]);
    }

    #[test]
    fn description_lines_after_the_amount_when_the_layout_says_so() {
        let mut layout = general();
        layout.rows.description_after_amount = true;
        let r = read(
            &layout,
            period("2026-08-01", "2026-08-31"),
            &["08/03/26 Card purchase 12.00", "CORNER CAFE SPRINGFIELD"],
        );
        assert_eq!(r.rows[0].description, "Card purchase CORNER CAFE SPRINGFIELD");
    }
}
