//! Transactions: saving, querying, editing, deleting and restoring them, plus tags, splits and debt payments.

use super::{CategorySource, Store, fingerprint};
use crate::models::Transaction;
use chrono::{NaiveDate, NaiveDateTime};
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

/// A transaction as it exists in the store, with the row id needed to
/// correct its category later, and which account it belongs to.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredTransaction {
    pub id: i64,
    /// The other leg's id when this transaction is one half of a linked
    /// transfer whose other half is also live (see `Store::link_transfer`).
    pub transfer_counterpart_id: Option<i64>,
    pub transaction: Transaction,
    pub category_source: Option<CategorySource>,
    pub confidence: Option<f64>,
    pub account_id: i64,
    pub account_name: String,
    pub applied_to_debt: Option<AppliedDebtPayment>,
    /// Overrides how much of this transaction counts toward its own
    /// account's balance — only ever meaningful (and only ever set) on a
    /// loan-account transaction recorded directly there, e.g. a mortgage
    /// payment that bundles principal, interest, and escrow. `None` means
    /// no override: the full `transaction.amount` counts, same as every
    /// other account type. See `Store::account_balance_as_of`.
    pub principal_amount: Option<Decimal>,
    pub split_count: i64,
    pub tags: Vec<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    /// A person's own freeform annotation on this transaction — never used
    /// for categorization, transfer matching, or the import fingerprint.
    /// `None` means no note. See `Store::update_transaction_notes`.
    pub notes: Option<String>,
}

/// Which debt account this transaction's amount was applied toward paying
/// down (see `Store::apply_debt_payment`) — only ever set on the source
/// (e.g. checking-account) side of an applied payment, never on the
/// generated transaction it created on the debt account itself.
#[derive(Debug, Clone, PartialEq)]
pub struct AppliedDebtPayment {
    pub date: NaiveDate,
    pub debt_account_id: i64,
    pub debt_account_name: String,
    pub amount: Decimal,
}

/// One line of a split transaction (see `Store::set_transaction_splits`) —
/// `category` is nullable the same way `transactions.category` is (a
/// deleted category nulls it out here too, rather than leaving a dangling
/// reference or forcing the split to vanish).
#[derive(Debug, Clone, PartialEq)]
pub struct TransactionSplit {
    pub id: i64,
    pub category: Option<String>,
    pub amount: Decimal,
    pub note: Option<String>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SaveReport {
    pub inserted: usize,
}

/// The most Unicode scalar values (`.chars().count()`, matching JS
/// `Array.from(value).length`) a transaction's notes may hold.
pub const NOTES_MAX_CHARS: usize = 4_000;

/// `update_transaction_notes`/`create_transaction` were refused (over the
/// length limit, or no such transaction/it's deleted), with a message meant
/// to be shown as-is, or the database itself errored.
#[derive(Debug)]
pub enum NotesError {
    Invalid(String),
    Db(rusqlite::Error),
}

impl std::fmt::Display for NotesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NotesError::Invalid(message) => write!(f, "{message}"),
            NotesError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for NotesError {}

impl From<rusqlite::Error> for NotesError {
    fn from(e: rusqlite::Error) -> Self {
        NotesError::Db(e)
    }
}

/// Whitespace-only (including empty) becomes `None`; otherwise the text is
/// trimmed of leading/trailing whitespace (internal whitespace/newlines are
/// preserved exactly) and rejected — without truncating — if it's over
/// `NOTES_MAX_CHARS` Unicode scalar values.
pub(super) fn normalize_notes(notes: Option<&str>) -> Result<Option<String>, NotesError> {
    let Some(raw) = notes else { return Ok(None) };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > NOTES_MAX_CHARS {
        return Err(NotesError::Invalid(format!("Notes can be at most {NOTES_MAX_CHARS} characters.")));
    }
    Ok(Some(trimmed.to_string()))
}

impl Store {
    /// One transaction's description, or `None` if there is no such (live) transaction — the same
    /// rows `all_transactions` lists, without loading them all to find one.
    pub fn transaction_description(&self, id: i64) -> rusqlite::Result<Option<String>> {
        match self.conn.query_row(
            "SELECT t.description FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.id = ?1 AND t.deleted_at IS NULL
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)",
            params![id],
            |row| row.get(0),
        ) {
            Ok(description) => Ok(Some(description)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Whether each of `txns` already exists in this account (by
    /// fingerprint) — a pure read, no writes. `result[i]` corresponds to
    /// `txns[i]`. Callers use this to show the user what's about to be
    /// skipped and let them override it, rather than having dedup decided
    /// for them silently.
    pub fn check_duplicates(&self, account_id: i64, txns: &[Transaction]) -> rusqlite::Result<Vec<bool>> {
        let mut result = Vec::with_capacity(txns.len());
        for tx in txns {
            let exists: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM transactions WHERE account_id = ?1 AND fingerprint = ?2 AND deleted_at IS NULL)",
                params![account_id, fingerprint(account_id, tx)],
                |row| row.get(0),
            )?;
            result.push(exists);
        }
        Ok(result)
    }

    /// Inserts every transaction given, unconditionally. Duplicate handling
    /// is entirely the caller's responsibility (see `check_duplicates`) —
    /// this used to skip anything matching an existing fingerprint, but
    /// that made it impossible to honor a user's explicit "keep it anyway"
    /// on a flagged duplicate.
    pub fn save_transactions(&self, account_id: i64, txns: &[Transaction]) -> rusqlite::Result<SaveReport> {
        let ids = self.save_transactions_with_ids(account_id, txns)?;
        Ok(SaveReport { inserted: ids.len() })
    }

    /// Same insert as `save_transactions`, but also returns each row's new
    /// id, in the same order — import needs this to attach tags to the
    /// exact row they belong to right after insert. A separate method
    /// (rather than changing `SaveReport`'s shape) so `save_transactions`'
    /// many existing callers, which only care about the count, are
    /// untouched.
    pub fn save_transactions_with_ids(&self, account_id: i64, txns: &[Transaction]) -> rusqlite::Result<Vec<i64>> {
        let mut ids = Vec::with_capacity(txns.len());
        // The running-balance snapshot chain below (see
        // `displayed_balance_for_log`'s doc comment: "one per row — each
        // row's after is the next row's before") costs one full
        // `account_balance_as_of` scan of this account's transactions per
        // row inserted. For a big import into an account that already has
        // many rows, paying that on every single row made the whole import
        // cost grow *quadratically* with the account's transaction count —
        // a real bottleneck for the exact "large ledger" scenario this
        // exists to support, and entirely wasted work whenever there's no
        // log to write it to, which is every release build (`log_activity`
        // discards it unread when `activity_log_path` is `None` — see
        // `Store::open`). Skipped altogether in that case; only debug
        // builds (and tests that set an activity log path) pay for it.
        let logging = self.activity_log_path.is_some();
        let account_name = if logging { self.account_name_for_log(account_id) } else { String::new() };
        let mut previous_snapshot = if logging { self.displayed_balance_for_log(account_id) } else { None };
        for tx in txns {
            self.conn.execute(
                "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint, member_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT member_id FROM accounts WHERE id = ?1))",
                params![
                    account_id,
                    tx.date.to_string(),
                    tx.description,
                    tx.amount.to_string(),
                    tx.category,
                    fingerprint(account_id, tx),
                ],
            )?;
            ids.push(self.conn.last_insert_rowid());
            // A file import (or a backup restore) can carry its own
            // category straight from the source — a bank's CSV export
            // column, say — never going through `set_category`/
            // `create_category`. Register it here too, the same "must be
            // immediately selectable everywhere, not just on this row"
            // guarantee `set_category` already gives a categorizer/manual
            // correction, so it doesn't take an app restart (and the
            // `backfill_categories_from_usage` launch backfill) to show up
            // in "All categories"/Manage categories.
            if let Some(category) = &tx.category {
                self.conn
                    .execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![category])?;
            }
            if logging {
                let after_snapshot = self.displayed_balance_for_log(account_id);
                let snapshot = Self::describe_balance_snapshot(previous_snapshot, after_snapshot);
                previous_snapshot = after_snapshot;
                self.log_activity(&format!(
                    "{account_name}: transaction added — \"{}\" {} amount={} — {snapshot}",
                    tx.description, tx.date, tx.amount
                ));
            }
        }
        Ok(ids)
    }

    /// One manually-entered transaction (the Transactions tab's "Add transaction…"
    /// form, as opposed to a file import) — reuses `save_transactions`'
    /// own insert path outright, so fingerprinting and the account's
    /// default-member assignment stay identical to an imported row, and
    /// returns the new row's id, matching every other single-entity
    /// creation method in this app (`create_holding`, `create_bucket`, ...).
    /// `notes` is written in the same transaction as the insert — never a
    /// separate follow-up write, so a rejected note (over the length limit)
    /// leaves no orphaned transaction behind and a mid-write failure can't
    /// leave one committed with the other lost.
    pub fn create_transaction(&self, account_id: i64, tx: &Transaction, notes: Option<&str>) -> Result<i64, NotesError> {
        let normalized_notes = normalize_notes(notes)?;
        let sql_tx = self.conn.unchecked_transaction()?;
        // `save_transactions_with_ids`, not `save_transactions` +
        // `last_insert_rowid()`: the latter isn't necessarily this row's id
        // — `save_transactions` may itself run a later insert afterward
        // (e.g. `set_category`'s own `INSERT OR IGNORE INTO categories`
        // for a brand-new category name), which would make
        // `last_insert_rowid()` return *that* row's id instead, silently
        // writing this note onto the wrong transaction (found by code
        // review; see `notes_land_on_the_right_row_even_when_the_insert_also_
        // registers_a_brand_new_category` in `store/tests/transactions.rs`).
        let id = self.save_transactions_with_ids(account_id, std::slice::from_ref(tx))?[0];
        if let Some(n) = &normalized_notes {
            self.conn.execute("UPDATE transactions SET notes = ?1 WHERE id = ?2", params![n, id])?;
        }
        sql_tx.commit()?;
        Ok(id)
    }

    /// Every transaction, except the synthetic ones `apply_debt_payment`
    /// generates on a debt account — those exist purely so that account's
    /// balance moves (see `account_balance_as_of`), not as something the
    /// user ever added themselves, so surfacing one as its own Transactions row
    /// would double it: the real payment already appears as the *source*
    /// transaction (which carries the "→ account (amount)" badge instead),
    /// and the generated one is just its balance-side bookkeeping twin.
    pub fn all_transactions(&self) -> rusqlite::Result<Vec<StoredTransaction>> {
        self.query_transactions("", [])
    }

    /// The rows `all_transactions` would list for these ids (deleted, generated or unknown ids are
    /// left out), ordered by id: what the page re-reads after editing a few rows, instead of the
    /// whole ledger.
    pub fn transactions_by_ids(&self, ids: &[i64]) -> rusqlite::Result<Vec<StoredTransaction>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = vec!["?"; ids.len()].join(", ");
        self.query_transactions(&format!(" AND t.id IN ({placeholders})"), rusqlite::params_from_iter(ids))
    }

    /// `all_transactions`' query, narrowed by `extra_filter` (appended to its WHERE clause, with
    /// `params` bound to its placeholders).
    fn query_transactions<P: rusqlite::Params>(&self, extra_filter: &str, params: P) -> rusqlite::Result<Vec<StoredTransaction>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT t.id, t.date, t.description, t.amount, t.category, t.category_source,
                    t.confidence, t.account_id, a.name,
                    dp.debt_account_id, da.name, dp.amount,
                    (SELECT COUNT(*) FROM transaction_splits ts WHERE ts.transaction_id = t.id),
                    GROUP_CONCAT(tt.tag, char(31)),
                    t.member_id, fm.name, t.principal_amount, t.notes,
                    COALESCE(
                        (SELECT l.in_transaction_id FROM transfer_links l
                         JOIN transactions o ON o.id = l.in_transaction_id
                         WHERE l.out_transaction_id = t.id AND o.deleted_at IS NULL),
                        (SELECT l.out_transaction_id FROM transfer_links l
                         JOIN transactions o ON o.id = l.out_transaction_id
                         WHERE l.in_transaction_id = t.id AND o.deleted_at IS NULL)
                    ), dp.date
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             LEFT JOIN debt_payments dp ON dp.source_transaction_id = t.id
             LEFT JOIN accounts da ON da.id = dp.debt_account_id
             LEFT JOIN transaction_tags tt ON tt.transaction_id = t.id
             LEFT JOIN family_members fm ON fm.id = t.member_id
             WHERE t.id NOT IN (SELECT generated_transaction_id FROM debt_payments) AND t.deleted_at IS NULL{extra_filter}
             GROUP BY t.id
             ORDER BY t.id",
        ))?;
        let rows = stmt.query_map(params, |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<f64>>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, i64>(12)?,
                row.get::<_, Option<String>>(13)?,
                row.get::<_, Option<i64>>(14)?,
                row.get::<_, Option<String>>(15)?,
                row.get::<_, Option<String>>(16)?,
                row.get::<_, Option<String>>(17)?,
                row.get::<_, Option<i64>>(18)?,
                row.get::<_, Option<String>>(19)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (
                id,
                date_str,
                description,
                amount_str,
                category,
                category_source,
                confidence,
                account_id,
                account_name,
                debt_account_id,
                debt_account_name,
                applied_amount_str,
                split_count,
                tags_str,
                member_id,
                member_name,
                principal_amount_str,
                notes,
                transfer_counterpart_id,
                applied_date,
            ) = row?;
            let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
            let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
            let applied_to_debt = match (debt_account_id, debt_account_name, applied_amount_str, applied_date) {
                (Some(debt_account_id), Some(debt_account_name), Some(applied_amount_str), Some(applied_date)) => Some(AppliedDebtPayment {
                    date: NaiveDate::parse_from_str(&applied_date, "%Y-%m-%d").expect("stored date must be valid"),
                    debt_account_id,
                    debt_account_name,
                    amount: Decimal::from_str(&applied_amount_str).expect("amount stored by this crate must be valid"),
                }),
                _ => None,
            };
            let tags = tags_str.map(|s| s.split('\u{1f}').map(str::to_string).collect()).unwrap_or_default();
            let principal_amount = principal_amount_str.map(|s| Decimal::from_str(&s).expect("amount stored by this crate must be valid"));
            result.push(StoredTransaction {
                id,
                transfer_counterpart_id,
                transaction: Transaction {
                    date,
                    description,
                    amount,
                    category,
                },
                category_source: category_source.and_then(|s| CategorySource::parse(&s)),
                confidence,
                account_id,
                account_name,
                applied_to_debt,
                principal_amount,
                split_count,
                tags,
                member_id,
                member_name,
                notes,
            });
        }
        Ok(result)
    }

    /// Corrects a transaction's amount after the fact (a wrong sign or a
    /// misread value shouldn't require re-importing the whole file). The
    /// fingerprint is recomputed so dedup keeps keying off the corrected
    /// value. An unknown id is a harmless no-op, matching `set_category`.
    /// Returns whether this transaction's split breakdown (see
    /// `set_transaction_splits`) was reconciled as a side effect. A split
    /// is a breakdown of *this* transaction's amount — nothing keeps it in
    /// sync if the amount changes underneath it, so a stale breakdown
    /// would silently disagree with the new total (the transaction
    /// showing one amount, its own splits still summing to the old one).
    /// Reconciling scales every split by the same ratio the total itself
    /// changed by, preserving each one's *relative* share of the
    /// breakdown rather than discarding it — the last split absorbs
    /// whatever a penny of rounding leaves over, so the splits always sum
    /// to exactly the new amount, not just approximately. A breakdown that
    /// summed to zero (no ratio to scale by) splits the new amount evenly
    /// instead, for the same reason.
    pub fn update_transaction_amount(&self, id: i64, amount: Decimal) -> rusqlite::Result<bool> {
        let existing = self.conn.query_row(
            "SELECT account_id, date, description, amount FROM transactions WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        );
        let (account_id, date_str, description, old_amount_str) = match existing {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(false),
            Err(e) => return Err(e),
        };
        let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
        let fp = fingerprint(
            account_id,
            &Transaction {
                date,
                description: description.clone(),
                amount,
                category: None,
            },
        );

        let before = self.displayed_balance_for_log(account_id);
        self.conn.execute(
            "UPDATE transactions SET amount = ?1, fingerprint = ?2 WHERE id = ?3",
            params![amount.to_string(), fp, id],
        )?;

        let splits: Vec<(i64, String)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id, amount FROM transaction_splits WHERE transaction_id = ?1 ORDER BY id")?;
            let rows = stmt.query_map(params![id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut splits_reconciled = false;
        if !splits.is_empty() {
            let old_amounts: Vec<Decimal> = splits
                .iter()
                .map(|(_, a)| Decimal::from_str(a).expect("split amount stored by this crate must be valid"))
                .collect();
            let split_total: Decimal = old_amounts.iter().sum();
            if split_total != amount {
                splits_reconciled = true;
                let last = splits.len() - 1;
                let mut running = Decimal::ZERO;
                for (i, (split_id, _)) in splits.iter().enumerate() {
                    let new_split_amount = if i == last {
                        // Exact by construction: the new total minus every
                        // already-assigned split, whatever rounding those
                        // left over included.
                        amount - running
                    } else if split_total.is_zero() {
                        (amount / Decimal::from(splits.len() as i64)).round_dp(2)
                    } else {
                        (old_amounts[i] * amount / split_total).round_dp(2)
                    };
                    running += new_split_amount;
                    self.conn.execute(
                        "UPDATE transaction_splits SET amount = ?1 WHERE id = ?2",
                        params![new_split_amount.to_string(), split_id],
                    )?;
                }
            }
        }

        // A real before/after snapshot (rather than computing a delta from
        // `amount`) naturally reports no movement for a transaction whose
        // principal override (see `update_transaction_principal_amount`)
        // is still set — correcting `amount` alone doesn't move the
        // balance until that override is cleared, which is exactly the
        // kind of surprise this log exists to surface.
        let after = self.displayed_balance_for_log(account_id);
        let snapshot = Self::describe_balance_snapshot(before, after);
        self.log_activity(&format!(
            "{}: transaction #{id} \"{description}\" amount corrected: {old_amount_str} -> {amount} — {snapshot}{}",
            self.account_name_for_log(account_id),
            if splits_reconciled {
                " (its splits were rescaled to still sum to the new amount)"
            } else {
                ""
            }
        ));
        Ok(splits_reconciled)
    }

    /// Sets (or, with `None`, clears) how much of this transaction counts
    /// toward its own account's balance — for a transaction recorded
    /// directly on a loan account whose full amount bundles principal with
    /// interest/escrow (see `account_balance_as_of`, which reads
    /// `COALESCE(principal_amount, amount)`). Doesn't touch the
    /// fingerprint — unlike `amount`, this isn't part of what identifies a
    /// transaction, so correcting it can't affect dedup. An unknown id is
    /// a harmless no-op, matching `update_transaction_amount`.
    pub fn update_transaction_principal_amount(&self, id: i64, principal_amount: Option<Decimal>) -> rusqlite::Result<()> {
        let existing = self.conn.query_row(
            "SELECT account_id, principal_amount FROM transactions WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        );
        let (account_id, old_principal_str) = match existing {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };

        let before = self.displayed_balance_for_log(account_id);
        self.conn.execute(
            "UPDATE transactions SET principal_amount = ?1 WHERE id = ?2",
            params![principal_amount.map(|a| a.to_string()), id],
        )?;
        let after = self.displayed_balance_for_log(account_id);
        let snapshot = Self::describe_balance_snapshot(before, after);
        let describe = |s: &Option<String>| s.clone().unwrap_or_else(|| "full amount".to_string());
        self.log_activity(&format!(
            "{}: transaction #{id} principal override: {} -> {} — {snapshot}",
            self.account_name_for_log(account_id),
            describe(&old_principal_str),
            describe(&principal_amount.map(|a| a.to_string())),
        ));
        Ok(())
    }

    /// Sets, changes or clears (`None`) a transaction's own freeform note —
    /// never its category, amount, tags, transfer link, or the import
    /// fingerprint; a notes-only edit changes nothing else about the row.
    /// Unlike most `update_transaction_*` methods, a missing or (soft-)
    /// deleted id is a real error here, not a silent no-op: the notes
    /// dialog needs to know its target vanished rather than quietly losing
    /// the edit. See `normalize_notes` for the whitespace/length rules.
    pub fn update_transaction_notes(&self, id: i64, notes: Option<&str>) -> Result<(), NotesError> {
        let normalized = normalize_notes(notes)?;
        let affected = self.conn.execute(
            "UPDATE transactions SET notes = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![normalized, id],
        )?;
        if affected == 0 {
            return Err(NotesError::Invalid("This transaction no longer exists.".to_string()));
        }
        Ok(())
    }

    /// Moves a transaction to a different account after the fact (it was
    /// imported into the wrong one). The fingerprint is recomputed since it
    /// includes `account_id`. An unknown id is a harmless no-op.
    pub fn update_transaction_account(&self, id: i64, account_id: i64) -> rusqlite::Result<()> {
        let existing = self.conn.query_row(
            "SELECT account_id, date, description, amount FROM transactions WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        );
        let (old_account_id, date_str, description, amount_str) = match existing {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };
        let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
        let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
        let fp = fingerprint(
            account_id,
            &Transaction {
                date,
                description: description.clone(),
                amount,
                category: None,
            },
        );

        let before_old = self.displayed_balance_for_log(old_account_id);
        let before_new = self.displayed_balance_for_log(account_id);
        self.conn.execute(
            "UPDATE transactions SET account_id = ?1, fingerprint = ?2 WHERE id = ?3",
            params![account_id, fp, id],
        )?;
        let old_snapshot = Self::describe_balance_snapshot(before_old, self.displayed_balance_for_log(old_account_id));
        let new_snapshot = Self::describe_balance_snapshot(before_new, self.displayed_balance_for_log(account_id));
        self.log_activity(&format!(
            "transaction #{id} \"{description}\" moved: {} ({old_snapshot}) -> {} ({new_snapshot})",
            self.account_name_for_log(old_account_id),
            self.account_name_for_log(account_id)
        ));
        Ok(())
    }

    /// Corrects a transaction's date after the fact (misread a statement,
    /// or it posted a day later than it was actually charged). The
    /// fingerprint is recomputed since it includes the date. An unknown id
    /// is a harmless no-op, same convention as `update_transaction_amount`.
    pub fn update_transaction_date(&self, id: i64, date: NaiveDate) -> rusqlite::Result<()> {
        let existing = self.conn.query_row(
            "SELECT account_id, description, amount FROM transactions WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
        );
        let (account_id, description, amount_str) = match existing {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };
        let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
        let fp = fingerprint(
            account_id,
            &Transaction {
                date,
                description,
                amount,
                category: None,
            },
        );

        self.conn.execute(
            "UPDATE transactions SET date = ?1, fingerprint = ?2 WHERE id = ?3",
            params![date.to_string(), fp, id],
        )?;
        Ok(())
    }

    /// Corrects a transaction's description after the fact (a raw import
    /// description that didn't get cleaned up, or a manual entry with a
    /// typo). The fingerprint is recomputed since it includes the
    /// description. An unknown id is a harmless no-op, same convention as
    /// `update_transaction_amount`.
    pub fn update_transaction_description(&self, id: i64, description: &str) -> rusqlite::Result<()> {
        let existing = self
            .conn
            .query_row("SELECT account_id, date, amount FROM transactions WHERE id = ?1", params![id], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            });
        let (account_id, date_str, amount_str) = match existing {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };
        let date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d").expect("date stored by this crate must be valid");
        let amount = Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid");
        let fp = fingerprint(
            account_id,
            &Transaction {
                date,
                description: description.to_string(),
                amount,
                category: None,
            },
        );

        self.conn.execute(
            "UPDATE transactions SET description = ?1, fingerprint = ?2 WHERE id = ?3",
            params![description, fp, id],
        )?;
        Ok(())
    }

    /// Actually removes one transaction row and everything that would
    /// otherwise dangle or trip a foreign key once it's gone: its splits,
    /// tags, and — if it's either side of an applied debt payment — the
    /// link row and its generated twin transaction. This is the *old*
    /// `delete_transaction` behavior verbatim, kept only for
    /// `delete_account`'s cascade (see that method's doc comment for why
    /// it can't use the new soft-delete `delete_transaction` instead). Not
    /// used by anything a user can trigger without also deleting the
    /// whole account.
    pub(super) fn hard_delete_transaction_row(&self, id: i64) -> rusqlite::Result<()> {
        let generated_transaction_id = match self.conn.query_row(
            "SELECT generated_transaction_id FROM debt_payments WHERE source_transaction_id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        // The link row must go before either transaction row it points at
        // (it references both by id) — otherwise deleting the transaction
        // first trips the foreign key constraint.
        self.conn.execute(
            "DELETE FROM debt_payments WHERE source_transaction_id = ?1 OR generated_transaction_id = ?1",
            params![id],
        )?;
        if let Some(generated_id) = generated_transaction_id {
            self.conn
                .execute("DELETE FROM transaction_splits WHERE transaction_id = ?1", params![generated_id])?;
            self.conn
                .execute("DELETE FROM transaction_tags WHERE transaction_id = ?1", params![generated_id])?;
            self.conn.execute("DELETE FROM transactions WHERE id = ?1", params![generated_id])?;
        }
        self.conn
            .execute("DELETE FROM transaction_splits WHERE transaction_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM transaction_tags WHERE transaction_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM transactions WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Soft-deletes a transaction — sets `deleted_at` rather than actually
    /// removing the row, so `restore_transactions` can bring it back later
    /// (the Transactions tab's bulk-delete "Undo"). An unknown id is a harmless
    /// no-op, same as the old hard-delete was. Deliberately leaves
    /// `transaction_splits`/`transaction_tags`/`debt_payments` completely
    /// untouched — that's what makes restore complete: nothing needs
    /// separate "undelete the tags/splits too" logic, they were never
    /// gone. Every production read of `transactions` filters
    /// `deleted_at IS NULL` instead (see each method's own comment).
    ///
    /// `now` comes from the caller rather than reading the system clock in
    /// here — `core` deliberately never touches it directly (chrono's
    /// `clock` feature isn't even enabled for this crate), the same
    /// "today/now is always a parameter" convention every other
    /// date-based `Store` method already follows (`cash_flow_forecast`,
    /// `average_monthly_spend`, ...).
    ///
    /// If `id` is either side of an applied debt payment (see
    /// `apply_debt_payment`) — the source transaction or the twin it
    /// generated on the debt account — the other side is soft-deleted
    /// too, symmetrically, so a debt payment doesn't half-disappear from
    /// Transactions while its balance-side bookkeeping twin lingers behind
    /// (or vice versa). The `debt_payments` link row itself is left
    /// alone; `restore_transactions` uses it the same way to bring both
    /// sides back together.
    pub fn delete_transaction(&self, id: i64, now: NaiveDateTime) -> rusqlite::Result<()> {
        let now = now.to_string();
        let other_side = self.debt_payment_partner(id)?;
        let summary = self.transaction_summary_for_log(id);
        let before = summary.as_ref().and_then(|s| self.displayed_balance_for_log(s.0));
        self.conn
            .execute("UPDATE transactions SET deleted_at = ?1 WHERE id = ?2", params![now, id])?;
        if let Some((account_id, account, description, amount)) = summary {
            let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(account_id));
            self.log_activity(&format!("{account}: transaction #{id} \"{description}\" ({amount}) deleted — {snapshot}"));
        }
        if let Some(other_id) = other_side {
            let other_summary = self.transaction_summary_for_log(other_id);
            let other_before = other_summary.as_ref().and_then(|s| self.displayed_balance_for_log(s.0));
            self.conn
                .execute("UPDATE transactions SET deleted_at = ?1 WHERE id = ?2", params![now, other_id])?;
            if let Some((account_id, account, description, amount)) = other_summary {
                let snapshot = Self::describe_balance_snapshot(other_before, self.displayed_balance_for_log(account_id));
                self.log_activity(&format!(
                    "{account}: transaction #{other_id} \"{description}\" ({amount}) deleted (linked debt-payment side) — {snapshot}"
                ));
            }
        }
        Ok(())
    }

    /// Account id, account name, description, and raw amount (as text, for
    /// display) for a transaction — built only for a log line before/after
    /// delete or restore, since those operations otherwise never need any
    /// of this. `None` if the id doesn't exist (never expected in practice
    /// — called right after confirming the row is there).
    fn transaction_summary_for_log(&self, id: i64) -> Option<(i64, String, String, String)> {
        self.conn
            .query_row(
                "SELECT account_id, description, amount FROM transactions WHERE id = ?1",
                params![id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
            )
            .ok()
            .map(|(account_id, description, amount)| (account_id, self.account_name_for_log(account_id), description, amount))
    }

    /// The other transaction id linked to `id` through `debt_payments`
    /// (source -> generated, or generated -> source), if any — shared by
    /// `delete_transaction` and `restore_transactions` so a debt payment's
    /// two sides always move together.
    fn debt_payment_partner(&self, id: i64) -> rusqlite::Result<Option<i64>> {
        let as_source = match self.conn.query_row(
            "SELECT generated_transaction_id FROM debt_payments WHERE source_transaction_id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };
        if as_source.is_some() {
            return Ok(as_source);
        }
        match self.conn.query_row(
            "SELECT source_transaction_id FROM debt_payments WHERE generated_transaction_id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Undoes `delete_transaction`/`bulk_delete_transactions` (the
    /// Transactions tab's bulk-delete "Undo") — clears `deleted_at` for exactly
    /// these ids, plus each one's debt-payment partner if it has one
    /// (symmetric with `delete_transaction`'s own cascade). Tags, splits,
    /// and the `debt_payments` link row were never touched by the delete,
    /// so this alone is a complete restore.
    pub fn restore_transactions(&self, ids: &[i64]) -> rusqlite::Result<()> {
        for &id in ids {
            let summary = self.transaction_summary_for_log(id);
            let before = summary.as_ref().and_then(|s| self.displayed_balance_for_log(s.0));
            self.conn
                .execute("UPDATE transactions SET deleted_at = NULL WHERE id = ?1", params![id])?;
            if let Some((account_id, account, description, amount)) = summary {
                let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(account_id));
                self.log_activity(&format!(
                    "{account}: transaction #{id} \"{description}\" ({amount}) restored — {snapshot}"
                ));
            }
            if let Some(other_id) = self.debt_payment_partner(id)? {
                let other_summary = self.transaction_summary_for_log(other_id);
                let other_before = other_summary.as_ref().and_then(|s| self.displayed_balance_for_log(s.0));
                self.conn
                    .execute("UPDATE transactions SET deleted_at = NULL WHERE id = ?1", params![other_id])?;
                if let Some((account_id, account, description, amount)) = other_summary {
                    let snapshot = Self::describe_balance_snapshot(other_before, self.displayed_balance_for_log(account_id));
                    self.log_activity(&format!(
                        "{account}: transaction #{other_id} \"{description}\" ({amount}) restored (linked debt-payment side) — {snapshot}"
                    ));
                }
            }
        }
        Ok(())
    }

    /// Adds a tag to a transaction (a no-op if it's already there, since
    /// tags have no ordering or count that a duplicate would affect).
    pub fn add_tag(&self, transaction_id: i64, tag: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag) VALUES (?1, ?2)",
            params![transaction_id, tag.trim()],
        )?;
        Ok(())
    }

    /// Removes a tag from a transaction. A no-op if it wasn't there.
    pub fn remove_tag(&self, transaction_id: i64, tag: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "DELETE FROM transaction_tags WHERE transaction_id = ?1 AND tag = ?2",
            params![transaction_id, tag],
        )?;
        Ok(())
    }

    /// Every distinct tag in use across any transaction, alphabetically —
    /// powers autocomplete when adding a new tag; there's no separate
    /// master tag list to manage. Joins back to `transactions` (rather
    /// than reading `transaction_tags` alone) so a tag belonging only to
    /// a soft-deleted transaction doesn't linger in autocomplete.
    pub fn list_all_tags(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT tt.tag FROM transaction_tags tt
             JOIN transactions t ON t.id = tt.transaction_id
             WHERE t.deleted_at IS NULL
             ORDER BY tt.tag COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Sets (or clears, with `None`) which family member a transaction is
    /// attributed to — overrides whatever it inherited from its account
    /// (see `save_transactions`). An unknown id is a harmless no-op.
    pub fn set_transaction_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE transactions SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// `set_transaction_member` applied to every id in `ids` — a plain loop,
    /// not a rule-learning bulk edit like `bulk_correct_category`, since
    /// member assignment has no analogous side effect to replay.
    pub fn bulk_set_transaction_member(&self, ids: &[i64], member_id: Option<i64>) -> rusqlite::Result<()> {
        for id in ids {
            self.set_transaction_member(*id, member_id)?;
        }
        Ok(())
    }

    /// Replaces every split line for `transaction_id` with `splits` (an
    /// empty slice clears them, un-splitting the transaction back to its
    /// own single category). No sum-matches-the-parent-amount validation
    /// here — the Transactions UI enforces that before it lets you save (a
    /// "remaining to allocate" total that must hit exactly $0.00), same
    /// trust-the-UI stance as every other setter in this crate that
    /// doesn't re-validate what the caller already checked.
    pub fn set_transaction_splits(&self, transaction_id: i64, splits: &[(String, Decimal, Option<String>)]) -> rusqlite::Result<()> {
        self.conn
            .execute("DELETE FROM transaction_splits WHERE transaction_id = ?1", params![transaction_id])?;
        for (category, amount, note) in splits {
            self.conn.execute(
                "INSERT INTO transaction_splits (transaction_id, category, amount, note) VALUES (?1, ?2, ?3, ?4)",
                params![transaction_id, category, amount.to_string(), note],
            )?;
        }
        Ok(())
    }

    /// A transaction's split lines, in the order they were saved. Empty
    /// for a transaction that's never been split.
    pub fn list_transaction_splits(&self, transaction_id: i64) -> rusqlite::Result<Vec<TransactionSplit>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, category, amount, note FROM transaction_splits WHERE transaction_id = ?1 ORDER BY id")?;
        let rows = stmt.query_map(params![transaction_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;
        let mut result = Vec::new();
        for row in rows {
            let (id, category, amount_str, note) = row?;
            result.push(TransactionSplit {
                id,
                category,
                amount: Decimal::from_str(&amount_str).expect("amount stored by this crate must be valid"),
                note,
            });
        }
        Ok(result)
    }

    /// Applies part or all of `source_transaction_id`'s amount toward
    /// paying down `debt_account_id` (a loan or credit account), so the
    /// debt's tracked balance moves without the user retyping it. `amount`
    /// is independent of the source transaction's own amount — a mortgage
    /// payment bundles principal, interest and escrow, and only the
    /// principal portion should reduce what's owed, so the caller decides
    /// how much counts.
    ///
    /// Records a new transaction on the debt account itself, signed to
    /// match what a real imported payment would look like: positive,
    /// whether the debt is a loan (`current_balance` there *is* the amount
    /// owed, and a positive transaction reduces it — see
    /// `account_balance_as_of`) or credit (`current_balance` is *available*
    /// credit — a payment restores it, same sign either way). It copies
    /// the source transaction's own category and notes where it came from
    /// in its description. A cash-funded payment already reduces net worth
    /// by `amount` on the source side; this generated row increases it by
    /// the same amount on the debt side, so total net worth is correctly
    /// unaffected — only its composition shifts from cash to less debt.
    ///
    /// One source transaction can be applied to one debt account at a
    /// time (`UNIQUE(source_transaction_id)`) — call
    /// `unapply_debt_payment` first to change it.
    pub fn apply_debt_payment(&self, source_transaction_id: i64, debt_account_id: i64, amount: Decimal, date: NaiveDate) -> rusqlite::Result<()> {
        let (source_account_id, source_category, source_description): (i64, Option<String>, String) = self.conn.query_row(
            "SELECT account_id, category, description FROM transactions WHERE id = ?1",
            params![source_transaction_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        let signed_amount = amount.abs();
        let before = self.displayed_balance_for_log(debt_account_id);

        let description = format!("Payment applied from: {source_description}");
        let generated = Transaction {
            date,
            description: description.clone(),
            amount: signed_amount,
            category: source_category,
        };
        self.conn.execute(
            "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint, member_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT member_id FROM accounts WHERE id = ?1))",
            params![
                debt_account_id,
                date.to_string(),
                description,
                signed_amount.to_string(),
                generated.category,
                fingerprint(debt_account_id, &generated),
            ],
        )?;
        let generated_transaction_id = self.conn.last_insert_rowid();

        self.conn.execute(
            "INSERT INTO debt_payments
                (source_transaction_id, debt_account_id, generated_transaction_id, amount, date)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                source_transaction_id,
                debt_account_id,
                generated_transaction_id,
                amount.to_string(),
                date.to_string(),
            ],
        )?;
        let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(debt_account_id));
        self.log_activity(&format!(
            "{} -> {}: debt payment applied, amount={amount} (source transaction #{source_transaction_id}) — {snapshot}",
            self.account_name_for_log(source_account_id),
            self.account_name_for_log(debt_account_id)
        ));
        Ok(())
    }

    /// Reverses `apply_debt_payment`: deletes the transaction it generated
    /// on the debt account and the link row. A no-op if
    /// `source_transaction_id` was never applied to anything.
    pub fn unapply_debt_payment(&self, source_transaction_id: i64) -> rusqlite::Result<()> {
        let generated_transaction_id = match self.conn.query_row(
            "SELECT generated_transaction_id FROM debt_payments WHERE source_transaction_id = ?1",
            params![source_transaction_id],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };
        let summary = self.transaction_summary_for_log(generated_transaction_id);
        let before = summary.as_ref().and_then(|s| self.displayed_balance_for_log(s.0));
        self.conn.execute(
            "DELETE FROM debt_payments WHERE source_transaction_id = ?1",
            params![source_transaction_id],
        )?;
        self.conn
            .execute("DELETE FROM transactions WHERE id = ?1", params![generated_transaction_id])?;
        if let Some((account_id, account, _, amount)) = summary {
            let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(account_id));
            self.log_activity(&format!(
                "{account}: debt payment unapplied, amount={amount} reversed (source transaction #{source_transaction_id}) — {snapshot}"
            ));
        }
        Ok(())
    }
}
