//! Commands for Reports > Comparisons. Thin wrappers: the logic lives in `budget_core::comparisons`.
//! Each one holds the open-profile guard while it works and refuses when the page's generation is no
//! longer the active profile's, so a late reply can never land on (or save into) another profile
//! after a lock, switch, restore or relocation. Nothing here logs the person's figures.
use crate::commands::AppStateHandle;
use crate::config::AppPaths;
use budget_core::comparisons::service::{self, ComparisonsResponse, SaveResponse, SetupResponse};
use budget_core::comparisons::setup::ComparisonSetup;
use serde::Serialize;

const STALE: &str = "The active profile changed before this finished.";

fn ensure_current(current: u64, expected: u64) -> Result<(), String> {
    if current == expected {
        Ok(())
    } else {
        Err(STALE.to_string())
    }
}

fn today() -> chrono::NaiveDate {
    chrono::Local::now().date_naive()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardedSetup {
    generation: u64,
    #[serde(flatten)]
    inner: SetupResponse,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardedComparisons {
    generation: u64,
    #[serde(flatten)]
    inner: ComparisonsResponse,
}

#[tauri::command]
pub fn get_comparison_setup(
    expected_generation: u64,
    paths: tauri::State<AppPaths>,
    state: tauri::State<AppStateHandle>,
) -> Result<GuardedSetup, String> {
    let session = state.lock()?;
    ensure_current(paths.current_generation(), expected_generation)?;
    Ok(GuardedSetup {
        generation: expected_generation,
        inner: service::get_setup(&session.store)?,
    })
}

#[tauri::command]
pub fn save_comparison_setup(
    expected_generation: u64,
    expected_revision: i64,
    setup: ComparisonSetup,
    paths: tauri::State<AppPaths>,
    state: tauri::State<AppStateHandle>,
) -> Result<SaveResponse, String> {
    let session = state.lock()?;
    ensure_current(paths.current_generation(), expected_generation)?;
    service::save_setup(&session.store, expected_revision, &setup, today())
}

/// The five cards from one coherent read of the ledger and the saved setup.
#[tauri::command]
pub fn get_financial_comparisons(
    expected_generation: u64,
    paths: tauri::State<AppPaths>,
    state: tauri::State<AppStateHandle>,
) -> Result<GuardedComparisons, String> {
    let session = state.lock()?;
    ensure_current(paths.current_generation(), expected_generation)?;
    let inner = service::get_comparisons(&session.store, today())?;
    // Re-checked before returning: the guard above is held throughout, but this keeps the contract
    // explicit if the calculation is ever moved outside it.
    ensure_current(paths.current_generation(), expected_generation)?;
    Ok(GuardedComparisons {
        generation: expected_generation,
        inner,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_matching_generation_is_accepted() {
        assert!(ensure_current(4, 4).is_ok());
    }

    #[test]
    fn a_stale_generation_is_refused_with_a_message_that_contains_no_data() {
        let err = ensure_current(5, 4).unwrap_err();
        assert_eq!(err, STALE);
    }

    #[test]
    fn responses_flatten_the_generation_beside_the_payload() {
        let store = budget_core::store::Store::open_in_memory().unwrap();
        let guarded = GuardedComparisons {
            generation: 7,
            inner: service::get_comparisons(&store, today()).unwrap(),
        };
        let json = serde_json::to_value(guarded).unwrap();
        assert_eq!(json["generation"], 7);
        assert_eq!(json["configured"], false);
        assert_eq!(json["setupRevision"], 0);
        let setup = serde_json::to_value(GuardedSetup {
            generation: 7,
            inner: service::get_setup(&store).unwrap(),
        })
        .unwrap();
        assert_eq!((setup["generation"].as_u64(), setup["revision"].as_i64()), (Some(7), Some(0)));
    }
}
