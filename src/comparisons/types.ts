// Mirrors core/src/comparisons (serde camelCase). Money is always a decimal *string*: the frontend
// never does financial arithmetic, only display geometry.

export type Money = string;
export type ComparisonMode = "household" | "individual";
export type MetricId = "spending" | "investments" | "income" | "savings" | "debt";
export const METRIC_ORDER: MetricId[] = ["spending", "investments", "income", "savings", "debt"];
export type Universe = "all" | "holders";

export type PersonRef = { kind: "owner" } | { kind: "member"; id: number };
export type SourceRef = { kind: "account"; id: number } | { kind: "asset"; id: number };
export type AgeInput = { kind: "exact"; age: number } | { kind: "band"; min: number; max: number | null };

export interface AgeConfirmation {
  age: AgeInput;
  confirmedOn: string;
}
export interface PersonSetup {
  person: PersonRef;
  age: AgeConfirmation | null;
  inHousehold: boolean;
}
export interface ManualAmount {
  value: Money;
  measuredOn: string;
  explanation: string;
}
export type HouseholdIncomeMethod = "total" | "by_person";
export interface IncomeSetup {
  householdMethod: HouseholdIncomeMethod;
  householdTotal: ManualAmount | null;
  perPerson: { person: PersonRef; grossAnnual: ManualAmount }[];
}
export interface SpendingSetup {
  period: { from: string; to: string } | null;
  accountIds: number[];
  completenessConfirmed: boolean;
  manualAnnual: ManualAmount | null;
  categoryMappings: { category: string; component: string }[];
}
export type InvestmentClass = "retirement" | "taxable" | "education" | "other" | "exclude";
export type DebtClass = "mortgage" | "credit_card" | "student_loan" | "vehicle" | "other";

export interface ComparisonSetup {
  formatVersion: number;
  householdReferencePerson: PersonRef | null;
  people: PersonSetup[];
  income: IncomeSetup;
  spending: SpendingSetup;
  savingsOverrides: { source: SourceRef; include: boolean }[];
  investmentClasses: { source: SourceRef; class: InvestmentClass }[];
  debtClasses: { source: SourceRef; class: DebtClass }[];
  debtExclusions: SourceRef[];
  allocations: { source: SourceRef; person: PersonRef; basisPoints: number }[];
  balanceConfirmations: { metric: MetricId; confirmedOn: string }[];
  manualOverrides: { metric: MetricId; amount: ManualAmount }[];
  cohortChoices: { metric: MetricId; referenceId: string }[];
  universePreferences: { metric: MetricId; universe: Universe }[];
}

export type Repair =
  | { kind: "missing_person"; field: string; person: PersonRef }
  | { kind: "missing_source"; field: string; source: SourceRef };

export interface SetupProblem {
  field: string;
  message: string;
}

export interface SetupResponse {
  generation: number;
  revision: number;
  setup: ComparisonSetup | null;
  repairs: Repair[];
}

export type SaveResponse =
  | { status: "saved"; revision: number; setup: ComparisonSetup }
  | { status: "conflict"; currentRevision: number }
  | { status: "invalid"; problems: SetupProblem[] };

export type CardStatus =
  | "comparable"
  | "approximate"
  | "missing_input"
  | "incomplete"
  | "unavailable"
  | "unreliable"
  | "cohort_choice_required"
  | "not_comparable";
export type Completeness = "confirmed" | "partial" | "unknown";

export type Reason =
  | { code: "no_benchmark" }
  | { code: "no_matching_age_benchmark" }
  | { code: "benchmark_removed" }
  | { code: "reference_too_uncertain" }
  | { code: "cohort_choice_required"; options: string[] }
  | { code: "nearest_cohort_used"; cohort: string }
  | { code: "holders_only_zero_local" }
  | { code: "holders_only_used" }
  | { code: "cpi_unavailable"; basis: string }
  | { code: "inflation_adjusted"; from: string; to: string }
  | { code: "unit_mismatch" }
  | { code: "missing_input" }
  | { code: "incomplete_coverage" };

export interface Reference {
  id: string;
  metric: MetricId;
  mode: ComparisonMode;
  definitionId: string;
  population: string;
  universe: Universe;
  geography: string;
  ageMin: number;
  ageMax: number | null;
  statistic: "mean" | "median";
  value: Money;
  unit: "usd_per_year" | "usd_per_month" | "usd_balance";
  period: { kind: "flow" | "stock"; from: string; to: string };
  dollarBasis: { kind: "month" | "annual_average"; period: string };
  sourceId: string;
  sourceUrl: string;
  sourceLocator: string;
  uncertainty: { kind: "moe90" | "se"; value: Money } | null;
  annotation: string | null;
  reliability: "ok" | "unreliable";
}

export interface AdjustedReference {
  reference: Reference;
  adjustedValue: Money;
  adjustedUncertainty: { kind: "moe90" | "se"; value: Money } | null;
  adjustedBasisMonth: string;
  cpiFactor: Money;
}

export interface ComparisonCardResult {
  metric: MetricId;
  status: CardStatus;
  localValue: Money | null;
  reference: AdjustedReference | null;
  dollarDifference: Money | null;
  percentDifference: string | null;
  reasons: Reason[];
  completeness: Completeness;
}

export interface Contributor {
  label: string;
  source: SourceRef | null;
  gross: Money;
  shareBasisPoints: number;
  counted: Money;
}
export type ExcludeReason = "default_type_not_included" | "user_excluded" | "not_allocated" | "unclassified";
export type Origin = { kind: "derived" } | { kind: "entered"; measuredOn: string; explanation: string; stale: boolean };

export interface MetricComputation {
  metric: MetricId;
  value: Money | null;
  unit: "usd_per_year" | "usd_per_month" | "usd_balance";
  holdsItem: boolean;
  completeness: Completeness;
  period: { kind: "flow" | "stock"; from: string; to: string } | null;
  origin: Origin;
  contributors: Contributor[];
  excluded: { label: string; source: SourceRef | null; reason: ExcludeReason }[];
  unallocated: Money;
  trackedValue: Money | null;
  classTotals: Record<string, Money>;
  notes: { code: string; detail: string }[];
}

export interface CardView {
  result: ComparisonCardResult;
  visible: boolean;
  definitionId: string | null;
  metric: MetricComputation;
  secondary: { label: string; definitionId: string; person: PersonRef | null; result: ComparisonCardResult }[];
  universeOptions: Universe[];
  cohortOptions: { id: string; ageMin: number; ageMax: number | null }[];
  stale: boolean;
  /** Income card only: income is one household total, so no one's own pay is compared. */
  personalIncomeHint: boolean;
}

export interface ComparisonsReport {
  packageVersion: string;
  cards: CardView[];
}

export interface ComparisonsResponse {
  generation: number;
  configured: boolean;
  setupRevision: number;
  repairs: Repair[];
  packageError: string | null;
  report: ComparisonsReport | null;
}
