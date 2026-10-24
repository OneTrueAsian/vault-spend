import { describe, expect, it } from "vitest";
import { m5Result, monthsBetween, roundShown } from "../testSupport/askVaultM6/m5Model";

/**
 * The independent M5 model, proved against (1) the two hand-worked anchors of M5/Worked-Examples.md (in referenceResults.json), (2) hand arithmetic, and (3) figures the
 * card displayed in its saved-plan and stated-return reviews on 21 October 2026 (recorded in the task-4 gap report): agreement of independent code with the app is the evidence.
 */
describe("independent M5 model", () => {
  it("one-month-monthly (anchor): 1000 at 1 percent a month (12 a year), +100 baseline, +50 extra: 1110 and 1160 show as 1100 and 1200, difference 50", () => {
    const r = m5Result({ openingDollars: "1000", baselineMonthly: "100", extra: { kind: "monthly", amount: "50" }, today: "2026-09-06", retirementMonth: "2026-10", annualPct: "12" });
    expect(r.months).toBe(1); expect(r.extraDeposits).toBe("50.00");
    expect(r.confirmedReturn).toMatchObject({ without: 1100, with: 1200, difference: 50 });
  });
  it("zero-month-once (anchor): retiring this month, a one-time 50 on 1000 shows 1000 and 1100 (tie away from zero), difference 50", () => {
    const r = m5Result({ openingDollars: "1000", baselineMonthly: "0", extra: { kind: "once", amount: "50" }, today: "2026-09-06", retirementMonth: "2026-09", annualPct: "12" });
    expect(r.months).toBe(0); expect(r.extraDeposits).toBe("50.00");
    expect(r.confirmedReturn).toMatchObject({ without: 1000, with: 1100, difference: 50 });
  });
  it("no growth is plain addition by hand: 10,000 + 285 x 200 = 67,000 and 10,000 + 285 x 250 = 81,250 (shown 81,000); difference 14,250 (shown 14,000)", () => {
    const r = m5Result({ openingDollars: "10000", baselineMonthly: "200", extra: { kind: "monthly", amount: "50" }, today: "2026-09-06", retirementMonth: "2050-06", annualPct: "0" });
    expect(r.months).toBe(285); expect(r.extraDeposits).toBe("14250.00");
    expect(r.noGrowth).toEqual({ without: 67000, with: 81000, difference: 14000 });
  });
  it("matches the figures the card showed: 6 percent, 285 months, +50 on 200 and 10,000: 167,000 / 199,000 / 31,000", () => {
    const r = m5Result({ openingDollars: "10000", baselineMonthly: "200", extra: { kind: "monthly", amount: "50" }, today: "2026-09-06", retirementMonth: "2050-06", annualPct: "6" });
    expect(r.confirmedReturn).toMatchObject({ without: 167000, with: 199000, difference: 31000 });
  });
  it("matches the figures the card showed: 7 percent, 162 months, +75: no growth 42,000 / 55,000 / 12,000 and growth 79,000 / 99,000 / 20,000; deposits 12,150.00", () => {
    const r = m5Result({ openingDollars: "10000", baselineMonthly: "200", extra: { kind: "monthly", amount: "75" }, today: "2026-09-06", retirementMonth: "2040-03", annualPct: "7" });
    expect(r.months).toBe(162); expect(r.extraDeposits).toBe("12150.00");
    expect(r.noGrowth).toEqual({ without: 42000, with: 55000, difference: 12000 });
    expect(r.confirmedReturn).toMatchObject({ without: 79000, with: 99000, difference: 20000 });
  });
  it("matches the example card: 351 months at 7 percent from 2026-10-20: 306,827 and 364,278 show as 307,000 and 364,000, difference 57,450 shows 57,000", () => {
    const r = m5Result({ openingDollars: "10000", baselineMonthly: "200", extra: { kind: "monthly", amount: "50" }, today: "2026-10-20", retirementMonth: "2056-01", annualPct: "7" });
    expect(r.confirmedReturn).toMatchObject({ without: 307000, with: 364000, difference: 57000 }); expect(r.extraDeposits).toBe("17550.00");
  });
  it("a negative return and a zero extra are handled: -2 percent still adds the deposits; $0 extra changes nothing", () => {
    const neg = m5Result({ openingDollars: "10000", baselineMonthly: "200", extra: { kind: "monthly", amount: "100" }, today: "2026-09-06", retirementMonth: "2050-06", annualPct: "-2" });
    expect(neg.confirmedReturn.with).toBeGreaterThan(neg.confirmedReturn.without); expect(neg.confirmedReturn.difference).toBeGreaterThan(0);
    const zero = m5Result({ openingDollars: "10000", baselineMonthly: "200", extra: { kind: "monthly", amount: "0" }, today: "2026-09-06", retirementMonth: "2050-06", annualPct: "7" });
    expect(zero.confirmedReturn.difference).toBe(0); expect(zero.noGrowth.difference).toBe(0); expect(zero.extraDeposits).toBe("0.00");
  });
  it("rounding steps and ties: step 10 under 1,000, 100 under 10,000, 1,000 from 10,000; ties move away from zero", () => {
    const v = (dollars: number, cents = 0): { n: bigint; d: bigint } => ({ n: BigInt(dollars * 100 + cents), d: 1n });
    expect(roundShown(v(994))).toBe(990); expect(roundShown(v(995))).toBe(1000); expect(roundShown(v(1049, 99))).toBe(1000); expect(roundShown(v(1050))).toBe(1100);
    expect(roundShown(v(9949))).toBe(9900); expect(roundShown(v(9950))).toBe(10000); expect(roundShown(v(10499, 99))).toBe(10000); expect(roundShown(v(10500))).toBe(11000);
    expect(roundShown({ n: -105000n, d: 1n })).toBe(-1100); expect(roundShown(v(0))).toBe(0);
  });
  it("counts whole calendar months from today's month", () => {
    expect(monthsBetween("2026-09-06", "2026-09")).toBe(0); expect(monthsBetween("2026-09-06", "2026-10")).toBe(1); expect(monthsBetween("2026-09-30", "2050-06")).toBe(285); expect(monthsBetween("2026-10-20", "2056-01")).toBe(351);
  });
});
