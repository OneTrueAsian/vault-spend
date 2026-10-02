//! Accounts: creating, listing and editing them, balances, checkpoints, reconciliation and setup-file import.

use super::{Store, StoredAccount, month_bounds};
use crate::models::{Account, AccountType};
use chrono::{Datelike, NaiveDate, NaiveDateTime};
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

/// What a setup-data import actually did (see `Store::apply_setup_import`)
/// — counts per section, plus a human-readable reason for every row that
/// was skipped rather than applied (e.g. a bucket name that already
/// exists).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct SetupImportOutcome {
    pub accounts_created: usize,
    pub categories_created: usize,
    pub budgets_set: usize,
    pub buckets_created: usize,
    pub holdings_created: usize,
    pub skipped: Vec<String>,
}

/// Where an account's reconciliation stands against a statement — see
/// `Store::reconciliation_status`.
#[derive(Debug, Clone, PartialEq)]
pub struct ReconciliationStatus {
    /// The account's opening balance plus every transaction marked cleared.
    pub cleared_balance: Decimal,
    /// Statement balance minus `cleared_balance`; zero means it reconciles.
    pub difference: Decimal,
    pub cleared_count: usize,
}

/// One transaction as the account detail page and the reconcile list show it.
#[derive(Debug, Clone, PartialEq)]
pub struct AccountTransaction {
    /// Only populated for a live original payment; generated row identity stays in `id`.
    pub payment_source_id: Option<i64>,
    pub payment_source_account_id: Option<i64>,
    pub payment_source_account_name: Option<String>,
    pub payment_source_date: Option<NaiveDate>,
    pub id: i64,
    pub date: NaiveDate,
    pub description: String,
    pub amount: Decimal,
    pub category: Option<String>,
    pub cleared: bool,
}

impl Store {
    /// Creates an account the person asked for by name, or returns `None` when that name (ignoring
    /// case and surrounding spaces) is already used, leaving that account exactly as it was. Unlike
    /// `get_or_create_account`, which imports use to find the account a file belongs to, this never
    /// hands back an existing account for the caller to write over.
    pub fn create_account(&self, name: &str, account_type: AccountType) -> rusqlite::Result<Option<i64>> {
        let name = name.trim();
        let inserted = self.conn.execute(
            "INSERT INTO accounts (name, account_type) VALUES (?1, ?2)
             ON CONFLICT(name) DO NOTHING",
            params![name, account_type.as_str()],
        )?;
        Ok((inserted == 1).then(|| self.conn.last_insert_rowid()))
    }

    pub fn find_account_by_name(&self, name: &str) -> rusqlite::Result<Option<i64>> {
        match self
            .conn
            .query_row("SELECT id FROM accounts WHERE name = ?1 COLLATE NOCASE", params![name], |row| row.get(0))
        {
            Ok(id) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Finds an account by name, or creates it — so the UI can let a user
    /// re-type an existing account's name at import time without erroring.
    pub fn get_or_create_account(&self, name: &str, account_type: AccountType) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO accounts (name, account_type) VALUES (?1, ?2)
             ON CONFLICT(name) DO NOTHING",
            params![name, account_type.as_str()],
        )?;
        self.conn
            .query_row("SELECT id FROM accounts WHERE name = ?1 COLLATE NOCASE", params![name], |row| row.get(0))
    }

    /// The most recent `balance_resets` checkpoint for an account at or
    /// before `as_of`, if any — shared by `account_balance_as_of` (which
    /// needs both the checkpoint's `balance` as its new baseline and its
    /// `reset_date` as the cutoff for which transactions still count on
    /// top of it) and `list_accounts` (which exposes just the date, so the
    /// UI can warn before a backdated transaction silently has no effect
    /// on today's balance).
    ///
    /// `reset_date DESC` alone isn't enough: a manual override and the
    /// automatic monthly rollover both anchor to "the day before whenever
    /// they ran" (see `set_account_balance_override` and
    /// `roll_forward_monthly_balances`), so whenever both run on the same
    /// calendar day — which is the common case, since a rollover fires on
    /// every app launch that hasn't already had one this month — they land
    /// on the exact same `reset_date` with no way to order between them.
    /// `id DESC` breaks the tie deterministically in favor of whichever
    /// was recorded more recently, which is also the semantically correct
    /// answer either way: a later row was always computed (or typed) with
    /// a fuller view of history than an earlier one dated the same day.
    fn latest_checkpoint(&self, account_id: i64, as_of: NaiveDate) -> rusqlite::Result<Option<(NaiveDate, Decimal)>> {
        match self.conn.query_row(
            "SELECT reset_date, balance FROM balance_resets
             WHERE account_id = ?1 AND reset_date <= ?2
             ORDER BY reset_date DESC, id DESC LIMIT 1",
            params![account_id, as_of.to_string()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        ) {
            Ok((date, balance)) => Ok(Some((
                NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("reset_date stored by this crate must be valid"),
                Decimal::from_str(&balance).expect("balance stored by this crate must be valid"),
            ))),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// The balance of one account as of `as_of`, honoring any monthly
    /// balance reset recorded for it (see `roll_forward_monthly_balances`):
    /// starts from the most recent reset at or before `as_of` (or the
    /// account's original, never-mutated `starting_balance` if there
    /// isn't one yet), then adds every transaction dated *after* that
    /// point through `as_of` — a reset's own balance already reflects
    /// everything up to its `reset_date`, so those transactions must
    /// never be summed again.
    pub(super) fn account_balance_as_of(
        &self,
        account_id: i64,
        account_type: &str,
        starting_balance: Decimal,
        as_of: NaiveDate,
    ) -> rusqlite::Result<Decimal> {
        let checkpoint = self.latest_checkpoint(account_id, as_of)?;

        let (base_value, since_date) = match checkpoint {
            Some((date, balance)) => (balance, Some(date)),
            None => (starting_balance, None),
        };

        // COALESCE(principal_amount, amount): a transaction recorded
        // directly on a loan account can override how much of it counts
        // toward the balance (see migrate_add_principal_amount_if_missing)
        // — NULL for every transaction that never sets one, so this is a
        // no-op everywhere except a row that explicitly opted in.
        let transaction_amounts: Vec<String> = match since_date {
            Some(since) => {
                let mut stmt = self.conn.prepare(
                    "SELECT COALESCE(principal_amount, amount) FROM transactions WHERE account_id = ?1 AND date > ?2 AND date <= ?3 AND deleted_at IS NULL",
                )?;
                let rows = stmt.query_map(params![account_id, since.to_string(), as_of.to_string()], |row| row.get(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            }
            None => {
                let mut stmt = self.conn.prepare(
                    "SELECT COALESCE(principal_amount, amount) FROM transactions WHERE account_id = ?1 AND date <= ?2 AND deleted_at IS NULL",
                )?;
                let rows = stmt.query_map(params![account_id, as_of.to_string()], |row| row.get(0))?;
                rows.collect::<rusqlite::Result<Vec<_>>>()?
            }
        };

        let total: Decimal = transaction_amounts
            .iter()
            .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
            .sum();
        // A loan's current_balance is amount owed directly (see
        // StoredAccount's doc comment) — a payment should reduce that, so
        // for a loan specifically, a positive transaction subtracts and a
        // negative one adds, the mirror image of every other account type
        // (including credit, whose current_balance is available credit,
        // not owed — a payment there is already positive-adds-to-available
        // under the ordinary `+` below).
        if account_type == "loan" {
            Ok(base_value - total)
        } else {
            Ok(base_value + total)
        }
    }

    /// Marks transactions as cleared (they appeared on a statement) or not.
    pub fn set_transactions_cleared(&self, ids: &[i64], cleared: bool) -> rusqlite::Result<()> {
        for id in ids {
            self.conn
                .execute("UPDATE transactions SET cleared = ?1 WHERE id = ?2", params![cleared, id])?;
        }
        Ok(())
    }

    /// The cleared balance (opening balance plus every cleared, non-deleted
    /// transaction) against a statement's ending balance. Deliberately built
    /// from the account's opening balance and the ticked transactions alone,
    /// not from `current_balance` — that one moves with every uncleared
    /// transaction and any balance correction, and a reconciliation is only
    /// asking whether the *statement's* transactions add up.
    pub fn reconciliation_status(&self, account_id: i64, statement_balance: Decimal) -> rusqlite::Result<ReconciliationStatus> {
        let starting: String = self
            .conn
            .query_row("SELECT starting_balance FROM accounts WHERE id = ?1", params![account_id], |row| {
                row.get(0)
            })?;
        let mut stmt = self
            .conn
            .prepare("SELECT amount FROM transactions WHERE account_id = ?1 AND cleared = 1 AND deleted_at IS NULL")?;
        let amounts = stmt
            .query_map(params![account_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let cleared_sum: Decimal = amounts
            .iter()
            .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
            .sum();
        let cleared_balance = Decimal::from_str(&starting).expect("starting_balance stored by this crate must be valid") + cleared_sum;
        Ok(ReconciliationStatus {
            cleared_balance,
            difference: statement_balance - cleared_balance,
            cleared_count: amounts.len(),
        })
    }

    /// Records a finished reconciliation — but only when the difference is
    /// exactly zero. Returns whether it was recorded; a non-zero difference
    /// records nothing.
    pub fn finish_reconciliation(
        &self,
        account_id: i64,
        statement_date: NaiveDate,
        statement_balance: Decimal,
        now: NaiveDateTime,
    ) -> rusqlite::Result<bool> {
        if self.reconciliation_status(account_id, statement_balance)?.difference != Decimal::ZERO {
            return Ok(false);
        }
        self.conn.execute(
            "INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES (?1, ?2, ?3, ?4)",
            params![account_id, statement_date.to_string(), statement_balance.to_string(), now.to_string()],
        )?;
        Ok(true)
    }

    /// The statement date and balance of the account's most recent finished
    /// reconciliation, if it has had one.
    pub fn last_reconciliation(&self, account_id: i64) -> rusqlite::Result<Option<(NaiveDate, Decimal)>> {
        match self.conn.query_row(
            "SELECT statement_date, statement_balance FROM reconciliations
             WHERE account_id = ?1 ORDER BY statement_date DESC, id DESC LIMIT 1",
            params![account_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        ) {
            Ok((date, balance)) => Ok(Some((
                NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                Decimal::from_str(&balance).expect("balance stored by this crate must be valid"),
            ))),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn account_transactions_where(
        &self,
        account_id: i64,
        extra: &str,
        limit: i64,
        statement_date: Option<NaiveDate>,
    ) -> rusqlite::Result<Vec<AccountTransaction>> {
        let sql = format!(
            "SELECT t.id, t.date, t.description, t.amount,
                    CASE WHEN source.id IS NOT NULL THEN source.category ELSE t.category END,
                    t.cleared, source.id, source.account_id, source_account.name, source.date
             FROM transactions t
             LEFT JOIN debt_payments dp ON dp.generated_transaction_id = t.id
             LEFT JOIN transactions source ON source.id = dp.source_transaction_id AND source.deleted_at IS NULL
             LEFT JOIN accounts source_account ON source_account.id = source.account_id
             WHERE t.account_id = ?1 AND t.deleted_at IS NULL {extra}
             ORDER BY t.date DESC, t.id DESC LIMIT ?2"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let map_row = |row: &rusqlite::Row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        };
        let rows = match statement_date {
            Some(date) => stmt
                .query_map(params![account_id, limit, date.to_string()], map_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
            None => stmt
                .query_map(params![account_id, limit], map_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?,
        };
        Ok(rows
            .into_iter()
            .map(
                |(
                    id,
                    date,
                    description,
                    amount,
                    category,
                    cleared,
                    payment_source_id,
                    payment_source_account_id,
                    payment_source_account_name,
                    payment_source_date,
                )| AccountTransaction {
                    payment_source_id,
                    payment_source_account_id,
                    payment_source_account_name,
                    payment_source_date: payment_source_date
                        .map(|date| NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("stored date must be valid")),
                    id,
                    date: NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                    description,
                    amount: Decimal::from_str(&amount).expect("amount stored by this crate must be valid"),
                    category,
                    cleared,
                },
            )
            .collect())
    }

    /// An account's most recent transactions, newest first, each with its
    /// cleared flag.
    pub fn list_account_transactions(&self, account_id: i64, limit: usize) -> rusqlite::Result<Vec<AccountTransaction>> {
        self.account_transactions_where(account_id, "", limit as i64, None)
    }

    /// The transactions to tick through for a statement ending on
    /// `statement_date`: everything dated on or before it that hasn't been
    /// cleared yet, plus what was cleared since the last finished
    /// reconciliation (so an earlier tick can still be undone). Anything
    /// cleared before that reconciliation is settled and stays out of the way.
    pub fn reconcile_candidates(&self, account_id: i64, statement_date: NaiveDate) -> rusqlite::Result<Vec<AccountTransaction>> {
        let settled_through = self.last_reconciliation(account_id)?.map(|(date, _)| date);
        let extra = match settled_through {
            Some(date) => format!("AND t.date <= ?3 AND (t.cleared = 0 OR t.date > '{date}')"),
            None => "AND t.date <= ?3".to_string(),
        };
        self.account_transactions_where(account_id, &extra, i64::MAX, Some(statement_date))
    }

    /// An account's balance at the end of each of the last `months` months,
    /// the final point being `today` itself — the account detail page's
    /// balance chart. Built from the account's transactions, the same as
    /// `list_accounts`'s balance for it; an investment account's holdings
    /// aren't tracked historically, so its history shows only its cash side.
    pub fn account_balance_history(&self, account_id: i64, today: NaiveDate, months: u32) -> rusqlite::Result<Vec<(NaiveDate, Decimal)>> {
        let (account_type, starting): (String, String) = self.conn.query_row(
            "SELECT account_type, starting_balance FROM accounts WHERE id = ?1",
            params![account_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let starting = Decimal::from_str(&starting).expect("starting_balance stored by this crate must be valid");

        let mut history = Vec::with_capacity(months as usize);
        for back in (0..months).rev() {
            let as_of = if back == 0 {
                today
            } else {
                let index = i64::from(today.year()) * 12 + i64::from(today.month()) - 1 - i64::from(back);
                let (y, m) = (index.div_euclid(12) as i32, (index.rem_euclid(12) + 1) as u32);
                month_bounds(y, m).1.pred_opt().expect("a month's last day exists")
            };
            history.push((as_of, self.account_balance_as_of(account_id, &account_type, starting, as_of)?));
        }
        Ok(history)
    }

    /// Every investment account's total holdings value (`SUM(shares *
    /// price)`), keyed by account id. An account with no holdings rows
    /// simply has no entry, letting callers fall back to its transaction-
    /// derived balance instead of treating "no holdings yet" as "worth
    /// zero" (see `list_accounts`/`account_contributions_as_of`).
    pub(super) fn holdings_value_by_account(&self) -> rusqlite::Result<std::collections::HashMap<i64, Decimal>> {
        let mut stmt = self.conn.prepare("SELECT account_id, shares, price FROM holdings")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))?;
        let mut totals: std::collections::HashMap<i64, Decimal> = std::collections::HashMap::new();
        for row in rows {
            let (account_id, shares_str, price_str) = row?;
            let shares = Decimal::from_str(&shares_str).expect("shares stored by this crate must be valid");
            let price = Decimal::from_str(&price_str).expect("price stored by this crate must be valid");
            *totals.entry(account_id).or_insert(Decimal::ZERO) += shares * price;
        }
        Ok(totals)
    }

    /// Every account, each with its balance computed fresh as of `today`
    /// (see `account_balance_as_of`) — not a stored running total, so
    /// it's never out of sync with either the transaction log or any
    /// monthly reset.
    pub fn list_accounts(&self, today: NaiveDate) -> rusqlite::Result<Vec<StoredAccount>> {
        let holdings_value = self.holdings_value_by_account()?;
        let mut stmt = self.conn.prepare(
            "SELECT a.id, a.name, a.account_type, a.starting_balance, a.institution, a.mask, a.interest_rate,
                    a.excluded_from_debt_payoff, a.member_id, fm.name, a.icon_key, a.import_flip_signs
             FROM accounts a
             LEFT JOIN family_members fm ON fm.id = a.member_id
             ORDER BY a.name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, bool>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<bool>>(11)?,
            ))
        })?;

        let mut accounts = Vec::new();
        for row in rows {
            let (
                id,
                name,
                account_type,
                starting_balance_str,
                institution,
                mask,
                interest_rate_str,
                excluded_from_debt_payoff,
                member_id,
                member_name,
                icon_key,
                import_flip_signs,
            ) = row?;
            let starting_balance = Decimal::from_str(&starting_balance_str).expect("starting_balance stored by this crate must be valid");
            let checkpoint_date = self.latest_checkpoint(id, today)?.map(|(date, _)| date);
            let mut current_balance = self.account_balance_as_of(id, &account_type, starting_balance, today)?;
            // An investment account's real worth is what it holds, not
            // whatever cash transactions happen to have touched the
            // account — once it has any holdings tracked, their total
            // value replaces the transaction-derived balance entirely (a
            // still-empty, freshly created investment account has no
            // entry in `holdings_value` yet, so it keeps its transaction-
            // derived balance until the first holding is added). This was
            // a real gap: a portfolio tracked entirely through Holdings
            // (never a matching deposit transaction) showed as $0 in Net
            // Worth, Accounts, and Household everywhere, despite the
            // Investments tab correctly showing its real value.
            if account_type == "investment"
                && let Some(&value) = holdings_value.get(&id)
            {
                current_balance = value;
            }
            let interest_rate = interest_rate_str.map(|s| Decimal::from_str(&s).expect("interest_rate stored by this crate must be valid"));
            accounts.push(StoredAccount {
                id,
                account: Account {
                    name,
                    account_type: AccountType::parse(&account_type).expect("account_type stored by this crate must be valid"),
                },
                starting_balance,
                current_balance,
                institution,
                mask,
                interest_rate,
                excluded_from_debt_payoff,
                member_id,
                member_name,
                checkpoint_date,
                icon_key,
                import_flip_signs,
            });
        }
        Ok(accounts)
    }

    /// Applies a parsed setup-import template (see `setup_import`) in a
    /// fixed order — accounts, then categories, then budgets, then
    /// buckets — so a bucket's `linked_account_name` can resolve against
    /// an account the same file just created. Every section reuses its
    /// normal creation path, so the result is exactly what typing the
    /// same values into the UI would produce: accounts via `create_account`
    /// (a name already in use is skipped, never overwritten), categories via the `INSERT OR IGNORE`
    /// `create_category`, budgets via the upserting `set_budget` (a blank
    /// period falls back to `default_period` — passed in rather than read
    /// from the clock, keeping this testable), and buckets via
    /// `create_bucket`, whose duplicate-name error is caught per row and
    /// recorded in `skipped` instead of aborting the rest of the import.
    /// A bucket's linked account that matches nothing (not in this file,
    /// not already in the app) is also a skip, not an error — the bucket
    /// itself is still created, just unlinked.
    pub fn apply_setup_import(&self, data: &crate::setup_import::SetupImportResult, default_period: &str) -> rusqlite::Result<SetupImportOutcome> {
        let mut outcome = SetupImportOutcome::default();

        for row in &data.accounts {
            let account_type = AccountType::parse(&row.account_type).expect("setup_import validated account_type against the known set");
            // An existing account keeps its balance and details; the file's row is skipped.
            let Some(id) = self.create_account(&row.name, account_type)? else {
                outcome.skipped.push(format!("{}: an account with this name already exists", row.name));
                continue;
            };
            if let Some(balance) = row.starting_balance {
                self.set_account_starting_balance(id, balance)?;
            }
            if row.institution.is_some() || row.mask.is_some() {
                self.set_account_details(id, row.institution.as_deref(), row.mask.as_deref())?;
            }
            outcome.accounts_created += 1;
        }

        for row in &data.categories {
            self.create_category(&row.name, None)?;
            outcome.categories_created += 1;
        }

        for row in &data.budgets {
            let period = row.period.as_deref().unwrap_or(default_period);
            self.set_budget(&row.category, period, row.monthly_amount, &row.budget_group)?;
            self.create_category(&row.category, None)?;
            outcome.budgets_set += 1;
        }

        for row in &data.buckets {
            let account_id = match &row.linked_account_name {
                Some(name) => {
                    let found = self
                        .conn
                        .query_row("SELECT id FROM accounts WHERE name = ?1 COLLATE NOCASE", params![name], |r| {
                            r.get::<_, i64>(0)
                        });
                    match found {
                        Ok(id) => Some(id),
                        Err(rusqlite::Error::QueryReturnedNoRows) => {
                            outcome
                                .skipped
                                .push(format!("{}: linked account '{name}' not found — bucket created without a link", row.name));
                            None
                        }
                        Err(e) => return Err(e),
                    }
                }
                None => None,
            };
            match self.create_bucket(&row.name, row.target_amount, row.target_date, account_id, None, None, None) {
                Ok(_) => outcome.buckets_created += 1,
                Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == rusqlite::ErrorCode::ConstraintViolation => {
                    outcome.skipped.push(format!("{}: a bucket with this name already exists", row.name));
                }
                Err(e) => return Err(e),
            }
        }

        for row in &data.holdings {
            let found = self
                .conn
                .query_row("SELECT id FROM accounts WHERE name = ?1 COLLATE NOCASE", params![row.account_name], |r| {
                    r.get::<_, i64>(0)
                });
            let account_id = match found {
                Ok(id) => id,
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    outcome
                        .skipped
                        .push(format!("{}: account '{}' not found — holding not created", row.symbol, row.account_name));
                    continue;
                }
                Err(e) => return Err(e),
            };
            if row.shares <= Decimal::ZERO || row.price <= Decimal::ZERO || row.cost_basis < Decimal::ZERO {
                outcome
                    .skipped
                    .push(format!("{}: shares/price must be positive and cost basis can't be negative", row.symbol));
                continue;
            }
            let name = row.name.as_deref().unwrap_or(&row.symbol);
            self.create_holding(
                account_id,
                &row.symbol,
                name,
                row.shares,
                row.price,
                row.cost_basis,
                row.asset_class.as_deref(),
            )?;
            outcome.holdings_created += 1;
        }

        Ok(outcome)
    }

    /// Rolls every account's balance forward into a fresh reset once per
    /// calendar month — the first time the app opens in a new month,
    /// whatever `current_balance` shows becomes that account's baseline
    /// for everything going forward, so a manually-tracked account (a
    /// loan, an investment, a house) never needs its balance retyped
    /// from scratch. Past "balance as of" lookups are unaffected: they
    /// use whichever reset (or the original `starting_balance`) applied
    /// back then, never today's — see `account_balance_as_of`. Safe to
    /// call on every launch: a period that already has a reset for an
    /// account is left alone (`UNIQUE(account_id, period)`).
    ///
    /// Applies uniformly to every account, not just manually-tracked
    /// ones — harmless for an actively-imported account too, since
    /// nothing is deleted. One accepted edge case: a transaction
    /// imported *later* with a date before the most recent reset won't
    /// affect *today's* balance, only past point-in-time lookups — a
    /// known limitation, same spirit as the top-merchants
    /// raw-description grouping documented on `top_merchants` (`store/reports.rs`).
    ///
    /// Returns `(account_id, account_name, new_balance)` for every
    /// account that got a *fresh* reset in this call, so the caller can
    /// show a one-time note — empty on every call after the first one
    /// this month.
    pub fn roll_forward_monthly_balances(&self, today: NaiveDate) -> rusqlite::Result<Vec<(i64, String, Decimal)>> {
        let period = format!("{:04}-{:02}", today.year(), today.month());

        let mut stmt = self.conn.prepare("SELECT id, name, starting_balance, account_type FROM accounts")?;
        let accounts: Vec<(i64, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        // The new baseline represents everything through the *end of the
        // prior day*, not "as of this exact moment" — anchoring it to
        // `today` instead would bake in only whatever transactions already
        // existed the instant this ran, then `account_balance_as_of`'s
        // `date > since_date` window would permanently exclude anything
        // dated today added afterward (importing a statement, applying a
        // debt payment, etc. later the same day this rolled), since a
        // same-day transaction can never be both "after today" and "on or
        // before today" at once. Anchoring to yesterday means every
        // transaction dated today counts today, no matter when today it's
        // added, and self-corrects nothing tomorrow that wasn't already
        // correct.
        let reset_date = today.pred_opt().expect("NaiveDate::pred_opt only fails at the calendar's minimum date");

        let mut rolled = Vec::new();
        for (id, name, starting_balance_str, account_type) in accounts {
            let already_done: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM balance_resets WHERE account_id = ?1 AND period = ?2)",
                params![id, period],
                |row| row.get(0),
            )?;
            if already_done {
                continue;
            }

            let starting_balance = Decimal::from_str(&starting_balance_str).expect("starting_balance stored by this crate must be valid");
            let balance = self.account_balance_as_of(id, &account_type, starting_balance, reset_date)?;

            let before = self.displayed_balance_for_log(id);
            self.conn.execute(
                "INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?1, ?2, ?3, ?4)",
                params![id, period, reset_date.to_string(), balance.to_string()],
            )?;
            let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(id));
            self.log_activity(&format!(
                "{name}: monthly rollover — new baseline {balance} as of {reset_date} — {snapshot}"
            ));
            rolled.push((id, name, balance));
        }
        Ok(rolled)
    }

    /// Sets (or corrects) an account's original starting balance / credit
    /// limit. Once an account has gone through even one monthly rollover
    /// (see `roll_forward_monthly_balances`) — which happens automatically
    /// on the first launch of every month — this value stops affecting
    /// `current_balance` at all, since `account_balance_as_of` always
    /// prefers the latest `balance_resets` checkpoint over it. To correct
    /// a checking/savings/loan account's *current* balance after that
    /// point, use `set_account_balance_override` instead — this method
    /// remains the right one for a credit account's limit (which has no
    /// reset-based equivalent) or for backfilling history before any
    /// transactions exist. An unknown id is a harmless no-op, same
    /// convention as `set_category`.
    pub fn set_account_starting_balance(&self, id: i64, balance: Decimal) -> rusqlite::Result<()> {
        let existing = self
            .conn
            .query_row("SELECT name, starting_balance FROM accounts WHERE id = ?1", params![id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            });
        let before = self.displayed_balance_for_log(id);
        self.conn.execute(
            "UPDATE accounts SET starting_balance = ?1 WHERE id = ?2",
            params![balance.to_string(), id],
        )?;
        if let Ok((name, old_balance)) = existing {
            // A starting balance stops affecting `current_balance` at all
            // once a later `balance_resets` checkpoint exists (see this
            // method's own doc comment) — the balance snapshot makes that
            // visible instead of implying every correction here actually
            // moves the account.
            let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(id));
            self.log_activity(&format!("{name}: starting balance corrected: {old_balance} -> {balance} — {snapshot}"));
        }
        Ok(())
    }

    /// Corrects an account's *current* balance without touching any
    /// existing transaction — inserts a `balance_resets` checkpoint,
    /// exactly like `roll_forward_monthly_balances` does once a month,
    /// just triggered on demand instead. `account_balance_as_of` then uses
    /// this value as the new baseline for every date on or after `as_of`,
    /// while every earlier "balance as of" lookup (sparklines, trends,
    /// past net worth) is untouched.
    ///
    /// `balance` is treated as authoritative for right now: calling this
    /// makes `current_balance` equal `balance` *immediately*, no matter
    /// what's already recorded dated `as_of`. Only a transaction
    /// added *after* this call (any date from here on, including later
    /// the same day) moves it further — that's the whole point of a
    /// manual correction, and a user typing "$20,000" who then sees some
    /// other number because of a transaction they forgot was already
    /// there is exactly the confusing, unfriendly behavior this method
    /// exists to avoid.
    ///
    /// The checkpoint itself is stored dated the day *before* `as_of`, not
    /// `as_of` itself — same trick as `roll_forward_monthly_balances` (see
    /// its own comment): a transaction dated `as_of` must still count on
    /// top of this correction, whether it's added a second before this
    /// call or added a year later. Storing the checkpoint on `as_of`
    /// itself would make `account_balance_as_of`'s `date > since_date`
    /// filter permanently exclude anything dated `as_of` added afterward,
    /// since a same-day transaction can never be both "after `as_of`" and
    /// "on or before `as_of`" at once. But that means any transaction
    /// *already* dated `as_of` at the moment this is called would
    /// otherwise be summed a second time on top of `balance` (once
    /// implicitly, since the user is looking at a total that already
    /// includes it; once explicitly, by `account_balance_as_of` itself) —
    /// so the checkpoint's stored value nets those back out up front:
    /// `balance` minus whatever's already posted `as_of`, so the two
    /// cancel out to exactly `balance` and only genuinely new activity
    /// moves it from there.
    ///
    /// Uses its own `period` key (`"manual:<as_of>"`) so it can never
    /// collide with — or silently overwrite — that month's automatic
    /// rollover row; calling this again for the same `as_of` date replaces
    /// the earlier correction instead of stacking a second one. An unknown
    /// id is a harmless no-op, same convention as `set_account_starting_balance`.
    pub fn set_account_balance_override(&self, id: i64, balance: Decimal, as_of: NaiveDate) -> rusqlite::Result<()> {
        let account_type: String = match self
            .conn
            .query_row("SELECT account_type FROM accounts WHERE id = ?1", params![id], |row| row.get(0))
        {
            Ok(account_type) => account_type,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e),
        };

        let mut stmt = self
            .conn
            .prepare("SELECT COALESCE(principal_amount, amount) FROM transactions WHERE account_id = ?1 AND date = ?2 AND deleted_at IS NULL")?;
        let already_posted_today: Vec<String> = stmt
            .query_map(params![id, as_of.to_string()], |row| row.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt);
        let already_posted_today: Decimal = already_posted_today
            .iter()
            .map(|a| Decimal::from_str(a).expect("amount stored by this crate must be valid"))
            .sum();
        // Mirrors account_balance_as_of's group-aware direction: a loan's
        // current_balance is netted by subtracting transactions, so
        // undoing today's already-posted ones ahead of that subtraction
        // means adding them back here instead of subtracting.
        let checkpoint_balance = if account_type == "loan" {
            balance + already_posted_today
        } else {
            balance - already_posted_today
        };

        let period = format!("manual:{as_of}");
        let reset_date = as_of.pred_opt().expect("NaiveDate::pred_opt only fails at the calendar's minimum date");
        let before = self.displayed_balance_for_log(id);
        self.conn.execute(
            "INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(account_id, period) DO UPDATE SET reset_date = excluded.reset_date, balance = excluded.balance",
            params![id, period, reset_date.to_string(), checkpoint_balance.to_string()],
        )?;
        // The snapshot reflects *today's* resulting number, which can
        // differ from `balance` itself when `as_of` is backdated (any
        // transaction already posted between `as_of` and today keeps
        // counting on top of this correction — see this method's own doc
        // comment).
        let snapshot = Self::describe_balance_snapshot(before, self.displayed_balance_for_log(id));
        self.log_activity(&format!(
            "{}: balance manually corrected to {balance} as of {as_of} — {snapshot}",
            self.account_name_for_log(id)
        ));
        Ok(())
    }

    /// Sets an account's institution name and masked account number — both
    /// purely cosmetic (e.g. "Chase" / "4821"), either can be `None`.
    pub fn set_account_details(&self, id: i64, institution: Option<&str>, mask: Option<&str>) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE accounts SET institution = ?1, mask = ?2 WHERE id = ?3",
            params![institution, mask, id],
        )?;
        Ok(())
    }

    /// Sets (or clears, with `None`) an account's explicit icon override —
    /// same "not validated at this layer" convention as
    /// `Store::create_bucket`'s `icon_key`; the frontend only ever offers a
    /// fixed set of keys.
    pub fn set_account_icon(&self, id: i64, icon_key: Option<&str>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE accounts SET icon_key = ?1 WHERE id = ?2", params![icon_key, id])?;
        Ok(())
    }

    /// Sets (or clears, with `None`) an account's annual interest rate —
    /// used only by `debt_payoff_projection`, meaningless for a non-debt
    /// account type but not restricted to one, same "don't over-validate"
    /// convention as the rest of this crate.
    pub fn set_account_interest_rate(&self, id: i64, rate: Option<Decimal>) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE accounts SET interest_rate = ?1 WHERE id = ?2",
            params![rate.map(|r| r.to_string()), id],
        )?;
        Ok(())
    }

    /// Opts a debt account in or out of `debt_payoff_projection` (see
    /// `StoredAccount::excluded_from_debt_payoff`) without deleting it.
    pub fn set_account_excluded_from_debt_payoff(&self, id: i64, excluded: bool) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE accounts SET excluded_from_debt_payoff = ?1 WHERE id = ?2", params![excluded, id])?;
        Ok(())
    }

    /// Sets (or clears, with `None`) which family member owns an account —
    /// purely an attribution label (see `FamilyMember`), doesn't affect any
    /// balance calculation. `save_transactions`/`apply_debt_payment` use
    /// this as the default a new transaction on this account inherits.
    pub fn set_account_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE accounts SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// Corrects an account's type after the fact (created as the wrong
    /// kind by mistake). An unknown id is a harmless no-op, same
    /// convention as everything else here.
    pub fn update_account_type(&self, id: i64, account_type: AccountType) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE accounts SET account_type = ?1 WHERE id = ?2", params![account_type.as_str(), id])?;
        Ok(())
    }

    /// Deletes an account and every one of its transactions — an account
    /// can't be left behind with `transactions.account_id NOT NULL`
    /// pointing at nothing, so this cascades explicitly rather than
    /// erroring or orphaning rows (same reasoning as `delete_bucket`
    /// cascading its contributions).
    ///
    /// Each transaction goes through `hard_delete_transaction_row` — a real
    /// `DELETE`, deliberately *not* `delete_transaction`'s soft-delete —
    /// since foreign keys are enforced on this connection (`transactions
    /// .account_id ... REFERENCES accounts(id)`) and a soft-deleted row
    /// still physically exists and still points at this account, which
    /// would trip that constraint the moment the `DELETE FROM accounts`
    /// below runs. There's no "undo delete account" feature that would
    /// ever need these back, unlike the Transactions tab's bulk-delete "Undo," so
    /// there's nothing lost by not going through the soft-delete path
    /// here. Holdings and balance-reset snapshots for this account are
    /// swept the same way. A recurring item pointing here just loses the
    /// link (falls back to "no linked account") rather than being deleted
    /// itself, since it doesn't stop existing just because the account
    /// that used to pay it did. Returns how many transactions were
    /// removed, for the confirm dialog's copy. An unknown id is a
    /// harmless no-op.
    pub fn delete_account(&self, id: i64) -> rusqlite::Result<usize> {
        let mut stmt = self.conn.prepare("SELECT id FROM transactions WHERE account_id = ?1")?;
        let tx_ids: Vec<i64> = stmt.query_map(params![id], |row| row.get(0))?.collect::<rusqlite::Result<_>>()?;
        drop(stmt);
        for tx_id in &tx_ids {
            self.hard_delete_transaction_row(*tx_id)?;
        }

        self.conn
            .execute("UPDATE recurring SET account_id = NULL WHERE account_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM holdings WHERE account_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM investment_plans WHERE account_id = ?1", params![id])?;
        self.conn
            .execute("DELETE FROM account_value_snapshots WHERE account_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM balance_resets WHERE account_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
        Ok(tx_ids.len())
    }
}
