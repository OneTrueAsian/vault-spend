import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import * as accumulation from "../accumulation";
import type { ProjectionInput } from "../accumulation";
import { projectGoal } from "../projections";
import { retirementContractExamples } from "./retirementScenarioContractExamples";
import { calculateRetirementScenario, formatRetirementEstimate, formatRetirementInterval, projectRetirementAccount } from "./retirementScenarioMath";
import type { ConfirmedRetirementScenario } from "./retirementScenarioContract";
import { retirementParityDigests } from "./retirementScenarioParity.testdata";

afterEach(() => vi.restoreAllMocks());
const input = (changes: Partial<ProjectionInput> = {}): ProjectionInput => ({ startValue: 1000, monthlyContribution: 100, annualReturnPct: 12, monthsToWithdraw: 1, withdrawYears: null, ...changes });
const scenario = () => retirementContractExamples()[0].input;
const preview = (value = scenario()) => {
  const result = calculateRetirementScenario(value);
  expect(result.kind).toBe("preview");
  if (result.kind !== "preview") throw Error("A valid balance scenario must produce a preview");
  return result;
};

// Frozen v1: 36 explicit profile/horizon combinations plus 12 withdrawal cases.
// These characterize the authority; they are not independent expected arithmetic.
const horizons = [0, 1, 12, 360, 600, 1200] as const;
const profiles = [
  ["all-zero", 0, 0, 0], ["no-contribution", 1000, 0, 12],
  ["no-growth", 1000, 100, 0], ["fractional", 13.37, 0.29, 7.5],
  ["large", 1e20, 1e6, 3], ["negative-preview", 1000, 50, -100],
] as const;
const frozenCases: { id: string; input: ProjectionInput }[] = profiles.flatMap(([name, startValue, monthlyContribution, annualReturnPct]) =>
  horizons.map(monthsToWithdraw => ({ id: `${name}-${monthsToWithdraw}`, input: input({ startValue, monthlyContribution, annualReturnPct, monthsToWithdraw }) })));
for (const [monthsToWithdraw, withdrawYears, annualReturnPct] of [
  [0, 1, 0], [0, 2, 12], [1, 1, 12], [12, 2, 0], [12, 3, 6], [360, 5, 7.5],
  [600, 50, 3], [612, 50, 0], [1188, 2, -12], [1200, 1, 12], [0, 50, -100], [1, 3, 100],
]) frozenCases.push({ id: `withdraw-${monthsToWithdraw}-${withdrawYears}-${annualReturnPct}`, input: input({ monthsToWithdraw, withdrawYears, annualReturnPct }) });

describe("C1/C5/C7 frozen authority parity v1", () => {
  it("retains 48 uniquely named full-output cases", () => { expect(frozenCases).toHaveLength(48); expect(new Set(frozenCases.map(v => v.id)).size).toBe(48); });
  for (const c of frozenCases) it(c.id, () => {
    const expected = accumulation.projectAccount(c.input), copy = structuredClone(c.input);
    const spy = vi.spyOn(accumulation, "projectAccount");
    const actual = projectRetirementAccount(Object.freeze(c.input));
    expect(spy).toHaveBeenCalledExactlyOnceWith(c.input);
    expect(actual).toEqual(expected); // every point/month/contribution/growth/withdrawal
    expect(createHash("sha256").update(JSON.stringify(actual)).digest("hex")).toBe(retirementParityDigests[c.id]);
    expect(c.input).toEqual(copy);
    const steps = c.input.monthsToWithdraw + 12 * Math.max((c.input.withdrawYears ?? 1) - 1, 0);
    expect(actual.points).toHaveLength(steps + 1 + (c.input.withdrawYears ?? 0));
    expect(actual.withdrawals).toHaveLength(c.input.withdrawYears ?? 0);
  });
  for (const patch of [
    { startValue: NaN }, { startValue: Infinity }, { monthlyContribution: -1 }, { monthlyContribution: Infinity },
    { annualReturnPct: -100.01 }, { annualReturnPct: 100.01 }, { annualReturnPct: NaN },
    { monthsToWithdraw: -1 }, { monthsToWithdraw: 0.5 }, { monthsToWithdraw: 1201 }, { monthsToWithdraw: Infinity },
    { withdrawYears: 0 }, { withdrawYears: 51 }, { withdrawYears: 1.5 }, { withdrawYears: NaN },
    { monthsToWithdraw: 613, withdrawYears: 50 }, { monthsToWithdraw: 1200, withdrawYears: 2 },
    { startValue: "1000" }, { extra: true },
  ]) it(`refuses unsupported input before authority call: ${JSON.stringify(patch)}`, () => {
    const spy = vi.spyOn(accumulation, "projectAccount");
    expect(() => projectRetirementAccount({ ...input(), ...patch } as ProjectionInput)).toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
  it("refuses absent fields, unexpected prototypes and hidden/symbol keys", () => {
    const absent = { ...input() } as Partial<ProjectionInput>; delete absent.withdrawYears;
    for (const value of [null, [], absent, Object.assign(Object.create({}), input()),
      Object.defineProperty(input(), "hidden", { value: 1 }), { ...input(), [Symbol("extra")]: 1 }])
      expect(() => projectRetirementAccount(value as ProjectionInput)).toThrow();
  });
  it("retains signed recorded worth, tiny inputs, null prototypes and fresh outputs", () => {
    const params = Object.assign(Object.create(null), input({ startValue: -1, monthlyContribution: 1e-28 }));
    expect(projectRetirementAccount(params)).toEqual(accumulation.projectAccount(params));
    const first = projectRetirementAccount(input()); first.points[0].balance = -999;
    expect(projectRetirementAccount(input()).points[0].balance).toBe(1000);
  });
  for (const params of [input({ startValue: Number.MAX_VALUE, annualReturnPct: 100 }), input({ monthlyContribution: Number.MAX_VALUE, monthsToWithdraw: 2, annualReturnPct: 0 }),
    input({ startValue: -Number.MAX_VALUE, monthlyContribution: Number.MAX_VALUE, annualReturnPct: 0, monthsToWithdraw: 2 })])
    it("refuses nonfinite intermediate/final balances, contributions or growth", () => { expect(() => projectRetirementAccount(params)).toThrow(); });
  it("checks all returned points/withdrawals as well as summary scalars", () => {
    const valid = accumulation.projectAccount(input({ withdrawYears: 2 }));
    for (const corrupt of [
      () => { const p = structuredClone(valid); p.points[1].balance = Infinity; return p; },
      () => { const p = structuredClone(valid); p.withdrawals[0].amount = NaN; return p; },
      () => { const p = structuredClone(valid); p.growth = Infinity; return p; },
      () => { const p = structuredClone(valid); p.points.pop(); return p; },
    ]) {
      vi.spyOn(accumulation, "projectAccount").mockImplementationOnce(corrupt);
      expect(() => projectRetirementAccount(input({ withdrawYears: 2 }))).toThrow(); vi.restoreAllMocks();
    }
  });
});

// Separate-method exact oracle: closed polynomial in p/q, not a copy of the
// authority's floating-point monthly loop. Synthetic same-author expectations.
function rationalBalance(startCents: bigint, monthlyCents: bigint, rateTenths: bigint, n: number) {
  const q = 12000n, p = q + rateTenths;
  let depositSum = 0n;
  for (let k = 0; k < n; k++) depositSum += p ** BigInt(k) * q ** BigInt(n - k);
  return { centsNumerator: startCents * p ** BigInt(n) + monthlyCents * depositSum, denominator: q ** BigInt(n) };
}
const roundRational = (a: bigint, b: bigint) => (a < 0n ? -1n : 1n) * ((2n * (a < 0n ? -a : a) + b) / (2n * b));
describe("C8 separate-method arithmetic and equivalent yearly comparator", () => {
  for (const [startCents, monthlyCents, rateTenths] of [[100000n, 10000n, 120n], [1337n, 29n, 75n], [100000n, 0n, -120n], [-1337n, 29n, 0n]] as const)
    for (const n of [0, 1, 2, 12]) it(`exact oracle ${startCents}/${monthlyCents}/${rateTenths}/${n}`, () => {
      const exact = rationalBalance(startCents, monthlyCents, rateTenths, n);
      const actual = projectRetirementAccount(input({ startValue: Number(startCents) / 100, monthlyContribution: Number(monthlyCents) / 100, annualReturnPct: Number(rateTenths) / 10, monthsToWithdraw: n })).balanceAtWithdraw;
      expect(BigInt(Math.round(actual * 100))).toBe(roundRational(exact.centsNumerator, exact.denominator));
      const magnitude = exact.centsNumerator < 0n ? -exact.centsNumerator : exact.centsNumerator;
      const step = magnitude >= 1000000n * exact.denominator ? 1000 : magnitude >= 100000n * exact.denominator ? 100 : 10;
      const rounded = Number(roundRational(exact.centsNumerator, exact.denominator * BigInt(100 * step))) * step;
      expect(formatRetirementEstimate(actual).roundedDollars).toBe(rounded);
    });
  for (const [startValue, monthlyContribution, annualReturnPct, years] of [[0, 0, 0, 0], [1000, 100, 12, 1], [13.37, 0.29, 7.5, 30], [1e8, 1000, 3, 50], [1000, 50, -12, 100]])
    it(`yearly comparator ${startValue}/${monthlyContribution}/${annualReturnPct}/${years}`, () => {
      const p = projectRetirementAccount(input({ startValue, monthlyContribution, annualReturnPct, monthsToWithdraw: years * 12 }));
      for (const year of projectGoal(startValue, monthlyContribution, annualReturnPct, years)) expect(Math.round(p.points[year.year * 12].balance * 100)).toBe(Math.round(year.balance * 100));
    });
});

describe("C2–C6/U7/U8 paired calculations, exact deposits and units", () => {
  for (const example of retirementContractExamples()) it(`runs complete hand anchor ${example.id}`, () => { expect(calculateRetirementScenario(example.input)).toEqual(example.expected); });
  it("only changes monthly contribution or initial worth, preserving all other authority parameters", () => {
    for (const kind of ["monthly", "once"] as const) {
      const value = scenario(); value.intent.extra.kind = kind;
      const spy = vi.spyOn(accumulation, "projectAccount"); preview(value);
      expect(spy.mock.calls.map(([p]) => p)).toEqual([input({ annualReturnPct: 0 }), input({ annualReturnPct: 0, startValue: kind === "once" ? 1050 : 1000, monthlyContribution: kind === "monthly" ? 150 : 100 }), input(), input({ startValue: kind === "once" ? 1050 : 1000, monthlyContribution: kind === "monthly" ? 150 : 100 })]);
      spy.mockRestore();
    }
  });
  it("keeps nominal series and exact deposits while consistently deflating both displayed plans and their raw difference", () => {
    const value = scenario(); value.intent.retirementMonth = "2027-10"; value.assumptions.purchasingPower = { kind: "today", inflationPct: "100" };
    const real = preview(value); value.assumptions.purchasingPower = { kind: "nominal" }; const nominal = preview(value);
    expect(real.noGrowth.baseline).toEqual(nominal.noGrowth.baseline); expect(real.confirmedReturn!.scenario).toEqual(nominal.confirmedReturn!.scenario);
    expect(real.displayUnit).toBe("today-dollars"); expect(real.seriesUnit).toBe("nominal-dollars"); expect(real.extraDeposits).toBe("600.00");
    for (const illustration of [real.noGrowth, real.confirmedReturn!]) {
      const a = illustration.baseline.balanceAtWithdraw / 2, b = illustration.scenario.balanceAtWithdraw / 2;
      expect(illustration.display).toEqual({ baseline: formatRetirementEstimate(a), scenario: formatRetirementEstimate(b), difference: formatRetirementEstimate((illustration.scenario.balanceAtWithdraw - illustration.baseline.balanceAtWithdraw) / 2) });
    }
  });
  it("retains no-growth without mandatory rates and shows optional ordered negative/zero/positive sensitivity", () => {
    const value = scenario(); value.assumptions.returns = { kind: "no-growth" };
    expect(preview(value).confirmedReturn).toBeNull(); expect(preview(value).sensitivity).toEqual([]);
    value.assumptions.returns = { kind: "confirmed-return", annualPct: "0", basis: "explicit", sensitivity: { lower: "-100", base: "0", higher: "100" } };
    const r = preview(value); expect(r.sensitivity.map(v => v.annualReturnPct)).toEqual(["-100", "0", "100"]);
    expect(r.sensitivity).toHaveLength(3);
    expect(r.sensitivity[0]!.scenario.balanceAtWithdraw).toBeLessThan(r.sensitivity[2]!.scenario.balanceAtWithdraw);
  });
  for (const kind of ["monthly", "once"] as const) for (const months of [0, 1, 1200]) it(`counts exact ${kind} cents for ${months} months including leap month zero`, () => {
    const value = retirementContractExamples()[3].input; value.intent.extra = { kind, amount: "0.29" }; value.intent.retirementMonth = months === 0 ? "2000-02" : months === 1 ? "2000-03" : "2100-02";
    const r = calculateRetirementScenario(value); expect(r.kind).toBe("extra-deposits-only");
    if (r.kind === "refused") throw Error(r.message);
    expect(r.extraDeposits).toBe(kind === "once" ? "0.29" : months === 0 ? "0.00" : months === 1 ? "0.29" : "348.00");
  });
  it("keeps huge exact deposits without converting unused unsafe context", () => {
    const value = retirementContractExamples()[3].input; value.context.currentValue = "9007199254740993"; value.intent.extra.amount = "79228162514264337593543950335";
    const r = calculateRetirementScenario(value); expect(r).toMatchObject({ kind: "extra-deposits-only", extraDeposits: "95073795017117205112252740402000.00", growthForecastMade: false });
  });
  it("C8 interacting large worth/small monthly extra retains the independently rounded $50 difference", () => {
    // All decimal inputs and combined monthly contributions survive the frozen
    // conversion contract. The exact no-growth difference is (150-100)*1=$50.
    // Comparing large rounded balances alone would conceal this model defect.
    const value = scenario(); value.context.currentValue = "100000000000000000000";
    value.assumptions.returns = { kind: "no-growth" };
    const r = preview(value);
    expect(r.extraDeposits).toBe("50.00");
    expect(r.noGrowth.display.difference).toEqual({ roundedDollars: 50, roundingStepDollars: 10, sign: "positive", lessThanTen: false });
  });
  it("C8 exact $5 no-growth tie after 500 cent deposits rounds away from zero", () => {
    const value = scenario(); value.context.currentValue = "0"; value.context.contribution = { kind: "saved", monthlyAmount: "0" };
    value.assumptions.monthlyContribution = { basis: "context", amount: "0" }; value.assumptions.returns = { kind: "no-growth" };
    value.intent.extra.amount = "0.01"; value.intent.retirementMonth = "2068-06";
    const r = preview(value);
    expect(r.months).toBe(500); expect(r.extraDeposits).toBe("5.00");
    expect(r.noGrowth.display.difference.roundedDollars).toBe(10);
  });
  it("refuses invalid/unconfirmed/unsupported inputs rather than throwing or fabricating a forecast", () => {
    for (const value of [null, {}, { ...scenario(), confirmed: false }, { ...scenario(), extra: true }])
      expect(calculateRetirementScenario(value as ConfirmedRetirementScenario)).toMatchObject({ kind: "refused", code: "invalid-input" });
    const value = scenario(); value.intent.extra = { kind: "once", amount: "0.01" }; value.context.currentValue = "10000000000000000";
    expect(calculateRetirementScenario(value)).toMatchObject({ kind: "refused", code: "unsupported-number" });
    value.intent.startDate = "2026-11-01"; expect(calculateRetirementScenario(value)).toMatchObject({ kind: "refused", code: "invalid-input" });
  });
  it("does not mutate or retain caller-owned terms and does not read the system clock", () => {
    const value = scenario(), before = structuredClone(value); vi.spyOn(Date, "now").mockImplementation(() => { throw Error("Clock is controller-owned"); });
    const r = preview(value); expect(value).toEqual(before); value.intent.extra.amount = "999";
    expect(r.scenario.intent.extra.amount).toBe("50"); expect(preview().scenario.intent.extra.amount).toBe("50");
  });
});

describe("E6 deterministic display formatting", () => {
  for (const [value, roundedDollars, roundingStepDollars] of [[0, 0, 10], [-0, 0, 10], [4.99, 0, 10], [-4.99, 0, 10], [5, 10, 10], [-5, -10, 10],
    [999.99, 1000, 10], [1000, 1000, 100], [1050, 1100, 100], [-1050, -1100, 100], [9999.99, 10000, 100], [10000, 10000, 1000], [10500, 11000, 1000], [-10500, -11000, 1000], [Number.MIN_VALUE, 0, 10]])
    it(`formats ${value}`, () => {
      const r = formatRetirementEstimate(value); expect(r).toEqual({ roundedDollars, roundingStepDollars, sign: value > 0 ? "positive" : value < 0 ? "negative" : "zero", lessThanTen: value !== 0 && roundedDollars === 0 });
      expect(Object.is(r.roundedDollars, -0)).toBe(false);
    });
  for (const value of [NaN, Infinity, -Infinity, "50", null]) it(`refuses invalid formatter input ${String(value)}`, () => { expect(() => formatRetirementEstimate(value as number)).toThrow(); });
  it("refuses a finite extreme whose exact rounded integer cannot survive the frozen Number field", () => { expect(() => formatRetirementEstimate(Number.MAX_VALUE)).toThrow(); });
});

// R2/R3: display decisions come from exact values, never from a subtraction of Number balances.
const rational = (numerator: bigint, denominator = 1n) => ({ numerator, denominator });
describe("R3 exact display rounding (boundary, tie, direction)", () => {
  for (const [numerator, denominator, roundedDollars, roundingStepDollars, sign, lessThanTen] of [
    [5n, 1n, 10, 10, "positive", false], [-5n, 1n, -10, 10, "negative", false], [4999999n, 1000000n, 0, 10, "positive", true],
    [-4999999n, 1000000n, 0, 10, "negative", true], [0n, 1n, 0, 10, "zero", false], [1050n, 1n, 1100, 100, "positive", false],
    [-1050n, 1n, -1100, 100, "negative", false], [999999n, 1000n, 1000, 10, "positive", false], [9999995n, 1000n, 10000, 100, "positive", false],
    [10500n, 1n, 11000, 1000, "positive", false], [-10500n, 1n, -11000, 1000, "negative", false], [10499999n, 1000n, 10000, 1000, "positive", false],
  ] as const) it(`rounds ${numerator}/${denominator}`, () => {
    expect(formatRetirementInterval(rational(numerator, denominator), rational(numerator, denominator))).toEqual({ roundedDollars, roundingStepDollars, sign, lessThanTen });
  });
  it("accepts an interval only when every point in it rounds the same way", () => {
    expect(formatRetirementInterval(rational(1204n, 1n), rational(1206n, 1n)).roundedDollars).toBe(1200);
  });
  it("reports a bracket straddling a rounding boundary as unresolved instead of guessing", () => {
    expect(() => formatRetirementInterval(rational(49999n, 10000n), rational(50001n, 10000n))).toThrow();
    expect(() => formatRetirementInterval(rational(99999n, 100n), rational(100001n, 100n))).toThrow(); // step change at 1000
  });
  it("never returns negative zero", () => { expect(Object.is(formatRetirementInterval(rational(-4n), rational(-4n)).roundedDollars, -0)).toBe(false); });
});

describe("R3 paired differences survive cancellation and floating-point error", () => {
  const withWorth = (currentValue: string, mutate: (value: ConfirmedRetirementScenario) => void = () => {}) => {
    const value = scenario(); value.context.currentValue = currentValue; mutate(value); return preview(value);
  };
  it("keeps the $50 monthly difference on a $1e20 balance at a confirmed 12% return", () => {
    const r = withWorth("100000000000000000000");
    expect(r.confirmedReturn!.display.difference).toEqual({ roundedDollars: 50, roundingStepDollars: 10, sign: "positive", lessThanTen: false });
    expect(r.noGrowth.display.difference.roundedDollars).toBe(50);
  });
  it("keeps a one-time $50 on a $1e15 balance, growing one month at 12% (exactly $50.50 -> $50)", () => {
    const r = withWorth("1000000000000000", v => { v.intent.extra.kind = "once"; });
    expect(r.confirmedReturn!.display.difference.roundedDollars).toBe(50);
    expect(r.noGrowth.display.difference.roundedDollars).toBe(50);
  });
  it("decides a post-deflation tie exactly: a one-time $50 / 2 = $25 rounds to $30 at 100% inflation over a year", () => {
    const r = withWorth("1000000000000000", v => { v.intent.extra.kind = "once"; v.intent.retirementMonth = "2027-10"; v.assumptions.returns = { kind: "no-growth" }; v.assumptions.purchasingPower = { kind: "today", inflationPct: "100" }; });
    expect(r.months).toBe(12); expect(r.extraDeposits).toBe("50.00");
    expect(r.noGrowth.display.difference).toEqual({ roundedDollars: 30, roundingStepDollars: 10, sign: "positive", lessThanTen: false });
  });
  it("rounds repeated cent deposits that land exactly on a tie: 100 x $0.05 = $5.00 -> $10", () => {
    const r = withWorth("0", v => { v.context.contribution = { kind: "saved", monthlyAmount: "0" }; v.assumptions.monthlyContribution = { basis: "context", amount: "0" };
      v.assumptions.returns = { kind: "no-growth" }; v.intent.extra.amount = "0.05"; v.intent.retirementMonth = "2035-02"; });
    expect(r.months).toBe(100); expect(r.noGrowth.display.difference.roundedDollars).toBe(10);
  });
  it("keeps a tiny positive change visible as 'less than $10' with its direction", () => {
    const r = withWorth("0", v => { v.context.contribution = { kind: "saved", monthlyAmount: "0" }; v.assumptions.monthlyContribution = { basis: "context", amount: "0" };
      v.assumptions.returns = { kind: "no-growth" }; v.intent.extra.amount = "0.04"; });
    expect(r.noGrowth.display.difference).toEqual({ roundedDollars: 0, roundingStepDollars: 10, sign: "positive", lessThanTen: true });
  });
  it("keeps exact zero extra as zero, not less-than-ten", () => {
    const r = withWorth("100000000000000000000", v => { v.intent.extra.amount = "0"; });
    expect(r.noGrowth.display.difference).toEqual({ roundedDollars: 0, roundingStepDollars: 10, sign: "zero", lessThanTen: false });
    expect(r.confirmedReturn!.display.difference.sign).toBe("zero");
  });
  it("uses preview-negative rates and sensitivity from the same exact path", () => {
    const r = withWorth("1000000000000000", v => { v.assumptions.returns = { kind: "confirmed-return", annualPct: "0", basis: "explicit", sensitivity: { lower: "-100", base: "0", higher: "100" } }; });
    expect(r.sensitivity.map(v => v.display.difference.roundedDollars)).toEqual([50, 50, 50]);
  });
  it("applies the same fractional-year inflation to both plans and their difference", () => {
    const r = withWorth("1000", v => { v.intent.retirementMonth = "2028-04"; v.assumptions.purchasingPower = { kind: "today", inflationPct: "100" }; });
    const factor = 2 ** -0.5; // 18 months = 1.5 years
    const expectedScenario = formatRetirementEstimate(r.confirmedReturn!.scenario.balanceAtWithdraw * 2 ** -1.5);
    expect(r.months).toBe(18); expect(factor).toBeGreaterThan(0);
    expect(r.confirmedReturn!.display.scenario).toEqual(expectedScenario);
  });
});

// R5 reconciliation: for ordinary values, the exact display agrees with the legacy Number-derived display.
// Any disagreement must be a case where binary floating point crossed a rounding boundary; none is tolerated silently.
describe("R5 exact display versus the legacy Number-derived display", () => {
  const worths = ["0", "1000", "13.37", "25000", "987654.32"], monthlies = ["0", "100", "0.29", "2500"], extras = ["0", "50", "0.01", "333.33"];
  const rates = ["0", "3", "7.5", "12", "-12"], horizons = ["2026-10", "2026-11", "2027-10", "2056-10", "2076-10"], inflation = [null, "0", "3", "100"] as const;
  it("matches on a 5x4x4x5x5x4 grid except where the legacy figure demonstrably crossed a boundary", { timeout: 60000 }, () => {
    let compared = 0; const crossed: string[] = [];
    for (const worth of worths) for (const monthly of monthlies) for (const extra of extras) for (const rate of rates) for (const month of horizons) for (const inflationPct of inflation) {
      const kind = Number(extra) * 100 % 2 === 0 ? "monthly" : "once";
      const value = scenario(); value.context.currentValue = worth; value.context.contribution = { kind: "saved", monthlyAmount: monthly };
      value.assumptions.monthlyContribution = { basis: "context", amount: monthly }; value.intent.extra = { kind, amount: extra }; value.intent.retirementMonth = month;
      value.assumptions.returns = { kind: "confirmed-return", annualPct: rate, basis: "explicit", sensitivity: null };
      value.assumptions.purchasingPower = inflationPct === null ? { kind: "nominal" } : { kind: "today", inflationPct };
      const r = preview(value), i = r.confirmedReturn!, months = r.months;
      const real = (n: number) => inflationPct === null ? n : accumulation.toTodaysDollars(n, Number(inflationPct), months / 12);
      const legacy = { baseline: formatRetirementEstimate(real(i.baseline.balanceAtWithdraw)), scenario: formatRetirementEstimate(real(i.scenario.balanceAtWithdraw)),
        difference: formatRetirementEstimate(real(i.scenario.balanceAtWithdraw - i.baseline.balanceAtWithdraw)) };
      compared++;
      if (JSON.stringify(legacy) !== JSON.stringify(i.display)) crossed.push(`${worth}/${monthly}/${extra}/${kind}/${rate}/${month}/${inflationPct}`);
    }
    expect(compared).toBe(5 * 4 * 4 * 5 * 5 * 4);
    expect(crossed).toEqual([]);
  });
});

// R7: the largest supported calculation must stay a short synchronous task (plan V4: no computation task > 50 ms).
describe("R7 bounded computation cost", () => {
  it("equal assumptions keep independent result objects, including chart points and display values", () => {
    const value = scenario(); value.assumptions.returns = { kind: "confirmed-return", annualPct: "0", basis: "explicit", sensitivity: { lower: "0", base: "0", higher: "0" } };
    const r = preview(value), original = structuredClone(r);
    expect(r.sensitivity).toHaveLength(3);
    const first = r.sensitivity[0];
    if (!first) throw new Error("The confirmed sensitivity cases must be present.");
    first.display.scenario.roundedDollars = -123;
    first.baseline.points[0].balance = -456;
    expect(r.noGrowth).toEqual(original.noGrowth);
    expect(r.confirmedReturn).toEqual(original.confirmedReturn);
    expect(r.sensitivity[1]).toEqual(original.sensitivity[1]);
    expect(r.sensitivity[2]).toEqual(original.sensitivity[2]);
  });
  const worst = (base: string, lower: string, higher: string, inflationPct: string) => {
    const value = retirementContractExamples()[0].input;
    value.context.source.asOf = "2000-02-29"; value.intent.startDate = "2000-02-29"; value.intent.retirementMonth = "2100-02";
    value.context.currentValue = "100000000000000000000"; value.intent.extra = { kind: "monthly", amount: "0.01" };
    value.assumptions.returns = { kind: "confirmed-return", annualPct: base, basis: "explicit", sensitivity: { lower, base, higher } };
    value.assumptions.purchasingPower = { kind: "today", inflationPct };
    return value;
  };
  const supported = (base: string, lower: string, higher: string, inflationPct: string) => {
    const value = worst(base, lower, higher, inflationPct); value.context.currentValue = "10000"; return value;
  };
  // Preserve the original extreme vectors as bounded refusals under the owner's
  // exact rounded-Number policy; also measure full successful 1,200-month work.
  for (const [name, value, outcome] of [
    ["extreme 13-decimal rates", worst("12.3456789012345", "-5.1234567890123", "99.1234567890123", "3.5"), "refused"],
    ["extreme 28-decimal rates", worst("0.0000000000000000000000000001", "-0.0000000000000000000000000001", "0.0000000000000000000000000003", "7.1234567890123"), "refused"],
    ["supported 13-decimal rates", supported("1.2345678901234", "-5.1234567890123", "2.1234567890123", "3.5"), "preview"],
    ["supported 28-decimal rates", supported("0.0000000000000000000000000001", "-0.0000000000000000000000000001", "0.0000000000000000000000000003", "7.1234567890123"), "preview"],
  ] as const) it(`keeps the maximum calculation (1200 months, three sensitivities, ${name}, fractional-year inflation) under 50 ms median`, () => {
    const times: number[] = [];
    for (let i = 0; i < 9; i++) { const start = performance.now(); expect(calculateRetirementScenario(structuredClone(value)).kind).toBe(outcome); times.push(performance.now() - start); }
    times.sort((x, y) => x - y);
    expect(times[4]).toBeLessThan(50);
  });
});

describe("R2 signed recorded worth and tiny supported precision", () => {
  it("handles a negative recorded worth (a loss) with exact independently rounded figures", () => {
    const value = scenario(); value.context.currentValue = "-1050"; value.assumptions.returns = { kind: "no-growth" };
    const r = preview(value);
    // baseline -1050 + 100 = -950 -> step 10; scenario -1050 + 150 = -900; difference +50
    expect(r.noGrowth.display).toEqual({ baseline: { roundedDollars: -950, roundingStepDollars: 10, sign: "negative", lessThanTen: false },
      scenario: { roundedDollars: -900, roundingStepDollars: 10, sign: "negative", lessThanTen: false }, difference: { roundedDollars: 50, roundingStepDollars: 10, sign: "positive", lessThanTen: false } });
  });
  it("refuses an extra amount finer than a cent instead of rounding it away", () => {
    const value = scenario(); value.intent.extra = { kind: "monthly", amount: "0.0000000000000000000000000001" };
    expect(calculateRetirementScenario(value)).toMatchObject({ kind: "refused", code: "invalid-input" });
  });
});
