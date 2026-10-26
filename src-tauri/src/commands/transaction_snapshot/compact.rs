//! Version 2 transports the complete model with dictionary strings and fixed tuples.
//! No paging, filtering, arithmetic, inclusion or consumer-model change.
use super::*;
use std::collections::HashMap;

#[derive(Default)]
struct Strings {
    values: Vec<String>,
    indexes: HashMap<String, usize>,
}
impl Strings {
    fn text(&mut self, value: String) -> usize {
        if let Some(index) = self.indexes.get(&value) {
            return *index;
        }
        let index = self.values.len();
        self.indexes.insert(value.clone(), index);
        self.values.push(value);
        index
    }
    fn optional(&mut self, value: Option<String>) -> Option<usize> {
        value.map(|v| self.text(v))
    }
}
#[derive(Serialize)]
struct CompactDebt(usize, i64, usize, usize);
#[derive(Serialize)]
struct CompactRow(
    i64,
    Option<i64>,
    usize,
    usize,
    usize,
    Option<usize>,
    Option<usize>,
    Option<f64>,
    i64,
    usize,
    Option<CompactDebt>,
    Option<usize>,
    i64,
    Vec<usize>,
    Option<i64>,
    Option<usize>,
    Option<usize>,
);
#[derive(Serialize)]
struct CompactFlag(i64, usize, usize);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactTransactionSnapshot {
    contract_version: u8,
    context: TransactionContext,
    revision: ReadRevision,
    requested_ids: Option<Vec<i64>>,
    strings: Vec<String>,
    rows: Vec<CompactRow>,
    stats: Stats,
    accounts: Vec<AccountDto>,
    categories: Vec<String>,
    category_icons: Vec<CategoryDto>,
    flags: Vec<CompactFlag>,
    tags: Vec<String>,
    members: Vec<FamilyMemberDto>,
}
impl From<TransactionSnapshot> for CompactTransactionSnapshot {
    fn from(model: TransactionSnapshot) -> Self {
        let mut pool = Strings::default();
        let rows = model
            .transactions
            .into_iter()
            .map(|r| {
                CompactRow(
                    r.id,
                    r.transfer_counterpart_id,
                    pool.text(r.date),
                    pool.text(r.description),
                    pool.text(r.amount),
                    pool.optional(r.category),
                    pool.optional(r.category_source),
                    r.confidence,
                    r.account_id,
                    pool.text(r.account_name),
                    r.applied_to_debt
                        .map(|d| CompactDebt(pool.text(d.date), d.debt_account_id, pool.text(d.debt_account_name), pool.text(d.amount))),
                    pool.optional(r.principal_amount),
                    r.split_count,
                    r.tags.into_iter().map(|t| pool.text(t)).collect(),
                    r.member_id,
                    pool.optional(r.member_name),
                    pool.optional(r.notes),
                )
            })
            .collect();
        let flags = model
            .flags
            .into_iter()
            .map(|f| CompactFlag(f.transaction_id, pool.text(f.kind), pool.text(f.detail)))
            .collect();
        Self {
            contract_version: 2,
            context: model.context,
            revision: model.revision,
            requested_ids: model.requested_ids,
            strings: pool.values,
            rows,
            stats: model.stats,
            accounts: model.accounts,
            categories: model.categories,
            category_icons: model.category_icons,
            flags,
            tags: model.tags,
            members: model.members,
        }
    }
}
#[tauri::command]
pub fn get_transaction_snapshot_compact(
    expected_generation: u64,
    expected_session_revision: u64,
    ids: Option<Vec<i64>>,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
) -> Result<CompactTransactionSnapshot, ReadError> {
    super::get_transaction_snapshot(expected_generation, expected_session_revision, ids, state, paths).map(Into::into)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_wire_fixture_preserves_decimal_nulls_and_metadata() {
        let store = Store::open_in_memory().unwrap();
        let account = store.get_or_create_account("Fixture", AccountType::Checking).unwrap();
        store
            .create_transaction(
                account,
                &budget_core::models::Transaction {
                    date: chrono::NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
                    description: "Fixture".into(),
                    amount: Decimal::from_str("9007199254740992.01").unwrap(),
                    category: None,
                },
                None,
            )
            .unwrap();
        let full = super::super::read_snapshot(
            &store,
            TransactionContext {
                contract_version: 1,
                generation: 4,
                session_revision: 7,
            },
            None,
        )
        .unwrap();
        let original = serde_json::to_value(&full).unwrap();
        let compact = serde_json::to_value(CompactTransactionSnapshot::from(full)).unwrap();
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../../core/tests/fixtures/compact_transaction.json")).unwrap();
        assert_eq!(compact["rows"], fixture["rows"]);
        assert_eq!(compact["strings"], fixture["strings"]);
        for field in [
            "context",
            "revision",
            "requestedIds",
            "stats",
            "accounts",
            "categories",
            "categoryIcons",
            "tags",
            "members",
        ] {
            assert_eq!(compact[field], original[field]);
        }
        assert_eq!(compact["contractVersion"], 2);
    }
}
