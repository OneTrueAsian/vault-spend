//! Shared comparison types: public reference records, the result of comparing one metric, and the
//! age inputs a person can give. Money is `Decimal` in memory and a decimal *string* on the wire,
//! so no financial arithmetic is ever done in binary floats on either side of IPC.
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// serde adapter: `Decimal` <-> JSON string.
pub mod money_str {
    use super::*;
    use serde::{Deserializer, Serializer};

    pub fn serialize<S: Serializer>(value: &Decimal, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&value.normalize().to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Decimal, D::Error> {
        let text = String::deserialize(d)?;
        Decimal::from_str(&text).map_err(|_| serde::de::Error::custom(format!("not a decimal string: {text:?}")))
    }
}

/// `Option<Decimal>` <-> JSON string or null.
pub mod money_str_opt {
    use super::*;
    use serde::{Deserializer, Serializer};

    pub fn serialize<S: Serializer>(value: &Option<Decimal>, s: S) -> Result<S::Ok, S::Error> {
        match value {
            Some(v) => s.serialize_str(&v.normalize().to_string()),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Decimal>, D::Error> {
        match Option::<String>::deserialize(d)? {
            None => Ok(None),
            Some(text) => Decimal::from_str(&text)
                .map(Some)
                .map_err(|_| serde::de::Error::custom(format!("not a decimal string: {text:?}"))),
        }
    }
}

/// `BTreeMap<String, Decimal>` serialised with every value as a decimal string.
pub mod money_map {
    use super::*;
    use serde::ser::SerializeMap;
    use serde::Serializer;
    use std::collections::BTreeMap;

    pub fn serialize<S: Serializer>(map: &BTreeMap<String, Decimal>, s: S) -> Result<S::Ok, S::Error> {
        let mut out = s.serialize_map(Some(map.len()))?;
        for (k, v) in map {
            out.serialize_entry(k, &v.normalize().to_string())?;
        }
        out.end()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricId {
    Spending,
    Investments,
    Income,
    Savings,
    Debt,
}

impl MetricId {
    pub const ALL: [MetricId; 5] =
        [MetricId::Spending, MetricId::Investments, MetricId::Income, MetricId::Savings, MetricId::Debt];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComparisonMode {
    Household,
    Individual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Statistic {
    Mean,
    Median,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Unit {
    UsdPerYear,
    UsdPerMonth,
    UsdBalance,
}

/// Who a reference describes: everyone in the population, or only those who hold the item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Universe {
    All,
    Holders,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reliability {
    Ok,
    Unreliable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeriodKind {
    Flow,
    Stock,
}

/// ISO dates; a stock uses its valuation date for both ends.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValuePeriod {
    pub kind: PeriodKind,
    pub from: String,
    pub to: String,
}

/// The price level a reference's dollars are expressed in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DollarBasis {
    /// A single CPI month, `YYYY-MM`.
    Month { period: String },
    /// The average of all twelve CPI months of a year; unusable if any month was not published.
    AnnualAverage { period: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UncertaintyKind {
    Moe90,
    Se,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Uncertainty {
    pub kind: UncertaintyKind,
    #[serde(with = "money_str")]
    pub value: Decimal,
}

/// One published statistic for one population and age cohort, exactly as it appears in the
/// bundled package (original value, original dollar basis).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub id: String,
    pub metric: MetricId,
    pub mode: ComparisonMode,
    pub definition_id: String,
    pub population: String,
    pub universe: Universe,
    pub geography: String,
    pub age_min: u32,
    /// Inclusive; `None` is an open upper band ("75 and over").
    pub age_max: Option<u32>,
    pub statistic: Statistic,
    #[serde(with = "money_str")]
    pub value: Decimal,
    pub unit: Unit,
    pub period: ValuePeriod,
    pub dollar_basis: DollarBasis,
    pub source_id: String,
    pub source_url: String,
    pub source_locator: String,
    pub uncertainty: Option<Uncertainty>,
    pub annotation: Option<String>,
    pub reliability: Reliability,
}

/// What a person told us about an age: a whole number or a published-style band.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgeInput {
    Exact { age: u32 },
    /// Inclusive; `max: None` is open ended ("65 and over").
    Band { min: u32, max: Option<u32> },
}

pub const MIN_ADULT_AGE: u32 = 18;
pub const MAX_AGE: u32 = 120;

impl AgeInput {
    /// Ages the input spans: `(low, high)` with `high = None` for an open band.
    pub fn span(&self) -> (u32, Option<u32>) {
        match *self {
            AgeInput::Exact { age } => (age, Some(age)),
            AgeInput::Band { min, max } => (min, max),
        }
    }

    pub fn is_valid(&self) -> bool {
        let (lo, hi) = self.span();
        (MIN_ADULT_AGE..=MAX_AGE).contains(&lo) && hi.is_none_or(|h| (lo..=MAX_AGE).contains(&h))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CardStatus {
    Comparable,
    /// A substitute (nearest) cohort was used; always shown with a visible warning.
    Approximate,
    MissingInput,
    Incomplete,
    /// The benchmark itself is not available: a source gap, removed metric, or CPI gap.
    Unavailable,
    Unreliable,
    /// The entered band spans several published cohorts and the person has not chosen one.
    CohortChoiceRequired,
    /// A zero local value against a holders-only benchmark.
    NotComparable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Completeness {
    Confirmed,
    Partial,
    Unknown,
}

/// Why a card is not a plain comparison. Machine-readable so the UI picks the wording.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum Reason {
    NoBenchmark,
    NoMatchingAgeBenchmark,
    BenchmarkRemoved,
    ReferenceTooUncertain,
    CohortChoiceRequired { options: Vec<String> },
    NearestCohortUsed { cohort: String },
    HoldersOnlyZeroLocal,
    HoldersOnlyUsed,
    CpiUnavailable { basis: String },
    InflationAdjusted { from: String, to: String },
    UnitMismatch,
    MissingInput,
    IncompleteCoverage,
}

/// A reference after inflation adjustment; the original stays alongside the adjusted value.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdjustedReference {
    pub reference: Reference,
    #[serde(with = "money_str")]
    pub adjusted_value: Decimal,
    pub adjusted_uncertainty: Option<Uncertainty>,
    /// CPI month the adjusted dollars are expressed in (`YYYY-MM`).
    pub adjusted_basis_month: String,
    #[serde(with = "money_str")]
    pub cpi_factor: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonCardResult {
    pub metric: MetricId,
    pub status: CardStatus,
    #[serde(with = "money_str_opt")]
    pub local_value: Option<Decimal>,
    pub reference: Option<AdjustedReference>,
    #[serde(with = "money_str_opt")]
    pub dollar_difference: Option<Decimal>,
    /// Percent of the reference, one decimal place, e.g. `"20"` or `"-12.5"`; absent when the
    /// reference is zero or negative.
    pub percent_difference: Option<String>,
    pub reasons: Vec<Reason>,
    pub completeness: Completeness,
}
