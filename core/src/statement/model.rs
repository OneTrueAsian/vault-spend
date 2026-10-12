use chrono::{Duration, NaiveDate};
use rust_decimal::Decimal;

/// One line of statement text, in the order the PDF draws it. `page` counts from 0.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatementLine {
    pub page: usize,
    pub text: String,
}

/// The dates the person says the statement covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Period {
    pub start: NaiveDate,
    pub end: NaiveDate,
}

impl Period {
    /// Rows dated this many days outside the period still count (transaction versus posting dates).
    pub const LEEWAY_DAYS: i64 = 7;

    pub fn new(start: NaiveDate, end: NaiveDate) -> Result<Self, &'static str> {
        if start > end {
            return Err("The statement's start date must be on or before its end date.");
        }
        Ok(Period { start, end })
    }

    pub fn contains(&self, date: NaiveDate) -> bool {
        date >= self.start && date <= self.end
    }

    pub fn contains_with_leeway(&self, date: NaiveDate) -> bool {
        date >= self.start - Duration::days(Self::LEEWAY_DAYS) && date <= self.end + Duration::days(Self::LEEWAY_DAYS)
    }

    /// Days from the period to `date`; 0 inside it.
    pub fn distance(&self, date: NaiveDate) -> i64 {
        if date < self.start {
            (self.start - date).num_days()
        } else if date > self.end {
            (date - self.end).num_days()
        } else {
            0
        }
    }
}

/// One statement transaction. `amount` is in the statement's own terms (after `rows.reversed`), so a
/// section's starting balance plus its rows equals its ending balance.
#[derive(Debug, Clone, PartialEq)]
pub struct StatementRow {
    pub line: usize,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
    pub running_balance: Option<Decimal>,
}

/// Text that looked like a transaction (it starts with a date) but had no amount.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnreadLine {
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StatementHolding {
    pub line: usize,
    pub symbol: String,
    pub name: String,
    pub shares: Decimal,
    pub price: Option<Decimal>,
    pub market_value: Decimal,
}

/// One account's part of a statement.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct StatementSection {
    pub name: String,
    pub first_line: usize,
    pub starting_balance: Option<Decimal>,
    pub ending_balance: Option<Decimal>,
    /// (additions, subtractions) as printed: subtractions are negative.
    pub activity_totals: Option<(Decimal, Decimal)>,
    /// An investment account's total value, for reference only.
    pub ending_value: Option<Decimal>,
    pub rows: Vec<StatementRow>,
    pub unread: Vec<UnreadLine>,
    pub dropped_out_of_period: usize,
    pub holdings: Vec<StatementHolding>,
    pub holdings_cash: Option<Decimal>,
    pub holdings_total: Option<Decimal>,
}
