//! Reconciling an account against a statement: the balance rule shared by manual and statement
//! reconciling, and the finished record.
//!
//! The rule picks up from last time: the last finished reconciliation's ending balance (or, the first
//! time, the statement's own starting balance) plus the change from every ticked transaction that no
//! finished reconciliation has settled yet must equal the statement's ending balance exactly. Balances
//! are in the statement's terms: cash in the account, what is owed on a card, or the principal still
//! owed on a loan. Which reconciliation settled a transaction is stored on it (`reconciliation_id`),
//! because late items can be dated before the previous statement's end.

use super::Store;
use crate::models::AccountType;
use chrono::{NaiveDate, NaiveDateTime};
use rusqlite::params;
use rust_decimal::Decimal;
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

    pub fn reconcile_status(&self, account_id: i64, statement_start: Option<Decimal>, statement_end: Decimal) -> rusqlite::Result<ReconcileStatus> {
        let kind = self.account_kind(account_id)?;
        let last = self.last_reconciliation(account_id)?.map(|(_, balance)| balance);
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
        let status = self.reconcile_status(req.account_id, req.statement_start, req.statement_end)?;
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
