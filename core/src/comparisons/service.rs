//! The operations the app's commands expose, kept in core so they are tested without Tauri. Expected
//! outcomes of a save (stale revision, rejected setup) are ordinary responses; only real failures
//! (database, unreadable stored setup) are errors, and none of them carry the person's figures.
use super::metrics::spending_window;
use super::package::Package;
use super::report::{ComparisonsReport, build_report};
use super::setup::{ComparisonSetup, Repair, SetupProblem};
use crate::store::{ComparisonSetupError, Store};
use chrono::NaiveDate;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupResponse {
    pub revision: i64,
    pub setup: Option<ComparisonSetup>,
    pub repairs: Vec<Repair>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SaveResponse {
    Saved {
        revision: i64,
        setup: Box<ComparisonSetup>,
    },
    #[serde(rename_all = "camelCase")]
    Conflict {
        current_revision: i64,
    },
    Invalid {
        problems: Vec<SetupProblem>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonsResponse {
    pub configured: bool,
    pub setup_revision: i64,
    pub repairs: Vec<Repair>,
    /// Set when the bundled benchmarks could not be loaded; the setup stays editable.
    pub package_error: Option<String>,
    pub report: Option<ComparisonsReport>,
}

fn fail(e: ComparisonSetupError) -> String {
    e.to_string()
}

pub fn get_setup(store: &Store) -> Result<SetupResponse, String> {
    let stored = store.get_comparison_setup().map_err(fail)?;
    Ok(SetupResponse {
        revision: stored.revision,
        setup: stored.setup,
        repairs: stored.repairs,
    })
}

pub fn save_setup(store: &Store, expected_revision: i64, setup: &ComparisonSetup, today: NaiveDate) -> Result<SaveResponse, String> {
    match store.save_comparison_setup(expected_revision, setup, today) {
        Ok(saved) => Ok(SaveResponse::Saved {
            revision: saved.revision,
            setup: Box::new(saved.setup.expect("a saved setup is present")),
        }),
        Err(ComparisonSetupError::Conflict { current_revision }) => Ok(SaveResponse::Conflict { current_revision }),
        Err(ComparisonSetupError::Invalid(problems)) => Ok(SaveResponse::Invalid { problems }),
        Err(other) => Err(fail(other)),
    }
}

/// One coherent read: the saved setup, one ledger snapshot and the five cards built from them.
pub fn get_comparisons(store: &Store, today: NaiveDate) -> Result<ComparisonsResponse, String> {
    let stored = store.get_comparison_setup().map_err(fail)?;
    let Some(setup) = stored.setup else {
        return Ok(ComparisonsResponse {
            configured: false,
            setup_revision: stored.revision,
            repairs: stored.repairs,
            package_error: None,
            report: None,
        });
    };
    let package = match Package::bundled() {
        Ok(p) => p,
        Err(e) => {
            return Ok(ComparisonsResponse {
                configured: true,
                setup_revision: stored.revision,
                repairs: stored.repairs,
                package_error: Some(e.to_string()),
                report: None,
            });
        }
    };
    let (spend_from, _) = spending_window(&setup, today);
    let snapshot = store.comparison_snapshot(today, spend_from).map_err(|e| e.to_string())?;
    Ok(ComparisonsResponse {
        configured: true,
        setup_revision: stored.revision,
        repairs: stored.repairs,
        package_error: None,
        report: Some(build_report(package, &setup, &snapshot)),
    })
}
