//! A coherent read of the figures the comparisons need, taken in one pass so the five cards never
//! show different moments of the ledger. Spending follows the same rules as the Reports category
//! table: transfers (by category or linked pair), generated debt-payment rows and deleted rows are
//! left out, a split purchase counts through its lines, and only expenses count.
use super::{Store, LIVE_TRANSFER_LEG_IDS_SQL};
use crate::comparisons::metrics::{AccountSnap, AssetSnap, Snapshot, SpendRow};
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

impl Store {
    /// Accounts, assets and expense rows from `spend_from` through `today`, as of `today`.
    pub fn comparison_snapshot(&self, today: NaiveDate, spend_from: NaiveDate) -> rusqlite::Result<Snapshot> {
        let accounts = self
            .list_accounts(today)?
            .into_iter()
            .map(|a| AccountSnap {
                id: a.id,
                name: a.account.name,
                kind: a.account.account_type,
                starting_balance: a.starting_balance,
                balance: a.current_balance,
            })
            .collect();
        let assets = self
            .list_assets()?
            .into_iter()
            .map(|a| AssetSnap { id: a.id, name: a.name, value: a.value, valued_on: a.valued_on })
            .collect();

        let mut stmt = self.conn.prepare(&format!(
            "SELECT account_id, date, amount FROM transactions
             WHERE (category IS NULL OR category <> 'Transfer') AND date >= ?1 AND date <= ?2
                   AND id NOT IN (SELECT DISTINCT transaction_id FROM transaction_splits)
                   AND id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND deleted_at IS NULL
             UNION ALL
             SELECT t.account_id, t.date, ts.amount FROM transaction_splits ts
             JOIN transactions t ON t.id = ts.transaction_id
             WHERE (ts.category IS NULL OR ts.category <> 'Transfer') AND t.date >= ?1 AND t.date <= ?2
                   AND t.id NOT IN (SELECT generated_transaction_id FROM debt_payments)
                   AND t.id NOT IN ({LIVE_TRANSFER_LEG_IDS_SQL})
                   AND t.deleted_at IS NULL
             ORDER BY 2, 1"
        ))?;
        let rows = stmt.query_map(params![spend_from.to_string(), today.to_string()], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        })?;
        let mut spend_rows = Vec::new();
        for row in rows {
            let (account_id, date, amount) = row?;
            let amount = Decimal::from_str(&amount).expect("amount stored by this crate must be valid");
            if amount < Decimal::ZERO {
                let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d").expect("date stored by this crate must be valid");
                spend_rows.push(SpendRow { account_id, date, amount: -amount });
            }
        }

        let first: Option<String> = self
            .conn
            .query_row("SELECT MIN(date) FROM transactions WHERE deleted_at IS NULL", [], |r| r.get(0))?;
        let first_transaction_date = first.and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok());
        Ok(Snapshot { today, accounts, assets, spend_rows, first_transaction_date })
    }
}
