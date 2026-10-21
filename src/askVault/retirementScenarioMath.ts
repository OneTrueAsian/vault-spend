import { monthsUntil, projectAccount } from "../accumulation";
import { projectBalancesExact, subtractRational, todaysDollarsFactor } from "../accumulationExact";
import type { Rational } from "../accumulationExact";
import type {
  CalculateRetirementScenario, FormatRetirementEstimate, ProjectRetirementAccount, RetirementEstimate, RetirementIllustration,
} from "./retirementScenarioContract";
import { RETIREMENT_REFUSAL_MESSAGE, retirementProjectionNumber, validateConfirmedRetirementScenario, validateRetirementContext } from "./retirementScenarioContract";

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const row = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const keys = (v: Record<string, unknown>, names: string[]) => Reflect.ownKeys(v).length === names.length && names.every(n => Object.prototype.hasOwnProperty.call(v, n));
const unsupported = () => new Error("This projection exceeds the supported numerical or monthly-work bounds.");
/** The frozen result field is a Number. Accept only when it preserves the exact
 * rounded integer used by the screen; being finite alone does not preserve dollars. */
function exactRoundedNumber(dollars: bigint): number {
  const value = Number(dollars);
  if (!finite(value) || BigInt(value) !== dollars) throw unsupported();
  return value;
}

/** Guard the existing authority, without changing its arithmetic or withdrawal timing. */
export const projectRetirementAccount: ProjectRetirementAccount = input => {
  if (!row(input) || !keys(input, ["startValue", "monthlyContribution", "annualReturnPct", "monthsToWithdraw", "withdrawYears"]) ||
    !finite(input.startValue) || !finite(input.monthlyContribution) || input.monthlyContribution < 0 ||
    !finite(input.annualReturnPct) || input.annualReturnPct < -100 || input.annualReturnPct > 100 ||
    !Number.isInteger(input.monthsToWithdraw) || input.monthsToWithdraw < 0 || input.monthsToWithdraw > 1200 ||
    (input.withdrawYears !== null && (!Number.isInteger(input.withdrawYears) || input.withdrawYears < 1 || input.withdrawYears > 50))) throw unsupported();
  const steps = input.monthsToWithdraw + 12 * Math.max((input.withdrawYears ?? 1) - 1, 0);
  if (steps > 1200) throw unsupported();
  const result = projectAccount(input);
  // Every growth intermediate is retained by the authority as a point; checking
  // the complete series also detects overflow before a later withdrawal to zero.
  if (!row(result) || !keys(result, ["points", "balanceAtWithdraw", "contributions", "growth", "withdrawals"]) ||
    ![result.balanceAtWithdraw, result.contributions, result.growth].every(finite) ||
    !Array.isArray(result.points) || result.points.length !== steps + 1 + (input.withdrawYears ?? 0) ||
    !Array.isArray(result.withdrawals) || result.withdrawals.length !== (input.withdrawYears ?? 0)) throw unsupported();
  let previous = 0;
  for (const point of result.points) {
    if (!row(point) || !keys(point, ["month", "balance"]) || !Number.isInteger(point.month) || point.month < previous || point.month > steps || !finite(point.balance)) throw unsupported();
    previous = point.month;
  }
  if (result.points[0].month !== 0 || previous !== steps) throw unsupported();
  for (const [i, withdrawal] of result.withdrawals.entries()) {
    if (!row(withdrawal) || !keys(withdrawal, ["year", "month", "amount", "balanceAfter"]) || withdrawal.year !== i + 1 ||
      withdrawal.month !== input.monthsToWithdraw + 12 * i || !finite(withdrawal.amount) || !finite(withdrawal.balanceAfter)) throw unsupported();
  }
  return result;
};

/** Round the Number's decimal representation with integer arithmetic. This also
 * avoids multiplication overflow for finite estimates near Number.MAX_VALUE. */
export const formatRetirementEstimate: FormatRetirementEstimate = value => {
  if (!finite(value)) throw unsupported();
  const magnitude = Math.abs(value), step = magnitude >= 10000 ? 1000 : magnitude >= 1000 ? 100 : 10;
  const [mantissa, exponent = "0"] = magnitude.toString().split("e"), [whole, fraction = ""] = mantissa.split(".");
  let coefficient = BigInt(whole + fraction);
  const scale = fraction.length - Number(exponent);
  if (scale < 0) coefficient *= 10n ** BigInt(-scale);
  const denominator = 10n ** BigInt(Math.max(scale, 0)) * BigInt(step);
  const rounded = ((2n * coefficient + denominator) / (2n * denominator)) * BigInt(step);
  const roundedDollars = exactRoundedNumber(value < 0 ? -rounded : rounded);
  return { roundedDollars: roundedDollars === 0 ? 0 : roundedDollars, roundingStepDollars: step,
    sign: value > 0 ? "positive" : value < 0 ? "negative" : "zero", lessThanTen: value !== 0 && roundedDollars === 0 };
};

const abs = (n: bigint) => (n < 0n ? -n : n);
function roundExact({ numerator, denominator }: Rational): { dollars: bigint; step: 10 | 100 | 1000 } {
  const magnitude = abs(numerator), step = magnitude >= 10000n * denominator ? 1000 : magnitude >= 1000n * denominator ? 100 : 10;
  const unit = BigInt(step) * denominator, dollars = ((2n * magnitude + unit) / (2n * unit)) * BigInt(step);
  return { dollars: numerator < 0n ? -dollars : dollars, step };
}
const signOf = (v: Rational) => (v.numerator > 0n ? 1 : v.numerator < 0n ? -1 : 0);

/** Display an exact value, or a bracket around one, using the frozen rounding policy (nearest step, ties
 * away from zero). A bracket is accepted only when every value in it rounds the same way; one that
 * straddles a rounding boundary is reported as unresolved rather than guessed. */
export function formatRetirementInterval(low: Rational, high: Rational): RetirementEstimate {
  const a = roundExact(low), b = roundExact(high);
  if (a.dollars !== b.dollars || a.step !== b.step || signOf(low) !== signOf(high)) throw unsupported();
  const roundedDollars = exactRoundedNumber(a.dollars), sign = signOf(low);
  return { roundedDollars: roundedDollars === 0 ? 0 : roundedDollars, roundingStepDollars: a.step, sign: sign > 0 ? "positive" : sign < 0 ? "negative" : "zero", lessThanTen: sign !== 0 && a.dollars === 0n };
}
const BRACKET_DIGITS = 70;
/** A huge exact ratio as a short bracket: exact when it terminates within 70 decimal places (every rounding tie
 * does), otherwise within 10^-70. Rounding then never has to divide or multiply 20,000-digit numbers. */
function bracket(value: Rational): [Rational, Rational] {
  const unit = 10n ** BigInt(BRACKET_DIGITS), scaledValue = value.numerator * unit;
  const quotient = scaledValue / value.denominator;
  if (scaledValue % value.denominator === 0n) { const exact = { numerator: quotient, denominator: unit }; return [exact, exact]; }
  const [low, high] = value.numerator > 0n ? [quotient, quotient + 1n] : [quotient - 1n, quotient];
  return [{ numerator: low, denominator: unit }, { numerator: high, denominator: unit }];
}
/** The value times a positive factor bracket, ordered low to high. */
function scaled(value: Rational, factor: { low: Rational; high: Rational }): [Rational, Rational] {
  const [lowValue, highValue] = bracket(value);
  const times = (v: Rational, f: Rational): Rational => ({ numerator: v.numerator * f.numerator, denominator: v.denominator * f.denominator });
  // The factor is positive, so the least product pairs the least value with the least factor when the value is nonnegative.
  return value.numerator >= 0n ? [times(lowValue, factor.low), times(highValue, factor.high)] : [times(lowValue, factor.high), times(highValue, factor.low)];
}

/** Inputs are already canonical native decimals. Combine before converting so
 * 0.1 + 0.2 is passed as 0.3, and a requested cent cannot silently disappear. */
function exactSum(a: string, b: string): string {
  const parts = [a, b].map(s => { const [whole, fraction = ""] = s.split("."); return { coefficient: BigInt(whole.replace("-", "") + fraction) * (s.startsWith("-") ? -1n : 1n), scale: fraction.length }; });
  const scale = Math.max(...parts.map(p => p.scale));
  const coefficient = parts.reduce((sum, p) => sum + p.coefficient * 10n ** BigInt(scale - p.scale), 0n);
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  return (coefficient < 0n ? "-" : "") + (scale ? digits.slice(0, -scale) + "." + digits.slice(-scale) : digits);
}
function exactDeposits(amount: string, count: number): string {
  const [whole, fraction = ""] = amount.split("."), cents = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * BigInt(count);
  return (cents / 100n).toString() + "." + (cents % 100n).toString().padStart(2, "0");
}

/** Pure snapshot calculation only. Live authorization, clock/source refresh and
 * current review consent MUST still be checked by the future controller. */
export const calculateRetirementScenario: CalculateRetirementScenario = confirmed => {
  const context = row(confirmed) && validateRetirementContext(confirmed.context).ok ? confirmed.context : null;
  const check = validateConfirmedRetirementScenario(confirmed, {
    today: context?.source.asOf ?? "", source: context?.source,
    investmentAccounts: context ? [{ id: context.account.id, name: context.account.name }] : [],
  } as Parameters<typeof validateConfirmedRetirementScenario>[1]);
  if (!check.ok) return { kind: "refused", code: check.code === "unsupported-number" ? "unsupported-number" : "invalid-input", message: check.reason };
  // Return a detached copy: edits by the caller cannot change an already produced result.
  const scenario = structuredClone(confirmed), { intent, assumptions } = scenario;
  const months = monthsUntil(intent.startDate, intent.retirementMonth);
  const extraDeposits = exactDeposits(intent.extra.amount, intent.extra.kind === "once" ? 1 : months);
  if (assumptions.view === "extra-deposits-only") return { kind: "extra-deposits-only", scenario, months, extraDeposits, unit: "nominal-dollars", growthForecastMade: false };
  try {
    const worth = scenario.context.currentValue!, contribution = assumptions.monthlyContribution!.amount;
    const startValue = retirementProjectionNumber(worth), monthlyContribution = retirementProjectionNumber(contribution);
    const changedStartText = intent.extra.kind === "once" ? exactSum(worth, intent.extra.amount) : worth;
    const changedMonthlyText = intent.extra.kind === "monthly" ? exactSum(contribution, intent.extra.amount) : contribution;
    const changedStart = retirementProjectionNumber(changedStartText), changedMonthly = retirementProjectionNumber(changedMonthlyText);
    const power = assumptions.purchasingPower;
    // (1 + inflation)^(-months/12) is exact for whole years and a tiny bracket otherwise.
    const factor = todaysDollarsFactor(power.kind === "today" ? power.inflationPct : "0", months);
    const display = (value: Rational) => formatRetirementInterval(...scaled(value, factor));
    // The confirmed return is also the sensitivity's base. Reuse that calculation within this one
    // immutable scenario, but return detached figures so editing one result cannot change another.
    const illustrations = new Map<string, RetirementIllustration>();
    const illustrate = (annualReturnPct: string): RetirementIllustration => {
      const cached = illustrations.get(annualReturnPct);
      if (cached) return structuredClone(cached);
      const input = { startValue, monthlyContribution, annualReturnPct: retirementProjectionNumber(annualReturnPct), monthsToWithdraw: months, withdrawYears: null };
      const baseline = projectRetirementAccount(input), changed = projectRetirementAccount({ ...input, startValue: changedStart, monthlyContribution: changedMonthly });
      // The series above are Number estimates for charts. Every displayed figure, and the difference
      // between the plans, comes from the same recurrence evaluated exactly.
      const [base, plan] = projectBalancesExact(annualReturnPct, months, [{ startValue: worth, monthlyContribution: contribution }, { startValue: changedStartText, monthlyContribution: changedMonthlyText }]);
      const result = { annualReturnPct, baseline, scenario: changed, display: { baseline: display(base), scenario: display(plan), difference: display(subtractRational(plan, base)) } };
      illustrations.set(annualReturnPct, result);
      return result;
    };
    const rates = assumptions.returns;
    const noGrowth = illustrate("0"), confirmedReturn = rates.kind === "confirmed-return" ? illustrate(rates.annualPct) : null;
    const s = rates.kind === "confirmed-return" ? rates.sensitivity : null;
    return { kind: "preview", scenario, months, extraDeposits, seriesUnit: "nominal-dollars", displayUnit: power.kind === "today" ? "today-dollars" : "nominal-dollars",
      noGrowth, confirmedReturn, sensitivity: s ? [illustrate(s.lower), illustrate(s.base), illustrate(s.higher)] : [] };
  } catch {
    return { kind: "refused", code: "unsupported-number", message: RETIREMENT_REFUSAL_MESSAGE };
  }
};
