//! Versioned, exact financial reads for the deterministic Ask the Vault parser.
use super::*;
use budget_core::store::{ask_comparison, AskAlignment, AskAverageKind, AskGroupBy, AskSpendFilter, AskSpendThreshold};
use chrono::NaiveDate;

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum AskKind {
    Total,
    RankCategories,
    RankPurchases,
    Compare,
}
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum AskGrouping {
    None,
    Month,
    Member,
}
impl From<AskGrouping> for AskGroupBy {
    fn from(value: AskGrouping) -> Self {
        match value {
            AskGrouping::None => Self::None,
            AskGrouping::Month => Self::Month,
            AskGrouping::Member => Self::Member,
        }
    }
}
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum AskAverageBasis {
    None,
    PerPurchase,
    PerMonth,
}
impl From<AskAverageBasis> for AskAverageKind {
    fn from(value: AskAverageBasis) -> Self {
        match value {
            AskAverageBasis::None => Self::None,
            AskAverageBasis::PerPurchase => Self::PerPurchase,
            AskAverageBasis::PerMonth => Self::PerMonth,
        }
    }
}
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum AskComparisonAlignment {
    AsRequested,
    SameDaysPreviousMonth,
    SameDaysPreviousYear,
}
impl From<AskComparisonAlignment> for AskAlignment {
    fn from(value: AskComparisonAlignment) -> Self {
        match value {
            AskComparisonAlignment::AsRequested => Self::AsRequested,
            AskComparisonAlignment::SameDaysPreviousMonth => Self::SameDaysPreviousMonth,
            AskComparisonAlignment::SameDaysPreviousYear => Self::SameDaysPreviousYear,
        }
    }
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AskMembers {
    ids: Vec<i64>,
    unassigned: bool,
}
fn legacy_version() -> u8 {
    1
}
/// Missing extension fields are allowed for v1; explicitly supplied null is never a valid selection or enum.
fn present_field<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(deserializer: D) -> Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
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
    #[serde(default = "legacy_version")]
    contract_version: u8,
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
    #[serde(default, deserialize_with = "present_field", skip_serializing_if = "Option::is_none")]
    members: Option<AskMembers>,
    #[serde(default, deserialize_with = "present_field", skip_serializing_if = "Option::is_none")]
    group_by: Option<AskGrouping>,
    #[serde(default, deserialize_with = "present_field", skip_serializing_if = "Option::is_none")]
    average: Option<AskAverageBasis>,
    #[serde(default, deserialize_with = "present_field", skip_serializing_if = "Option::is_none")]
    alignment: Option<AskComparisonAlignment>,
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
    // Flatten only for v2: v1 replies retain precisely their existing field set.
    #[serde(flatten)]
    v2: Option<AskPeriodResultV2>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskCategoryTotal {
    category: String,
    total: String,
    purchase_count: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskMemberTotal {
    member_id: Option<i64>,
    name: Option<String>,
    total: String,
    purchase_count: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskMonthRow {
    month: String,
    from: String,
    to: String,
    day_count: i64,
    coverage: &'static str,
    record_count: usize,
    total: String,
    purchase_count: usize,
}
#[derive(Debug, Serialize)]
struct AskAverageLeftOut {
    month: String,
    why: &'static str,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskAverage {
    basis: AskAverageBasis,
    numerator: String,
    denominator: usize,
    value: Option<String>,
    unavailable: Option<&'static str>,
    months_used: Vec<String>,
    months_left_out: Vec<AskAverageLeftOut>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskPeriodResultV2 {
    category_totals: Vec<AskCategoryTotal>,
    shared_purchase_count: usize,
    member_totals: Vec<AskMemberTotal>,
    months: Vec<AskMonthRow>,
    recorded_from: Option<String>,
    recorded_through: Option<String>,
    average: Option<AskAverage>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskClampedDays {
    requested_days: i64,
    used_days: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskComparison {
    alignment: AskComparisonAlignment,
    comparable: bool,
    not_comparable_reason: Option<&'static str>,
    elapsed_days: i64,
    clamped: Option<AskClampedDays>,
    absolute_change: String,
    percent_change: Option<String>,
    percent_outcome: &'static str,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskSnapshotV2 {
    earliest_record: Option<String>,
    comparison: Option<AskComparison>,
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
    #[serde(flatten)]
    v2: Option<AskSnapshotV2>,
}
fn invalid(message: &str) -> ReadError {
    ReadError::new("invalid_argument", message)
}
fn period_v2(result: &budget_core::store::AskSpendResult, basis: AskAverageBasis) -> AskPeriodResultV2 {
    AskPeriodResultV2 {
        category_totals: result
            .category_totals
            .iter()
            .map(|c| AskCategoryTotal {
                category: c.category.clone(),
                total: c.total.to_string(),
                purchase_count: c.purchase_count,
            })
            .collect(),
        shared_purchase_count: result.shared_purchase_count,
        member_totals: result
            .member_totals
            .iter()
            .map(|m| AskMemberTotal {
                member_id: m.member_id,
                name: m.name.clone(),
                total: m.total.to_string(),
                purchase_count: m.purchase_count,
            })
            .collect(),
        months: result
            .months
            .iter()
            .map(|m| AskMonthRow {
                month: m.month.clone(),
                from: m.from.to_string(),
                to: m.to.to_string(),
                day_count: m.day_count,
                coverage: m.coverage.as_str(),
                record_count: m.record_count,
                total: m.total.to_string(),
                purchase_count: m.purchase_count,
            })
            .collect(),
        recorded_from: result.recorded_from.map(|d| d.to_string()),
        recorded_through: result.recorded_through.map(|d| d.to_string()),
        average: result.average.as_ref().map(|a| AskAverage {
            basis,
            numerator: a.numerator.to_string(),
            denominator: a.denominator,
            value: a.value.map(|v| v.to_string()),
            unavailable: a.unavailable,
            months_used: a.months_used.clone(),
            months_left_out: a
                .months_left_out
                .iter()
                .map(|(month, why)| AskAverageLeftOut {
                    month: month.clone(),
                    why: why.as_str(),
                })
                .collect(),
        }),
    }
}
fn filters(request: &AskRequest, today: NaiveDate) -> Result<Vec<AskSpendFilter>, ReadError> {
    let v2 = match request.contract_version {
        1 => false,
        2 => true,
        _ => return Err(invalid("Choose a supported Ask the Vault contract version.")),
    };
    let extensions = (
        request.members.is_some(),
        request.group_by.is_some(),
        request.average.is_some(),
        request.alignment.is_some(),
    );
    if (!v2 && extensions != (false, false, false, false)) || (v2 && extensions != (true, true, true, true)) {
        return Err(invalid(
            "Use version 2 with all member, grouping, average and alignment fields for an enhanced question.",
        ));
    }
    let grouping = request.group_by.unwrap_or(AskGrouping::None);
    let average = request.average.unwrap_or(AskAverageBasis::None);
    let alignment = request.alignment.unwrap_or(AskComparisonAlignment::AsRequested);
    if grouping == AskGrouping::Member && average != AskAverageBasis::None {
        return Err(invalid("Ask for spending by family member or an average, separately."));
    }
    if request.kind != AskKind::Total && (grouping != AskGrouping::None || average != AskAverageBasis::None) {
        return Err(invalid("Use one total-spending period for grouping or averages."));
    }
    if request.kind != AskKind::Compare && alignment != AskComparisonAlignment::AsRequested {
        return Err(invalid("Use a comparison when asking for the same days in a previous month or year."));
    }
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
    let filters: Vec<AskSpendFilter> = request
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
                as_of: today,
                member_ids: request.members.as_ref().map(|m| m.ids.clone()).unwrap_or_default(),
                include_unassigned: request.members.as_ref().is_some_and(|m| m.unassigned),
                group_by: grouping.into(),
                average: average.into(),
            };
            if filter.to > today {
                return Err(invalid("Recorded-spending periods must end on or before today."));
            }
            // Pure filter validation returns fixed guidance, never database errors or stored/user text.
            filter.validate().map_err(|error| match error {
                budget_core::store::StoreError::InvalidParameterName(message) => invalid(&message),
                _ => invalid("Check the selected dates, results limit and filters."),
            })?;
            Ok(filter)
        })
        .collect::<Result<_, _>>()?;
    if v2 && request.kind == AskKind::Compare {
        // Validate the caller-resolved alignment before querying, including comparisons over empty data.
        ask_comparison(
            alignment.into(),
            (filters[0].from, filters[0].to),
            (filters[1].from, filters[1].to),
            Decimal::ZERO,
            Decimal::ZERO,
        )
        .map_err(|_| invalid("Choose comparison dates that match the requested alignment."))?;
    }
    Ok(filters)
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
            let mut earliest_record = None;
            for filter in &filters {
                let result = store.ask_spending(filter)?;
                totals.push(result.total);
                earliest_record = result.earliest_record.map(|d| d.to_string());
                let v2 = (request.contract_version == 2).then(|| period_v2(&result, request.average.unwrap_or(AskAverageBasis::None)));
                periods.push(AskPeriodResult {
                    v2,
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
            let v2 = if request.contract_version == 2 {
                let comparison = if request.kind == AskKind::Compare {
                    let alignment = request.alignment.unwrap_or(AskComparisonAlignment::AsRequested);
                    let facts = ask_comparison(
                        alignment.into(),
                        (filters[0].from, filters[0].to),
                        (filters[1].from, filters[1].to),
                        totals[0],
                        totals[1],
                    )
                    .map_err(|_| rusqlite_error("Comparison exceeds the supported range or dates do not match the requested alignment"))?;
                    Some(AskComparison {
                        alignment,
                        comparable: facts.comparable,
                        not_comparable_reason: facts.not_comparable_reason,
                        elapsed_days: facts.elapsed_days,
                        clamped: facts
                            .clamped
                            .map(|(requested_days, used_days)| AskClampedDays { requested_days, used_days }),
                        absolute_change: facts.absolute_change.to_string(),
                        percent_change: facts.percent_change.map(|p| p.to_string()),
                        percent_outcome: facts.percent_outcome,
                    })
                } else {
                    None
                };
                Some(AskSnapshotV2 { earliest_record, comparison })
            } else {
                None
            };
            Ok(Ok(AskSnapshot {
                contract_version: request.contract_version,
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
                v2,
            }))
        })
        .map_err(|e| match e {
            // Only this fixed, known store refusal is exposed; database details remain redacted below.
            budget_core::store::StoreError::InvalidParameterName(message)
                if message == "Choose fewer family members: at most 50 lines can be shown" =>
            {
                invalid("Choose fewer family members: at most 50 lines can be shown.")
            }
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
