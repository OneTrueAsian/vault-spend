//! Turns the saved setup, a local snapshot and the benchmark package into the five comparison
//! cards the page shows. One call, one snapshot: the cards can never describe different moments.
use super::cohort::{match_cohort, CohortMatch};
use super::engine::{compare, CardQuery, LocalMeasure};
use super::metrics::{compute_metrics, MetricComputation, Origin, Snapshot};
use super::package::Package;
use super::setup::ComparisonSetup;
use super::types::{
    AgeInput, CardStatus, Completeness, ComparisonCardResult, ComparisonMode, MetricId, Reference, Universe,
};
use serde::Serialize;

/// The published definition each headline card compares against. A definition the current package
/// no longer carries keeps its card visible as "no longer available".
fn definition_for(metric: MetricId) -> Option<&'static str> {
    match metric {
        MetricId::Income => Some("cps_hinc02_money_income_median"),
        MetricId::Savings => Some("sipp_financial_institution_assets_median"),
        MetricId::Investments => Some("sipp_retirement_accounts_median"),
        MetricId::Debt => Some("sipp_total_debt_median"),
        // Spending has no single definition: the engine uses every household spending reference.
        MetricId::Spending => None,
    }
}

/// Extra comparisons shown in a card's details: a class total against its own published definition.
fn secondary_definitions(metric: MetricId) -> &'static [(&'static str, &'static str, &'static str)] {
    // (class key in `MetricComputation::class_totals`, definition id, label)
    match metric {
        MetricId::Investments => &[("taxable", "sipp_stocks_mutual_funds_median", "Stocks and mutual funds")],
        MetricId::Debt => &[
            ("mortgage", "sipp_home_debt_median", "Home debt"),
            ("credit_card", "sipp_credit_card_debt_median", "Credit card debt"),
            ("student_loan", "sipp_student_loan_median", "Student loans"),
        ],
        _ => &[],
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CohortOption {
    pub id: String,
    pub age_min: u32,
    pub age_max: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondaryCard {
    pub label: String,
    pub definition_id: String,
    pub result: ComparisonCardResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardView {
    pub result: ComparisonCardResult,
    /// Cards that only lack the person's own input are hidden; benchmark gaps stay visible.
    pub visible: bool,
    pub definition_id: Option<String>,
    /// What the local figure is made of: contributors, exclusions, origin, notes.
    pub metric: MetricComputation,
    pub secondary: Vec<SecondaryCard>,
    /// The populations the package offers for this definition (All peers / Holders only).
    pub universe_options: Vec<Universe>,
    /// Published cohorts the entered age band spans; the person picks one per card.
    pub cohort_options: Vec<CohortOption>,
    /// A typed total older than its warning threshold. Warning only; it still applies.
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonsReport {
    pub package_version: String,
    pub cards: Vec<CardView>,
}

fn subject_age(setup: &ComparisonSetup) -> Option<AgeInput> {
    let who = setup.household_reference_person.as_ref()?;
    setup.people.iter().find(|p| &p.person == who)?.age.as_ref().map(|a| a.age)
}

fn local_measure(m: &MetricComputation) -> LocalMeasure {
    LocalMeasure { value: m.value, unit: m.unit, holds_item: m.holds_item, completeness: m.completeness }
}

fn preference(setup: &ComparisonSetup, metric: MetricId) -> Option<Universe> {
    setup.universe_preferences.iter().find(|p| p.metric == metric).map(|p| p.universe)
}

fn cohort_choice(setup: &ComparisonSetup, metric: MetricId) -> Option<&str> {
    setup.cohort_choices.iter().find(|c| c.metric == metric).map(|c| c.reference_id.as_str())
}

fn universe_options(pkg: &Package, metric: MetricId, definition: Option<&str>) -> Vec<Universe> {
    let Some(definition) = definition else { return Vec::new() };
    let mut out: Vec<Universe> = pkg.references(metric, ComparisonMode::Household).filter(|r| r.definition_id == definition).map(|r| r.universe).collect();
    out.sort();
    out.dedup();
    out
}

fn cohort_options(pkg: &Package, setup: &ComparisonSetup, metric: MetricId, definition: Option<&str>, chosen_universe: Option<Universe>) -> Vec<CohortOption> {
    let (Some(definition), Some(age)) = (definition, subject_age(setup)) else { return Vec::new() };
    let universe = chosen_universe.or(preference(setup, metric)).unwrap_or(Universe::All);
    let mut candidates: Vec<&Reference> = pkg
        .references(metric, ComparisonMode::Household)
        .filter(|r| r.definition_id == definition && r.universe == universe)
        .collect();
    if candidates.is_empty() {
        candidates = pkg.references(metric, ComparisonMode::Household).filter(|r| r.definition_id == definition).collect();
    }
    match match_cohort(&candidates, age) {
        CohortMatch::ChoiceRequired { options, .. } => options.iter().map(|r| CohortOption { id: r.id.clone(), age_min: r.age_min, age_max: r.age_max }).collect(),
        _ if matches!(age, AgeInput::Band { .. }) => {
            let (lo, hi) = age.span();
            let hi = hi.map_or(u64::MAX, u64::from);
            let overlapping: Vec<CohortOption> = candidates
                .iter()
                .filter(|r| u64::from(r.age_min) <= hi && u64::from(lo) <= r.age_max.map_or(u64::MAX, u64::from))
                .map(|r| CohortOption { id: r.id.clone(), age_min: r.age_min, age_max: r.age_max })
                .collect();
            if overlapping.len() > 1 { overlapping } else { Vec::new() }
        }
        _ => Vec::new(),
    }
}

/// A card is hidden while it only waits on the person: no input yet, or a figure they have never
/// confirmed. A benchmark gap, or a figure they started but left partly assigned, stays visible.
fn is_visible(result: &ComparisonCardResult) -> bool {
    match result.status {
        CardStatus::MissingInput => false,
        CardStatus::Incomplete => result.completeness != Completeness::Unknown,
        _ => true,
    }
}

pub fn build_report(pkg: &Package, setup: &ComparisonSetup, snapshot: &Snapshot) -> ComparisonsReport {
    let age = subject_age(setup);
    let cards = compute_metrics(snapshot, setup)
        .into_iter()
        .map(|metric| {
            let id = metric.metric;
            let definition = definition_for(id);
            let query = CardQuery {
                metric: id,
                mode: ComparisonMode::Household,
                definition_id: definition,
                age,
                selected_cohort: cohort_choice(setup, id),
                universe_preference: preference(setup, id),
                local: local_measure(&metric),
            };
            let result = compare(pkg, &query);
            let chosen_universe = result.reference.as_ref().map(|r| r.reference.universe);

            let mut secondary = Vec::new();
            if result.status != CardStatus::MissingInput {
                for (class, def, label) in secondary_definitions(id) {
                    let total = metric.class_totals.get(*class).copied().unwrap_or_default();
                    if total.is_zero() {
                        continue;
                    }
                    let mut local = local_measure(&metric);
                    local.value = Some(total);
                    local.holds_item = true;
                    let q = CardQuery { definition_id: Some(def), local, selected_cohort: None, ..query.clone() };
                    secondary.push(SecondaryCard { label: (*label).into(), definition_id: (*def).into(), result: compare(pkg, &q) });
                }
            }

            let stale = matches!(metric.origin, Origin::Entered { stale: true, .. });
            CardView {
                visible: is_visible(&result),
                definition_id: definition.map(String::from),
                universe_options: universe_options(pkg, id, definition),
                cohort_options: cohort_options(pkg, setup, id, definition, chosen_universe),
                secondary,
                stale,
                metric,
                result,
            }
        })
        .collect();
    ComparisonsReport { package_version: pkg.package_version().to_string(), cards }
}
