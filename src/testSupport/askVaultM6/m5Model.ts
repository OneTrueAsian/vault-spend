/**
 * Independent exact model of the M5 extra-money illustration (Task-4 item 6: separate exact expected results for the M5 corpus). Test-only; shares no code with
 * src/askVault/retirementScenarioMath.ts. Rules (M5 Contract.md:43, :53-69; the result card's own statement "Growth is worked out each month, then your deposit is added
 * at the end of that month"):
 *  - month zero is today; the retirement month is a whole number of calendar months later (0 allowed);
 *  - a monthly extra is added at the end of each of those months on top of the saved monthly amount; a one-time extra is added at month zero;
 *  - growth is the yearly return divided by 12, applied each month; no growth when the return is 0;
 *  - the shown figures round the EXACT value to the nearest 1000 (at 10,000 or more), 100 (at 1,000 or more) or 10, ties away from zero; the difference is the exact
 *    difference rounded on its own;
 *  - the exact extra deposits are n monthly amounts, or the single amount, to the cent.
 * Exact arithmetic: BigInt cents and a rational with a power-of-ten rate; nothing is floating point.
 */
export type Extra = { kind: "monthly" | "once"; amount: string };
export type Figures = { without: number; with: number; difference: number };
export type M5Result = { months: number; extraDeposits: string; noGrowth: Figures; confirmedReturn: { annualPct: string } & Figures };

type Rational = { n: bigint; d: bigint };
const abs = (x: bigint) => (x < 0n ? -x : x);
const centsOf = (amount: string): bigint => {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!m) throw new Error(`not a money amount: ${amount}`);
  return BigInt(m[1] + m[2] + (m[3] ?? "").padEnd(2, "0"));
};
export const monthsBetween = (today: string, month: string) => (Number(month.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + (Number(month.slice(5, 7)) - Number(today.slice(5, 7)));

/** Exact balance in cents after `months` months: opening, then each month growth at annualPct/12 and a deposit at month end. */
function balance(opening: bigint, deposit: bigint, annualPct: string, months: number): Rational {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(annualPct);
  if (!m) throw new Error(`not a percentage: ${annualPct}`);
  const scale = (m[3] ?? "").length, P = BigInt(m[1] + m[2] + (m[3] ?? "")), Q = 1200n * 10n ** BigInt(scale);
  if (P === 0n) return { n: opening + BigInt(months) * deposit, d: 1n };
  const grow = (Q + P) ** BigInt(months), base = Q ** BigInt(months);
  let n = opening * grow * P + deposit * Q * (grow - base), d = base * P;
  if (d < 0n) { n = -n; d = -d; }
  return { n, d };
}
const minus = (a: Rational, b: Rational): Rational => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });

/** Round a value in cents (as a rational) to whole dollars by the frozen step policy. */
export function roundShown(v: Rational): number {
  const magnitude = abs(v.n), dollarsTimes = v.d * 100n;               // value in dollars = n / dollarsTimes
  const step = magnitude >= 10000n * dollarsTimes ? 1000n : magnitude >= 1000n * dollarsTimes ? 100n : 10n;
  const unit = step * dollarsTimes;
  const rounded = ((2n * magnitude + unit) / (2n * unit)) * step;
  return Number(v.n < 0n ? -rounded : rounded);
}

export function m5Result(input: { openingDollars: string; baselineMonthly: string; extra: Extra; today: string; retirementMonth: string; annualPct: string }): M5Result {
  const months = monthsBetween(input.today, input.retirementMonth);
  if (months < 0) throw new Error("retirement month is before today");
  const opening = centsOf(input.openingDollars), baseline = centsOf(input.baselineMonthly), extra = centsOf(input.extra.amount);
  const monthly = input.extra.kind === "monthly";
  const openWith = opening + (monthly ? 0n : extra), depositWith = baseline + (monthly ? extra : 0n);
  const figures = (pct: string): Figures => {
    const without = balance(opening, baseline, pct, months), withExtra = balance(openWith, depositWith, pct, months);
    return { without: roundShown(without), with: roundShown(withExtra), difference: roundShown(minus(withExtra, without)) };
  };
  const total = monthly ? BigInt(months) * extra : extra;
  const deposits = `${total / 100n}.${String(total % 100n).padStart(2, "0")}`;
  return { months, extraDeposits: deposits, noGrowth: figures("0"), confirmedReturn: { annualPct: input.annualPct, ...figures(input.annualPct) } };
}
