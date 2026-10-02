//! The person's private comparison setup: who is being compared, their ages, the figures they
//! confirmed by hand, and how their accounts map onto each comparison. It is a strict, versioned
//! domain type (not free-form JSON) stored inside the profile database, so it is encrypted,
//! backed up and restored with the rest of the profile and never leaves the device.
use super::types::{AgeInput, MetricId, Universe, money_str};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

pub use super::validation::{SetupContext, find_repairs, validate_setup};

pub const SETUP_FORMAT_VERSION: u32 = 2;
/// Upper bound on the stored payload, so a bug or hostile import cannot bloat the profile.
pub const MAX_PAYLOAD_BYTES: usize = 256 * 1024;
pub const MAX_EXPLANATION_CHARS: usize = 500;

/// Who a figure belongs to. `Owner` is the profile owner, available even before any family
/// member has been added.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PersonRef {
    Owner,
    Member { id: i64 },
}

/// A tagged source so an account and an asset that happen to share a number never collide.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SourceRef {
    Account { id: i64 },
    Asset { id: i64 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgeConfirmation {
    pub age: AgeInput,
    /// `YYYY-MM-DD`; no birthday is collected, only when the age was last confirmed.
    pub confirmed_on: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonSetup {
    pub person: PersonRef,
    pub age: Option<AgeConfirmation>,
    /// Part of the shared financial unit being compared. A financially independent roommate is a
    /// listed person with this set to false.
    pub in_household: bool,
}

/// A figure the person typed and confirmed, dated so staleness can be flagged (never auto-expired).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManualAmount {
    #[serde(with = "money_str")]
    pub value: Decimal,
    pub measured_on: String,
    pub explanation: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HouseholdIncomeMethod {
    Total,
    ByPerson,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonIncome {
    pub person: PersonRef,
    pub gross_annual: ManualAmount,
}

/// Gross income is always entered by hand; take-home totals are never used to estimate it. Both
/// household methods keep their values so switching back restores what was typed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IncomeSetup {
    pub household_method: HouseholdIncomeMethod,
    pub household_total: Option<ManualAmount>,
    pub per_person: Vec<PersonIncome>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpendingPeriod {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CategoryMapping {
    pub category: String,
    pub component: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpendingSetup {
    pub period: Option<SpendingPeriod>,
    pub account_ids: Vec<i64>,
    /// The simple "my tracked spending covers everything" checkbox.
    pub completeness_confirmed: bool,
    /// Used when fewer than 12 completed months exist; never annualised automatically.
    pub manual_annual: Option<ManualAmount>,
    pub category_mappings: Vec<CategoryMapping>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InvestmentClass {
    Retirement,
    Taxable,
    Education,
    Other,
    Exclude,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DebtClass {
    Mortgage,
    CreditCard,
    StudentLoan,
    Vehicle,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvestmentClassification {
    pub source: SourceRef,
    pub class: InvestmentClass,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebtClassification {
    pub source: SourceRef,
    pub class: DebtClass,
}

/// Counts an `other`-type account or brokerage cash toward Savings (or keeps a default one out).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavingsOverride {
    pub source: SourceRef,
    pub include: bool,
}

/// A share of one source that belongs to one person, in basis points (10,000 = all of it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Allocation {
    pub source: SourceRef,
    pub person: PersonRef,
    pub basis_points: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BalanceConfirmation {
    pub metric: MetricId,
    pub confirmed_on: String,
}

/// A comparable total typed in place of the household's own figure. Stays active until removed or replaced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManualOverride {
    pub metric: MetricId,
    pub amount: ManualAmount,
}

/// The published cohort the person picked when their age band spans several, per metric.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CohortChoice {
    pub metric: MetricId,
    pub reference_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UniversePreference {
    pub metric: MetricId,
    pub universe: Universe,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ComparisonSetup {
    pub format_version: u32,
    /// The one person whose age is used for every comparison.
    pub household_reference_person: Option<PersonRef>,
    pub people: Vec<PersonSetup>,
    pub income: IncomeSetup,
    pub spending: SpendingSetup,
    pub savings_overrides: Vec<SavingsOverride>,
    pub investment_classes: Vec<InvestmentClassification>,
    pub debt_classes: Vec<DebtClassification>,
    /// Credit-card accounts left out of the Debt comparison only; nothing else in the app changes.
    pub debt_exclusions: Vec<SourceRef>,
    pub allocations: Vec<Allocation>,
    pub balance_confirmations: Vec<BalanceConfirmation>,
    pub manual_overrides: Vec<ManualOverride>,
    pub cohort_choices: Vec<CohortChoice>,
    pub universe_preferences: Vec<UniversePreference>,
}

impl ComparisonSetup {
    /// A valid, empty setup: nothing chosen, nothing confirmed.
    pub fn empty() -> Self {
        ComparisonSetup {
            format_version: SETUP_FORMAT_VERSION,
            household_reference_person: None,
            people: Vec::new(),
            income: IncomeSetup {
                household_method: HouseholdIncomeMethod::Total,
                household_total: None,
                per_person: Vec::new(),
            },
            spending: SpendingSetup {
                period: None,
                account_ids: Vec::new(),
                completeness_confirmed: false,
                manual_annual: None,
                category_mappings: Vec::new(),
            },
            savings_overrides: Vec::new(),
            investment_classes: Vec::new(),
            debt_classes: Vec::new(),
            debt_exclusions: Vec::new(),
            allocations: Vec::new(),
            balance_confirmations: Vec::new(),
            manual_overrides: Vec::new(),
            cohort_choices: Vec::new(),
            universe_preferences: Vec::new(),
        }
    }
}

/// Reads a format 1 payload (saved before the One person mode was removed) as format 2: the mode
/// and its person go, as do the age-group choices and typed totals that belonged to one person.
pub fn upgrade_v1_payload(payload: &str) -> serde_json::Result<String> {
    use serde_json::Value;
    let mut v: Value = serde_json::from_str(payload)?;
    if let Some(o) = v.as_object_mut() {
        o.insert("formatVersion".into(), Value::from(SETUP_FORMAT_VERSION));
        let was_one_person = o.remove("mode").as_ref().and_then(Value::as_str) == Some("individual");
        let compared = o.remove("individualPerson").filter(|p| !p.is_null());
        if was_one_person {
            // One person mode kept its own age person and typed income per person under the "total"
            // method; carry both over so the setup still compares the same person and income.
            let in_household = |p: &Value| {
                o.get("people").and_then(Value::as_array).is_some_and(|people| {
                    people
                        .iter()
                        .any(|e| e.get("person") == Some(p) && e.get("inHousehold") == Some(&Value::Bool(true)))
                })
            };
            if let Some(p) = compared
                && o.get("householdReferencePerson").is_none_or(Value::is_null)
                && in_household(&p)
            {
                o.insert("householdReferencePerson".into(), p);
            }
            if let Some(income) = o.get_mut("income").and_then(Value::as_object_mut) {
                let has_total = income.get("householdTotal").is_some_and(|t| !t.is_null());
                let has_per_person = income.get("perPerson").and_then(Value::as_array).is_some_and(|a| !a.is_empty());
                if !has_total && has_per_person {
                    income.insert("householdMethod".into(), Value::from("by_person"));
                }
            }
        }
        if let Some(Value::Array(choices)) = o.get_mut("cohortChoices") {
            choices.retain(|c| c.get("mode").and_then(Value::as_str) != Some("individual"));
            for c in choices.iter_mut().filter_map(Value::as_object_mut) {
                c.remove("mode");
            }
        }
        if let Some(Value::Array(overrides)) = o.get_mut("manualOverrides") {
            overrides.retain(|m| m.get("subject").is_none_or(Value::is_null));
            for m in overrides.iter_mut().filter_map(Value::as_object_mut) {
                m.remove("subject");
            }
        }
    }
    serde_json::to_string(&v)
}

/// One thing wrong with a proposed setup, addressed to a field so the UI can point at it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SetupProblem {
    pub field: String,
    pub message: String,
}

/// A stored reference to something that has since been deleted. Only the dependent input is
/// affected; nothing is silently reassigned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Repair {
    MissingPerson { field: String, person: PersonRef },
    MissingSource { field: String, source: SourceRef },
}
