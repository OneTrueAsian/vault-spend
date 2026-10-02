//! Forecasts: debt payoff projection, cash-flow forecasts and average spending.

use super::{LIVE_TRANSFER_LEG_IDS_SQL, Store, StoredAccount, StoredRecurring, add_one_month, next_occurrence, normalize_description};
use crate::models::AccountType;
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

/// One debt's projected payoff (see `Store::debt_payoff_projection`) —
/// `payoff_date` is `None` if it isn't projected to clear within the
/// simulation's cap.
#[derive(Debug, Clone, PartialEq)]
pub struct DebtPayoffLine {
    pub account_id: i64,
    pub account_name: String,
    pub starting_balance: Decimal,
    pub payoff_date: Option<NaiveDate>,
    pub total_interest_paid: Decimal,
}

/// The full result of `Store::debt_payoff_projection` — `total_months` and
/// `total_interest_paid` describe the plan as a whole (every debt clear,
/// and what interest that costs in total), `None` if not every debt
/// resolves within the simulation's cap.
#[derive(Debug, Clone, PartialEq)]
pub struct DebtPayoffPlan {
    pub per_account: Vec<DebtPayoffLine>,
    pub total_months: Option<u32>,
    pub total_interest_paid: Decimal,
}

/// One day's projected total cash balance (see
/// `Store::cash_flow_forecast`).
#[derive(Debug, Clone, PartialEq)]
pub struct ForecastPoint {
    pub date: NaiveDate,
    pub balance: Decimal,
}

/// One dated bill or paycheck from the Recurring list that the bill-aware
/// forecast places on its due date. `amount` is signed like a transaction:
/// negative is money out.
#[derive(Debug, Clone, PartialEq)]
pub struct ForecastEvent {
    pub date: NaiveDate,
    pub label: String,
    pub amount: Decimal,
}

/// See `Store::bill_aware_forecast`.
#[derive(Debug, Clone, PartialEq)]
pub struct BillAwareForecast {
    /// `false` when there was nothing active in Recurring to place on the
    /// calendar, so `points` is just the plain trend forecast.
    pub uses_recurring: bool,
    /// Cash (checking + savings) in the accounts right now.
    pub start_balance: Decimal,
    /// End-of-day balance for today (index 0) and each day after it.
    pub points: Vec<ForecastPoint>,
    /// Every recurring occurrence in the window, in date order.
    pub events: Vec<ForecastEvent>,
    /// Net everyday cash flow per day from history *other than* the
    /// recurring items and transfers — usually negative (groceries, gas,
    /// dining out), applied to every projected day.
    pub daily_baseline: Decimal,
}

/// Adds `n` calendar months by repeated `add_one_month` — `n` is always
/// small in practice (`debt_payoff_projection` caps its simulation at 600
/// months), so the repeated-addition cost is negligible next to the
/// clarity of reusing the same day-clamping logic as everywhere else.
fn add_months(d: NaiveDate, n: u32) -> NaiveDate {
    let mut result = d;
    for _ in 0..n {
        result = add_one_month(result);
    }
    result
}

impl Store {
    /// Simulates paying down every debt account (credit or loan, matching
    /// `AccountType::group`) month by month, applying `minimum_payments`
    /// (an account not present defaults to a $0 minimum) plus
    /// `extra_monthly_payment` to whichever debt `strategy` prioritizes —
    /// `"avalanche"` targets the highest `interest_rate` first (a missing
    /// rate counts as 0% for both accrual and ordering), anything else
    /// (including `"snowball"`) targets the smallest current balance
    /// first, same lenient fallback convention as `next_occurrence`'s
    /// cadence matching.
    ///
    /// Interest accrues monthly (`rate / 1200`, i.e. APR/12 as a
    /// fraction) before that month's payments are applied. Once a debt's
    /// minimum is no longer needed (it's paid off), that minimum rolls
    /// into the extra-payment pool for every subsequent month — the
    /// defining trait of a real snowball/avalanche plan, not just a set of
    /// independent payoff timers.
    ///
    /// Capped at 600 months (50 years): a debt that never clears within
    /// that (minimum too small to outpace interest) reports `payoff_date:
    /// None`, and the whole plan's `total_months` is `None` too.
    pub fn debt_payoff_projection(
        &self,
        strategy: &str,
        extra_monthly_payment: Decimal,
        minimum_payments: &[(i64, Decimal)],
        today: NaiveDate,
    ) -> rusqlite::Result<DebtPayoffPlan> {
        const CAP_MONTHS: u32 = 600;

        struct Debt {
            account_id: i64,
            name: String,
            starting_balance: Decimal,
            owed: Decimal,
            rate: Decimal,
            minimum: Decimal,
            interest_paid: Decimal,
            payoff_month: Option<u32>,
        }

        let minimums: std::collections::HashMap<i64, Decimal> = minimum_payments.iter().cloned().collect();

        let mut debts: Vec<Debt> = self
            .list_accounts(today)?
            .into_iter()
            .filter(|a| matches!(a.account.account_type.group(), "credit" | "loan"))
            .filter(|a| !a.excluded_from_debt_payoff)
            .filter_map(|a| {
                let owed = match a.account.account_type.group() {
                    "credit" => a.starting_balance - a.current_balance,
                    _ => a.current_balance,
                };
                if owed <= Decimal::ZERO {
                    return None;
                }
                Some(Debt {
                    account_id: a.id,
                    name: a.account.name,
                    starting_balance: owed,
                    owed,
                    rate: a.interest_rate.unwrap_or(Decimal::ZERO),
                    minimum: minimums.get(&a.id).copied().unwrap_or(Decimal::ZERO),
                    interest_paid: Decimal::ZERO,
                    payoff_month: None,
                })
            })
            .collect();

        if debts.is_empty() {
            return Ok(DebtPayoffPlan {
                per_account: Vec::new(),
                total_months: Some(0),
                total_interest_paid: Decimal::ZERO,
            });
        }

        let mut freed_minimums = Decimal::ZERO;
        let mut month = 0u32;
        while debts.iter().any(|d| d.owed > Decimal::ZERO) && month < CAP_MONTHS {
            month += 1;

            for d in debts.iter_mut() {
                if d.owed <= Decimal::ZERO {
                    continue;
                }
                let interest = d.owed * d.rate / Decimal::from(1200);
                d.owed += interest;
                d.interest_paid += interest;
            }

            match strategy {
                "avalanche" => debts.sort_by(|a, b| b.rate.cmp(&a.rate).then_with(|| a.owed.cmp(&b.owed))),
                _ => debts.sort_by_key(|a| a.owed),
            }

            for d in debts.iter_mut() {
                if d.owed <= Decimal::ZERO {
                    continue;
                }
                let pay = d.minimum.min(d.owed);
                d.owed -= pay;
            }

            let mut pool = extra_monthly_payment + freed_minimums;
            for d in debts.iter_mut() {
                if pool <= Decimal::ZERO {
                    break;
                }
                if d.owed <= Decimal::ZERO {
                    continue;
                }
                let pay = pool.min(d.owed);
                d.owed -= pay;
                pool -= pay;
            }

            for d in debts.iter_mut() {
                if d.owed <= Decimal::ZERO && d.payoff_month.is_none() {
                    d.payoff_month = Some(month);
                    freed_minimums += d.minimum;
                }
            }
        }

        let total_months = if debts.iter().all(|d| d.payoff_month.is_some()) {
            debts.iter().map(|d| d.payoff_month.unwrap()).max()
        } else {
            None
        };
        let total_interest_paid = debts.iter().map(|d| d.interest_paid).sum();

        let per_account = debts
            .into_iter()
            .map(|d| DebtPayoffLine {
                account_id: d.account_id,
                account_name: d.name,
                starting_balance: d.starting_balance,
                payoff_date: d.payoff_month.map(|m| add_months(today, m)),
                total_interest_paid: d.interest_paid,
            })
            .collect();

        Ok(DebtPayoffPlan {
            per_account,
            total_months,
            total_interest_paid,
        })
    }

    /// Projects total cash balance one point per day for `days` days
    /// forward from `today` as a smooth trend — starting balance is the
    /// sum of every "cash"-group account's current balance (checking/
    /// savings only; deliberately not investment/other/debt, since this
    /// answers "can I cover my bills," not total net worth), and the
    /// day-over-day *slope* is the trailing ~90-day observed daily net
    /// cash flow: `(balance today - balance at the start of the window) /
    /// days in that window`.
    ///
    /// Deliberately not based on `Recurring` items: most people don't
    /// bother entering their paycheck as a recurring item, only their
    /// bills, which made an earlier recurring-only version of this always
    /// trend straight down regardless of real income. A window built from
    /// actual transaction history has no such blind spot — real income
    /// already shows up in the observed balance change automatically. The
    /// trade-off is losing the specific-date "rent hits on the 15th" dip
    /// in favor of a smooth trend line.
    ///
    /// The window is capped at 90 days but shrinks to however much history
    /// actually exists (via the account's earliest transaction date) so a
    /// brand-new account with only two weeks of data isn't diluted by 76
    /// days of assumed inactivity. With no transactions at all, the slope
    /// is 0 (flat). `days = 0` returns just today's balance as a single
    /// point.
    pub fn cash_flow_forecast(&self, today: NaiveDate, days: i64) -> rusqlite::Result<Vec<ForecastPoint>> {
        const TRAILING_WINDOW_DAYS: i64 = 90;

        let cash_accounts: Vec<StoredAccount> = self
            .list_accounts(today)?
            .into_iter()
            .filter(|a| a.account.account_type.group() == "cash")
            .collect();
        let starting_balance: Decimal = cash_accounts.iter().map(|a| a.current_balance).sum();

        let earliest_transaction_date: Option<NaiveDate> = self
            .conn
            .query_row("SELECT MIN(date) FROM transactions WHERE deleted_at IS NULL", [], |row| {
                row.get::<_, Option<String>>(0)
            })?
            .map(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").expect("date stored by this crate must be valid"));

        let daily_net = match earliest_transaction_date {
            None => Decimal::ZERO,
            Some(earliest) => {
                let window_start = earliest.max(today - chrono::Duration::days(TRAILING_WINDOW_DAYS));
                let days_elapsed = (today - window_start).num_days().max(1);
                let mut balance_at_window_start = Decimal::ZERO;
                for a in &cash_accounts {
                    balance_at_window_start += self.account_balance_as_of(a.id, a.account.account_type.as_str(), a.starting_balance, window_start)?;
                }
                (starting_balance - balance_at_window_start) / Decimal::from(days_elapsed)
            }
        };

        let mut points = Vec::with_capacity((days + 1).max(1) as usize);
        let mut balance = starting_balance;
        points.push(ForecastPoint { date: today, balance });
        let mut date = today;
        for _ in 0..days {
            date += chrono::Duration::days(1);
            balance += daily_net;
            points.push(ForecastPoint { date, balance });
        }
        Ok(points)
    }

    /// A cash forecast that puts every active Recurring bill and paycheck on
    /// the day it's actually due, instead of smoothing everything into a
    /// straight line the way `cash_flow_forecast` does — so a big bill
    /// shows up as a dip on its due date, and the lowest point before the
    /// next payday is visible.
    ///
    /// Day by day: cash today, plus every recurring occurrence dated on or
    /// before that day, plus the "everyday" baseline — the average daily net
    /// of the trailing ~90 days' *other* activity (see `daily_baseline`):
    /// anything already accounted for as a recurring item (matched by
    /// merchant name, the same normalization `detect_recurring_candidates`
    /// uses), a transfer (category or linked pair), or a debt-payment
    /// bookkeeping row is left out so it isn't counted twice. Credit-card
    /// charges count as spending on the day they happen; loan and
    /// investment accounts are ignored.
    ///
    /// A bill due *today* is taken out of today's point (it hasn't
    /// necessarily hit the account yet), though `start_balance` stays what's
    /// in the accounts right now. Canceled recurring items are skipped.
    /// With nothing active in Recurring the result is exactly
    /// `cash_flow_forecast`'s trend, flagged `uses_recurring: false`.
    pub fn bill_aware_forecast(&self, today: NaiveDate, days: i64) -> rusqlite::Result<BillAwareForecast> {
        const TRAILING_WINDOW_DAYS: i64 = 90;

        let start_balance: Decimal = self
            .list_accounts(today)?
            .into_iter()
            .filter(|a| a.account.account_type.group() == "cash")
            .map(|a| a.current_balance)
            .sum();

        let recurring: Vec<StoredRecurring> = self.list_recurring(today)?.into_iter().filter(|r| r.status != "canceled").collect();
        if recurring.is_empty() {
            return Ok(BillAwareForecast {
                uses_recurring: false,
                start_balance,
                points: self.cash_flow_forecast(today, days)?,
                events: Vec::new(),
                daily_baseline: Decimal::ZERO,
            });
        }

        let end = today + chrono::Duration::days(days);
        // A bill due today whose charge has already posted is in the balance
        // already — counting it again would double it.
        let already_posted_today: std::collections::HashSet<i64> = self
            .recurring_matches(today)?
            .into_iter()
            .filter(|m| m.state == "paid" && m.last_due == Some(today))
            .map(|m| m.recurring_id)
            .collect();
        let mut events = Vec::new();
        for r in &recurring {
            let mut date = next_occurrence(r.anchor_date, &r.cadence, today);
            if date == today && already_posted_today.contains(&r.id) {
                date = next_occurrence(r.anchor_date, &r.cadence, today + chrono::Duration::days(1));
            }
            while date <= end {
                events.push(ForecastEvent {
                    date,
                    label: r.merchant.clone(),
                    amount: r.amount,
                });
                date = next_occurrence(r.anchor_date, &r.cadence, date + chrono::Duration::days(1));
            }
        }
        events.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.label.cmp(&b.label)));

        let daily_baseline = self.everyday_daily_net(today, TRAILING_WINDOW_DAYS, &recurring)?;

        let mut points = Vec::with_capacity((days + 1).max(1) as usize);
        let mut running_events = Decimal::ZERO;
        let mut next_event = 0;
        for day in 0..=days {
            let date = today + chrono::Duration::days(day);
            while next_event < events.len() && events[next_event].date <= date {
                running_events += events[next_event].amount;
                next_event += 1;
            }
            points.push(ForecastPoint {
                date,
                balance: start_balance + running_events + daily_baseline * Decimal::from(day),
            });
        }

        Ok(BillAwareForecast {
            uses_recurring: true,
            start_balance,
            points,
            events,
            daily_baseline,
        })
    }

    /// Average daily net (income minus spending) of the trailing window
    /// ending `today`, counting only activity that *isn't* already a
    /// recurring item — see `bill_aware_forecast`. The window shrinks to
    /// however much history exists, same as `average_monthly_spend`, and is
    /// zero with none.
    fn everyday_daily_net(&self, today: NaiveDate, window_days: i64, recurring: &[StoredRecurring]) -> rusqlite::Result<Decimal> {
        let earliest_transaction_date: Option<NaiveDate> = self
            .conn
            .query_row("SELECT MIN(date) FROM transactions WHERE deleted_at IS NULL", [], |row| {
                row.get::<_, Option<String>>(0)
            })?
            .map(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").expect("date stored by this crate must be valid"));
        let Some(earliest) = earliest_transaction_date else {
            return Ok(Decimal::ZERO);
        };
        let window_start = earliest.max(today - chrono::Duration::days(window_days));
        let days_elapsed = (today - window_start).num_days().max(1);

        let recurring_merchants: std::collections::HashSet<String> = recurring.iter().map(|r| normalize_description(&r.merchant)).collect();

        let mut stmt = self.conn.prepare(&format!(
            "SELECT t.description, t.amount, a.account_type FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.date >= ?1 AND t.date <= ?2
                   AND t.deleted_at IS NULL
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND (t.category IS NULL OR t.category <> 'Transfer')
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})"
        ))?;
        let rows = stmt.query_map(params![window_start.to_string(), today.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })?;

        let mut net = Decimal::ZERO;
        for row in rows {
            let (description, amount, account_type) = row?;
            if recurring_merchants.contains(&normalize_description(&description)) {
                continue;
            }
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            let group = AccountType::parse(&account_type).map(|t| t.group());
            match group {
                Some("cash") => net += amount,
                // A charge on a card is spending on the day it happens; a
                // positive amount on a card is a payment or refund, not income.
                Some("credit") if amount < Decimal::ZERO => net += amount,
                _ => {}
            }
        }
        Ok(net / Decimal::from(days_elapsed))
    }

    /// Average monthly spend (money out only, as a positive number) over
    /// the trailing ~90 days ending `today` — same window-sizing as
    /// `cash_flow_forecast` just above (clamped to however much
    /// transaction history actually exists, via the earliest transaction
    /// date, so a brand-new file isn't diluted by assumed-inactive days),
    /// same income-vs-expense split as `monthly_totals` (`store/reports.rs`)
    /// (`amount < 0` counts as spend). Unlike `cash_flow_forecast`, this
    /// reads transaction amounts directly rather than the balance delta
    /// between two points, since a balance delta can't isolate spend from
    /// income the way this needs to. Powers the Dashboard's runway stat
    /// ("liquid savings ÷ average monthly spend"). With no transactions at
    /// all, returns `Decimal::ZERO` rather than dividing by zero.
    pub fn average_monthly_spend(&self, today: NaiveDate) -> rusqlite::Result<Decimal> {
        const TRAILING_WINDOW_DAYS: i64 = 90;

        let earliest_transaction_date: Option<NaiveDate> = self
            .conn
            .query_row("SELECT MIN(date) FROM transactions WHERE deleted_at IS NULL", [], |row| {
                row.get::<_, Option<String>>(0)
            })?
            .map(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").expect("date stored by this crate must be valid"));

        let Some(earliest) = earliest_transaction_date else {
            return Ok(Decimal::ZERO);
        };
        let window_start = earliest.max(today - chrono::Duration::days(TRAILING_WINDOW_DAYS));
        let days_elapsed = (today - window_start).num_days().max(1);

        let mut stmt = self.conn.prepare(&format!(
            "SELECT amount FROM transactions
             WHERE date >= ?1 AND date <= ?2
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND (category IS NULL OR category <> 'Transfer')
                   AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map(params![window_start.to_string(), today.to_string()], |row| row.get::<_, String>(0))?;
        let mut expense = Decimal::ZERO;
        for row in rows {
            let amount = Decimal::from_str(&row?).expect("amount stored by this crate must be valid");
            if amount < Decimal::ZERO {
                expense -= amount;
            }
        }

        // `expense * 30 / days_elapsed` rather than `expense / (days_elapsed
        // / 30)` — the latter's intermediate division (e.g. 10/30) is a
        // non-terminating decimal, which `Decimal` rounds, so dividing by
        // that rounded value doesn't exactly invert back out (`300 /
        // (10/30)` lands a hair off `900.00`, not on it).
        Ok(expense * Decimal::from(30) / Decimal::from(days_elapsed))
    }
}
