//! Reports: monthly totals, spending by category and day, top merchants, net worth and contribution deltas.

use super::{LIVE_TRANSFER_LEG_IDS_SQL, Store, month_bounds};
use crate::models::AccountType;
use chrono::{Datelike, NaiveDate};
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

/// One cell of the Reports page's category-by-month table — see
/// `Store::category_spending_by_month`.
#[derive(Debug, Clone, PartialEq)]
pub struct CategoryMonthAmount {
    /// "YYYY-MM".
    pub month: String,
    pub category: String,
    /// Spending as a positive number.
    pub amount: Decimal,
}

/// One day's total spend — see `Store::daily_spending`.
#[derive(Debug, Clone, PartialEq)]
pub struct DailySpendAmount {
    /// "YYYY-MM-DD".
    pub date: String,
    /// Spending as a positive number.
    pub amount: Decimal,
}

/// Net worth split by Dashboard stat-card group — see
/// `Store::net_worth_breakdown_as_of`.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct NetWorthBreakdown {
    pub net_worth: Decimal,
    pub cash: Decimal,
    pub debt: Decimal,
    pub investments: Decimal,
}

/// See `Store::account_contributions_as_of`.
struct AccountContribution {
    account_id: i64,
    name: String,
    group: String,
    contribution: Decimal,
}

/// See `Store::account_contribution_deltas`.
#[derive(Debug, Clone, PartialEq)]
pub struct AccountContributionDelta {
    pub account_id: i64,
    pub name: String,
    pub group: String,
    pub from_amount: Decimal,
    pub to_amount: Decimal,
    pub delta: Decimal,
}

impl Store {
    /// Total income (positive amounts) and total expense (as a positive
    /// "spent" number, from negative amounts) across *every* transaction
    /// in the given month — unlike `monthly_budget_actuals`, not scoped to
    /// budgeted categories, since a cash-flow chart cares about the whole
    /// picture. Excludes `apply_debt_payment`'s generated transactions,
    /// same as `all_transactions` — see its doc comment. Also excludes
    /// anything categorized "Transfer": money moving between the user's own
    /// accounts is neither income nor spending, but with no category
    /// exclusion here it was silently counted as both (once on each side of
    /// the transfer) — inflating this month's income, expense, and any
    /// per-person breakdown built on top of it.
    ///
    /// A positive amount on a credit or loan account is never income
    /// either, regardless of category or whether it's linked through
    /// `apply_debt_payment` — restoring available credit (or, on a loan,
    /// an escrow refund or similar) is a balance adjustment, not new money
    /// coming in. This was the root cause of a real production bug: a
    /// credit card payment recorded as an ordinary deposit (not linked)
    /// inflated a family member's reported income by over 50x. A charge on
    /// either account type (negative) still counts as spending as normal —
    /// only the positive side is excluded here.
    pub fn monthly_totals(&self, year: i32, month: u32) -> rusqlite::Result<(Decimal, Decimal)> {
        let (first, next_first) = month_bounds(year, month);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT t.amount, a.account_type FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.date >= ?1 AND t.date < ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND (t.category IS NULL OR t.category <> 'Transfer')
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND t.deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map(params![first.to_string(), next_first.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut income = Decimal::ZERO;
        let mut expense = Decimal::ZERO;
        for row in rows {
            let (amount_str, account_type) = row?;
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            if amount > Decimal::ZERO {
                if account_type == "credit" || account_type == "loan" {
                    continue;
                }
                income += amount;
            } else if amount < Decimal::ZERO {
                expense -= amount;
            }
        }
        Ok((income, expense))
    }

    /// Same computation as `monthly_totals`, batched across every month in
    /// `[from_year/from_month, to_year/to_month]` (inclusive) in one query
    /// instead of one query per month — used by the Cash Flow page's
    /// trailing-window and custom-range views, both of which otherwise
    /// looped calling `monthly_totals` once per month. A month in the
    /// range with no transactions simply has no entry in the returned map
    /// rather than a `(0, 0)` row — callers already default a missing key
    /// to zero (matching `monthly_totals`'s own zero-activity behavior).
    pub fn monthly_totals_for_range(
        &self,
        from_year: i32,
        from_month: u32,
        to_year: i32,
        to_month: u32,
    ) -> rusqlite::Result<std::collections::HashMap<(i32, u32), (Decimal, Decimal)>> {
        let (range_start, _) = month_bounds(from_year, from_month);
        let (_, range_end) = month_bounds(to_year, to_month);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT t.date, t.amount, a.account_type FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.date >= ?1 AND t.date < ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND (t.category IS NULL OR t.category <> 'Transfer')
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND t.deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map(params![range_start.to_string(), range_end.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })?;

        let mut totals: std::collections::HashMap<(i32, u32), (Decimal, Decimal)> = std::collections::HashMap::new();
        for row in rows {
            let (date_str, amount_str, account_type) = row?;
            let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            let entry = totals.entry((date.year(), date.month())).or_insert((Decimal::ZERO, Decimal::ZERO));
            if amount > Decimal::ZERO {
                if account_type == "credit" || account_type == "loan" {
                    continue;
                }
                entry.0 += amount;
            } else if amount < Decimal::ZERO {
                entry.1 -= amount;
            }
        }
        Ok(totals)
    }

    /// Total spend per category (as positive "spent" numbers) across every
    /// transaction dated within `[start_date, end_date]`, sorted highest
    /// spend first. Uncategorized transactions and income are excluded, as
    /// are `apply_debt_payment`'s generated transactions — see
    /// `all_transactions`'s doc comment — and anything categorized
    /// "Transfer" (a split line included): money moving between the user's
    /// own accounts isn't spending, same as `monthly_totals`.
    pub fn spending_by_category(&self, start_date: NaiveDate, end_date: NaiveDate) -> rusqlite::Result<Vec<(String, Decimal)>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT category, amount FROM transactions
             WHERE category IS NOT NULL AND category <> 'Transfer' AND date >= ?1 AND date <= ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND deleted_at IS NULL
             UNION ALL
             SELECT ts.category, ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category IS NOT NULL AND ts.category <> 'Transfer' AND t.date >= ?1 AND t.date <= ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND t.deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map(params![start_date.to_string(), end_date.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut totals: std::collections::BTreeMap<String, Decimal> = std::collections::BTreeMap::new();
        for row in rows {
            let (category, amount) = row?;
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            if amount < Decimal::ZERO {
                *totals.entry(category).or_insert(Decimal::ZERO) -= amount;
            }
        }
        let mut result: Vec<(String, Decimal)> = totals.into_iter().collect();
        result.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        Ok(result)
    }

    /// What was spent in each category in each month of
    /// `[from_year/from_month, to_year/to_month]` (inclusive): the Reports
    /// page's category-by-month table. Expenses only, as positive numbers;
    /// income, transfers (by category or as a linked pair), debt-payment
    /// bookkeeping rows and deleted transactions are left out, and a split
    /// purchase counts through its lines' own categories — the same rules as
    /// `spending_by_category`. Unlike it, spending with no category shows up
    /// as "Uncategorized", since a table meant to account for the money
    /// shouldn't quietly drop some of it. A month/category with no spend has
    /// no row. Sorted by month, then category.
    pub fn category_spending_by_month(
        &self,
        from_year: i32,
        from_month: u32,
        to_year: i32,
        to_month: u32,
    ) -> rusqlite::Result<Vec<CategoryMonthAmount>> {
        let (range_start, _) = month_bounds(from_year, from_month);
        let (_, range_end) = month_bounds(to_year, to_month);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT substr(date, 1, 7), COALESCE(category, 'Uncategorized'), amount FROM transactions
             WHERE (category IS NULL OR category <> 'Transfer') AND date >= ?1 AND date < ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND deleted_at IS NULL
             UNION ALL
             SELECT substr(t.date, 1, 7), COALESCE(ts.category, 'Uncategorized'), ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE (ts.category IS NULL OR ts.category <> 'Transfer') AND t.date >= ?1 AND t.date < ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND t.deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map(params![range_start.to_string(), range_end.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })?;

        let mut totals: std::collections::BTreeMap<(String, String), Decimal> = std::collections::BTreeMap::new();
        for row in rows {
            let (month, category, amount) = row?;
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            if amount < Decimal::ZERO {
                *totals.entry((month, category)).or_insert(Decimal::ZERO) -= amount;
            }
        }
        Ok(totals
            .into_iter()
            .map(|((month, category), amount)| CategoryMonthAmount { month, category, amount })
            .collect())
    }

    /// Total spend per calendar day across `[from_year/from_month,
    /// to_year/to_month]` (inclusive) — the Reports page's daily-spend
    /// heatmap. Expenses only, as positive numbers; income, transfers (by
    /// category or as a linked pair), debt-payment bookkeeping rows and
    /// deleted transactions are left out, and a split purchase counts
    /// through its lines — the same rules as `category_spending_by_month`,
    /// just summed per day instead of per (month, category). A day with no
    /// spend has no row.
    pub fn daily_spending(&self, from_year: i32, from_month: u32, to_year: i32, to_month: u32) -> rusqlite::Result<Vec<DailySpendAmount>> {
        let (range_start, _) = month_bounds(from_year, from_month);
        let (_, range_end) = month_bounds(to_year, to_month);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT date, amount FROM transactions
             WHERE (category IS NULL OR category <> 'Transfer') AND date >= ?1 AND date < ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND deleted_at IS NULL
             UNION ALL
             SELECT t.date, ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE (ts.category IS NULL OR ts.category <> 'Transfer') AND t.date >= ?1 AND t.date < ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND t.deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map(params![range_start.to_string(), range_end.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut totals: std::collections::BTreeMap<String, Decimal> = std::collections::BTreeMap::new();
        for row in rows {
            let (date, amount) = row?;
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            if amount < Decimal::ZERO {
                *totals.entry(date).or_insert(Decimal::ZERO) -= amount;
            }
        }
        Ok(totals.into_iter().map(|(date, amount)| DailySpendAmount { date, amount }).collect())
    }

    /// The top `limit` merchants by total spend within
    /// `[start_date, end_date]` — "merchant" here is just the raw
    /// transaction description, since this app has no separate normalized
    /// merchant-name concept; a repeat merchant with varying suffixes
    /// (store numbers, etc.) lists as separate entries. Excludes
    /// `apply_debt_payment`'s generated transactions (its "Payment applied
    /// from: ..." description isn't a merchant) — see `all_transactions`'s
    /// doc comment.
    pub fn top_merchants(&self, start_date: NaiveDate, end_date: NaiveDate, limit: usize) -> rusqlite::Result<Vec<(String, Decimal)>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT description, amount FROM transactions
             WHERE date >= ?1 AND date <= ?2
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND (category IS NULL OR category <> 'Transfer')
                   AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map(params![start_date.to_string(), end_date.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut totals: std::collections::BTreeMap<String, Decimal> = std::collections::BTreeMap::new();
        for row in rows {
            let (description, amount) = row?;
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            if amount < Decimal::ZERO {
                *totals.entry(description).or_insert(Decimal::ZERO) -= amount;
            }
        }
        let mut result: Vec<(String, Decimal)> = totals.into_iter().collect();
        result.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        result.truncate(limit);
        Ok(result)
    }

    /// Total net worth *as of* a given date — each account's balance
    /// computed by `account_balance_as_of` (so a monthly reset, if any,
    /// is honored exactly as it would be for "now", and a loan's
    /// transactions are already netted in the "positive = payment"
    /// direction by that function). Cash/investment/other accounts add
    /// their balance as-is; a credit account's `starting_balance` is a
    /// limit (owed starts at $0, so only the change since it —
    /// `balance - starting_balance` — counts); a loan's balance directly
    /// represents what's owed (so it's subtracted in full) — no snapshot
    /// storage beyond `balance_resets` needed, since this is fully
    /// computable from data already on hand for any date, past or
    /// present.
    pub fn net_worth_as_of(&self, as_of: NaiveDate) -> rusqlite::Result<Decimal> {
        Ok(self.net_worth_breakdown_as_of(as_of)?.net_worth)
    }

    /// Same computation as `net_worth_as_of`, but also splits the total
    /// into the groups the Dashboard's stat cards show (cash, debt,
    /// investments) — one account pass shared by all four figures instead
    /// of a separate query per group. `cash`/`debt`/`investments` use the
    /// same per-group contribution convention as `net_worth`: `debt`
    /// (credit + loan combined) is negative-signed, matching how it's
    /// displayed everywhere else in the app.
    pub fn net_worth_breakdown_as_of(&self, as_of: NaiveDate) -> rusqlite::Result<NetWorthBreakdown> {
        let mut breakdown = NetWorthBreakdown::default();
        for account in self.account_contributions_as_of(as_of)? {
            breakdown.net_worth += account.contribution;
            match account.group.as_str() {
                "cash" => breakdown.cash += account.contribution,
                "credit" | "loan" => breakdown.debt += account.contribution,
                "investment" => breakdown.investments += account.contribution,
                _ => {}
            }
        }
        Ok(breakdown)
    }

    /// Every account's own net-worth contribution as of `as_of`, alongside
    /// its name and group — the same per-account values
    /// `net_worth_breakdown_as_of` sums together, kept separate here so a
    /// caller can see which *account* a total is made of, not just the
    /// total itself.
    fn account_contributions_as_of(&self, as_of: NaiveDate) -> rusqlite::Result<Vec<AccountContribution>> {
        let mut stmt = self.conn.prepare("SELECT id, name, account_type, starting_balance FROM accounts")?;
        let accounts: Vec<(i64, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let holdings_value = self.holdings_value_by_account()?;
        let mut result = Vec::with_capacity(accounts.len());
        for (id, name, account_type, starting_balance_str) in accounts {
            let starting_balance = Decimal::from_str(&starting_balance_str).expect("starting_balance stored by this crate must be valid");
            let mut balance = self.account_balance_as_of(id, &account_type, starting_balance, as_of)?;
            let account_type = AccountType::parse(&account_type).expect("account_type stored by this crate must be valid");
            let group = account_type.group();
            // Same holdings-take-priority rule as `list_accounts` — see its
            // comment. Only ever "as of today" in effect: a holding has no
            // historical price record, so its current value is applied at
            // every past date too, same convention `assetsTotal` already
            // uses for Property & Valuables in the Dashboard's own trend
            // chart (a flat approximation is far less misleading than the
            // $0 this used to show throughout).
            if group == "investment"
                && let Some(&value) = holdings_value.get(&id)
            {
                balance = value;
            }
            let contribution = match group {
                "credit" => balance - starting_balance,
                "loan" => -balance,
                _ => balance,
            };
            result.push(AccountContribution {
                account_id: id,
                name,
                group: group.to_string(),
                contribution,
            });
        }
        Ok(result)
    }

    /// Per-account movement in net-worth contribution between two dates —
    /// the "what changed" behind a Dashboard stat card's trend: when the
    /// Debt tile shows "on pace up $500 over 6mo," this is how the app
    /// knows whether that was the car loan or the credit card, rather than
    /// leaving the total unexplained. Sorted by the size of the move
    /// (largest absolute delta first); an account with no change between
    /// the two dates is dropped rather than shown as a $0.00 row.
    pub fn account_contribution_deltas(&self, from: NaiveDate, to: NaiveDate) -> rusqlite::Result<Vec<AccountContributionDelta>> {
        let from_amounts: std::collections::HashMap<i64, Decimal> = self
            .account_contributions_as_of(from)?
            .into_iter()
            .map(|a| (a.account_id, a.contribution))
            .collect();

        let mut result: Vec<AccountContributionDelta> = self
            .account_contributions_as_of(to)?
            .into_iter()
            .filter_map(|a| {
                let from_amount = from_amounts.get(&a.account_id).copied().unwrap_or(Decimal::ZERO);
                let delta = a.contribution - from_amount;
                if delta == Decimal::ZERO {
                    return None;
                }
                Some(AccountContributionDelta {
                    account_id: a.account_id,
                    name: a.name,
                    group: a.group,
                    from_amount,
                    to_amount: a.contribution,
                    delta,
                })
            })
            .collect();
        result.sort_by_key(|a| std::cmp::Reverse(a.delta.abs()));
        Ok(result)
    }
}
