//! Imports: writing a reviewed import file all at once, or not at all.

use super::transactions::{NotesError, normalize_notes};
use super::{CategorySource, Store};
use crate::models::{AccountType, Transaction};
use rusqlite::params;

/// Which account an imported row goes into.
#[derive(Debug, Clone, PartialEq)]
pub enum ImportAccount {
    /// An account the person already has, by id.
    Existing(i64),
    /// The row's own Account column: that account, any casing, created if it doesn't exist.
    Named(String),
}

/// How an imported row's category was settled on the review screen.
#[derive(Debug, Clone, PartialEq)]
pub enum RowCategory {
    /// The row's `transaction.category` as given: the file's own category matched to one of the
    /// person's, or the panel's choice for it. Saved with no source, as file categories always were.
    AsFiled,
    /// A rule's or the auto-categorizer's answer, saved with its source and confidence.
    Guess {
        category: String,
        source: CategorySource,
        confidence: Option<f64>,
    },
    /// The person picked this category for the row: saved as theirs, and taught as a rule.
    Chosen(String),
    /// The person chose to leave the row uncategorized.
    LeaveUncategorized,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImportBatchRow {
    pub account: ImportAccount,
    pub transaction: Transaction,
    pub tags: Vec<String>,
    pub notes: Option<String>,
    pub category: RowCategory,
}

/// Everything one reviewed import writes, in file order.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ImportBatch {
    pub rows: Vec<ImportBatchRow>,
    /// File categories the person chose to add to their list.
    pub create_categories: Vec<String>,
    /// File category names to remember, each with the person's category it means.
    pub remember: Vec<(String, String)>,
    /// File category names whose remembered choice is forgotten.
    pub forget: Vec<String>,
    /// The account the import was started from and its "Flip the signs" answer, offered again next time.
    pub sign_preference: Option<(i64, bool)>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ImportBatchOutcome {
    /// The new transactions' ids, in file order.
    pub inserted_ids: Vec<i64>,
    /// Each (description, category) the person chose for a row, in file order, for the caller to
    /// teach its in-memory rules once the import is saved (the stored rules already have them).
    pub taught: Vec<(String, String)>,
}

#[derive(Debug)]
pub enum ImportBatchError {
    UnknownAccount(i64),
    UnknownCategory(String),
    Notes(NotesError),
    Db(rusqlite::Error),
}

impl std::fmt::Display for ImportBatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ImportBatchError::UnknownAccount(_) => write!(f, "One of the accounts chosen for this import no longer exists. Nothing was imported."),
            ImportBatchError::UnknownCategory(name) => {
                write!(f, "There's no category called \"{name}\" to file those rows under. Nothing was imported.")
            }
            ImportBatchError::Notes(e) => write!(f, "{e}"),
            ImportBatchError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ImportBatchError {}

impl From<rusqlite::Error> for ImportBatchError {
    fn from(e: rusqlite::Error) -> Self {
        ImportBatchError::Db(e)
    }
}

impl From<NotesError> for ImportBatchError {
    fn from(e: NotesError) -> Self {
        match e {
            NotesError::Db(e) => ImportBatchError::Db(e),
            other => ImportBatchError::Notes(other),
        }
    }
}

impl Store {
    /// Writes a reviewed import in one transaction: the categories it adds, any new accounts, every
    /// row (in file order) with its tags, notes and settled category, the rules taught by the
    /// person's own choices, the remembered file categories, and the sign answer. Any failure
    /// leaves the database exactly as it was. A category a row is filed under must already be one
    /// of the person's or be in `create_categories`; a guess never adds one.
    pub fn commit_import_batch(&self, batch: &ImportBatch) -> Result<ImportBatchOutcome, ImportBatchError> {
        let sql_tx = self.conn.unchecked_transaction()?;
        let outcome = self.write_import_batch(batch)?;
        sql_tx.commit()?;
        Ok(outcome)
    }

    fn write_import_batch(&self, batch: &ImportBatch) -> Result<ImportBatchOutcome, ImportBatchError> {
        for name in &batch.create_categories {
            self.create_category(name.trim(), None)?;
        }
        let mut outcome = ImportBatchOutcome::default();
        for row in &batch.rows {
            let account_id = match &row.account {
                ImportAccount::Existing(id) => {
                    let exists: bool = self
                        .conn
                        .query_row("SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)", params![id], |r| r.get(0))?;
                    if !exists {
                        return Err(ImportBatchError::UnknownAccount(*id));
                    }
                    *id
                }
                ImportAccount::Named(name) => self.get_or_create_account(name, AccountType::Checking)?,
            };
            let notes = normalize_notes(row.notes.as_deref())?;
            let mut tx = row.transaction.clone();
            tx.category = match &row.category {
                RowCategory::AsFiled => match &tx.category {
                    Some(name) => Some(self.registered(name)?),
                    None => None,
                },
                _ => None,
            };
            let id = self.save_transactions_with_ids(account_id, std::slice::from_ref(&tx))?[0];
            for tag in &row.tags {
                self.add_tag(id, tag)?;
            }
            if let Some(notes) = &notes {
                self.conn
                    .execute("UPDATE transactions SET notes = ?1 WHERE id = ?2", params![notes, id])?;
            }
            match &row.category {
                RowCategory::AsFiled | RowCategory::LeaveUncategorized => {}
                RowCategory::Guess {
                    category,
                    source,
                    confidence,
                } => {
                    let category = self.registered(category)?;
                    self.set_category(id, &category, *source, *confidence)?;
                }
                RowCategory::Chosen(category) => {
                    let category = self.registered(category)?;
                    self.set_category(id, &category, CategorySource::User, None)?;
                    self.upsert_rule(row.transaction.description.trim(), &category)?;
                    outcome.taught.push((row.transaction.description.clone(), category));
                }
            }
            outcome.inserted_ids.push(id);
        }
        for (file_category, category) in &batch.remember {
            match self.set_import_category_mapping(file_category, category) {
                // a file category with no name has nothing to be remembered by
                Ok(()) | Err(super::ImportCategoryError::EmptyFileCategory) => {}
                Err(super::ImportCategoryError::UnknownCategory(name)) => return Err(ImportBatchError::UnknownCategory(name)),
                Err(super::ImportCategoryError::Db(e)) => return Err(ImportBatchError::Db(e)),
            }
        }
        for file_category in &batch.forget {
            self.remove_import_category_mapping(file_category)?;
        }
        if let Some((account_id, flip)) = batch.sign_preference {
            self.set_account_import_flip_signs(account_id, flip)?;
        }
        Ok(outcome)
    }

    /// The person's spelling of `name`, or `UnknownCategory` when they don't have it.
    fn registered(&self, name: &str) -> Result<String, ImportBatchError> {
        self.find_category(name)?
            .ok_or_else(|| ImportBatchError::UnknownCategory(name.trim().to_string()))
    }
}
