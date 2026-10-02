//! Checking a proposed `ComparisonSetup` against what really exists: today's date, the benchmark
//! package, and the people, accounts and assets in this profile. Every problem is addressed to a
//! field path so the UI can point at it, and all problems are reported together.
use super::package::Package;
use super::setup::*;
use super::types::{ComparisonMode, MetricId};
use chrono::NaiveDate;
use rust_decimal::Decimal;
use std::collections::{BTreeMap, BTreeSet, HashSet};

/// What a setup is checked against.
pub struct SetupContext<'a> {
    /// `None` when the bundled package failed to load; only cohort choices depend on it.
    pub package: Option<&'a Package>,
    pub today: NaiveDate,
    pub member_ids: &'a HashSet<i64>,
    pub account_ids: &'a HashSet<i64>,
    pub asset_ids: &'a HashSet<i64>,
}

impl SetupContext<'_> {
    fn person_exists(&self, person: &PersonRef) -> bool {
        match person {
            PersonRef::Owner => true,
            PersonRef::Member { id } => self.member_ids.contains(id),
        }
    }

    fn source_exists(&self, source: &SourceRef) -> bool {
        match source {
            SourceRef::Account { id } => self.account_ids.contains(id),
            SourceRef::Asset { id } => self.asset_ids.contains(id),
        }
    }

    fn account_exists(&self, source: &SourceRef) -> bool {
        matches!(source, SourceRef::Account { id } if self.account_ids.contains(id))
    }
}

/// A strict `YYYY-MM-DD` date (no lenient single-digit months).
fn parse_date(text: &str) -> Option<NaiveDate> {
    if text.len() != 10 {
        return None;
    }
    NaiveDate::parse_from_str(text, "%Y-%m-%d").ok()
}

const MAX_MONEY: i64 = 1_000_000_000_000;

struct Problems(Vec<SetupProblem>);

impl Problems {
    fn add(&mut self, field: impl Into<String>, message: &str) {
        self.0.push(SetupProblem { field: field.into(), message: message.into() });
    }

    fn unique<T: Ord>(&mut self, field: &str, seen: &mut BTreeSet<T>, key: T, message: &str) {
        if !seen.insert(key) {
            self.add(field, message);
        }
    }

    fn date_not_future(&mut self, field: &str, text: &str, today: NaiveDate, what: &str) {
        match parse_date(text) {
            None => self.add(field, &format!("Enter {what} as YYYY-MM-DD.")),
            Some(d) if d > today => self.add(field, &format!("{what} cannot be in the future.")),
            Some(_) => {}
        }
    }

    fn amount(&mut self, field: &str, amount: &ManualAmount, metric: MetricId, ctx: &SetupContext) {
        // Money income and a savings balance can legitimately be negative; the rest cannot.
        let may_be_negative = matches!(metric, MetricId::Income | MetricId::Savings);
        if amount.value < Decimal::ZERO && !may_be_negative {
            self.add(format!("{field}.value"), "This amount cannot be negative.");
        }
        if amount.value.abs() > Decimal::from(MAX_MONEY) {
            self.add(format!("{field}.value"), "This amount is too large.");
        }
        self.date_not_future(&format!("{field}.measuredOn"), &amount.measured_on, ctx.today, "The date this was measured");
        // The note is optional; only an over-long one is rejected.
        if amount.explanation.trim().chars().count() > MAX_EXPLANATION_CHARS {
            self.add(format!("{field}.explanation"), "The explanation is too long.");
        }
    }
}

pub fn validate_setup(setup: &ComparisonSetup, ctx: &SetupContext) -> Vec<SetupProblem> {
    let mut out = Problems(Vec::new());

    if setup.format_version != SETUP_FORMAT_VERSION {
        out.add("formatVersion", "This setup was saved by a different version of the app.");
    }

    // People.
    let mut seen_people = BTreeSet::new();
    for (i, p) in setup.people.iter().enumerate() {
        let field = format!("people[{i}]");
        if !ctx.person_exists(&p.person) {
            out.add(format!("{field}.person"), "This person no longer exists.");
        }
        out.unique(&format!("{field}.person"), &mut seen_people, p.person.clone(), "This person is listed twice.");
        if let Some(a) = &p.age {
            if !a.age.is_valid() {
                out.add(format!("{field}.age"), "Enter an age from 18 to 120, or a band within that range.");
            }
            out.date_not_future(&format!("{field}.age.confirmedOn"), &a.confirmed_on, ctx.today, "The confirmation date");
        }
    }
    let listed = |person: &PersonRef| setup.people.iter().any(|p| &p.person == person);
    if let Some(r) = &setup.household_reference_person
        && !setup.people.iter().any(|p| &p.person == r && p.in_household)
    {
        out.add("householdReferencePerson", "The reference person must be one of the people in the household.");
    }

    // Income.
    if let Some(a) = &setup.income.household_total {
        out.amount("income.householdTotal", a, MetricId::Income, ctx);
    }
    let mut seen_income = BTreeSet::new();
    for (i, pi) in setup.income.per_person.iter().enumerate() {
        let field = format!("income.perPerson[{i}]");
        if !listed(&pi.person) {
            out.add(format!("{field}.person"), "Choose someone from the people listed.");
        }
        out.unique(&format!("{field}.person"), &mut seen_income, pi.person.clone(), "Income is entered twice for this person.");
        out.amount(&format!("{field}.grossAnnual"), &pi.gross_annual, MetricId::Income, ctx);
    }

    // Spending.
    if let Some(p) = &setup.spending.period {
        match (parse_date(&p.from), parse_date(&p.to)) {
            (Some(from), Some(to)) if from <= to && to <= ctx.today => {}
            (Some(_), Some(_)) => out.add("spending.period", "The period must end today or earlier and not end before it starts."),
            _ => out.add("spending.period", "Enter the period dates as YYYY-MM-DD."),
        }
    }
    let mut seen_accounts = BTreeSet::new();
    for (i, id) in setup.spending.account_ids.iter().enumerate() {
        let field = format!("spending.accountIds[{i}]");
        if !ctx.account_ids.contains(id) {
            out.add(&field, "This account no longer exists.");
        }
        out.unique(&field, &mut seen_accounts, *id, "This account is listed twice.");
    }
    if let Some(a) = &setup.spending.manual_annual {
        out.amount("spending.manualAnnual", a, MetricId::Spending, ctx);
    }
    let mut seen_categories = BTreeSet::new();
    for (i, m) in setup.spending.category_mappings.iter().enumerate() {
        let field = format!("spending.categoryMappings[{i}]");
        let (category, component) = (m.category.trim(), m.component.trim());
        if category.is_empty() || component.is_empty() || category.chars().count() > 100 || component.chars().count() > 100 {
            out.add(&field, "A category and a comparison component are both required (at most 100 characters).");
        }
        out.unique(&field, &mut seen_categories, category.to_lowercase(), "This category is mapped twice.");
    }

    // Per-source classifications.
    let mut seen = BTreeSet::new();
    for (i, o) in setup.savings_overrides.iter().enumerate() {
        let field = format!("savingsOverrides[{i}].source");
        if !ctx.account_exists(&o.source) {
            out.add(&field, "Choose an existing account.");
        }
        out.unique(&field, &mut seen, o.source.clone(), "This account has two Savings settings.");
    }
    let mut seen = BTreeSet::new();
    for (i, c) in setup.investment_classes.iter().enumerate() {
        let field = format!("investmentClasses[{i}].source");
        if !ctx.source_exists(&c.source) {
            out.add(&field, "This account or asset no longer exists.");
        }
        out.unique(&field, &mut seen, c.source.clone(), "This item is classified twice.");
    }
    let mut seen = BTreeSet::new();
    for (i, c) in setup.debt_classes.iter().enumerate() {
        let field = format!("debtClasses[{i}].source");
        if !ctx.account_exists(&c.source) {
            out.add(&field, "Debt types apply to existing accounts only.");
        }
        out.unique(&field, &mut seen, c.source.clone(), "This account has two debt types.");
    }
    let mut seen = BTreeSet::new();
    for (i, s) in setup.debt_exclusions.iter().enumerate() {
        let field = format!("debtExclusions[{i}]");
        if !ctx.account_exists(s) {
            out.add(&field, "Choose an existing account.");
        }
        out.unique(&field, &mut seen, s.clone(), "This account is excluded twice.");
    }

    // Allocations.
    let mut seen = BTreeSet::new();
    let mut totals: BTreeMap<&SourceRef, u32> = BTreeMap::new();
    for (i, a) in setup.allocations.iter().enumerate() {
        let field = format!("allocations[{i}]");
        if a.basis_points == 0 || a.basis_points > 10_000 {
            out.add(format!("{field}.basisPoints"), "A share must be more than 0% and at most 100%.");
        }
        if !ctx.source_exists(&a.source) {
            out.add(format!("{field}.source"), "This account or asset no longer exists.");
        }
        if !(ctx.person_exists(&a.person) && listed(&a.person)) {
            out.add(format!("{field}.person"), "Choose someone from the people listed.");
        }
        out.unique(&field, &mut seen, (a.source.clone(), a.person.clone()), "This person already has a share of this item.");
        *totals.entry(&a.source).or_default() += a.basis_points;
    }
    for (source, total) in totals {
        if total > 10_000 {
            out.add("allocations", &format!("Shares of {source:?} add up to more than 100%."));
        }
    }

    // Balance confirmations and manual overrides.
    let mut seen = BTreeSet::new();
    for (i, c) in setup.balance_confirmations.iter().enumerate() {
        let field = format!("balanceConfirmations[{i}]");
        out.date_not_future(&format!("{field}.confirmedOn"), &c.confirmed_on, ctx.today, "The date");
        out.unique(&format!("{field}.metric"), &mut seen, c.metric, "This comparison is confirmed twice.");
    }
    let mut seen = BTreeSet::new();
    for (i, o) in setup.manual_overrides.iter().enumerate() {
        let field = format!("manualOverrides[{i}]");
        out.unique(&field, &mut seen, o.metric, "This comparison already has a manual total.");
        out.amount(&format!("{field}.amount"), &o.amount, o.metric, ctx);
    }

    // Remembered choices.
    let mut seen = BTreeSet::new();
    for (i, c) in setup.cohort_choices.iter().enumerate() {
        let field = format!("cohortChoices[{i}]");
        out.unique(&field, &mut seen, c.metric, "A cohort is chosen twice for this comparison.");
        match ctx.package {
            None => out.add(&field, "The benchmark data could not be loaded, so a cohort cannot be chosen."),
            Some(pkg) => {
                if !pkg.references(c.metric, ComparisonMode::Household).any(|r| r.id == c.reference_id) {
                    out.add(format!("{field}.referenceId"), "This cohort is not in the current benchmark data.");
                }
            }
        }
    }
    let mut seen = BTreeSet::new();
    for (i, p) in setup.universe_preferences.iter().enumerate() {
        out.unique(&format!("universePreferences[{i}].metric"), &mut seen, p.metric, "This comparison has two population settings.");
    }
    out.0
}

/// Stored references to people, accounts or assets that no longer exist. Reported so the person can
/// repair them; nothing is reassigned automatically.
pub fn find_repairs(setup: &ComparisonSetup, ctx: &SetupContext) -> Vec<Repair> {
    let mut out = Vec::new();
    let mut person = |field: String, p: &PersonRef| {
        if !ctx.person_exists(p) {
            out.push(Repair::MissingPerson { field, person: p.clone() });
        }
    };
    for (i, p) in setup.people.iter().enumerate() {
        person(format!("people[{i}].person"), &p.person);
    }
    if let Some(p) = &setup.household_reference_person {
        person("householdReferencePerson".into(), p);
    }
    for (i, p) in setup.income.per_person.iter().enumerate() {
        person(format!("income.perPerson[{i}].person"), &p.person);
    }
    for (i, a) in setup.allocations.iter().enumerate() {
        person(format!("allocations[{i}].person"), &a.person);
    }
    let mut source = |field: String, s: &SourceRef| {
        if !ctx.source_exists(s) {
            out.push(Repair::MissingSource { field, source: s.clone() });
        }
    };
    for (i, id) in setup.spending.account_ids.iter().enumerate() {
        source(format!("spending.accountIds[{i}]"), &SourceRef::Account { id: *id });
    }
    for (i, o) in setup.savings_overrides.iter().enumerate() {
        source(format!("savingsOverrides[{i}].source"), &o.source);
    }
    for (i, c) in setup.investment_classes.iter().enumerate() {
        source(format!("investmentClasses[{i}].source"), &c.source);
    }
    for (i, c) in setup.debt_classes.iter().enumerate() {
        source(format!("debtClasses[{i}].source"), &c.source);
    }
    for (i, s) in setup.debt_exclusions.iter().enumerate() {
        source(format!("debtExclusions[{i}]"), s);
    }
    for (i, a) in setup.allocations.iter().enumerate() {
        source(format!("allocations[{i}].source"), &a.source);
    }
    out
}
