/** Exact evaluation of `projectAccount`'s recurrence — each month the balance grows by
 * annual rate / 12, then the flat contribution is added — in BigInt rationals. The
 * Number-based `projectAccount` stays the authority for chart series and every screen
 * that already uses it; this module exists so a balance, a difference between two
 * balances and a display rounding boundary do not depend on binary floating point.
 * It adds no second model: same recurrence, same timing, no withdrawals. */

export type Rational = { numerator: bigint; denominator: bigint };
/** `exact` means low and high are the same exact value; otherwise the true value lies in [low, high]. */
export type RationalInterval = { low: Rational; high: Rational; exact: boolean };
export type ExactProjectionInput = { startValue: string; monthlyContribution: string; annualReturnPct: string; monthsToWithdraw: number };

const MAX_MONTHS = 1200;
const ROOT_DIGITS = 60;
type Decimal = { coefficient: bigint; scale: number };

function decimal(value: unknown, signed: boolean): Decimal {
  if (typeof value !== "string" || value.length > 64 || !/^-?(0|[1-9]\d*)(?:\.\d+)?$/.test(value) || (!signed && value.startsWith("-")))
    throw new Error("Use a plain decimal amount.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > 28) throw new Error("Use at most 28 decimal places.");
  let magnitude = BigInt(whole.replace("-", "") + fraction), scale = fraction.length;
  while (scale && magnitude % 10n === 0n) { magnitude /= 10n; scale--; } // fewer digits, same value, less work
  return { coefficient: value.startsWith("-") ? -magnitude : magnitude, scale };
}
const pow10 = (n: number) => 10n ** BigInt(n);
const months = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_MONTHS) throw new Error("Use a whole number of months from 0 to 1200.");
  return value;
};
const abs = (n: bigint) => (n < 0n ? -n : n);
const gcd = (a: bigint, b: bigint): bigint => { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a; };

/** Balance after `monthsToWithdraw` months, exactly. Money and rate are canonical decimal strings. */
export function projectBalanceExact(input: ExactProjectionInput): Rational {
  return projectBalancesExact(input?.annualReturnPct, input?.monthsToWithdraw, [{ startValue: input?.startValue, monthlyContribution: input?.monthlyContribution }])[0];
}

/** Several plans at one rate and horizon (for example a baseline and its changed plan). The expensive
 * powers are computed once, and the results share a denominator so they subtract cheaply. */
export function projectBalancesExact(annualReturnPct: string, monthsToWithdraw: number, plans: readonly { startValue: string; monthlyContribution: string }[]): Rational[] {
  const rate = decimal(annualReturnPct, true), n = months(monthsToWithdraw);
  const parsed = plans.map(plan => ({ start: decimal(plan?.startValue, true), contribution: decimal(plan?.monthlyContribution, false) }));
  const hundred = 100n * pow10(rate.scale);
  if (rate.coefficient < -hundred || rate.coefficient > hundred) throw new Error("Use an annual rate from -100 to 100.");
  const t = Math.max(0, ...parsed.flatMap(plan => [plan.start.scale, plan.contribution.scale])), scale10 = pow10(t);
  const q = 1200n * pow10(rate.scale), p = q + rate.coefficient, r = rate.coefficient;
  // The balance after m months is N_m / (q^m 10^t), with N_m = N_(m-1) p + contribution q^m. Summing that
  // geometric series gives N_n = start p^n + contribution q (p^n - q^n) / (p - q); p - q is the rate itself.
  const pn = p ** BigInt(n), qn = q ** BigInt(n), series = r === 0n ? 0n : q * ((pn - qn) / r);
  return parsed.map(({ start, contribution }) => {
    const startUnits = start.coefficient * pow10(t - start.scale), contributionUnits = contribution.coefficient * pow10(t - contribution.scale);
    if (r === 0n) return { numerator: startUnits + BigInt(n) * contributionUnits, denominator: scale10 };
    return { numerator: startUnits * pn + contributionUnits * series, denominator: qn * scale10 };
  });
}

export function subtractRational(a: Rational, b: Rational): Rational {
  // Both plans of one illustration share the monthly denominator q^n; avoid squaring a 20,000-digit number.
  if (a.denominator === b.denominator) return { numerator: a.numerator - b.numerator, denominator: a.denominator };
  if (a.denominator % b.denominator === 0n) return { numerator: a.numerator - b.numerator * (a.denominator / b.denominator), denominator: a.denominator };
  if (b.denominator % a.denominator === 0n) return { numerator: a.numerator * (b.denominator / a.denominator) - b.numerator, denominator: b.denominator };
  return { numerator: a.numerator * b.denominator - b.numerator * a.denominator, denominator: a.denominator * b.denominator };
}

/** Floor of the v-th root of a nonnegative integer. */
function integerRoot(value: bigint, v: number): bigint {
  if (value < 2n) return value;
  const degree = BigInt(v);
  let x = 1n << BigInt(Math.ceil(value.toString(2).length / v) + 1);
  for (;;) {
    const next = ((degree - 1n) * x + value / x ** (degree - 1n)) / degree;
    if (next >= x) break;
    x = next;
  }
  while (x ** degree > value) x--;
  while ((x + 1n) ** degree <= value) x++;
  return x;
}

/** (1 + inflation/100)^(-months/12): what a future dollar is worth today, as an exact value or a
 * bracket about 10^-60 wide. Saved-plan inflation bounds (0-100%) apply. */
export function todaysDollarsFactor(inflationPct: string, monthCount: number): RationalInterval {
  const inflation = decimal(inflationPct, false), n = months(monthCount);
  const b = 100n * pow10(inflation.scale);
  if (inflation.coefficient > b) throw new Error("Use inflation from 0 to 100.");
  const a = b + inflation.coefficient;
  const g = Number(gcd(BigInt(n), 12n));
  const u = n / g, v = 12 / g;
  const one: Rational = { numerator: 1n, denominator: 1n };
  if (u === 0 || a === b) return { low: one, high: one, exact: true };
  const top = b ** BigInt(u), bottom = a ** BigInt(u);
  const rootTop = integerRoot(top, v), rootBottom = integerRoot(bottom, v);
  if (rootTop ** BigInt(v) === top && rootBottom ** BigInt(v) === bottom) {
    const exact = { numerator: rootTop, denominator: rootBottom };
    return { low: exact, high: exact, exact: true };
  }
  const scaled = integerRoot(top * 10n ** BigInt(v * ROOT_DIGITS) / bottom, v), scale = pow10(ROOT_DIGITS);
  return { low: { numerator: scaled, denominator: scale }, high: { numerator: scaled + 1n, denominator: scale }, exact: false };
}
