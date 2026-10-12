//! Reconciling an account against a statement: the balance rule shared by manual and statement
//! reconciling, and the finished record.
//!
//! The rule picks up from last time: the last finished reconciliation's ending balance (or, the first
//! time, the statement's own starting balance) plus the change from every ticked transaction that no
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
    /// statement, adds the statement's new transactions, ticks the matched and added ones, applies the
    /// holdings changes, checks the statement (the exact $0.00 rule, or for investment accounts the share
    /// counts), records the reconciliation, settles the ticked transactions and saves the learned layout.
    /// Any error writes nothing: returning early drops the open transaction, which rolls it all back.
    ///
    /// Like `finish_reconciliation`, this fails if the caller already holds a transaction. Everything
    /// called inside runs plain statements and never opens a transaction of its own.
    pub fn finish_statement_reconciliation(&self, f: &StatementFinish, now: NaiveDateTime) -> Result<StatementFinished, StatementFinishError> {
        let tx = self.conn.unchecked_transaction()?;
        let kind = self.account_kind(f.account_id)?;
        if kind != AccountKind::Investment && !f.holdings.is_empty() {
            return Err(StatementFinishError::NotThisAccount);
        }

        // Checks that only read come first.
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
        self.refuse_already_in_app(f.account_id, &f.add, &matched)?;

        // The statement decides what is ticked: anything ticked earlier but not on it waits for next time.
        self.conn.execute(
            "UPDATE transactions SET cleared = 0 WHERE account_id = ?1 AND reconciliation_id IS NULL AND cleared = 1",
            params![f.account_id],
        )?;
        let added = self.save_transactions_with_ids(f.account_id, &f.add)?;
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
            if let Some(expected) = &f.statement_shares {
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
            (f.ending_value.unwrap_or_default(), None, Some(f.statement_shares.is_some()))
        } else {
            let end = f.statement_end.ok_or(StatementFinishError::DoesNotBalance)?;
            let status = self.reconcile_status(f.account_id, f.statement_start, end)?;
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
