//! Insights: anomaly flags, large expenses, spend-day statistics and dashboard insights.

use super::{LIVE_TRANSFER_LEG_IDS_SQL, Store, month_bounds, normalize_description};
use chrono::{Datelike, NaiveDate};
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

/// One transaction flagged as an anomaly (see `Store::anomaly_flags`) —
/// `kind` is `"large"` or `"duplicate"`, `detail` is a human-readable
/// explanation of why.
#[derive(Debug, Clone, PartialEq)]
pub struct AnomalyFlag {
    pub transaction_id: i64,
    pub kind: String,
    pub detail: String,
}

/// A proactive note for the Dashboard (see `Store::dashboard_insights`) —
/// `severity` is `"warning"` or `"info"`; `kind` is `"pace"` (on pace to
/// exceed a budget), `"category_jump"` (a month-over-month spending jump),
/// or `"large_expense"` (an unusually large charge this month).
#[derive(Debug, Clone, PartialEq)]
pub struct Insight {
    pub severity: String,
    pub kind: String,
    pub message: String,
}

/// A "large" anomaly (see `Store::anomaly_flags`) with enough transaction
/// detail to display directly — used by `Store::large_expenses_in_range`
/// for the cash-flow chart's per-month drill-down, so the frontend doesn't
/// need to separately fetch and cross-reference the full transaction.
#[derive(Debug, Clone, PartialEq)]
pub struct LargeExpense {
    pub transaction_id: i64,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
    pub category: Option<String>,
    pub detail: String,
}

/// The number of days in a given calendar month — computed as the gap
/// between its first day and the next month's first day, rather than a
/// hand-maintained 30/31/28 table, so leap Februaries fall out for free.
fn days_in_month(year: i32, month: u32) -> i64 {
    let (first, next_first) = month_bounds(year, month);
    (next_first - first).num_days()
}

impl Store {
    /// Every transaction currently flagged as an anomaly — an unusually
    /// large charge for its category, or a likely duplicate of another
    /// transaction — computed fresh over all transactions (personal-scale
    /// data, same "don't over-engineer for scale" precedent as the
    /// per-account balance loop). A transaction has at most one flag of
    /// each kind, so it can appear twice (large and duplicate) but never
    /// once per look-alike.
    ///
    /// "Large": a category needs at least 3 other transactions in the
    /// trailing ~6 months (180 days) before `today` to have a baseline to
    /// compare against — too little history and nothing is flagged, since
    /// there's nothing meaningful to be "unusual" relative to. A
    /// transaction over 2.5x that baseline average, and over $50 (a floor
    /// so a tiny category's small absolute swings don't read as "unusual"
    /// just because they're a big multiple), is flagged.
    ///
    /// "Duplicate": any two transactions — regardless of account — with
    /// the exact same signed amount, dated within 3 days of each other,
    /// whose descriptions match once normalized (lowercased, whitespace
    /// collapsed, a trailing digit run like a store/reference number
    /// stripped). This is looking for genuinely separate charges that
    /// happen to look identical (e.g. a subscription billed twice), not
    /// the same import re-added — that's already prevented at import time
    /// by fingerprint-based dedup. The flag names the closest look-alike
    /// (the earlier one on a tie) and counts the rest: "... on 2026-08-02
    /// (and 1 more)".
    pub fn anomaly_flags(&self) -> rusqlite::Result<Vec<AnomalyFlag>> {
        // Capture key and computation in the same SQLite read snapshot, including external writers.
        if self.conn.is_autocommit() {
            return self.read_snapshot(|store| store.cached_anomaly_flags());
        }
        self.cached_anomaly_flags()
    }

    fn cached_anomaly_flags(&self) -> rusqlite::Result<Vec<AnomalyFlag>> {
        let revision = self.read_revision()?;
        if let Some(cache) = self.anomaly_cache.borrow().as_ref().filter(|cache| cache.revision == revision) {
            return Ok(cache.flags.clone());
        }
        let flags = self.compute_anomaly_flags()?;
        let bytes: usize = flags
            .iter()
            .map(|flag| std::mem::size_of::<AnomalyFlag>() + flag.kind.len() + flag.detail.len())
            .sum();
        // One bounded in-memory result per open Store. Dropped on lock/reopen; nothing persisted.
        *self.anomaly_cache.borrow_mut() = if bytes <= 16 * 1024 * 1024 {
            Some(super::AnomalyCache {
                revision,
                flags: flags.clone(),
            })
        } else {
            None
        };
        Ok(flags)
    }

    fn compute_anomaly_flags(&self) -> rusqlite::Result<Vec<AnomalyFlag>> {
        struct Row {
            id: i64,
            date: NaiveDate,
            description: String,
            amount: Decimal,
            category: Option<String>,
        }

        let linked_transfer_legs: std::collections::HashSet<i64> = {
            let mut stmt = self.conn.prepare(LIVE_TRANSFER_LEG_IDS_SQL)?;
            let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };

        let mut stmt = self
            .conn
            .prepare("SELECT id, date, description, amount, category FROM transactions WHERE deleted_at IS NULL ORDER BY id")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;

        let mut all = Vec::new();
        for row in rows {
            let (id, date_str, description, amount_str, category) = row?;
            all.push(Row {
                id,
                date: NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                description,
                amount: Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid"),
                category,
            });
        }

        let mut result = Vec::new();

        // "Large": comparing every transaction against a full linear scan
        // of every other transaction is O(n²). Instead, group by category
        // and sort each group by date, then walk it once with a
        // sliding window (`lo`/`hi` below) tracking exactly the same set
        // the original filter did — every same-category row with
        // `date` in `[row.date - 180 days, row.date)` (strictly *before*
        // `row`, so same-day transactions never count toward each other's
        // baseline) — as a running sum instead of re-scanning it. Both
        // pointers only ever move forward as `row.date` advances through
        // the sorted group, so each group is O(n) after its one sort:
        // O(n log n) overall instead of O(n²).
        let mut by_category: std::collections::HashMap<&str, Vec<&Row>> = std::collections::HashMap::new();
        for row in &all {
            // A big move between the user's own accounts is a transfer,
            // not an unusually large expense — whether it's categorized
            // "Transfer" or is a linked pair under any other category.
            if linked_transfer_legs.contains(&row.id) {
                continue;
            }
            if let Some(category) = row.category.as_ref().filter(|c| c.as_str() != "Transfer") {
                by_category.entry(category.as_str()).or_default().push(row);
            }
        }
        for (category, mut rows) in by_category {
            rows.sort_by_key(|r| r.date);
            let (mut lo, mut hi) = (0usize, 0usize);
            let (mut window_sum, mut window_count) = (Decimal::ZERO, 0usize);
            for row in &rows {
                let window_start = row.date - chrono::Duration::days(180);
                while hi < rows.len() && rows[hi].date < row.date {
                    window_sum += rows[hi].amount.abs();
                    window_count += 1;
                    hi += 1;
                }
                while lo < hi && rows[lo].date < window_start {
                    window_sum -= rows[lo].amount.abs();
                    window_count -= 1;
                    lo += 1;
                }
                if window_count < 3 {
                    continue;
                }
                let baseline = window_sum / Decimal::from(window_count);
                let threshold = baseline * Decimal::new(25, 1); // 2.5x
                if row.amount.abs() > threshold && row.amount.abs() > Decimal::from(50) {
                    result.push(AnomalyFlag {
                        transaction_id: row.id,
                        kind: "large".to_string(),
                        detail: format!(
                            "Unusually large for {category} — {} vs a recent average of {baseline:.2}",
                            row.amount.abs()
                        ),
                    });
                }
            }
        }

        // "Duplicate": amount and normalized description must match
        // exactly, so bucketing by that pair first turns an O(n²)
        // all-pairs scan of all transactions into all-pairs scans of just
        // the (typically tiny) groups that could possibly match — the
        // ±3-day date check is the only thing still checked pairwise,
        // and only within a bucket. `amount.to_string()` (not `amount`
        // itself) is the hash key purely to sidestep ever needing to
        // reason about `Decimal`'s own `Hash` impl — two rows here always
        // come from independently-parsed stored strings, so equal values
        // produce equal strings regardless.
        let mut buckets: std::collections::HashMap<(String, String), Vec<&Row>> = std::collections::HashMap::new();
        for row in &all {
            let key = (row.amount.to_string(), normalize_description(&row.description));
            buckets.entry(key).or_default().push(row);
        }
        // Each transaction gets at most one duplicate flag, naming its closest look-alike and how many
        // more there are. A flag per matching pair grew with the square of a group's size: 2,000
        // same-merchant charges in one month made ~900,000 flags (a 120 MB reply that stalled launch).
        // Sorted by date, the look-alikes within 3 days of a row sit in one contiguous run around it
        // (`lo..hi`, both only moving forward), and its closest one is a direct neighbor.
        for group in buckets.values_mut() {
            group.sort_by_key(|r| (r.date, r.id));
            let (mut lo, mut hi) = (0usize, 0usize);
            for (i, row) in group.iter().enumerate() {
                while (row.date - group[lo].date).num_days() > 3 {
                    lo += 1;
                }
                while hi < group.len() && (group[hi].date - row.date).num_days() <= 3 {
                    hi += 1;
                }
                let matches = hi - lo - 1;
                if matches == 0 {
                    continue;
                }
                let gap = |j: usize| (group[j].date - row.date).num_days().abs();
                // the earlier neighbor wins a tie
                let closest = match (i.checked_sub(1).filter(|&j| j >= lo), Some(i + 1).filter(|&j| j < hi)) {
                    (Some(before), Some(after)) if gap(after) < gap(before) => after,
                    (Some(before), _) => before,
                    (None, Some(after)) => after,
                    (None, None) => unreachable!("matches > 0 means a neighbor is in range"),
                };
                let more = if matches > 1 {
                    format!(" (and {} more)", matches - 1)
                } else {
                    String::new()
                };
                result.push(AnomalyFlag {
                    transaction_id: row.id,
                    kind: "duplicate".to_string(),
                    detail: format!(
                        "Possible duplicate of the {} transaction on {}{more}",
                        group[closest].description, group[closest].date
                    ),
                });
            }
        }

        Ok(result)
    }

    /// Records that the user looked at one flag (`kind` is `"large"` or
    /// `"duplicate"`) on one transaction and said it's fine. Only affects
    /// `open_anomaly_flags`; the flag itself is still raised by
    /// `anomaly_flags`. Dismissing the same one twice is harmless.
    pub fn dismiss_anomaly(&self, transaction_id: i64, kind: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO anomaly_dismissals (transaction_id, kind) VALUES (?1, ?2)",
            params![transaction_id, kind],
        )?;
        Ok(())
    }

    /// `anomaly_flags` minus the ones the user has dismissed — what the
    /// Transactions page and the review inbox show. Other features that
    /// build on the full scan (the cash-flow "large expenses" drill-down)
    /// deliberately keep using `anomaly_flags`: dismissing a flag means "not
    /// worth a warning", not "hide this expense everywhere".
    pub fn open_anomaly_flags(&self) -> rusqlite::Result<Vec<AnomalyFlag>> {
        let dismissed: std::collections::HashSet<(i64, String)> = {
            let mut stmt = self.conn.prepare("SELECT transaction_id, kind FROM anomaly_dismissals")?;
            let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        Ok(self
            .anomaly_flags()?
            .into_iter()
            .filter(|f| !dismissed.contains(&(f.transaction_id, f.kind.clone())))
            .collect())
    }

    /// The "large" anomalies (see `anomaly_flags`) dated within
    /// `[start_date, end_date]`, sorted by amount spent, biggest first —
    /// powers the cash-flow chart's per-month drill-down ("what drove this
    /// month's expenses"). Deliberately excludes "duplicate" flags: a
    /// repeated charge isn't a single large expense worth calling out here.
    pub fn large_expenses_in_range(&self, start_date: NaiveDate, end_date: NaiveDate) -> rusqlite::Result<Vec<LargeExpense>> {
        let flags = self.anomaly_flags()?;

        // A lighter, range-scoped query than `all_transactions()` — this
        // only ever needs these five fields to build a `LargeExpense`, not
        // the splits/tags/debt-payment-application info `all_transactions()`
        // also computes. `anomaly_flags()` itself still has to run over
        // full history (a transaction inside the range can still need up
        // to 180 days of *pre-range* history for its own baseline), so
        // only this second fetch gets scoped down.
        let mut stmt = self.conn.prepare(
            "SELECT id, date, description, amount, category FROM transactions
             WHERE date >= ?1 AND date <= ?2
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND deleted_at IS NULL",
        )?;
        let rows = stmt.query_map(params![start_date.to_string(), end_date.to_string()], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?;
        let mut by_id: std::collections::HashMap<i64, (NaiveDate, String, Decimal, Option<String>)> = std::collections::HashMap::new();
        for row in rows {
            let (id, date_str, description, amount_str, category) = row?;
            let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            by_id.insert(id, (date, description, amount, category));
        }

        let mut result: Vec<LargeExpense> = flags
            .into_iter()
            .filter(|f| f.kind == "large")
            .filter_map(|f| {
                let (date, description, amount, category) = by_id.get(&f.transaction_id)?;
                Some(LargeExpense {
                    transaction_id: f.transaction_id,
                    date: *date,
                    description: description.clone(),
                    amount: *amount,
                    category: category.clone(),
                    detail: f.detail,
                })
            })
            .collect();
        result.sort_by_key(|a| std::cmp::Reverse(a.amount.abs()));
        Ok(result)
    }

    /// Proactive notes for the Dashboard, combining three signals this
    /// crate already computes elsewhere rather than inventing new
    /// detection logic:
    ///
    /// 1. **Pace**: for each *flexible* budgeted category, projects this
    ///    month's spend forward (`actual * days_in_month/days_elapsed`)
    ///    and flags it if that projection exceeds the budget by more than
    ///    10% — skipped entirely before day 5 of the month, since too
    ///    little of the month has happened yet to project anything
    ///    meaningful from. Scoped to `flexible` specifically (not just
    ///    "not income") because linear day-of-month extrapolation assumes
    ///    spend accrues gradually across the month — true for discretionary
    ///    categories, false for `fixed`/`nonmonthly` ones, which post as a
    ///    single lump sum: a $2,405.94 mortgage payment on the 1st once
    ///    projected as "$2,405.94 / 6 days-elapsed * 30 days-in-month" a
    ///    nonsensical $12,029.70 "on pace to exceed" warning for a bill
    ///    that was already paid in full the moment it posted.
    ///
    ///    A `budget_group` alone doesn't catch every lump-sum category,
    ///    though — a category like "Pet Care" is legitimately flexible
    ///    (vet visits, grooming, a new leash) but in practice often posts
    ///    as one irregular annual-ish charge rather than many small ones
    ///    across the month, which the linear formula still misreads as
    ///    "$298.60 by day 2, so $1,493 by month end." `budget_group` can't
    ///    tell "one-off vet bill" apart from "the first of many restaurant
    ///    charges this month" — only the category's own history can, so
    ///    `average_spend_days_per_active_month` looks at the trailing 3
    ///    calendar months and skips pacing when that category has
    ///    historically landed on fewer than 2 distinct days per month it
    ///    was used at all. A category with no history yet (new, or simply
    ///    unused in those 3 months) falls back to the permissive default
    ///    of still pacing — "no data" must never be mistaken for "always a
    ///    lump sum," or a front-loaded grocery haul would stop warning too.
    /// 2. **Category jump**: reuses `spending_by_category` to compare this
    ///    month-to-date against the *same number of days* at the start of
    ///    the previous month (not the previous month's full total — that
    ///    would make every early-month comparison look like a decrease),
    ///    flagging a rise of more than 30% and more than $50.
    /// 3. **Large expense**: reuses `large_expenses_in_range` (the same
    ///    detection already powering the Cash Flow drill-down) scoped to
    ///    the current month.
    ///
    /// Warnings sort before info, capped at 5 total so the Dashboard card
    /// never turns into another full list to scroll through.
    /// The number of distinct calendar days with any spend in `category`
    /// during one specific calendar month — shared by
    /// `average_spend_days_per_active_month` (trailing months) and
    /// `dashboard_insights` (the current month, when there's no trailing
    /// history to lean on).
    fn distinct_spend_days_in_month(&self, category: &str, year: i32, month: u32) -> rusqlite::Result<i64> {
        let month_key = format!("{year:04}-{month:02}");
        self.conn.query_row(
            "SELECT COUNT(DISTINCT date) FROM (
                SELECT date FROM transactions
                WHERE category = ?1 AND substr(date, 1, 7) = ?2
                      AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                      AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                      AND deleted_at IS NULL
                UNION ALL
                SELECT t.date FROM transaction_splits ts
                JOIN transactions t ON t.id = ts.transaction_id
                WHERE ts.category = ?1 AND substr(t.date, 1, 7) = ?2
                      AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                      AND t.deleted_at IS NULL
             )",
            params![category, month_key],
            |row| row.get(0),
        )
    }

    /// The average number of distinct calendar days with any spend in
    /// `category`, across whichever of the `lookback_months` calendar
    /// months strictly before `before` actually had activity in that
    /// category. Months with no activity at all are excluded rather than
    /// counted as zero — a category that's simply new shouldn't be judged
    /// from an empty month. Returns `None` when none of the lookback
    /// months had any activity, so `dashboard_insights` can fall back to
    /// its own no-history handling instead of treating "no history yet" as
    /// "always a lump sum."
    fn average_spend_days_per_active_month(&self, category: &str, before: NaiveDate, lookback_months: u32) -> rusqlite::Result<Option<f64>> {
        let (mut year, mut month) = (before.year(), before.month());
        let mut active_month_days = Vec::new();
        for _ in 0..lookback_months {
            (year, month) = if month == 1 { (year - 1, 12) } else { (year, month - 1) };
            let days = self.distinct_spend_days_in_month(category, year, month)?;
            if days > 0 {
                active_month_days.push(days as f64);
            }
        }

        if active_month_days.is_empty() {
            return Ok(None);
        }
        let sum: f64 = active_month_days.iter().sum();
        Ok(Some(sum / active_month_days.len() as f64))
    }

    pub fn dashboard_insights(&self, today: NaiveDate) -> rusqlite::Result<Vec<Insight>> {
        let year = today.year();
        let month = today.month();
        let days_elapsed = today.day() as i64;
        let first_of_month = NaiveDate::from_ymd_opt(year, month, 1).expect("valid first-of-month");

        let mut insights = Vec::new();

        if days_elapsed >= 5 {
            let days_in_month = days_in_month(year, month);
            for actual in self.monthly_budget_actuals(year, month)? {
                if actual.budget_group != "flexible" || actual.budgeted <= Decimal::ZERO {
                    continue;
                }
                match self.average_spend_days_per_active_month(&actual.category, first_of_month, 3)? {
                    Some(avg_days) if avg_days < 2.0 => {
                        // Historically a single lump-sum charge a month
                        // (e.g. an occasional vet bill under "Pet Care") —
                        // linear day-of-month extrapolation only makes
                        // sense for spend that actually accrues gradually.
                        continue;
                    }
                    Some(_) => {}
                    None => {
                        // No trailing history at all for this category —
                        // the same ambiguity a genuinely new "Dining Out"
                        // charge has, which must still pace-project off a
                        // single data point (see
                        // `dashboard_insights_flags_a_category_on_pace_to_exceed_its_budget`).
                        // But when the *entire* month-to-date total came
                        // from a single calendar day and already dwarfs
                        // the whole monthly budget on its own, that reads
                        // far more like a one-off big-ticket purchase (new
                        // floors, an appliance) than the start of a
                        // gradual pattern, even with no prior months to
                        // confirm it either way.
                        let single_day_so_far = self.distinct_spend_days_in_month(&actual.category, year, month)? < 2;
                        let dwarfs_budget = actual.actual.abs() >= actual.budgeted * Decimal::from(3);
                        if single_day_so_far && dwarfs_budget {
                            continue;
                        }
                    }
                }
                let projected = actual.actual * Decimal::from(days_in_month) / Decimal::from(days_elapsed);
                let threshold = actual.budgeted * Decimal::new(11, 1); // 1.1x
                if projected > threshold {
                    insights.push(Insight {
                        severity: "warning".to_string(),
                        kind: "pace".to_string(),
                        message: format!(
                            "You're on pace to exceed {} by ${:.2} this month (projected ${:.2} vs a ${:.2} budget).",
                            actual.category,
                            projected - actual.budgeted,
                            projected,
                            actual.budgeted
                        ),
                    });
                }
            }
        }

        let (prev_year, prev_month) = if month == 1 { (year - 1, 12) } else { (year, month - 1) };
        let prev_first = NaiveDate::from_ymd_opt(prev_year, prev_month, 1).expect("valid first-of-previous-month");
        let comparable_days = days_elapsed.min(days_in_month(prev_year, prev_month));
        let current_window_end = first_of_month + chrono::Duration::days(comparable_days - 1);
        let prev_window_end = prev_first + chrono::Duration::days(comparable_days - 1);
        let current_spend = self.spending_by_category(first_of_month, current_window_end)?;
        let prev_spend: std::collections::HashMap<String, Decimal> = self.spending_by_category(prev_first, prev_window_end)?.into_iter().collect();
        let current_map: std::collections::HashMap<&str, Decimal> = current_spend.iter().map(|(c, a)| (c.as_str(), *a)).collect();
        for (category, current_amount) in &current_spend {
            let Some(&previous_amount) = prev_spend.get(category) else { continue };
            if previous_amount <= Decimal::ZERO {
                continue;
            }
            let delta = *current_amount - previous_amount;
            let pct = delta / previous_amount * Decimal::from(100);
            if pct > Decimal::from(30) && delta > Decimal::from(50) {
                insights.push(Insight {
                    severity: "warning".to_string(),
                    kind: "category_jump".to_string(),
                    message: format!("{category} rose {pct:.0}% (${current_amount:.2} vs ${previous_amount:.2}) from last month."),
                });
            }
        }

        // The positive counterpart to the jump check above: a category that
        // dropped notably instead of rising. Walks `prev_spend` (rather
        // than `current_spend`) so a category dropped to *zero* this month
        // — absent from `current_map` entirely — still counts, defaulting
        // to `Decimal::ZERO` rather than being skipped.
        for (category, &previous_amount) in &prev_spend {
            if previous_amount <= Decimal::ZERO {
                continue;
            }
            let current_amount = current_map.get(category.as_str()).copied().unwrap_or(Decimal::ZERO);
            let delta = previous_amount - current_amount;
            let pct = delta / previous_amount * Decimal::from(100);
            if pct > Decimal::from(30) && delta > Decimal::from(50) {
                insights.push(Insight {
                    severity: "positive".to_string(),
                    kind: "category_drop".to_string(),
                    message: format!("Nice work: {category} is down {pct:.0}% (${current_amount:.2} vs ${previous_amount:.2}) from last month."),
                });
            }
        }

        for expense in self.large_expenses_in_range(first_of_month, today)? {
            insights.push(Insight {
                severity: "info".to_string(),
                kind: "large_expense".to_string(),
                message: format!("Unusually large charge: {} — {}", expense.description, expense.detail),
            });
        }

        insights.sort_by_key(|i| match i.severity.as_str() {
            "warning" => 0,
            "info" => 1,
            _ => 2,
        });
        insights.truncate(5);
        Ok(insights)
    }
}
