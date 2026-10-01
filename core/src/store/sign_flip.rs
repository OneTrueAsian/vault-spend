//! Flipping the sign of transactions that were imported the wrong way round (a card whose export shows
//! charges as positive, imported with "Keep as-is"), and remembering per account which way its imports go.
//!
//! Lives in its own file, like `comparison_setup`, because it needs `Store`'s private connection.

use super::{fingerprint, Store};
use crate::models::Transaction;
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::collections::{BTreeMap, BTreeSet};
use std::str::FromStr;

/// What a flip changed.
#[derive(Debug, Clone, PartialEq)]
pub struct FlipSignsSummary {
    /// Rows whose sign was flipped (deleted and unknown ids are skipped).
    pub flipped: usize,
    /// The accounts those rows belong to, ascending.
    pub account_ids: Vec<i64>,
}

#[derive(Debug)]
pub enum FlipSignsError {
    /// Some rows are one side of a pair whose two sides must have opposite signs: a linked transfer, or a
    /// payment applied to a debt (its source or the row it generated). Flipping one side would break the pair,
    /// so nothing was changed.
    Linked { transfers: usize, debt_payments: usize },
    Db(rusqlite::Error),
}

impl From<rusqlite::Error> for FlipSignsError {
    fn from(e: rusqlite::Error) -> Self {
        FlipSignsError::Db(e)
    }
}

impl std::fmt::Display for FlipSignsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FlipSignsError::Linked { transfers, debt_payments } => {
                let mut parts = Vec::new();
                if *transfers > 0 {
                    parts.push(format!("{transfers} linked transfer{}", if *transfers == 1 { "" } else { "s" }));
                }
                if *debt_payments > 0 {
                    parts.push(format!("{debt_payments} applied debt payment{}", if *debt_payments == 1 { "" } else { "s" }));
                }
                write!(
                    f,
                    "Nothing was changed: the selection includes {}. Flipping one side of a pair would break it, so unlink those first.",
                    parts.join(" and ")
                )
            }
            FlipSignsError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for FlipSignsError {}

/// The negative of a stored amount, never "-0".
fn negated(amount: Decimal) -> Decimal {
    if amount.is_zero() { amount } else { -amount }
}

fn parse(s: &str) -> Decimal {
    Decimal::from_str(s).expect("amount stored by this crate must be valid")
}

impl Store {
    /// Records which way the last import into this account went, so the next one can offer the same answer.
    pub fn set_account_import_flip_signs(&self, account_id: i64, flip: bool) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE accounts SET import_flip_signs = ?1 WHERE id = ?2", params![flip, account_id])?;
        Ok(())
    }

    /// Adds `accounts.import_flip_signs` (nullable: no import yet) to a database from before it existed.
    pub(super) fn migrate_add_account_import_flip_signs_if_missing(&self) -> rusqlite::Result<()> {
        let has_column: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'import_flip_signs')",
            [],
            |row| row.get(0),
        )?;
        if !has_column {
            self.conn.execute("ALTER TABLE accounts ADD COLUMN import_flip_signs INTEGER", [])?;
        }
        Ok(())
    }

    /// Flips the sign of each given transaction: for rows imported the wrong way round, e.g. a card whose
    /// export shows charges as positive, imported with "Keep as-is". Flipping the same rows again undoes it.
    ///
    /// Per row: the amount and any principal override are negated, the fingerprint is recomputed from the new
    /// amount (so importing the same statement again with "Flip the signs" is still caught as a duplicate),
    /// and each split is negated with it.
    ///
    /// Balances: rows after an account's latest checkpoint move its balance on their own. A monthly
    /// checkpoint the app wrote (`roll_forward_monthly_balances`) froze the old signs into its value, so it
    /// is corrected by exactly what the flip changed, no more: its own anchor's correction plus the sign
    /// change of the flipped rows it counted. Anything else that changed since it was written stays out of
    /// it, the same as it always did. A balance the person entered (`manual:`) is never changed.
    ///
    /// Refused, with nothing changed, if any row is one side of a linked transfer or an applied debt
    /// payment. Deleted and unknown ids are skipped. All or nothing.
    pub fn flip_transaction_signs(&self, ids: &[i64]) -> Result<FlipSignsSummary, FlipSignsError> {
        let ids: BTreeSet<i64> = ids.iter().copied().collect();
        let mut rows = Vec::new(); // (id, account_id, date, description, amount, principal)
        for id in &ids {
            let row = self.conn.query_row(
                "SELECT account_id, date, description, amount, principal_amount FROM transactions WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, Option<String>>(4)?)),
            );
            match row {
                Ok((account_id, date, description, amount, principal)) => rows.push((*id, account_id, date, description, parse(&amount), principal.map(|p| parse(&p)))),
                Err(rusqlite::Error::QueryReturnedNoRows) => {}
                Err(e) => return Err(e.into()),
            }
        }

        let (mut transfers, mut debt_payments) = (0usize, 0usize);
        for (id, ..) in &rows {
            let linked: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM transfer_links WHERE out_transaction_id = ?1 OR in_transaction_id = ?1)",
                params![id],
                |r| r.get(0),
            )?;
            let applied: bool = self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM debt_payments WHERE source_transaction_id = ?1 OR generated_transaction_id = ?1)",
                params![id],
                |r| r.get(0),
            )?;
            transfers += usize::from(linked);
            debt_payments += usize::from(applied);
        }
        if transfers > 0 || debt_payments > 0 {
            return Err(FlipSignsError::Linked { transfers, debt_payments });
        }

        let sql_tx = self.conn.unchecked_transaction()?;
        // Per account: (date, how much this row's flip moves the account's balance).
        let mut balance_moves: BTreeMap<i64, Vec<(String, Decimal)>> = BTreeMap::new();
        for (id, account_id, date, description, amount, principal) in &rows {
            let new_amount = negated(*amount);
            let new_principal = principal.map(negated);
            let fp = fingerprint(
                *account_id,
                &Transaction {
                    date: NaiveDate::parse_from_str(date, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                    description: description.clone(),
                    amount: new_amount,
                    category: None,
                },
            );
            self.conn.execute(
                "UPDATE transactions SET amount = ?1, principal_amount = ?2, fingerprint = ?3 WHERE id = ?4",
                params![new_amount.to_string(), new_principal.map(|p| p.to_string()), fp, id],
            )?;
            self.conn.execute(
                "UPDATE transaction_splits SET amount = CASE WHEN amount LIKE '-%' THEN substr(amount, 2)
                                                             WHEN CAST(amount AS REAL) = 0 THEN amount
                                                             ELSE '-' || amount END
                 WHERE transaction_id = ?1",
                params![id],
            )?;
            let counted = principal.unwrap_or(*amount); // what account_balance_as_of adds up
            balance_moves.entry(*account_id).or_default().push((date.clone(), negated(counted) - counted));
        }

        for (account_id, moves) in &balance_moves {
            self.correct_checkpoints_after_flip(*account_id, moves)?;
            self.log_activity(&format!(
                "{}: flipped the sign of {} transaction{}",
                self.account_name_for_log(*account_id),
                moves.len(),
                if moves.len() == 1 { "" } else { "s" }
            ));
        }
        sql_tx.commit()?;

        Ok(FlipSignsSummary { flipped: rows.len(), account_ids: balance_moves.keys().copied().collect() })
    }

    /// See `flip_transaction_signs`. `moves` is each flipped row's date and how much its flip changes the
    /// account's summed transactions.
    fn correct_checkpoints_after_flip(&self, account_id: i64, moves: &[(String, Decimal)]) -> rusqlite::Result<()> {
        let account_type: String = self.conn.query_row("SELECT account_type FROM accounts WHERE id = ?1", params![account_id], |r| r.get(0))?;
        // account_balance_as_of: a loan subtracts its transactions, every other type adds them.
        let direction = if account_type == "loan" { Decimal::NEGATIVE_ONE } else { Decimal::ONE };

        let mut stmt = self
            .conn
            .prepare("SELECT id, period, reset_date, balance FROM balance_resets WHERE account_id = ?1 ORDER BY id")?;
        let checkpoints: Vec<(i64, String, String, String)> = stmt
            .query_map(params![account_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<_>>()?;
        drop(stmt);

        // In creation order (id), so each checkpoint's anchor is the one `latest_checkpoint` picked when it was
        // written: among those that existed then, the latest dated on or before it.
        let mut corrections: Vec<(String, i64, Decimal)> = Vec::new(); // (reset_date, id, correction)
        for (id, period, reset_date, balance) in &checkpoints {
            let correction = if period.starts_with("manual:") {
                Decimal::ZERO
            } else {
                let anchor = corrections.iter().filter(|(date, ..)| date <= reset_date).max_by(|a, b| (&a.0, a.1).cmp(&(&b.0, b.1)));
                let (since, anchor_correction) = match anchor {
                    Some((date, _, c)) => (Some(date.as_str()), *c),
                    None => (None, Decimal::ZERO),
                };
                let counted: Decimal = moves
                    .iter()
                    .filter(|(date, _)| date.as_str() <= reset_date.as_str() && since.is_none_or(|s| date.as_str() > s))
                    .map(|(_, change)| *change)
                    .sum();
                anchor_correction + direction * counted
            };
            if !correction.is_zero() {
                self.conn.execute(
                    "UPDATE balance_resets SET balance = ?1 WHERE id = ?2",
                    params![(parse(balance) + correction).to_string(), id],
                )?;
            }
            corrections.push((reset_date.clone(), *id, correction));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::models::{AccountType, Transaction};
    use crate::store::{FlipSignsError, Store};
    use chrono::{NaiveDate, NaiveDateTime};
    use rust_decimal::Decimal;

    fn d(s: &str) -> NaiveDate {
        s.parse().unwrap()
    }

    fn dec(s: &str) -> Decimal {
        s.parse().unwrap()
    }

    fn tx(date: &str, description: &str, amount: &str) -> Transaction {
        Transaction { date: d(date), description: description.to_string(), amount: dec(amount), category: None }
    }

    /// A credit card holding the given rows, as an import with "Keep as-is" left them. Returns the account
    /// id and the new rows' ids, in the order given.
    fn card(store: &Store, starting: &str, rows: &[Transaction]) -> (i64, Vec<i64>) {
        let account = store.get_or_create_account("Amex Blue", AccountType::Credit).unwrap();
        store.set_account_starting_balance(account, dec(starting)).unwrap();
        let ids = store.save_transactions_with_ids(account, rows).unwrap();
        (account, ids)
    }

    fn amount_of(store: &Store, id: i64) -> Decimal {
        store.all_transactions().unwrap().into_iter().find(|t| t.id == id).unwrap().transaction.amount
    }

    fn balance(store: &Store, account: i64, today: &str) -> Decimal {
        store.list_accounts(d(today)).unwrap().into_iter().find(|a| a.id == account).unwrap().current_balance
    }

    fn resets(store: &Store, account: i64) -> Vec<(String, String)> {
        let mut stmt = store
            .conn
            .prepare("SELECT period, balance FROM balance_resets WHERE account_id = ?1 ORDER BY id")
            .unwrap();
        stmt.query_map([account], |row| Ok((row.get(0)?, row.get(1)?))).unwrap().map(Result::unwrap).collect()
    }

    #[test]
    fn flipping_negates_each_amount() {
        let store = Store::open_in_memory().unwrap();
        let (_, ids) = card(&store, "1000", &[tx("2026-08-10", "HULU", "19.99"), tx("2026-08-20", "PAYMENT - THANK YOU", "-50.00")]);

        let summary = store.flip_transaction_signs(&ids).unwrap();

        assert_eq!(summary.flipped, 2);
        assert_eq!(amount_of(&store, ids[0]), dec("-19.99"));
        assert_eq!(amount_of(&store, ids[1]), dec("50.00"));
    }

    #[test]
    fn flipping_twice_puts_everything_back() {
        let store = Store::open_in_memory().unwrap();
        let (account, ids) = card(&store, "1000", &[tx("2026-08-10", "HULU", "19.99")]);
        store.roll_forward_monthly_balances(d("2026-09-02")).unwrap();
        let before = resets(&store, account);

        store.flip_transaction_signs(&ids).unwrap();
        store.flip_transaction_signs(&ids).unwrap();

        assert_eq!(amount_of(&store, ids[0]), dec("19.99"));
        assert_eq!(resets(&store, account), before);
    }

    #[test]
    fn a_flipped_row_is_still_recognised_when_the_same_statement_is_imported_with_flipped_signs() {
        let store = Store::open_in_memory().unwrap();
        let (account, ids) = card(&store, "1000", &[tx("2026-08-10", "HULU", "19.99")]);

        store.flip_transaction_signs(&ids).unwrap();

        assert_eq!(store.check_duplicates(account, &[tx("2026-08-10", "HULU", "-19.99")]).unwrap(), vec![true]);
        assert_eq!(store.check_duplicates(account, &[tx("2026-08-10", "HULU", "19.99")]).unwrap(), vec![false]);
    }

    #[test]
    fn flipping_negates_a_principal_override_and_every_split() {
        let store = Store::open_in_memory().unwrap();
        let (_, ids) = card(&store, "1000", &[tx("2026-08-10", "COSTCO", "100.00")]);
        store.update_transaction_principal_amount(ids[0], Some(dec("80.00"))).unwrap();
        store
            .set_transaction_splits(ids[0], &[("Groceries".into(), dec("60.00"), None), ("Household".into(), dec("40.00"), None)])
            .unwrap();

        store.flip_transaction_signs(&ids).unwrap();

        let row = store.all_transactions().unwrap().into_iter().find(|t| t.id == ids[0]).unwrap();
        assert_eq!(row.principal_amount, Some(dec("-80.00")));
        let splits: Vec<Decimal> = store.list_transaction_splits(ids[0]).unwrap().into_iter().map(|s| s.amount).collect();
        assert_eq!(splits, vec![dec("-60.00"), dec("-40.00")]);
    }

    #[test]
    fn the_balance_follows_the_flip() {
        let store = Store::open_in_memory().unwrap();
        let (account, ids) = card(&store, "1000", &[tx("2026-09-10", "HULU", "20.00")]);
        assert_eq!(balance(&store, account, "2026-09-15"), dec("1020.00"));

        store.flip_transaction_signs(&ids).unwrap();

        assert_eq!(balance(&store, account, "2026-09-15"), dec("980.00"));
    }

    #[test]
    fn a_monthly_checkpoint_built_on_flipped_rows_is_corrected() {
        let store = Store::open_in_memory().unwrap();
        let (account, ids) = card(&store, "1000", &[tx("2026-08-10", "HULU", "20.00")]);
        store.roll_forward_monthly_balances(d("2026-09-02")).unwrap();
        assert_eq!(resets(&store, account), vec![("2026-09".to_string(), "1020.00".to_string())]);

        store.flip_transaction_signs(&ids).unwrap();

        assert_eq!(resets(&store, account), vec![("2026-09".to_string(), "980.00".to_string())]);
        assert_eq!(balance(&store, account, "2026-09-15"), dec("980.00"));
    }

    #[test]
    fn a_balance_the_person_entered_is_kept_and_later_checkpoints_build_on_it() {
        let store = Store::open_in_memory().unwrap();
        let (account, ids) = card(&store, "1000", &[tx("2026-08-10", "HULU", "20.00"), tx("2026-09-20", "APPLE", "30.00")]);
        store.roll_forward_monthly_balances(d("2026-09-02")).unwrap(); // 2026-09: 1000 + 20
        store.set_account_balance_override(account, dec("1000.00"), d("2026-09-05")).unwrap(); // the person says 1000
        store.roll_forward_monthly_balances(d("2026-10-02")).unwrap(); // 2026-10: 1000 + 30

        store.flip_transaction_signs(&ids).unwrap();

        assert_eq!(
            resets(&store, account),
            vec![
                ("2026-09".to_string(), "980.00".to_string()),
                ("manual:2026-09-05".to_string(), "1000.00".to_string()),
                ("2026-10".to_string(), "970.00".to_string()),
            ]
        );
    }

    #[test]
    fn a_checkpoint_changes_only_by_what_the_flip_changed() {
        // The month roll freezes a checkpoint: a row added later with an earlier date does not move it. The
        // flip must not pull such a row in either — only the flipped rows' own sign change counts.
        let store = Store::open_in_memory().unwrap();
        let (account, ids) = card(&store, "1000", &[tx("2026-08-10", "HULU", "20.00")]);
        store.roll_forward_monthly_balances(d("2026-09-02")).unwrap(); // 1020
        store.save_transactions(account, &[tx("2026-08-15", "BACKDATED", "-100.00")]).unwrap();

        store.flip_transaction_signs(&ids).unwrap();

        assert_eq!(resets(&store, account), vec![("2026-09".to_string(), "980.00".to_string())]);
    }

    #[test]
    fn a_row_after_every_checkpoint_leaves_the_checkpoints_alone() {
        let store = Store::open_in_memory().unwrap();
        let (account, ids) = card(&store, "1000", &[tx("2026-08-10", "HULU", "20.00"), tx("2026-09-10", "APPLE", "5.00")]);
        store.roll_forward_monthly_balances(d("2026-09-02")).unwrap(); // 1020

        store.flip_transaction_signs(&ids[1..]).unwrap();

        assert_eq!(resets(&store, account), vec![("2026-09".to_string(), "1020.00".to_string())]);
        assert_eq!(balance(&store, account, "2026-09-15"), dec("1015.00"));
    }

    #[test]
    fn only_the_accounts_of_the_flipped_rows_change() {
        let store = Store::open_in_memory().unwrap();
        let (card_id, ids) = card(&store, "1000", &[tx("2026-08-10", "HULU", "20.00")]);
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store.save_transactions(checking, &[tx("2026-08-11", "COFFEE", "-4.00")]).unwrap();
        store.roll_forward_monthly_balances(d("2026-09-02")).unwrap();
        let checking_before = resets(&store, checking);

        let summary = store.flip_transaction_signs(&ids).unwrap();

        assert_eq!(summary.account_ids, vec![card_id]);
        assert_eq!(resets(&store, checking), checking_before);
    }

    #[test]
    fn a_linked_transfer_leg_is_refused_and_nothing_changes() {
        let store = Store::open_in_memory().unwrap();
        let (card_id, ids) = card(&store, "1000", &[tx("2026-08-10", "HULU", "20.00"), tx("2026-08-20", "PAYMENT", "50.00")]);
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        let out = store.save_transactions_with_ids(checking, &[tx("2026-08-20", "AMEX PAYMENT", "-50.00")]).unwrap()[0];
        assert!(store.link_transfer(out, ids[1]).unwrap());

        let err = store.flip_transaction_signs(&ids).unwrap_err();

        assert!(matches!(err, FlipSignsError::Linked { transfers: 1, debt_payments: 0 }), "{err:?}");
        assert_eq!(amount_of(&store, ids[0]), dec("20.00"), "the unlinked row must not be flipped either");
        assert_eq!(balance(&store, card_id, "2026-09-15"), dec("1070.00"));
    }

    #[test]
    fn an_applied_debt_payment_is_refused() {
        let store = Store::open_in_memory().unwrap();
        let checking = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        let source = store.save_transactions_with_ids(checking, &[tx("2026-08-20", "CARD PAYMENT", "-50.00")]).unwrap()[0];
        let loan = store.get_or_create_account("Car Loan", AccountType::Loan).unwrap();
        store.apply_debt_payment(source, loan, dec("50.00"), d("2026-08-20")).unwrap();

        let err = store.flip_transaction_signs(&[source]).unwrap_err();

        assert!(matches!(err, FlipSignsError::Linked { transfers: 0, debt_payments: 1 }), "{err:?}");
        assert_eq!(amount_of(&store, source), dec("-50.00"));
    }

    #[test]
    fn deleted_and_unknown_rows_are_skipped() {
        let store = Store::open_in_memory().unwrap();
        let (_, ids) = card(&store, "1000", &[tx("2026-08-10", "HULU", "20.00"), tx("2026-08-11", "RING", "9.99")]);
        let now = NaiveDateTime::parse_from_str("2026-09-01 12:00:00", "%Y-%m-%d %H:%M:%S").unwrap();
        store.delete_transaction(ids[1], now).unwrap();

        let summary = store.flip_transaction_signs(&[ids[0], ids[1], 999_999]).unwrap();

        assert_eq!(summary.flipped, 1);
        let deleted_amount: String = store.conn.query_row("SELECT amount FROM transactions WHERE id = ?1", [ids[1]], |r| r.get(0)).unwrap();
        assert_eq!(deleted_amount, "9.99");
    }

    // ---- remembering which way an account's imports go ---------------------------------------------

    #[test]
    fn an_account_remembers_the_last_import_sign_choice() {
        let store = Store::open_in_memory().unwrap();
        let (account, _) = card(&store, "1000", &[]);
        let choice = |store: &Store| store.list_accounts(d("2026-09-15")).unwrap().into_iter().find(|a| a.id == account).unwrap().import_flip_signs;
        assert_eq!(choice(&store), None, "an account never imported into has no choice yet");

        store.set_account_import_flip_signs(account, true).unwrap();
        assert_eq!(choice(&store), Some(true));
        store.set_account_import_flip_signs(account, false).unwrap();
        assert_eq!(choice(&store), Some(false));
    }

    #[test]
    fn an_older_database_gains_the_column_with_no_choice_recorded() {
        let store = Store::open_in_memory().unwrap();
        let (account, _) = card(&store, "1000", &[]);
        store.conn.execute("ALTER TABLE accounts DROP COLUMN import_flip_signs", []).unwrap();

        store.migrate_add_account_import_flip_signs_if_missing().unwrap();
        store.migrate_add_account_import_flip_signs_if_missing().unwrap(); // and again: idempotent

        let row = store.list_accounts(d("2026-09-15")).unwrap().into_iter().find(|a| a.id == account).unwrap();
        assert_eq!(row.import_flip_signs, None);
    }
}
