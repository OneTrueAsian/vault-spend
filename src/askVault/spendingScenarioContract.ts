import { date as isDate } from "../contractChecks";
import { dateOutOfRange, DATE_RANGE_PROBLEM } from "../dateRange";

/** M3 intent only: not a native financial-read request or an authorization token. */
export type SpendingScenarioIntent = {
  version: 1;
  category: string;
  reduction: { kind: "money" | "percent"; amount: string };
  cadence: "monthly" | "once";
  horizon: {
    kind: "prospective" | "full-year-hypothetical";
    from: string;
    to: string;
  };
  partialMonth: "exclude" | "prorate" | "none";
};

export type ScenarioChoice = "category" | "reduction" | "cadence" | "horizon" | "partial-month";

/** Missing choices remain null: a draft cannot be submitted as a complete intent. */
export type SpendingScenarioDraft = {
  sourceText: string;
  category: string | null;
  reduction: SpendingScenarioIntent["reduction"] | null;
  cadence: SpendingScenarioIntent["cadence"] | null;
  horizon: SpendingScenarioIntent["horizon"] | null;
  partialMonth: SpendingScenarioIntent["partialMonth"] | null;
  missing: ScenarioChoice[];
  /** Unresolved date evidence for the choice UI; never an authorized schedule or a default. */
  scheduleHints?: { kind: "month" | "single-date" | "end-month"; text: string; start: number; end: number; month?: number; date?: string; year?: number }[];
};

/** null from the scenario parser means leave the existing M1/M2 parser in charge. */
export type SpendingScenarioParseOutcome =
  | { kind: "scenario"; draft: SpendingScenarioDraft }
  | { kind: "scenario-clarify"; clarification: import("./types").AskClarification }
  | { kind: "scenario-unsupported"; reason: string }
  | null;

export type ScenarioSource = {
  generation: number;
  sessionRevision: number;
  revision: { local: number; external: number };
  asOf: string;
};

/** Keep all three months, including those excluded from the denominator. */
export type ScenarioBaselineMonth = {
  month: string;
  total: string;
  coverage: import("./contractV2").AskMonthCoverage;
};

export type ScenarioBaseline =
  | {
      kind: "recorded";
      months: [ScenarioBaselineMonth, ScenarioBaselineMonth, ScenarioBaselineMonth];
      source: ScenarioSource;
      /** Set only when the person explicitly chose to use the one or two complete months there are. Never needed with three. */
      shortHistoryAccepted?: true;
    }
  | { kind: "manual"; monthlyAmount: string; source: ScenarioSource };

/** No persisted preference or financial mutation is implied by confirmation. */
export type ConfirmedSpendingScenario = {
  intent: SpendingScenarioIntent;
  baseline: ScenarioBaseline;
  confirmed: true;
};

/** Reduced nonnegative rational dollars; denominator is positive. No binary floats. */
export type ScenarioExactMoney = { numerator: string; denominator: string };

export type SpendingScenarioCalculation =
  | { kind: "needs-baseline"; reason: "no-covered-months" }
  | { kind: "reduction-too-large"; monthlyBaseline: ScenarioExactMoney }
  | {
      kind: "preview";
      scenario: ConfirmedSpendingScenario;
      monthlyBaseline: ScenarioExactMoney;
      monthlyReduction: ScenarioExactMoney | null;
      monthlyLimit: ScenarioExactMoney | null;
      intervals: { from: string; to: string; saving: ScenarioExactMoney }[];
      totalSaving: ScenarioExactMoney;
    };

export type ScenarioIntentValidation = { ok: true } | { ok: false; reason: string };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function amount(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32 || !/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return false;
  // The native decimal coefficient is 96 bits. Remove insignificant zeros first.
  const normalized = value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
  const coefficient = normalized.replace(".", "");
  return BigInt(coefficient) <= 79228162514264337593543950335n;
}

function monthNumber(day: string): number {
  return Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
}

function isMonthEnd(day: string): boolean {
  const next = new Date(day + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCDate() === 1;
}

/** Validates explicit intent shape only. Baseline, freshness and confirmation are separate gates. */
export function validateScenarioIntent(
  value: unknown,
  context: { asOf: string; categories: readonly string[] },
): ScenarioIntentValidation {
  const fail = (reason: string): ScenarioIntentValidation => ({ ok: false, reason });
  if (!isDate(context.asOf)) return fail("Refresh the scenario date.");
  if (!record(value) || !exactKeys(value, ["version", "category", "reduction", "cadence", "horizon", "partialMonth"]) || value.version !== 1) {
    return fail("Choose a supported category-only spending scenario.");
  }
  if (typeof value.category !== "string" || !context.categories.includes(value.category)) return fail("Choose an existing category.");
  const reduction = value.reduction;
  if (!record(reduction) || !exactKeys(reduction, ["kind", "amount"]) || (reduction.kind !== "money" && reduction.kind !== "percent") || !amount(reduction.amount)) {
    return fail("Enter a nonnegative amount with at most two decimal places.");
  }
  const [whole, fraction = ""] = reduction.amount.split(".");
  if (reduction.kind === "percent" && BigInt(whole + fraction.padEnd(2, "0")) > 10000n) {
    return fail("Choose a percentage from 0 to 100.");
  }
  if (value.cadence !== "monthly" && value.cadence !== "once") return fail("Choose monthly or one-time savings.");
  const horizon = value.horizon;
  if (!record(horizon) || !exactKeys(horizon, ["kind", "from", "to"]) || !isDate(horizon.from) || !isDate(horizon.to)) return fail("Choose valid start and end dates.");
  const from = horizon.from as string;
  const to = horizon.to as string;
  if (dateOutOfRange(from) || dateOutOfRange(to)) return fail(DATE_RANGE_PROBLEM);
  if (from > to || monthNumber(to) - monthNumber(from) >= 12) return fail("Choose a range covering at most 12 calendar months.");
  if (horizon.kind === "full-year-hypothetical") {
    const year = context.asOf.slice(0, 4);
    if (value.cadence !== "monthly" || from !== `${year}-01-01` || to !== `${year}-12-31`) return fail("Use the complete current year for a full-year hypothetical.");
  } else if (horizon.kind !== "prospective" || from < context.asOf) {
    return fail("Choose a future schedule or explicitly choose a full-year hypothetical.");
  }
  if (value.cadence === "once") {
    if (from !== to || value.partialMonth !== "none" || reduction.kind !== "money") return fail("Choose one date and a fixed amount for one-time savings.");
  } else if (value.partialMonth !== "prorate" && (value.partialMonth !== "exclude" || !from.endsWith("-01") || !isMonthEnd(to))) {
    return fail("Confirm calendar-day proration or choose complete months.");
  }
  return { ok: true };
}
