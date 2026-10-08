//! Investments: holdings, value snapshots, contributions, investment plans and allocation targets.

use super::{Store, first_of_month};
use crate::models::AccountType;
use chrono::{Datelike, NaiveDate};
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

/// An investment holding, with `value` and `gain_loss` computed fresh
/// from `shares`/`price`/`cost_basis` (never stored — a manually-entered
/// price should always immediately recompute both).
#[derive(Debug, Clone, PartialEq)]
pub struct StoredHolding {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub symbol: String,
    pub name: String,
    pub shares: Decimal,
    pub price: Decimal,
    pub cost_basis: Decimal,
    pub asset_class: Option<String>,
    pub value: Decimal,
    pub gain_loss: Decimal,
    /// The price this holding was last known at before the calendar day
    /// its price was most recently updated on — i.e. today's baseline, once
    /// at least one price update has landed today. `None` until a price
    /// update actually happens (a holding just created today, or one never
    /// repriced since, has no "today" to measure movement across yet).
    pub prev_close: Option<Decimal>,
    /// `(price - prev_close) * shares` — how much this holding has moved
    /// since `prev_close`, computed fresh like `gain_loss`. `None` exactly
    /// when `prev_close` is `None`.
    pub day_gain_loss: Option<Decimal>,
}

/// One calendar month of money moving in and out of one account — a row of
/// `AccountContributions`. `month` is `"YYYY-MM"`; `money_out` is a positive
/// figure (the size of what left).
#[derive(Debug, Clone, PartialEq)]
pub struct ContributionMonth {
    pub month: String,
    pub money_in: Decimal,
    pub money_out: Decimal,
}

/// What has gone into (and come out of) one account, from its own
/// transactions — see `Store::account_contributions`.
#[derive(Debug, Clone, PartialEq)]
pub struct AccountContributions {
    /// Oldest first: every month from the first activity to the last, with a
    /// month nothing happened in shown as zero.
    pub months: Vec<ContributionMonth>,
    pub total_in: Decimal,
    pub total_out: Decimal,
    /// `total_in - total_out`.
    pub net: Decimal,
    /// The date of the first money-in, if there has been one.
    pub first_deposit: Option<NaiveDate>,
    /// How many money-in transactions there are.
    pub deposit_count: usize,
}

/// The saved assumptions behind one investment account's projection. Every
/// field is optional or defaulted: an account nobody has set up yet reads as
/// `InvestmentPlan::default()`.
#[derive(Debug, Clone, PartialEq)]
pub struct InvestmentPlan {
    /// The flat amount put in each month; `None` means "use the recent average".
    pub monthly_contribution: Option<Decimal>,
    /// The yearly return the projection assumes, as a percentage.
    pub annual_return_pct: Decimal,
    /// When the money is wanted, kept as the first day of that month.
    pub withdraw_month: Option<NaiveDate>,
    /// Spread the withdrawals over this many years; `None` takes it all at once.
    pub withdraw_years: Option<u32>,
}

impl Default for InvestmentPlan {
    fn default() -> Self {
        InvestmentPlan {
            monthly_contribution: None,
            annual_return_pct: Decimal::from(DEFAULT_ANNUAL_RETURN_PCT),
            withdraw_month: None,
            withdraw_years: None,
        }
    }
}

/// The return assumed until someone edits it — the same 7% the Investments
/// tab's what-if calculator starts from.
const DEFAULT_ANNUAL_RETURN_PCT: i64 = 7;

/// The inflation assumed by "today's dollars" until someone edits it.
const DEFAULT_INFLATION_PCT: i64 = 3;

/// Why saving an investment plan (or the inflation figure) failed: either the
/// numbers were refused, with a message meant to be shown as-is, or the
/// database itself errored.
#[derive(Debug)]
pub enum PlanError {
    Invalid(String),
    Db(rusqlite::Error),
}

impl std::fmt::Display for PlanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PlanError::Invalid(message) => write!(f, "{message}"),
            PlanError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for PlanError {}

impl From<rusqlite::Error> for PlanError {
    fn from(e: rusqlite::Error) -> Self {
        PlanError::Db(e)
    }
}

impl Store {
    /// Add reviewed current positions and their value snapshots as one unit.
    pub fn import_holdings(&self, account_id: i64, rows: &[crate::holding_import::HoldingInput], today: NaiveDate) -> Result<Vec<i64>, String> {
        use std::collections::HashSet;
        if rows.is_empty() || rows.len() > crate::holding_import::MAX_ROWS {
            return Err("Select between 1 and 5,000 valid holdings.".into());
        }
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let account = self
            .list_accounts(today)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|a| a.id == account_id && a.account.account_type == AccountType::Investment)
            .ok_or("Choose an existing investment account.")?;
        let existing = self.list_holdings(today).map_err(|e| e.to_string())?;
        let mut symbols: HashSet<String> = existing
            .iter()
            .filter(|h| h.account_id == account.id)
            .map(|h| h.symbol.trim().to_uppercase())
            .collect();
        // Also protect subsequent portfolio sums from Decimal overflow.
        let mut total = existing
            .iter()
            .try_fold(Decimal::ZERO, |sum, h| crate::holding_import::add_values(sum, h.value))?;
        for row in rows {
            row.validate()?;
            if !symbols.insert(row.symbol.trim().to_uppercase()) {
                return Err(format!(
                    "{} already exists in this account or selection. Review the rows again.",
                    row.symbol
                ));
            }
            total = crate::holding_import::add_values(total, row.value()?)?;
        }
        let mut ids = Vec::with_capacity(rows.len());
        for row in rows {
            let (shares, price, cost) = row.amounts()?;
            ids.push(
                self.create_holding(account.id, &row.symbol, &row.name, shares, price, cost, row.asset_class.as_deref())
                    .map_err(|e| e.to_string())?,
            );
        }
        self.record_portfolio_snapshot(today).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(ids)
    }
    /// Adds an investment holding. `price` is whatever the caller passes in
    /// at creation time — manually typed, or auto-filled from a live quote
    /// when the optional Alpha Vantage integration is enabled (see
    /// `get_live_price_settings`). Either way it's just a starting value;
    /// `update_holding_price`/`update_holding_prices_for_symbol` are how it
    /// changes afterward.
    // Same reasoning as `create_bucket` (`store/buckets.rs`) — one independent argument
    // per `holdings` column.
    #[allow(clippy::too_many_arguments)]
    pub fn create_holding(
        &self,
        account_id: i64,
        symbol: &str,
        name: &str,
        shares: Decimal,
        price: Decimal,
        cost_basis: Decimal,
        asset_class: Option<&str>,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                account_id,
                symbol,
                name,
                shares.to_string(),
                price.to_string(),
                cost_basis.to_string(),
                asset_class,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Every holding, each with `value` (`shares * price`) and `gain_loss`
    /// (`value - cost_basis`) computed fresh — never stored, so an
    /// updated price is always immediately reflected in both.
    ///
    /// `today` gates `prev_close`/`day_gain_loss`: a row only reports them
    /// when its `prev_close_date` is actually `today` — i.e. its price was
    /// updated at least once today. A holding last repriced days or weeks
    /// ago still has a `prev_close` sitting in the column (from whenever
    /// that update happened), but surfacing it as "today's" change would
    /// misrepresent a stale multi-day-old baseline as today's move, so it's
    /// treated the same as never having been priced today: `None`.
    pub fn list_holdings(&self, today: NaiveDate) -> rusqlite::Result<Vec<StoredHolding>> {
        let mut stmt = self.conn.prepare(
            "SELECT h.id, h.account_id, a.name, h.symbol, h.name, h.shares, h.price, h.cost_basis, h.asset_class, h.prev_close, h.prev_close_date
             FROM holdings h
             JOIN accounts a ON a.id = h.account_id
             ORDER BY a.name, h.symbol",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
            ))
        })?;

        let today_str = today.to_string();
        let mut result = Vec::new();
        for row in rows {
            let (id, account_id, account_name, symbol, name, shares, price, cost_basis, asset_class, prev_close, prev_close_date) = row?;
            let shares = Decimal::from_str(&shares).expect("shares stored by this crate must be valid");
            let price = Decimal::from_str(&price).expect("price stored by this crate must be valid");
            let cost_basis = Decimal::from_str(&cost_basis).expect("cost_basis stored by this crate must be valid");
            let prev_close = if prev_close_date.as_deref() == Some(today_str.as_str()) {
                prev_close.map(|s| Decimal::from_str(&s).expect("prev_close stored by this crate must be valid"))
            } else {
                None
            };
            let value = shares * price;
            result.push(StoredHolding {
                id,
                account_id,
                account_name,
                symbol,
                name,
                shares,
                price,
                cost_basis,
                asset_class,
                value,
                gain_loss: value - cost_basis,
                prev_close,
                day_gain_loss: prev_close.map(|pc| (price - pc) * shares),
            });
        }
        Ok(result)
    }

    /// Updates a holding's price (the only field expected to change often).
    /// `today` drives the same day-boundary snapshot as
    /// `update_holding_prices_for_symbol` below — see its doc comment for
    /// the mechanics. An unknown id is a harmless no-op.
    pub fn update_holding_price(&self, id: i64, price: Decimal, today: NaiveDate) -> rusqlite::Result<()> {
        let today = today.to_string();
        self.conn.execute(
            "UPDATE holdings
             SET prev_close = CASE WHEN prev_close_date IS NULL OR prev_close_date <> ?1 THEN price ELSE prev_close END,
                 prev_close_date = ?1,
                 price = ?2
             WHERE id = ?3",
            params![today, price.to_string(), id],
        )?;
        Ok(())
    }

    /// Records what every holding is worth in total on `date` (shares times
    /// price, summed), replacing an earlier snapshot of the same day so the
    /// last price of the day wins. Called after each price refresh and
    /// holding change, it builds the portfolio's value history. Returns
    /// whether anything was written — with no holdings there's nothing worth
    /// recording, and a run of zeros would only distort the chart.
    pub fn record_portfolio_snapshot(&self, date: NaiveDate) -> rusqlite::Result<bool> {
        // Each investment account's own value goes down in the same breath (its
        // Details page charts it), whether or not any holdings exist to total.
        self.record_account_value_snapshots(date)?;
        let holdings = self.list_holdings(date)?;
        if holdings.is_empty() {
            return Ok(false);
        }
        let total: Decimal = holdings.iter().map(|h| h.value).sum();
        self.conn.execute(
            "INSERT INTO portfolio_snapshots (date, value) VALUES (?1, ?2)
             ON CONFLICT(date) DO UPDATE SET value = excluded.value",
            params![date.to_string(), total.to_string()],
        )?;
        Ok(true)
    }

    /// Records what each investment account is worth on `date`: its holdings'
    /// value once it has holdings, otherwise its transaction balance — exactly
    /// the figure `list_accounts` shows, so the chart and the Accounts tab
    /// agree. One row per account per day (a later write the same day replaces
    /// it). An account with no holdings and a zero balance has nothing worth
    /// recording, and a run of zeros would only distort its chart — except on
    /// the day it became empty: its last recorded value was above zero, so the
    /// drop is real and is recorded once.
    fn record_account_value_snapshots(&self, date: NaiveDate) -> rusqlite::Result<()> {
        let with_holdings = self.holdings_value_by_account()?;
        for account in self.list_accounts(date)? {
            if account.account.account_type != AccountType::Investment {
                continue;
            }
            if !with_holdings.contains_key(&account.id)
                && account.current_balance.is_zero()
                && !self.latest_account_value_is_above_zero(account.id)?
            {
                continue;
            }
            self.conn.execute(
                "INSERT INTO account_value_snapshots (account_id, date, value) VALUES (?1, ?2, ?3)
                 ON CONFLICT(account_id, date) DO UPDATE SET value = excluded.value",
                params![account.id, date.to_string(), account.current_balance.to_string()],
            )?;
        }
        Ok(())
    }

    /// Whether an account's most recent recorded value is above zero: the one
    /// case where recording a zero says something (the account just emptied).
    fn latest_account_value_is_above_zero(&self, account_id: i64) -> rusqlite::Result<bool> {
        match self.conn.query_row(
            "SELECT value FROM account_value_snapshots WHERE account_id = ?1 ORDER BY date DESC LIMIT 1",
            params![account_id],
            |row| row.get::<_, String>(0),
        ) {
            Ok(value) => Ok(!Decimal::from_str(&value).expect("value stored by this crate must be valid").is_zero()),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// One investment account's recorded values, oldest first. Real
    /// snapshots only — nothing is estimated for the days before the first.
    pub fn account_value_history(&self, account_id: i64) -> rusqlite::Result<Vec<(NaiveDate, Decimal)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT date, value FROM account_value_snapshots WHERE account_id = ?1 ORDER BY date")?;
        let rows = stmt.query_map(params![account_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        let mut history = Vec::new();
        for row in rows {
            let (date, value) = row?;
            history.push((
                NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                Decimal::from_str(&value).expect("value stored by this crate must be valid"),
            ));
        }
        Ok(history)
    }

    /// What has gone into, and come out of, one account: every money-in and
    /// money-out transaction on it dated `today` or earlier, grouped by
    /// calendar month. Soft-deleted rows and other accounts' rows never count,
    /// and neither do balance corrections (they move the balance, not what
    /// was contributed). A linked transfer has one leg in each account, so it
    /// counts once, on the account it is read for.
    pub fn account_contributions(&self, account_id: i64, today: NaiveDate) -> rusqlite::Result<AccountContributions> {
        let mut stmt = self.conn.prepare(
            "SELECT date, amount FROM transactions
             WHERE account_id = ?1 AND date <= ?2 AND deleted_at IS NULL
             ORDER BY date",
        )?;
        let rows = stmt.query_map(params![account_id, today.to_string()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut by_month: std::collections::BTreeMap<(i32, u32), (Decimal, Decimal)> = std::collections::BTreeMap::new();
        let mut first_deposit: Option<NaiveDate> = None;
        let mut deposit_count = 0usize;
        for row in rows {
            let (date, amount) = row?;
            let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid");
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            if amount.is_zero() {
                continue;
            }
            let entry = by_month.entry((date.year(), date.month())).or_default();
            if amount > Decimal::ZERO {
                entry.0 += amount;
                deposit_count += 1;
                first_deposit.get_or_insert(date);
            } else {
                entry.1 += -amount;
            }
        }

        let mut months = Vec::new();
        if let (Some((&first, _)), Some((&last, _))) = (by_month.iter().next(), by_month.iter().next_back()) {
            let (mut year, mut month) = first;
            while (year, month) <= last {
                let (money_in, money_out) = by_month.get(&(year, month)).copied().unwrap_or_default();
                months.push(ContributionMonth {
                    month: format!("{year:04}-{month:02}"),
                    money_in,
                    money_out,
                });
                if month == 12 {
                    year += 1;
                    month = 1;
                } else {
                    month += 1;
                }
            }
        }

        let total_in: Decimal = months.iter().map(|m| m.money_in).sum();
        let total_out: Decimal = months.iter().map(|m| m.money_out).sum();
        Ok(AccountContributions {
            months,
            total_in,
            total_out,
            net: total_in - total_out,
            first_deposit,
            deposit_count,
        })
    }

    /// One investment account's saved plan, or the defaults when nobody has
    /// set one up.
    pub fn get_investment_plan(&self, account_id: i64) -> rusqlite::Result<InvestmentPlan> {
        let row = match self.conn.query_row(
            "SELECT monthly_contribution, annual_return_pct, withdraw_date, withdraw_years FROM investment_plans WHERE account_id = ?1",
            params![account_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            },
        ) {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(InvestmentPlan::default()),
            Err(e) => return Err(e),
        };
        let (monthly, return_pct, withdraw_date, withdraw_years) = row;
        Ok(InvestmentPlan {
            monthly_contribution: monthly.map(|s| Decimal::from_str(&s).expect("amount stored by this crate must be valid")),
            annual_return_pct: Decimal::from_str(&return_pct).expect("percent stored by this crate must be valid"),
            withdraw_month: withdraw_date.map(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").expect("date stored by this crate must be valid")),
            withdraw_years: withdraw_years.map(|y| y as u32),
        })
    }

    /// Saves one investment account's plan, after checking it: a return
    /// between 0 and 100 percent, a monthly amount that isn't negative, 1 to
    /// 50 withdrawal years, and a withdraw month that isn't in the past (this
    /// month is fine — and a month already saved may stay, so editing another
    /// field isn't blocked by a date the person never touched). A refused
    /// save writes nothing. The withdraw date is stored as the first of its
    /// month.
    pub fn set_investment_plan(&self, account_id: i64, plan: &InvestmentPlan, today: NaiveDate) -> Result<(), PlanError> {
        if plan.annual_return_pct < Decimal::ZERO || plan.annual_return_pct > Decimal::from(100) {
            return Err(PlanError::Invalid("The assumed return has to be between 0 and 100%.".to_string()));
        }
        if plan.monthly_contribution.is_some_and(|m| m < Decimal::ZERO) {
            return Err(PlanError::Invalid("The monthly amount can't be negative.".to_string()));
        }
        if plan.withdraw_years.is_some_and(|y| !(1..=50).contains(&y)) {
            return Err(PlanError::Invalid(
                "Spread the withdrawals over 1 to 50 years, or leave it blank.".to_string(),
            ));
        }
        let withdraw_month = plan.withdraw_month.map(first_of_month);
        if let Some(chosen) = withdraw_month
            && chosen < first_of_month(today)
            && self.get_investment_plan(account_id)?.withdraw_month != Some(chosen)
        {
            return Err(PlanError::Invalid(
                "That withdraw month is in the past — pick this month or later.".to_string(),
            ));
        }
        self.conn.execute(
            "INSERT INTO investment_plans (account_id, monthly_contribution, annual_return_pct, withdraw_date, withdraw_years)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(account_id) DO UPDATE SET
                 monthly_contribution = excluded.monthly_contribution,
                 annual_return_pct = excluded.annual_return_pct,
                 withdraw_date = excluded.withdraw_date,
                 withdraw_years = excluded.withdraw_years",
            params![
                account_id,
                plan.monthly_contribution.map(|m| m.to_string()),
                plan.annual_return_pct.to_string(),
                withdraw_month.map(|d| d.to_string()),
                plan.withdraw_years.map(|y| y as i64),
            ],
        )?;
        Ok(())
    }

    /// Saves an account's plan together with the shared inflation setting as
    /// ONE step: both are checked, and both are written or neither is, so a
    /// refusal of either can't leave the other one saved behind an error.
    /// `inflation` is `None` when the person didn't change it.
    pub fn set_investment_plan_with_inflation(
        &self,
        account_id: i64,
        plan: &InvestmentPlan,
        inflation: Option<Decimal>,
        today: NaiveDate,
    ) -> Result<(), PlanError> {
        // Dropped without `commit`, the transaction rolls back whatever was written.
        let tx = self.conn.unchecked_transaction()?;
        self.set_investment_plan(account_id, plan, today)?;
        if let Some(pct) = inflation {
            self.set_inflation_pct(pct)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// The inflation assumption behind "today's dollars" (a percentage per
    /// year); 3 until someone edits it.
    pub fn get_inflation_pct(&self) -> rusqlite::Result<Decimal> {
        match self
            .conn
            .query_row("SELECT inflation_pct FROM app_settings WHERE id = 1", [], |row| row.get::<_, String>(0))
        {
            Ok(s) => Ok(Decimal::from_str(&s).expect("percent stored by this crate must be valid")),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(Decimal::from(DEFAULT_INFLATION_PCT)),
            Err(e) => Err(e),
        }
    }

    /// Sets the inflation assumption (0 to 100 percent); a refused value
    /// changes nothing.
    pub fn set_inflation_pct(&self, pct: Decimal) -> Result<(), PlanError> {
        if pct < Decimal::ZERO || pct > Decimal::from(100) {
            return Err(PlanError::Invalid("Inflation has to be between 0 and 100%.".to_string()));
        }
        self.conn.execute(
            "INSERT INTO app_settings (id, inflation_pct) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET inflation_pct = ?1",
            params![pct.to_string()],
        )?;
        Ok(())
    }

    /// The recorded portfolio values, oldest first.
    pub fn portfolio_history(&self) -> rusqlite::Result<Vec<(NaiveDate, Decimal)>> {
        let mut stmt = self.conn.prepare("SELECT date, value FROM portfolio_snapshots ORDER BY date")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        let mut history = Vec::new();
        for row in rows {
            let (date, value) = row?;
            history.push((
                NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                Decimal::from_str(&value).expect("value stored by this crate must be valid"),
            ));
        }
        Ok(history)
    }

    /// Sets the share of the portfolio the user wants in an asset class
    /// (a percentage, capped at 100). Zero or less removes the target, since
    /// "no target" and "0%" would only differ by an empty row nobody asked for.
    pub fn set_allocation_target(&self, asset_class: &str, percent: Decimal) -> rusqlite::Result<()> {
        if percent <= Decimal::ZERO {
            self.conn
                .execute("DELETE FROM allocation_targets WHERE asset_class = ?1", params![asset_class])?;
            return Ok(());
        }
        let percent = percent.min(Decimal::from(100));
        self.conn.execute(
            "INSERT INTO allocation_targets (asset_class, percent) VALUES (?1, ?2)
             ON CONFLICT(asset_class) DO UPDATE SET percent = excluded.percent",
            params![asset_class, percent.to_string()],
        )?;
        Ok(())
    }

    /// Every asset class with a target, alphabetical.
    pub fn list_allocation_targets(&self) -> rusqlite::Result<Vec<(String, Decimal)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT asset_class, percent FROM allocation_targets ORDER BY asset_class")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        let mut targets = Vec::new();
        for row in rows {
            let (asset_class, percent) = row?;
            targets.push((
                asset_class,
                Decimal::from_str(&percent).expect("percent stored by this crate must be valid"),
            ));
        }
        Ok(targets)
    }

    /// Removes a holding. An unknown id is a harmless no-op.
    pub fn delete_holding(&self, id: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM holdings WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Every distinct symbol currently held, across every account — the
    /// list a live-price refresh fetches one quote per, regardless of how
    /// many holdings (or accounts) share that symbol.
    pub fn list_distinct_holding_symbols(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT DISTINCT symbol FROM holdings ORDER BY symbol")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect()
    }

    /// Applies one fetched quote to every holding of that symbol at once
    /// (a symbol can appear in more than one account) — the counterpart to
    /// `update_holding_price`, which targets a single holding by id. Returns
    /// how many rows were touched; an unknown symbol is a harmless no-op.
    ///
    /// **Day-gain/loss snapshot**: `prev_close` is only overwritten (to the
    /// row's *pre-update* `price`) when `prev_close_date` isn't already
    /// `today` — the first price update of the calendar day pins today's
    /// baseline, and every later update the same day updates `price`
    /// without disturbing that baseline, so `list_holdings`'s
    /// `day_gain_loss` reflects the full day's movement rather than just
    /// the latest refresh's delta. The `CASE` runs against each row's old
    /// `price`/`prev_close_date` — SQLite (like standard SQL `UPDATE`)
    /// evaluates every `SET` expression against the pre-update row, so
    /// referencing `price` here and assigning it below in the same
    /// statement is safe, not a read-after-write bug.
    pub fn update_holding_prices_for_symbol(&self, symbol: &str, price: Decimal, today: NaiveDate) -> rusqlite::Result<usize> {
        let today = today.to_string();
        self.conn.execute(
            "UPDATE holdings
             SET prev_close = CASE WHEN prev_close_date IS NULL OR prev_close_date <> ?1 THEN price ELSE prev_close END,
                 prev_close_date = ?1,
                 price = ?2
             WHERE symbol = ?3",
            params![today, price.to_string(), symbol],
        )
    }
}
