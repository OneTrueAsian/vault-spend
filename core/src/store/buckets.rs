//! Buckets (savings goals and sinking funds).

use super::Store;
use chrono::{Datelike, NaiveDate};
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

/// A savings bucket (a named goal, e.g. "Emergency Fund"), with its saved
/// amount computed fresh from its contributions rather than stored as a
/// running total — so it's never out of sync with the contribution log.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredBucket {
    pub id: i64,
    pub name: String,
    pub target_amount: Option<Decimal>,
    pub saved_amount: Decimal,
    pub target_date: Option<NaiveDate>,
    pub account_id: Option<i64>,
    pub account_name: Option<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    pub sinking_amount: Option<Decimal>,
    pub color: Option<String>,
    pub icon_key: Option<String>,
    /// Progress follows the linked account's balance instead of manual
    /// contributions (see `Store::list_buckets_as_of`). Only takes effect
    /// while `account_id` is set.
    pub tracks_account: bool,
    /// Net dollars per month the goal has been gaining over the trailing 90
    /// days — the pace `Store::list_buckets_as_of` fills in so the UI can
    /// project a finish date. Always zero from plain `list_buckets`.
    pub monthly_pace: Decimal,
}

impl Store {
    /// Creates a new savings bucket. Errors (a `UNIQUE` constraint
    /// violation) if a bucket with that name already exists — unlike an
    /// account, a duplicate bucket name is a mistake to surface, not a
    /// re-selection to shrug off.
    // Every param is a distinct, independently-optional bucket field with
    // its own SQL column — bundling them into a params struct would just
    // move this same list to a type definition without changing the call
    // sites' shape, so it's allowed here rather than forced into that
    // indirection.
    #[allow(clippy::too_many_arguments)]
    pub fn create_bucket(
        &self,
        name: &str,
        target_amount: Option<Decimal>,
        target_date: Option<NaiveDate>,
        account_id: Option<i64>,
        sinking_amount: Option<Decimal>,
        color: Option<&str>,
        icon_key: Option<&str>,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO buckets (name, target_amount, target_date, account_id, sinking_amount, color, icon_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                name,
                target_amount.map(|a| a.to_string()),
                target_date.map(|d| d.to_string()),
                account_id,
                sinking_amount.map(|a| a.to_string()),
                color,
                icon_key,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Updates a bucket's target amount, target date, linked account,
    /// sinking-fund auto-contribution amount, color, and icon (all
    /// optional/nullable — the linked account, color, and icon are purely
    /// informational, none feeds into any balance calculation). An
    /// unknown id is a harmless no-op.
    // Same reasoning as `create_bucket` above — one independent optional
    // field per column, not a natural grouping worth its own struct.
    #[allow(clippy::too_many_arguments)]
    pub fn update_bucket_details(
        &self,
        id: i64,
        target_amount: Option<Decimal>,
        target_date: Option<NaiveDate>,
        account_id: Option<i64>,
        sinking_amount: Option<Decimal>,
        color: Option<&str>,
        icon_key: Option<&str>,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE buckets SET target_amount = ?1, target_date = ?2, account_id = ?3, sinking_amount = ?4, color = ?5, icon_key = ?6 WHERE id = ?7",
            params![
                target_amount.map(|a| a.to_string()),
                target_date.map(|d| d.to_string()),
                account_id,
                sinking_amount.map(|a| a.to_string()),
                color,
                icon_key,
                id,
            ],
        )?;
        Ok(())
    }

    /// Sets (or clears, with `None`) which family member a bucket is
    /// attributed to. An unknown id is a harmless no-op.
    pub fn set_bucket_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE buckets SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// Turns "progress follows the linked account's balance" on or off for a
    /// goal — a dedicated single-field setter, same convention as
    /// `set_bucket_member`, so `create_bucket`/`update_bucket_details` never
    /// change shape. An unknown id is a harmless no-op.
    pub fn set_bucket_tracks_account(&self, id: i64, tracks_account: bool) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE buckets SET tracks_account = ?1 WHERE id = ?2", params![tracks_account, id])?;
        Ok(())
    }

    /// Every bucket, each with its saved amount computed fresh from its
    /// contributions (0 for a bucket with none yet) rather than trusted
    /// from a stored running total. The sum is done in Rust with `Decimal`,
    /// not in SQL — summing money as floating point (SQLite has no decimal
    /// aggregate) would risk the exact rounding errors this app avoids
    /// everywhere else by keeping amounts as `Decimal` end to end.
    pub fn list_buckets(&self) -> rusqlite::Result<Vec<StoredBucket>> {
        let mut stmt = self.conn.prepare(
            "SELECT b.id, b.name, b.target_amount, b.target_date, b.account_id, a.name,
                    GROUP_CONCAT(c.amount, '|'), b.member_id, fm.name, b.sinking_amount, b.color, b.icon_key,
                    b.tracks_account
             FROM buckets b
             LEFT JOIN accounts a ON a.id = b.account_id
             LEFT JOIN bucket_contributions c ON c.bucket_id = b.id
             LEFT JOIN family_members fm ON fm.id = b.member_id
             GROUP BY b.id
             ORDER BY b.name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, bool>(12)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (
                id,
                name,
                target_amount,
                target_date,
                account_id,
                account_name,
                contributions,
                member_id,
                member_name,
                sinking_amount,
                color,
                icon_key,
                tracks_account,
            ) = row?;
            let saved_amount = contributions
                .map(|joined| {
                    joined
                        .split('|')
                        .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
                        .sum()
                })
                .unwrap_or(Decimal::ZERO);
            result.push(StoredBucket {
                id,
                name,
                target_amount: target_amount.map(|a| Decimal::from_str(&a).expect("amount stored by this crate must be valid")),
                saved_amount,
                target_date: target_date.map(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").expect("date stored by this crate must be valid")),
                account_id,
                account_name,
                member_id,
                member_name,
                sinking_amount: sinking_amount.map(|a| Decimal::from_str(&a).expect("amount stored by this crate must be valid")),
                color,
                icon_key,
                tracks_account,
                monthly_pace: Decimal::ZERO,
            });
        }
        Ok(result)
    }

    /// `list_buckets` plus what needs a date: a goal that tracks its linked
    /// account reports that account's current balance (never below zero) as
    /// `saved_amount`, and every goal gets its trailing-90-day
    /// `monthly_pace` — for a tracking goal the account's net transaction
    /// change, otherwise the net of its logged contributions.
    pub fn list_buckets_as_of(&self, today: NaiveDate) -> rusqlite::Result<Vec<StoredBucket>> {
        let mut buckets = self.list_buckets()?;
        let balances: std::collections::HashMap<i64, Decimal> = if buckets.iter().any(|b| b.tracks_account && b.account_id.is_some()) {
            self.list_accounts(today)?.into_iter().map(|a| (a.id, a.current_balance)).collect()
        } else {
            std::collections::HashMap::new()
        };
        let window_start = today - chrono::Duration::days(90);

        for bucket in &mut buckets {
            let tracked_account = if bucket.tracks_account { bucket.account_id } else { None };
            let net: Decimal = match tracked_account {
                Some(account_id) => {
                    if let Some(balance) = balances.get(&account_id) {
                        bucket.saved_amount = (*balance).max(Decimal::ZERO);
                    }
                    let mut stmt = self.conn.prepare(
                        "SELECT COALESCE(principal_amount, amount) FROM transactions
                         WHERE account_id = ?1 AND date > ?2 AND date <= ?3 AND deleted_at IS NULL",
                    )?;
                    let amounts = stmt
                        .query_map(params![account_id, window_start.to_string(), today.to_string()], |row| {
                            row.get::<_, String>(0)
                        })?
                        .collect::<rusqlite::Result<Vec<_>>>()?;
                    amounts
                        .iter()
                        .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
                        .sum()
                }
                None => {
                    let mut stmt = self
                        .conn
                        .prepare("SELECT amount FROM bucket_contributions WHERE bucket_id = ?1 AND date > ?2 AND date <= ?3")?;
                    let amounts = stmt
                        .query_map(params![bucket.id, window_start.to_string(), today.to_string()], |row| {
                            row.get::<_, String>(0)
                        })?
                        .collect::<rusqlite::Result<Vec<_>>>()?;
                    amounts
                        .iter()
                        .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
                        .sum()
                }
            };
            bucket.monthly_pace = net / Decimal::from(3);
        }
        Ok(buckets)
    }

    /// Logs a contribution toward a bucket — a positive amount is a
    /// deposit, a negative amount is a withdrawal. Doesn't touch a stored
    /// total; `list_buckets` sums these fresh every time.
    pub fn add_bucket_contribution(&self, bucket_id: i64, date: NaiveDate, amount: Decimal, note: Option<&str>) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO bucket_contributions (bucket_id, date, amount, note) VALUES (?1, ?2, ?3, ?4)",
            params![bucket_id, date.to_string(), amount.to_string(), note],
        )?;
        Ok(())
    }

    /// Deletes a bucket and every contribution logged against it — done as
    /// an explicit statement rather than an `ON DELETE CASCADE`, since that
    /// requires `PRAGMA foreign_keys = ON` which this connection doesn't
    /// set (matching how `delete_category` explicitly removes matching
    /// rules rather than relying on a database-level cascade). Also clears
    /// this bucket's `bucket_auto_contributions` guard rows first — left
    /// behind, they'd dangle once the `bucket_contributions` rows they
    /// point at are gone, same reasoning as deleting the contributions
    /// themselves rather than leaving them orphaned.
    pub fn delete_bucket(&self, id: i64) -> rusqlite::Result<()> {
        self.conn
            .execute("DELETE FROM bucket_auto_contributions WHERE bucket_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM bucket_contributions WHERE bucket_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM buckets WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Auto-contributes each sinking-fund bucket's fixed monthly amount
    /// once per calendar month — same idiom as
    /// `roll_forward_monthly_balances`: a `period` ("YYYY-MM") guard
    /// (belt-and-suspenders alongside `bucket_auto_contributions`'s own
    /// `UNIQUE` constraint), computed/inserted once, returns only the
    /// buckets freshly touched *this* call (empty on every later call the
    /// same month) so the caller can show a one-time note. The dollars
    /// land in `bucket_contributions` exactly like a manual contribution
    /// (`note = "Automatic monthly contribution"`) — this is what makes
    /// `saved_amount`, `total_saved`, and `delete_bucket`'s cascade pick it
    /// up with zero special-casing; `bucket_auto_contributions` exists
    /// purely as the guard and a pointer back to which row was the auto
    /// one. A manual contribution the same month is still allowed —
    /// this guard is scoped to `(bucket_id, period)` only, independent of
    /// `add_bucket_contribution`.
    pub fn apply_sinking_fund_contributions(&self, today: NaiveDate) -> rusqlite::Result<Vec<(i64, String, Decimal)>> {
        let period = format!("{:04}-{:02}", today.year(), today.month());

        let mut stmt = self
            .conn
            .prepare("SELECT id, name, sinking_amount FROM buckets WHERE sinking_amount IS NOT NULL")?;
        let buckets: Vec<(i64, String, String)> = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut applied = Vec::new();
        for (id, name, sinking_amount_str) in buckets {
            let already_done: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM bucket_auto_contributions WHERE bucket_id = ?1 AND period = ?2)",
                params![id, period],
                |row| row.get(0),
            )?;
            if already_done {
                continue;
            }

            let amount = Decimal::from_str(&sinking_amount_str).expect("amount stored by this crate must be valid");
            self.conn.execute(
                "INSERT INTO bucket_contributions (bucket_id, date, amount, note) VALUES (?1, ?2, ?3, ?4)",
                params![id, today.to_string(), amount.to_string(), "Automatic monthly contribution"],
            )?;
            let contribution_id = self.conn.last_insert_rowid();
            self.conn.execute(
                "INSERT INTO bucket_auto_contributions (bucket_id, period, contribution_id) VALUES (?1, ?2, ?3)",
                params![id, period, contribution_id],
            )?;
            applied.push((id, name, amount));
        }
        Ok(applied)
    }
}
