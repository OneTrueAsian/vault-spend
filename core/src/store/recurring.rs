//! Recurring items: bills and subscriptions, matching them to charges, price changes and detecting new ones.

use super::{LIVE_TRANSFER_LEG_IDS_SQL, Store, StoredRecurring, add_one_month, add_one_year, next_occurrence, normalize_description};
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

/// A recurring item's amount moving from one price to another — see
/// `RecurringMatch::price_change`. Both are signed like the item itself
/// (a bill is negative).
#[derive(Debug, Clone, PartialEq)]
pub struct PriceChange {
    pub from: Decimal,
    pub to: Decimal,
}

/// How one recurring item lines up with the transactions actually posted —
/// see `Store::recurring_matches`.
#[derive(Debug, Clone, PartialEq)]
pub struct RecurringMatch {
    pub recurring_id: i64,
    /// `"paid"` (the latest due date has a matching charge), `"pending"`
    /// (due, nothing posted yet, still inside the grace period), `"missed"`
    /// (past the grace period with no charge, though earlier ones exist),
    /// `"unmatched"` (no matching charge in recent history at all — nothing
    /// to judge by, so never called missed), `"upcoming"` (hasn't started).
    pub state: String,
    /// The latest due date on or before today; `None` while `"upcoming"`.
    pub last_due: Option<NaiveDate>,
    pub last_paid_date: Option<NaiveDate>,
    pub last_paid_amount: Option<Decimal>,
    /// The latest charge differs from what came before it (or from the amount
    /// on file when there is only one) — subscription creep. Never set for a
    /// bill that varies month to month.
    pub price_change: Option<PriceChange>,
}

/// A pattern detected in transaction history that looks recurring but isn't yet
/// tracked in `recurring` — see `Store::detect_recurring_candidates`.
#[derive(Debug, Clone, PartialEq)]
pub struct RecurringCandidate {
    pub merchant: String,
    pub category: Option<String>,
    pub amount: Decimal,
    pub cadence: String,
    pub anchor_date: NaiveDate,
    pub occurrence_count: usize,
}

/// Recurring spend/income totaled onto a common monthly and annual
/// footing across every cadence — see `Store::recurring_totals`.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct RecurringTotals {
    pub monthly_expense: Decimal,
    pub monthly_income: Decimal,
    pub annual_expense: Decimal,
    pub annual_income: Decimal,
}

/// The four cadences `detect_recurring_candidates` recognizes, as a
/// (name, typical days, tolerance in days) table shared by
/// `classify_cadence` and `cadence_days` — the buckets don't overlap
/// (5-9, 11-17, 25-35, 355-375), so a set of gaps matches at most one.
const CADENCE_BUCKETS: [(&str, i64, i64); 4] = [("weekly", 7, 2), ("biweekly", 14, 3), ("monthly", 30, 5), ("annual", 365, 10)];

/// Classifies a series of day-gaps between consecutive occurrences as one
/// of the four recognized cadences, requiring every gap to fall within
/// that cadence's tolerance of its typical length — an irregular series
/// (gaps that don't consistently cluster around any one target) matches
/// nothing, since it isn't actually a recurring pattern.
fn classify_cadence(gaps: &[i64]) -> Option<&'static str> {
    CADENCE_BUCKETS
        .iter()
        .find(|(_, target, tolerance)| gaps.iter().all(|g| (g - target).abs() <= *tolerance))
        .map(|(name, _, _)| *name)
}

/// The typical day-length of a cadence name, for the "has this pattern
/// gone stale" check in `detect_recurring_candidates`. Panics on an
/// unrecognized name — every caller gets `cadence` from `classify_cadence`,
/// so this should never see anything else.
fn cadence_days(cadence: &str) -> i64 {
    CADENCE_BUCKETS
        .iter()
        .find(|(name, _, _)| *name == cadence)
        .map(|(_, days, _)| *days)
        .expect("cadence must be one produced by classify_cadence")
}

/// The due dates of a recurring item on or before `today`, oldest first,
/// keeping only the last `max` — stepped the same way `next_occurrence`
/// steps, so the two never disagree about a date. Empty while the anchor is
/// still in the future.
fn recent_occurrences(anchor: NaiveDate, cadence: &str, today: NaiveDate, max: usize) -> Vec<NaiveDate> {
    let mut dates = Vec::new();
    let mut next = anchor;
    while next <= today {
        dates.push(next);
        next = match cadence {
            "weekly" => next + chrono::Duration::days(7),
            "biweekly" => next + chrono::Duration::days(14),
            "annual" => add_one_year(next),
            _ => add_one_month(next),
        };
    }
    let skip = dates.len().saturating_sub(max);
    dates.split_off(skip)
}

/// Two charges count as different prices when they differ by at least 50
/// cents *and* at least 1% — a one-cent rounding wobble isn't a price change.
fn prices_differ(a: Decimal, b: Decimal) -> bool {
    let gap = (a - b).abs();
    let base = b.abs();
    gap >= Decimal::new(50, 2) && base > Decimal::ZERO && gap / base >= Decimal::new(1, 2)
}

/// See `RecurringMatch::price_change`. `amounts` are the matched charges,
/// oldest first; `on_file` is the recurring item's own amount.
fn detect_price_change(amounts: &[Decimal], on_file: Decimal) -> Option<PriceChange> {
    let (&latest, earlier) = amounts.split_last()?;
    let baseline = match earlier.last() {
        Some(&previous) => {
            // With at least two earlier charges, they must agree — otherwise
            // this bill simply varies and there's no "old price" to compare to.
            if earlier.len() >= 2 && prices_differ(earlier[earlier.len() - 2], previous) {
                return None;
            }
            previous
        }
        None => on_file,
    };
    prices_differ(latest, baseline).then_some(PriceChange { from: baseline, to: latest })
}

/// Normalizes one cadence's amount onto a common monthly footing —
/// weekly and biweekly average out to slightly more than 4/2 times a
/// month (52/26 weeks a year, not 48/24), annual divides down to a
/// twelfth. Applied identically to income and expense in
/// `Store::recurring_totals`, fixing a bug in an earlier client-side
/// version that only normalized income this way and silently dropped
/// non-monthly *expenses* from the displayed total entirely.
fn monthly_multiplier(cadence: &str) -> Decimal {
    match cadence {
        "weekly" => Decimal::from(52) / Decimal::from(12),
        "biweekly" => Decimal::from(26) / Decimal::from(12),
        "annual" => Decimal::from(1) / Decimal::from(12),
        _ => Decimal::from(1), // "monthly", and the fallback for anything unrecognized
    }
}

/// Same idea as `monthly_multiplier`, normalized onto a year instead —
/// each computed from its own exact yearly count rather than derived by
/// multiplying the monthly figure by 12, to avoid compounding rounding.
fn annual_multiplier(cadence: &str) -> Decimal {
    match cadence {
        "weekly" => Decimal::from(52),
        "biweekly" => Decimal::from(26),
        "annual" => Decimal::from(1),
        _ => Decimal::from(12), // "monthly", and the fallback for anything unrecognized
    }
}

impl Store {
    /// Logs a recurring bill or income line. `account_id` is purely
    /// informational, same as a bucket's linked account.
    pub fn create_recurring(
        &self,
        merchant: &str,
        category: Option<&str>,
        amount: Decimal,
        cadence: &str,
        anchor_date: NaiveDate,
        account_id: Option<i64>,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![merchant, category, amount.to_string(), cadence, anchor_date.to_string(), account_id],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Replaces every field of an existing recurring item. An unknown id
    /// is a harmless no-op, same convention as everywhere else here.
    // Same reasoning as `create_bucket` (`store/buckets.rs`) — replaces every field of an
    // existing recurring item, one independent argument per column.
    #[allow(clippy::too_many_arguments)]
    pub fn update_recurring(
        &self,
        id: i64,
        merchant: &str,
        category: Option<&str>,
        amount: Decimal,
        cadence: &str,
        anchor_date: NaiveDate,
        account_id: Option<i64>,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE recurring SET merchant = ?1, category = ?2, amount = ?3, cadence = ?4, anchor_date = ?5, account_id = ?6
             WHERE id = ?7",
            params![merchant, category, amount.to_string(), cadence, anchor_date.to_string(), account_id, id],
        )?;
        Ok(())
    }

    /// Sets (or clears, with `None`) which family member a recurring item is
    /// attributed to. An unknown id is a harmless no-op.
    pub fn set_recurring_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE recurring SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// Every recurring item, each with its next-due date computed fresh
    /// relative to `today` (see `next_occurrence`) rather than trusted
    /// from a stored value, sorted by that next-due date.
    pub fn list_recurring(&self, today: NaiveDate) -> rusqlite::Result<Vec<StoredRecurring>> {
        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.merchant, r.category, r.amount, r.cadence, r.anchor_date, r.account_id, a.name,
                    r.member_id, fm.name, r.status
             FROM recurring r
             LEFT JOIN accounts a ON a.id = r.account_id
             LEFT JOIN family_members fm ON fm.id = r.member_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, String>(10)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (id, merchant, category, amount, cadence, anchor_date_str, account_id, account_name, member_id, member_name, status) = row?;
            let anchor_date = NaiveDate::parse_from_str(&anchor_date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
            result.push(StoredRecurring {
                id,
                merchant,
                category,
                amount: Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
                next_date: next_occurrence(anchor_date, &cadence, today),
                cadence,
                anchor_date,
                account_id,
                account_name,
                member_id,
                member_name,
                status,
            });
        }
        result.sort_by_key(|r| r.next_date);
        Ok(result)
    }

    /// Lines every recurring item up against the transactions actually
    /// posted, for the Recurring tab's paid / pending / missed marks and
    /// price-change alerts.
    ///
    /// A charge belongs to a due date when its description contains the
    /// item's merchant (either case) and it has the same sign, within a
    /// window around the date: up to 3 days early, up to 10 late (fewer for
    /// weekly and biweekly items, so two due dates never share a charge).
    /// Each charge is used for at most one due date. The last 6 due dates
    /// are considered. Transfers, debt-payment bookkeeping rows and deleted
    /// transactions never match.
    ///
    /// The latest due date decides the state — see `RecurringMatch::state`.
    /// A price change needs the recent charges to have been steady: the
    /// latest one is compared with the one before it (or the amount on file
    /// when it is the only one), and only flagged when the two before it were
    /// the same price — so an electric bill that moves every month is never
    /// called out.
    pub fn recurring_matches(&self, today: NaiveDate) -> rusqlite::Result<Vec<RecurringMatch>> {
        const CYCLES: usize = 6;
        let mut stmt = self.conn.prepare(&format!(
            "SELECT t.date, t.amount FROM transactions t
             WHERE t.deleted_at IS NULL AND t.date >= ?2 AND t.date <= ?3
                   AND instr(lower(t.description), lower(?1)) > 0
                   AND (t.category IS NULL OR t.category <> 'Transfer')
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})"
        ))?;

        let mut result = Vec::new();
        for item in self.list_recurring(today)? {
            let merchant = item.merchant.trim();
            let occurrences = recent_occurrences(item.anchor_date, &item.cadence, today, CYCLES);
            let Some(&last_due) = occurrences.last() else {
                result.push(RecurringMatch {
                    recurring_id: item.id,
                    state: "upcoming".to_string(),
                    last_due: None,
                    last_paid_date: None,
                    last_paid_amount: None,
                    price_change: None,
                });
                continue;
            };

            let cycle_days = match item.cadence.as_str() {
                "weekly" => 7,
                "biweekly" => 14,
                "annual" => 365,
                _ => 30,
            };
            let before = (cycle_days / 3).min(3);
            let after = (cycle_days / 2).min(10);

            let mut candidates: Vec<(NaiveDate, Decimal)> = Vec::new();
            if !merchant.is_empty() {
                let window_start = occurrences[0] - chrono::Duration::days(before);
                let rows = stmt.query_map(params![merchant, window_start.to_string(), today.to_string()], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?;
                for row in rows {
                    let (date, amount) = row?;
                    let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid");
                    let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
                    if (amount < Decimal::ZERO) == (item.amount < Decimal::ZERO) {
                        candidates.push((date, amount));
                    }
                }
            }

            // Newest due date first, each taking its closest unused charge.
            let mut matched: Vec<(NaiveDate, NaiveDate, Decimal)> = Vec::new(); // (due, posted, amount)
            for &due in occurrences.iter().rev() {
                let best = candidates
                    .iter()
                    .enumerate()
                    .filter(|(_, (date, _))| *date >= due - chrono::Duration::days(before) && *date <= due + chrono::Duration::days(after))
                    .min_by_key(|(_, (date, _))| ((*date - due).num_days().abs(), std::cmp::Reverse(*date)))
                    .map(|(i, _)| i);
                if let Some(i) = best {
                    let (posted, amount) = candidates.remove(i);
                    matched.push((due, posted, amount));
                }
            }
            matched.sort_by_key(|(due, _, _)| *due);

            let state = if matched.iter().any(|(due, _, _)| *due == last_due) {
                "paid"
            } else if matched.is_empty() {
                "unmatched"
            } else if (today - last_due).num_days() <= after {
                "pending"
            } else {
                "missed"
            };

            let amounts: Vec<Decimal> = matched.iter().map(|(_, _, a)| *a).collect();
            let mut price_change = detect_price_change(&amounts, item.amount);
            if let Some(change) = &price_change {
                let dismissed: bool = self.conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM recurring_price_dismissals WHERE recurring_id = ?1 AND from_amount = ?2 AND to_amount = ?3)",
                    params![item.id, change.from.normalize().to_string(), change.to.normalize().to_string()],
                    |row| row.get(0),
                )?;
                if dismissed {
                    price_change = None;
                }
            }
            result.push(RecurringMatch {
                recurring_id: item.id,
                state: state.to_string(),
                last_due: Some(last_due),
                last_paid_date: matched.last().map(|(_, posted, _)| *posted),
                last_paid_amount: amounts.last().copied(),
                price_change,
            });
        }
        Ok(result)
    }

    /// Ignore only this amount transition for this item, without changing its forecast amount.
    pub fn dismiss_recurring_price_change(&self, id: i64, from: Decimal, to: Decimal) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO recurring_price_dismissals (recurring_id, from_amount, to_amount) VALUES (?1, ?2, ?3)",
            params![id, from.normalize().to_string(), to.normalize().to_string()],
        )?;
        Ok(())
    }

    /// Removes a recurring item. An unknown id is a harmless no-op.
    pub fn delete_recurring(&self, id: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM recurring WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Sets a recurring item's audit status (`"keep"`/`"reviewing"`/
    /// `"canceled"`) — a dedicated single-field setter, same convention as
    /// `set_recurring_member`. Purely a label for the Recurring tab's audit
    /// view; see the migration's doc comment for why it never suppresses
    /// this item from forecasts or reminders. An unknown id is a harmless
    /// no-op.
    pub fn set_recurring_status(&self, id: i64, status: &str) -> rusqlite::Result<()> {
        self.conn.execute("UPDATE recurring SET status = ?1 WHERE id = ?2", params![status, id])?;
        Ok(())
    }

    /// Total monthly and annual recurring spend/income, normalized onto a
    /// common footing across every cadence — weekly ×52/12 (or ×52 for the
    /// annual figure), biweekly ×26/12 (×26 annual), monthly ×1 (×12
    /// annual), annual ÷12 (×1 annual). Computed in Rust with `Decimal`
    /// rather than client-side, so this repo's only real test coverage for
    /// money math applies here too. Includes every row regardless of
    /// `status` — a "canceled" item is still a real charge until it's
    /// actually deleted (see `set_recurring_status`'s doc comment).
    ///
    /// The weekly/biweekly/annual multipliers are exact fractions (52/12
    /// etc.), which `Decimal` division can only represent to its fixed
    /// precision — summed across several rows that residual can land a
    /// fraction of a cent off a "nice" total (e.g. `303.999...96` instead
    /// of `304.00`). Rounded to the cent at the end, same as every other
    /// dollar figure this app ever displays.
    pub fn recurring_totals(&self) -> rusqlite::Result<RecurringTotals> {
        let mut stmt = self.conn.prepare("SELECT amount, cadence FROM recurring")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;

        let mut totals = RecurringTotals::default();
        for row in rows {
            let (amount_str, cadence) = row?;
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            let monthly = amount * monthly_multiplier(&cadence);
            let annual = amount * annual_multiplier(&cadence);
            if amount < Decimal::ZERO {
                totals.monthly_expense += -monthly;
                totals.annual_expense += -annual;
            } else {
                totals.monthly_income += monthly;
                totals.annual_income += annual;
            }
        }
        totals.monthly_expense = totals.monthly_expense.round_dp(2);
        totals.monthly_income = totals.monthly_income.round_dp(2);
        totals.annual_expense = totals.annual_expense.round_dp(2);
        totals.annual_income = totals.annual_income.round_dp(2);
        Ok(totals)
    }

    /// Scans all transactions for merchant+amount pairs that recur on a
    /// consistent weekly/biweekly/monthly/annual cadence (see
    /// `classify_cadence`) but aren't yet tracked in `recurring` and haven't
    /// been dismissed (see `dismiss_recurring_candidate`) — the offline
    /// equivalent of a "detected subscription" feed. A group needs at least
    /// 3 occurrences before it's considered: too little history to call
    /// anything a pattern otherwise. Sorted most-recent-occurrence first.
    pub fn detect_recurring_candidates(&self, today: NaiveDate) -> rusqlite::Result<Vec<RecurringCandidate>> {
        struct Row {
            date: NaiveDate,
            description: String,
            category: Option<String>,
        }

        let mut stmt = self.conn.prepare(&format!(
            "SELECT date, description, amount, category FROM transactions
                 WHERE deleted_at IS NULL AND (category IS NULL OR category <> 'Transfer')
                       AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL}) ORDER BY date"
        ))?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;

        // Grouped by (normalized description, amount-as-stored) — the same
        // normalization `anomaly_flags`'s duplicate detection already uses,
        // so a varying store-number suffix doesn't split one merchant into
        // several groups.
        let mut groups: std::collections::BTreeMap<(String, String), Vec<Row>> = std::collections::BTreeMap::new();
        for row in rows {
            let (date_str, description, amount_str, category) = row?;
            let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
            let key = (normalize_description(&description), amount_str);
            groups.entry(key).or_default().push(Row { date, description, category });
        }

        let mut existing_recurring: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
        // Lower-cased merchant + direction of every tracked item: a statement
        // line that contains it ("HULU 877-8244858" for "Hulu") is that bill
        // under its bank name, the same rule `recurring_matches` pairs by.
        let mut tracked_merchants: Vec<(String, bool)> = Vec::new();
        let mut stmt = self.conn.prepare("SELECT merchant, amount FROM recurring")?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (merchant, amount) = row?;
            let named = merchant.trim().to_lowercase();
            if !named.is_empty() {
                tracked_merchants.push((named, amount.starts_with('-')));
            }
            existing_recurring.insert((normalize_description(&merchant), amount));
        }

        let mut dismissed: std::collections::HashSet<(String, String, String)> = std::collections::HashSet::new();
        let mut stmt = self.conn.prepare("SELECT merchant, amount, cadence FROM recurring_dismissals")?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))? {
            dismissed.insert(row?);
        }

        let mut result = Vec::new();
        for ((norm_desc, amount_str), mut rows) in groups {
            if rows.len() < 3 {
                continue;
            }
            rows.sort_by_key(|r| r.date);
            let gaps: Vec<i64> = rows.windows(2).map(|w| (w[1].date - w[0].date).num_days()).collect();
            let Some(cadence) = classify_cadence(&gaps) else { continue };
            let last_date = rows.last().expect("checked len >= 3 above").date;
            // A pattern whose most recent occurrence is long overdue (more
            // than 2 cadence periods ago) has likely stopped — e.g. a
            // cancelled subscription — and shouldn't be suggested as if it
            // were still active.
            if (today - last_date).num_days() > cadence_days(cadence) * 2 {
                continue;
            }
            if existing_recurring.contains(&(norm_desc.clone(), amount_str.clone())) {
                continue;
            }
            let statement_line = rows.last().expect("checked len >= 3 above").description.to_lowercase();
            let is_expense = amount_str.starts_with('-');
            if tracked_merchants
                .iter()
                .any(|(merchant, expense)| *expense == is_expense && statement_line.contains(merchant.as_str()))
            {
                continue;
            }
            if dismissed.contains(&(norm_desc, amount_str.clone(), cadence.to_string())) {
                continue;
            }

            let mut category_counts: std::collections::BTreeMap<Option<String>, usize> = std::collections::BTreeMap::new();
            for r in &rows {
                *category_counts.entry(r.category.clone()).or_insert(0) += 1;
            }
            let category = category_counts.into_iter().max_by_key(|(_, count)| *count).and_then(|(cat, _)| cat);

            let last = rows.last().expect("checked len >= 3 above");
            result.push(RecurringCandidate {
                merchant: last.description.clone(),
                category,
                amount: Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid"),
                cadence: cadence.to_string(),
                anchor_date: last.date,
                occurrence_count: rows.len(),
            });
        }
        result.sort_by_key(|a| std::cmp::Reverse(a.anchor_date));
        Ok(result)
    }

    /// Marks a detected pattern as "not actually recurring" so it stops
    /// being suggested — keyed on the same normalized-merchant/amount/
    /// cadence triple `detect_recurring_candidates` groups by. Dismissing
    /// the same candidate twice is a harmless no-op (the underlying table's
    /// primary key already de-duplicates).
    pub fn dismiss_recurring_candidate(&self, merchant: &str, amount: Decimal, cadence: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO recurring_dismissals (merchant, amount, cadence) VALUES (?1, ?2, ?3)",
            params![normalize_description(merchant), amount.to_string(), cadence],
        )?;
        Ok(())
    }
}
