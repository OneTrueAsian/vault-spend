//! Does the reading add up? Activity: the statement's activity totals, else start + rows = end.
//! Holdings: market values (plus cash) = the printed total holdings value. Running balances: each row
//! continues from the one before.

use super::model::StatementSection;
use rust_decimal::Decimal;

#[derive(Debug, Clone, PartialEq)]
pub enum CheckOutcome {
    Passed,
    Failed { expected: Decimal, found: Decimal },
    NotAvailable,
}

impl CheckOutcome {
    fn compare(expected: Decimal, found: Decimal) -> Self {
        if expected == found {
            CheckOutcome::Passed
        } else {
            CheckOutcome::Failed { expected, found }
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SectionChecks {
    pub activity: CheckOutcome,
    pub holdings: CheckOutcome,
    /// Statement lines where a running balance doesn't follow from the one before.
    pub running_balance_breaks: Vec<usize>,
}

impl SectionChecks {
    pub fn passed(&self) -> usize {
        [&self.activity, &self.holdings]
            .into_iter()
            .filter(|c| **c == CheckOutcome::Passed)
            .count()
    }
    pub fn failed(&self) -> usize {
        [&self.activity, &self.holdings]
            .into_iter()
            .filter(|c| matches!(c, CheckOutcome::Failed { .. }))
            .count()
            + usize::from(!self.running_balance_breaks.is_empty())
    }
}

pub fn check_section(s: &StatementSection) -> SectionChecks {
    let effect = |r: &super::model::StatementRow| r.principal.unwrap_or(r.amount);
    let sum: Decimal = s.rows.iter().map(effect).sum();
    let activity = match (s.activity_totals, s.starting_balance, s.ending_balance) {
        (Some((additions, subtractions)), _, _) => CheckOutcome::compare(additions + subtractions, sum),
        (None, Some(start), Some(end)) => CheckOutcome::compare(end, start + sum),
        _ => CheckOutcome::NotAvailable,
    };
    let holdings = match s.holdings_total {
        Some(total) => CheckOutcome::compare(
            total,
            s.holdings.iter().map(|h| h.market_value).sum::<Decimal>()
                + if s.holdings.is_empty() {
                    Decimal::ZERO
                } else {
                    s.holdings_cash.unwrap_or_default()
                },
        ),
        None => CheckOutcome::NotAvailable,
    };
    let mut breaks = Vec::new();
    let mut previous = s.starting_balance;
    for row in &s.rows {
        if let Some(balance) = row.running_balance {
            if previous.is_some_and(|p| p + effect(row) != balance) {
                breaks.push(row.line);
            }
            previous = Some(balance);
        } else {
            // A row printed without a balance still moves the balance for the next row that has one.
            previous = previous.map(|p| p + effect(row));
        }
    }
    SectionChecks {
        activity,
        holdings,
        running_balance_breaks: breaks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::fixture_pdf::fixture_lines;
    use crate::statement::layout::{GENERAL_ID, GENERAL_INVESTMENT_ID, built_in_layouts};
    use crate::statement::sections::read_statement;
    use rust_decimal_macros::dec;

    fn checks(fixture: &str, id: &str, tweak: impl Fn(&mut crate::statement::layout::StatementLayout)) -> Vec<SectionChecks> {
        let (lines, period) = fixture_lines(fixture);
        let mut layout = built_in_layouts().into_iter().find(|l| l.id == id).unwrap();
        tweak(&mut layout);
        read_statement(&lines, &layout, &period).iter().map(check_section).collect()
    }

    #[test]
    fn start_plus_rows_equals_end() {
        assert_eq!(checks("card-a", GENERAL_ID, |_| {})[0].activity, CheckOutcome::Passed);
        assert_eq!(checks("card-c", GENERAL_ID, |_| {})[0].activity, CheckOutcome::Passed);
    }

    #[test]
    fn a_misread_is_caught() {
        let c = checks("card-b", GENERAL_ID, |_| {});
        assert!(
            matches!(c[0].activity, CheckOutcome::Failed { .. }),
            "the repeated rewards purchase is counted"
        );
        let c = checks("card-b", GENERAL_ID, |l| l.skip_sections = vec!["Rewards Activity".into()]);
        assert_eq!(c[0].activity, CheckOutcome::Passed);
    }

    #[test]
    fn activity_totals_and_holdings_totals_for_brokerages() {
        let c = checks("brokerage", GENERAL_INVESTMENT_ID, |_| {});
        assert_eq!(
            (c[0].activity.clone(), c[0].holdings.clone()),
            (CheckOutcome::Passed, CheckOutcome::Passed)
        );
        assert_eq!(c[1].activity, CheckOutcome::Passed);
        let quarterly = checks("brokerage-quarterly", GENERAL_INVESTMENT_ID, |_| {});
        assert_eq!(quarterly[0].activity, CheckOutcome::Passed, "earlier months of the quarter are dropped");
    }

    #[test]
    fn unreadable_holdings_fail_against_the_printed_total() {
        let c = checks("unknown-brokerage", GENERAL_INVESTMENT_ID, |_| {});
        assert_eq!(c[0].activity, CheckOutcome::Passed, "cash balances check the activity");
        assert_eq!(
            c[0].holdings,
            CheckOutcome::Failed {
                expected: dec!(4153.03),
                found: dec!(0)
            }
        );
    }

    fn row(line: usize, amount: Decimal, balance: Option<Decimal>, principal: Option<Decimal>) -> crate::statement::StatementRow {
        crate::statement::StatementRow {
            line,
            date: "2026-08-10".parse().unwrap(),
            description: String::new(),
            amount,
            running_balance: balance,
            principal,
        }
    }

    #[test]
    fn a_row_without_a_printed_balance_still_moves_the_balance_for_the_next() {
        use rust_decimal_macros::dec;
        let s = StatementSection {
            starting_balance: Some(dec!(100)),
            ending_balance: Some(dec!(130)),
            rows: vec![
                row(1, dec!(10), Some(dec!(110)), None),
                row(2, dec!(5), None, None),
                row(3, dec!(15), Some(dec!(130)), None),
            ],
            ..Default::default()
        };
        let c = check_section(&s);
        assert!(c.running_balance_breaks.is_empty());
        assert_eq!(c.activity, CheckOutcome::Passed);
    }

    #[test]
    fn a_loan_payment_changes_the_balance_by_its_principal_part_only() {
        use rust_decimal_macros::dec;
        let s = StatementSection {
            starting_balance: Some(dec!(1000)),
            ending_balance: Some(dec!(900)),
            rows: vec![row(1, dec!(-120), Some(dec!(900)), Some(dec!(-100)))],
            ..Default::default()
        };
        let c = check_section(&s);
        assert_eq!(c.activity, CheckOutcome::Passed);
        assert!(c.running_balance_breaks.is_empty());
    }

    #[test]
    fn running_balances_are_checked_row_by_row() {
        let c = checks("credit-union", GENERAL_ID, |l| {
            l.balances.section_start = vec!["Share Account ID".into()];
            l.rows.running_balance = true;
        });
        assert_eq!(c[1].activity, CheckOutcome::Passed);
        assert!(c[1].running_balance_breaks.is_empty());
    }

    #[test]
    fn no_balances_means_not_available() {
        let c = checks("mortgage", GENERAL_ID, |_| {});
        assert_eq!(c[0].activity, CheckOutcome::NotAvailable);
    }
}
