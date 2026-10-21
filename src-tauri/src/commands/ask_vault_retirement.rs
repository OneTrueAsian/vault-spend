//! Minimal read-only M5 account context; interpretation and confirmation stay in the UI.
use super::*;
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RetirementRevision {
    local: u64,
    external: u64,
}
fn required_revision<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<RetirementRevision>, D::Error> {
    Option::<RetirementRevision>::deserialize(d)
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetirementRosterRequest {
    contract_version: u8,
    #[serde(deserialize_with = "required_revision")]
    expected_revision: Option<RetirementRevision>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetirementContextRequest {
    contract_version: u8,
    account_id: i64,
    #[serde(deserialize_with = "required_revision")]
    expected_revision: Option<RetirementRevision>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetirementOrigin {
    generation: u64,
    session_revision: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetirementRosterSnapshot {
    contract_version: u8,
    context: RetirementOrigin,
    revision: RetirementRevision,
    as_of: String,
    accounts: Vec<budget_core::store::RetirementAccount>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetirementContextSnapshot {
    contract_version: u8,
    context: RetirementOrigin,
    revision: RetirementRevision,
    as_of: String,
    #[serde(flatten)]
    data: budget_core::store::RetirementContextData,
}
const MAX_SAFE: u64 = 9_007_199_254_740_991;
fn invalid() -> ReadError {
    ReadError::new("invalid_argument", "Choose one existing investment account using the supported contract.")
}
fn internal() -> ReadError {
    ReadError::new("internal_error", "The account details could not be read. Try again.")
}
fn core_error(error: budget_core::store::RetirementReadError) -> ReadError {
    match error {
        budget_core::store::RetirementReadError::AccountUnavailable => ReadError::new(
            "account_unavailable",
            "That investment account is no longer available. Choose an account again.",
        ),
        budget_core::store::RetirementReadError::TooManyAccounts => ReadError::new(
            "too_many_accounts",
            "There are more than 200 investment accounts. The list cannot be shown.",
        ),
        _ => internal(), // Never export SQL, monetary inputs or profile details in errors.
    }
}
fn with_snapshot<T>(
    store: &Store,
    version: u8,
    expected: &Option<RetirementRevision>,
    today: NaiveDate,
    read: impl FnOnce(&Store) -> Result<T, budget_core::store::RetirementReadError>,
) -> Result<(RetirementRevision, T), ReadError> {
    if version != 1
        || !("1900-01-01"..="2100-12-31").contains(&today.to_string().as_str())
        || expected.as_ref().is_some_and(|r| r.local > MAX_SAFE || r.external > MAX_SAFE)
    {
        return Err(invalid());
    }
    store
        .read_snapshot(|store| {
            let (local, external) = store.read_revision()?;
            if local > MAX_SAFE || external > MAX_SAFE {
                return Ok(Err(internal()));
            }
            let revision = RetirementRevision { local, external };
            if expected.as_ref().is_some_and(|r| r != &revision) {
                return Ok(Err(ReadError::new(
                    "stale_data",
                    "Your accounts or plan changed. Ask again using the current details.",
                )));
            }
            Ok(read(store).map(|data| (revision, data)).map_err(core_error))
        })
        .map_err(|_| internal())?
}
fn retirement_roster_snapshot(
    store: &Store,
    generation: u64,
    session_revision: u64,
    request: &RetirementRosterRequest,
    today: NaiveDate,
) -> Result<RetirementRosterSnapshot, ReadError> {
    if generation > MAX_SAFE || session_revision > MAX_SAFE {
        return Err(invalid());
    }
    let (revision, accounts) = with_snapshot(store, request.contract_version, &request.expected_revision, today, |s| {
        s.retirement_accounts(today)
    })?;
    Ok(RetirementRosterSnapshot {
        contract_version: 1,
        context: RetirementOrigin {
            generation,
            session_revision,
        },
        revision,
        as_of: today.to_string(),
        accounts,
    })
}
fn retirement_context_snapshot(
    store: &Store,
    generation: u64,
    session_revision: u64,
    request: &RetirementContextRequest,
    today: NaiveDate,
) -> Result<RetirementContextSnapshot, ReadError> {
    if request.account_id <= 0 || request.account_id as u64 > MAX_SAFE || generation > MAX_SAFE || session_revision > MAX_SAFE {
        return Err(invalid());
    }
    let (revision, data) = with_snapshot(store, request.contract_version, &request.expected_revision, today, |s| {
        s.retirement_context(request.account_id, today)
    })?;
    Ok(RetirementContextSnapshot {
        contract_version: 1,
        context: RetirementOrigin {
            generation,
            session_revision,
        },
        revision,
        as_of: today.to_string(),
        data,
    })
}
fn read_retirement_roster_for_session(
    request: &RetirementRosterRequest,
    generation: u64,
    revision: u64,
    state: &AppStateHandle,
    paths: &crate::config::AppPaths,
) -> Result<RetirementRosterSnapshot, ReadError> {
    let session = state.lock().map_err(ReadError::from)?;
    if paths.current_generation() != generation || state.current_revision() != revision {
        return Err(ReadError::new(
            "stale_profile",
            "That account belongs to an earlier profile session. Ask again.",
        ));
    }
    retirement_roster_snapshot(&session.store, generation, revision, request, chrono::Local::now().date_naive())
}
fn read_retirement_context_for_session(
    request: &RetirementContextRequest,
    generation: u64,
    revision: u64,
    state: &AppStateHandle,
    paths: &crate::config::AppPaths,
) -> Result<RetirementContextSnapshot, ReadError> {
    let session = state.lock().map_err(ReadError::from)?;
    if paths.current_generation() != generation || state.current_revision() != revision {
        return Err(ReadError::new(
            "stale_profile",
            "That account belongs to an earlier profile session. Ask again.",
        ));
    }
    retirement_context_snapshot(&session.store, generation, revision, request, chrono::Local::now().date_naive())
}
#[tauri::command]
pub fn get_ask_vault_retirement_accounts(
    request: RetirementRosterRequest,
    expected_generation: u64,
    expected_session_revision: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
) -> Result<RetirementRosterSnapshot, ReadError> {
    read_retirement_roster_for_session(&request, expected_generation, expected_session_revision, &state, &paths)
}
#[tauri::command]
pub fn get_ask_vault_retirement_context(
    request: RetirementContextRequest,
    expected_generation: u64,
    expected_session_revision: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
) -> Result<RetirementContextSnapshot, ReadError> {
    read_retirement_context_for_session(&request, expected_generation, expected_session_revision, &state, &paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn roster() -> RetirementRosterRequest {
        serde_json::from_value(json!({"contractVersion":1,"expectedRevision":null})).unwrap()
    }
    fn context() -> RetirementContextRequest {
        serde_json::from_value(json!({"contractVersion":1,"accountId":1,"expectedRevision":null})).unwrap()
    }
    fn code<T: std::fmt::Debug>(r: Result<T, ReadError>) -> serde_json::Value {
        serde_json::to_value(r.unwrap_err()).unwrap()["code"].clone()
    }
    fn store() -> Store {
        let s = Store::open_in_memory().unwrap();
        s.get_or_create_account("IRA", budget_core::models::AccountType::Investment).unwrap();
        s
    }
    #[test]
    fn retirement_commands_strict_request_fields_are_required_even_when_null() {
        for value in [
            json!({"contractVersion":1}),
            json!({"contractVersion":1,"expectedRevision":null,"question":"private"}),
            json!({"contractVersion":1,"expectedRevision":{"local":0,"external":0,"extra":1}}),
        ] {
            assert!(serde_json::from_value::<RetirementRosterRequest>(value).is_err());
        }
        for value in [
            json!({"contractVersion":1,"accountId":1}),
            json!({"contractVersion":1,"accountId":1,"expectedRevision":null,"asOf":"2026-01-01"}),
            json!({"contractVersion":1,"accountId":1,"expectedRevision":{"local":-1,"external":0}}),
        ] {
            assert!(serde_json::from_value::<RetirementContextRequest>(value).is_err());
        }
    }
    #[test]
    fn retirement_commands_one_snapshot_minimal_source_and_zero_writes() {
        let s = store();
        let day = "2026-10-17".parse().unwrap();
        let before = s.read_revision().unwrap();
        let a = serde_json::to_value(retirement_roster_snapshot(&s, 3, 11, &roster(), day).unwrap()).unwrap();
        let c = serde_json::to_value(retirement_context_snapshot(&s, 3, 11, &context(), day).unwrap()).unwrap();
        assert_eq!(a["accounts"], json!([{"id":1,"name":"IRA"}]));
        assert_eq!(a["context"], json!({"generation":3,"sessionRevision":11}));
        assert_eq!(c["revision"], a["revision"]);
        assert_eq!(c["asOf"], "2026-10-17");
        assert_eq!(c["worth"], json!({"amount":null,"basis":"none"}));
        assert_eq!(c["contribution"], json!({"kind":"missing"}));
        assert_eq!(c["returnAssumption"], json!({"kind":"application-default","annualPct":"7"}));
        assert_eq!(before, s.read_revision().unwrap());
    }
    #[test]
    fn retirement_commands_revision_refusal_precedes_missing_account_and_setting_writes_retire_context() {
        let s = store();
        let day = "2026-10-17".parse().unwrap();
        let (local, external) = s.read_revision().unwrap();
        let mut external_mismatch = context();
        external_mismatch.account_id = 999;
        external_mismatch.expected_revision = Some(RetirementRevision {
            local,
            external: external + 1,
        });
        assert_eq!(code(retirement_context_snapshot(&s, 1, 1, &external_mismatch, day)), "stale_data");
        let mut c = context();
        c.expected_revision = Some(RetirementRevision { local, external });
        assert!(retirement_context_snapshot(&s, 1, 1, &c, day).is_ok());
        s.set_inflation_pct(Decimal::from(4)).unwrap();
        c.account_id = 999;
        assert_eq!(code(retirement_context_snapshot(&s, 1, 1, &c, day)), "stale_data");
        let mut r = roster();
        r.expected_revision = c.expected_revision.clone();
        assert_eq!(code(retirement_roster_snapshot(&s, 1, 1, &r, day)), "stale_data");
    }
    #[test]
    fn retirement_commands_invalid_version_id_and_unsafe_revision_refuse() {
        let s = store();
        let day = "2026-10-17".parse().unwrap();
        for id in [0, -1, 9_007_199_254_740_992] {
            let mut c = context();
            c.account_id = id;
            assert_eq!(code(retirement_context_snapshot(&s, 1, 1, &c, day)), "invalid_argument");
        }
        let mut c = context();
        c.contract_version = 2;
        assert_eq!(code(retirement_context_snapshot(&s, 1, 1, &c, day)), "invalid_argument");
        let mut r = roster();
        r.contract_version = 2;
        assert_eq!(code(retirement_roster_snapshot(&s, 1, 1, &r, day)), "invalid_argument");
        for (local, external) in [(MAX_SAFE + 1, 0), (0, MAX_SAFE + 1)] {
            let mut r = roster();
            r.expected_revision = Some(RetirementRevision { local, external });
            assert_eq!(code(retirement_roster_snapshot(&s, 1, 1, &r, day)), "invalid_argument");
            let mut c = context();
            c.expected_revision = Some(RetirementRevision { local, external });
            assert_eq!(code(retirement_context_snapshot(&s, 1, 1, &c, day)), "invalid_argument");
        }
    }
    #[test]
    fn retirement_commands_session_authorization_for_both_reads() {
        let runtime = crate::runtime::AppRuntime::no_profile_open();
        let paths = crate::config::AppPaths {
            config_path: "unused".into(),
            db_path: std::sync::Mutex::new("unused".into()),
            generation: std::sync::atomic::AtomicU64::new(4),
        };
        assert_eq!(
            code(read_retirement_roster_for_session(&roster(), 4, 0, &runtime, &paths)),
            "no_profile_open"
        );
        assert_eq!(
            code(read_retirement_context_for_session(&context(), 4, 0, &runtime, &paths)),
            "no_profile_open"
        );
        let make = || AppState {
            store: store(),
            rules: RuleSet::new(vec![]),
            import_review: None,
        };
        runtime.install(make());
        let revision = runtime.current_revision();
        assert!(read_retirement_roster_for_session(&roster(), 4, revision, &runtime, &paths).is_ok());
        assert!(read_retirement_context_for_session(&context(), 4, revision, &runtime, &paths).is_ok());
        assert_eq!(
            code(read_retirement_roster_for_session(&roster(), 3, revision, &runtime, &paths)),
            "stale_profile"
        );
        assert_eq!(
            code(read_retirement_context_for_session(&context(), 3, revision, &runtime, &paths)),
            "stale_profile"
        );
        runtime.lock_profile("synthetic");
        assert_eq!(
            code(read_retirement_roster_for_session(&roster(), 4, revision, &runtime, &paths)),
            "profile_locked"
        );
        assert_eq!(
            code(read_retirement_context_for_session(&context(), 4, revision, &runtime, &paths)),
            "profile_locked"
        );
        runtime.install(make());
        assert_eq!(
            code(read_retirement_roster_for_session(&roster(), 4, revision, &runtime, &paths)),
            "stale_profile"
        );
        assert_eq!(
            code(read_retirement_context_for_session(&context(), 4, revision, &runtime, &paths)),
            "stale_profile"
        );
    }
}
