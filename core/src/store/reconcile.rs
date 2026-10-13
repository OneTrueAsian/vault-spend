//! Reconciling an account against a statement: the balance rule shared by manual and statement
//! reconciling, and the finished record.
//!
//! The rule picks up from last time: the ending balance of the last finished reconciliation dated on or
//! before the statement's end date (or, the first time, the statement's own starting balance) plus the change from every ticked transaction that no
//! finished reconciliation has settled yet must equal the statement's ending balance exactly. Balances
//! are in the statement's terms: cash in the account, what is owed on a card, or the principal still
//! owed on a loan. Which reconciliation settled a transaction is stored on it (`reconciliation_id`),
//! because late items can be dated before the previous statement's end.

use super::{LayoutSaveError, Store, fingerprint};
use crate::models::{AccountType, Transaction};
use crate::statement::Period;
use crate::statement::layout::StatementLayout;
use chrono::{Duration, NaiveDate, NaiveDateTime};
use rusqlite::params;
use rusqlite::types::Value;
use rust_decimal::Decimal;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::str::FromStr;

/// How a statement states this account's balance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountKind {
    /// Checking, savings and other cash accounts: money in the account.
    Cash,
    /// What is owed on the card.
    Credit,
    /// Principal still owed.
    Loan,
    /// Cash activity of an investment account (its value moves with the market; see `store/reconcile.rs`
    /// `finish_statement_reconciliation` for how investment statements finish).
    Investment,
}

impl AccountKind {
    pub fn of(account_type: AccountType) -> Self {
        match account_type {
            AccountType::Checking | AccountType::Savings | AccountType::Other => AccountKind::Cash,
            AccountType::Credit => AccountKind::Credit,
            AccountType::Loan => AccountKind::Loan,
            AccountType::Investment => AccountKind::Investment,
        }
    }
}

/// How one app transaction moves the statement's balance. A card charge is stored negative and raises
/// what is owed; a loan payment is stored positive and lowers the principal owed (by its principal part
/// when one was recorded, matching `account_balance_as_of`).
pub fn balance_change(kind: AccountKind, amount: Decimal, principal: Option<Decimal>) -> Decimal {
    match kind {
        AccountKind::Cash | AccountKind::Investment => amount,
        AccountKind::Credit => -amount,
        AccountKind::Loan => -principal.unwrap_or(amount),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReconcileSource {
    Manual,
    StatementPdf,
    StatementDownload,
}

impl ReconcileSource {
    pub fn as_str(self) -> &'static str {
        match self {
            ReconcileSource::Manual => "manual",
            ReconcileSource::StatementPdf => "statement_pdf",
            ReconcileSource::StatementDownload => "statement_download",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReconcileStatus {
    /// The last finished reconciliation's ending balance, else the statement starting balance given.
    pub starting_point: Option<Decimal>,
    /// True on an account's first reconciliation: the statement's starting balance is needed.
    pub needs_starting_balance: bool,
    pub ticked_change: Decimal,
    pub ticked_count: usize,
    /// `statement_end - (starting_point + ticked_change)`; `None` until there is a starting point.
    pub difference: Option<Decimal>,
}

pub struct FinishReconciliation {
    pub account_id: i64,
    pub period_start: Option<NaiveDate>,
    pub statement_date: NaiveDate,
    pub statement_start: Option<Decimal>,
    pub statement_end: Decimal,
    pub source: ReconcileSource,
}

fn dec(s: &str) -> Decimal {
    Decimal::from_str(s).expect("amounts stored by this crate are valid decimals")
}

impl Store {
    pub fn account_kind(&self, account_id: i64) -> rusqlite::Result<AccountKind> {
        let account_type: String = self
            .conn
            .query_row("SELECT account_type FROM accounts WHERE id = ?1", params![account_id], |r| r.get(0))?;
        // An unknown type must not fall back to a cash sign rule: that would reconcile the account wrongly.
        AccountType::parse(&account_type).map(AccountKind::of).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, format!("unknown account type `{account_type}`").into())
        })
    }

    /// The change from every ticked, not-yet-settled, non-deleted transaction on the account.
    pub(crate) fn unsettled_ticked_change(&self, account_id: i64, kind: AccountKind) -> rusqlite::Result<(Decimal, usize)> {
        let mut stmt = self.conn.prepare(
            "SELECT amount, principal_amount FROM transactions
             WHERE account_id = ?1 AND cleared = 1 AND reconciliation_id IS NULL AND deleted_at IS NULL",
        )?;
        let rows = stmt
            .query_map(params![account_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let change = rows
            .iter()
            .map(|(amount, principal)| balance_change(kind, dec(amount), principal.as_deref().map(dec)))
            .sum();
        Ok((change, rows.len()))
    }

    /// The statement date and ending balance of the account's latest reconciliation that states a
    /// balance (latest statement date, then latest id): the starting point for the next one. An
    /// investment statement's record (`holdings_checked` set) is left out: it keeps the statement's total
    /// value for reference only, which is not a cash balance to continue from. `last_reconciliation`, by
    /// contrast, returns the latest record of any kind, for showing when the account was last reconciled.
    ///
    /// `reconcile_status` continues from the latest such balance dated on or before the statement being
    /// reconciled, plus the change from any transactions settled by investment statements that come
    /// after it up to that date (see `change_settled_since`).
    pub fn last_balance_reconciliation(&self, account_id: i64) -> rusqlite::Result<Option<(NaiveDate, Decimal)>> {
        Ok(self.last_balance_record(account_id, None)?.map(|(_, date, balance)| (date, balance)))
    }

    /// `last_balance_reconciliation` with the record's id, limited to records dated on or before `as_of`
    /// when one is given.
    fn last_balance_record(&self, account_id: i64, as_of: Option<NaiveDate>) -> rusqlite::Result<Option<(i64, NaiveDate, Decimal)>> {
        match self.conn.query_row(
            "SELECT id, statement_date, statement_balance FROM reconciliations
             WHERE account_id = ?1 AND holdings_checked IS NULL AND (?2 IS NULL OR statement_date <= ?2)
             ORDER BY statement_date DESC, id DESC LIMIT 1",
            params![account_id, as_of.map(|d| d.to_string())],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        ) {
            Ok((id, date, balance)) => Ok(Some((
                id,
                NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("dates stored by this crate are valid"),
                dec(&balance),
            ))),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// The change from every transaction settled by an investment statement's record (`holdings_checked`
    /// set) that comes after the balance record (`since_date`, `since_id`) in the same order
    /// `last_balance_record` picks the starting point by: a later statement date, or the same statement
    /// date and a higher id (recorded later). Those transactions moved the cash balance after that
    /// balance, but are in no balance record's ending balance, so the next balance reconciliation must
    /// continue from them too. An investment statement dated before the balance record is already covered
    /// by that balance, whichever was finished first, so it is not counted again. Rows settled by the
    /// balance records themselves are already in their ending balances and are not counted. Investment
    /// statements dated after `as_of` (the statement being reconciled) come after it, so they are not
    /// counted either: they are carried into a later month's starting point instead.
    ///
    /// The change is read from the settled transactions as they are now, not stored when the investment
    /// statement was finished. So:
    /// - a settled transaction counts even if it was deleted afterwards, just as a balance record's
    ///   ending balance keeps it;
    /// - editing a transaction an investment statement settled (its amount or principal part) changes the
    ///   next starting point by the same amount. This is deliberate: a balance record's ending balance is
    ///   the statement's own figure, but an investment statement states no cash balance, so its
    ///   transactions are the only record of how it moved the cash.
    fn change_settled_since(
        &self,
        account_id: i64,
        kind: AccountKind,
        since_date: NaiveDate,
        since_id: i64,
        as_of: NaiveDate,
    ) -> rusqlite::Result<Decimal> {
        let mut stmt = self.conn.prepare(
            "SELECT t.amount, t.principal_amount FROM transactions t
             JOIN reconciliations r ON r.id = t.reconciliation_id
             WHERE r.account_id = ?1 AND r.holdings_checked IS NOT NULL
               AND (r.statement_date > ?2 OR (r.statement_date = ?2 AND r.id > ?3))
               AND r.statement_date <= ?4",
        )?;
        let rows = stmt
            .query_map(params![account_id, since_date.to_string(), since_id, as_of.to_string()], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows
            .iter()
            .map(|(amount, principal)| balance_change(kind, dec(amount), principal.as_deref().map(dec)))
            .sum())
    }

    /// Where a statement ending `as_of` picks up from: the latest balance record dated on or before
    /// `as_of`, plus the cash moved by investment statements after it up to `as_of`. `None` when nothing
    /// was reconciled on or before `as_of` (the statement's own starting balance is needed). Taking it as
    /// of the statement's date means an older month reconciled after a newer one still starts from the
    /// month before it.
    pub fn reconcile_starting_point(&self, account_id: i64, as_of: NaiveDate) -> rusqlite::Result<Option<Decimal>> {
        let kind = self.account_kind(account_id)?;
        match self.last_balance_record(account_id, Some(as_of))? {
            Some((id, date, balance)) => Ok(Some(balance + self.change_settled_since(account_id, kind, date, id, as_of)?)),
            None => Ok(None),
        }
    }

    /// The balance check for a statement ending `as_of` with ending balance `statement_end` (see
    /// `reconcile_starting_point` for where it starts).
    pub fn reconcile_status(
        &self,
        account_id: i64,
        as_of: NaiveDate,
        statement_start: Option<Decimal>,
        statement_end: Decimal,
    ) -> rusqlite::Result<ReconcileStatus> {
        let kind = self.account_kind(account_id)?;
        let last = self.reconcile_starting_point(account_id, as_of)?;
        let starting_point = last.or(statement_start);
        let (ticked_change, ticked_count) = self.unsettled_ticked_change(account_id, kind)?;
        Ok(ReconcileStatus {
            starting_point,
            needs_starting_balance: last.is_none(),
            ticked_change,
            ticked_count,
            difference: starting_point.map(|start| statement_end - (start + ticked_change)),
        })
    }

    /// Records a finished reconciliation and settles every ticked, unsettled transaction on the
    /// account — only when the difference is exactly zero. `None` means nothing was written.
    ///
    /// This opens its own transaction, so it fails with a SQLite "cannot start a transaction within a
    /// transaction" error if the caller already holds one. A caller that already holds a transaction must
    /// use `insert_reconciliation` and `settle_ticked` directly, as the statement finish does.
    pub fn finish_reconciliation(&self, req: &FinishReconciliation, now: NaiveDateTime) -> rusqlite::Result<Option<i64>> {
        let tx = self.conn.unchecked_transaction()?;
        let status = self.reconcile_status(req.account_id, req.statement_date, req.statement_start, req.statement_end)?;
        if status.difference != Some(Decimal::ZERO) {
            return Ok(None);
        }
        let id = self.insert_reconciliation(req, status.starting_point, None, now)?;
        self.settle_ticked(req.account_id, id)?;
        tx.commit()?;
        Ok(Some(id))
    }

    pub(crate) fn insert_reconciliation(
        &self,
        req: &FinishReconciliation,
        starting: Option<Decimal>,
        holdings_checked: Option<bool>,
        now: NaiveDateTime,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at, period_start, starting_balance, source, holdings_checked)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                req.account_id,
                req.statement_date.to_string(),
                req.statement_end.to_string(),
                now.to_string(),
                req.period_start.map(|d| d.to_string()),
                starting.map(|d| d.to_string()),
                req.source.as_str(),
                holdings_checked.map(i64::from),
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub(crate) fn settle_ticked(&self, account_id: i64, reconciliation_id: i64) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE transactions SET reconciliation_id = ?1
             WHERE account_id = ?2 AND cleared = 1 AND reconciliation_id IS NULL AND deleted_at IS NULL",
            params![reconciliation_id, account_id],
        )?;
        Ok(())
    }
}

/// A transaction a statement row could match: not yet settled, dated near the statement period.
#[derive(Debug, Clone, PartialEq)]
pub struct CandidateTx {
    pub id: i64,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
    /// How it moves the statement's balance (see `balance_change`).
    pub change: Decimal,
}

/// One change to an investment account's holdings, made as part of finishing its statement.
#[derive(Debug, Clone, PartialEq)]
pub enum HoldingChange {
    /// Sets ONE holding row's (one lot's) shares. A symbol can be held in several lots; the statement
    /// check compares per-symbol sums, so a caller fixing a symbol held in several lots must compare the
    /// sums and adjust one lot by the difference, not set one lot to the statement's total.
    SetShares {
        holding_id: i64,
        shares: Decimal,
    },
    Add {
        symbol: String,
        name: String,
        shares: Decimal,
        price: Decimal,
        cost_basis: Decimal,
    },
    Remove {
        holding_id: i64,
    },
}

/// Everything one statement reconciliation writes, applied together or not at all.
#[derive(Debug, Clone)]
pub struct StatementFinish {
    pub account_id: i64,
    pub period: Period,
    pub statement_start: Option<Decimal>,
    pub statement_end: Option<Decimal>,
    /// An investment statement's total value, kept for reference.
    pub ending_value: Option<Decimal>,
    pub source: ReconcileSource,
    /// App transactions the statement's rows matched. Each must be on this account, not deleted and not
    /// settled by an earlier reconciliation.
    pub matched: Vec<i64>,
    /// Statement rows to add, already in the app's sign and categorised.
    pub add: Vec<Transaction>,
    /// Loan accounts only: the principal part of each row in `add` (same order and length), or empty for
    /// none. Only a payment (an amount above zero) can have `Some`. A row with `None` counts at its full
    /// amount, as any loan payment without a principal part.
    pub add_principal: Vec<Option<Decimal>>,
    /// Loan accounts only: the principal part the statement prints for each transaction in `matched`
    /// (same order and length), or empty for none. A `Some` replaces the matched payment's principal
    /// part, inside the finish; it follows the same rules as `add_principal`.
    pub matched_principal: Vec<Option<Decimal>>,
    /// Investment accounts only.
    pub holdings: Vec<HoldingChange>,
    /// Investment statements: the share counts the app must hold afterwards; `None` = not checked.
    pub statement_shares: Option<Vec<(String, Decimal)>>,
    /// (existing learned layout to update, name, layout) to remember for next time.
    pub layout: Option<(Option<i64>, String, StatementLayout)>,
}

#[derive(Debug)]
pub enum StatementFinishError {
    DoesNotBalance,
    /// The symbol whose share count still differs from the statement's.
    SharesDiffer(String),
    /// A matched transaction or a holding to change is not (or no longer) this account's to settle.
    NotThisAccount,
    /// A transaction to add is already in the app (same account, date, description and amount).
    AlreadyInApp,
    /// The finish's own details don't fit together (the message says how).
    BadInput(&'static str),
    /// A holding to change has an impossible value (the message says which).
    InvalidHolding(&'static str),
    /// Share counts were not checked against the statement, so they must not change.
    HoldingsNotChecked,
    Layout(LayoutSaveError),
    Db(rusqlite::Error),
}

impl From<rusqlite::Error> for StatementFinishError {
    fn from(e: rusqlite::Error) -> Self {
        StatementFinishError::Db(e)
    }
}

impl std::fmt::Display for StatementFinishError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StatementFinishError::DoesNotBalance => write!(f, "That doesn't balance yet — the difference has to be $0.00."),
            StatementFinishError::SharesDiffer(symbol) => write!(f, "The share count for {symbol} still differs from your statement."),
            StatementFinishError::NotThisAccount => write!(f, "Your data changed while you were reviewing. Please read the statement again."),
            StatementFinishError::AlreadyInApp => {
                write!(f, "One of the transactions to add is already in the app. Read the statement again.")
            }
            StatementFinishError::BadInput(message) | StatementFinishError::InvalidHolding(message) => write!(f, "{message}"),
            StatementFinishError::HoldingsNotChecked => write!(f, "Share counts can only be changed when they are checked against your statement."),
            StatementFinishError::Layout(e) => write!(f, "{e}"),
            StatementFinishError::Db(_) => write!(f, "Something went wrong saving this. Nothing was changed. Please try again."),
        }
    }
}

impl std::error::Error for StatementFinishError {}

#[derive(Debug, Clone, PartialEq)]
pub struct StatementFinished {
    pub reconciliation_id: i64,
    pub added: usize,
    pub layout_id: Option<i64>,
}

/// Refuses a holdings change with an impossible value: a negative share count, or a holding to add
/// without a symbol or with a price or cost basis that isn't above zero.
fn validate_holding_change(change: &HoldingChange) -> Result<(), StatementFinishError> {
    const NEGATIVE_SHARES: &str = "A share count can't be below zero.";
    match change {
        HoldingChange::SetShares { shares, .. } if *shares < Decimal::ZERO => Err(StatementFinishError::InvalidHolding(NEGATIVE_SHARES)),
        HoldingChange::Add {
            symbol,
            shares,
            price,
            cost_basis,
            ..
        } => {
            if symbol.trim().is_empty() {
                Err(StatementFinishError::InvalidHolding("Each holding you add needs its symbol."))
            } else if *shares < Decimal::ZERO {
                Err(StatementFinishError::InvalidHolding(NEGATIVE_SHARES))
            } else if *price <= Decimal::ZERO {
                Err(StatementFinishError::InvalidHolding(
                    "Enter a price above $0.00 for each holding you add.",
                ))
            } else if *cost_basis <= Decimal::ZERO {
                Err(StatementFinishError::InvalidHolding(
                    "Enter what you paid for each holding you add. It has to be more than $0.00.",
                ))
            } else {
                Ok(())
            }
        }
        _ => Ok(()),
    }
}

/// Refuses principal parts that don't fit: a list that isn't empty or one per row to add, a principal
/// part on an account that isn't a loan or on a loan row that isn't a payment (a payment is stored
/// above zero; a charge such as a fee or interest raises what is owed by its full amount), or one below
/// zero or above the payment's amount.
fn validate_principals(kind: AccountKind, add: &[Transaction], principals: &[Option<Decimal>]) -> Result<(), StatementFinishError> {
    if !principals.is_empty() && principals.len() != add.len() {
        return Err(StatementFinishError::BadInput(
            "The transactions to add don't line up with their details. Please read the statement again.",
        ));
    }
    for (tx, principal) in add.iter().zip(principals) {
        if let Some(principal) = principal {
            validate_principal(kind, tx.amount, *principal)?;
        }
    }
    Ok(())
}

/// One principal part against the amount of the payment it belongs to (see `validate_principals`).
fn validate_principal(kind: AccountKind, amount: Decimal, principal: Decimal) -> Result<(), StatementFinishError> {
    if kind != AccountKind::Loan {
        return Err(StatementFinishError::BadInput("Only a loan payment can have a principal part."));
    }
    if amount <= Decimal::ZERO {
        return Err(StatementFinishError::BadInput(
            "Only a payment toward the loan can have a principal part. A charge, like a fee or interest, can't.",
        ));
    }
    if principal < Decimal::ZERO || principal > amount {
        return Err(StatementFinishError::BadInput(
            "The principal part of a payment has to be between $0.00 and the payment's amount.",
        ));
    }
    Ok(())
}

/// Holdings share counts by symbol (trimmed, upper case), summed when a symbol appears more than once.
fn shares_by_symbol<'a>(rows: impl IntoIterator<Item = (&'a str, Decimal)>) -> BTreeMap<String, Decimal> {
    let mut by_symbol = BTreeMap::new();
    for (symbol, shares) in rows {
        *by_symbol.entry(symbol.trim().to_uppercase()).or_insert(Decimal::ZERO) += shares;
    }
    by_symbol
}

impl Store {
    /// The account's transactions a statement for `period` can match: not deleted, not settled by a
    /// finished reconciliation, dated within `Period::LEEWAY_DAYS` of the period. Oldest first.
    pub fn statement_candidates(&self, account_id: i64, period: &Period) -> rusqlite::Result<Vec<CandidateTx>> {
        let kind = self.account_kind(account_id)?;
        let from = period.start - Duration::days(Period::LEEWAY_DAYS);
        let to = period.end + Duration::days(Period::LEEWAY_DAYS);
        let mut stmt = self.conn.prepare(
            "SELECT id, date, description, amount, principal_amount FROM transactions
             WHERE account_id = ?1 AND reconciliation_id IS NULL AND deleted_at IS NULL AND date >= ?2 AND date <= ?3
             ORDER BY date, id",
        )?;
        let rows = stmt
            .query_map(params![account_id, from.to_string(), to.to_string()], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows
            .into_iter()
            .map(|(id, date, description, amount, principal)| {
                let amount = dec(&amount);
                CandidateTx {
                    id,
                    date: NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("dates stored by this crate are valid"),
                    description,
                    amount,
                    change: balance_change(kind, amount, principal.as_deref().map(dec)),
                }
            })
            .collect())
    }

    /// A fingerprint of everything a statement review relies on for this account (its type, its
    /// transactions' dates, descriptions, amounts, ticks, settlement and deletion, its holdings and its
    /// reconciliations), so finishing can tell whether anything changed while the person was reviewing.
    /// Other accounts never affect it.
    pub fn reconcile_signature(&self, account_id: i64) -> rusqlite::Result<String> {
        let mut hasher = Sha256::new();
        let sections = [
            ("account", "SELECT account_type FROM accounts WHERE id = ?1"),
            (
                "transactions",
                "SELECT id, date, description, amount, principal_amount, cleared, reconciliation_id, deleted_at
                 FROM transactions WHERE account_id = ?1 ORDER BY id",
            ),
            ("holdings", "SELECT id, symbol, shares FROM holdings WHERE account_id = ?1 ORDER BY id"),
            (
                "reconciliations",
                "SELECT id, statement_date, statement_balance FROM reconciliations WHERE account_id = ?1 ORDER BY id",
            ),
        ];
        for (label, sql) in sections {
            hasher.update(label.as_bytes());
            hasher.update(b"\n");
            let mut stmt = self.conn.prepare(sql)?;
            let columns = stmt.column_count();
            let mut rows = stmt.query(params![account_id])?;
            while let Some(row) = rows.next()? {
                let values = (0..columns).map(|i| row.get::<_, Value>(i)).collect::<rusqlite::Result<Vec<_>>>()?;
                // `Debug` quotes and escapes text, so no two different rows hash the same input.
                hasher.update(format!("{values:?}\n").as_bytes());
            }
        }
        Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
    }

    fn holding_in_account(&self, holding_id: i64, account_id: i64) -> Result<(), StatementFinishError> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM holdings WHERE id = ?1 AND account_id = ?2",
            params![holding_id, account_id],
            |r| r.get(0),
        )?;
        if n == 1 { Ok(()) } else { Err(StatementFinishError::NotThisAccount) }
    }

    /// Refuses a transaction to add that is already in the account (the importer's fingerprint, live rows
    /// only, as `check_duplicates`), unless that existing transaction is one of `matched` (sorted): then
    /// the statement shows it more than once and the copy is a real, separate transaction.
    fn refuse_already_in_app(&self, account_id: i64, add: &[Transaction], matched: &[i64]) -> Result<(), StatementFinishError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM transactions WHERE account_id = ?1 AND fingerprint = ?2 AND deleted_at IS NULL")?;
        for tx in add {
            let existing = stmt
                .query_map(params![account_id, fingerprint(account_id, tx)], |r| r.get::<_, i64>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            if existing.iter().any(|id| matched.binary_search(id).is_err()) {
                return Err(StatementFinishError::AlreadyInApp);
            }
        }
        Ok(())
    }

    /// Finishes a statement reconciliation in one database transaction: unticks what is not on the
    /// statement, adds the statement's new transactions (with any loan principal parts), sets the principal
    /// parts the statement prints for matched loan payments, ticks the matched
    /// and added ones, applies the holdings changes, checks the statement (the exact $0.00 rule, or for
    /// investment accounts the share counts), records the reconciliation, settles the ticked transactions
    /// and saves the learned layout. Any error writes nothing: returning early drops the open transaction,
    /// which rolls it all back.
    ///
    /// The untick is deliberately account-wide, not limited to the statement window: every ticked,
    /// unsettled transaction on the account is unticked first, including ones dated outside the window
    /// that the review never showed. Settling then covers exactly the matched and added transactions, so
    /// nothing the person did not see on this statement can be settled by it; an unticked row simply
    /// waits for the statement it appears on.
    ///
    /// Like `finish_reconciliation`, this fails if the caller already holds a transaction. Everything
    /// called inside runs plain statements and never opens a transaction of its own.
    pub fn finish_statement_reconciliation(&self, f: &StatementFinish, now: NaiveDateTime) -> Result<StatementFinished, StatementFinishError> {
        let tx = self.conn.unchecked_transaction()?;
        let kind = match self.account_kind(f.account_id) {
            Err(rusqlite::Error::QueryReturnedNoRows) => return Err(StatementFinishError::NotThisAccount),
            other => other?,
        };

        // Checks that only read come first.
        if kind != AccountKind::Investment && !f.holdings.is_empty() {
            return Err(StatementFinishError::NotThisAccount);
        }
        // Share counts are checked only against a statement that lists some; without that check (the
        // person finished without checking holdings) they must not change.
        let shares_checked = kind == AccountKind::Investment && f.statement_shares.as_ref().is_some_and(|s| !s.is_empty());
        if !f.holdings.is_empty() && !shares_checked {
            return Err(StatementFinishError::HoldingsNotChecked);
        }
        f.holdings.iter().try_for_each(validate_holding_change)?;
        validate_principals(kind, &f.add, &f.add_principal)?;
        if !f.matched_principal.is_empty() && f.matched_principal.len() != f.matched.len() {
            return Err(StatementFinishError::BadInput(
                "The matched transactions don't line up with their details. Please read the statement again.",
            ));
        }
        let mut matched = f.matched.clone();
        matched.sort_unstable();
        matched.dedup();
        if matched.len() != f.matched.len() {
            return Err(StatementFinishError::NotThisAccount);
        }
        for id in &matched {
            let n: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM transactions WHERE id = ?1 AND account_id = ?2 AND reconciliation_id IS NULL AND deleted_at IS NULL",
                params![id, f.account_id],
                |r| r.get(0),
            )?;
            if n != 1 {
                return Err(StatementFinishError::NotThisAccount);
            }
        }
        for (id, principal) in f.matched.iter().zip(&f.matched_principal) {
            if let Some(principal) = principal {
                let amount: String = self
                    .conn
                    .query_row("SELECT amount FROM transactions WHERE id = ?1", params![id], |r| r.get(0))?;
                validate_principal(kind, dec(&amount), *principal)?;
            }
        }
        self.refuse_already_in_app(f.account_id, &f.add, &matched)?;

        // The statement decides what is ticked: anything ticked earlier but not on it waits for next time.
        self.conn.execute(
            "UPDATE transactions SET cleared = 0 WHERE account_id = ?1 AND reconciliation_id IS NULL AND cleared = 1",
            params![f.account_id],
        )?;
        // In debug builds this also writes "transaction added" lines to the activity log file as it goes;
        // if the finish then fails those lines stay although the rows are rolled back. That is the app's
        // existing debug-only behaviour (release builds keep no activity log) and is left as is.
        let added = self.save_transactions_with_ids(f.account_id, &f.add)?;
        for (id, principal) in added.iter().zip(&f.add_principal) {
            if let Some(principal) = principal {
                // A plain UPDATE (no transaction of its own), so it stays inside this one.
                self.update_transaction_principal_amount(*id, Some(*principal))?;
            }
        }
        for (id, principal) in f.matched.iter().zip(&f.matched_principal) {
            if let Some(principal) = principal {
                self.update_transaction_principal_amount(*id, Some(*principal))?;
            }
        }
        let ticked: Vec<i64> = matched.iter().chain(added.iter()).copied().collect();
        self.set_transactions_cleared(&ticked, true)?;

        for change in &f.holdings {
            match change {
                HoldingChange::SetShares { holding_id, shares } => {
                    self.holding_in_account(*holding_id, f.account_id)?;
                    self.update_holding_shares(*holding_id, *shares)?;
                }
                HoldingChange::Add {
                    symbol,
                    name,
                    shares,
                    price,
                    cost_basis,
                } => {
                    self.create_holding(f.account_id, symbol.trim(), name.trim(), *shares, *price, *cost_basis, None)?;
                }
                HoldingChange::Remove { holding_id } => {
                    self.holding_in_account(*holding_id, f.account_id)?;
                    self.delete_holding(*holding_id)?;
                }
            }
        }

        let (statement_end, starting, holdings_checked) = if kind == AccountKind::Investment {
            if shares_checked && let Some(expected) = &f.statement_shares {
                let mut stmt = self.conn.prepare("SELECT symbol, shares FROM holdings WHERE account_id = ?1")?;
                let rows = stmt
                    .query_map(params![f.account_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                let held = shares_by_symbol(rows.iter().map(|(symbol, shares)| (symbol.as_str(), dec(shares))));
                // Holdings in the app but not on the statement may be left as they are; every holding on
                // the statement must be held in exactly that number.
                for (symbol, shares) in shares_by_symbol(expected.iter().map(|(symbol, shares)| (symbol.as_str(), *shares))) {
                    if held.get(&symbol).copied().unwrap_or(Decimal::ZERO) != shares {
                        return Err(StatementFinishError::SharesDiffer(symbol));
                    }
                }
            }
            // `statement_balance` is NOT NULL, so it holds the statement's total value for reference, or 0
            // when the statement printed none. Either way it is never a balance to continue from: this
            // record has `holdings_checked` set, so `last_balance_reconciliation` (the starting point for
            // every later reconciliation) never reads it.
            (f.ending_value.unwrap_or_default(), None, Some(shares_checked))
        } else {
            let end = f.statement_end.ok_or(StatementFinishError::DoesNotBalance)?;
            let status = self.reconcile_status(f.account_id, f.period.end, f.statement_start, end)?;
            if status.difference != Some(Decimal::ZERO) {
                return Err(StatementFinishError::DoesNotBalance);
            }
            (end, status.starting_point, None)
        };

        let record = FinishReconciliation {
            account_id: f.account_id,
            period_start: Some(f.period.start),
            statement_date: f.period.end,
            statement_start: f.statement_start,
            statement_end,
            source: f.source,
        };
        let reconciliation_id = self.insert_reconciliation(&record, starting, holdings_checked, now)?;
        self.settle_ticked(f.account_id, reconciliation_id)?;
        let layout_id = match &f.layout {
            Some((id, name, layout)) => Some(self.save_statement_layout(*id, name, layout, now).map_err(StatementFinishError::Layout)?),
            None => None,
        };
        tx.commit()?;
        Ok(StatementFinished {
            reconciliation_id,
            added: added.len(),
            layout_id,
        })
    }
}
