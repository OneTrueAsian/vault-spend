//! Remembering, per account, which CSV columns hold the date, description, amount and category.
//!
//! Kept by header name (not position) so a later file with the same headers in another order still matches.
//! Lives in its own file, like `sign_flip`, because it needs `Store`'s private connection.

use super::Store;
use crate::csv_loader::ColumnNames;
use rusqlite::params;

impl Store {
    /// Records the column choice of the last import into this account, offered again next time.
    pub fn set_account_import_columns(&self, account_id: i64, names: &ColumnNames) -> rusqlite::Result<()> {
        let json = serde_json::to_string(names).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        self.conn
            .execute("UPDATE accounts SET import_columns = ?1 WHERE id = ?2", params![json, account_id])?;
        Ok(())
    }

    /// The remembered column choice, or `None` if there is none (or the stored value can't be read).
    pub fn account_import_columns(&self, account_id: i64) -> rusqlite::Result<Option<ColumnNames>> {
        let stored: Option<String> = self
            .conn
            .query_row("SELECT import_columns FROM accounts WHERE id = ?1", params![account_id], |row| row.get(0))?;
        Ok(stored.and_then(|json| serde_json::from_str(&json).ok()))
    }

    /// Adds `accounts.import_columns` (nullable: no choice yet) to a database from before it existed.
    pub(super) fn migrate_add_account_import_columns_if_missing(&self) -> rusqlite::Result<()> {
        let has_column: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'import_columns')",
            [],
            |row| row.get(0),
        )?;
        if !has_column {
            self.conn.execute("ALTER TABLE accounts ADD COLUMN import_columns TEXT", [])?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::csv_loader::{AmountColumns, AmountNames, ColumnMap, ColumnNames};
    use crate::models::AccountType;
    use crate::store::Store;

    fn single() -> ColumnNames {
        ColumnNames {
            date: "Posted".into(),
            description: "Memo".into(),
            amount: AmountNames::Single { column: "Amt".into() },
            category: None,
        }
    }

    fn headers(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_saved_choice_round_trips_by_header_name() {
        let store = Store::open_in_memory().unwrap();
        let acct = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        assert_eq!(store.account_import_columns(acct).unwrap(), None);
        let names = single();
        store.set_account_import_columns(acct, &names).unwrap();
        assert_eq!(store.account_import_columns(acct).unwrap(), Some(names));
    }

    #[test]
    fn a_saved_choice_resolves_against_a_reordered_file() {
        let map = single().resolve(&headers(&["amt", "Memo", "Extra", " posted "])).unwrap();
        assert_eq!((map.date, map.description), (3, 1));
        assert_eq!(map.amount, AmountColumns::Single { column: 0 });
    }

    #[test]
    fn a_saved_choice_does_not_resolve_when_a_header_is_gone() {
        assert_eq!(single().resolve(&headers(&["Posted", "Memo"])), None);
    }

    #[test]
    fn an_unreadable_stored_value_reads_as_no_choice() {
        let store = Store::open_in_memory().unwrap();
        let acct = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        store
            .conn
            .execute("UPDATE accounts SET import_columns = 'not json' WHERE id = ?1", [acct])
            .unwrap();
        assert_eq!(store.account_import_columns(acct).unwrap(), None);
    }

    #[test]
    fn the_column_is_added_to_an_older_database_and_the_migration_is_idempotent() {
        let store = Store::open_in_memory().unwrap();
        store.conn.execute("ALTER TABLE accounts DROP COLUMN import_columns", []).unwrap();
        store.migrate_add_account_import_columns_if_missing().unwrap();
        store.migrate_add_account_import_columns_if_missing().unwrap();
        let acct = store.get_or_create_account("Checking", AccountType::Checking).unwrap();
        assert_eq!(store.account_import_columns(acct).unwrap(), None);
    }

    #[test]
    fn names_are_none_when_an_index_is_out_of_range() {
        let h = headers(&["Date", "Memo", "Amt"]);
        let ok = ColumnMap {
            date: 0,
            description: 1,
            amount: AmountColumns::Single { column: 2 },
            category: None,
        };
        assert!(ok.names(&h).is_some());
        let bad_date = ColumnMap { date: 3, ..ok.clone() };
        assert_eq!(bad_date.names(&h), None);
        let bad_desc = ColumnMap {
            description: 9,
            ..ok.clone()
        };
        assert_eq!(bad_desc.names(&h), None);
        let bad_amount = ColumnMap {
            amount: AmountColumns::Single { column: 3 },
            ..ok.clone()
        };
        assert_eq!(bad_amount.names(&h), None);
        let bad_debit = ColumnMap {
            amount: AmountColumns::DebitCredit { debit: 3, credit: 0 },
            ..ok.clone()
        };
        assert_eq!(bad_debit.names(&h), None);
        let bad_credit = ColumnMap {
            amount: AmountColumns::DebitCredit { debit: 0, credit: 3 },
            ..ok.clone()
        };
        assert_eq!(bad_credit.names(&h), None);
        let bad_cat = ColumnMap { category: Some(3), ..ok };
        assert_eq!(bad_cat.names(&h), None);
    }

    #[test]
    fn debit_credit_and_category_names_round_trip_through_a_map() {
        let h = headers(&["Date", "Memo", "Out", "In", "Kind"]);
        let map = ColumnMap {
            date: 0,
            description: 1,
            amount: AmountColumns::DebitCredit { debit: 2, credit: 3 },
            category: Some(4),
        };
        let names = map.names(&h).unwrap();
        assert_eq!(
            names,
            ColumnNames {
                date: "Date".into(),
                description: "Memo".into(),
                amount: AmountNames::DebitCredit {
                    debit: "Out".into(),
                    credit: "In".into()
                },
                category: Some("Kind".into()),
            }
        );
        let reordered = headers(&["kind", "IN", "out", "memo", "date"]);
        let resolved = names.resolve(&reordered).unwrap();
        assert_eq!(
            resolved,
            ColumnMap {
                date: 4,
                description: 3,
                amount: AmountColumns::DebitCredit { debit: 2, credit: 1 },
                category: Some(0),
            }
        );
        // A category header that has vanished stops the whole choice from resolving.
        assert_eq!(names.resolve(&headers(&["Date", "Memo", "Out", "In"])), None);
    }

    #[test]
    fn duplicate_header_names_pick_the_first_match() {
        let h = headers(&["Memo", "Posted", "Memo", "Amt", "Amt"]);
        let map = single().resolve(&h).unwrap();
        assert_eq!(map.description, 0);
        assert_eq!(map.amount, AmountColumns::Single { column: 3 });
    }
}
