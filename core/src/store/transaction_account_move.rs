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

    fn commit_move(
        &self,
        ids: &[i64],
        destination: i64,
        expected_token: Option<&str>,
        today: NaiveDate,
        operation: Option<(&str, &[BalanceInput])>,
        failpoint: Option<MoveFailpoint>,
    ) -> Result<MoveOutcome, MoveError> {
        let ids = normalize_move_ids(ids)?;
        let inputs: &[BalanceInput] = operation.map(|o| o.1).unwrap_or(&[]);
        if let Some((operation_id, _)) = operation
            && (operation_id.is_empty()
                || operation_id.len() > 80
                || !operation_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        {
            return Err(MoveError::InvalidBalance(
                "That request has no valid identity. Review the move again.".to_string(),
            ));
        }
        let write = WriteTx::begin(&self.conn)?;

        // A retry of a request that already committed gets the first answer back, whatever the data is now.
        let digest = request_digest(&ids, destination, expected_token, today, inputs);
        if let Some((operation_id, _)) = operation {
            let earlier: Option<(String, String)> = self
                .conn
                .query_row(
                    "SELECT request_digest, result_json FROM account_move_operations WHERE operation_id = ?1",
                    params![operation_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if let Some((stored, result)) = earlier {
                if stored != digest {
                    return Ok(MoveOutcome::OperationConflict);
                }
                let value: serde_json::Value =
                    serde_json::from_str(&result).map_err(|_| MoveError::Integrity("a saved move result is unreadable".into()))?;
                let list = |key: &str| -> Vec<i64> {
                    value[key]
                        .as_array()
                        .map(|a| a.iter().filter_map(|v| v.as_i64()).collect())
                        .unwrap_or_default()
                };
                return Ok(MoveOutcome::Moved(MoveSummary {
                    moved_ids: list("movedIds"),
                    already_there_ids: list("alreadyThereIds"),
                    affected_account_ids: list("affectedAccountIds"),
                    mode: if value["mode"] == "confirmation" { "confirmation" } else { "automatic" },
                    operation_id: Some(operation_id.to_string()),
                    replayed: true,
                    corrected_checkpoints: value["correctedCheckpoints"].as_u64().unwrap_or(0) as usize,
                    confirmed_account_ids: list("confirmedAccountIds"),
                }));
            }
        }

        let plan = self.build_plan(&ids, destination, today, inputs)?;
        if let Some(expected) = expected_token
            && plan.preview.token != expected
        {
            return Ok(MoveOutcome::StalePreview);
        }
        if !plan.preview.blockers.is_empty() {
            return Ok(MoveOutcome::Blocked(plan.preview.blockers));
        }
        if plan.effective.is_empty() {
            return Ok(MoveOutcome::NothingToMove(MoveSummary {
                moved_ids: Vec::new(),
                already_there_ids: plan.already_there_ids,
                affected_account_ids: Vec::new(),
                mode: "automatic",
                operation_id: None,
                replayed: false,
                corrected_checkpoints: 0,
                confirmed_account_ids: Vec::new(),
            }));
        }
        if expected_token.is_none() && (plan.mode == "confirmation" || plan.corrected_count > 0) {
            return Err(MoveError::ReviewRequired(
                "These transactions are dated before a saved balance, so the move needs the review that corrects or confirms it. Use Move to account.".to_string(),
            ));
        }
        if !plan.preview.can_commit {
            return Err(MoveError::InvalidBalance(
                "Confirm a balance for every account in this move first.".to_string(),
            ));
        }

        let fail = |point: MoveFailpoint, what: &'static str| -> Result<(), MoveError> {
            if failpoint == Some(point) {
                Err(MoveError::Injected(what))
            } else {
                Ok(())
            }
        };
        let operation_id: String = operation
            .map(|o| o.0.to_string())
            .unwrap_or_else(|| auto_operation_id(&ids, destination, expected_token.unwrap_or("")));
        let revision_before: i64 = self
            .conn
            .query_row("SELECT value FROM financial_revision_counter WHERE id = 1", [], |r| r.get(0))?;

        {
            let mut update = self.conn.prepare(
                "UPDATE transactions SET account_id = ?1, fingerprint = ?2, cleared = 0
                 WHERE id = ?3 AND account_id = ?4 AND deleted_at IS NULL AND reconciliation_id IS NULL",
            )?;
            for (n, (row, fp)) in plan.effective.iter().enumerate() {
                let changed = update.execute(params![destination, fp, row.id, row.account_id])?;
                if changed != 1 {
                    return Err(MoveError::Db(rusqlite::Error::StatementChangedRows(changed)));
                }
                fail(MoveFailpoint::AfterUpdate(n + 1), "after a row was updated")?;
            }
        }

        // Saved balances: corrected from their record, or a confirmed anchor for each account.
        let mut corrections_json: Vec<serde_json::Value> = Vec::new();
        let mut corrected = 0usize;
        let mut confirmed_ids: Vec<i64> = Vec::new();
        if plan.mode == "automatic" {
            for account_plan in plan.account_plans.iter().filter(|p| !p.changes.is_empty()) {
                let info = self.account_info(account_plan.account_id)?;
                let done = self.apply_node_changes(
                    account_plan.account_id,
                    &info.account_type,
                    &account_plan.changes,
                    &operation_id,
                    &mut |_| {
                        corrected += 1;
                        fail(MoveFailpoint::AfterCorrection(corrected), "after a saved balance was corrected")
                    },
                )?;
                for (reset_id, old_version, new_version, old_balance, new_balance) in done {
                    corrections_json.push(serde_json::json!({
                        "accountId": account_plan.account_id, "resetId": reset_id, "oldVersionId": old_version, "newVersionId": new_version,
                        "oldBalance": old_balance.to_string(), "newBalance": new_balance.to_string(),
                    }));
                }
            }
        } else {
            let cutoff = today
                .pred_opt()
                .ok_or_else(|| MoveError::InvalidBalance("That date can't be used.".to_string()))?;
            for (n, anchor) in plan.anchors.iter().enumerate() {
                let info = self.account_info(anchor.account_id)?;
                let dir = historical_direction(&info.account_type);
                let live_today = self.live_quantity_on(anchor.account_id, today)?;
                let baseline = anchor
                    .confirmed_raw
                    .checked_sub(dir * live_today)
                    .ok_or_else(|| MoveError::InvalidBalance("That amount is too large to save.".to_string()))?;
                if baseline != anchor.baseline {
                    return Err(MoveError::Integrity(
                        "the confirmed balance no longer matches today's activity".to_string(),
                    ));
                }
                let period = format!("move:{operation_id}:{}", anchor.account_id);
                let reset_id = self.record_anchor(super::checkpoints::AnchorSpec {
                    account_id: anchor.account_id,
                    period: &period,
                    cutoff,
                    effective: today,
                    balance: baseline,
                    kind: CheckpointKind::MoveConfirmation,
                    operation_id: Some(&operation_id),
                })?;
                confirmed_ids.push(anchor.account_id);
                corrections_json.push(serde_json::json!({
                    "accountId": anchor.account_id, "resetId": reset_id, "anchor": true, "baseline": baseline.to_string(), "confirmedRaw": anchor.confirmed_raw.to_string(),
                }));
                fail(MoveFailpoint::AfterAnchor(n + 1), "after a confirmed balance was saved")?;
            }
        }

        self.clear_account_dependent_review_state(&plan.effective, destination)?;
        fail(MoveFailpoint::AfterReviewCleanup, "after the review decisions were cleared")?;

        // Read the result back with the same balance rules the app uses; a mismatch rolls everything back.
        for (account_id, projected) in &plan.projected_raw {
            let info = self.account_info(*account_id)?;
            let actual = self.account_balance_as_of(*account_id, &info.account_type, info.starting_balance, today)?;
            if actual != *projected {
                return Err(MoveError::Db(rusqlite::Error::ToSqlConversionFailure(
                    format!("account {account_id} balance would be {actual}, expected {projected}").into(),
                )));
            }
        }
        if self.holdings_value_by_account()? != plan.holdings_before {
            return Err(MoveError::Db(rusqlite::Error::ToSqlConversionFailure(
                "an account's holdings value changed".into(),
            )));
        }
        let moved_ids: Vec<i64> = plan.effective.iter().map(|(r, _)| r.id).collect();
        let still_there: i64 = {
            let mut count = 0i64;
            for chunk in moved_ids.chunks(SQL_CHUNK) {
                let sql = format!(
                    "SELECT COUNT(*) FROM transactions WHERE account_id = ? AND id IN ({})",
                    placeholders(chunk.len())
                );
                let mut args: Vec<i64> = vec![destination];
                args.extend(chunk);
                count += self.conn.query_row(&sql, rusqlite::params_from_iter(args), |r| r.get::<_, i64>(0))?;
            }
            count
        };
        if still_there != moved_ids.len() as i64 {
            return Err(MoveError::Db(rusqlite::Error::ToSqlConversionFailure(
                "moved rows are not all in the destination".into(),
            )));
        }
        // Only the moved rows may have changed financially.
        let changed_rows: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM transactions WHERE financial_revision > ?1",
            params![revision_before],
            |r| r.get(0),
        )?;
        if changed_rows != moved_ids.len() as i64 {
            return Err(MoveError::Db(rusqlite::Error::ToSqlConversionFailure(
                "a transaction that was not moved changed".into(),
            )));
        }
        fail(MoveFailpoint::AfterReadback, "after the result was checked")?;

        // The audit record and the retry answer are written with everything else, or not at all.
        let mut affected: BTreeSet<i64> = plan.effective.iter().map(|(r, _)| r.account_id).collect();
        affected.insert(destination);
        let after_rows: Vec<serde_json::Value> = moved_ids
            .iter()
            .map(|id| {
                self.conn
                    .query_row(
                        "SELECT account_id, financial_revision, fingerprint, cleared FROM transactions WHERE id = ?1",
                        params![id],
                        |r| Ok(serde_json::json!({ "id": id, "accountId": r.get::<_, i64>(0)?, "revision": r.get::<_, i64>(1)?, "fingerprint": r.get::<_, String>(2)?, "cleared": r.get::<_, bool>(3)? })),
                    )
                    .map_err(MoveError::from)
            })
            .collect::<Result<_, _>>()?;
        let before_rows: Vec<serde_json::Value> = plan
            .effective
            .iter()
            .map(|(r, _)| serde_json::json!({ "id": r.id, "accountId": r.account_id, "date": r.date_text, "amount": r.amount_text, "revision": r.revision, "cleared": r.cleared }))
            .collect();
        let account_effects: Vec<serde_json::Value> = plan
            .preview
            .effects
            .iter()
            .map(|e| serde_json::json!({
                "accountId": e.account_id, "name": e.account_name, "role": e.role, "label": e.label,
                "displayedBefore": e.current, "displayedAfter": e.projected,
                "rawBefore": plan.current_raw.get(&e.account_id).map(|v| v.to_string()), "rawAfter": plan.projected_raw.get(&e.account_id).map(|v| v.to_string()),
            }))
            .collect();
        let inputs_json: Vec<serde_json::Value> = plan
            .preview
            .confirmations
            .iter()
            .map(|c| serde_json::json!({ "accountId": c.account_id, "choice": c.choice, "confirmed": c.confirmed_display, "baseline": c.projected_baseline }))
            .collect();
        let result = serde_json::json!({
            "movedIds": moved_ids, "alreadyThereIds": plan.already_there_ids, "affectedAccountIds": affected.iter().collect::<Vec<_>>(),
            "mode": plan.mode, "correctedCheckpoints": corrected, "confirmedAccountIds": confirmed_ids,
        });
        self.conn.execute(
            "INSERT INTO account_move_operations (operation_id, request_digest, contract_version, algorithm_version, mode, effective_date, destination_account_id,
                 moved_count, inputs_json, before_json, after_json, corrections_json, result_json)
             VALUES (?1, ?2, 2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                operation_id,
                digest,
                super::checkpoints::ALGORITHM_VERSION,
                plan.mode,
                today.to_string(),
                destination,
                moved_ids.len() as i64,
                serde_json::Value::Array(inputs_json).to_string(),
                serde_json::json!({ "rows": before_rows, "accounts": account_effects }).to_string(),
                serde_json::json!({ "rows": after_rows }).to_string(),
                serde_json::Value::Array(corrections_json).to_string(),
                result.to_string(),
            ],
        )?;
        fail(MoveFailpoint::AfterAudit, "after the move was recorded")?;
        #[cfg(test)]
        if failpoint == Some(MoveFailpoint::CrashBeforeCommit) {
            std::process::abort();
        }
        write.commit()?;
        #[cfg(test)]
        if failpoint == Some(MoveFailpoint::CrashAfterCommit) {
            std::process::abort();
        }

        let mut by_source: BTreeMap<i64, usize> = BTreeMap::new();
        for (row, _) in &plan.effective {
            *by_source.entry(row.account_id).or_insert(0) += 1;
        }
        let source_names: Vec<String> = by_source
            .iter()
            .map(|(id, n)| format!("{} ({n})", self.account_name_for_log(*id)))
            .collect();
        self.log_activity(&format!(
            "moved {} transaction{} to {} from {}; {} already there",
            moved_ids.len(),
            if moved_ids.len() == 1 { "" } else { "s" },
            self.account_name_for_log(destination),
            source_names.join(", "),
            plan.already_there_ids.len()
        ));
        Ok(MoveOutcome::Moved(MoveSummary {
            moved_ids,
            already_there_ids: plan.already_there_ids,
            affected_account_ids: affected.into_iter().collect(),
            mode: plan.mode,
            operation_id: Some(operation_id),
            replayed: false,
            corrected_checkpoints: corrected,
            confirmed_account_ids: confirmed_ids,
        }))
    }

    /// One earlier move, read back from its audit record (see `list_account_moves`).
    pub fn get_account_move(&self, operation_id: &str) -> Result<Option<AccountMoveRecord>, MoveError> {
        Ok(self
            .read_account_moves("WHERE operation_id = ?1", params![operation_id])?
            .into_iter()
            .next())
    }

    /// The moves recorded in this profile, newest first.
    pub fn list_account_moves(&self, limit: usize) -> Result<Vec<AccountMoveRecord>, MoveError> {
        Ok(self.read_account_moves("ORDER BY rowid DESC LIMIT ?1", params![limit as i64])?)
    }

    fn read_account_moves(&self, tail: &str, args: impl rusqlite::Params) -> rusqlite::Result<Vec<AccountMoveRecord>> {
        let sql = format!(
            "SELECT operation_id, mode, effective_date, destination_account_id, moved_count, before_json, corrections_json, result_json, inputs_json
             FROM account_move_operations {tail}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map(args, |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let parse = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap_or(serde_json::Value::Null);
        Ok(rows
            .into_iter()
            .map(
                |(operation_id, mode, effective_date, destination, moved_count, before, corrections, result, inputs)| {
                    let before = parse(&before);
                    let result = parse(&result);
                    let ids = |key: &str| -> Vec<i64> {
                        result[key]
                            .as_array()
                            .map(|a| a.iter().filter_map(|v| v.as_i64()).collect())
                            .unwrap_or_default()
                    };
                    AccountMoveRecord {
                        destination_name: self.account_name_for_log(destination),
                        destination_account_id: destination,
                        mode: if mode == "confirmation" { "confirmation" } else { "automatic" },
                        effective_date,
                        moved_count: moved_count as usize,
                        moved_ids: ids("movedIds"),
                        affected_account_ids: ids("affectedAccountIds"),
                        confirmed_account_ids: ids("confirmedAccountIds"),
                        corrected_checkpoints: result["correctedCheckpoints"].as_u64().unwrap_or(0) as usize,
                        accounts: before["accounts"].clone(),
                        inputs: parse(&inputs),
                        corrections: parse(&corrections).as_array().map(|a| a.len()).unwrap_or(0),
                        operation_id,
                    }
                },
            )
            .collect())
    }

    /// The sum of the amounts (principal part where one is set) of an account's live rows dated exactly `date`.
    fn live_quantity_on(&self, account_id: i64, date: NaiveDate) -> Result<Decimal, MoveError> {
        let mut stmt = self
            .conn
            .prepare("SELECT COALESCE(principal_amount, amount) FROM transactions WHERE account_id = ?1 AND date = ?2 AND deleted_at IS NULL")?;
        let parts = stmt
            .query_map(params![account_id, date.to_string()], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut total = Decimal::ZERO;
        for p in parts {
            total = total
                .checked_add(super::checkpoints::parse_decimal(&p)?)
                .ok_or_else(|| MoveError::InvalidBalance("An amount in this account is too large to add up.".to_string()))?;
        }
        Ok(total)
    }

    fn account_info(&self, id: i64) -> Result<AccountInfo, MoveError> {
        let row = self.conn.query_row(
            "SELECT name, account_type, hidden, member_id, import_flip_signs, starting_balance FROM accounts WHERE id = ?1",
            params![id],
            |r| {
                Ok(AccountInfo {
                    name: r.get(0)?,
                    account_type: r.get(1)?,
                    hidden: r.get(2)?,
                    member_id: r.get(3)?,
                    import_flip_signs: r.get(4)?,
                    starting_balance: parse_decimal(&r.get::<_, String>(5)?)?,
                })
            },
        );
        match row {
            Ok(info) => Ok(info),
            Err(rusqlite::Error::QueryReturnedNoRows) => Err(MoveError::InvalidDestination("That account no longer exists.".to_string())),
            Err(e) => Err(e.into()),
        }
    }

    fn load_rows(&self, ids: &[i64]) -> Result<Vec<LoadedRow>, MoveError> {
        let mut rows = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(SQL_CHUNK) {
            let sql = format!(
                "SELECT id, account_id, date, description, amount, principal_amount, reconciliation_id, cleared, member_id, financial_revision
                 FROM transactions WHERE deleted_at IS NULL AND id IN ({})",
                placeholders(chunk.len())
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let found = stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |r| {
                let date_text: String = r.get(2)?;
                let amount_text: String = r.get(4)?;
                let principal: Option<String> = r.get(5)?;
                Ok(LoadedRow {
                    id: r.get(0)?,
                    account_id: r.get(1)?,
                    date: parse_date(&date_text)?,
                    date_text,
                    description: r.get(3)?,
                    amount: parse_decimal(&amount_text)?,
                    amount_text,
                    principal: principal.as_deref().map(parse_decimal).transpose()?,
                    reconciliation_id: r.get(6)?,
                    cleared: r.get(7)?,
                    member_id: r.get(8)?,
                    revision: r.get(9)?,
                })
            })?;
            for row in found {
                rows.push(row?);
            }
        }
        rows.sort_by_key(|r| r.id);
        Ok(rows)
    }

    /// Ids (among `ids`) that are one side of a linked transfer, or the source or generated row of a debt payment.
    fn linked_ids(&self, ids: &[i64]) -> Result<(HashSet<i64>, HashSet<i64>), MoveError> {
        let (mut transfers, mut payments) = (HashSet::new(), HashSet::new());
        for chunk in ids.chunks(SQL_CHUNK) {
            let marks = placeholders(chunk.len());
            let mut args: Vec<i64> = chunk.to_vec();
            args.extend(chunk);
            let sql = format!(
                "SELECT out_transaction_id, in_transaction_id FROM transfer_links WHERE out_transaction_id IN ({marks}) OR in_transaction_id IN ({marks})"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            for pair in stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })? {
                let (a, b) = pair?;
                transfers.insert(a);
                transfers.insert(b);
            }
            let sql = format!(
                "SELECT source_transaction_id, generated_transaction_id FROM debt_payments WHERE source_transaction_id IN ({marks}) OR generated_transaction_id IN ({marks})"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            for pair in stmt.query_map(rusqlite::params_from_iter(args.iter()), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })? {
                let (a, b) = pair?;
                payments.insert(a);
                payments.insert(b);
            }
        }
        Ok((transfers, payments))
    }

    /// The whole plan for a move, from the data as it is right now.
    fn build_plan(&self, ids: &[i64], destination: i64, today: NaiveDate, inputs: &[BalanceInput]) -> Result<Plan, MoveError> {
        let dest = self.account_info(destination)?;
        if dest.hidden {
            return Err(MoveError::InvalidDestination(format!(
                "{} is hidden, so transactions can't be moved to it. Show the account first.",
                dest.name
            )));
        }
        let rows = self.load_rows(ids)?;
        if rows.len() != ids.len() {
            let found: HashSet<i64> = rows.iter().map(|r| r.id).collect();
            let missing: Vec<i64> = ids.iter().copied().filter(|id| !found.contains(id)).collect();
            return Err(MoveError::UnknownTransactions { ids: missing });
        }

        let mut accounts: HashMap<i64, AccountInfo> = HashMap::new();
        accounts.insert(destination, dest);
        for row in &rows {
            if let std::collections::hash_map::Entry::Vacant(slot) = accounts.entry(row.account_id) {
                slot.insert(self.account_info(row.account_id)?);
            }
        }
        let dest = &accounts[&destination];

        let already_there_ids: Vec<i64> = rows.iter().filter(|r| r.account_id == destination).map(|r| r.id).collect();
        let effective_rows: Vec<&LoadedRow> = rows.iter().filter(|r| r.account_id != destination).collect();
        let effective_ids: Vec<i64> = effective_rows.iter().map(|r| r.id).collect();

        // Blockers, in a fixed order.
        let mut blocked: BTreeMap<i64, Vec<&'static str>> = BTreeMap::new();
        let mut blockers: Vec<MoveBlocker> = Vec::new();
        let describe = |r: &LoadedRow| format!("{} \"{}\" ({})", pretty_date(&r.date_text), r.description.trim(), r.amount_text);
        let mut add = |code: &'static str, summary: String, items: Vec<BlockedItem>, blocked: &mut BTreeMap<i64, Vec<&'static str>>| {
            if items.is_empty() {
                return;
            }
            for item in &items {
                blocked.entry(item.transaction_id).or_default().push(code);
            }
            blockers.push(MoveBlocker {
                code,
                count: items.len(),
                summary,
                items,
            });
        };

        let settled: Vec<BlockedItem> = effective_rows
            .iter()
            .filter(|r| r.reconciliation_id.is_some())
            .map(|r| BlockedItem {
                transaction_id: r.id,
                detail: format!(
                    "{} was already counted when you reconciled {}.",
                    describe(r),
                    accounts[&r.account_id].name
                ),
            })
            .collect();
        let n = settled.len();
        add(
            "settled",
            format!(
                "{} already counted in a finished reconciliation, which can't be changed.",
                plural(n, "transaction is", "transactions are")
            ),
            settled,
            &mut blocked,
        );

        let (transfers, payments) = self.linked_ids(&effective_ids)?;
        let linked: Vec<BlockedItem> = effective_rows
            .iter()
            .filter(|r| transfers.contains(&r.id))
            .map(|r| BlockedItem {
                transaction_id: r.id,
                detail: format!("{} is one side of a linked transfer.", describe(r)),
            })
            .collect();
        let n = linked.len();
        add(
            "linked_transfer",
            format!(
                "{} part of a linked transfer. Unlink the transfer first, then try again.",
                plural(n, "transaction is", "transactions are")
            ),
            linked,
            &mut blocked,
        );
        let applied: Vec<BlockedItem> = effective_rows
            .iter()
            .filter(|r| payments.contains(&r.id))
            .map(|r| BlockedItem {
                transaction_id: r.id,
                detail: format!("{} is part of a payment applied to a debt.", describe(r)),
            })
            .collect();
        let n = applied.len();
        add(
            "applied_debt_payment",
            format!(
                "{} part of a payment applied to a debt. Undo that first, then try again.",
                plural(n, "transaction is", "transactions are")
            ),
            applied,
            &mut blocked,
        );

        // Saved balances on either account dated on or after a moved row: corrected from their record where they
        // recorded what they counted, otherwise the person confirms the balance after the move.
        let mut affected_accounts: BTreeSet<i64> = effective_rows.iter().map(|r| r.account_id).collect();
        if !effective_rows.is_empty() {
            affected_accounts.insert(destination);
        }
        let mut account_plans: Vec<historical_move::AccountPlan> = Vec::new();
        for account_id in &affected_accounts {
            let info = &accounts[account_id];
            let incoming = *account_id == destination;
            let moving: Vec<historical_move::MovingRow> = effective_rows
                .iter()
                .filter(|r| incoming || r.account_id == *account_id)
                .map(|r| historical_move::MovingRow {
                    id: r.id,
                    date: r.date,
                    quantity: r.principal.unwrap_or(r.amount),
                    revision: r.revision,
                })
                .collect();
            account_plans.push(self.plan_account(*account_id, &info.account_type, info.starting_balance, &moving, incoming)?);
        }
        let damaged: Vec<&historical_move::AccountPlan> = account_plans
            .iter()
            .filter(|p| p.verdict == historical_move::Verdict::Integrity)
            .collect();
        let needs_confirmation = account_plans.iter().any(|p| p.verdict == historical_move::Verdict::NeedsConfirmation);
        let mut damage_items: Vec<BlockedItem> = Vec::new();
        for p in &damaged {
            let latest = p.reasons.first().cloned().unwrap_or_default();
            for r in &effective_rows {
                if r.account_id == p.account_id || destination == p.account_id {
                    damage_items.push(BlockedItem {
                        transaction_id: r.id,
                        detail: format!(
                            "{} touches {}, whose saved balances look damaged: {latest}.",
                            describe(r),
                            accounts[&p.account_id].name
                        ),
                    });
                }
            }
        }
        damage_items.sort_by_key(|i| i.transaction_id);
        damage_items.dedup_by_key(|i| i.transaction_id);
        let n = damage_items.len();
        add(
            "checkpoint_integrity",
            format!(
                "{} saved balances that look damaged, so nothing can be moved safely. Confirming a balance can't fix this.",
                plural(n, "transaction touches", "transactions touch")
            ),
            damage_items,
            &mut blocked,
        );
        let mut future_items: Vec<BlockedItem> = Vec::new();
        let mut holdings_items: Vec<BlockedItem> = Vec::new();
        if needs_confirmation && damaged.is_empty() {
            let holdings_now = self.holdings_value_by_account()?;
            for account_id in &affected_accounts {
                let future: Option<String> = self.conn.query_row(
                    "SELECT MAX(MAX(reset_date, COALESCE(effective_from, reset_date))) FROM balance_resets
                     WHERE account_id = ?1 AND (reset_date > ?2 OR COALESCE(effective_from, reset_date) > ?2)",
                    params![account_id, today.to_string()],
                    |r| r.get(0),
                )?;
                for r in &effective_rows {
                    if !(r.account_id == *account_id || destination == *account_id) {
                        continue;
                    }
                    if let Some(date) = &future {
                        future_items.push(BlockedItem {
                            transaction_id: r.id,
                            detail: format!(
                                "{} touches {}, which has a saved balance for {} that a confirmed balance would not be able to replace.",
                                describe(r),
                                accounts[account_id].name,
                                pretty_date(date)
                            ),
                        });
                    }
                    if accounts[account_id].account_type == "investment" && holdings_now.contains_key(account_id) {
                        holdings_items.push(BlockedItem {
                            transaction_id: r.id,
                            detail: format!(
                                "{} touches {}, which shows the value of its holdings. A holdings value can't be used as its cash balance.",
                                describe(r),
                                accounts[account_id].name
                            ),
                        });
                    }
                }
            }
        }
        future_items.sort_by_key(|i| i.transaction_id);
        future_items.dedup_by_key(|i| i.transaction_id);
        let n = future_items.len();
        add(
            "future_checkpoint",
            format!(
                "{} an account with a saved balance dated in the future. Move them after that date, or remove the future balance first.",
                plural(n, "transaction touches", "transactions touch")
            ),
            future_items,
            &mut blocked,
        );
        holdings_items.sort_by_key(|i| i.transaction_id);
        holdings_items.dedup_by_key(|i| i.transaction_id);
        let n = holdings_items.len();
        add(
            "holdings_confirmation",
            format!(
                "{} an investment account that shows its holdings value, so a balance can't be confirmed for it.",
                plural(n, "transaction touches", "transactions touch")
            ),
            holdings_items,
            &mut blocked,
        );

        // A principal override means something only on a loan.
        let dest_is_loan = dest.account_type == "loan";
        let override_items: Vec<BlockedItem> = effective_rows
            .iter()
            .filter(|r| r.principal.is_some() && !(dest_is_loan && accounts[&r.account_id].account_type == "loan"))
            .map(|r| BlockedItem {
                transaction_id: r.id,
                detail: format!("{} has a principal amount set, which only applies between loan accounts.", describe(r)),
            })
            .collect();
        let n = override_items.len();
        add(
            "principal_override",
            format!(
                "{} a principal amount that only applies between loans. Remove it first, then try again.",
                plural(n, "transaction has", "transactions have")
            ),
            override_items,
            &mut blocked,
        );

        // Duplicates: the fingerprint each moved row would get.
        let projected: Vec<(&LoadedRow, String)> = effective_rows
            .iter()
            .map(|r| {
                let fp = fingerprint(
                    destination,
                    &Transaction {
                        date: r.date,
                        description: r.description.clone(),
                        amount: r.amount,
                        category: None,
                    },
                );
                (*r, fp)
            })
            .collect();
        let mut taken: HashSet<String> = HashSet::new();
        let fps: Vec<&String> = projected.iter().map(|(_, fp)| fp).collect::<BTreeSet<_>>().into_iter().collect();
        for chunk in fps.chunks(SQL_CHUNK) {
            let sql = format!(
                "SELECT fingerprint FROM transactions WHERE account_id = ? AND deleted_at IS NULL AND fingerprint IN ({})",
                placeholders(chunk.len())
            );
            let mut args: Vec<rusqlite::types::Value> = vec![rusqlite::types::Value::Integer(destination)];
            args.extend(chunk.iter().map(|s| rusqlite::types::Value::Text((*s).clone())));
            let mut stmt = self.conn.prepare(&sql)?;
            for fp in stmt.query_map(rusqlite::params_from_iter(args), |r| r.get::<_, String>(0))? {
                taken.insert(fp?);
            }
        }
        let collides: Vec<BlockedItem> = projected
            .iter()
            .filter(|(_, fp)| taken.contains(fp))
            .map(|(r, _)| BlockedItem {
                transaction_id: r.id,
                detail: format!("{} matches a transaction already in {}.", describe(r), dest.name),
            })
            .collect();
        let n = collides.len();
        add(
            "duplicate_in_destination",
            format!(
                "{} the same as {} already in {}. Moving would create a duplicate, so nothing was moved.",
                plural(n, "transaction is", "transactions are"),
                if n == 1 { "one" } else { "ones" },
                dest.name
            ),
            collides,
            &mut blocked,
        );
        let mut groups: BTreeMap<&str, Vec<&LoadedRow>> = BTreeMap::new();
        for (r, fp) in &projected {
            groups.entry(fp.as_str()).or_default().push(r);
        }
        let mut converge: Vec<BlockedItem> = Vec::new();
        let mut kept_duplicates = 0usize;
        for (group_fp, rows_in_group) in &groups {
            if rows_in_group.len() < 2 {
                continue;
            }
            let sources: BTreeSet<i64> = rows_in_group.iter().map(|r| r.account_id).collect();
            if sources.len() > 1 {
                for r in rows_in_group {
                    converge.push(BlockedItem {
                        transaction_id: r.id,
                        detail: format!(
                            "{} matches a transaction from another account in this selection; together they would look like a duplicate.",
                            describe(r)
                        ),
                    });
                }
            } else if !taken.contains(*group_fp) {
                kept_duplicates += rows_in_group.len();
            }
        }
        converge.sort_by_key(|i| i.transaction_id);
        let n = converge.len();
        add(
            "duplicate_across_accounts",
            format!(
                "{} from different accounts would become identical in {}. Move them one account at a time after checking they are not a repeated file.",
                plural(n, "transaction", "transactions"),
                dest.name
            ),
            converge,
            &mut blocked,
        );

        // Warnings.
        let mut warnings: Vec<MoveWarning> = Vec::new();
        let ticked = effective_rows.iter().filter(|r| r.cleared && !blocked.contains_key(&r.id)).count();
        if ticked > 0 {
            warnings.push(MoveWarning {
                code: "ticks_cleared",
                count: ticked,
                detail: format!(
                    "{} you ticked for reconciling will be unticked, so tick again when you reconcile {}.",
                    plural(ticked, "transaction", "transactions"),
                    dest.name
                ),
            });
        }
        if kept_duplicates > 0 {
            warnings.push(MoveWarning {
                code: "duplicates_kept",
                count: kept_duplicates,
                detail: format!(
                    "{kept_duplicates} selected transactions are already identical to each other. All of them move; none is merged or removed."
                ),
            });
        }
        let differing_kind = effective_rows
            .iter()
            .filter(|r| accounts[&r.account_id].account_type != dest.account_type)
            .count();
        if differing_kind > 0 {
            warnings.push(MoveWarning {
                code: "account_kind_differs",
                count: differing_kind,
                detail: format!(
                    "{} from a different kind of account than {}. Amounts keep their signs, so check the balances below.",
                    plural(differing_kind, "transaction is", "transactions are"),
                    dest.name
                ),
            });
        }
        let member_differs = effective_rows.iter().filter(|r| r.member_id != dest.member_id).count();
        if member_differs > 0 {
            warnings.push(MoveWarning {
                code: "members_kept",
                count: member_differs,
                detail: format!(
                    "Each transaction keeps its own family member (or stays unassigned), even where {} is set up for someone else.",
                    dest.name
                ),
            });
        }
        let future = effective_rows.iter().filter(|r| r.date > today).count();
        if future > 0 {
            warnings.push(MoveWarning {
                code: "future_dated",
                count: future,
                detail: format!(
                    "{} dated in the future. They change the balances from their own date, not today's.",
                    plural(future, "transaction is", "transactions are")
                ),
            });
        }
        let reads_differently = |r: &&LoadedRow| match (accounts[&r.account_id].import_flip_signs, dest.import_flip_signs) {
            (Some(a), Some(b)) => a != b,
            _ => false,
        };
        if effective_rows.iter().any(reads_differently) {
            warnings.push(MoveWarning {
                code: "import_settings_differ",
                count: 1,
                detail: "The accounts remember different ways of reading imported amounts. Moving doesn't change those settings; review them if you import into these accounts again.".to_string(),
            });
        }

        // Balances.
        let holdings = self.holdings_value_by_account()?;
        let mode: &'static str = if needs_confirmation { "confirmation" } else { "automatic" };
        let mut effects: Vec<AccountEffect> = Vec::new();
        let mut projected_raw: BTreeMap<i64, Decimal> = BTreeMap::new();
        let mut current_raw: BTreeMap<i64, Decimal> = BTreeMap::new();
        let mut confirmations: Vec<ConfirmationAccount> = Vec::new();
        let mut anchors: Vec<AnchorPlan> = Vec::new();
        let mut counts: BTreeMap<i64, usize> = BTreeMap::new();
        for r in &effective_rows {
            *counts.entry(r.account_id).or_insert(0) += 1;
        }
        let net_of = |info: &AccountInfo, raw: Decimal, holdings_value: Option<Decimal>| -> rusqlite::Result<Decimal> {
            match (info.account_type.as_str(), holdings_value) {
                (_, Some(value)) => Ok(value),
                ("credit", _) => sub_amount(raw, info.starting_balance),
                ("loan", _) => Ok(-raw),
                _ => Ok(raw),
            }
        };
        let (mut net_before, mut net_after) = (Decimal::ZERO, Decimal::ZERO);
        let mut all_inputs_final = true;
        for account_id in &affected_accounts {
            let info = &accounts[account_id];
            let dir = historical_direction(&info.account_type);
            let raw = self.account_balance_as_of(*account_id, &info.account_type, info.starting_balance, today)?;
            let holdings_override = info.account_type == "investment" && holdings.contains_key(account_id);
            let account_plan = account_plans.iter().find(|p| p.account_id == *account_id);

            // What the saved balances and rows would make the balance, if corrected from their record.
            let used = self.latest_checkpoint_row(*account_id, today)?;
            let base_delta = used
                .as_ref()
                .and_then(|u| account_plan.and_then(|p| p.changes.iter().find(|c| c.reset_id == u.reset_id)))
                .map(|c| sub_amount(c.new_balance, c.old_balance))
                .transpose()?
                .unwrap_or(Decimal::ZERO);
            let mut rows_delta = Decimal::ZERO;
            for r in &effective_rows {
                if r.date <= today && used.as_ref().is_none_or(|u| r.date > u.cutoff) {
                    let q = r.principal.unwrap_or(r.amount);
                    if r.account_id == *account_id {
                        rows_delta = sub_amount(rows_delta, dir * q)?;
                    }
                    if destination == *account_id {
                        rows_delta = add_amount(rows_delta, dir * q)?;
                    }
                }
            }
            let automatic_projected = add_amount(add_amount(raw, base_delta)?, rows_delta)?;

            let (mut projected, mut projected_is_final) = (automatic_projected, true);
            if mode == "confirmation" {
                let reasons = account_plan.map(|p| p.reasons.clone()).unwrap_or_default();
                let owed_terms = matches!(info.account_type.as_str(), "credit" | "loan");
                let shown_now = match info.account_type.as_str() {
                    "credit" => sub_amount(info.starting_balance, raw)?,
                    _ => raw,
                };
                let input = inputs.iter().find(|i| i.account_id == *account_id);
                let mut entry = ConfirmationAccount {
                    account_id: *account_id,
                    account_name: info.name.clone(),
                    account_type: info.account_type.clone(),
                    input_label: if owed_terms { "Amount owed" } else { "Balance" },
                    current_display: shown_now.to_string(),
                    credit_limit: (info.account_type == "credit").then(|| info.starting_balance.to_string()),
                    available_credit: (info.account_type == "credit").then(|| raw.to_string()),
                    reasons: if reasons.is_empty() {
                        vec!["Another account in this move needs its balance confirmed, so every account in it is confirmed together.".to_string()]
                    } else {
                        reasons
                    },
                    confirmed_display: None,
                    choice: None,
                    projected_baseline: None,
                    problem: None,
                };
                projected = raw;
                projected_is_final = false;
                if let Some(input) = input {
                    let parsed = if input.keep {
                        entry.choice = Some("keep");
                        Ok(shown_now)
                    } else {
                        entry.choice = Some("set");
                        parse_confirmed(&info.account_type, input.value.as_deref().unwrap_or(""))
                    };
                    match parsed {
                        Ok(shown) => {
                            let confirmed_raw = if info.account_type == "credit" {
                                sub_amount(info.starting_balance, shown)?
                            } else {
                                shown
                            };
                            let moved_today: Decimal = effective_rows
                                .iter()
                                .filter(|r| r.date == today)
                                .filter(|r| r.account_id == *account_id || destination == *account_id)
                                .try_fold(Decimal::ZERO, |sum, r| add_amount(sum, r.principal.unwrap_or(r.amount)))?;
                            let present_today = self.live_quantity_on(*account_id, today)?;
                            let activity_today = if destination == *account_id {
                                add_amount(present_today, moved_today)?
                            } else {
                                sub_amount(present_today, moved_today)?
                            };
                            match confirmed_raw.checked_sub(dir * activity_today) {
                                Some(baseline) if baseline.abs() < Decimal::new(1_000_000_000_000_000, 0) => {
                                    entry.confirmed_display = Some(shown.to_string());
                                    entry.projected_baseline = Some(baseline.to_string());
                                    anchors.push(AnchorPlan {
                                        account_id: *account_id,
                                        confirmed_raw,
                                        baseline,
                                    });
                                    projected = confirmed_raw;
                                    projected_is_final = true;
                                }
                                _ => entry.problem = Some("That amount is too large to save.".to_string()),
                            }
                        }
                        Err(problem) => entry.problem = Some(problem),
                    }
                }
                if entry.confirmed_display.is_none() {
                    all_inputs_final = false;
                }
                confirmations.push(entry);
            }

            current_raw.insert(*account_id, raw);
            projected_raw.insert(*account_id, projected);
            let held = holdings_override.then(|| holdings[account_id]);
            net_before = add_amount(net_before, net_of(info, raw, held)?)?;
            net_after = add_amount(net_after, net_of(info, projected, held)?)?;
            let (label, shown_current, shown_projected) = match info.account_type.as_str() {
                "credit" => (
                    "Owed",
                    sub_amount(info.starting_balance, raw)?,
                    sub_amount(info.starting_balance, projected)?,
                ),
                "loan" => ("Owed", raw, projected),
                "investment" if holdings_override => ("Holdings value", holdings[account_id], holdings[account_id]),
                _ => ("Balance", raw, projected),
            };
            let is_credit = info.account_type == "credit";
            effects.push(AccountEffect {
                account_id: *account_id,
                account_name: info.name.clone(),
                account_type: info.account_type.clone(),
                role: if *account_id == destination { "destination" } else { "source" },
                moved_count: if *account_id == destination {
                    effective_rows.len()
                } else {
                    counts.get(account_id).copied().unwrap_or(0)
                },
                label,
                current: shown_current.to_string(),
                projected: shown_projected.to_string(),
                available_current: is_credit.then(|| raw.to_string()),
                available_projected: is_credit.then(|| projected.to_string()),
                transaction_change: sub_amount(projected, raw)?.to_string(),
                holdings_override,
                projected_is_final,
            });
        }
        if effects.iter().any(|e| e.holdings_override) {
            let names: Vec<&str> = effects.iter().filter(|e| e.holdings_override).map(|e| e.account_name.as_str()).collect();
            warnings.push(MoveWarning {
                code: "holdings_value",
                count: names.len(),
                detail: if names.len() == 1 {
                    format!(
                        "{} shows its holdings value, which doesn't change when transactions move. Only its cash activity does.",
                        names[0]
                    )
                } else {
                    format!(
                        "{} show their holdings value, which doesn't change when transactions move. Only their cash activity does.",
                        names.join(" and ")
                    )
                },
            });
        }
        let corrected_count: usize = account_plans.iter().map(|p| p.changes.len()).sum();
        let mut checkpoint_notes: Vec<String> = Vec::new();
        let affected_cutoffs: Vec<NaiveDate> = account_plans.iter().flat_map(|p| p.affected_cutoffs.iter().copied()).collect();
        if mode == "automatic" && corrected_count > 0 {
            checkpoint_notes.push(format!(
                "{} saved {} will be corrected from what each one recorded, so today's balances and the history agree.",
                corrected_count,
                if corrected_count == 1 { "balance" } else { "balances" }
            ));
        }
        if mode == "confirmation" {
            checkpoint_notes.push("Your transactions will move. The balances you confirm will apply from today. Older saved balances cannot be reconstructed from the available records.".to_string());
            checkpoint_notes.push("Older saved balances keep their values, so reports that use transactions may show them under the new account, and history near an old saved balance can have gaps.".to_string());
        }
        if mode == "automatic" && net_before != net_after {
            checkpoint_notes.push(format!(
                "Together these accounts go from {net_before} to {net_after}. The saved balance of the account a transaction left never counted it, so no matching amount is added back."
            ));
        }

        // Summaries.
        let mut sources: BTreeMap<i64, usize> = BTreeMap::new();
        for r in &effective_rows {
            *sources.entry(r.account_id).or_insert(0) += 1;
        }
        let total = effective_rows.iter().try_fold(Decimal::ZERO, |sum, r| add_amount(sum, r.amount))?;
        let (first_date, last_date) = (
            effective_rows.iter().map(|r| r.date_text.clone()).min(),
            effective_rows.iter().map(|r| r.date_text.clone()).max(),
        );
        let preview_rows: Vec<MoveRow> = rows
            .iter()
            .map(|r| MoveRow {
                id: r.id,
                date: r.date_text.clone(),
                description: r.description.clone(),
                amount: r.amount_text.clone(),
                account_id: r.account_id,
                account_name: accounts[&r.account_id].name.clone(),
                status: if r.account_id == destination {
                    "already_there"
                } else if blocked.contains_key(&r.id) {
                    "blocked"
                } else {
                    "move"
                },
            })
            .collect();

        let mut preview = MovePreview {
            destination_account_id: destination,
            destination_name: dest.name.clone(),
            as_of: today.to_string(),
            selected_count: rows.len(),
            effective_count: effective_rows.len(),
            already_there_count: already_there_ids.len(),
            normalized_ids: ids.to_vec(),
            sources: sources
                .iter()
                .map(|(id, count)| SourceSummary {
                    account_id: *id,
                    account_name: accounts[id].name.clone(),
                    count: *count,
                })
                .collect(),
            first_date,
            last_date,
            total: total.to_string(),
            rows: preview_rows,
            effects,
            warnings,
            blockers,
            can_commit: false,
            status: "ready",
            mode,
            confirmations,
            checkpoint_effects: CheckpointEffects {
                corrected_count,
                first_date: affected_cutoffs.iter().min().map(|d| d.to_string()),
                last_date: affected_cutoffs.iter().max().map(|d| d.to_string()),
                notes: checkpoint_notes,
            },
            net_before: net_before.to_string(),
            net_after: net_after.to_string(),
            token: String::new(),
        };
        preview.can_commit = preview.blockers.is_empty() && preview.effective_count > 0 && (mode == "automatic" || all_inputs_final);
        preview.status = if !preview.blockers.is_empty() {
            "blocked"
        } else if mode == "confirmation" && preview.effective_count > 0 && !all_inputs_final {
            "needs_balance_confirmation"
        } else {
            "ready"
        };
        let state = self.plan_state_fingerprint(&affected_accounts, &effective_rows)?;
        preview.token = plan_token(&preview, &effective_rows, &state);

        let effective: Vec<(LoadedRow, String)> = {
            let fp_of: HashMap<i64, String> = projected.iter().map(|(r, fp)| (r.id, fp.clone())).collect();
            let wanted: HashSet<i64> = effective_ids.iter().copied().collect();
            let mut taken_rows: Vec<LoadedRow> = Vec::new();
            for r in rows {
                if wanted.contains(&r.id) {
                    taken_rows.push(r);
                }
            }
            taken_rows
                .into_iter()
                .map(|r| {
                    let fp = fp_of[&r.id].clone();
                    (r, fp)
                })
                .collect()
        };
        Ok(Plan {
            preview,
            effective,
            already_there_ids,
            projected_raw,
            current_raw,
            mode,
            account_plans,
            anchors,
            corrected_count,
            holdings_before: holdings,
        })
    }

    /// Saved-balance and account state the plan depends on but the preview does not print.
    fn plan_state_fingerprint(&self, accounts: &BTreeSet<i64>, rows: &[&LoadedRow]) -> Result<String, MoveError> {
        let mut out = String::new();
        for account_id in accounts {
            let resets: String = self.conn.query_row(
                "SELECT COALESCE(group_concat(id || ':' || COALESCE(current_version_id, '') || ':' || balance || ':' || reset_date || ':' || COALESCE(effective_from, ''), '|'), '')
                 FROM (SELECT * FROM balance_resets WHERE account_id = ?1 ORDER BY id)",
                params![account_id],
                |r| r.get(0),
            )?;
            let (kind, start): (String, String) = self.conn.query_row(
                "SELECT account_type, starting_balance FROM accounts WHERE id = ?1",
                params![account_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            out.push_str(&format!("#{account_id}:{kind}:{start}:{resets}"));
        }
        out.push_str(&format!("|{}", rows.len()));
        Ok(out)
    }

    /// Account ownership changed the context of these rows, so decisions made about them in the old context
    /// are forgotten: transfer suggestions the person dismissed or rejected, and "not a duplicate" answers for
    /// the moved rows and for look-alikes in the accounts involved. Decisions about anything else stay.
    fn clear_account_dependent_review_state(&self, moved: &[(LoadedRow, String)], destination: i64) -> Result<(), MoveError> {
        let ids: Vec<i64> = moved.iter().map(|(r, _)| r.id).collect();
        for chunk in ids.chunks(SQL_CHUNK) {
            let marks = placeholders(chunk.len());
            let mut doubled: Vec<i64> = chunk.to_vec();
            doubled.extend(chunk);
            for table in ["transfer_candidate_dismissals", "transfer_link_rejections"] {
                self.conn.execute(
                    &format!("DELETE FROM {table} WHERE out_transaction_id IN ({marks}) OR in_transaction_id IN ({marks})"),
                    rusqlite::params_from_iter(doubled.iter()),
                )?;
            }
            self.conn.execute(
                &format!("DELETE FROM anomaly_dismissals WHERE kind = 'duplicate' AND transaction_id IN ({marks})"),
                rusqlite::params_from_iter(chunk.iter()),
            )?;
        }
        // Look-alikes (same amount and same description once numbers are dropped, within three days) in the
        // destination and in each source account, whose "possible duplicate" answer was given with the old
        // neighbours in view.
        let mut accounts: BTreeSet<i64> = moved.iter().map(|(r, _)| r.account_id).collect();
        accounts.insert(destination);
        let mut keys: BTreeSet<(String, String)> = BTreeSet::new();
        for (r, _) in moved {
            keys.insert((r.amount_text.clone(), normalize_description(&r.description)));
        }
        let mut peers: BTreeSet<i64> = BTreeSet::new();
        for account_id in accounts {
            let mut stmt = self.conn.prepare("SELECT id, date, description, amount FROM transactions WHERE account_id = ?1 AND deleted_at IS NULL AND id IN (SELECT transaction_id FROM anomaly_dismissals WHERE kind = 'duplicate')")?;
            let dismissed = stmt
                .query_map(params![account_id], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for (id, date, description, amount) in dismissed {
                if !keys.contains(&(amount.clone(), normalize_description(&description))) {
                    continue;
                }
                let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("dates stored by this crate are valid");
                let near = moved.iter().any(|(m, _)| {
                    (m.date - date).num_days().abs() <= 3
                        && m.amount_text == amount
                        && normalize_description(&m.description) == normalize_description(&description)
                });
                if near {
                    peers.insert(id);
                }
            }
        }
        for id in peers {
            self.conn.execute(
                "DELETE FROM anomaly_dismissals WHERE kind = 'duplicate' AND transaction_id = ?1",
                params![id],
            )?;
        }
        Ok(())
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
