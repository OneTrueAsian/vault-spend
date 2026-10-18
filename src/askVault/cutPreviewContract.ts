import { date as isDate } from "../contractChecks";
import { dateOutOfRange } from "../dateRange";
import { validateScenarioIntent } from "./spendingScenarioContract";
import type { ParseContext } from "./types";
import type { ScenarioBaselineClient } from "./spendingScenarioBaseline";
import type {
  ScenarioBaseline, ScenarioExactMoney, ScenarioIntentValidation, ScenarioSource,
  SpendingScenarioDraft, SpendingScenarioIntent,
} from "./spendingScenarioContract";

/** M4 session-only intent, not a native request or permission to change budgets. */
export type CutPreviewCategory = {
  category: string;
  monthlyFloor: string;
  maximumReduction: SpendingScenarioIntent["reduction"];
};

export type CutPreviewIntent = {
  version: 1;
  target: { kind: "monthly" | "total"; amount: string };
  allocationPolicy: "capacity-proportional";
  /** Only explicitly selected categories; never an automatically populated roster. */
  categories: CutPreviewCategory[];
  horizon: SpendingScenarioIntent["horizon"];
  partialMonth: "exclude" | "prorate";
};

export type CutPreviewChoice = "target" | "target-basis" | "categories" | "constraints" | "horizon" | "partial-month";
export type CutPreviewScheduleHint = NonNullable<SpendingScenarioDraft["scheduleHints"]>[number] | {
  kind: "year-choice";
  year: number;
  choices: ("remaining-year" | "full-year-hypothetical")[];
  text: string;
  start: number;
  end: number;
};
export type CutPreviewDraft = {
  sourceText: string;
  target: { kind: "monthly" | "total" | null; amount: string | null };
  /** An empty array means no categories selected, not all categories. */
  categories: { category: string; monthlyFloor: string | null; maximumReduction: CutPreviewCategory["maximumReduction"] | null }[];
  /** Explicit exclusions survive parsing; never populate other categories automatically. */
  excludedCategories: string[];
  horizon: CutPreviewIntent["horizon"] | null;
  partialMonth: CutPreviewIntent["partialMonth"] | null;
  missing: CutPreviewChoice[];
  scheduleHints?: CutPreviewScheduleHint[];
};

export type CutPreviewParseOutcome =
  | { kind: "cut-preview"; draft: CutPreviewDraft }
  | { kind: "cut-preview-clarify"; clarification: import("./types").AskClarification }
  | { kind: "cut-preview-unsupported"; reason: string }
  | null;

/** Existing parser context; today is app-owned, never read from the parser's clock. */
export type CutPreviewParseContext = ParseContext;
export type ParseCutPreview = (text: string, context: CutPreviewParseContext) => CutPreviewParseOutcome;

export type ConfirmedCutPreview = {
  intent: CutPreviewIntent;
  /** Exactly one baseline per selected category, all bound to source. */
  baselines: { category: string; baseline: ScenarioBaseline }[];
  source: ScenarioSource;
  confirmed: true;
};

/** A bundle is all-or-nothing; an error must never masquerade as a zero baseline. */
export type CutPreviewBaselinesResult =
  | { status: "baseline"; baselines: ConfirmedCutPreview["baselines"]; source: ScenarioSource }
  | { status: "stale"; message?: string }
  | { status: "error"; message: string };

export type ReadCutPreviewBaselinesArgs = {
  categories: readonly string[];
  client: ScenarioBaselineClient & { askVaultBaselines?: (request: import("./cutPreviewBatch").AskBaselineBatchRequest) => Promise<import("./cutPreviewBatch").AskBaselineBatchSnapshot> };
  currentSource: () => ScenarioSource | null;
  signal?: AbortSignal;
};
export type ReadCutPreviewBaselines = (args: ReadCutPreviewBaselinesArgs) => Promise<CutPreviewBaselinesResult>;
export type CalculateCutPreview = (confirmed: ConfirmedCutPreview) => CutPreviewCalculation;

export type CutPreviewAmountUnit = "per-month" | "whole-period";
/** Dimensionless positive reduced rational q; never currency or a floating-point month count. */
export type CutPreviewMonthFactor = { numerator: string; denominator: string };

export type CutPreviewAllocation<Unit extends CutPreviewAmountUnit = CutPreviewAmountUnit> = {
  category: string;
  unit: Unit;
  monthlyBaseline: ScenarioExactMoney;
  monthlyCapacity: ScenarioExactMoney;
  /** Integer cents in the target's unit: per full month or across the whole horizon. */
  capacityCents: string;
  allocatedCents: string;
  monthlyReduction: ScenarioExactMoney;
  monthlyLimit: ScenarioExactMoney;
  intervals: { from: string; to: string; saving: ScenarioExactMoney }[];
  totalSaving: ScenarioExactMoney;
};

export type CutPreviewConstraintViolation = {
  category: string;
  monthlyFloor: string;
  monthlyBaseline: ScenarioExactMoney;
  reason: "floor-above-baseline";
};

type CutPreviewResultAmounts =
  | { unit: "per-month"; allocations: CutPreviewAllocation<"per-month">[] }
  | { unit: "whole-period"; allocations: CutPreviewAllocation<"whole-period">[] };

/** Malformed inputs throw first; valid no-history precedes floor violations, then preview. */
export type CutPreviewCalculation =
  | { kind: "needs-baseline"; categories: string[] }
  | { kind: "constraints-invalid"; violations: CutPreviewConstraintViolation[] }
  | ({
      kind: "preview";
      scenario: ConfirmedCutPreview;
      monthFactor: CutPreviewMonthFactor;
      targetMet: boolean;
      /** Same unit as intent.target; integer-cent strings, no localized money. */
      targetCents: string;
      maximumCents: string;
      allocatedCents: string;
      shortfallCents: string;
      totalSaving: ScenarioExactMoney;
    } & CutPreviewResultAmounts);

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/** Intent shape only: does not validate baselines, authorize selections or confirm a preview. */
export function validateCutPreviewIntent(
  value: unknown,
  context: { asOf: string; categories: readonly string[] },
): ScenarioIntentValidation {
  const fail = (reason: string): ScenarioIntentValidation => ({ ok: false, reason });
  if (!isDate(context.asOf) || dateOutOfRange(context.asOf)) return fail("Refresh the preview date.");
  if (!record(value) || !keys(value, ["version", "target", "allocationPolicy", "categories", "horizon", "partialMonth"]) || value.version !== 1) {
    return fail("Choose a supported savings-target preview.");
  }
  const target = value.target;
  if (!record(target) || !keys(target, ["kind", "amount"]) || (target.kind !== "monthly" && target.kind !== "total")) {
    return fail("Choose a monthly target or a total over the selected dates.");
  }
  if (value.allocationPolicy !== "capacity-proportional") return fail("Choose the spread-across-categories policy.");
  if (!Array.isArray(value.categories) || value.categories.length < 1 || value.categories.length > 20) {
    return fail("Select between 1 and 20 flexible categories.");
  }
  const selected = new Set<string>();
  // Reuse M3's canonical native-decimal, exact-date and explicit-proration boundary.
  // This synthetic single-category intent validates terms only; it is never dispatched or confirmed.
  const check = (category: string, reduction: unknown) => validateScenarioIntent({
    version: 1, category, reduction, cadence: "monthly", horizon: value.horizon, partialMonth: value.partialMonth,
  }, context);
  for (const row of value.categories) {
    if (!record(row) || !keys(row, ["category", "monthlyFloor", "maximumReduction"]) || typeof row.category !== "string" || !row.category.trim() ||
        context.categories.filter((category) => category === row.category).length !== 1 || selected.has(row.category)) {
      return fail("Select each existing category once, with its floor and cut limit.");
    }
    selected.add(row.category);
    for (const reduction of [{ kind: "money", amount: target.amount }, { kind: "money", amount: row.monthlyFloor }, row.maximumReduction]) {
      const validation = check(row.category, reduction);
      if (!validation.ok) return validation;
    }
  }
  return { ok: true };
}
