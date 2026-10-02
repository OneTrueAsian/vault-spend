//! Comparison arithmetic and the rules for when a comparison is allowed: population, period,
//! age cohort, reliability and dollar basis. Pure functions over a `Package` and a plain query,
//! with no database or Tauri dependency, so every rule is testable on its own.
use super::cohort::{CohortMatch, match_cohort};
use super::package::Package;
use super::types::{
    AdjustedReference, AgeInput, CardStatus, ComparisonCardResult, ComparisonMode, Completeness, DollarBasis, MetricId, Reason, Reference,
    Reliability, Uncertainty, Unit, Universe,
};
use rust_decimal::{Decimal, RoundingStrategy};

const AWAY: RoundingStrategy = RoundingStrategy::MidpointAwayFromZero;

/// What the person has locally for one metric, already reduced to one number by the caller.
#[derive(Debug, Clone)]
pub struct LocalMeasure {
    /// `None` is "we do not have it", which is never the same as zero.
    pub value: Option<Decimal>,
    pub unit: Unit,
    /// Whether the person actually holds the asset/debt (a zero balance does not).
    pub holds_item: bool,
    pub completeness: Completeness,
}

#[derive(Debug, Clone)]
pub struct CardQuery<'a> {
    pub metric: MetricId,
    pub mode: ComparisonMode,
    /// Which published definition to compare against (e.g. retirement vs. brokerage). `None` means
    /// the metric has no chosen definition yet.
    pub definition_id: Option<&'a str>,
    pub age: Option<AgeInput>,
    /// The person's remembered pick among cohorts a band spans, by reference id.
    pub selected_cohort: Option<&'a str>,
    /// The person's remembered All peers / Holders only choice.
    pub universe_preference: Option<Universe>,
    pub local: LocalMeasure,
}

// ----------------------------------------------------------------------------- arithmetic

pub fn dollar_difference(local: Decimal, reference: Decimal) -> Decimal {
    local - reference
}

/// `(local - reference) / reference` as a percentage with one decimal, midpoints away from zero.
/// Absent unless the reference is positive: a percent of zero or a negative is meaningless.
pub fn percent_difference(local: Decimal, reference: Decimal) -> Option<String> {
    if reference <= Decimal::ZERO {
        return None;
    }
    let pct = ((local - reference) / reference * Decimal::from(100)).round_dp_with_strategy(1, AWAY);
    Some(pct.normalize().to_string())
}

/// Annual amount / 12. This is a monthly *equivalent* of an annual figure, not a measured monthly one.
pub fn monthly_equivalent(annual: Decimal) -> Decimal {
    (annual / Decimal::from(12)).round_dp_with_strategy(2, AWAY)
}

/// Converts between flow units; balances only convert to themselves.
pub fn convert_unit(value: Decimal, from: Unit, to: Unit) -> Option<Decimal> {
    match (from, to) {
        (a, b) if a == b => Some(value),
        (Unit::UsdPerYear, Unit::UsdPerMonth) => Some(monthly_equivalent(value)),
        (Unit::UsdPerMonth, Unit::UsdPerYear) => Some(value * Decimal::from(12)),
        _ => None,
    }
}

// --------------------------------------------------------------------------------- inflation

/// Re-expresses a reference in the latest bundled CPI month's dollars, keeping the original intact.
fn adjust(pkg: &Package, reference: &Reference) -> Result<AdjustedReference, Reason> {
    let (basis_label, basis_cpi) = match &reference.dollar_basis {
        DollarBasis::Month { period } => (period.clone(), pkg.cpi(period)),
        DollarBasis::AnnualAverage { period } => (period.clone(), pkg.cpi_annual_average(period)),
    };
    let latest_month = pkg.latest_cpi_month().to_string();
    let (Some(basis_cpi), Some(latest_cpi)) = (basis_cpi, pkg.cpi(&latest_month)) else {
        return Err(Reason::CpiUnavailable { basis: basis_label });
    };
    if basis_cpi <= Decimal::ZERO {
        return Err(Reason::CpiUnavailable { basis: basis_label });
    }
    let factor = (latest_cpi / basis_cpi).round_dp_with_strategy(6, AWAY);
    let scale = |v: Decimal| (v * factor).round_dp_with_strategy(2, AWAY);
    Ok(AdjustedReference {
        reference: reference.clone(),
        adjusted_value: scale(reference.value),
        adjusted_uncertainty: reference.uncertainty.as_ref().map(|u| Uncertainty {
            kind: u.kind,
            value: scale(u.value),
        }),
        adjusted_basis_month: latest_month,
        cpi_factor: factor,
    })
}

// ---------------------------------------------------------------------------------- the card

fn card(q: &CardQuery, status: CardStatus, reasons: Vec<Reason>) -> ComparisonCardResult {
    ComparisonCardResult {
        metric: q.metric,
        status,
        local_value: q.local.value,
        reference: None,
        dollar_difference: None,
        percent_difference: None,
        reasons,
        completeness: q.local.completeness,
    }
}

/// Picks the population: the remembered choice if it exists, else everyone, else holders only.
fn choose_universe(available: &[Universe], preference: Option<Universe>) -> Universe {
    match preference {
        Some(p) if available.contains(&p) => p,
        _ if available.contains(&Universe::All) => Universe::All,
        _ => Universe::Holders,
    }
}

pub fn compare(pkg: &Package, q: &CardQuery) -> ComparisonCardResult {
    // 1. Is there any benchmark at all? This comes before missing input on purpose: a benchmark
    //    that does not exist keeps its card visible, however complete the person's setup is.
    let pool: Vec<&Reference> = pkg
        .references(q.metric, q.mode)
        .filter(|r| q.definition_id.is_none_or(|d| r.definition_id == d))
        .collect();
    if pool.is_empty() {
        let defined_elsewhere = q.definition_id.is_some_and(|d| {
            [ComparisonMode::Household, ComparisonMode::Individual]
                .iter()
                .any(|m| pkg.references(q.metric, *m).any(|r| r.definition_id == d))
        });
        let removed = q.definition_id.is_some() && !defined_elsewhere && pkg.gap_reason(q.metric, q.mode).is_none();
        let reason = if removed { Reason::BenchmarkRemoved } else { Reason::NoBenchmark };
        return card(q, CardStatus::Unavailable, vec![reason]);
    }

    // 2. What the person still has to tell us.
    let (Some(age), Some(local_value)) = (q.age, q.local.value) else {
        return card(q, CardStatus::MissingInput, vec![Reason::MissingInput]);
    };
    if q.local.completeness != Completeness::Confirmed {
        return card(q, CardStatus::Incomplete, vec![Reason::IncompleteCoverage]);
    }

    // 3. Which population.
    let mut reasons = Vec::new();
    let mut universes: Vec<Universe> = pool.iter().map(|r| r.universe).collect();
    universes.sort();
    universes.dedup();
    let universe = choose_universe(&universes, q.universe_preference);
    if universe == Universe::Holders {
        if !q.local.holds_item || local_value.is_zero() {
            return card(q, CardStatus::NotComparable, vec![Reason::HoldersOnlyZeroLocal]);
        }
        if universes.len() == 1 {
            reasons.push(Reason::HoldersOnlyUsed);
        }
    }
    let candidates: Vec<&Reference> = pool.into_iter().filter(|r| r.universe == universe).collect();

    // 4. Which age cohort.
    let (reference, approximate) = match match_cohort(&candidates, age) {
        CohortMatch::Exact(r) => (r, false),
        CohortMatch::Nearest { reference, .. } => (reference, true),
        CohortMatch::ChoiceRequired { options, approximate } => match q.selected_cohort.and_then(|id| options.iter().find(|r| r.id == id)) {
            Some(chosen) => (*chosen, approximate),
            None => {
                let ids = options.iter().map(|r| r.id.clone()).collect();
                return card(q, CardStatus::CohortChoiceRequired, vec![Reason::CohortChoiceRequired { options: ids }]);
            }
        },
        CohortMatch::None => return card(q, CardStatus::Unavailable, vec![Reason::NoMatchingAgeBenchmark]),
    };
    if approximate {
        reasons.push(Reason::NearestCohortUsed {
            cohort: reference.id.clone(),
        });
    }

    // 5. Is the published number trustworthy.
    if reference.reliability == Reliability::Unreliable {
        return card(q, CardStatus::Unreliable, vec![Reason::ReferenceTooUncertain]);
    }

    // 6. Same unit, same dollars.
    let Some(local_value) = convert_unit(local_value, q.local.unit, reference.unit) else {
        return card(q, CardStatus::Unavailable, vec![Reason::UnitMismatch]);
    };
    let adjusted = match adjust(pkg, reference) {
        Ok(a) => a,
        Err(reason) => return card(q, CardStatus::Unavailable, vec![reason]),
    };
    let basis_label = match &reference.dollar_basis {
        DollarBasis::Month { period } | DollarBasis::AnnualAverage { period } => period.clone(),
    };
    let already_latest = matches!(&reference.dollar_basis, DollarBasis::Month { period } if period == pkg.latest_cpi_month());
    if !already_latest {
        reasons.push(Reason::InflationAdjusted {
            from: basis_label,
            to: adjusted.adjusted_basis_month.clone(),
        });
    }

    let mut result = card(q, CardStatus::Comparable, reasons);
    result.local_value = Some(local_value);
    result.dollar_difference = Some(dollar_difference(local_value, adjusted.adjusted_value));
    result.percent_difference = percent_difference(local_value, adjusted.adjusted_value);
    result.reference = Some(adjusted);
    if approximate {
        result.status = CardStatus::Approximate;
    }
    result
}
