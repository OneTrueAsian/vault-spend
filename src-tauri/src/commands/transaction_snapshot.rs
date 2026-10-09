//! Versioned, origin-session-bound reads for the shared transaction model.
use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionContext {
    contract_version: u8,
    generation: u64,
    session_revision: u64,
}

#[derive(Serialize, Debug)]
pub struct ReadError {
    code: &'static str,
    message: String,
}
impl ReadError {
    pub(super) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
impl From<String> for ReadError {
    fn from(message: String) -> Self {
        let code = if message.starts_with("PROFILE_LOCKED:") {
            "profile_locked"
        } else if message.starts_with("NO_PROFILE_OPEN:") {
            "no_profile_open"
        } else if message.starts_with("STALE_PROFILE:") {
            "stale_profile"
        } else {
            "internal_error"
        };
        Self { code, message }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionSnapshot {
    contract_version: u8,
    context: TransactionContext,
    revision: ReadRevision,
    requested_ids: Option<Vec<i64>>,
    transactions: Vec<TransactionDto>,
    stats: Stats,
    accounts: Vec<AccountDto>,
    categories: Vec<String>,
    category_icons: Vec<CategoryDto>,
    flags: Vec<AnomalyFlagDto>,
    tags: Vec<String>,
    members: Vec<FamilyMemberDto>,
}
#[derive(Serialize)]
struct ReadRevision {
    local: u64,
    external: u64,
}

#[tauri::command]
pub fn get_transaction_context(
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
) -> Result<TransactionContext, ReadError> {
    let _session = state.lock().map_err(ReadError::from)?;
    Ok(TransactionContext {
        contract_version: 1,
        generation: paths.current_generation(),
        session_revision: state.current_revision(),
    })
}

fn read_snapshot(store: &Store, context: TransactionContext, ids: Option<Vec<i64>>) -> Result<TransactionSnapshot, String> {
    store
        .read_snapshot(|store| {
            let (local, external) = store.read_revision()?;
            let rows = match &ids {
                Some(ids) => store.transactions_by_ids(ids)?,
                None => store.all_transactions()?,
            };
            let counts = store.category_counts()?;
            Ok(TransactionSnapshot {
                contract_version: 1,
                context,
                revision: ReadRevision { local, external },
                requested_ids: ids,
                transactions: rows.into_iter().map(super::transactions::transaction_dto).collect(),
                stats: Stats {
                    total: counts.total,
                    auto_categorized: counts.auto_categorized,
                    user_confirmed: counts.user_confirmed,
                    uncategorized: counts.uncategorized,
                },
                accounts: store
                    .list_accounts(chrono::Local::now().date_naive())?
                    .into_iter()
                    .map(super::accounts::account_dto)
                    .collect(),
                categories: store.list_categories()?,
                category_icons: store
                    .list_categories_with_icons()?
                    .into_iter()
                    .map(|c| CategoryDto {
                        name: c.name,
                        icon_key: c.icon_key,
                    })
                    .collect(),
                flags: store
                    .open_anomaly_flags()?
                    .into_iter()
                    .map(|f| AnomalyFlagDto {
                        transaction_id: f.transaction_id,
                        kind: f.kind,
                        detail: f.detail,
                    })
                    .collect(),
                tags: store.list_all_tags()?,
                members: store
                    .list_family_members()?
                    .into_iter()
                    .map(|m| FamilyMemberDto { id: m.id, name: m.name })
                    .collect(),
            })
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_transaction_snapshot(
    expected_generation: u64,
    expected_session_revision: u64,
    ids: Option<Vec<i64>>,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
) -> Result<TransactionSnapshot, ReadError> {
    if let Some(ids) = &ids {
        if ids.is_empty() || ids.len() > 250 || ids.iter().any(|id| *id <= 0 || *id > 9_007_199_254_740_991) {
            return Err(ReadError {
                code: "invalid_argument",
                message: "Request between 1 and 250 valid transaction identifiers.".into(),
            });
        }
    }
    let session = state.lock().map_err(ReadError::from)?;
    if expected_generation != paths.current_generation() || expected_session_revision != state.current_revision() {
        return Err(ReadError {
            code: "stale_profile",
            message: "This request belongs to a previous profile session.".into(),
        });
    }
    read_snapshot(
        &session.store,
        TransactionContext {
            contract_version: 1,
            generation: expected_generation,
            session_revision: expected_session_revision,
        },
        ids,
    )
    .map_err(|e| ReadError {
        code: "internal_error",
        message: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_and_targeted_contracts_preserve_money_nulls_and_deleted_rows() {
        let store = Store::open_in_memory().unwrap();
        let account = store.get_or_create_account("Fixture", AccountType::Checking).unwrap();
        let date = chrono::NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        let id = store
            .create_transaction(
                account,
                &budget_core::models::Transaction {
                    date,
                    description: "Fixture".into(),
                    amount: Decimal::from_str("9007199254740992.01").unwrap(),
                    category: None,
                },
                None,
            )
            .unwrap();
        let context = || TransactionContext {
            contract_version: 1,
            generation: 4,
            session_revision: 7,
        };
        let full = serde_json::to_value(read_snapshot(&store, context(), None).unwrap()).unwrap();
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../core/tests/fixtures/desktop_transaction.json")).unwrap();
        assert_eq!(full["transactions"][0], fixture);
        assert_eq!(full["transactions"][0]["amount"], "9007199254740992.01");
        assert!(full["transactions"][0]["notes"].is_null());
        assert_eq!(full["stats"]["total"], 1);
        store.delete_transaction(id, chrono::Local::now().naive_local()).unwrap();
        let partial = serde_json::to_value(read_snapshot(&store, context(), Some(vec![id])).unwrap()).unwrap();
        assert_eq!(partial["requestedIds"], serde_json::json!([id]));
        assert_eq!(partial["transactions"], serde_json::json!([]));
        assert_eq!(partial["stats"]["total"], 0);
    }
}
