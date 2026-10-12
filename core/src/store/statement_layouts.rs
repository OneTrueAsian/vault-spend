//! Statement layouts the app learned for this profile. Stored as validated JSON; a row that no longer
//! validates (damaged, or written by a newer app) is skipped rather than breaking statement reading.

use super::Store;
use crate::statement::layout::{LayoutError, StatementLayout, is_safe_phrase};
use chrono::NaiveDateTime;
use rusqlite::params;

#[derive(Debug, Clone, PartialEq)]
pub struct StoredLayout {
    pub id: i64,
    pub name: String,
    pub layout: StatementLayout,
    pub updated_at: String,
}

#[derive(Debug)]
pub enum LayoutSaveError {
    Name,
    Missing,
    Layout(LayoutError),
    Db(rusqlite::Error),
}

impl From<rusqlite::Error> for LayoutSaveError {
    fn from(e: rusqlite::Error) -> Self {
        LayoutSaveError::Db(e)
    }
}

impl std::fmt::Display for LayoutSaveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LayoutSaveError::Name => write!(
                f,
                "Give it a name of up to 80 characters, without account numbers, email addresses or phone numbers."
            ),
            LayoutSaveError::Missing => write!(f, "That saved way of reading statements is no longer there."),
            LayoutSaveError::Layout(e) => write!(f, "{e}"),
            LayoutSaveError::Db(_) => write!(f, "Something went wrong saving this. Please try again."),
        }
    }
}

impl std::error::Error for LayoutSaveError {}

impl Store {
    pub fn list_statement_layouts(&self) -> rusqlite::Result<Vec<StoredLayout>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, layout, updated_at FROM statement_layouts ORDER BY name COLLATE NOCASE, id")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows
            .into_iter()
            .filter_map(|(id, name, json, updated_at)| {
                StatementLayout::from_json(&json).ok().map(|layout| StoredLayout {
                    id,
                    name,
                    layout,
                    updated_at,
                })
            })
            .collect())
    }

    /// Runs one plain statement and never opens a transaction of its own, so finishing a statement
    /// reconciliation can call it inside its transaction (keep it that way).
    pub fn save_statement_layout(&self, id: Option<i64>, name: &str, layout: &StatementLayout, now: NaiveDateTime) -> Result<i64, LayoutSaveError> {
        let name = name.trim();
        if !is_safe_phrase(name) {
            return Err(LayoutSaveError::Name);
        }
        let mut layout = layout.clone();
        layout.name = name.to_string();
        layout.id = "learned".to_string();
        let json = layout.to_json();
        // Round-trip exactly as listing will read it (size limit and validation), so anything saved is listable.
        StatementLayout::from_json(&json).map_err(LayoutSaveError::Layout)?;
        match id {
            Some(id) => {
                let changed = self.conn.execute(
                    "UPDATE statement_layouts SET name = ?1, layout = ?2, updated_at = ?3 WHERE id = ?4",
                    params![name, json, now.to_string(), id],
                )?;
                if changed == 0 {
                    return Err(LayoutSaveError::Missing);
                }
                Ok(id)
            }
            None => {
                self.conn.execute(
                    "INSERT INTO statement_layouts (name, layout, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                    params![name, json, now.to_string()],
                )?;
                Ok(self.conn.last_insert_rowid())
            }
        }
    }

    /// Renames the row whatever its contents. The stored layout's own name is updated only when the row
    /// still parses and validates; a damaged row is renamed but not repaired, so it stays skipped.
    pub fn rename_statement_layout(&self, id: i64, name: &str, now: NaiveDateTime) -> Result<(), LayoutSaveError> {
        let name = name.trim();
        if !is_safe_phrase(name) {
            return Err(LayoutSaveError::Name);
        }
        let stored: String = match self
            .conn
            .query_row("SELECT layout FROM statement_layouts WHERE id = ?1", params![id], |r| r.get(0))
        {
            Ok(json) => json,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Err(LayoutSaveError::Missing),
            Err(e) => return Err(e.into()),
        };
        let now = now.to_string();
        match StatementLayout::from_json(&stored) {
            Ok(mut layout) => {
                layout.name = name.to_string();
                let json = layout.to_json();
                StatementLayout::from_json(&json).map_err(LayoutSaveError::Layout)?;
                self.conn.execute(
                    "UPDATE statement_layouts SET name = ?1, layout = ?2, updated_at = ?3 WHERE id = ?4",
                    params![name, json, now, id],
                )?;
            }
            Err(_) => {
                self.conn.execute(
                    "UPDATE statement_layouts SET name = ?1, updated_at = ?2 WHERE id = ?3",
                    params![name, now, id],
                )?;
            }
        }
        Ok(())
    }

    pub fn delete_statement_layout(&self, id: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM statement_layouts WHERE id = ?1", params![id])?;
        Ok(())
    }
}
