import { describe, expect, it } from "vitest";
import { projectAccount } from "./accumulation";
import { projectBalanceExact, subtractRational, todaysDollarsFactor } from "./accumulationExact";
import type { Rational } from "./accumulationExact";

const same = (a: Rational, b: Rational) => a.numerator * b.denominator === b.numerator * a.denominator;
const whole = (n: bigint): Rational => ({ numerator: n, denominator: 1n });
const input = (startValue: string, monthlyContribution: string, annualReturnPct: string, monthsToWithdraw: number) => ({ startValue, monthlyContribution, annualReturnPct, monthsToWithdraw });

// Separate-method oracle: the closed polynomial in p/q (same as the Number oracle in
// retirementScenarioMath.test.ts), not the month-by-month recurrence used by the module.
function closedForm(startCents: bigint, monthlyCents: bigint, rateTenths: bigint, n: number): Rational {
  const q = 12000n, p = q + rateTenths;
  let deposits = 0n;
  for (let k = 0; k < n; k++) deposits += p ** BigInt(k) * q ** BigInt(n - k);
  return { numerator: startCents * p ** BigInt(n) + monthlyCents * deposits, denominator: 100n * q ** BigInt(n) };
}

describe("exact evaluation of projectAccount's recurrence (balance x (1 + rate/12) + contribution)", () => {
  it("matches the one-month hand anchors", () => {
    expect(same(projectBalanceExact(input("1000", "100", "12", 1)), whole(1110n))).toBe(true);
    expect(same(projectBalanceExact(input("1000", "150", "12", 1)), whole(1160n))).toBe(true);
    expect(same(projectBalanceExact(input("1050", "100", "12", 1)), { numerator: 23210n, denominator: 20n })).toBe(true);
  });
  it("returns the starting value for a zero horizon, including signed worth", () => {
    expect(same(projectBalanceExact(input("1000", "100", "12", 0)), whole(1000n))).toBe(true);
    expect(same(projectBalanceExact(input("-12.5", "100", "12", 0)), { numerator: -25n, denominator: 2n })).toBe(true);
  });
  it("keeps 500 deposits of one cent at no growth exactly $5, with no float residue", () => {
    expect(same(projectBalanceExact(input("0", "0.01", "0", 500)), whole(5n))).toBe(true);
  });
  it("keeps a $50 contribution effect on a 1e20 balance that Number cannot hold", () => {
    const base = projectBalanceExact(input("100000000000000000000", "100", "0", 1));
    const changed = projectBalanceExact(input("100000000000000000000", "150", "0", 1));
    expect(same(subtractRational(changed, base), whole(50n))).toBe(true);
  });
  for (const [start, monthly, tenths] of [[100000n, 10000n, 120n], [1337n, 29n, 75n], [100000n, 0n, -120n], [-1337n, 29n, 0n], [0n, 1n, 1000n], [5n, 5n, -1000n]] as const)
    for (const n of [0, 1, 2, 12, 37]) it(`equals the closed form for ${start}/${monthly}/${tenths}/${n}`, () => {
      const pct = (Number(tenths) / 10).toString(), money = (c: bigint) => (Number(c) / 100).toString();
      expect(same(projectBalanceExact(input(money(start), money(monthly), pct, n)), closedForm(start, monthly, tenths, n))).toBe(true);
    });
  it("supports 28-decimal rates and the 1200-month maximum", () => {
    const value = projectBalanceExact(input("1000", "100", "7.1234567890123456789012345678", 1200));
    expect(value.numerator > 0n && value.denominator > 0n).toBe(true);
    expect(Number.isFinite(Number(value.numerator) / Number(value.denominator) || 1)).toBe(true);
  });
  it("tracks the Number authority closely for the 36 frozen horizon/profile shapes (cross-check, not a display tolerance)", () => {
    for (const [start, monthly, pct] of [["0", "0", "0"], ["1000", "0", "12"], ["1000", "100", "0"], ["13.37", "0.29", "7.5"], ["1000", "50", "-100"]])
      for (const n of [0, 1, 12, 360, 600, 1200]) {
        const exact = projectBalanceExact(input(start, monthly, pct, n)), number = projectAccount({ startValue: Number(start), monthlyContribution: Number(monthly), annualReturnPct: Number(pct), monthsToWithdraw: n, withdrawYears: null }).balanceAtWithdraw;
        const value = Number(exact.numerator * 10n ** 30n / exact.denominator) / 1e30;
        expect(Math.abs(value - number)).toBeLessThanOrEqual(Math.max(1e-9, Math.abs(value) * 1e-9));
      }
  });
  for (const bad of [{ startValue: "1e3" }, { startValue: "1.5.0" }, { monthlyContribution: "-1" }, { annualReturnPct: "100.01" }, { annualReturnPct: "-100.01" }, { monthsToWithdraw: 1201 }, { monthsToWithdraw: -1 }, { monthsToWithdraw: 0.5 }, { startValue: 1000 }])
    it(`refuses malformed or unsupported input ${JSON.stringify(bad)}`, () => { expect(() => projectBalanceExact({ ...input("1000", "100", "12", 1), ...bad } as never)).toThrow(); });
});

describe("today's-dollars factor (1 + inflation)^(-months/12) as a bounded exact interval", () => {
  it("is exactly one with no inflation or at month zero", () => {
    for (const [pct, months] of [["0", 360], ["3", 0]] as const) {
      const f = todaysDollarsFactor(pct, months);
      expect(f.exact && same(f.low, whole(1n)) && same(f.high, whole(1n))).toBe(true);
    }
  });
  it("is exact for whole years and for exact roots", () => {
    const year = todaysDollarsFactor("100", 12), root = todaysDollarsFactor("56.25", 6);
    expect(year.exact && same(year.low, { numerator: 1n, denominator: 2n })).toBe(true);
    expect(root.exact && same(root.low, { numerator: 4n, denominator: 5n })).toBe(true);
  });
  it("brackets an irrational factor with a documented tiny width", () => {
    const f = todaysDollarsFactor("100", 6); // 2^(-1/2) = 0.70710678118654752440...
    expect(f.exact).toBe(false);
    const lo = Number(f.low.numerator * 10n ** 30n / f.low.denominator), hi = Number(f.high.numerator * 10n ** 30n / f.high.denominator);
    expect(lo).toBeLessThanOrEqual(0.7071067811865475244e30);
    expect(hi).toBeGreaterThanOrEqual(0.7071067811865475244e30);
    expect((f.high.numerator * f.low.denominator - f.low.numerator * f.high.denominator) * 10n ** 50n < f.high.denominator * f.low.denominator).toBe(true);
  });
  it("refuses unsupported inflation or horizon", () => {
    for (const [pct, months] of [["-1", 12], ["100.01", 12], ["x", 12], ["3", -1], ["3", 1201], ["3", 0.5]] as const) expect(() => todaysDollarsFactor(pct, months)).toThrow();
  });
});

// Separate-method oracle #2: the literal month-by-month recurrence on a common-denominator integer, i.e. the
// definition of the model, against the module's closed (geometric-series) form.
function recurrence(start: string, monthly: string, pct: string, n: number): Rational {
  const [rw, rf = ""] = pct.split("."), scale = 10n ** BigInt(rf.length), r = BigInt(rw + rf) , q = 1200n * scale, p = q + r;
  const money = (v: string) => { const [w, f = ""] = v.split("."); return { c: BigInt(w + f), d: 10n ** BigInt(f.length) }; };
  const s = money(start), m = money(monthly);
  // balance as a fraction N/D, advanced one month at a time: N/D * p/q + m
  let numerator = s.c * m.d, denominator = s.d * m.d;
  for (let i = 0; i < n; i++) { numerator = numerator * p * m.d + m.c * denominator * q; denominator = denominator * q * m.d; }
  return { numerator, denominator };
}
describe("literal-recurrence oracle and projectGoal whole-year comparison", () => {
  for (const [start, monthly, pct, n] of [["1000", "100", "12", 12], ["-250.75", "0.29", "7.5", 37], ["0", "0.01", "0.0000000000000000000000000001", 60], ["100000000000000000000", "100.01", "99.9999999999999", 24], ["5", "5", "-100", 12]] as const)
    it(`closed form equals the month-by-month recurrence for ${start}/${monthly}/${pct}/${n}`, () => {
      expect(same(projectBalanceExact(input(start, monthly, pct, n)), recurrence(start, monthly, pct, n))).toBe(true);
    });
  it("agrees with projectGoal's whole-year balances to the cent", async () => {
    const { projectGoal } = await import("./projections");
    for (const [start, monthly, pct, years] of [[0, 0, 0, 0], [1000, 100, 12, 1], [13.37, 0.29, 7.5, 30], [1e8, 1000, 3, 50], [1000, 50, 0, 100]])
      for (const year of projectGoal(start, monthly, pct, years)) {
        const exact = projectBalanceExact(input(String(start), String(monthly), String(pct), year.year * 12));
        const cents = (exact.numerator * 100n * 2n + exact.denominator) / (2n * exact.denominator);
        expect(Number(cents)).toBe(Math.round(year.balance * 100));
      }
  });
});
