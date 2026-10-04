use crate::models::{Account, Transaction};
use chrono::{Datelike, NaiveDate};
use rusqlite::{Connection, params};
use rust_decimal::Decimal;
use std::path::Path;
use std::str::FromStr;

mod encryption;
pub use self::encryption::{DatabaseKey, StoreOpenError, file_looks_encrypted};
mod comparison_setup;
mod comparison_snapshot;
mod sign_flip;
pub use self::sign_flip::{FlipSignsError, FlipSignsSummary};
mod profile_ui_state;
pub use self::comparison_setup::{ComparisonSetupError, StoredComparisonSetup};
pub use self::profile_ui_state::UiStateKey;
mod accounts;
pub use self::accounts::{AccountTransaction, ReconciliationStatus, SetupImportOutcome};
mod buckets;
pub use self::buckets::StoredBucket;
mod budgets;
pub use self::budgets::{
    BudgetActual, BudgetAlert, BudgetLine, BudgetSuggestion, BudgetSuggestions, CategoryTransaction, MemberBudgetActual, MonthReview, OverBudgetLine,
};
mod categories;
pub use self::categories::{CategoryCounts, ImportCategoryChoice, ImportCategoryError, StoredCategory, UnmatchedImportCategory, import_category_key};
mod family;
mod imports;
pub use self::imports::{ImportAccount, ImportBatch, ImportBatchError, ImportBatchOutcome, ImportBatchRow, RowCategory};
mod insights;
pub use self::insights::{AnomalyFlag, Insight, LargeExpense};
mod rules;
pub use self::rules::{RulePreview, StoredRule};
mod schema;
mod transactions;
pub use self::transactions::{AppliedDebtPayment, NOTES_MAX_CHARS, NotesError, SaveReport, StoredTransaction, TransactionSplit};
mod transfers;
pub use self::transfers::TransferCandidate;
mod recurring;
pub use self::recurring::{PriceChange, RecurringCandidate, RecurringMatch, RecurringTotals};
mod investments;
pub use self::investments::{AccountContributions, ContributionMonth, InvestmentPlan, PlanError, StoredHolding};
mod settings;
pub use self::settings::{BackgroundSettings, BillReminder, ReminderProjection, StoredLivePriceSettings};
mod assets;
pub use self::assets::StoredAsset;
mod forecast;
pub use self::forecast::{BillAwareForecast, DebtPayoffLine, DebtPayoffPlan, ForecastEvent, ForecastPoint};
mod reports;
pub use self::reports::{AccountContributionDelta, CategoryMonthAmount, DailySpendAmount, NetWorthBreakdown};

/// How a transaction's current category was decided — kept so a rule-guess
/// can later be told apart from something the user confirmed by hand.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CategorySource {
    Rule,
    User,
    Classifier,
}

impl CategorySource {
    pub fn as_str(self) -> &'static str {
        match self {
            CategorySource::Rule => "rule",
            CategorySource::User => "user",
            CategorySource::Classifier => "classifier",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "rule" => Some(CategorySource::Rule),
            "user" => Some(CategorySource::User),
            "classifier" => Some(CategorySource::Classifier),
            _ => None,
        }
    }
}

/// An account as it exists in the store, with the row id `save_transactions`
/// and `all_transactions` reference it by, plus its balance — computed by
/// `account_balance_as_of` from starting balance and transactions for
/// every account type, though what it *means* (and which direction a
/// transaction moves it) differs by type:
/// - Checking/savings/investment/other: `current_balance` is the literal
///   balance (a deposit is a positive transaction, a withdrawal negative).
/// - Credit: `starting_balance` is the credit limit, so owed starts at $0;
///   `current_balance` is available credit (a charge is negative and
///   reduces it, a payment is positive and restores it).
/// - Loan: `starting_balance` is the amount *currently owed* (not the
///   original principal), so the whole thing is debt from day one, same
///   as a fresh cash account's balance counts in full. `current_balance`
///   is what's still owed — a payment is a **positive** transaction and
///   reduces it, same sign convention as a credit payment; a negative
///   transaction represents new borrowing and increases what's owed. This
///   is the one account type where a transaction's sign is *subtracted*
///   rather than added — see `account_balance_as_of`.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredAccount {
    pub id: i64,
    pub account: Account,
    pub starting_balance: Decimal,
    pub current_balance: Decimal,
    pub institution: Option<String>,
    pub mask: Option<String>,
    /// Annual interest rate as a percentage (e.g. `24.99` for 24.99% APR) —
    /// only meaningful for credit/loan accounts, used by
    /// `Store::debt_payoff_projection`. `None` if never set.
    pub interest_rate: Option<Decimal>,
    /// Opts a debt account out of `debt_payoff_projection` without
    /// deleting it — e.g. a credit card the user pays off in full every
    /// month shouldn't be treated as debt to pay down.
    pub excluded_from_debt_payoff: bool,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    /// The most recent `balance_resets` checkpoint at or before "today"
    /// (see `latest_checkpoint`), if any — a transaction dated on or
    /// before this can't move `current_balance`, since a checkpoint's own
    /// value already accounts for everything through its date. `None`
    /// means every transaction ever recorded still counts toward
    /// `current_balance` (no rollover or manual correction has happened
    /// yet).
    pub checkpoint_date: Option<NaiveDate>,
    /// An explicit icon choice (one of the keys `accountIcons.tsx`'s picker
    /// offers, e.g. `"mortgage"`/`"crypto"`/`"joint-account"`) overriding the
    /// icon otherwise guessed from `account_type` — same convention as
    /// `StoredBucket::icon_key`. `None` means "keep guessing from the type."
    pub icon_key: Option<String>,
    /// The "Flip the signs" answer given the last time a file was imported
    /// into this account (`true` = flipped), so the next import can offer
    /// it again — some card exports show charges as positive. `None` until
    /// the first import. See `set_account_import_flip_signs`.
    pub import_flip_signs: Option<bool>,
}

/// SQL yielding the id of every transaction that is a leg of a *linked
/// transfer* (see `Store::link_transfer`) whose two legs are both still live.
///
/// A linked pair is money moving between the user's own accounts — neither
/// income nor spending, whatever category either leg carries — so every
/// spend/income-shaped query excludes these ids exactly as it excludes the
/// "Transfer" category. Requiring *both* legs to be live means deleting one
/// leg (and later undoing that) never leaves its orphaned partner silently
/// vanishing from totals: the surviving leg counts again until it's restored.
const LIVE_TRANSFER_LEG_IDS_SQL: &str = "SELECT l.out_transaction_id FROM transfer_links l
         JOIN transactions o ON o.id = l.out_transaction_id
         JOIN transactions i ON i.id = l.in_transaction_id
         WHERE o.deleted_at IS NULL AND i.deleted_at IS NULL
     UNION
     SELECT l.in_transaction_id FROM transfer_links l
         JOIN transactions o ON o.id = l.out_transaction_id
         JOIN transactions i ON i.id = l.in_transaction_id
         WHERE o.deleted_at IS NULL AND i.deleted_at IS NULL";

/// A recurring bill or income line — manually maintained, not detected
/// from transaction history (a real pattern-detection feature is a much
/// harder, fuzzier problem than this). `next_date` is computed fresh from
/// `anchor_date` + `cadence` relative to today every time this is read,
/// rather than stored — so it never goes stale the way a stored
/// "next date" would once its occurrence passes.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredRecurring {
    pub id: i64,
    pub merchant: String,
    pub category: Option<String>,
    pub amount: Decimal,
    pub cadence: String,
    pub anchor_date: NaiveDate,
    pub next_date: NaiveDate,
    pub account_id: Option<i64>,
    pub account_name: Option<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
    pub status: String,
}

/// Global per-profile feature toggles, shown as switches under Settings.
/// All default to *on* — this table only ever hides a feature that
/// otherwise already ships enabled, so an existing profile that's never
/// touched Settings sees no behavior change. `envelope_caps_enabled: false`
/// doesn't erase any category's stored `cap_enabled` flag (see
/// `Store::set_budget_cap`) — it just suspends that flag's effect on the
/// 90% threshold in `budget_alerts_for_month`, so re-enabling the feature
/// later restores exactly what was capped before. `rollover_enabled: false`
/// works the same way for unspent-budget rollover: each category's own
/// `budgets.rollover_enabled` choice is left alone, but no unspent amount is
/// carried into the next month (see `monthly_budget_actuals`).
/// `auto_link_transfers` is the one opt-IN switch here (off by default): when
/// on, clear-cut transfer pairs are linked without asking — see
/// `Store::auto_link_transfers`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StoredAppSettings {
    pub apply_to_debt_enabled: bool,
    pub split_purchases_enabled: bool,
    pub envelope_caps_enabled: bool,
    pub rollover_enabled: bool,
    pub auto_link_transfers: bool,
    pub safe_to_spend_enabled: bool,
}

/// The first day of `d`'s month.
fn first_of_month(d: NaiveDate) -> NaiveDate {
    NaiveDate::from_ymd_opt(d.year(), d.month(), 1).expect("day 1 exists in every month")
}

/// A household member a piece of data can be attributed to (see
/// `Store::create_family_member`) — deliberately just a name, no color or
/// login of its own; this is an attribution label, not an account.
#[derive(Debug, Clone, PartialEq)]
pub struct FamilyMember {
    pub id: i64,
    pub name: String,
}

/// Tables that have existed since this database's very first schema
/// version — present in literally every real Vault Spend/Penny
/// Worth/Pennywise/Meadow database ever created, unlike a table added by
/// a later migration a very old real file might predate (opening it
/// through `Store::open` would still add those transparently, same as any
/// other migration).
const CORE_TABLE_NAMES: [&str; 7] = [
    "accounts",
    "transactions",
    "budgets",
    "buckets",
    "recurring",
    "assets",
    "live_price_settings",
];

/// Checks whether `path` already looks like a genuine, previously-
/// initialized budgeting database, *without* opening it through
/// `Store::open` first — that constructor's migrations create any table
/// found missing, so by the time it returns successfully even a garbage,
/// corrupted, or completely unrelated (but validly-formed) SQLite file
/// would look identical to real data. This reads `sqlite_master` on the
/// file exactly as found on disk, before anything has a chance to "heal"
/// it, so a user importing the wrong file gets a clear rejection instead
/// of silently adopting an empty profile that looks fine until they
/// notice their data isn't there.
///
/// Deliberately not filename- or extension-based: this app's own database
/// filename has changed with every product rename (meadow.db ->
/// pennywise.db -> pennyworth.db -> vaultspend.db), and a future rename
/// will change it again, so "does this look right" has to come from the
/// file's actual structure, not what it's called.
pub fn looks_like_a_vault_spend_database(path: impl AsRef<Path>) -> Result<(), String> {
    let path = path.as_ref();
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("{} doesn't look like a valid SQLite database: {e}", path.display()))?;
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .map_err(|e| format!("{} doesn't look like a valid SQLite database: {e}", path.display()))?;
    let existing: std::collections::HashSet<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("{} doesn't look like a valid SQLite database: {e}", path.display()))?
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| format!("{} doesn't look like a valid SQLite database: {e}", path.display()))?;
    let missing: Vec<&str> = CORE_TABLE_NAMES.iter().filter(|t| !existing.contains(**t)).copied().collect();
    if !missing.is_empty() {
        return Err(format!(
            "{} doesn't look like a budgeting data file (missing table(s): {}).",
            path.display(),
            missing.join(", ")
        ));
    }
    Ok(())
}

pub struct Store {
    conn: Connection,
    /// Where to append a human-readable line for every account-affecting
    /// change (see `log_activity`) — `Some` only in a debug ("test") build
    /// with a real on-disk database, so a real release build shipped to a
    /// user never writes one. `None` for `open_in_memory` regardless of
    /// build type, since there's no sibling directory to put it in and no
    /// real user data to explain.
    activity_log_path: Option<std::path::PathBuf>,
    /// The raw database key when this store was opened encrypted. Zeroized when the store drops.
    db_key: Option<zeroize::Zeroizing<[u8; 32]>>,
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        let path = path.as_ref();
        let activity_log_path = if cfg!(debug_assertions) {
            path.parent().map(|dir| dir.join("account-changes.log"))
        } else {
            None
        };
        let store = Store {
            conn: Connection::open(path)?,
            activity_log_path,
            db_key: None,
        };
        store.init_schema()?;
        Ok(store)
    }

    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let store = Store {
            conn: Connection::open_in_memory()?,
            activity_log_path: None,
            db_key: None,
        };
        store.init_schema()?;
        Ok(store)
    }

    /// An account's name for a log line — never the reason a real
    /// operation fails, so a lookup miss (shouldn't happen; only called
    /// right after touching a row that references this very account)
    /// falls back to a placeholder instead of propagating an error.
    fn account_name_for_log(&self, account_id: i64) -> String {
        self.conn
            .query_row("SELECT name FROM accounts WHERE id = ?1", params![account_id], |row| row.get(0))
            .unwrap_or_else(|_| format!("account #{account_id}"))
    }

    /// "Today" for a log-only snapshot of an account's current balance (see
    /// `displayed_balance_for_log`) — the log already crosses a real
    /// wall-clock boundary deliberately for its own timestamp (see
    /// `log_activity`, and `chrono`'s `clock` feature being enabled just
    /// for this file); every date `core`'s actual business logic computes
    /// with still takes "today" as an explicit caller-supplied parameter.
    fn today_for_log(&self) -> NaiveDate {
        chrono::Local::now().date_naive()
    }

    /// One account's balance exactly as the user currently sees it on the
    /// Accounts page — "Owed" for a loan or credit account (a credit
    /// account's own `current_balance` tracks *available* credit, not what
    /// it owes; see `AccountCard` in `AccountsView.tsx`), otherwise the
    /// plain balance — as of today. Meant to be called once right before
    /// and once right after a mutation, so a log line can show the real
    /// before/after effect (see `describe_balance_snapshot`) instead of
    /// requiring the reader to already know an account type's sign
    /// convention. Never fails a real operation: `None` only if the
    /// account itself is gone (shouldn't happen — always called right
    /// before/after touching a row that references it).
    fn displayed_balance_for_log(&self, account_id: i64) -> Option<(&'static str, Decimal)> {
        let (account_type, starting_balance_str): (String, String) = self
            .conn
            .query_row(
                "SELECT account_type, starting_balance FROM accounts WHERE id = ?1",
                params![account_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok()?;
        let starting_balance = Decimal::from_str(&starting_balance_str).expect("balance stored by this crate must be valid");
        let current = self
            .account_balance_as_of(account_id, &account_type, starting_balance, self.today_for_log())
            .ok()?;
        Some(match account_type.as_str() {
            "loan" => ("owed", current),
            "credit" => ("owed", starting_balance - current),
            _ => ("balance", current),
        })
    }

    /// Formats a `displayed_balance_for_log` pair taken right before and
    /// right after a mutation as `"<label> <before> -> <after>"` — falling
    /// back to a plain note if either snapshot came back `None` (the
    /// account no longer exists), which should never happen in practice.
    fn describe_balance_snapshot(before: Option<(&'static str, Decimal)>, after: Option<(&'static str, Decimal)>) -> String {
        match (before, after) {
            (Some((label, b)), Some((_, a))) => format!("{label} {b} -> {a}"),
            _ => "balance unavailable".to_string(),
        }
    }

    /// Appends one timestamped line to the debug-only account-changes log
    /// (see `Store::open`) — a no-op with no path (release builds,
    /// `open_in_memory`). Never returns an error and never panics: a
    /// logging failure (disk full, permissions, the folder having been
    /// deleted out from under it) must never break the real mutation it's
    /// describing.
    fn log_activity(&self, message: &str) {
        let Some(path) = &self.activity_log_path else { return };
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let line = format!("[{timestamp}] {message}\n");
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = f.write_all(line.as_bytes());
        }
    }

    /// Copies this database to `dest_path` using SQLite's own online
    /// backup API — safe to call against a live connection (unlike a raw
    /// `fs::copy`, which risks copying a half-written page or missing a
    /// `-wal`/`-shm` sidecar file if the database is in WAL mode). Used by
    /// both the "move my data file" flow and automatic local backups.
    ///
    /// `pages_per_step` is `i32::MAX` — copy everything in one
    /// `sqlite3_backup_step` call — not the small, slowly-paced batches
    /// `run_to_completion`'s own example usage suggests. That pacing
    /// exists to let a *concurrent* writer on another connection get a
    /// turn between steps; this app has no such writer to yield to (every
    /// `Store` method, backups included, only ever runs from behind the
    /// one app-wide `AppStateHandle` mutex — see `commands.rs`), so it was
    /// pure overhead: 5 pages/step with a 50ms pause between steps cost
    /// roughly 10ms of sleep *per page*, measured taking over 20 seconds
    /// against a real 50,000-transaction database and — since every
    /// caller here holds that same mutex for the call's whole duration —
    /// blocking every other command in the app for that entire stretch,
    /// including the automatic backup this crate's own callers run
    /// synchronously before the app's very first window can open. A
    /// single step removes the pacing loop's sleeps entirely (the loop
    /// exits via `Done` on the first call, before `pause_between_pages` is
    /// ever reached — see `run_to_completion`'s own source), leaving only
    /// the real I/O cost, without changing anything about *what* gets
    /// copied or the destination file's correctness.
    pub fn backup_to(&self, dest_path: impl AsRef<Path>) -> rusqlite::Result<()> {
        let mut dest = Connection::open(dest_path)?;
        if let Some(key) = &self.db_key {
            dest.execute_batch(&encryption::key_pragma(key))?;
        }
        let backup = rusqlite::backup::Backup::new(&self.conn, &mut dest)?;
        backup.run_to_completion(i32::MAX, std::time::Duration::ZERO, None)?;
        Ok(())
    }
}

/// Same transaction imported twice into the same account (even from a
/// different file) should collapse to one row, so dedup is keyed on the
/// transaction's own content plus which account it's in — the same
/// content in a different account is a coincidence, not a duplicate.
fn fingerprint(account_id: i64, tx: &Transaction) -> String {
    format!("{}|{}|{}|{}", account_id, tx.date, tx.description.trim().to_lowercase(), tx.amount)
}

/// Normalizes a description for duplicate-detection comparison (see
/// `Store::anomaly_flags`): lowercased, internal whitespace collapsed to
/// single spaces, and a trailing run of digits (a common store/reference
/// number suffix that varies between otherwise-identical charges)
/// stripped along with any space before it.
fn normalize_description(s: &str) -> String {
    let lower = s.trim().to_lowercase();
    let collapsed = lower.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.trim_end_matches(|c: char| c.is_ascii_digit()).trim_end().to_string()
}

/// The next date on/after `today` that a recurring item lands on, given
/// its anchor date and cadence — computed fresh every call rather than
/// stored, so it never goes stale once an occurrence passes. An anchor
/// still in the future is itself the next occurrence.
fn next_occurrence(anchor: NaiveDate, cadence: &str, today: NaiveDate) -> NaiveDate {
    if anchor >= today {
        return anchor;
    }
    let mut next = anchor;
    match cadence {
        "weekly" => {
            while next < today {
                next += chrono::Duration::days(7);
            }
        }
        "biweekly" => {
            while next < today {
                next += chrono::Duration::days(14);
            }
        }
        "annual" => {
            while next < today {
                next = add_one_year(next);
            }
        }
        _ => {
            // "monthly", and the fallback for anything unrecognized
            while next < today {
                next = add_one_month(next);
            }
        }
    }
    next
}

/// The first day of `year`/`month` and the first day of the month after
/// it — an exclusive-upper-bound range (`date >= first AND date <
/// next_first`) that, unlike `substr(date, 1, 7) = ?`, SQLite can actually
/// use an index on `date` to satisfy.
fn month_bounds(year: i32, month: u32) -> (NaiveDate, NaiveDate) {
    let first = NaiveDate::from_ymd_opt(year, month, 1).expect("valid first-of-month");
    let next_first = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .expect("valid first-of-next-month");
    (first, next_first)
}

/// Adds one calendar month, clamping the day into the target month if it
/// doesn't have that many days (e.g. Jan 31 + 1 month -> Feb 28/29).
fn add_one_month(d: NaiveDate) -> NaiveDate {
    let (mut y, mut m) = (d.year(), d.month());
    m += 1;
    if m > 12 {
        m = 1;
        y += 1;
    }
    let day = d.day();
    (0u32..4)
        .find_map(|back| NaiveDate::from_ymd_opt(y, m, day - back))
        .expect("some valid day exists within 4 days of any day-of-month")
}

/// Adds one year, clamping Feb 29 -> Feb 28 in a non-leap target year.
fn add_one_year(d: NaiveDate) -> NaiveDate {
    let y = d.year() + 1;
    NaiveDate::from_ymd_opt(y, d.month(), d.day())
        .or_else(|| NaiveDate::from_ymd_opt(y, d.month(), d.day() - 1))
        .expect("Feb 29 -> Feb 28 fallback must exist")
}

#[cfg(test)]
mod tests;
