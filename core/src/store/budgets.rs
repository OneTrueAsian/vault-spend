//! Budgets: monthly budget lines, actuals, rollover, suggestions, month review and budget alerts.

use super::{LIVE_TRANSFER_LEG_IDS_SQL, Store, month_bounds};
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

/// A budgeted category's monthly target and which group it's organized
/// under (Income/Fixed/Flexible/Non-monthly).
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetLine {
    pub category: String,
    pub budget_group: String,
    pub monthly_amount: Decimal,
    pub cap_enabled: bool,
    /// Unspent budget carries into the next month — see
    /// `Store::monthly_budget_actuals`.
    pub rollover_enabled: bool,
}

/// One row of the Budget page's "suggest from my recent average" preview
/// — see `Store::suggest_budgets_from_average`.
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetSuggestion {
    pub category: String,
    /// The group the line would land in: the one it already has for the
    /// month being budgeted, otherwise Flexible.
    pub budget_group: String,
    /// What the month already budgets for it, if anything.
    pub current: Option<Decimal>,
    /// Average monthly spend over the window, rounded to a whole dollar.
    pub suggested: Decimal,
}

/// The suggestions plus how much history they rest on.
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetSuggestions {
    /// How many whole months the averages cover — fewer than asked for when
    /// the history is short, 0 when there is nothing before the month.
    pub months_used: u32,
    pub lines: Vec<BudgetSuggestion>,
}

/// A budgeted category's target vs. actual spend for one specific
/// calendar month (see `Store::monthly_budget_actuals`).
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetActual {
    pub category: String,
    pub budget_group: String,
    pub budgeted: Decimal,
    pub actual: Decimal,
    pub cap_enabled: bool,
    pub rollover_enabled: bool,
    /// Unspent budget carried in from earlier months (zero unless
    /// `rollover_enabled`). What the month has to spend is `budgeted +
    /// rollover`; `budgeted` itself stays the amount that was planned.
    pub rollover: Decimal,
}

/// One category's target vs. one family member's share of the actual
/// spend behind it, for one specific calendar month (see
/// `Store::monthly_budget_actuals_by_member`) — `budgeted` is always the
/// category's one shared target (there's no per-member budget), repeated
/// on every member's row for that category. `member_id`/`member_name` are
/// both `None` for the unattributed share, not omitted.
#[derive(Debug, Clone, PartialEq)]
pub struct MemberBudgetActual {
    pub category: String,
    pub budget_group: String,
    pub budgeted: Decimal,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    pub actual: Decimal,
}

/// A budgeted category that's at or near its monthly limit (see
/// `Store::budget_alerts_for_month`) — `level` is `"warning"` (>= 80% of
/// budget spent, or >= 90% if `cap_enabled`) or `"over"` (> 100%).
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetAlert {
    pub category: String,
    pub budget_group: String,
    pub budgeted: Decimal,
    pub actual: Decimal,
    pub pct: Decimal,
    pub level: String,
    pub cap_enabled: bool,
}

/// One line item contributing to a category's actual spend for a month
/// (see `Store::transactions_for_category_in_month`) — either a whole
/// transaction, or one split line of a split transaction (`is_split`),
/// kept as its own entry with just that split's own amount/note rather
/// than the parent transaction's full amount, matching how
/// `monthly_budget_actuals` attributes a split line to its own category
/// instead of the parent's.
#[derive(Debug, Clone, PartialEq)]
pub struct CategoryTransaction {
    pub transaction_id: i64,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
    pub account_name: String,
    pub is_split: bool,
    pub split_note: Option<String>,
}

/// One budgeted expense category that overspent its month — see
/// `Store::month_review`.
#[derive(Debug, Clone, PartialEq)]
pub struct OverBudgetLine {
    pub category: String,
    pub budgeted: Decimal,
    pub actual: Decimal,
}

/// What the month-end review walks through for one month — see
/// `Store::month_review`.
#[derive(Debug, Clone, PartialEq)]
pub struct MonthReview {
    pub year: i32,
    pub month: u32,
    pub income: Decimal,
    /// Spending as a positive number.
    pub expenses: Decimal,
    pub prev_income: Decimal,
    pub prev_expenses: Decimal,
    /// Biggest overage first.
    pub over_budget: Vec<OverBudgetLine>,
    pub uncategorized_count: usize,
    /// Sum of the uncategorized transactions' absolute amounts.
    pub uncategorized_total: Decimal,
    pub reviewed: bool,
}

/// The "YYYY-MM" month key `back` whole months before `year`/`month` (0 =
/// `year`/`month` itself) — plain integer month arithmetic since callers
/// only ever need the key string, not a real calendar date.
pub(super) fn month_key_back(year: i32, month: u32, back: u32) -> String {
    let total = i64::from(year) * 12 + i64::from(month) - 1 - i64::from(back);
    let y = total.div_euclid(12);
    let m = total.rem_euclid(12) + 1;
    format!("{y:04}-{m:02}")
}

impl Store {
    /// Sets (or updates) one category's target budget amount and group
    /// for one specific calendar month (`period`, "YYYY-MM") — completely
    /// independent of every other month, on purpose: this never touches
    /// a different period's row, so adjusting August never moves
    /// July's or September's numbers.
    pub fn set_budget(&self, category: &str, period: &str, monthly_amount: Decimal, budget_group: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(category, period) DO UPDATE SET monthly_amount = excluded.monthly_amount, budget_group = excluded.budget_group",
            params![category, period, monthly_amount.to_string(), budget_group],
        )?;
        self.conn
            .execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?1)", params![period])?;
        self.conn
            .execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![category])?;
        Ok(())
    }

    /// Opts a category's specific month in or out of the stricter 90%
    /// warning threshold (see `Store::budget_alerts_for_month`) — a
    /// dedicated single-field setter, same convention as
    /// `set_bucket_member`/`set_recurring_member`, so `set_budget` itself
    /// (and its many existing call sites) never needs to change. A
    /// (category, period) pair with no budget line yet is a harmless
    /// no-op, matching `delete_budget`'s convention.
    pub fn set_budget_cap(&self, category: &str, period: &str, cap_enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE budgets SET cap_enabled = ?1 WHERE category = ?2 AND period = ?3",
            params![cap_enabled, category, period],
        )?;
        Ok(())
    }

    /// Opts a category's specific month in or out of carrying its unspent
    /// budget forward — a dedicated single-field setter, same convention as
    /// `set_budget_cap`. A (category, period) pair with no line is a harmless
    /// no-op. Like every other per-line setting the choice is copied into
    /// each month that materializes from this one.
    pub fn set_budget_rollover(&self, category: &str, period: &str, rollover_enabled: bool) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE budgets SET rollover_enabled = ?1 WHERE category = ?2 AND period = ?3",
            params![rollover_enabled, category, period],
        )?;
        Ok(())
    }

    /// Every budgeted category for `period` ("YYYY-MM"), its group, and
    /// its monthly target — fully independent of every other period.
    /// The first time a period that's never been touched is requested,
    /// it's materialized by copying the most recent *earlier* touched
    /// period: a one-time starting point (so a new month doesn't start
    /// blank), not an ongoing link — the copy becomes this period's own
    /// rows immediately, and editing it from here on never touches the
    /// period it was copied from. A period with nothing earlier to copy
    /// from (the very first budget ever set) simply starts empty.
    ///
    /// Whether a period has been "touched" is tracked in `budget_periods`
    /// rather than by checking `budgets` directly — deleting a period's
    /// last line must leave it genuinely empty, not indistinguishable
    /// from never having been visited (which would silently resurrect
    /// the deleted line from an earlier month on the next read). Note
    /// this "read" can write on a cache-miss — deliberate, since
    /// materializing real rows is what makes later edits to this period
    /// stay isolated from the one it came from.
    pub fn list_budgets(&self, period: &str) -> rusqlite::Result<Vec<BudgetLine>> {
        let already_touched: bool = self
            .conn
            .query_row("SELECT EXISTS(SELECT 1 FROM budget_periods WHERE period = ?1)", params![period], |row| {
                row.get(0)
            })?;

        if !already_touched {
            let source_period: Option<String> = match self.conn.query_row(
                "SELECT period FROM budget_periods WHERE period < ?1 ORDER BY period DESC LIMIT 1",
                params![period],
                |row| row.get(0),
            ) {
                Ok(p) => Some(p),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(e),
            };

            if let Some(source_period) = source_period {
                self.conn.execute(
                    "INSERT INTO budgets (category, period, monthly_amount, budget_group, cap_enabled, rollover_enabled)
                     SELECT category, ?1, monthly_amount, budget_group, cap_enabled, rollover_enabled FROM budgets WHERE period = ?2",
                    params![period, source_period],
                )?;
            }
            self.conn
                .execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?1)", params![period])?;
        }

        let mut stmt = self.conn.prepare(
            "SELECT category, budget_group, monthly_amount, cap_enabled, rollover_enabled FROM budgets WHERE period = ?1 ORDER BY category",
        )?;
        let rows = stmt.query_map(params![period], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, bool>(4)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (category, budget_group, amount, cap_enabled, rollover_enabled) = row?;
            result.push(BudgetLine {
                category,
                budget_group,
                monthly_amount: Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
                cap_enabled,
                rollover_enabled,
            });
        }
        Ok(result)
    }

    /// What each category would be budgeted at if the month being planned
    /// (`year`/`month`) simply repeated the average of the `months` whole
    /// months before it. Built on `spending_by_category`, so transfers,
    /// income and debt-payment rows never show up. A month counts only if it
    /// ended after the very first transaction on the books — a user with
    /// two months of history gets a two-month average, not one diluted by an
    /// empty third — and a month with no spend in a category still counts
    /// as $0 for it. Averages round to a whole dollar and anything that
    /// rounds to $0 is dropped. Biggest first.
    ///
    /// Like `list_budgets`, this can materialize the month's budget rows
    /// (it reads what the month already budgets so the preview can show
    /// "current"), which is harmless: the month is being viewed anyway.
    pub fn suggest_budgets_from_average(&self, year: i32, month: u32, months: u32) -> rusqlite::Result<BudgetSuggestions> {
        let empty = BudgetSuggestions {
            months_used: 0,
            lines: Vec::new(),
        };
        let earliest: Option<String> = self
            .conn
            .query_row("SELECT MIN(date) FROM transactions WHERE deleted_at IS NULL", [], |row| row.get(0))?;
        let Some(earliest) = earliest.and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok()) else {
            return Ok(empty);
        };

        let mut totals: std::collections::BTreeMap<String, Decimal> = std::collections::BTreeMap::new();
        let mut months_used = 0u32;
        for back in (1..=months).rev() {
            let index = i64::from(year) * 12 + i64::from(month) - 1 - i64::from(back);
            let (y, m) = (index.div_euclid(12) as i32, (index.rem_euclid(12) + 1) as u32);
            let (first, next_first) = month_bounds(y, m);
            if next_first <= earliest {
                continue; // that month ended before any history began
            }
            months_used += 1;
            let last = next_first.pred_opt().expect("a month's last day exists");
            for (category, spent) in self.spending_by_category(first, last)? {
                *totals.entry(category).or_insert(Decimal::ZERO) += spent;
            }
        }
        if months_used == 0 {
            return Ok(empty);
        }

        let budgeted: std::collections::HashMap<String, BudgetLine> = self
            .list_budgets(&format!("{year:04}-{month:02}"))?
            .into_iter()
            .map(|b| (b.category.clone(), b))
            .collect();

        let divisor = Decimal::from(months_used);
        let mut lines: Vec<BudgetSuggestion> = totals
            .into_iter()
            .filter_map(|(category, total)| {
                let suggested = (total / divisor).round_dp_with_strategy(0, rust_decimal::RoundingStrategy::MidpointAwayFromZero);
                if suggested < Decimal::ONE {
                    return None;
                }
                let existing = budgeted.get(&category);
                Some(BudgetSuggestion {
                    budget_group: existing.map(|b| b.budget_group.clone()).unwrap_or_else(|| "flexible".to_string()),
                    current: existing.map(|b| b.monthly_amount),
                    category,
                    suggested,
                })
            })
            .collect();
        lines.sort_by(|a, b| b.suggested.cmp(&a.suggested).then_with(|| a.category.cmp(&b.category)));
        Ok(BudgetSuggestions { months_used, lines })
    }

    /// Everything the month-end review shows for `year`/`month`: income and
    /// spending beside the month before (transfers and debt-payment rows are
    /// out of both, same as `monthly_totals`), the budgeted expense
    /// categories that overspent (income lines never count as over), how
    /// many transactions still lack a category and what they add up to (a
    /// split purchase, a transfer, a debt-payment row or a deleted
    /// transaction never counts as one), and whether the review was already
    /// finished.
    pub fn month_review(&self, year: i32, month: u32) -> rusqlite::Result<MonthReview> {
        let (income, expenses) = self.monthly_totals(year, month)?;
        let (prev_year, prev_month) = if month == 1 { (year - 1, 12) } else { (year, month - 1) };
        let (prev_income, prev_expenses) = self.monthly_totals(prev_year, prev_month)?;

        let mut over_budget: Vec<OverBudgetLine> = self
            .monthly_budget_actuals(year, month)?
            .into_iter()
            .filter(|b| b.budget_group != "income" && b.actual > b.budgeted + b.rollover)
            .map(|b| OverBudgetLine {
                category: b.category,
                budgeted: b.budgeted + b.rollover,
                actual: b.actual,
            })
            .collect();
        over_budget.sort_by(|a, b| {
            (b.actual - b.budgeted)
                .cmp(&(a.actual - a.budgeted))
                .then_with(|| a.category.cmp(&b.category))
        });

        let (first, next_first) = month_bounds(year, month);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT amount FROM transactions
             WHERE category IS NULL AND date >= ?1 AND date < ?2 AND deleted_at IS NULL
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})"
        ))?;
        let amounts = stmt
            .query_map(params![first.to_string(), next_first.to_string()], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let uncategorized_total: Decimal = amounts
            .iter()
            .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid").abs())
            .sum();

        let reviewed = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM month_reviews WHERE period = ?1)",
            params![format!("{year:04}-{month:02}")],
            |row| row.get(0),
        )?;

        Ok(MonthReview {
            year,
            month,
            income,
            expenses,
            prev_income,
            prev_expenses,
            over_budget,
            uncategorized_count: amounts.len(),
            uncategorized_total,
            reviewed,
        })
    }

    /// Marks a month's review as finished. Marking one twice is harmless.
    pub fn set_month_reviewed(&self, year: i32, month: u32) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO month_reviews (period) VALUES (?1)",
            params![format!("{year:04}-{month:02}")],
        )?;
        Ok(())
    }

    /// Every finished month, as "YYYY-MM", oldest first.
    pub fn list_reviewed_months(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT period FROM month_reviews ORDER BY period")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect()
    }

    /// Removes one category's budget line for one specific month only —
    /// an unknown (category, period) pair is a harmless no-op, and every
    /// other month's line for that category is untouched.
    pub fn delete_budget(&self, category: &str, period: &str) -> rusqlite::Result<()> {
        self.conn
            .execute("DELETE FROM budgets WHERE category = ?1 AND period = ?2", params![category, period])?;
        Ok(())
    }

    /// All-time total across every bucket's contributions — summed in Rust
    /// with `Decimal`, same reasoning as `list_buckets`.
    pub fn total_saved(&self) -> rusqlite::Result<Decimal> {
        let mut stmt = self.conn.prepare("SELECT amount FROM bucket_contributions")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut total = Decimal::ZERO;
        for row in rows {
            total += Decimal::from_str(&row?).expect("amount stored by this crate must be valid");
        }
        Ok(total)
    }

    /// All-time total of every transaction that counts as income — the
    /// same rule `monthly_totals` applies per month (a positive amount that
    /// isn't a Transfer, and isn't a credit/loan account's own
    /// balance-side entry — restoring available credit or a loan escrow
    /// refund is a balance adjustment, never income), not "categorized
    /// literally 'Income'". Reports' "Income (all-time)" stat must never
    /// disagree with what Cash Flow — driven by `monthly_totals` — reports
    /// for the same transactions summed across every month; the previous
    /// `category = 'Income'` requirement silently returned $0 here for any
    /// user who categorized their paycheck "Salary" or anything else, even
    /// though `RuleSet::seeded`'s "Income" category (payroll, interest) is
    /// only ever a default guess, not something every income transaction
    /// is guaranteed to carry. Excludes `apply_debt_payment`'s generated
    /// transactions, same as `all_transactions` — see its doc comment.
    pub fn income_total(&self) -> rusqlite::Result<Decimal> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT t.amount, a.account_type FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND (t.category IS NULL OR t.category <> 'Transfer')
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND t.deleted_at IS NULL"
        ))?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        let mut total = Decimal::ZERO;
        for row in rows {
            let (amount_str, account_type) = row?;
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            if amount > Decimal::ZERO && account_type != "credit" && account_type != "loan" {
                total += amount;
            }
        }
        Ok(total)
    }

    /// For every budgeted category *in this specific month* (see
    /// `list_budgets` — a month with no budget of its own materializes
    /// from the most recent earlier one), its target and how much was
    /// actually spent — `(category, budgeted, actual)`. `actual` is
    /// shown as a positive "spent" number (transactions are negative for
    /// money out), 0 for a budgeted category with no transactions yet in
    /// that month rather than being omitted.
    ///
    /// A split transaction (see `set_transaction_splits`) contributes
    /// through its split lines' own categories instead of its own —
    /// `id NOT IN (...)` excludes any transaction that's been split from
    /// also counting under its own (now superseded) category. Also excludes
    /// `apply_debt_payment`'s generated transactions, same as
    /// `all_transactions` — see its doc comment: the real expense already
    /// counts through the source transaction, so counting the generated
    /// one too would inflate "actual" by whatever was applied to the debt.
    pub fn monthly_budget_actuals(&self, year: i32, month: u32) -> rusqlite::Result<Vec<BudgetActual>> {
        let month_key = format!("{year:04}-{month:02}");
        let budgets = self.list_budgets(&month_key)?;
        let (first, next_first) = month_bounds(year, month);

        // One query covering every category at once (previously one query
        // *per budgeted category*) — summed in Rust with `Decimal`, not
        // SQL `SUM()`, since `amount` is stored as TEXT and SQLite's SUM
        // would do the addition in floating point rather than exact
        // decimal arithmetic.
        let mut stmt = self.conn.prepare(
            "SELECT category, amount FROM transactions
             WHERE date >= ?1 AND date < ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND deleted_at IS NULL
             UNION ALL
             SELECT ts.category, ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE t.date >= ?1 AND t.date < ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.deleted_at IS NULL",
        )?;
        let rows = stmt.query_map(params![first.to_string(), next_first.to_string()], |row| {
            Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut raw_by_category: std::collections::HashMap<String, Decimal> = std::collections::HashMap::new();
        for row in rows {
            let (category, amount_str) = row?;
            let Some(category) = category else { continue };
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            *raw_by_category.entry(category).or_insert(Decimal::ZERO) += amount;
        }

        // The global switch: with it off nothing is carried in, whatever each
        // category has chosen (the choices themselves are never rewritten).
        let rollover_feature_on = self.get_app_settings()?.rollover_enabled;
        let mut result = Vec::with_capacity(budgets.len());
        for line in budgets {
            let raw = raw_by_category.get(&line.category).copied().unwrap_or(Decimal::ZERO);
            // Expense transactions are stored negative, so negating
            // reports a positive "amount spent" — but income transactions
            // are stored positive already and must not be flipped, or a
            // real deposit reads as negative "actual".
            let spent = if line.budget_group == "income" { raw } else { -raw };
            let rollover = if rollover_feature_on && line.rollover_enabled && line.budget_group != "income" {
                self.rollover_carry(&line.category, year, month)?
            } else {
                Decimal::ZERO
            };
            result.push(BudgetActual {
                category: line.category,
                budget_group: line.budget_group,
                budgeted: line.monthly_amount,
                actual: spent,
                cap_enabled: line.cap_enabled,
                rollover_enabled: line.rollover_enabled,
                rollover,
            });
        }
        Ok(result)
    }

    /// What a category with rollover on brings into `year`/`month` from the
    /// months before it: each earlier month's unspent budget (its budget plus
    /// whatever it carried in, minus what was spent, never below zero),
    /// chained month to month. The chain starts at the first month of an
    /// unbroken run of months that all have this category's line with
    /// rollover on — switching it on starts fresh, and a month where the line
    /// is missing or rollover is off breaks the run. A month is read as the
    /// budget it actually had: one never opened has its most recent earlier
    /// month's line (the same rule `list_budgets` materializes by), without
    /// writing anything.
    fn rollover_carry(&self, category: &str, year: i32, month: u32) -> rusqlite::Result<Decimal> {
        const MAX_MONTHS_BACK: u32 = 36;

        // (base budget, month key), newest first, for the unbroken run.
        let mut run: Vec<(Decimal, String)> = Vec::new();
        for back in 0..MAX_MONTHS_BACK {
            let key = month_key_back(year, month, back);
            let touched: Option<String> = match self.conn.query_row(
                "SELECT period FROM budget_periods WHERE period <= ?1 ORDER BY period DESC LIMIT 1",
                params![key],
                |row| row.get(0),
            ) {
                Ok(p) => Some(p),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(e),
            };
            let Some(source_period) = touched else { break };
            let line = match self.conn.query_row(
                "SELECT monthly_amount, rollover_enabled FROM budgets WHERE category = ?1 AND period = ?2",
                params![category, source_period],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?)),
            ) {
                Ok(l) => Some(l),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(e),
            };
            match line {
                Some((amount, true)) => run.push((Decimal::from_str(&amount).expect("amount stored by this crate must be valid"), key)),
                _ => break,
            }
        }

        // The run is newest first; the target month is its head and only
        // needs what the months before it leave behind.
        let mut carry = Decimal::ZERO;
        for (base, key) in run.iter().skip(1).rev() {
            let unspent = *base + carry - self.expense_spent_in_month(category, key)?;
            carry = unspent.max(Decimal::ZERO);
        }
        Ok(carry)
    }

    /// What one expense category spent in one "YYYY-MM" month, as a positive
    /// number — the same split-aware, debt-payment-exclusion-aware sum
    /// `monthly_budget_actuals` uses, for a single category.
    fn expense_spent_in_month(&self, category: &str, month_key: &str) -> rusqlite::Result<Decimal> {
        let mut stmt = self.conn.prepare(
            "SELECT amount FROM transactions
             WHERE category = ?1 AND substr(date, 1, 7) = ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND deleted_at IS NULL
             UNION ALL
             SELECT ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category = ?1 AND substr(t.date, 1, 7) = ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.deleted_at IS NULL",
        )?;
        let rows = stmt.query_map(params![category, month_key], |row| row.get::<_, String>(0))?;
        let mut raw = Decimal::ZERO;
        for row in rows {
            raw += Decimal::from_str(&row?).expect("amount stored by this crate must be valid");
        }
        Ok(-raw)
    }

    /// Same as `monthly_budget_actuals`, further split by which family
    /// member's transactions made up each category's actual — reuses the
    /// identical split/debt-payment-exclusion-aware query rather than
    /// reimplementing it, since a purely client-side reduction over
    /// `list_transactions`'s output would silently misattribute a split
    /// transaction (its own `category` field is stale once split; the
    /// frontend never receives `transaction_splits` rows to know that). A
    /// split line's member is the *parent* transaction's — a split carries
    /// no member of its own.
    ///
    /// Unattributed spend is bucketed under `member_id: None`
    /// ("Unassigned") rather than dropped, unlike the simpler top-level
    /// "spending by person" stat cards (`memberBreakdowns.ts` on the
    /// frontend) — this table exists to reconcile against
    /// `monthly_budget_actuals`'s own category total, and dropping
    /// unattributed spend would make the member rows visibly undercount
    /// it. A category with no transactions at all this month (from any
    /// member) simply produces no rows, matching `monthly_budget_actuals`'s
    /// own $0 for that category once summed back up.
    pub fn monthly_budget_actuals_by_member(&self, year: i32, month: u32) -> rusqlite::Result<Vec<MemberBudgetActual>> {
        let month_key = format!("{year:04}-{month:02}");
        let budgets = self.list_budgets(&month_key)?;
        let member_names: std::collections::HashMap<i64, String> = self.list_family_members()?.into_iter().map(|m| (m.id, m.name)).collect();

        let mut stmt = self.conn.prepare(
            "SELECT amount, member_id FROM transactions
             WHERE category = ?1 AND substr(date, 1, 7) = ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND deleted_at IS NULL
             UNION ALL
             SELECT ts.amount, t.member_id FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category = ?1 AND substr(t.date, 1, 7) = ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.deleted_at IS NULL",
        )?;

        let mut result = Vec::new();
        for line in budgets {
            let rows = stmt.query_map(params![line.category, month_key], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?))
            })?;

            let mut by_member: std::collections::BTreeMap<Option<i64>, Decimal> = std::collections::BTreeMap::new();
            for row in rows {
                let (amount_str, member_id) = row?;
                let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
                let signed = if line.budget_group == "income" { amount } else { -amount };
                *by_member.entry(member_id).or_insert(Decimal::ZERO) += signed;
            }

            for (member_id, actual) in by_member {
                result.push(MemberBudgetActual {
                    category: line.category.clone(),
                    budget_group: line.budget_group.clone(),
                    budgeted: line.monthly_amount,
                    member_id,
                    member_name: member_id.and_then(|id| member_names.get(&id).cloned()),
                    actual,
                });
            }
        }
        Ok(result)
    }

    /// One category's actual spend for each of the trailing `months`
    /// months ending at (and including) `year`/`month` — same
    /// split-aware, debt-payment-exclusion-aware query as
    /// `monthly_budget_actuals`, just parameterized by a fixed category
    /// and looped over months instead of over every budgeted category.
    /// Oldest month first. Doesn't consult `list_budgets` at all — a
    /// month with $0 actual and no budget line still returns a `0.00`
    /// point rather than being skipped, so a sparkline never has to
    /// special-case a missing month.
    pub fn budget_actuals_trend(&self, category: &str, year: i32, month: u32, months: u32) -> rusqlite::Result<Vec<(String, Decimal)>> {
        let mut stmt = self.conn.prepare(
            "SELECT amount FROM transactions
             WHERE category = ?1 AND substr(date, 1, 7) = ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND deleted_at IS NULL
             UNION ALL
             SELECT ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE ts.category = ?1 AND substr(t.date, 1, 7) = ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.deleted_at IS NULL",
        )?;
        let is_income = self
            .list_budgets(&format!("{year:04}-{month:02}"))?
            .into_iter()
            .find(|b| b.category == category)
            .map(|b| b.budget_group == "income")
            .unwrap_or(false);

        let mut result = Vec::with_capacity(months as usize);
        for back in (0..months).rev() {
            let month_key = month_key_back(year, month, back);
            let rows = stmt.query_map(params![category, month_key], |row| row.get::<_, String>(0))?;
            let mut spent = Decimal::ZERO;
            for row in rows {
                let amount = Decimal::from_str(&row?).expect("amount stored by this crate must be valid");
                if is_income {
                    spent += amount;
                } else {
                    spent -= amount;
                }
            }
            result.push((month_key, spent));
        }
        Ok(result)
    }

    /// Every line item behind one category's `monthly_budget_actuals`
    /// entry for a month — clicking a category on the Budget page drills
    /// into this. Same split-aware shape as `monthly_budget_actuals`: a
    /// transaction that's been split contributes its split lines instead
    /// of itself, and `apply_debt_payment`'s generated transactions are
    /// excluded the same way too, so the line items shown here sum to
    /// exactly the same "actual" the budget row displays. Sorted oldest
    /// first.
    pub fn transactions_for_category_in_month(&self, category: &str, year: i32, month: u32) -> rusqlite::Result<Vec<CategoryTransaction>> {
        let month_key = format!("{year:04}-{month:02}");
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.date, t.description, t.amount, a.name, 0, NULL
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.category = ?1 AND substr(t.date, 1, 7) = ?2
                   AND t.id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.deleted_at IS NULL
             UNION ALL
             SELECT t.id, t.date, t.description, ts.amount, a.name, 1, ts.note
             FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             JOIN accounts a ON a.id = t.account_id
             WHERE ts.category = ?1 AND substr(t.date, 1, 7) = ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.deleted_at IS NULL
             ORDER BY 2",
        )?;
        let rows = stmt.query_map(params![category, month_key], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (transaction_id, date, description, amount, account_name, is_split, split_note) = row?;
            result.push(CategoryTransaction {
                transaction_id,
                date: NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                description,
                amount: Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
                account_name,
                is_split,
                split_note,
            });
        }
        Ok(result)
    }

    /// The expense lines behind a Dashboard or Cash Flow category slice.
    /// Keep the exclusions and split attribution aligned with
    /// `category_spending_by_month` so the rows reconcile to the chart.
    pub fn spending_transactions_for_category_in_month(&self, category: &str, year: i32, month: u32) -> rusqlite::Result<Vec<CategoryTransaction>> {
        if category == "Transfer" {
            return Ok(Vec::new());
        }
        let (first, next_first) = month_bounds(year, month);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT t.id, t.date, t.description, t.amount, a.name, 0, NULL
             FROM transactions t JOIN accounts a ON a.id = t.account_id
             WHERE COALESCE(t.category, 'Uncategorized') = ?1 AND (t.category IS NULL OR t.category <> 'Transfer')
                   AND t.date >= ?2 AND t.date < ?3
                   AND t.id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL}) AND t.deleted_at IS NULL
             UNION ALL
             SELECT t.id, t.date, t.description, ts.amount, a.name, 1, ts.note
             FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             JOIN accounts a ON a.id = t.account_id
             WHERE COALESCE(ts.category, 'Uncategorized') = ?1 AND (ts.category IS NULL OR ts.category <> 'Transfer')
                   AND t.date >= ?2 AND t.date < ?3
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL}) AND t.deleted_at IS NULL
             ORDER BY 2, 1"
        ))?;
        let rows = stmt.query_map(params![category, first.to_string(), next_first.to_string()], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })?;
        let mut result = Vec::new();
        for row in rows {
            let (transaction_id, date, description, amount, account_name, is_split, split_note) = row?;
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            if amount >= Decimal::ZERO {
                continue;
            }
            result.push(CategoryTransaction {
                transaction_id,
                date: NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                description,
                amount,
                account_name,
                is_split,
                split_note,
            });
        }
        Ok(result)
    }

    /// Which budgeted categories are at or near their monthly limit —
    /// built on top of `monthly_budget_actuals`, no separate query. A
    /// category shows up once it's spent 80% or more of its budget
    /// (`"warning"`) — or 90% or more if it's opted into a cap via
    /// `set_budget_cap` (a stricter threshold, not an additional tier) —
    /// landing exactly on 100% still counts as a warning, not "over"; only
    /// spending *past* the budget (`"over"`) does. Anything below the
    /// warning threshold, any income line (exceeding an income budget is
    /// already a positive, never an alert), and any zero-budgeted line
    /// (nothing to alert against) are all left out entirely rather than
    /// included at 0%.
    pub fn budget_alerts_for_month(&self, year: i32, month: u32) -> rusqlite::Result<Vec<BudgetAlert>> {
        let hundred = Decimal::from(100);
        // Turning the Envelope Caps feature off suspends every category's
        // cap the same way, without touching any of their stored
        // `cap_enabled` flags — see `StoredAppSettings`.
        let caps_feature_enabled = self.get_app_settings()?.envelope_caps_enabled;
        let mut result = Vec::new();
        for line in self.monthly_budget_actuals(year, month)? {
            // What the month actually has to spend: the budget plus anything
            // rolled in from earlier months.
            let available = line.budgeted + line.rollover;
            if line.budget_group == "income" || available <= Decimal::ZERO {
                continue;
            }
            let pct = (line.actual / available) * hundred;
            // A category that's opted into a cap (`cap_enabled`) warns
            // earlier — at 90% instead of the default 80% — replacing that
            // category's threshold rather than adding a third tier on top.
            // Landing exactly on budget (pct == 100) is not overspending —
            // only going past it is, so "over" needs to be strictly
            // greater than 100, not >=.
            let effective_cap = line.cap_enabled && caps_feature_enabled;
            let warning_threshold = if effective_cap { Decimal::from(90) } else { Decimal::from(80) };
            let level = if pct > hundred {
                "over"
            } else if pct >= warning_threshold {
                "warning"
            } else {
                continue;
            };
            result.push(BudgetAlert {
                category: line.category,
                budget_group: line.budget_group,
                budgeted: available,
                actual: line.actual,
                pct,
                level: level.to_string(),
                cap_enabled: effective_cap,
            });
        }
        // Most-severe first — "over" budget outranks "warning" regardless of
        // percent, then furthest-over/closest-to-over within the same level
        // — so a dashboard or list rendering these in order surfaces what
        // actually needs attention first, not whatever order the underlying
        // category list happens to iterate in.
        result.sort_by(|a, b| {
            let rank = |level: &str| if level == "over" { 0 } else { 1 };
            rank(&a.level).cmp(&rank(&b.level)).then(b.pct.cmp(&a.pct))
        });
        Ok(result)
    }
}
