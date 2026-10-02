//! Storage for the private comparison setup (`comparisons::setup`): one row per profile database,
//! so it is encrypted, backed up and restored with the rest of the profile. A submodule of `store`
//! (like `profile_ui_state`) because it needs `Store`'s private connection.
//!
//! Saves are optimistic: the caller says which revision it last saw, and a stale save is refused
//! rather than overwriting another edit. Validation and the write happen in one SQL transaction,
//! so a refused or failed save leaves the previous revision exactly as it was.
use super::Store;
use crate::comparisons::package::Package;
use crate::comparisons::setup::{
    ComparisonSetup, MAX_PAYLOAD_BYTES, Repair, SETUP_FORMAT_VERSION, SetupContext, SetupProblem, find_repairs, upgrade_v1_payload, validate_setup,
};
use chrono::NaiveDate;
use rusqlite::{OptionalExtension, params};
use std::collections::HashSet;

/// The saved setup and its revision. `revision` is 0 and `setup` is `None` until first saved.
#[derive(Debug, Clone)]
pub struct StoredComparisonSetup {
    pub revision: i64,
    pub setup: Option<ComparisonSetup>,
    /// Stored references to people, accounts or assets that have since been deleted.
    pub repairs: Vec<Repair>,
}

#[derive(Debug)]
pub enum ComparisonSetupError {
    /// The proposed setup broke one or more rules; nothing was saved.
    Invalid(Vec<SetupProblem>),
    /// Someone saved a newer revision first; nothing was saved.
    Conflict {
        current_revision: i64,
    },
    /// The stored setup was written by a newer version of the app.
    Unsupported {
        found: u32,
    },
    /// The stored payload could not be read. Never includes the payload itself: it is private.
    Corrupt(String),
    Db(rusqlite::Error),
}

impl std::fmt::Display for ComparisonSetupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ComparisonSetupError::Invalid(problems) => {
                write!(f, "The comparison setup has {} problem(s) and was not saved.", problems.len())
            }
            ComparisonSetupError::Conflict { current_revision } => {
                write!(f, "The comparison setup changed elsewhere (now revision {current_revision}).")
            }
            ComparisonSetupError::Unsupported { found } => {
                write!(f, "The saved comparison setup is version {found}, which this app cannot read.")
            }
            ComparisonSetupError::Corrupt(m) => write!(f, "The saved comparison setup could not be read: {m}"),
            ComparisonSetupError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ComparisonSetupError {}

impl From<rusqlite::Error> for ComparisonSetupError {
    fn from(e: rusqlite::Error) -> Self {
        ComparisonSetupError::Db(e)
    }
}

impl Store {
    fn id_set(&self, sql: &str) -> rusqlite::Result<HashSet<i64>> {
        let mut stmt = self.conn.prepare(sql)?;
        let ids = stmt
            .query_map([], |row| row.get::<_, i64>(0))?
            .collect::<rusqlite::Result<HashSet<i64>>>()?;
        Ok(ids)
    }

    /// Runs `f` with a validation context built from this profile's real people, accounts and assets.
    fn with_setup_context<T>(&self, today: NaiveDate, f: impl FnOnce(&SetupContext) -> T) -> rusqlite::Result<T> {
        let members = self.id_set("SELECT id FROM family_members")?;
        let accounts = self.id_set("SELECT id FROM accounts")?;
        let assets = self.id_set("SELECT id FROM assets")?;
        let ctx = SetupContext {
            package: Package::bundled().ok(),
            today,
            member_ids: &members,
            account_ids: &accounts,
            asset_ids: &assets,
        };
        Ok(f(&ctx))
    }

    /// The saved comparison setup (revision 0 and no setup when none was ever saved), plus a repair
    /// list for anything it references that has since been deleted.
    pub fn get_comparison_setup(&self) -> Result<StoredComparisonSetup, ComparisonSetupError> {
        let row: Option<(u32, i64, String)> = self
            .conn
            .query_row("SELECT format_version, revision, payload FROM comparison_setup WHERE id = 1", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()?;
        let Some((format_version, revision, payload)) = row else {
            return Ok(StoredComparisonSetup {
                revision: 0,
                setup: None,
                repairs: Vec::new(),
            });
        };
        let corrupt =
            |e: serde_json::Error| ComparisonSetupError::Corrupt(format!("{:?} error at line {} column {}", e.classify(), e.line(), e.column()));
        let payload = match format_version {
            SETUP_FORMAT_VERSION => payload,
            1 => upgrade_v1_payload(&payload).map_err(corrupt)?,
            found => return Err(ComparisonSetupError::Unsupported { found }),
        };
        let setup: ComparisonSetup = serde_json::from_str(&payload).map_err(corrupt)?;
        // The date only matters for validation, not for finding deleted references.
        let repairs = self.with_setup_context(NaiveDate::MIN, |ctx| find_repairs(&setup, ctx))?;
        Ok(StoredComparisonSetup {
            revision,
            setup: Some(setup),
            repairs,
        })
    }

    /// Validates and saves `setup` as the next revision. `expected_revision` is the revision the
    /// caller last read (0 for a profile that has never saved one).
    pub fn save_comparison_setup(
        &self,
        expected_revision: i64,
        setup: &ComparisonSetup,
        today: NaiveDate,
    ) -> Result<StoredComparisonSetup, ComparisonSetupError> {
        let payload = serde_json::to_string(setup).map_err(|_| ComparisonSetupError::Corrupt("the setup could not be serialised".into()))?;
        if payload.len() > MAX_PAYLOAD_BYTES {
            return Err(ComparisonSetupError::Invalid(vec![SetupProblem {
                field: "payload".into(),
                message: "The comparison setup is too large.".into(),
            }]));
        }

        let tx = self.conn.unchecked_transaction()?;
        let current: i64 = tx
            .query_row("SELECT revision FROM comparison_setup WHERE id = 1", [], |r| r.get(0))
            .optional()?
            .unwrap_or(0);
        if current != expected_revision {
            return Err(ComparisonSetupError::Conflict { current_revision: current });
        }
        let problems = self.with_setup_context(today, |ctx| validate_setup(setup, ctx))?;
        if !problems.is_empty() {
            return Err(ComparisonSetupError::Invalid(problems));
        }
        let next = current + 1;
        tx.execute(
            "INSERT INTO comparison_setup (id, format_version, revision, payload, updated_at)
             VALUES (1, ?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET format_version = excluded.format_version,
                 revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at",
            params![
                setup.format_version,
                next,
                payload,
                chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
            ],
        )?;
        tx.commit()?;
        Ok(StoredComparisonSetup {
            revision: next,
            setup: Some(setup.clone()),
            repairs: Vec::new(),
        })
    }
}
