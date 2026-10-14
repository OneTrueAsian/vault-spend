//! Versioned, exact financial reads for the deterministic Ask the Vault parser.
use super::*;
use budget_core::store::{AskSpendFilter, AskSpendThreshold};
use chrono::NaiveDate;

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum AskKind {
    Total,
    RankCategories,
    RankPurchases,
    Compare,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AskPeriod {
    from: String,
    to: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AskMinimumPurchase {
    amount: String,
    inclusive: bool,
}
#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AskDataRevision {
    local: u64,
    external: u64,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AskRequest {
    kind: AskKind,
    periods: Vec<AskPeriod>,
    #[serde(default)]
    account_ids: Vec<i64>,
    #[serde(default)]
    categories: Vec<String>,
    minimum_purchase: Option<AskMinimumPurchase>,
    /// Stores or payees as typed (at most ten); the core read matches any of them against descriptions.
    #[serde(default)]
    vendors: Vec<String>,
    /// Stores to leave out, and categories to leave out; both are reported back as `leftOut`.
    #[serde(default)]
    exclude_vendors: Vec<String>,
    #[serde(default)]
    exclude_categories: Vec<String>,
    limit: usize,
    pub(super) expected_revision: Option<AskDataRevision>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskContext {
    generation: u64,
    session_revision: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskCategory {
    category: Option<String>,
    amount: String,
    purchase_count: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskVendor {
    description: String,
    purchase_count: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskVendorTotal {
    term: String,
    total: String,
    purchase_count: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskLeftOut {
    total: String,
    purchase_count: usize,
    vendors: Vec<AskVendor>,
    categories: Vec<AskCategory>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskPurchase {
    transaction_id: i64,
    account_id: i64,
    date: String,
    description: String,
    amount: String,
    parent_amount: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskPeriodResult {
    from: String,
    to: String,
    day_count: i64,
    ends_today: bool,
    /// Recording dates do not establish completeness. Do not infer it from the first row.
    history_coverage: &'static str,
    total: String,
    purchase_count: usize,
    category_count: usize,
    categories: Vec<AskCategory>,
    purchases: Vec<AskPurchase>,
    /// Names a vendor filter matched (at most 10, most purchases first); empty without a vendor filter.
    vendors: Vec<AskVendor>,
    vendor_name_count: usize,
    /// One entry per store asked for, in order; the totals add up to `total`.
    vendor_totals: Vec<AskVendorTotal>,
    /// What the exclusions removed. Zero and empty when nothing was left out.
    left_out: AskLeftOut,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskSnapshot {
    contract_version: u8,
    context: AskContext,
    revision: AskDataRevision,
    as_of: String,
    kind: AskKind,
    spending_basis: &'static str,
    threshold_basis: &'static str,
    periods: Vec<AskPeriodResult>,
    /// First requested period minus the second. No extrapolation or percentage trend.
    difference: Option<String>,
}
fn invalid(message: &str) -> ReadError {
    ReadError::new("invalid_argument", message)
}
fn filters(request: &AskRequest, today: NaiveDate) -> Result<Vec<AskSpendFilter>, ReadError> {
    let required = if request.kind == AskKind::Compare { 2 } else { 1 };
    if request.periods.len() != required {
        return Err(invalid("Choose one period, or exactly two periods for a comparison."));
    }
    let threshold = request
        .minimum_purchase
        .as_ref()
        .map(|value| {
            let pieces: Vec<_> = value.amount.split('.').collect();
            if value.amount.len() > 32
                || pieces.len() > 2
                || pieces[0].is_empty()
                || pieces.iter().any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
                || (pieces.len() == 2 && pieces[1].len() > 2)
            {
                return Err(invalid("Enter a nonnegative dollar amount with at most two decimal places."));
            }
            Ok(AskSpendThreshold {
                amount: Decimal::from_str_exact(&value.amount).map_err(|_| invalid("The amount cannot be represented exactly."))?,
                inclusive: value.inclusive,
            })
        })
        .transpose()?;
    request
        .periods
        .iter()
        .map(|period| {
            let date = |text: &str| {
                let parsed = NaiveDate::parse_from_str(text, "%Y-%m-%d").map_err(|_| invalid("Choose valid dates in YYYY-MM-DD format."))?;
                if parsed.to_string() != text {
                    return Err(invalid("Choose dates in YYYY-MM-DD format."));
                }
                Ok(parsed)
            };
            let filter = AskSpendFilter {
                from: date(&period.from)?,
                to: date(&period.to)?,
                account_ids: request.account_ids.clone(),
                categories: request.categories.clone(),
                minimum_purchase: threshold.clone(),
                vendors: request.vendors.clone(),
                exclude_vendors: request.exclude_vendors.clone(),
                exclude_categories: request.exclude_categories.clone(),
                limit: request.limit,
            };
            if filter.to > today {
                return Err(invalid("Recorded-spending periods must end on or before today."));
            }
            filter
                .validate()
                .map_err(|_| invalid("Choose an ordered bounded date range, 1 to 50 results, and at most 20 distinct valid entities."))?;
            Ok(filter)
        })
        .collect()
}
pub(super) fn snapshot(
    store: &Store,
    generation: u64,
    session_revision: u64,
    request: &AskRequest,
    today: NaiveDate,
) -> Result<AskSnapshot, ReadError> {
    let filters = filters(request, today)?;
    store
        .read_snapshot(|store| {
            let (local, external) = store.read_revision()?;
            let revision = AskDataRevision { local, external };
            if request.expected_revision.as_ref().is_some_and(|expected| expected != &revision) {
                return Ok(Err(ReadError::new(
                    "stale_data",
                    "Your ledger changed. Ask again using the current data.",
                )));
            }
            let mut periods = Vec::new();
            let mut totals = Vec::new();
            for filter in &filters {
                let result = store.ask_spending(filter)?;
                totals.push(result.total);
                periods.push(AskPeriodResult {
                    from: filter.from.to_string(),
                    to: filter.to.to_string(),
                    day_count: (filter.to - filter.from).num_days() + 1,
                    ends_today: filter.to == today,
                    history_coverage: "unknown",
                    total: result.total.to_string(),
                    purchase_count: result.purchase_count,
                    category_count: result.category_count,
                    categories: if request.kind == AskKind::RankCategories {
                        result
                            .categories
                            .into_iter()
                            .map(|c| AskCategory {
                                category: c.category,
                                amount: c.amount.to_string(),
                                purchase_count: c.purchase_count,
                            })
                            .collect()
                    } else {
                        Vec::new()
                    },
                    vendor_name_count: result.vendor_name_count,
                    vendor_totals: result
                        .vendor_totals
                        .into_iter()
                        .map(|v| AskVendorTotal {
                            term: v.term,
                            total: v.total.to_string(),
                            purchase_count: v.purchase_count,
                        })
                        .collect(),
                    left_out: AskLeftOut {
                        total: result.left_out.total.to_string(),
                        purchase_count: result.left_out.purchase_count,
                        vendors: result
                            .left_out
                            .vendors
                            .into_iter()
                            .map(|v| AskVendor {
                                description: v.description,
                                purchase_count: v.purchase_count,
                            })
                            .collect(),
                        categories: result
                            .left_out
                            .categories
                            .into_iter()
                            .map(|c| AskCategory {
                                category: c.category,
                                amount: c.amount.to_string(),
                                purchase_count: c.purchase_count,
                            })
                            .collect(),
                    },
                    vendors: result
                        .vendors
                        .into_iter()
                        .map(|v| AskVendor {
                            description: v.description,
                            purchase_count: v.purchase_count,
                        })
                        .collect(),
                    purchases: if request.kind == AskKind::RankPurchases {
                        result
                            .purchases
                            .into_iter()
                            .map(|p| AskPurchase {
                                transaction_id: p.transaction_id,
                                account_id: p.account_id,
                                date: p.date,
                                description: p.description,
                                amount: p.amount.to_string(),
                                parent_amount: p.parent_amount.to_string(),
                            })
                            .collect()
                    } else {
                        Vec::new()
                    },
                });
            }
            let difference = if totals.len() == 2 {
                Some(
                    totals[0]
                        .checked_sub(totals[1])
                        .filter(|difference| {
                            difference.checked_add(totals[1]) == Some(totals[0]) && totals[0].checked_sub(*difference) == Some(totals[1])
                        })
                        .ok_or_else(|| rusqlite_error("Comparison exceeds the supported decimal range"))?
                        .to_string(),
                )
            } else {
                None
            };
            Ok(Ok(AskSnapshot {
                contract_version: 1,
                context: AskContext {
                    generation,
                    session_revision,
                },
                revision,
                as_of: today.to_string(),
                kind: request.kind,
                spending_basis: "gross-negative-allocations",
                threshold_basis: "absolute-parent-amount",
                periods,
                difference,
            }))
        })
        .map_err(|e| match e {
            budget_core::store::StoreError::InvalidParameterName(_) => {
                invalid("A selected entity is unavailable or the monetary total is outside the supported range.")
            }
            _ => ReadError::new("internal_error", "The spending read could not be completed."),
        })?
}
fn rusqlite_error(message: &str) -> budget_core::store::StoreError {
    budget_core::store::StoreError::InvalidParameterName(message.into())
}
pub(super) fn read_for_session(
    request: &AskRequest,
    expected_generation: u64,
    expected_session_revision: u64,
    state: &AppStateHandle,
    paths: &crate::config::AppPaths,
) -> Result<AskSnapshot, ReadError> {
    // The established command worker owns this synchronous read. Keeping the open-session
    // guard prevents a lock/profile replacement during the coherent database snapshot.
    let session = state.lock().map_err(ReadError::from)?;
    if paths.current_generation() != expected_generation || state.current_revision() != expected_session_revision {
        return Err(ReadError::new("stale_profile", "This question belongs to a previous profile session."));
    }
    snapshot(
        &session.store,
        expected_generation,
        expected_session_revision,
        request,
        chrono::Local::now().date_naive(),
    )
}
#[tauri::command]
pub fn get_ask_vault_snapshot(
    request: AskRequest,
    expected_generation: u64,
    expected_session_revision: u64,
    state: tauri::State<AppStateHandle>,
    paths: tauri::State<crate::config::AppPaths>,
) -> Result<AskSnapshot, ReadError> {
    read_for_session(&request, expected_generation, expected_session_revision, &state, &paths)
}
