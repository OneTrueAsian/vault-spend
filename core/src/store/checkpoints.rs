//! Balance checkpoints that remember what they counted.
//!
//! `balance_resets` is the row every balance read starts from. This module adds what an old checkpoint never
//! recorded, so a transaction dated before it can be moved without guessing:
//!
//! * `effective_from` — the first day the checkpoint may be used. `reset_date` stays the cutoff for which
//!   transactions are added on top of it. Legacy rows get `effective_from = reset_date`, so every old read is
//!   unchanged (and a row written by code that does not know the column reads the same way).
//! * `balance_reset_versions` — immutable versions of each checkpoint: kind, parent version, the value used from
//!   the parent, the interval it covered and whether it can be trusted. A correction appends a version.
//! * `balance_version_contributions` — exactly which transactions (and revision of each) a recorded checkpoint
//!   counted in its own interval, so removing one has a proven effect.
//! * `transactions.financial_revision` — a counter value stamped by triggers on every insert and on every
//!   change to account, date, amount, principal or deleted state, so a later edit is visible.
//!
//! Nothing here infers what a legacy checkpoint contained: they all become `opaque`.

use super::Store;
use chrono::NaiveDate;
use rusqlite::{Connection, OptionalExtension, params};
use rust_decimal::Decimal;
use std::path::{Path, PathBuf};

pub(super) const ALGORITHM_VERSION: i64 = 1;
/// Recorded in `schema_features` once every stage of the migration has succeeded.
pub(super) const FEATURE: &str = "historical_account_moves";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CheckpointKind {
    LegacyUnknown,
    AutomaticRecorded,
    ManualAnchor,
    MoveConfirmation,
}

impl CheckpointKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            CheckpointKind::LegacyUnknown => "legacy_unknown",
            CheckpointKind::AutomaticRecorded => "automatic_recorded",
            CheckpointKind::ManualAnchor => "manual_anchor",
            CheckpointKind::MoveConfirmation => "move_confirmation",
        }
    }
    pub(crate) fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "legacy_unknown" => CheckpointKind::LegacyUnknown,
            "automatic_recorded" => CheckpointKind::AutomaticRecorded,
            "manual_anchor" => CheckpointKind::ManualAnchor,
            "move_confirmation" => CheckpointKind::MoveConfirmation,
            _ => return None,
        })
    }
}

/// A checkpoint as the balance readers see it.
#[derive(Debug, Clone)]
pub(crate) struct CheckpointRow {
    pub reset_id: i64,
    pub cutoff: NaiveDate,
    pub balance: Decimal,
}

/// What a new version records.
pub(crate) struct VersionSpec {
    pub reset_id: i64,
    pub account_id: i64,
    pub kind: CheckpointKind,
    pub cutoff: NaiveDate,
    pub effective: NaiveDate,
    pub balance: Decimal,
    pub account_type: String,
    pub opening_baseline: Option<Decimal>,
    pub parent_version_id: Option<i64>,
    pub parent_balance: Option<Decimal>,
    pub parent_cutoff: Option<NaiveDate>,
    pub operation_id: Option<String>,
    /// "trusted" (membership recorded), "opaque" (the number stands, its contents are unknown), "untrusted".
    pub integrity: &'static str,
    pub capture_revision: i64,
    /// The interval whose rows this version counted: `(coverage_start, coverage_end]`, open below for a root.
    pub coverage_start: Option<NaiveDate>,
    pub coverage_end: Option<NaiveDate>,
}

pub(crate) struct AnchorSpec<'a> {
    pub account_id: i64,
    pub period: &'a str,
    pub cutoff: NaiveDate,
    pub effective: NaiveDate,
    pub balance: Decimal,
    pub kind: CheckpointKind,
    pub operation_id: Option<&'a str>,
}

fn corrupt(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CORRUPT), Some(message.into()))
}

pub(crate) fn parse_date(s: &str) -> rusqlite::Result<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| corrupt(format!("\"{s}\" is not a valid stored date")))
}

pub(crate) fn parse_decimal(s: &str) -> rusqlite::Result<Decimal> {
    use std::str::FromStr;
    Decimal::from_str(s).map_err(|_| corrupt(format!("\"{s}\" is not a valid stored amount")))
}

pub(crate) fn add_amount(left: Decimal, right: Decimal) -> rusqlite::Result<Decimal> {
    left.checked_add(right).ok_or_else(amount_overflow)
}

pub(crate) fn sub_amount(left: Decimal, right: Decimal) -> rusqlite::Result<Decimal> {
    left.checked_sub(right).ok_or_else(amount_overflow)
}

fn amount_overflow() -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure("An account balance or total is too large to calculate safely.".into())
}

/// A loan's balance falls as its transactions rise; every other raw ledger balance adds them.
pub(crate) fn direction(account_type: &str) -> Decimal {
    if account_type == "loan" { Decimal::NEGATIVE_ONE } else { Decimal::ONE }
}

#[cfg(test)]
thread_local! {
    /// Test hook: fail the migration after this many logical stages.
    pub(super) static MIGRATION_FAULT: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
}

fn migration_fault(_stage: usize) -> rusqlite::Result<()> {
    #[cfg(test)]
    if MIGRATION_FAULT.with(|f| f.get()) == Some(_stage) {
        return Err(corrupt(format!("injected migration fault after stage {_stage}")));
    }
    Ok(())
}

const STAGES: usize = 7;

struct AtomicScope<'a> {
    conn: &'a Connection,
    nested: bool,
    open: bool,
}

impl Drop for AtomicScope<'_> {
    fn drop(&mut self) {
        if self.open {
            let _ = self.conn.execute_batch(if self.nested {
                "ROLLBACK TO atomically; RELEASE atomically"
            } else {
                "ROLLBACK"
            });
        }
    }
}

impl Store {
    /// Runs on every open, after the older migrations. Idempotent: a database that already has the feature
    /// recorded does nothing.
    pub(super) fn migrate_historical_accounting(&self) -> rusqlite::Result<()> {
        let has_marker_table: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_features')",
            [],
            |r| r.get(0),
        )?;
        if has_marker_table {
            let done: bool = self
                .conn
                .query_row("SELECT EXISTS(SELECT 1 FROM schema_features WHERE name = ?1)", params![FEATURE], |r| {
                    r.get(0)
                })?;
            if done {
                return Ok(());
            }
        }
        self.conn.execute_batch("BEGIN IMMEDIATE")?;
        match self.run_migration_stages() {
            Ok(()) => self.conn.execute_batch("COMMIT"),
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    fn run_migration_stages(&self) -> rusqlite::Result<()> {
        // Stage 0: refuse malformed legacy values before anything is changed, with a message that says where.
        let mut stmt = self.conn.prepare("SELECT id, reset_date, balance FROM balance_resets")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        for (id, date, balance) in rows {
            parse_date(&date).map_err(|_| corrupt(format!("saved balance #{id} has an unreadable date")))?;
            parse_decimal(&balance).map_err(|_| corrupt(format!("saved balance #{id} has an unreadable amount")))?;
        }
        let mut stmt = self.conn.prepare("SELECT id, date, amount FROM transactions")?;
        let txs = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        for (id, date, amount) in txs {
            parse_date(&date).map_err(|_| corrupt(format!("transaction #{id} has an unreadable date")))?;
            parse_decimal(&amount).map_err(|_| corrupt(format!("transaction #{id} has an unreadable amount")))?;
        }
        migration_fault(0)?;

        // Stage 1: columns.
        if !self.table_has_column("balance_resets", "effective_from")? {
            self.conn.execute_batch("ALTER TABLE balance_resets ADD COLUMN effective_from TEXT")?;
        }
        if !self.table_has_column("balance_resets", "current_version_id")? {
            self.conn
                .execute_batch("ALTER TABLE balance_resets ADD COLUMN current_version_id INTEGER")?;
        }
        if !self.table_has_column("transactions", "financial_revision")? {
            self.conn
                .execute_batch("ALTER TABLE transactions ADD COLUMN financial_revision INTEGER NOT NULL DEFAULT 0")?;
        }
        migration_fault(1)?;

        // Stage 2: tables.
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS financial_revision_counter (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 value INTEGER NOT NULL
             );
             INSERT OR IGNORE INTO financial_revision_counter (id, value) VALUES (1, 0);
             CREATE TABLE IF NOT EXISTS checkpoint_write_guard (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 active INTEGER NOT NULL
             );
             INSERT OR IGNORE INTO checkpoint_write_guard (id, active) VALUES (1, 0);
             CREATE TABLE IF NOT EXISTS transaction_tombstones (
                 transaction_id INTEGER NOT NULL,
                 revision INTEGER NOT NULL,
                 PRIMARY KEY (transaction_id, revision)
             );
             CREATE TABLE IF NOT EXISTS balance_reset_versions (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 reset_id INTEGER NOT NULL,
                 account_id INTEGER NOT NULL,
                 kind TEXT NOT NULL CHECK (kind IN ('legacy_unknown', 'automatic_recorded', 'manual_anchor', 'move_confirmation')),
                 cutoff_date TEXT NOT NULL,
                 effective_from TEXT NOT NULL,
                 balance TEXT NOT NULL,
                 account_type TEXT,
                 opening_baseline TEXT,
                 parent_version_id INTEGER REFERENCES balance_reset_versions(id),
                 parent_balance TEXT,
                 parent_cutoff TEXT,
                 algorithm_version INTEGER NOT NULL,
                 operation_id TEXT,
                 integrity TEXT NOT NULL CHECK (integrity IN ('trusted', 'opaque', 'untrusted')),
                 capture_revision INTEGER NOT NULL DEFAULT 0,
                 coverage_start TEXT,
                 coverage_end TEXT
             );
             CREATE TABLE IF NOT EXISTS balance_version_contributions (
                 version_id INTEGER NOT NULL REFERENCES balance_reset_versions(id),
                 transaction_id INTEGER NOT NULL,
                 revision INTEGER NOT NULL,
                 account_id INTEGER NOT NULL,
                 date TEXT NOT NULL,
                 amount TEXT NOT NULL,
                 principal_amount TEXT,
                 contribution TEXT NOT NULL,
                 PRIMARY KEY (version_id, transaction_id)
             );
             CREATE TABLE IF NOT EXISTS account_move_operations (
                 operation_id TEXT PRIMARY KEY,
                 request_digest TEXT NOT NULL,
                 contract_version INTEGER NOT NULL,
                 algorithm_version INTEGER NOT NULL,
                 mode TEXT NOT NULL,
                 effective_date TEXT NOT NULL,
                 destination_account_id INTEGER NOT NULL,
                 moved_count INTEGER NOT NULL,
                 inputs_json TEXT NOT NULL,
                 before_json TEXT NOT NULL,
                 after_json TEXT NOT NULL,
                 corrections_json TEXT NOT NULL,
                 result_json TEXT NOT NULL
             );",
        )?;
        migration_fault(2)?;

        // Stage 3: legacy checkpoints become opaque versions. Nothing about what they counted is guessed.
        self.conn
            .execute_batch("UPDATE balance_resets SET effective_from = reset_date WHERE effective_from IS NULL")?;
        let counter: i64 = self
            .conn
            .query_row("SELECT value FROM financial_revision_counter WHERE id = 1", [], |r| r.get(0))?;
        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.account_id, r.period, r.reset_date, r.effective_from, r.balance, (SELECT account_type FROM accounts a WHERE a.id = r.account_id)
             FROM balance_resets r WHERE r.current_version_id IS NULL ORDER BY r.id",
        )?;
        let legacy = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        for (reset_id, account_id, period, cutoff, effective, balance, account_type) in legacy {
            let kind = if period.starts_with("manual:") {
                CheckpointKind::ManualAnchor
            } else {
                CheckpointKind::LegacyUnknown
            };
            self.conn.execute(
                "INSERT INTO balance_reset_versions (reset_id, account_id, kind, cutoff_date, effective_from, balance, account_type, algorithm_version, integrity, capture_revision)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'opaque', ?9)",
                params![reset_id, account_id, kind.as_str(), cutoff, effective, balance, account_type, ALGORITHM_VERSION, counter],
            )?;
            let version_id = self.conn.last_insert_rowid();
            self.conn.execute(
                "UPDATE balance_resets SET current_version_id = ?1 WHERE id = ?2",
                params![version_id, reset_id],
            )?;
        }
        migration_fault(3)?;

        // Stage 4: indexes.
        self.conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_balance_resets_account_effective ON balance_resets(account_id, effective_from, reset_date);
             CREATE INDEX IF NOT EXISTS idx_balance_versions_reset ON balance_reset_versions(reset_id);
             CREATE INDEX IF NOT EXISTS idx_balance_versions_parent ON balance_reset_versions(parent_version_id);
             CREATE INDEX IF NOT EXISTS idx_balance_versions_account ON balance_reset_versions(account_id, cutoff_date);
             CREATE INDEX IF NOT EXISTS idx_version_contributions_transaction ON balance_version_contributions(transaction_id);",
        )?;
        migration_fault(4)?;

        // Stage 5: triggers, created last so the backfill above never trips them.
        self.conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS trg_tx_revision_insert AFTER INSERT ON transactions BEGIN
                 UPDATE financial_revision_counter SET value = value + 1 WHERE id = 1;
                 UPDATE transactions SET financial_revision = (SELECT value FROM financial_revision_counter WHERE id = 1) WHERE id = NEW.id;
             END;
             CREATE TRIGGER IF NOT EXISTS trg_tx_revision_update AFTER UPDATE OF account_id, date, amount, principal_amount, deleted_at ON transactions
             WHEN OLD.account_id IS NOT NEW.account_id OR OLD.date IS NOT NEW.date OR OLD.amount IS NOT NEW.amount
               OR OLD.principal_amount IS NOT NEW.principal_amount OR (OLD.deleted_at IS NULL) IS NOT (NEW.deleted_at IS NULL)
             BEGIN
                 UPDATE financial_revision_counter SET value = value + 1 WHERE id = 1;
                 UPDATE transactions SET financial_revision = (SELECT value FROM financial_revision_counter WHERE id = 1) WHERE id = NEW.id;
             END;
             CREATE TRIGGER IF NOT EXISTS trg_tx_revision_delete AFTER DELETE ON transactions BEGIN
                 UPDATE financial_revision_counter SET value = value + 1 WHERE id = 1;
                 INSERT OR REPLACE INTO transaction_tombstones (transaction_id, revision) VALUES (OLD.id, (SELECT value FROM financial_revision_counter WHERE id = 1));
             END;
             CREATE TRIGGER IF NOT EXISTS trg_resets_untracked_insert AFTER INSERT ON balance_resets
             WHEN (SELECT active FROM checkpoint_write_guard WHERE id = 1) = 0
             BEGIN
                 INSERT INTO balance_reset_versions (reset_id, account_id, kind, cutoff_date, effective_from, balance, account_type, algorithm_version, integrity, capture_revision)
                 VALUES (NEW.id, NEW.account_id,
                         CASE WHEN NEW.period LIKE 'manual:%' THEN 'manual_anchor' ELSE 'legacy_unknown' END,
                         NEW.reset_date, COALESCE(NEW.effective_from, NEW.reset_date), NEW.balance,
                         (SELECT account_type FROM accounts WHERE id = NEW.account_id), 1, 'opaque',
                         (SELECT value FROM financial_revision_counter WHERE id = 1));
                 UPDATE balance_resets SET current_version_id = last_insert_rowid() WHERE id = NEW.id;
             END;
             CREATE TRIGGER IF NOT EXISTS trg_resets_untracked_update AFTER UPDATE OF balance, reset_date, account_id ON balance_resets
             WHEN (SELECT active FROM checkpoint_write_guard WHERE id = 1) = 0
               AND (OLD.balance IS NOT NEW.balance OR OLD.reset_date IS NOT NEW.reset_date OR OLD.account_id IS NOT NEW.account_id)
             BEGIN
                 UPDATE balance_reset_versions SET integrity = 'untrusted' WHERE id IN (
                     WITH RECURSIVE d(id) AS (
                         SELECT id FROM balance_reset_versions WHERE parent_version_id IN (SELECT id FROM balance_reset_versions WHERE reset_id = NEW.id)
                         UNION SELECT v.id FROM balance_reset_versions v JOIN d ON v.parent_version_id = d.id
                     ) SELECT id FROM d);
                 UPDATE balance_reset_versions SET integrity = 'untrusted' WHERE id = OLD.current_version_id;
                 INSERT INTO balance_reset_versions (reset_id, account_id, kind, cutoff_date, effective_from, balance, account_type, algorithm_version, integrity, capture_revision)
                 VALUES (NEW.id, NEW.account_id,
                         CASE WHEN NEW.period LIKE 'manual:%' THEN 'manual_anchor' ELSE 'legacy_unknown' END,
                         NEW.reset_date, COALESCE(NEW.effective_from, NEW.reset_date), NEW.balance,
                         (SELECT account_type FROM accounts WHERE id = NEW.account_id), 1, 'opaque',
                         (SELECT value FROM financial_revision_counter WHERE id = 1));
                 UPDATE balance_resets SET current_version_id = last_insert_rowid() WHERE id = NEW.id;
             END;
             CREATE TRIGGER IF NOT EXISTS trg_resets_untracked_delete AFTER DELETE ON balance_resets
             WHEN (SELECT active FROM checkpoint_write_guard WHERE id = 1) = 0
             BEGIN
                 UPDATE balance_reset_versions SET integrity = 'untrusted' WHERE id IN (
                     WITH RECURSIVE d(id) AS (
                         SELECT id FROM balance_reset_versions WHERE parent_version_id IN (SELECT id FROM balance_reset_versions WHERE reset_id = OLD.id)
                         UNION SELECT v.id FROM balance_reset_versions v JOIN d ON v.parent_version_id = d.id
                     ) SELECT id FROM d);
             END;",
        )?;
        migration_fault(5)?;

        // Stage 6: recorded last. A database without this row runs the whole migration again.
        self.conn
            .execute_batch("CREATE TABLE IF NOT EXISTS schema_features (name TEXT PRIMARY KEY, completed_at TEXT NOT NULL)")?;
        self.conn.execute(
            "INSERT INTO schema_features (name, completed_at) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            params![FEATURE],
        )?;
        migration_fault(6)?;
        debug_assert_eq!(STAGES, 7);
        Ok(())
    }

    /// Runs `f` with the guard set, so the checkpoint writes inside it are recorded by the code that makes them
    /// and not treated as an unrecognized edit by the table triggers.
    pub(super) fn trusted_checkpoint_writes<T>(&self, f: impl FnOnce() -> rusqlite::Result<T>) -> rusqlite::Result<T> {
        self.conn.execute("UPDATE checkpoint_write_guard SET active = 1 WHERE id = 1", [])?;
        let result = f();
        let reset = self.conn.execute("UPDATE checkpoint_write_guard SET active = 0 WHERE id = 1", []);
        let value = result?;
        reset?;
        Ok(value)
    }

    /// Runs `f` as one unit: inside a transaction already open (a move) it is a savepoint, otherwise an
    /// immediate transaction, so a capture and its numbers are read and written under one write lock.
    pub(super) fn atomically<T>(&self, f: impl FnOnce() -> rusqlite::Result<T>) -> rusqlite::Result<T> {
        let nested = !self.conn.is_autocommit();
        self.conn.execute_batch(if nested { "SAVEPOINT atomically" } else { "BEGIN IMMEDIATE" })?;
        let mut scope = AtomicScope {
            conn: &self.conn,
            nested,
            open: true,
        };
        let value = f()?;
        self.conn.execute_batch(if nested { "RELEASE atomically" } else { "COMMIT" })?;
        scope.open = false;
        Ok(value)
    }

    /// The checkpoint a balance read as of `as_of` starts from. Eligible means both its effective day and its
    /// cutoff are on or before `as_of`; the latest effective day wins, then the latest cutoff, then the newest row.
    pub(crate) fn latest_checkpoint_row(&self, account_id: i64, as_of: NaiveDate) -> rusqlite::Result<Option<CheckpointRow>> {
        let found = self
            .conn
            .query_row(
                "SELECT id, period, reset_date, COALESCE(effective_from, reset_date), balance FROM balance_resets
                 WHERE account_id = ?1 AND reset_date <= ?2 AND COALESCE(effective_from, reset_date) <= ?2
                 ORDER BY COALESCE(effective_from, reset_date) DESC, reset_date DESC, id DESC LIMIT 1",
                params![account_id, as_of.to_string()],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()?;
        found
            .map(|(reset_id, _period, cutoff, effective, balance)| {
                parse_date(&effective)?;
                Ok(CheckpointRow {
                    reset_id,
                    cutoff: parse_date(&cutoff)?,
                    balance: parse_decimal(&balance)?,
                })
            })
            .transpose()
    }

    fn current_revision(&self) -> rusqlite::Result<i64> {
        self.conn
            .query_row("SELECT value FROM financial_revision_counter WHERE id = 1", [], |r| r.get(0))
    }

    pub(crate) fn insert_version(&self, v: &VersionSpec) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO balance_reset_versions (reset_id, account_id, kind, cutoff_date, effective_from, balance, account_type, opening_baseline,
                 parent_version_id, parent_balance, parent_cutoff, algorithm_version, operation_id, integrity, capture_revision, coverage_start, coverage_end)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                v.reset_id,
                v.account_id,
                v.kind.as_str(),
                v.cutoff.to_string(),
                v.effective.to_string(),
                v.balance.to_string(),
                v.account_type.as_str(),
                v.opening_baseline.map(|d| d.to_string()),
                v.parent_version_id,
                v.parent_balance.map(|d| d.to_string()),
                v.parent_cutoff.map(|d| d.to_string()),
                ALGORITHM_VERSION,
                v.operation_id.as_deref(),
                v.integrity,
                v.capture_revision,
                v.coverage_start.map(|d| d.to_string()),
                v.coverage_end.map(|d| d.to_string()),
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Writes a new checkpoint row and its (first) version. The caller holds the guard.
    fn insert_checkpoint(
        &self,
        account_id: i64,
        period: &str,
        cutoff: NaiveDate,
        effective: NaiveDate,
        balance: Decimal,
        spec: impl FnOnce(i64) -> VersionSpec,
    ) -> rusqlite::Result<(i64, i64)> {
        self.conn.execute(
            "INSERT INTO balance_resets (account_id, period, reset_date, balance, effective_from) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![account_id, period, cutoff.to_string(), balance.to_string(), effective.to_string()],
        )?;
        let reset_id = self.conn.last_insert_rowid();
        let version_id = self.insert_version(&spec(reset_id))?;
        self.conn.execute(
            "UPDATE balance_resets SET current_version_id = ?1 WHERE id = ?2",
            params![version_id, reset_id],
        )?;
        Ok((reset_id, version_id))
    }

    /// The monthly rollover's checkpoint: the account's balance through `cutoff`, with the parent it started from
    /// and every transaction it counted in its own interval, all from one write transaction.
    pub(super) fn record_automatic_checkpoint(
        &self,
        account_id: i64,
        account_type: &str,
        starting_balance: Decimal,
        period: &str,
        cutoff: NaiveDate,
    ) -> rusqlite::Result<Decimal> {
        self.atomically(|| {
            let parent = self.latest_checkpoint_row(account_id, cutoff)?;
            let parent_version: Option<(i64, String)> = match &parent {
                Some(p) => self
                    .conn
                    .query_row(
                        "SELECT current_version_id, balance FROM balance_resets WHERE id = ?1",
                        params![p.reset_id],
                        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
                    )
                    .optional()?,
                None => None,
            };
            let base = parent.as_ref().map(|p| p.balance).unwrap_or(starting_balance);
            let rows = self.interval_rows(account_id, parent.as_ref().map(|p| p.cutoff), cutoff)?;
            let dir = direction(account_type);
            let mut total = base;
            for r in &rows {
                total = add_amount(total, dir * r.quantity())?;
            }
            let reader = self.account_balance_as_of(account_id, account_type, starting_balance, cutoff)?;
            if reader != total {
                return Err(corrupt(format!(
                    "account #{account_id} balance {reader} does not match the recorded rows {total}"
                )));
            }
            let capture_revision = self.current_revision()?;
            let parent_cutoff = parent.as_ref().map(|p| p.cutoff);
            let parent_balance = parent.as_ref().map(|p| p.balance);
            let parent_version_id = parent_version.map(|(id, _)| id);
            let (_, version_id) = self.trusted_checkpoint_writes(|| {
                self.insert_checkpoint(account_id, period, cutoff, cutoff, total, |reset_id| VersionSpec {
                    reset_id,
                    account_id,
                    kind: CheckpointKind::AutomaticRecorded,
                    cutoff,
                    effective: cutoff,
                    balance: total,
                    account_type: account_type.to_string(),
                    opening_baseline: parent_balance.is_none().then_some(starting_balance),
                    parent_version_id,
                    parent_balance,
                    parent_cutoff,
                    operation_id: None,
                    integrity: "trusted",
                    capture_revision,
                    coverage_start: parent_cutoff,
                    coverage_end: Some(cutoff),
                })
            })?;
            for r in &rows {
                self.insert_contribution(version_id, r, dir * r.quantity())?;
            }
            Ok(total)
        })
    }

    pub(crate) fn insert_contribution(&self, version_id: i64, r: &IntervalRow, contribution: Decimal) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO balance_version_contributions (version_id, transaction_id, revision, account_id, date, amount, principal_amount, contribution)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                version_id,
                r.id,
                r.revision,
                r.account_id,
                r.date.to_string(),
                r.amount.to_string(),
                r.principal.map(|p| p.to_string()),
                contribution.to_string()
            ],
        )?;
        Ok(())
    }

    /// Live rows of one account dated in `(after, through]` (everything through `through` when `after` is None).
    pub(crate) fn interval_rows(&self, account_id: i64, after: Option<NaiveDate>, through: NaiveDate) -> rusqlite::Result<Vec<IntervalRow>> {
        let sql = "SELECT id, account_id, date, amount, principal_amount, financial_revision FROM transactions
                   WHERE account_id = ?1 AND deleted_at IS NULL AND date <= ?2 AND (?3 IS NULL OR date > ?3) ORDER BY id";
        let mut stmt = self.conn.prepare(sql)?;
        let found = stmt
            .query_map(params![account_id, through.to_string(), after.map(|d| d.to_string())], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        found
            .into_iter()
            .map(|(id, account_id, date, amount, principal, revision)| {
                Ok(IntervalRow {
                    id,
                    account_id,
                    date: parse_date(&date)?,
                    amount: parse_decimal(&amount)?,
                    principal: principal.map(|p| parse_decimal(&p)).transpose()?,
                    revision,
                })
            })
            .collect()
    }

    /// A checkpoint the person typed (or confirmed): its number stands, what it counted is unknown.
    pub(super) fn record_anchor(&self, anchor: AnchorSpec<'_>) -> rusqlite::Result<i64> {
        let AnchorSpec {
            account_id,
            period,
            cutoff,
            effective,
            balance,
            kind,
            operation_id,
        } = anchor;
        let account_type: String = self
            .conn
            .query_row("SELECT account_type FROM accounts WHERE id = ?1", params![account_id], |r| r.get(0))?;
        let capture_revision = self.current_revision()?;
        let existing: Option<(i64, Option<i64>)> = self
            .conn
            .query_row(
                "SELECT id, current_version_id FROM balance_resets WHERE account_id = ?1 AND period = ?2",
                params![account_id, period],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let operation_id = operation_id.map(str::to_string);
        let spec = |reset_id: i64| VersionSpec {
            reset_id,
            account_id,
            kind,
            cutoff,
            effective,
            balance,
            account_type: account_type.clone(),
            opening_baseline: None,
            parent_version_id: None,
            parent_balance: None,
            parent_cutoff: None,
            operation_id: operation_id.clone(),
            integrity: "opaque",
            capture_revision,
            coverage_start: None,
            coverage_end: None,
        };
        self.trusted_checkpoint_writes(|| match existing {
            Some((reset_id, previous)) => {
                // The same period replaces the number; the version it had stays, and anything built on it can no
                // longer rely on that number.
                self.mark_descendants_untrusted(reset_id)?;
                if let Some(previous) = previous {
                    self.conn.execute(
                        "UPDATE balance_reset_versions SET integrity = 'untrusted' WHERE id = ?1",
                        params![previous],
                    )?;
                }
                self.conn.execute(
                    "UPDATE balance_resets SET reset_date = ?1, effective_from = ?2, balance = ?3 WHERE id = ?4",
                    params![cutoff.to_string(), effective.to_string(), balance.to_string(), reset_id],
                )?;
                let version_id = self.insert_version(&spec(reset_id))?;
                self.conn.execute(
                    "UPDATE balance_resets SET current_version_id = ?1 WHERE id = ?2",
                    params![version_id, reset_id],
                )?;
                Ok(reset_id)
            }
            None => Ok(self.insert_checkpoint(account_id, period, cutoff, effective, balance, spec)?.0),
        })
    }

    pub(crate) fn mark_descendants_untrusted(&self, reset_id: i64) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE balance_reset_versions SET integrity = 'untrusted' WHERE id IN (
                 WITH RECURSIVE d(id) AS (
                     SELECT id FROM balance_reset_versions WHERE parent_version_id IN (SELECT id FROM balance_reset_versions WHERE reset_id = ?1)
                     UNION SELECT v.id FROM balance_reset_versions v JOIN d ON v.parent_version_id = d.id
                 ) SELECT id FROM d)",
            params![reset_id],
        )?;
        Ok(())
    }

    /// Removes an account's checkpoint metadata (used when the account itself is deleted). Only this account's.
    pub(super) fn delete_checkpoint_metadata(&self, account_id: i64) -> rusqlite::Result<()> {
        self.trusted_checkpoint_writes(|| {
            self.conn.execute(
                "DELETE FROM balance_version_contributions WHERE version_id IN (SELECT id FROM balance_reset_versions WHERE account_id = ?1)",
                params![account_id],
            )?;
            self.conn.execute(
                "UPDATE balance_resets SET current_version_id = NULL WHERE account_id = ?1",
                params![account_id],
            )?;
            self.conn
                .execute("DELETE FROM balance_reset_versions WHERE account_id = ?1", params![account_id])?;
            Ok(())
        })
    }
}

/// A transaction as a checkpoint counts it.
#[derive(Debug, Clone)]
pub(crate) struct IntervalRow {
    pub id: i64,
    pub account_id: i64,
    pub date: NaiveDate,
    pub amount: Decimal,
    pub principal: Option<Decimal>,
    pub revision: i64,
}

impl IntervalRow {
    /// The amount a balance counts: a loan payment's principal part when one is set, otherwise the amount.
    pub(crate) fn quantity(&self) -> Decimal {
        self.principal.unwrap_or(self.amount)
    }
}

// ---- backup before the first migration -------------------------------------------------------------------

/// What this open must have in hand before the schema changes: a verified copy of the database as it is now.
pub(super) fn ensure_pre_migration_backup(conn: &Connection, db_path: &Path, key: Option<&[u8; 32]>) -> rusqlite::Result<()> {
    let has_data: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%')",
        [],
        |r| r.get(0),
    )?;
    if !has_data {
        return Ok(()); // a new, empty database has nothing to lose
    }
    let marker_table: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'schema_features')", [], |r| {
        r.get(0)
    })?;
    if marker_table {
        let done: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM schema_features WHERE name = ?1)", params![FEATURE], |r| {
            r.get(0)
        })?;
        if done {
            return Ok(());
        }
    }
    let dir = pre_migration_dir(db_path, key.is_some());
    std::fs::create_dir_all(&dir).map_err(|e| backup_error(format!("the backup folder could not be created: {e}")))?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S-%3f");
    let staged = dir.join(format!(".pre-historical-moves-{}.staging", std::process::id()));
    let source_key = crate::protection::keyfile::key_file_path_for(db_path);
    let staged_key = crate::protection::keyfile::key_file_path_for(&staged);
    let mut finalized = dir.join(format!("pre-historical-moves-{stamp}.db"));
    let mut attempt = 1;
    while finalized.exists() || crate::protection::keyfile::key_file_path_for(&finalized).exists() {
        attempt += 1;
        finalized = dir.join(format!("pre-historical-moves-{stamp}-{attempt}.db"));
    }
    let _ = std::fs::remove_file(&staged);
    let _ = std::fs::remove_file(&staged_key);
    let final_key = crate::protection::keyfile::key_file_path_for(&finalized);
    let mut published_key = false;
    let made = (|| -> Result<(), String> {
        let mut dest = Connection::open(&staged).map_err(|e| e.to_string())?;
        if let Some(key) = key {
            dest.execute_batch(&super::encryption::key_pragma(key)).map_err(|e| e.to_string())?;
        }
        {
            let backup = rusqlite::backup::Backup::new(conn, &mut dest).map_err(|e| e.to_string())?;
            backup
                .run_to_completion(i32::MAX, std::time::Duration::ZERO, None)
                .map_err(|e| e.to_string())?;
        }
        verify_copy(conn, &dest)?;
        drop(dest);
        // A protected app profile needs both encrypted data and its wrapped-key metadata to recover.
        // Raw-key-only library callers may legitimately have no sidecar; never create plaintext keys.
        if key.is_some() && source_key.exists() {
            let metadata = crate::protection::keyfile::KeyFile::read(&source_key).map_err(|e| e.to_string())?;
            std::fs::copy(&source_key, &staged_key).map_err(|e| format!("the backup's key file could not be copied: {e}"))?;
            if crate::protection::keyfile::KeyFile::read(&staged_key).map_err(|e| e.to_string())? != metadata {
                return Err("the backup's key file did not match".into());
            }
            std::fs::OpenOptions::new()
                .write(true)
                .open(&staged_key)
                .and_then(|f| f.sync_all())
                .map_err(|e| e.to_string())?;
        }
        std::fs::OpenOptions::new()
            .write(true)
            .open(&staged)
            .and_then(|f| f.sync_all())
            .map_err(|e| format!("the backup could not be flushed to disk: {e}"))?;
        if finalized.exists() {
            return Err("a backup with that name already exists".to_string());
        }
        // Publish key first and database last, never overwriting a concurrent backup. An orphan key
        // is not a listed database and reserves its name on the next attempt.
        if staged_key.exists() {
            std::fs::hard_link(&staged_key, &final_key).map_err(|e| format!("the backup's key file could not be saved: {e}"))?;
            published_key = true;
        }
        std::fs::hard_link(&staged, &finalized).map_err(|e| format!("the backup could not be saved: {e}"))?;
        let _ = std::fs::remove_file(&staged);
        let _ = std::fs::remove_file(&staged_key);
        Ok(())
    })();
    if let Err(message) = made {
        let _ = std::fs::remove_file(&staged);
        let _ = std::fs::remove_file(&staged_key);
        if published_key {
            let _ = std::fs::remove_file(&final_key);
        }
        return Err(backup_error(message));
    }
    Ok(())
}

fn pre_migration_dir(db_path: &Path, encrypted: bool) -> PathBuf {
    let base = db_path.parent().map(|p| p.join("backups")).unwrap_or_else(|| PathBuf::from("backups"));
    if encrypted { base.join("protected") } else { base }
}

fn backup_error(message: String) -> rusqlite::Error {
    rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
        Some(format!(
            "Vault Spend could not make the safety copy it needs before upgrading this profile, so nothing was changed: {message}"
        )),
    )
}

fn verify_copy(source: &Connection, copy: &Connection) -> Result<(), String> {
    let check: String = copy.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err(format!("the copy failed its integrity check ({check})"));
    }
    for table in ["accounts", "transactions", "balance_resets"] {
        let exists: bool = source
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                params![table],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !exists {
            continue; // a profile from before this table existed
        }
        let count = |c: &Connection| c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get::<_, i64>(0));
        let (a, b) = (count(source).map_err(|e| e.to_string())?, count(copy).map_err(|e| e.to_string())?);
        if a != b {
            return Err(format!("the copy has {b} {table} rows but the profile has {a}"));
        }
    }
    let has_resets: bool = source
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'balance_resets')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if has_resets {
        let sum = |c: &Connection| {
            c.query_row(
                "SELECT COALESCE(group_concat(balance, '|'), '') FROM (SELECT balance FROM balance_resets ORDER BY id)",
                [],
                |r| r.get::<_, String>(0),
            )
        };
        if sum(source).map_err(|e| e.to_string())? != sum(copy).map_err(|e| e.to_string())? {
            return Err("the copy's saved balances differ".to_string());
        }
    }
    Ok(())
}
