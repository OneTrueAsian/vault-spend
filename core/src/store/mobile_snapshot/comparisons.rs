use super::*;
use crate::comparisons::{
    metrics::Origin,
    setup::PersonRef,
    types::{ComparisonCardResult, DollarBasis, Reason},
};
fn name<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_value(v).unwrap().as_str().unwrap().into()
}
fn reason(r: &Reason) -> ComparisonReason {
    let (detail, options) = match r {
        Reason::CohortChoiceRequired { options } => (None, options.clone()),
        Reason::NearestCohortUsed { cohort } => (Some(cohort.clone()), Vec::new()),
        Reason::CpiUnavailable { basis } => (Some(basis.clone()), Vec::new()),
        Reason::InflationAdjusted { from, to } => (Some(format!("{from} to {to}")), Vec::new()),
        _ => (None, Vec::new()),
    };
    let code = serde_json::to_value(r).unwrap()["code"].as_str().unwrap().into();
    ComparisonReason { code, detail, options }
}
fn result(r: ComparisonCardResult) -> ComparisonResult {
    ComparisonResult {
        metric: name(&r.metric),
        status: name(&r.status),
        local_value: r.local_value.map(money),
        reference: r.reference.map(|a| {
            let r = a.reference;
            let (kind, period) = match r.dollar_basis {
                DollarBasis::Month { period } => ("month", period),
                DollarBasis::AnnualAverage { period } => ("annual_average", period),
            };
            ComparisonReference {
                id: r.id,
                mode: name(&r.mode),
                definition_id: r.definition_id,
                value: money(r.value),
                adjusted_value: money(a.adjusted_value),
                uncertainty: a.adjusted_uncertainty.as_ref().map(|u| money(u.value)),
                uncertainty_kind: a.adjusted_uncertainty.as_ref().map(|u| name(&u.kind)),
                unit: name(&r.unit),
                statistic: name(&r.statistic),
                population: r.population,
                universe: name(&r.universe),
                geography: r.geography,
                age_min: r.age_min,
                age_max: r.age_max,
                period_kind: name(&r.period.kind),
                period_from: r.period.from,
                period_to: r.period.to,
                dollar_basis: super::DollarBasis { kind: kind.into(), period },
                adjusted_basis_month: a.adjusted_basis_month,
                cpi_factor: money(a.cpi_factor),
                source_id: r.source_id,
                source_url: r.source_url,
                source_locator: r.source_locator,
                annotation: r.annotation,
                reliability: name(&r.reliability),
            }
        }),
        dollar_difference: r.dollar_difference.map(money),
        percent_difference: r.percent_difference,
        completeness: name(&r.completeness),
        reasons: r.reasons.iter().map(reason).collect(),
    }
}
pub(super) fn read(store: &Store, as_of: NaiveDate) -> Result<Comparisons, MobileSnapshotError> {
    let response = crate::comparisons::service::get_comparisons(store, as_of).map_err(|_| MobileSnapshotError::Database)?;
    let members = store.list_family_members()?;
    let problem = if response.package_error.is_some() {
        Some("benchmark_package_unavailable".into())
    } else if !response.repairs.is_empty() {
        Some("setup_needs_repair".into())
    } else {
        None
    };
    let (package_version, cards) = match response.report {
        None => (None, Vec::new()),
        Some(report) => (
            Some(report.package_version),
            report
                .cards
                .into_iter()
                .map(|c| {
                    let (origin, measured_on, explanation) = match c.metric.origin {
                        Origin::Derived => ("derived", None, None),
                        Origin::Entered {
                            measured_on, explanation, ..
                        } => ("entered", Some(measured_on), Some(explanation)),
                    };
                    ComparisonCard {
                        result: result(c.result),
                        visible: c.visible,
                        definition_id: c.definition_id,
                        stale: c.stale,
                        personal_income_hint: c.personal_income_hint,
                        metric_unit: name(&c.metric.unit),
                        period_kind: c.metric.period.as_ref().map(|p| name(&p.kind)),
                        period_from: c.metric.period.as_ref().map(|p| p.from.clone()),
                        period_to: c.metric.period.map(|p| p.to),
                        origin: origin.into(),
                        measured_on,
                        explanation,
                        unallocated: money(c.metric.unallocated),
                        tracked_value: c.metric.tracked_value.map(money),
                        contributors: c
                            .metric
                            .contributors
                            .into_iter()
                            .map(|x| ComparisonContributor {
                                label: x.label,
                                gross: money(x.gross),
                                share_basis_points: x.share_basis_points,
                                counted: money(x.counted),
                            })
                            .collect(),
                        excluded: c
                            .metric
                            .excluded
                            .into_iter()
                            .map(|x| ComparisonReason {
                                code: name(&x.reason),
                                detail: Some(x.label),
                                options: Vec::new(),
                            })
                            .collect(),
                        class_totals: c
                            .metric
                            .class_totals
                            .into_iter()
                            .map(|(label, value)| ComparisonClass { label, value: money(value) })
                            .collect(),
                        notes: c
                            .metric
                            .notes
                            .into_iter()
                            .map(|n| ComparisonReason {
                                code: n.code,
                                detail: Some(n.detail),
                                options: Vec::new(),
                            })
                            .collect(),
                        secondary: c
                            .secondary
                            .into_iter()
                            .map(|s| ComparisonSecondary {
                                label: match s.person {
                                    None => s.label,
                                    Some(PersonRef::Owner) => format!("Me: {}", s.label),
                                    Some(PersonRef::Member { id }) => format!(
                                        "{}: {}",
                                        members.iter().find(|m| m.id == id).map(|m| m.name.as_str()).unwrap_or("Removed member"),
                                        s.label
                                    ),
                                },
                                result: result(s.result),
                            })
                            .collect(),
                    }
                })
                .collect(),
        ),
    };
    Ok(Comparisons {
        configured: response.configured,
        package_version,
        setup_revision: response
            .setup_revision
            .try_into()
            .map(|n: u64| n.to_string())
            .map_err(|_| MobileSnapshotError::InvalidSnapshot)?,
        problem,
        cards,
    })
}
