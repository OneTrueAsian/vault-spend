//! Moving transactions to another account after the fact (they were imported into the wrong one).
//!
//! One read-only `preview_account_move` computes the whole plan: which rows move, which are already in the
//! destination, what blocks the move, what to warn about and what each affected account's balance becomes. One
//! atomic `move_transactions_to_account` re-reads everything inside an immediate write transaction, refuses if
//! the plan the person reviewed (its token) is no longer the plan, and otherwise changes `account_id`,
//! `fingerprint` and `cleared` on exactly the rows that move. Nothing is ever skipped, merged or half applied:
//! one blocked row blocks the whole batch. The older one-row `update_transaction_account` goes through the same
//! checks, so no route moves a row the bulk path would refuse.
//!
//! A row dated on or before a saved balance (`balance_resets`) is moved in one of two ways. Where every affected
//! saved balance recorded what it counted (`checkpoints.rs`), they are corrected from that record
//! (`historical_move.rs`). Where one did not, the person confirms the balance each account has after the move and
//! a new dated anchor is saved for it; old saved balances are never rewritten from a guess.

mod commit;
mod plan;

use super::checkpoints::{CheckpointKind, add_amount, direction as historical_direction, parse_date, parse_decimal, sub_amount};
use super::historical_move;
use super::{Store, fingerprint, normalize_description};
use crate::models::Transaction;
use chrono::NaiveDate;
use rusqlite::{Connection, OptionalExtension, params};
use rust_decimal::Decimal;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::str::FromStr;

/// The most rows one move may name. Larger selections are refused with a message, never truncated.
pub const MAX_BULK_MOVE_IDS: usize = 10_000;
/// Ids per SQL statement; the whole move is still one transaction.
const SQL_CHUNK: usize = 400;
/// The largest id a JavaScript number holds exactly.
const MAX_SAFE_ID: i64 = 9_007_199_254_740_991;

#[derive(Debug)]
pub enum MoveError {
    NoSelection,
    TooMany {
        count: usize,
    },
    InvalidId,
    /// Ids that are not live transactions of this profile.
    UnknownTransactions {
        ids: Vec<i64>,
    },
    /// The destination is missing or hidden.
    InvalidDestination(String),
    /// The single-row entry point's refusal; the bulk path reports blockers inside the preview.
    Blocked(Vec<MoveBlocker>),
    /// A deliberate test failure (see `MoveFailpoint`).
    Injected(&'static str),
    /// The one-row entry point met a move that needs the review dialog (a saved balance has to be corrected or
    /// confirmed), and cannot supply the balances itself.
    ReviewRequired(String),
    /// The same operation id was used for a different request.
    OperationConflict,
    /// Saved balance records are damaged; confirming a balance cannot cover for that.
    Integrity(String),
    /// A balance the person entered cannot be used.
    InvalidBalance(String),
    Db(rusqlite::Error),
}

impl From<rusqlite::Error> for MoveError {
    fn from(e: rusqlite::Error) -> Self {
        MoveError::Db(e)
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

impl std::fmt::Display for MoveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MoveError::NoSelection => write!(f, "Choose at least one transaction to move."),
            MoveError::TooMany { count } => write!(
                f,
                "You selected {count} transactions. You can move up to {MAX_BULK_MOVE_IDS} at a time; nothing was moved."
            ),
            MoveError::InvalidId => write!(f, "One of the selected transactions is not valid; nothing was moved."),
            MoveError::UnknownTransactions { ids } => write!(
                f,
                "{} no longer exist or were deleted, so nothing was moved. Reload the list and choose again.",
                plural(ids.len(), "selected transaction", "selected transactions")
            ),
            MoveError::InvalidDestination(message) => write!(f, "{message}"),
            MoveError::Blocked(blockers) => {
                let parts: Vec<String> = blockers.iter().map(|b| b.summary.clone()).collect();
                write!(f, "Nothing was moved. {}", parts.join(" "))
            }
            MoveError::ReviewRequired(why) => write!(f, "{why}"),
            MoveError::OperationConflict => write!(f, "That request was already used for a different move. Review the move again."),
            MoveError::Integrity(why) => write!(
                f,
                "Nothing was moved because the saved balances for this account look damaged ({why}). Restore a backup or contact support; confirming a balance can't fix this."
            ),
            MoveError::InvalidBalance(why) => write!(f, "{why}"),
            MoveError::Injected(what) => write!(f, "The move was stopped on purpose ({what}); nothing was changed."),
            // The database's own wording is for the log, not for a person; nothing was changed when this is shown.
            MoveError::Db(_) => write!(
                f,
                "The move could not be completed, so nothing was changed. Try again, and if it keeps happening restart the app."
            ),
        }
    }
}

impl std::error::Error for MoveError {}

/// A group of rows that cannot move for the same reason.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoveBlocker {
    pub code: &'static str,
    pub count: usize,
    pub summary: String,
    pub items: Vec<BlockedItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlockedItem {
    pub transaction_id: i64,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoveWarning {
    pub code: &'static str,
    pub count: usize,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MoveRow {
    pub id: i64,
    pub date: String,
    pub description: String,
    pub amount: String,
    pub account_id: i64,
    pub account_name: String,
    /// "move", "blocked" or "already_there".
    pub status: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub account_id: i64,
    pub account_name: String,
    pub count: usize,
}

/// What one account looks like before and after the move, in the terms the app shows for it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountEffect {
    pub account_id: i64,
    pub account_name: String,
    pub account_type: String,
    /// "source" or "destination".
    pub role: &'static str,
    pub moved_count: usize,
    /// "Balance", "Owed" (credit and loan) or "Holdings value" (an investment account that tracks holdings).
    pub label: &'static str,
    pub current: String,
    pub projected: String,
    /// A card's available credit, which moves opposite to what is owed. Credit accounts only.
    pub available_current: Option<String>,
    pub available_projected: Option<String>,
    /// The change the moved rows make to the account's transaction-derived balance (today and earlier rows).
    pub transaction_change: String,
    /// True when holdings, not transactions, set the displayed value, so it stays as it is.
    pub holdings_override: bool,
    /// False while the balance after the move still has to be confirmed: `projected` then only repeats `current`.
    pub projected_is_final: bool,
}

/// One balance the person has to give (or keep) before a historical move can go ahead.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmationAccount {
    pub account_id: i64,
    pub account_name: String,
    pub account_type: String,
    /// "Balance" or "Amount owed".
    pub input_label: &'static str,
    /// The balance the app shows now, in the same terms as the input. A reference, never a preselected answer.
    pub current_display: String,
    pub credit_limit: Option<String>,
    pub available_credit: Option<String>,
    pub reasons: Vec<String>,
    /// What the person gave, canonical, once they have.
    pub confirmed_display: Option<String>,
    /// "set" or "keep" once chosen.
    pub choice: Option<&'static str>,
    /// The saved starting point that would be recorded (raw ledger terms), once a balance is given.
    pub projected_baseline: Option<String>,
    pub problem: Option<String>,
}

/// A balance as the person supplied it.
#[derive(Debug, Clone, PartialEq)]
pub struct BalanceInput {
    pub account_id: i64,
    /// True for "keep this displayed balance"; `value` is then ignored.
    pub keep: bool,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointEffects {
    pub corrected_count: usize,
    pub first_date: Option<String>,
    pub last_date: Option<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MovePreview {
    pub destination_account_id: i64,
    pub destination_name: String,
    pub as_of: String,
    pub selected_count: usize,
    pub effective_count: usize,
    pub already_there_count: usize,
    pub normalized_ids: Vec<i64>,
    pub sources: Vec<SourceSummary>,
    pub first_date: Option<String>,
    pub last_date: Option<String>,
    /// The signed sum of the rows that move, exactly as stored. Not a bank-transfer amount.
    pub total: String,
    pub rows: Vec<MoveRow>,
    pub effects: Vec<AccountEffect>,
    pub warnings: Vec<MoveWarning>,
    pub blockers: Vec<MoveBlocker>,
    pub can_commit: bool,
    /// "ready", "needs_balance_confirmation" or "blocked".
    pub status: &'static str,
    /// "automatic" (saved balances are corrected from their record) or "confirmation" (the person confirms them).
    pub mode: &'static str,
    pub confirmations: Vec<ConfirmationAccount>,
    pub checkpoint_effects: CheckpointEffects,
    /// What the affected accounts add up to (assets minus what is owed), before and after.
    pub net_before: String,
    pub net_after: String,
    /// Binds this exact plan (see `plan_token`). Opaque to callers.
    pub token: String,
}

/// An earlier move as its audit record keeps it: what moved, how the balances were settled and how they changed.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountMoveRecord {
    pub operation_id: String,
    pub mode: &'static str,
    pub effective_date: String,
    pub destination_account_id: i64,
    pub destination_name: String,
    pub moved_count: usize,
    pub moved_ids: Vec<i64>,
    pub affected_account_ids: Vec<i64>,
    pub confirmed_account_ids: Vec<i64>,
    pub corrected_checkpoints: usize,
    /// Per account: name, role, displayed and ledger balances before and after.
    pub accounts: serde_json::Value,
    /// The balances the person confirmed, when they did.
    pub inputs: serde_json::Value,
    /// How many saved balances were corrected or created.
    pub corrections: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MoveSummary {
    pub moved_ids: Vec<i64>,
    pub already_there_ids: Vec<i64>,
    pub affected_account_ids: Vec<i64>,
    pub mode: &'static str,
    pub operation_id: Option<String>,
    /// True when this answer was read back from an earlier identical request instead of being applied again.
    pub replayed: bool,
    pub corrected_checkpoints: usize,
    pub confirmed_account_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MoveOutcome {
    Moved(MoveSummary),
    /// Every selected row was already in the destination; nothing was written.
    NothingToMove(MoveSummary),
    /// The plan changed since it was reviewed; nothing was written.
    StalePreview,
    /// A blocker now applies; nothing was written.
    Blocked(Vec<MoveBlocker>),
    /// The operation id was used before for different input; nothing was written.
    OperationConflict,
}

/// Where a test makes the move fail, to prove nothing is left half done.
#[doc(hidden)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MoveFailpoint {
    /// After the Nth row (1-based) has been updated.
    AfterUpdate(usize),
    AfterReviewCleanup,
    AfterReadback,
    /// After the Nth corrected saved balance (1-based) across all accounts.
    AfterCorrection(usize),
    /// After the Nth confirmed-balance anchor (1-based).
    AfterAnchor(usize),
    AfterAudit,
    /// The whole process dies (an abort, as a power cut or a kill would) just before COMMIT. Tests only.
    #[cfg(test)]
    CrashBeforeCommit,
    /// The whole process dies right after COMMIT, before any reply could be sent. Tests only.
    #[cfg(test)]
    CrashAfterCommit,
}

struct LoadedRow {
    id: i64,
    account_id: i64,
    date: NaiveDate,
    date_text: String,
    description: String,
    amount: Decimal,
    amount_text: String,
    principal: Option<Decimal>,
    reconciliation_id: Option<i64>,
    cleared: bool,
    member_id: Option<i64>,
    revision: i64,
}

struct AccountInfo {
    name: String,
    account_type: String,
    hidden: bool,
    member_id: Option<i64>,
    import_flip_signs: Option<bool>,
    starting_balance: Decimal,
}

/// One confirmed balance, as it will be saved.
struct AnchorPlan {
    account_id: i64,
    /// What the account's balance is after the move, in the ledger's terms (a card's available credit).
    confirmed_raw: Decimal,
    /// The saved starting point that gives `confirmed_raw` today: the confirmed balance less today's activity.
    baseline: Decimal,
}

/// A reviewed move, as the commit receives it.
pub struct MoveRequest<'a> {
    pub ids: &'a [i64],
    pub destination: i64,
    pub expected_token: &'a str,
    pub today: NaiveDate,
    /// Identifies this request, so a retry after a lost reply returns the first answer instead of moving twice.
    pub operation_id: &'a str,
    pub balances: &'a [BalanceInput],
}

struct Plan {
    preview: MovePreview,
    /// The rows that move, with the fingerprint each gets.
    effective: Vec<(LoadedRow, String)>,
    already_there_ids: Vec<i64>,
    /// The ledger balance each affected account has after the move (the confirmed one in confirmation mode).
    projected_raw: BTreeMap<i64, Decimal>,
    /// The ledger balance each affected account has now.
    current_raw: BTreeMap<i64, Decimal>,
    mode: &'static str,
    account_plans: Vec<historical_move::AccountPlan>,
    anchors: Vec<AnchorPlan>,
    corrected_count: usize,
    holdings_before: std::collections::HashMap<i64, Decimal>,
}

/// An RAII write transaction that begins `IMMEDIATE`: the write lock is taken before anything is read, so a
/// second connection cannot change the data between validation and the writes.
struct WriteTx<'a> {
    conn: &'a Connection,
    open: bool,
}

impl<'a> WriteTx<'a> {
    fn begin(conn: &'a Connection) -> rusqlite::Result<Self> {
        conn.execute_batch("BEGIN IMMEDIATE")?;
        Ok(WriteTx { conn, open: true })
    }
    fn commit(mut self) -> rusqlite::Result<()> {
        self.conn.execute_batch("COMMIT")?;
        self.open = false;
        Ok(())
    }
}

impl Drop for WriteTx<'_> {
    fn drop(&mut self) {
        if self.open {
            let _ = self.conn.execute_batch("ROLLBACK");
        }
    }
}

/// "Oct 1, 2026", the way a person reads a date; anything that is not a stored date is left as it is.
fn pretty_date(iso: &str) -> String {
    NaiveDate::parse_from_str(iso, "%Y-%m-%d")
        .map(|d| d.format("%b %-d, %Y").to_string())
        .unwrap_or_else(|_| iso.to_string())
}

/// Sorted, de-duplicated ids, or the reason they are not acceptable.
pub fn normalize_move_ids(ids: &[i64]) -> Result<Vec<i64>, MoveError> {
    if ids.is_empty() {
        return Err(MoveError::NoSelection);
    }
    if ids.iter().any(|&id| id <= 0 || id > MAX_SAFE_ID) {
        return Err(MoveError::InvalidId);
    }
    let unique: BTreeSet<i64> = ids.iter().copied().collect();
    if unique.len() > MAX_BULK_MOVE_IDS {
        return Err(MoveError::TooMany { count: unique.len() });
    }
    Ok(unique.into_iter().collect())
}

fn placeholders(n: usize) -> String {
    vec!["?"; n].join(",")
}

impl Store {
    /// What moving `ids` to `destination` would do, computed without writing anything.
    pub fn preview_account_move(&self, ids: &[i64], destination: i64, today: NaiveDate) -> Result<MovePreview, MoveError> {
        self.preview_account_move_with(ids, destination, today, &[])
    }

    /// As `preview_account_move`, with the balances the person has entered (or chosen to keep) for a move that
    /// needs them. Still read-only.
    pub fn preview_account_move_with(
        &self,
        ids: &[i64],
        destination: i64,
        today: NaiveDate,
        inputs: &[BalanceInput],
    ) -> Result<MovePreview, MoveError> {
        let ids = normalize_move_ids(ids)?;
        let plan = self.read_snapshot(|store| Ok(store.build_plan(&ids, destination, today, inputs)))?;
        Ok(plan?.preview)
    }

    /// Moves `ids` to `destination` in one transaction, provided the plan still matches `expected_token`.
    pub fn move_transactions_to_account(
        &self,
        ids: &[i64],
        destination: i64,
        expected_token: &str,
        today: NaiveDate,
    ) -> Result<MoveOutcome, MoveError> {
        let operation_id = auto_operation_id(ids, destination, expected_token);
        self.commit_move(ids, destination, Some(expected_token), today, Some((&operation_id, &[])), None)
    }

    /// The reviewed move: the operation id makes a retry after a lost reply return the first result.
    pub fn commit_account_move(&self, request: &MoveRequest<'_>) -> Result<MoveOutcome, MoveError> {
        self.commit_move(
            request.ids,
            request.destination,
            Some(request.expected_token),
            request.today,
            Some((request.operation_id, request.balances)),
            None,
        )
    }

    /// As `commit_account_move`, failing on purpose at `failpoint` (tests only).
    #[doc(hidden)]
    pub fn commit_account_move_with_failpoint(&self, request: &MoveRequest<'_>, failpoint: MoveFailpoint) -> Result<MoveOutcome, MoveError> {
        self.commit_move(
            request.ids,
            request.destination,
            Some(request.expected_token),
            request.today,
            Some((request.operation_id, request.balances)),
            Some(failpoint),
        )
    }

    /// As `move_transactions_to_account`, failing on purpose at `failpoint` (tests only).
    #[doc(hidden)]
    pub fn move_transactions_with_failpoint(
        &self,
        ids: &[i64],
        destination: i64,
        expected_token: &str,
        today: NaiveDate,
        failpoint: MoveFailpoint,
    ) -> Result<MoveOutcome, MoveError> {
        let operation_id = auto_operation_id(ids, destination, expected_token);
        self.commit_move(ids, destination, Some(expected_token), today, Some((&operation_id, &[])), Some(failpoint))
    }

    /// Moves one transaction to another account after the fact. This is the older one-row entry point; it
    /// applies the same checks as the bulk move, so nothing can move a row through here that the bulk move
    /// would refuse. It cannot take the balances a historical move needs, so a move that needs a saved balance
    /// corrected or confirmed is sent back to the review. An unknown id, or a row already in that account, is a
    /// harmless no-op.
    pub fn update_transaction_account(&self, id: i64, account_id: i64) -> Result<(), MoveError> {
        let today = self.today_for_log();
        let ids = normalize_move_ids(&[id])?;
        let exists: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM transactions WHERE id = ?1 AND deleted_at IS NULL)",
            params![ids[0]],
            |r| r.get(0),
        )?;
        if !exists {
            return Ok(());
        }
        match self.commit_move(&ids, account_id, None, today, None, None)? {
            MoveOutcome::Moved(_) | MoveOutcome::NothingToMove(_) => Ok(()),
            MoveOutcome::Blocked(blockers) => Err(MoveError::Blocked(blockers)),
            MoveOutcome::StalePreview | MoveOutcome::OperationConflict => unreachable!("no token or operation id was given to compare"),
        }
    }
}

/// A fingerprint of the plan: everything the preview shows and the rows' current state that decides it.
fn plan_token(preview: &MovePreview, effective: &[&LoadedRow], state: &str) -> String {
    let mut shown = preview.clone();
    shown.token.clear();
    let mut hasher = Sha256::new();
    hasher.update(serde_json::to_string(&shown).expect("a preview is plain data").as_bytes());
    // State the preview does not print but the move depends on.
    for r in effective {
        hasher.update(
            format!(
                "|{}:{}:{:?}:{}:{:?}:{}",
                r.id, r.account_id, r.reconciliation_id, r.cleared, r.principal, r.revision
            )
            .as_bytes(),
        );
    }
    hasher.update(state.as_bytes());
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// The balance the person typed, in the terms the app shows it ("Balance" or "Amount owed"): plain digits, an
/// optional leading minus and up to two decimals. Anything else is refused rather than rounded or guessed.
fn parse_confirmed(account_type: &str, text: &str) -> Result<Decimal, String> {
    let t = text.trim();
    if t.is_empty() {
        return Err("Enter the balance, or choose to keep the one shown.".to_string());
    }
    let (negative, digits) = match t.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, t),
    };
    let (whole, fraction) = match digits.split_once('.') {
        Some((w, f)) => (w, f),
        None => (digits, ""),
    };
    let plain = |s: &str| s.chars().all(|c| c.is_ascii_digit());
    if whole.is_empty() || !plain(whole) || !plain(fraction) || digits.matches('.').count() > 1 {
        return Err("Use only digits and one decimal point, like 1250.40.".to_string());
    }
    if fraction.len() > 2 {
        return Err("Use at most two decimal places.".to_string());
    }
    if whole.len() > 12 {
        return Err("That amount is too large.".to_string());
    }
    let value = Decimal::from_str(digits).map_err(|_| "That is not a number the app can use.".to_string())?;
    let value = if negative { -value } else { value };
    if account_type == "loan" && value.is_sign_negative() && !value.is_zero() {
        return Err("An amount owed on a loan can't be negative.".to_string());
    }
    Ok(value)
}

/// Everything a retry must reproduce, so the same operation id with different input is caught.
fn request_digest(ids: &[i64], destination: i64, token: Option<&str>, today: NaiveDate, inputs: &[BalanceInput]) -> String {
    let mut sorted: Vec<&BalanceInput> = inputs.iter().collect();
    sorted.sort_by_key(|i| i.account_id);
    let mut hasher = Sha256::new();
    hasher.update(format!("v2|{ids:?}|{destination}|{}|{today}", token.unwrap_or("")).as_bytes());
    for i in sorted {
        hasher.update(format!("|{}:{}:{}", i.account_id, i.keep, i.value.as_deref().unwrap_or("").trim()).as_bytes());
    }
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// An id for a move that was not given one (the older entry points): stable for the same request.
fn auto_operation_id(ids: &[i64], destination: i64, token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("auto|{ids:?}|{destination}|{token}|{:?}", std::time::SystemTime::now()).as_bytes());
    let hex: String = hasher.finalize().iter().take(12).map(|b| format!("{b:02x}")).collect();
    format!("auto-{hex}")
}
