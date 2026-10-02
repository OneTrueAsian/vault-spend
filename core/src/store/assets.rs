//! Other assets (a house, a car) and their values.

use super::Store;
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;

/// A manually-tracked asset outside the accounts model — real estate, a
/// vehicle, or anything else with a value worth counting toward net worth
/// but no transaction history of its own. See `Store::total_assets_value`
/// for how (and deliberately how not) this feeds into net worth.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredAsset {
    pub id: i64,
    pub name: String,
    pub asset_type: String,
    pub value: Decimal,
    pub valued_on: NaiveDate,
    pub notes: Option<String>,
    pub member_id: Option<i64>,
    pub member_name: Option<String>,
}

impl Store {
    /// Adds a manually-tracked asset (see `StoredAsset`). `asset_type` is a
    /// free string, same convention as `budget_group` — the UI suggests
    /// "real_estate"/"vehicle"/"other" but nothing here enforces it.
    pub fn create_asset(&self, name: &str, asset_type: &str, value: Decimal, valued_on: NaiveDate, notes: Option<&str>) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO assets (name, asset_type, value, valued_on, notes) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![name, asset_type, value.to_string(), valued_on.to_string(), notes],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Every manually-tracked asset, alphabetical by name.
    pub fn list_assets(&self) -> rusqlite::Result<Vec<StoredAsset>> {
        let mut stmt = self.conn.prepare(
            "SELECT a.id, a.name, a.asset_type, a.value, a.valued_on, a.notes, a.member_id, fm.name
             FROM assets a
             LEFT JOIN family_members fm ON fm.id = a.member_id
             ORDER BY a.name",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })?;

        let mut result = Vec::new();
        for row in rows {
            let (id, name, asset_type, value, valued_on, notes, member_id, member_name) = row?;
            result.push(StoredAsset {
                id,
                name,
                asset_type,
                value: Decimal::from_str(&value).expect("value stored by this crate must be valid"),
                valued_on: NaiveDate::parse_from_str(&valued_on, "%Y-%m-%d").expect("date stored by this crate must be valid"),
                notes,
                member_id,
                member_name,
            });
        }
        Ok(result)
    }

    /// Updates an asset's value and the date it was valued as of — the
    /// only fields expected to change over time. An unknown id is a
    /// harmless no-op.
    pub fn update_asset_value(&self, id: i64, value: Decimal, valued_on: NaiveDate) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE assets SET value = ?1, valued_on = ?2 WHERE id = ?3",
            params![value.to_string(), valued_on.to_string(), id],
        )?;
        Ok(())
    }

    /// Sets (or clears, with `None`) which family member an asset is
    /// attributed to. An unknown id is a harmless no-op.
    pub fn set_asset_member(&self, id: i64, member_id: Option<i64>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE assets SET member_id = ?1 WHERE id = ?2", params![member_id, id])?;
        Ok(())
    }

    /// Removes an asset. An unknown id is a harmless no-op.
    pub fn delete_asset(&self, id: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM assets WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// The sum of every manually-tracked asset's current value.
    ///
    /// **Deliberately not part of `net_worth_as_of`/net worth history**: an
    /// asset here carries only a current value with no history, so
    /// retroactively applying today's value to every past point on the net
    /// worth trend chart would misrepresent history. Callers that want a
    /// "right now, including assets" figure (the Dashboard/Reports net
    /// worth headline) add this on top of the *current* `net_worth_as_of`
    /// result themselves, rather than this crate baking it into the
    /// historical series.
    pub fn total_assets_value(&self) -> rusqlite::Result<Decimal> {
        let mut stmt = self.conn.prepare("SELECT value FROM assets")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut total = Decimal::ZERO;
        for row in rows {
            total += Decimal::from_str(&row?).expect("value stored by this crate must be valid");
        }
        Ok(total)
    }
}
