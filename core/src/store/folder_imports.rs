//! Watched-folder imports (VS-102): the profile's own folder-import settings, account mappings,
//! saved copies of discovered exports waiting for review, the receipts that stop the same content
//! being queued twice, and a short activity list. Everything lives in the profile database, so a
//! protected profile keeps it encrypted and it travels with backups. The folder path itself is a
//! device setting and is not stored here.
//!
//! Nothing in this module changes the ledger except `commit_staged_import`, which writes the
//! reviewed rows, finishes the batch, records its receipt and moves the mapping's watermark in one
//! transaction.

use super::Store;
use super::imports::{ImportBatch, ImportBatchError, ImportBatchOutcome};
use crate::folder_import::{self, MAX_ACTIVITY_ROWS, MAX_PENDING_BATCHES, MAX_STAGED_BYTES};
use chrono::NaiveDate;
use rusqlite::{OptionalExtension, params};

#[derive(Debug, Clone, PartialEq)]
pub struct FolderImportSettings {
    pub enabled: bool,
    /// Bumped by every settings or mapping change, so discovery started under older settings can
    /// tell it must not stage what it found.
    pub revision: i64,
    /// The newest activity entry the person has seen in Folder activity. Files skipped after it
    /// are announced on the Transactions page, even ones found before the page first loaded.
    pub seen_activity_id: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FolderImportMapping {
    pub id: i64,
    pub account_id: i64,
    pub stem: String,
    /// Lower-case extensions, each one of `folder_import::FOLDER_EXTENSIONS`.
    pub extensions: Vec<String>,
    /// The amount convention: true flips every amount (charges shown as positive in the file).
    pub invert_amounts: bool,
    /// Exports before this date are not queued automatically. `None` means files already in the
    /// folder were deliberately included.
    pub initial_cutoff: Option<NaiveDate>,
    /// The export date of the newest successfully imported file for this mapping.
    pub watermark: Option<NaiveDate>,
    pub revision: i64,
}

/// A mapping as the settings screen sends it.
#[derive(Debug, Clone, PartialEq)]
pub struct FolderImportMappingInput {
    pub id: Option<i64>,
    pub account_id: i64,
    pub stem: String,
    pub extensions: Vec<String>,
    pub invert_amounts: bool,
    pub initial_cutoff: Option<NaiveDate>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BatchStatus {
    Pending,
    Imported,
    Dismissed,
}

impl BatchStatus {
    fn as_str(self) -> &'static str {
        match self {
            BatchStatus::Pending => "pending",
            BatchStatus::Imported => "imported",
            BatchStatus::Dismissed => "dismissed",
        }
    }
    fn parse(s: &str) -> BatchStatus {
        match s {
            "imported" => BatchStatus::Imported,
            "dismissed" => BatchStatus::Dismissed,
            _ => BatchStatus::Pending,
        }
    }
}

/// A saved export, without its bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct FolderImportBatch {
    pub id: i64,
    pub mapping_id: Option<i64>,
    pub account_id: i64,
    pub file_name: String,
    pub digest: String,
    pub size: i64,
    pub export_start: NaiveDate,
    pub export_end: NaiveDate,
    pub status: BatchStatus,
    pub detected_at: String,
    pub row_version: i64,
    /// Whether the saved copy is still kept (it is pruned only for finished batches).
    pub has_content: bool,
}

/// A discovered export to save for review.
#[derive(Debug, Clone)]
pub struct StageInput<'a> {
    pub mapping_id: i64,
    pub account_id: i64,
    pub file_name: &'a str,
    pub digest: &'a str,
    pub content: &'a [u8],
    pub export_start: NaiveDate,
    pub export_end: NaiveDate,
    pub now: &'a str,
}

#[derive(Debug, Clone, PartialEq)]
pub enum StageOutcome {
    Queued(i64),
    /// The same content for the same account was seen before (pending, imported or dismissed).
    AlreadyKnown { batch_id: i64, status: BatchStatus },
    /// Too many exports are already waiting.
    QueueFull,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ActivityEntry {
    pub id: i64,
    pub at: String,
    pub mapping_id: Option<i64>,
    pub account_id: Option<i64>,
    pub file_name: String,
    /// queued, older, already_imported, already_dismissed, already_pending, bad_name, needs_account,
    /// too_large, unreadable, queue_full, imported, dismissed, requeued.
    pub outcome: String,
    pub reason: String,
    pub batch_id: Option<i64>,
}

#[derive(Debug)]
pub enum FolderImportError {
    UnknownAccount,
    EmptyStem,
    BadExtensions,
    StemInUse(String),
    UnknownMapping,
    UnknownBatch,
    /// The batch was finished or changed since it was opened for review.
    Stale,
    /// The saved copy was removed to save space and the original is needed again.
    ContentGone,
    Import(ImportBatchError),
    Db(rusqlite::Error),
}

impl std::fmt::Display for FolderImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FolderImportError::UnknownAccount => write!(f, "Choose one of your accounts for this export name."),
            FolderImportError::EmptyStem => write!(f, "Type the start of the file name your bank uses, before the date."),
            FolderImportError::BadExtensions => write!(f, "Choose CSV, Excel workbook (.xlsx) or both."),
            FolderImportError::StemInUse(stem) => {
                write!(f, "Another account already uses the file name \"{stem}\". Each export name can go to one account.")
            }
            FolderImportError::UnknownMapping => write!(f, "That export name was removed. Refresh and try again."),
            FolderImportError::UnknownBatch => write!(f, "That export is no longer saved. Refresh and try again."),
            FolderImportError::Stale => write!(f, "This export changed since you opened it. Review it again before importing. Nothing was imported."),
            FolderImportError::ContentGone => write!(
                f,
                "The saved copy of this export was cleared to save space. Put the file back in the folder, or import it with Import transactions."
            ),
            FolderImportError::Import(e) => write!(f, "{e}"),
            FolderImportError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for FolderImportError {}

impl From<rusqlite::Error> for FolderImportError {
    fn from(e: rusqlite::Error) -> Self {
        FolderImportError::Db(e)
    }
}

impl From<ImportBatchError> for FolderImportError {
    fn from(e: ImportBatchError) -> Self {
        match e {
            ImportBatchError::Db(e) => FolderImportError::Db(e),
            other => FolderImportError::Import(other),
        }
    }
}

fn date(s: Option<String>) -> Option<NaiveDate> {
    s.and_then(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok())
}

const BATCH_COLUMNS: &str =
    "id, mapping_id, account_id, file_name, digest, size, export_start, export_end, status, detected_at, row_version, content IS NOT NULL";

fn batch_from_row(row: &rusqlite::Row) -> rusqlite::Result<FolderImportBatch> {
    let start: String = row.get(6)?;
    let end: String = row.get(7)?;
    let status: String = row.get(8)?;
    Ok(FolderImportBatch {
        id: row.get(0)?,
        mapping_id: row.get(1)?,
        account_id: row.get(2)?,
        file_name: row.get(3)?,
        digest: row.get(4)?,
        size: row.get(5)?,
        export_start: date(Some(start)).unwrap_or_default(),
        export_end: date(Some(end)).unwrap_or_default(),
        status: BatchStatus::parse(&status),
        detected_at: row.get(9)?,
        row_version: row.get(10)?,
        has_content: row.get(11)?,
    })
}

impl Store {
    pub(super) fn migrate_add_folder_imports_if_missing(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS folder_import_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                enabled INTEGER NOT NULL DEFAULT 0,
                revision INTEGER NOT NULL DEFAULT 0,
                seen_activity_id INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS folder_import_mappings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                stem TEXT NOT NULL,
                extensions TEXT NOT NULL,
                invert_amounts INTEGER NOT NULL DEFAULT 0,
                initial_cutoff TEXT,
                watermark TEXT,
                revision INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS folder_import_batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mapping_id INTEGER,
                account_id INTEGER NOT NULL,
                file_name TEXT NOT NULL,
                digest TEXT NOT NULL,
                size INTEGER NOT NULL,
                export_start TEXT NOT NULL,
                export_end TEXT NOT NULL,
                content BLOB,
                status TEXT NOT NULL,
                detected_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                row_version INTEGER NOT NULL DEFAULT 1,
                UNIQUE (account_id, digest)
            );
            CREATE TABLE IF NOT EXISTS folder_import_receipts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL,
                digest TEXT NOT NULL,
                outcome TEXT NOT NULL,
                batch_id INTEGER,
                inserted INTEGER NOT NULL DEFAULT 0,
                at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_folder_import_receipts_content ON folder_import_receipts(account_id, digest);
            CREATE TABLE IF NOT EXISTS folder_import_activity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at TEXT NOT NULL,
                mapping_id INTEGER,
                account_id INTEGER,
                file_name TEXT NOT NULL,
                outcome TEXT NOT NULL,
                reason TEXT NOT NULL,
                batch_id INTEGER
            );",
        )?;
        // Added after the tables first shipped in development builds.
        let has_seen: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('folder_import_settings') WHERE name = 'seen_activity_id')",
            [],
            |r| r.get(0),
        )?;
        if !has_seen {
            self.conn
                .execute_batch("ALTER TABLE folder_import_settings ADD COLUMN seen_activity_id INTEGER NOT NULL DEFAULT 0;")?;
        }
        Ok(())
    }

    pub fn folder_import_settings(&self) -> rusqlite::Result<FolderImportSettings> {
        let row = self
            .conn
            .query_row("SELECT enabled, revision, seen_activity_id FROM folder_import_settings WHERE id = 1", [], |r| {
                Ok(FolderImportSettings {
                    enabled: r.get(0)?,
                    revision: r.get(1)?,
                    seen_activity_id: r.get(2)?,
                })
            })
            .optional()?;
        Ok(row.unwrap_or(FolderImportSettings { enabled: false, revision: 0, seen_activity_id: 0 }))
    }

    /// Folder activity was read up to `through`. Never moves back.
    pub fn mark_folder_import_activity_seen(&self, through: i64) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO folder_import_settings (id, enabled, revision, seen_activity_id) VALUES (1, 0, 0, ?1)
             ON CONFLICT(id) DO UPDATE SET seen_activity_id = MAX(seen_activity_id, excluded.seen_activity_id)",
            params![through],
        )?;
        Ok(())
    }

    /// Forgets the newest imported export's date for a mapping, so exports from the start date on
    /// are queued again (receipts still stop anything already imported or dismissed).
    pub fn clear_folder_import_watermark(&self, id: i64) -> Result<(), FolderImportError> {
        self.update_folder_import_mapping("watermark = NULL", params![id])
    }

    /// Saves the amount convention chosen in a review as the mapping's own.
    pub fn set_folder_import_mapping_invert(&self, id: i64, invert: bool) -> Result<(), FolderImportError> {
        self.update_folder_import_mapping("invert_amounts = ?2", params![id, invert])
    }

    /// Changes one mapping (its id is `?1` in `args`) and starts discovery over.
    fn update_folder_import_mapping(&self, set: &str, args: &[&dyn rusqlite::ToSql]) -> Result<(), FolderImportError> {
        self.atomically(|| -> rusqlite::Result<Result<(), FolderImportError>> {
            let sql = format!("UPDATE folder_import_mappings SET {set}, revision = revision + 1 WHERE id = ?1");
            if self.conn.execute(&sql, args)? == 0 {
                return Ok(Err(FolderImportError::UnknownMapping));
            }
            self.bump_folder_import_revision()?;
            Ok(Ok(()))
        })?
    }

    fn bump_folder_import_revision(&self) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO folder_import_settings (id, enabled, revision) VALUES (1, 0, 1)
             ON CONFLICT(id) DO UPDATE SET revision = revision + 1",
            [],
        )?;
        Ok(())
    }

    /// Turns automatic discovery on or off. Saved mappings, pending exports and receipts stay.
    pub fn set_folder_imports_enabled(&self, enabled: bool) -> rusqlite::Result<()> {
        self.atomically(|| {
            self.bump_folder_import_revision()?;
            self.conn
                .execute("UPDATE folder_import_settings SET enabled = ?1 WHERE id = 1", params![enabled])?;
            Ok(())
        })
    }

    pub fn list_folder_import_mappings(&self) -> rusqlite::Result<Vec<FolderImportMapping>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, account_id, stem, extensions, invert_amounts, initial_cutoff, watermark, revision
             FROM folder_import_mappings ORDER BY id",
        )?;
        let rows = stmt.query_map([], |r| {
            let extensions: String = r.get(3)?;
            Ok(FolderImportMapping {
                id: r.get(0)?,
                account_id: r.get(1)?,
                stem: r.get(2)?,
                extensions: extensions.split(',').filter(|e| !e.is_empty()).map(str::to_string).collect(),
                invert_amounts: r.get(4)?,
                initial_cutoff: date(r.get(5)?),
                watermark: date(r.get(6)?),
                revision: r.get(7)?,
            })
        })?;
        rows.collect()
    }

    pub fn folder_import_mapping(&self, id: i64) -> rusqlite::Result<Option<FolderImportMapping>> {
        Ok(self.list_folder_import_mappings()?.into_iter().find(|m| m.id == id))
    }

    /// Every account's name by id, for labelling mappings, exports and activity.
    pub fn folder_import_account_names(&self) -> rusqlite::Result<std::collections::HashMap<i64, String>> {
        let mut stmt = self.conn.prepare("SELECT id, name FROM accounts")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect()
    }

    /// Whether an account can receive folder imports: it exists and is not hidden.
    pub fn folder_import_account_usable(&self, account_id: i64) -> rusqlite::Result<bool> {
        self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1 AND COALESCE(hidden, 0) = 0)",
            params![account_id],
            |r| r.get(0),
        )
    }

    /// Adds or changes a mapping. The watermark is kept across edits; changing the account starts
    /// a new chronology for the new account and moves the name's exports still waiting for review
    /// to it (finished ones keep their history). Returns the mapping's id.
    pub fn save_folder_import_mapping(&self, input: &FolderImportMappingInput) -> Result<i64, FolderImportError> {
        let stem = input.stem.trim().to_string();
        if folder_import::normalize_stem(&stem).is_empty() {
            return Err(FolderImportError::EmptyStem);
        }
        let mut extensions: Vec<String> = input.extensions.iter().map(|e| e.trim().trim_start_matches('.').to_ascii_lowercase()).collect();
        extensions.sort();
        extensions.dedup();
        if extensions.is_empty() || extensions.iter().any(|e| !folder_import::FOLDER_EXTENSIONS.contains(&e.as_str())) {
            return Err(FolderImportError::BadExtensions);
        }
        if !self.folder_import_account_usable(input.account_id)? {
            return Err(FolderImportError::UnknownAccount);
        }
        let key = folder_import::normalize_stem(&stem);
        let existing = self.list_folder_import_mappings()?;
        if existing
            .iter()
            .any(|m| Some(m.id) != input.id && folder_import::normalize_stem(&m.stem) == key)
        {
            return Err(FolderImportError::StemInUse(stem));
        }
        let cutoff = input.initial_cutoff.map(|d| d.to_string());
        let joined = extensions.join(",");
        let id = self.atomically(|| -> rusqlite::Result<Result<i64, FolderImportError>> {
            let id = match input.id {
                Some(id) => {
                    let Some(before) = existing.iter().find(|m| m.id == id) else {
                        return Ok(Err(FolderImportError::UnknownMapping));
                    };
                    let watermark = if before.account_id == input.account_id {
                        before.watermark.map(|d| d.to_string())
                    } else {
                        None
                    };
                    self.conn.execute(
                        "UPDATE folder_import_mappings SET account_id = ?1, stem = ?2, extensions = ?3, invert_amounts = ?4,
                             initial_cutoff = ?5, watermark = ?6, revision = revision + 1 WHERE id = ?7",
                        params![input.account_id, stem, joined, input.invert_amounts, cutoff, watermark, id],
                    )?;
                    if before.account_id != input.account_id {
                        // Content the new account already has (waiting, imported or dismissed) isn't queued for it twice.
                        self.conn.execute(
                            "DELETE FROM folder_import_batches WHERE mapping_id = ?1 AND status = 'pending'
                                 AND digest IN (SELECT digest FROM folder_import_batches WHERE account_id = ?2)",
                            params![id, input.account_id],
                        )?;
                        // A new row version: a review opened for the old account can't be approved.
                        self.conn.execute(
                            "UPDATE folder_import_batches SET account_id = ?2, row_version = row_version + 1
                             WHERE mapping_id = ?1 AND status = 'pending'",
                            params![id, input.account_id],
                        )?;
                    }
                    id
                }
                None => {
                    self.conn.execute(
                        "INSERT INTO folder_import_mappings (account_id, stem, extensions, invert_amounts, initial_cutoff)
                         VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![input.account_id, stem, joined, input.invert_amounts, cutoff],
                    )?;
                    self.conn.last_insert_rowid()
                }
            };
            self.bump_folder_import_revision()?;
            Ok(Ok(id))
        })??;
        Ok(id)
    }

    /// Removes a mapping. Exports already saved for it stay reviewable; receipts stay.
    pub fn delete_folder_import_mapping(&self, id: i64) -> rusqlite::Result<()> {
        self.atomically(|| {
            self.conn.execute("DELETE FROM folder_import_mappings WHERE id = ?1", params![id])?;
            self.bump_folder_import_revision()
        })
    }

    /// The batch (any status) already saved for this account and content, if any.
    pub fn folder_import_known(&self, account_id: i64, digest: &str) -> rusqlite::Result<Option<(i64, BatchStatus)>> {
        self.conn
            .query_row(
                "SELECT id, status FROM folder_import_batches WHERE account_id = ?1 AND digest = ?2",
                params![account_id, digest],
                |r| Ok((r.get::<_, i64>(0)?, BatchStatus::parse(&r.get::<_, String>(1)?))),
            )
            .optional()
    }

    /// Saves a discovered export for review. Never touches the ledger. The same content for the
    /// same account is never saved twice, whatever its name.
    pub fn stage_folder_import(&self, input: &StageInput) -> rusqlite::Result<StageOutcome> {
        self.atomically(|| {
            if let Some((batch_id, status)) = self.folder_import_known(input.account_id, input.digest)? {
                return Ok(StageOutcome::AlreadyKnown { batch_id, status });
            }
            let pending: i64 = self
                .conn
                .query_row("SELECT COUNT(*) FROM folder_import_batches WHERE status = 'pending'", [], |r| r.get(0))?;
            if pending as usize >= MAX_PENDING_BATCHES {
                return Ok(StageOutcome::QueueFull);
            }
            // Waiting copies are never cleared, so they must fit under the saved-bytes limit themselves.
            let waiting_bytes: i64 = self.conn.query_row(
                "SELECT COALESCE(SUM(size), 0) FROM folder_import_batches WHERE status = 'pending' AND content IS NOT NULL",
                [],
                |r| r.get(0),
            )?;
            if waiting_bytes + input.content.len() as i64 > MAX_STAGED_BYTES {
                return Ok(StageOutcome::QueueFull);
            }
            self.conn.execute(
                "INSERT INTO folder_import_batches
                     (mapping_id, account_id, file_name, digest, size, export_start, export_end, content, status, detected_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?9)",
                params![
                    input.mapping_id,
                    input.account_id,
                    input.file_name,
                    input.digest,
                    input.content.len() as i64,
                    input.export_start.to_string(),
                    input.export_end.to_string(),
                    input.content,
                    input.now,
                ],
            )?;
            let id = self.conn.last_insert_rowid();
            self.prune_folder_import_content()?;
            Ok(StageOutcome::Queued(id))
        })
    }

    /// Keeps the saved bytes under `MAX_STAGED_BYTES` by clearing the oldest finished batches'
    /// copies. Pending copies are never cleared; receipts are never touched.
    fn prune_folder_import_content(&self) -> rusqlite::Result<()> {
        let total: i64 = self
            .conn
            .query_row("SELECT COALESCE(SUM(size), 0) FROM folder_import_batches WHERE content IS NOT NULL", [], |r| r.get(0))?;
        let mut over = total - MAX_STAGED_BYTES;
        if over <= 0 {
            return Ok(());
        }
        let mut stmt = self.conn.prepare(
            "SELECT id, size FROM folder_import_batches WHERE content IS NOT NULL AND status <> 'pending' ORDER BY updated_at, id",
        )?;
        let finished: Vec<(i64, i64)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
        drop(stmt);
        for (id, size) in finished {
            if over <= 0 {
                break;
            }
            self.conn.execute("UPDATE folder_import_batches SET content = NULL WHERE id = ?1", params![id])?;
            over -= size;
        }
        Ok(())
    }

    pub fn list_folder_import_batches(&self, only_pending: bool) -> rusqlite::Result<Vec<FolderImportBatch>> {
        let sql = format!(
            "SELECT {BATCH_COLUMNS} FROM folder_import_batches {} ORDER BY export_end, id",
            if only_pending { "WHERE status = 'pending'" } else { "" }
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], batch_from_row)?;
        rows.collect()
    }

    pub fn folder_import_batch(&self, id: i64) -> rusqlite::Result<Option<FolderImportBatch>> {
        self.conn
            .query_row(&format!("SELECT {BATCH_COLUMNS} FROM folder_import_batches WHERE id = ?1"), params![id], batch_from_row)
            .optional()
    }

    /// The saved copy's bytes, if still kept.
    pub fn folder_import_batch_content(&self, id: i64) -> rusqlite::Result<Option<Vec<u8>>> {
        Ok(self
            .conn
            .query_row("SELECT content FROM folder_import_batches WHERE id = ?1", params![id], |r| r.get::<_, Option<Vec<u8>>>(0))
            .optional()?
            .flatten())
    }

    fn receipt(&self, batch: &FolderImportBatch, outcome: &str, inserted: usize, now: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO folder_import_receipts (account_id, digest, outcome, batch_id, inserted, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![batch.account_id, batch.digest, outcome, batch.id, inserted as i64, now],
        )?;
        Ok(())
    }

    fn set_batch_status(&self, id: i64, status: BatchStatus, now: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE folder_import_batches SET status = ?1, updated_at = ?2, row_version = row_version + 1 WHERE id = ?3",
            params![status.as_str(), now, id],
        )?;
        Ok(())
    }

    /// "Dismiss": the export is not imported and is not queued again automatically, even if the
    /// file is removed and added back. It can still be reviewed deliberately ("Review again").
    pub fn dismiss_folder_import(&self, id: i64, now: &str) -> Result<(), FolderImportError> {
        self.atomically(|| -> rusqlite::Result<Result<(), FolderImportError>> {
            let Some(batch) = self.folder_import_batch(id)? else {
                return Ok(Err(FolderImportError::UnknownBatch));
            };
            if batch.status != BatchStatus::Pending {
                return Ok(Err(FolderImportError::Stale));
            }
            self.set_batch_status(id, BatchStatus::Dismissed, now)?;
            self.receipt(&batch, "dismissed", 0, now)?;
            self.record_folder_import_activity_inner(
                batch.mapping_id,
                Some(batch.account_id),
                &batch.file_name,
                "dismissed",
                "Dismissed — won't be queued again unless you choose Review again",
                Some(id),
                now,
            )?;
            Ok(Ok(()))
        })?
    }

    /// "Review again" for a saved export: puts it back in the queue (a pending one is returned as
    /// is), keeping its receipts, cutoff and watermark. Returns the batch, ready to open.
    pub fn requeue_folder_import(&self, id: i64, now: &str) -> Result<FolderImportBatch, FolderImportError> {
        self.atomically(|| -> rusqlite::Result<Result<FolderImportBatch, FolderImportError>> {
            let Some(batch) = self.folder_import_batch(id)? else {
                return Ok(Err(FolderImportError::UnknownBatch));
            };
            if batch.status == BatchStatus::Pending {
                return Ok(Ok(batch));
            }
            if !batch.has_content {
                return Ok(Err(FolderImportError::ContentGone));
            }
            self.set_batch_status(id, BatchStatus::Pending, now)?;
            self.record_folder_import_activity_inner(
                batch.mapping_id,
                Some(batch.account_id),
                &batch.file_name,
                "requeued",
                "Opened again for review",
                Some(id),
                now,
            )?;
            Ok(Ok(self.folder_import_batch(id)?.expect("just updated")))
        })?
    }

    /// Writes a reviewed folder export in one transaction: the rows (exactly as
    /// `commit_import_batch` writes a manual import), the batch marked imported, its receipt, and
    /// the mapping's watermark moved forward to the export's date when at least one row was
    /// imported. Refused, with nothing written, when the batch is no longer the pending version
    /// that was reviewed.
    pub fn commit_staged_import(
        &self,
        batch: &ImportBatch,
        batch_id: i64,
        row_version: i64,
        now: &str,
    ) -> Result<ImportBatchOutcome, FolderImportError> {
        let sql_tx = self.conn.unchecked_transaction()?;
        let Some(staged) = self.folder_import_batch(batch_id)? else {
            return Err(FolderImportError::UnknownBatch);
        };
        if staged.status != BatchStatus::Pending || staged.row_version != row_version {
            return Err(FolderImportError::Stale);
        }
        let outcome = self.write_import_batch(batch)?;
        let inserted = outcome.inserted_ids.len();
        self.set_batch_status(batch_id, BatchStatus::Imported, now)?;
        self.receipt(&staged, "imported", inserted, now)?;
        // Only forward, and only for the account the mapping still sends to.
        if inserted > 0
            && let Some(mapping_id) = staged.mapping_id
        {
            self.conn.execute(
                "UPDATE folder_import_mappings SET watermark = ?1
                 WHERE id = ?2 AND account_id = ?3 AND (watermark IS NULL OR watermark < ?1)",
                params![staged.export_end.to_string(), mapping_id, staged.account_id],
            )?;
        }
        let reason = match inserted {
            1 => "Imported 1 transaction".to_string(),
            n => format!("Imported {n} transactions"),
        };
        self.record_folder_import_activity_inner(staged.mapping_id, Some(staged.account_id), &staged.file_name, "imported", &reason, Some(batch_id), now)?;
        sql_tx.commit()?;
        Ok(outcome)
    }

    #[allow(clippy::too_many_arguments)]
    fn record_folder_import_activity_inner(
        &self,
        mapping_id: Option<i64>,
        account_id: Option<i64>,
        file_name: &str,
        outcome: &str,
        reason: &str,
        batch_id: Option<i64>,
        now: &str,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO folder_import_activity (at, mapping_id, account_id, file_name, outcome, reason, batch_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![now, mapping_id, account_id, file_name, outcome, reason, batch_id],
        )?;
        self.conn.execute(
            "DELETE FROM folder_import_activity WHERE id NOT IN (SELECT id FROM folder_import_activity ORDER BY id DESC LIMIT ?1)",
            params![MAX_ACTIVITY_ROWS],
        )?;
        Ok(())
    }

    /// Notes what discovery did with a file, and says whether an entry was added. A repeat of the
    /// file's latest entry (the same outcome and reason, as every scan of an older export would
    /// give) is not added again, and "folder_ok" is noted only right after a folder problem.
    #[allow(clippy::too_many_arguments)]
    pub fn record_folder_import_activity(
        &self,
        mapping_id: Option<i64>,
        account_id: Option<i64>,
        file_name: &str,
        outcome: &str,
        reason: &str,
        batch_id: Option<i64>,
        now: &str,
    ) -> rusqlite::Result<bool> {
        let latest: Option<(String, String)> = self
            .conn
            .query_row(
                "SELECT outcome, reason FROM folder_import_activity WHERE file_name = ?1 ORDER BY id DESC LIMIT 1",
                params![file_name],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if latest.as_ref().is_some_and(|(o, r)| o == outcome && r == reason) {
            return Ok(false);
        }
        if outcome == "folder_ok" && !latest.is_some_and(|(o, _)| o == "folder_problem") {
            return Ok(false);
        }
        self.record_folder_import_activity_inner(mapping_id, account_id, file_name, outcome, reason, batch_id, now)?;
        Ok(true)
    }

    /// Newest first.
    pub fn list_folder_import_activity(&self, limit: i64) -> rusqlite::Result<Vec<ActivityEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, at, mapping_id, account_id, file_name, outcome, reason, batch_id
             FROM folder_import_activity ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| {
            Ok(ActivityEntry {
                id: r.get(0)?,
                at: r.get(1)?,
                mapping_id: r.get(2)?,
                account_id: r.get(3)?,
                file_name: r.get(4)?,
                outcome: r.get(5)?,
                reason: r.get(6)?,
                batch_id: r.get(7)?,
            })
        })?;
        rows.collect()
    }

    pub fn folder_import_activity_entry(&self, id: i64) -> rusqlite::Result<Option<ActivityEntry>> {
        Ok(self.list_folder_import_activity(MAX_ACTIVITY_ROWS)?.into_iter().find(|a| a.id == id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AccountType, Transaction};
    use crate::store::{ImportAccount, ImportBatchRow, RowCategory};
    use rust_decimal::Decimal;
    use std::str::FromStr;

    const NOW: &str = "2026-11-22T10:00:00";

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn setup() -> (Store, i64, i64) {
        let store = Store::open_in_memory().unwrap();
        let account = store.create_account("Max Checking", AccountType::Checking).unwrap().unwrap();
        let mapping = store
            .save_folder_import_mapping(&FolderImportMappingInput {
                id: None,
                account_id: account,
                stem: "Bank Max Checking_".to_string(),
                extensions: vec!["CSV".to_string(), ".xlsx".to_string()],
                invert_amounts: false,
                initial_cutoff: Some(d("2026-11-01")),
            })
            .unwrap();
        (store, account, mapping)
    }

    fn stage(store: &Store, account: i64, mapping: i64, digest: &str, end: &str) -> StageOutcome {
        store
            .stage_folder_import(&StageInput {
                mapping_id: mapping,
                account_id: account,
                file_name: &format!("Bank Max Checking_{end}.csv"),
                digest,
                content: b"Date,Description,Amount\n2026-11-18,Cafe,-4.00\n",
                export_start: d(end),
                export_end: d(end),
                now: NOW,
            })
            .unwrap()
    }

    fn rows(account: i64, n: usize) -> ImportBatch {
        ImportBatch {
            rows: (0..n)
                .map(|i| ImportBatchRow {
                    account: ImportAccount::Existing(account),
                    transaction: Transaction {
                        date: d("2026-11-18"),
                        description: format!("Cafe {i}"),
                        amount: Decimal::from_str("-4.00").unwrap(),
                        category: None,
                    },
                    tags: Vec::new(),
                    notes: None,
                    category: RowCategory::LeaveUncategorized,
                })
                .collect(),
            ..ImportBatch::default()
        }
    }

    fn ledger_count(store: &Store) -> i64 {
        store.conn.query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0)).unwrap()
    }

    fn receipts(store: &Store) -> Vec<String> {
        let mut stmt = store.conn.prepare("SELECT outcome FROM folder_import_receipts ORDER BY id").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    }

    #[test]
    fn settings_default_off_and_mappings_validate_their_account_stem_and_extensions() {
        let (store, account, mapping) = setup();
        assert!(!store.folder_import_settings().unwrap().enabled, "default off");
        let saved = store.folder_import_mapping(mapping).unwrap().unwrap();
        assert_eq!(saved.extensions, vec!["csv", "xlsx"]);
        let base = FolderImportMappingInput {
            id: None,
            account_id: account,
            stem: "bank max checking".to_string(),
            extensions: vec!["csv".to_string()],
            invert_amounts: false,
            initial_cutoff: None,
        };
        assert!(matches!(store.save_folder_import_mapping(&base), Err(FolderImportError::StemInUse(_))), "same stem, any underscore/case");
        let other = FolderImportMappingInput { stem: "Card".to_string(), ..base.clone() };
        assert!(matches!(
            store.save_folder_import_mapping(&FolderImportMappingInput { account_id: 999, ..other.clone() }),
            Err(FolderImportError::UnknownAccount)
        ));
        assert!(matches!(
            store.save_folder_import_mapping(&FolderImportMappingInput { extensions: vec!["ofx".to_string()], ..other.clone() }),
            Err(FolderImportError::BadExtensions)
        ));
        assert!(matches!(
            store.save_folder_import_mapping(&FolderImportMappingInput { stem: " _ ".to_string(), ..other }),
            Err(FolderImportError::EmptyStem)
        ));
        let before = store.folder_import_settings().unwrap().revision;
        store.set_folder_imports_enabled(true).unwrap();
        let after = store.folder_import_settings().unwrap();
        assert!(after.enabled && after.revision > before);
    }

    #[test]
    fn staging_never_touches_the_ledger_and_the_same_content_is_never_queued_twice() {
        let (store, account, mapping) = setup();
        let first = stage(&store, account, mapping, "aaa", "2026-11-18");
        let StageOutcome::Queued(id) = first else { panic!("{first:?}") };
        assert_eq!(ledger_count(&store), 0, "pending content is financially inert");
        assert_eq!(
            stage(&store, account, mapping, "aaa", "2026-11-19"),
            StageOutcome::AlreadyKnown { batch_id: id, status: BatchStatus::Pending },
            "a renamed copy of the same bytes is the same export"
        );
        assert!(matches!(stage(&store, account, mapping, "bbb", "2026-11-18"), StageOutcome::Queued(_)), "same date, other content");
        assert_eq!(store.list_folder_import_batches(true).unwrap().len(), 2);
        assert_eq!(store.folder_import_batch_content(id).unwrap().unwrap(), b"Date,Description,Amount\n2026-11-18,Cafe,-4.00\n");
    }

    #[test]
    fn dismissal_survives_re_adding_and_review_again_reuses_the_one_batch() {
        let (store, account, mapping) = setup();
        let StageOutcome::Queued(id) = stage(&store, account, mapping, "aaa", "2026-11-18") else { panic!() };
        store.dismiss_folder_import(id, NOW).unwrap();
        assert_eq!(
            stage(&store, account, mapping, "aaa", "2026-11-18"),
            StageOutcome::AlreadyKnown { batch_id: id, status: BatchStatus::Dismissed }
        );
        assert_eq!(receipts(&store), vec!["dismissed"]);
        let again = store.requeue_folder_import(id, NOW).unwrap();
        assert_eq!((again.id, again.status), (id, BatchStatus::Pending));
        let twice = store.requeue_folder_import(id, NOW).unwrap();
        assert_eq!(twice.row_version, again.row_version, "a repeated click returns the same pending batch");
        assert_eq!(store.list_folder_import_batches(true).unwrap().len(), 1);
        assert_eq!(receipts(&store), vec!["dismissed"], "the dismissal stays on record");
        assert!(matches!(store.dismiss_folder_import(9999, NOW), Err(FolderImportError::UnknownBatch)));
    }

    #[test]
    fn commit_writes_rows_receipt_status_and_watermark_together() {
        let (store, account, mapping) = setup();
        let StageOutcome::Queued(id) = stage(&store, account, mapping, "aaa", "2026-11-18") else { panic!() };
        let version = store.folder_import_batch(id).unwrap().unwrap().row_version;
        let outcome = store.commit_staged_import(&rows(account, 2), id, version, NOW).unwrap();
        assert_eq!(outcome.inserted_ids.len(), 2);
        assert_eq!(ledger_count(&store), 2);
        assert_eq!(store.folder_import_batch(id).unwrap().unwrap().status, BatchStatus::Imported);
        assert_eq!(receipts(&store), vec!["imported"]);
        assert_eq!(store.folder_import_mapping(mapping).unwrap().unwrap().watermark, Some(d("2026-11-18")));
        assert!(
            matches!(store.commit_staged_import(&rows(account, 2), id, version, NOW), Err(FolderImportError::Stale)),
            "a second approval of the same review imports nothing"
        );
        assert_eq!(ledger_count(&store), 2);
    }

    #[test]
    fn an_older_export_imported_later_never_moves_the_watermark_back_and_zero_rows_never_move_it() {
        let (store, account, mapping) = setup();
        let StageOutcome::Queued(older) = stage(&store, account, mapping, "aaa", "2026-11-10") else { panic!() };
        let StageOutcome::Queued(newer) = stage(&store, account, mapping, "bbb", "2026-11-18") else { panic!() };
        let StageOutcome::Queued(empty) = stage(&store, account, mapping, "ccc", "2026-11-25") else { panic!() };
        store.commit_staged_import(&rows(account, 1), newer, 1, NOW).unwrap();
        assert_eq!(store.list_folder_import_batches(true).unwrap().len(), 2, "the older pending batch is kept");
        store.commit_staged_import(&rows(account, 1), older, 1, NOW).unwrap();
        store.commit_staged_import(&rows(account, 0), empty, 1, NOW).unwrap();
        assert_eq!(store.folder_import_mapping(mapping).unwrap().unwrap().watermark, Some(d("2026-11-18")));
        assert_eq!(receipts(&store), vec!["imported", "imported", "imported"]);
    }

    #[test]
    fn a_failure_at_any_write_leaves_the_ledger_batch_receipt_and_watermark_as_they_were() {
        for (label, trigger) in [
            ("ledger row", "CREATE TEMP TRIGGER fail BEFORE INSERT ON transactions WHEN NEW.description = 'Cafe 1' BEGIN SELECT RAISE(ABORT, 'injected'); END;"),
            ("receipt", "CREATE TEMP TRIGGER fail BEFORE INSERT ON folder_import_receipts BEGIN SELECT RAISE(ABORT, 'injected'); END;"),
            ("watermark", "CREATE TEMP TRIGGER fail BEFORE UPDATE OF watermark ON folder_import_mappings BEGIN SELECT RAISE(ABORT, 'injected'); END;"),
            ("activity", "CREATE TEMP TRIGGER fail BEFORE INSERT ON folder_import_activity WHEN NEW.outcome = 'imported' BEGIN SELECT RAISE(ABORT, 'injected'); END;"),
        ] {
            let (store, account, mapping) = setup();
            let StageOutcome::Queued(id) = stage(&store, account, mapping, "aaa", "2026-11-18") else { panic!() };
            store.conn.execute_batch(trigger).unwrap();
            assert!(store.commit_staged_import(&rows(account, 2), id, 1, NOW).is_err(), "{label}");
            assert_eq!(ledger_count(&store), 0, "{label}: no rows without a receipt");
            let batch = store.folder_import_batch(id).unwrap().unwrap();
            assert_eq!((batch.status, batch.row_version), (BatchStatus::Pending, 1), "{label}: still reviewable");
            assert!(receipts(&store).is_empty(), "{label}");
            assert_eq!(store.folder_import_mapping(mapping).unwrap().unwrap().watermark, None, "{label}");
            store.conn.execute_batch("DROP TRIGGER fail;").unwrap();
            store.commit_staged_import(&rows(account, 2), id, 1, NOW).unwrap();
            assert_eq!(ledger_count(&store), 2, "{label}: a retry imports once");
        }
    }

    #[test]
    fn a_deleted_or_hidden_account_blocks_the_commit_without_finishing_the_batch() {
        let (store, account, mapping) = setup();
        let StageOutcome::Queued(id) = stage(&store, account, mapping, "aaa", "2026-11-18") else { panic!() };
        store.delete_account(account).unwrap();
        assert!(!store.folder_import_account_usable(account).unwrap());
        assert!(matches!(store.commit_staged_import(&rows(account, 1), id, 1, NOW), Err(FolderImportError::Import(_))));
        assert_eq!(store.folder_import_batch(id).unwrap().unwrap().status, BatchStatus::Pending);
    }

    #[test]
    fn activity_skips_repeats_and_keeps_a_bounded_history() {
        let (store, account, mapping) = setup();
        for _ in 0..3 {
            store
                .record_folder_import_activity(Some(mapping), Some(account), "Bank Max Checking_2026-10-01.csv", "older", "Older export", None, NOW)
                .unwrap();
        }
        assert_eq!(store.list_folder_import_activity(50).unwrap().len(), 1);
        for i in 0..(MAX_ACTIVITY_ROWS + 5) {
            store.record_folder_import_activity(None, None, &format!("f{i}.csv"), "bad_name", "x", None, NOW).unwrap();
        }
        assert_eq!(store.list_folder_import_activity(1000).unwrap().len() as i64, MAX_ACTIVITY_ROWS);
    }

    #[test]
    fn changing_a_names_account_moves_its_waiting_exports_but_not_finished_ones() {
        let (store, account, mapping) = setup();
        let StageOutcome::Queued(done) = stage(&store, account, mapping, "aaa", "2026-11-10") else { panic!() };
        store.dismiss_folder_import(done, NOW).unwrap();
        let StageOutcome::Queued(waiting) = stage(&store, account, mapping, "bbb", "2026-11-12") else { panic!() };
        let StageOutcome::Queued(already) = stage(&store, account, mapping, "ccc", "2026-11-14") else { panic!() };
        let card = store.create_account("Max Card", AccountType::Credit).unwrap().unwrap();
        // The new account already dismissed this content: it isn't queued for it again.
        let other = store
            .save_folder_import_mapping(&FolderImportMappingInput {
                id: None,
                account_id: card,
                stem: "Card".to_string(),
                extensions: vec!["csv".to_string()],
                invert_amounts: false,
                initial_cutoff: None,
            })
            .unwrap();
        let StageOutcome::Queued(card_copy) = stage(&store, card, other, "ccc", "2026-11-14") else { panic!() };
        store.dismiss_folder_import(card_copy, NOW).unwrap();
        let before = store.folder_import_batch(waiting).unwrap().unwrap();

        let m = store.folder_import_mapping(mapping).unwrap().unwrap();
        store
            .save_folder_import_mapping(&FolderImportMappingInput {
                id: Some(mapping),
                account_id: card,
                stem: m.stem.clone(),
                extensions: m.extensions.clone(),
                invert_amounts: m.invert_amounts,
                initial_cutoff: m.initial_cutoff,
            })
            .unwrap();

        let moved = store.folder_import_batch(waiting).unwrap().unwrap();
        assert_eq!(moved.account_id, card, "a waiting export goes to the name's new account");
        assert!(moved.row_version > before.row_version, "a review opened for the old account can't be approved");
        assert_eq!(store.folder_import_batch(done).unwrap().unwrap().account_id, account, "finished exports keep their history");
        assert!(store.folder_import_batch(already).unwrap().is_none(), "content the new account already had isn't queued twice");
        assert_eq!(store.list_folder_import_batches(true).unwrap().iter().map(|b| b.id).collect::<Vec<_>>(), vec![waiting]);
    }

    #[test]
    fn waiting_copies_are_kept_under_the_saved_bytes_limit_too() {
        let (store, account, mapping) = setup();
        let StageOutcome::Queued(first) = stage(&store, account, mapping, "aaa", "2026-11-10") else { panic!() };
        store
            .conn
            .execute("UPDATE folder_import_batches SET size = ?1 WHERE id = ?2", params![MAX_STAGED_BYTES - 10, first])
            .unwrap();
        assert_eq!(stage(&store, account, mapping, "bbb", "2026-11-12"), StageOutcome::QueueFull, "no room left for its bytes");
        store.dismiss_folder_import(first, NOW).unwrap();
        assert!(matches!(stage(&store, account, mapping, "bbb", "2026-11-12"), StageOutcome::Queued(_)), "a finished copy makes room");
    }

    #[test]
    fn recording_says_whether_it_added_anything_and_a_folder_problem_is_noted_again_after_it_recovers() {
        let (store, _, _) = setup();
        let note = |outcome: &str, reason: &str| store.record_folder_import_activity(None, None, "Exports", outcome, reason, None, NOW).unwrap();
        assert!(!note("folder_ok", "The folder can be read again."), "nothing to recover from");
        assert!(note("folder_problem", "can't be found"));
        assert!(!note("folder_problem", "can't be found"), "a repeat adds nothing");
        assert!(note("folder_ok", "The folder can be read again."));
        assert!(!note("folder_ok", "The folder can be read again."));
        assert!(note("folder_problem", "can't be found"), "a second disconnection is its own entry");
    }

    #[test]
    fn the_newest_activity_read_is_kept_and_never_goes_back() {
        let (store, _, _) = setup();
        assert_eq!(store.folder_import_settings().unwrap().seen_activity_id, 0);
        store.mark_folder_import_activity_seen(12).unwrap();
        store.mark_folder_import_activity_seen(7).unwrap();
        assert_eq!(store.folder_import_settings().unwrap().seen_activity_id, 12);
    }

    #[test]
    fn the_newest_imported_date_can_be_cleared_and_a_reviews_sign_choice_remembered() {
        let (store, account, mapping) = setup();
        let StageOutcome::Queued(id) = stage(&store, account, mapping, "aaa", "2026-11-18") else { panic!() };
        let batch = store.folder_import_batch(id).unwrap().unwrap();
        store.commit_staged_import(&rows(account, 1), id, batch.row_version, NOW).unwrap();
        assert_eq!(store.folder_import_mapping(mapping).unwrap().unwrap().watermark, Some(d("2026-11-18")));
        let revision = store.folder_import_settings().unwrap().revision;
        store.clear_folder_import_watermark(mapping).unwrap();
        assert_eq!(store.folder_import_mapping(mapping).unwrap().unwrap().watermark, None);
        assert!(store.folder_import_settings().unwrap().revision > revision, "discovery starts over");
        store.set_folder_import_mapping_invert(mapping, true).unwrap();
        assert!(store.folder_import_mapping(mapping).unwrap().unwrap().invert_amounts);
        assert!(matches!(store.clear_folder_import_watermark(999), Err(FolderImportError::UnknownMapping)));
    }

    #[test]
    fn pruning_clears_only_finished_copies_and_requeue_then_needs_the_original() {
        let (store, account, mapping) = setup();
        let StageOutcome::Queued(old) = stage(&store, account, mapping, "aaa", "2026-11-10") else { panic!() };
        store.dismiss_folder_import(old, NOW).unwrap();
        let StageOutcome::Queued(pending) = stage(&store, account, mapping, "bbb", "2026-11-12") else { panic!() };
        // Pretend the saved bytes are already at the limit.
        store
            .conn
            .execute("UPDATE folder_import_batches SET size = ?1 WHERE id = ?2", params![MAX_STAGED_BYTES, pending])
            .unwrap();
        store.prune_folder_import_content().unwrap();
        assert!(store.folder_import_batch_content(pending).unwrap().is_some(), "pending copies are never cleared");
        assert!(store.folder_import_batch_content(old).unwrap().is_none());
        assert!(matches!(store.requeue_folder_import(old, NOW), Err(FolderImportError::ContentGone)));
        assert_eq!(
            stage(&store, account, mapping, "aaa", "2026-11-10"),
            StageOutcome::AlreadyKnown { batch_id: old, status: BatchStatus::Dismissed },
            "the receipt still suppresses it"
        );
    }
}
