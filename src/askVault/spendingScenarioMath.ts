/**
 * M3 spending scenario calculator. Pure and exact: dollars are reduced fractions of BigInt integers until the screen formats them,
 * and no floating point is used anywhere. The rules are M3/Financial-Rules.md; the hand-derived anchors are in M3/Worked-Examples.md.
 *
 * The calculator checks its own input, because the type annotations are not runtime validation. It does not decide whether the
 * baseline is fresh or the person confirmed it: those belong to the controller. Invalid input throws, so it can never produce a number.
 */
import { date as isDate, integer } from "../contractChecks";
import { dateParts, daysInMonth, dayCount, isoDate, monthsTouching } from "./calendar";
import type { AskMonthCoverage } from "./contractV2";
import {
  validateScenarioIntent,
  type ConfirmedSpendingScenario,
  type ScenarioBaseline,
  type ScenarioExactMoney,
  type SpendingScenarioCalculation,
} from "./spendingScenarioContract";

export type ConfirmedScenarioValidation = { ok: true } | { ok: false; reason: string };

/** Raised when the calculator is handed input it cannot trust. The message is for developers, not for the screen. */
export class ScenarioInputError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ScenarioInputError";
  }
}

const COVERAGE: readonly AskMonthCoverage[] = ["complete", "in-progress", "partial-period", "partly-recorded", "before-records", "no-records", "records-end"];
/** The native decimal coefficient is 96 bits; the same ceiling the intent validator applies to a typed amount. */
const MAX_COEFFICIENT = 79228162514264337593543950335n;

// ---- exact rational arithmetic on nonnegative values ----

type Rational = { n: bigint; d: bigint };

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a;
}

function rational(n: bigint, d: bigint): Rational {
  const divisor = gcd(n, d) || 1n;
  return { n: n / divisor, d: d / divisor };
}

/** A plain nonnegative decimal string such as "12.5". */
function fromDecimal(text: string): Rational {
  const [whole, fraction = ""] = text.split(".");
  return rational(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
}

const add = (a: Rational, b: Rational) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const subtract = (a: Rational, b: Rational) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
const multiply = (a: Rational, b: Rational) => rational(a.n * b.n, a.d * b.d);
const compare = (a: Rational, b: Rational) => (a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0);
const toExact = (value: Rational): ScenarioExactMoney => ({ numerator: value.n.toString(), denominator: value.d.toString() });

/** Display only: cents, half away from zero, from an exact amount. */
export function scenarioMoneyToCents(money: ScenarioExactMoney): string {
  const n = BigInt(money.numerator);
  const d = BigInt(money.denominator);
  const cents = (2n * n * 100n + d) / (2n * d);
  const digits = cents.toString().padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

// ---- input checks ----

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/** The same canonical typed amount the intent validator accepts: plain, nonnegative, two decimals at most, within 96 bits. */
function typedAmount(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 32 || !/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return false;
  const normalized = value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
  return BigInt(normalized.replace(".", "")) <= MAX_COEFFICIENT;
}

/** A native month total: a plain nonnegative decimal. */
function monthTotal(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40 || !/^\d+(?:\.\d+)?$/.test(value)) return false;
  return BigInt(value.replace(".", "")) <= MAX_COEFFICIENT;
}

/** The three whole calendar months immediately before the month of `asOf`, oldest first. */
export function baselineMonths(asOf: string): [string, string, string] {
  const { y, m } = dateParts(asOf);
  const months = [3, 2, 1].map((back) => {
    const index = y * 12 + (m - 1) - back;
    return isoDate(Math.floor(index / 12), (index % 12) + 1, 1).slice(0, 7);
  });
  return months as [string, string, string];
}

function sourceProblem(source: unknown): string | null {
  if (!record(source) || !exactKeys(source, ["generation", "sessionRevision", "revision", "asOf"])) return "The baseline has no valid source.";
  if (!integer(source.generation) || !integer(source.sessionRevision)) return "The baseline source is not a valid session.";
  const revision = source.revision;
  if (!record(revision) || !exactKeys(revision, ["local", "external"]) || !integer(revision.local) || !integer(revision.external)) return "The baseline source has no valid data revision.";
  if (!isDate(source.asOf)) return "The baseline source has no valid date.";
  return null;
}

/** Why a baseline cannot be trusted as input, or null. The calculator runs it with acceptance required; a freshly read baseline has not been offered to the person yet. */
export function scenarioBaselineProblem(baseline: unknown, requireAcceptance = true): string | null {
  if (!record(baseline)) return "The baseline is missing.";
  const problem = sourceProblem(baseline.source);
  if (problem) return problem;
  if (baseline.kind === "manual") {
    if (!exactKeys(baseline, ["kind", "monthlyAmount", "source"])) return "The manual baseline has unknown fields.";
    return typedAmount(baseline.monthlyAmount) ? null : "The manual baseline is not a plain amount with at most two decimals.";
  }
  const accepted = Object.prototype.hasOwnProperty.call(baseline, "shortHistoryAccepted");
  if (baseline.kind !== "recorded" || !exactKeys(baseline, accepted ? ["kind", "months", "source", "shortHistoryAccepted"] : ["kind", "months", "source"])) return "The baseline is neither recorded nor manual.";
  if (accepted && baseline.shortHistoryAccepted !== true) return "The short-history acceptance must be exactly true.";
  const months = baseline.months;
  if (!Array.isArray(months) || months.length !== 3) return "The baseline must carry exactly three months.";
  const expected = baselineMonths((baseline.source as { asOf: string }).asOf);
  for (let i = 0; i < 3; i++) {
    const row = months[i];
    if (!record(row) || !exactKeys(row, ["month", "total", "coverage"])) return "A baseline month has the wrong fields.";
    if (row.month !== expected[i]) return "The baseline is not the three months just before today, oldest first.";
    if (!monthTotal(row.total)) return "A baseline month has an invalid total.";
    if (typeof row.coverage !== "string" || !COVERAGE.includes(row.coverage as AskMonthCoverage)) return "A baseline month has unknown coverage.";
  }
  const counted = (months as { coverage: string }[]).filter((row) => row.coverage === "complete").length;
  if (requireAcceptance && counted > 0 && counted < 3 && !accepted) return "Short history: the person has not accepted using fewer than three complete months.";
  return null;
}

/** Checks the whole confirmed scenario: shape, intent against the baseline's own date, and the baseline. Never reads a clock. */
export function validateConfirmedScenario(value: unknown): ConfirmedScenarioValidation {
  const fail = (reason: string): ConfirmedScenarioValidation => ({ ok: false, reason });
  if (!record(value) || !exactKeys(value, ["intent", "baseline", "confirmed"])) return fail("The scenario has the wrong shape.");
  if (value.confirmed !== true) return fail("The scenario was not confirmed.");
  const baseline = scenarioBaselineProblem(value.baseline);
  if (baseline) return fail(baseline);
  const category = record(value.intent) && typeof value.intent.category === "string" ? value.intent.category : "";
  const intent = validateScenarioIntent(value.intent, { asOf: (value.baseline as ScenarioBaseline).source.asOf, categories: [category] });
  return intent.ok ? intent : fail(intent.reason);
}

// ---- calculation ----

/** The exact monthly baseline, or null when there is no complete month to average. */
function monthlyBaseline(baseline: ScenarioBaseline): Rational | null {
  if (baseline.kind === "manual") return fromDecimal(baseline.monthlyAmount);
  const used = baseline.months.filter((row) => row.coverage === "complete");
  if (used.length === 0) return null;
  const sum = used.reduce((total, row) => add(total, fromDecimal(row.total)), { n: 0n, d: 1n });
  return multiply(sum, rational(1n, BigInt(used.length)));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Exact direct savings under the confirmed terms. A cut larger than the baseline is refused, not clamped. A monthly cut saves
 * its amount times the covered calendar days over the days of each month; a one-time cut counts once. Results are read-only
 * illustrations of lower planned spending, not a promised balance.
 */
export function calculateSpendingScenario(confirmed: ConfirmedSpendingScenario): SpendingScenarioCalculation {
  const checked = validateConfirmedScenario(confirmed);
  if (!checked.ok) throw new ScenarioInputError(checked.reason);
  // The result keeps its own frozen copy of the terms it calculated from, so a later edit to the caller's object cannot change them.
  const scenario = deepFreeze(structuredClone(confirmed));
  const { intent, baseline } = scenario;
  const base = monthlyBaseline(baseline);
  if (base === null) return { kind: "needs-baseline", reason: "no-covered-months" };

  const typed = fromDecimal(intent.reduction.amount);
  const cut = intent.reduction.kind === "percent" ? multiply(multiply(base, typed), rational(1n, 100n)) : typed;
  if (compare(cut, base) > 0) return { kind: "reduction-too-large", monthlyBaseline: toExact(base) };

  if (intent.cadence === "once") {
    return {
      kind: "preview",
      scenario,
      monthlyBaseline: toExact(base),
      monthlyReduction: null,
      monthlyLimit: null,
      intervals: [{ from: intent.horizon.from, to: intent.horizon.to, saving: toExact(cut) }],
      totalSaving: toExact(cut),
    };
  }

  let total: Rational = { n: 0n, d: 1n };
  const intervals = monthsTouching({ from: intent.horizon.from, to: intent.horizon.to }).map((segment) => {
    const { y, m } = dateParts(segment.start);
    const saving = multiply(cut, rational(BigInt(dayCount({ from: segment.from, to: segment.to })), BigInt(daysInMonth(y, m))));
    total = add(total, saving);
    return { from: segment.from, to: segment.to, saving: toExact(saving) };
  });
  return {
    kind: "preview",
    scenario,
    monthlyBaseline: toExact(base),
    monthlyReduction: toExact(cut),
    monthlyLimit: toExact(subtract(base, cut)),
    intervals,
    totalSaving: toExact(total),
  };
}

/** The exact usual month a baseline gives, for the screen to show; null when no month can be counted. Same arithmetic as the calculator. */
export function scenarioMonthlyBaseline(baseline: ScenarioBaseline): ScenarioExactMoney | null {
  const value = monthlyBaseline(baseline);
  return value === null ? null : toExact(value);
}
