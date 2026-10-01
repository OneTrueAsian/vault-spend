// Builders for comparison payloads in component tests. Every number is invented.
import type {
  AdjustedReference,
  CardStatus,
  CardView,
  ComparisonCardResult,
  ComparisonsResponse,
  MetricComputation,
  MetricId,
  Reason,
  Reference,
} from "./types";

export function reference(over: Partial<Reference> = {}): Reference {
  return {
    id: "cps_hinc02_money_income_median:40-44",
    metric: "income",
    mode: "household",
    definitionId: "cps_hinc02_money_income_median",
    population: "Households by age of householder, total money income",
    universe: "all",
    geography: "US",
    ageMin: 40,
    ageMax: 44,
    statistic: "median",
    value: "100000",
    unit: "usd_per_year",
    period: { kind: "flow", from: "2025-01-01", to: "2025-12-31" },
    dollarBasis: { kind: "month", period: "2025-07" },
    sourceId: "cps_hinc02_2026",
    sourceUrl: "https://example.gov/hinc02.xlsx",
    sourceLocator: "hinc02_1_1.xlsx!K54",
    uncertainty: { kind: "se", value: "1000" },
    annotation: null,
    reliability: "ok",
    ...over,
  };
}

export function adjusted(over: Partial<Reference> = {}, adjustedValue = "105000"): AdjustedReference {
  return {
    reference: reference(over),
    adjustedValue,
    adjustedUncertainty: { kind: "se", value: "1050" },
    adjustedBasisMonth: "2026-08",
    cpiFactor: "1.05",
  };
}

export function metric(id: MetricId = "income", over: Partial<MetricComputation> = {}): MetricComputation {
  return {
    metric: id,
    value: "120000",
    unit: id === "income" || id === "spending" ? "usd_per_year" : "usd_balance",
    holdsItem: true,
    completeness: "confirmed",
    period: null,
    origin: { kind: "entered", measuredOn: "2026-09-01", explanation: "From my pay stubs", stale: false },
    contributors: [],
    excluded: [],
    unallocated: "0",
    trackedValue: null,
    classTotals: {},
    notes: [],
    ...over,
  };
}

export function result(id: MetricId, status: CardStatus, over: Partial<ComparisonCardResult> = {}): ComparisonCardResult {
  return {
    metric: id,
    status,
    localValue: null,
    reference: null,
    dollarDifference: null,
    percentDifference: null,
    reasons: [],
    completeness: "confirmed",
    ...over,
  };
}

export function comparableIncome(over: Partial<CardView> = {}): CardView {
  return {
    result: result("income", "comparable", {
      localValue: "120000",
      reference: adjusted(),
      dollarDifference: "15000",
      percentDifference: "14.3",
      reasons: [{ code: "inflation_adjusted", from: "2025-07", to: "2026-08" } as Reason],
    }),
    visible: true,
    definitionId: "cps_hinc02_money_income_median",
    metric: metric("income"),
    secondary: [],
    universeOptions: ["all"],
    cohortOptions: [],
    stale: false,
    ...over,
  };
}

export function unavailable(id: MetricId, reason: Reason = { code: "no_benchmark" }): CardView {
  return {
    result: result(id, "unavailable", { reasons: [reason] }),
    visible: true,
    definitionId: null,
    metric: metric(id, { value: null, origin: { kind: "derived" } }),
    secondary: [],
    universeOptions: [],
    cohortOptions: [],
    stale: false,
  };
}

export function hidden(id: MetricId): CardView {
  return {
    result: result(id, "missing_input", { reasons: [{ code: "missing_input" }] }),
    visible: false,
    definitionId: null,
    metric: metric(id, { value: null, origin: { kind: "derived" } }),
    secondary: [],
    universeOptions: [],
    cohortOptions: [],
    stale: false,
  };
}

export function response(over: Partial<ComparisonsResponse> = {}, cards: CardView[] = []): ComparisonsResponse {
  return {
    generation: 1,
    configured: true,
    setupRevision: 3,
    repairs: [],
    packageError: null,
    report: { packageVersion: "2026.09.1", mode: "household", cards },
    ...over,
  };
}
