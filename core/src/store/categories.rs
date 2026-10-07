//! Categories: the category list, icons, renames and deletes, and matching an import's categories to them.

use super::{CategorySource, Store};
use crate::models::Transaction;
use rusqlite::params;

/// How an import file's category name is remembered: trimmed and lower-cased, so "Merchandise",
/// " MERCHANDISE " and "merchandise" are one name.
pub fn import_category_key(name: &str) -> String {
    name.trim().to_lowercase()
}

/// A registered category name plus its explicit icon override, if any — see
/// `Store::list_categories_with_icons`.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredCategory {
    pub name: String,
    pub icon_key: Option<String>,
}

/// What to do with a category name that came in on an import file but isn't one of
/// the person's own categories. Nothing is ever created unless they pick `Create`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImportCategoryChoice {
    /// Use one of the person's existing categories instead.
    MapTo(String),
    /// Add the file's category to their list.
    Create,
    /// Import those rows without a category (the categorizer may still fill one in).
    Skip,
}

/// A category name an import file uses that the person doesn't have, with how many
/// rows use it — see `Store::unmatched_import_categories`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnmatchedImportCategory {
    pub name: String,
    pub count: usize,
}

#[derive(Debug)]
pub enum ImportCategoryError {
    /// A choice mapped a file category to a category that doesn't exist.
    UnknownCategory(String),
    /// A remembered mapping had no file category name to remember it by.
    EmptyFileCategory,
    Db(rusqlite::Error),
}

impl std::fmt::Display for ImportCategoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImportCategoryError::UnknownCategory(name) => write!(f, "There's no category called \"{name}\" to move those rows into."),
            ImportCategoryError::EmptyFileCategory => write!(f, "That file category has no name to remember."),
            ImportCategoryError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ImportCategoryError {}

impl From<rusqlite::Error> for ImportCategoryError {
    fn from(e: rusqlite::Error) -> Self {
        ImportCategoryError::Db(e)
    }
}

/// The Transactions tab's stat-card counts, over the same rows `all_transactions` lists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CategoryCounts {
    pub total: usize,
    pub auto_categorized: usize,
    pub user_confirmed: usize,
    pub uncategorized: usize,
}

impl Store {
    /// Read-only counterpart to `get_or_create_account` — looks an account
    /// up by name without ever creating one, for callers (import preview)
    /// that must have zero side effects.
    /// The stat-card counts in one pass over the table, without loading every row: "needs a
    /// category" means no category at all; one set by the person counts as theirs; anything else
    /// with a category (rule, classifier, or a file's own) counts as automatic. Same rows as
    /// `all_transactions`: not deleted, not a debt payment's generated row, on a known account.
    pub fn category_counts(&self) -> rusqlite::Result<CategoryCounts> {
        self.conn.query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(t.category IS NULL), 0),
                    COALESCE(SUM(t.category IS NOT NULL AND t.category_source = 'user'), 0)
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             WHERE t.id NOT IN (SELECT generated_transaction_id FROM debt_payments) AND t.deleted_at IS NULL",
            [],
            |row| {
                let total = row.get::<_, i64>(0)? as usize;
                let uncategorized = row.get::<_, i64>(1)? as usize;
                let user_confirmed = row.get::<_, i64>(2)? as usize;
                Ok(CategoryCounts {
                    total,
                    uncategorized,
                    user_confirmed,
                    auto_categorized: total - uncategorized - user_confirmed,
                })
            },
        )
    }

    /// Records a category for a transaction — either a rule/classifier guess
    /// or a user's manual correction. `confidence` should be `None` for
    /// anything but a classifier guess, since a rule match and a user
    /// correction are both deterministic rather than a probability.
    /// Correcting an id that doesn't exist is a harmless no-op rather than
    /// an error.
    pub fn set_category(&self, id: i64, category: &str, source: CategorySource, confidence: Option<f64>) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE transactions SET category = ?1, category_source = ?2, confidence = ?3 WHERE id = ?4",
            params![category, source.as_str(), confidence, id],
        )?;
        // a brand-new category typed for one transaction must be immediately
        // selectable for every other one, not just the row it was first used on
        self.conn
            .execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![category])?;
        Ok(())
    }

    /// Registers a category so it's selectable even before any transaction
    /// or budget uses it. A name that already exists is a harmless no-op —
    /// except for `icon_key`: a `Some` choice is applied whether the row is
    /// brand new or already existed (so picking an icon in the "new
    /// category" dialog works even though the category itself might already
    /// be registered from an earlier transaction/budget), but `None` never
    /// clears an icon an existing row already has — this call just means
    /// "make sure this category exists," not "reset its icon."
    pub fn create_category(&self, name: &str, icon_key: Option<&str>) -> rusqlite::Result<()> {
        self.conn.execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![name])?;
        if let Some(icon_key) = icon_key {
            self.conn
                .execute("UPDATE categories SET icon_key = ?1 WHERE name = ?2", params![icon_key, name])?;
        }
        Ok(())
    }

    /// The stored spelling of the category `name` refers to — matched ignoring case and
    /// surrounding spaces — or `None` when the person has no such category. Never creates one.
    pub fn find_category(&self, name: &str) -> rusqlite::Result<Option<String>> {
        let name = name.trim();
        if name.is_empty() {
            return Ok(None);
        }
        match self.conn.query_row("SELECT name FROM categories WHERE name = ?1", params![name], |row| {
            row.get::<_, String>(0)
        }) {
            Ok(found) => Ok(Some(found)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// `set_category` for a *guess* (a rule or the classifier): applies the category only when
    /// the person already has it, using their spelling, and returns whether it did. A guess
    /// must never add a category to their list — `set_category` (a person typing a new name
    /// for a transaction) is the one that may.
    pub fn set_category_if_registered(&self, id: i64, category: &str, source: CategorySource, confidence: Option<f64>) -> rusqlite::Result<bool> {
        let Some(existing) = self.find_category(category)? else {
            return Ok(false);
        };
        self.conn.execute(
            "UPDATE transactions SET category = ?1, category_source = ?2, confidence = ?3 WHERE id = ?4",
            params![existing, source.as_str(), confidence, id],
        )?;
        Ok(true)
    }

    /// The category names in an import file that the person doesn't have — one entry per name
    /// however it is cased (the file's first spelling), with the number of rows using it, the
    /// most-used first. Names that match one of their categories, and rows with no category,
    /// are left out. A pure read.
    pub fn unmatched_import_categories(&self, txns: &[Transaction]) -> rusqlite::Result<Vec<UnmatchedImportCategory>> {
        let mut seen: Vec<UnmatchedImportCategory> = Vec::new();
        for tx in txns {
            let Some(name) = tx.category.as_deref().map(str::trim).filter(|n| !n.is_empty()) else {
                continue;
            };
            if self.find_category(name)?.is_some() {
                continue;
            }
            match seen.iter_mut().find(|u| u.name.eq_ignore_ascii_case(name)) {
                Some(existing) => existing.count += 1,
                None => seen.push(UnmatchedImportCategory {
                    name: name.to_string(),
                    count: 1,
                }),
            }
        }
        seen.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(seen)
    }

    /// The remembered import file categories, keyed by `import_category_key`, each with the
    /// person's category in their spelling. A mapping whose category no longer exists is left
    /// out, never handed to an import.
    pub fn import_category_mappings(&self) -> rusqlite::Result<std::collections::HashMap<String, String>> {
        let mut stmt = self.conn.prepare(
            "SELECT m.file_category, c.name FROM import_category_mappings m
             JOIN categories c ON c.name = m.category",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
        rows.collect()
    }

    /// Remembers that an import file's `file_category` means the person's `category`, replacing
    /// any earlier choice for that name. Refused when the name is empty or `category` isn't one
    /// of theirs; never adds a category.
    pub fn set_import_category_mapping(&self, file_category: &str, category: &str) -> Result<(), ImportCategoryError> {
        let key = import_category_key(file_category);
        if key.is_empty() {
            return Err(ImportCategoryError::EmptyFileCategory);
        }
        let Some(target) = self.find_category(category)? else {
            return Err(ImportCategoryError::UnknownCategory(category.trim().to_string()));
        };
        self.conn.execute(
            "INSERT INTO import_category_mappings (file_category, category) VALUES (?1, ?2)
             ON CONFLICT(file_category) DO UPDATE SET category = excluded.category",
            params![key, target],
        )?;
        Ok(())
    }

    /// Forgets the remembered choice for an import file's `file_category`, if there is one.
    pub fn remove_import_category_mapping(&self, file_category: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "DELETE FROM import_category_mappings WHERE file_category = ?1",
            params![import_category_key(file_category)],
        )?;
        Ok(())
    }

    /// Every registered category, sorted — the standard suggestions plus
    /// anything created, budgeted, or assigned to a transaction, whether or
    /// not it's currently in use by anything.
    pub fn list_categories(&self) -> rusqlite::Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT name FROM categories ORDER BY name")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Same as `list_categories`, but with each category's explicit icon
    /// override alongside its name — kept separate from `list_categories`
    /// rather than changing that one's return type, since most of its
    /// callers (autocomplete, category-picker dropdowns) only ever need the
    /// name.
    pub fn list_categories_with_icons(&self) -> rusqlite::Result<Vec<StoredCategory>> {
        let mut stmt = self.conn.prepare("SELECT name, icon_key FROM categories ORDER BY name")?;
        let rows = stmt.query_map([], |row| {
            Ok(StoredCategory {
                name: row.get::<_, String>(0)?,
                icon_key: row.get::<_, Option<String>>(1)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    /// Sets (or clears, with `None`) an existing category's icon override —
    /// unconditional, unlike `create_category`'s `icon_key`, since this is
    /// specifically "change this category's icon," including back to "keep
    /// guessing from the name."
    pub fn set_category_icon(&self, name: &str, icon_key: Option<&str>) -> rusqlite::Result<()> {
        self.conn
            .execute("UPDATE categories SET icon_key = ?1 WHERE name = ?2", params![icon_key, name])?;
        Ok(())
    }

    /// Renames every transaction and rule filed under `old` to `new`, and
    /// the category registry entry itself. If `new` already has
    /// transactions of its own, this is how a merge happens — same
    /// operation, no special-casing needed. Returns how many transaction
    /// rows were affected.
    ///
    /// Every budget line follows the rename too, month by month — but
    /// `budgets`' key is `(category, period)`, so if `new` already has
    /// its own line for a given month, `old`'s can't just overwrite it;
    /// the existing target's line wins for that month (same "the thing
    /// you're merging into wins" rule as everywhere else here) and
    /// `old`'s line is dropped instead of silently orphaned.
    ///
    /// `old`'s icon (see `set_category_icon`) carries over to `new` the
    /// same way — but only if `new` doesn't already have one of its own:
    /// renaming into an existing category is a merge, and the thing being
    /// merged into keeps its own icon rather than having it silently
    /// overwritten. Read before `old`'s row is deleted below, since that
    /// delete would otherwise take the icon down with it.
    pub fn rename_category(&self, old: &str, new: &str) -> rusqlite::Result<usize> {
        let old_icon_key: Option<String> = match self
            .conn
            .query_row("SELECT icon_key FROM categories WHERE name = ?1", params![old], |row| row.get(0))
        {
            Ok(icon_key) => icon_key,
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };

        let affected = self
            .conn
            .execute("UPDATE transactions SET category = ?1 WHERE category = ?2", params![new, old])?;
        self.conn
            .execute("UPDATE transaction_splits SET category = ?1 WHERE category = ?2", params![new, old])?;
        self.conn
            .execute("UPDATE rules SET category = ?1 WHERE category = ?2", params![new, old])?;
        self.conn
            .execute("UPDATE import_category_mappings SET category = ?1 WHERE category = ?2", params![new, old])?;
        self.conn.execute(
            "UPDATE budgets SET category = ?1
             WHERE category = ?2 AND NOT EXISTS (
                 SELECT 1 FROM budgets b2 WHERE b2.category = ?1 AND b2.period = budgets.period
             )",
            params![new, old],
        )?;
        self.conn.execute("DELETE FROM budgets WHERE category = ?1", params![old])?;
        self.conn.execute("INSERT OR IGNORE INTO categories (name) VALUES (?1)", params![new])?;
        if let Some(icon_key) = old_icon_key {
            self.conn.execute(
                "UPDATE categories SET icon_key = ?1 WHERE name = ?2 AND icon_key IS NULL",
                params![icon_key, new],
            )?;
        }
        self.conn.execute("DELETE FROM categories WHERE name = ?1", params![old])?;
        Ok(affected)
    }

    /// Resets every transaction filed under `name` back to uncategorized,
    /// removes any rule or budget line that points at it, and removes it
    /// from the category registry — otherwise a leftover rule would
    /// silently recreate the "deleted" category on the next import, or it
    /// would still show up as a suggestion. Returns how many transactions
    /// were reset.
    pub fn delete_category(&self, name: &str) -> rusqlite::Result<usize> {
        let affected = self.conn.execute(
            "UPDATE transactions SET category = NULL, category_source = NULL, confidence = NULL WHERE category = ?1",
            params![name],
        )?;
        self.conn
            .execute("UPDATE transaction_splits SET category = NULL WHERE category = ?1", params![name])?;
        self.conn.execute("DELETE FROM rules WHERE category = ?1", params![name])?;
        self.conn
            .execute("DELETE FROM import_category_mappings WHERE category = ?1", params![name])?;
        self.conn.execute("DELETE FROM budgets WHERE category = ?1", params![name])?;
        self.conn.execute("DELETE FROM categories WHERE name = ?1", params![name])?;
        Ok(affected)
    }
}
