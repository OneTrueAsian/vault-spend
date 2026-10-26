import { describe, expect, it } from "vitest";
import { retirementContractExamples } from "./retirementScenarioContractExamples";
import { calculateRetirementScenario, formatRetirementEstimate, formatRetirementInterval } from "./retirementScenarioMath";
import { retirementMoneyText } from "./retirementScreenContract";

const exact = (numerator: bigint) => ({ numerator, denominator: 1n });
// Owner decision, 20 Oct 2026: the refusal card says what it offers (Close, Change the details) and nothing else.
const REFUSAL_WORDING = "I couldn't calculate a balance accurately with these details. Choose \"Change the details\" to revise them.";

describe("Owner-approved exact rounded Number boundary", () => {
  it.each([100000000000000001000n, -100000000000000001000n])("refuses rounded %s instead of returning a different integer", dollars => {
    expect(() => formatRetirementInterval(exact(dollars), exact(dollars))).toThrow();
  });
  it("also refuses an agreed rounding bracket when its agreed integer is unrepresentable", () => {
    const dollars = 100000000000000001000n;
    expect(() => formatRetirementInterval(exact(dollars - 1n), exact(dollars + 1n))).toThrow();
  });
  it.each([100000000000000000000n, -100000000000000000000n])("preserves representable %s beyond the safe-integer boundary", dollars => {
    const estimate = formatRetirementInterval(exact(dollars), exact(dollars));
    expect(BigInt(estimate.roundedDollars)).toBe(dollars);
    expect(retirementMoneyText(estimate)).toBe(dollars < 0n ? "-$100,000,000,000,000,000,000" : "$100,000,000,000,000,000,000");
  });
  it("refuses finite Number input when decimal rounding cannot survive the result field", () => {
    expect(() => formatRetirementEstimate(Number.MAX_VALUE)).toThrow();
    expect(formatRetirementEstimate(1e20).roundedDollars).toBe(1e20);
  });
  const scenario = () => {
    const value = retirementContractExamples()[0].input;
    value.context.currentValue = "100000000000000000000";
    value.context.contribution = { kind: "saved", monthlyAmount: "0" };
    value.assumptions.monthlyContribution = { basis: "context", amount: "0" };
    value.assumptions.returns = { kind: "no-growth" };
    value.intent.extra = { kind: "monthly", amount: "1000" };
    value.intent.retirementMonth = value.intent.startDate.slice(0, 4) + "-11";
    return value;
  };
  it("returns an explicit refusal when valid monthly inputs produce an unrepresentable rounded balance", () => {
    const value = scenario();
    const result = calculateRetirementScenario(value);
    expect(result).toMatchObject({ kind: "refused", code: "unsupported-number" });
    if (result.kind === "refused") expect(result.message).toBe(REFUSAL_WORDING);
  });
  it("uses the same plain wording when the refusal comes from checking the chosen values before calculating", () => {
    const value = scenario(); value.context.currentValue = "12345678901234567890123";
    const result = calculateRetirementScenario(value);
    expect(result).toMatchObject({ kind: "refused", code: "unsupported-number" });
    if (result.kind === "refused") expect(result.message).toBe(REFUSAL_WORDING);
  });
  it("describes only what the card offers: no promise of exact deposits, no jargon about projections", () => {
    expect(REFUSAL_WORDING).not.toMatch(/finite|supported projection|exact extra deposits|forecast/i);
    expect(REFUSAL_WORDING).toContain("Change the details");
  });
  it("keeps exact extra deposits available under the same inputs without a growth forecast", () => {
    const value = scenario(); value.assumptions.view = "extra-deposits-only";
    value.assumptions.monthlyContribution = null;
    expect(calculateRetirementScenario(value)).toMatchObject({ kind: "extra-deposits-only", months: 1, extraDeposits: "1000.00", growthForecastMade: false });
  });
  it("refuses the whole preview when a sensitivity cannot preserve its rounded balance", () => {
    const value = scenario(); value.intent.extra.amount = "0";
    value.assumptions.returns = { kind: "confirmed-return", annualPct: "0", basis: "explicit", sensitivity: { lower: "-100", base: "0", higher: "100" } };
    expect(calculateRetirementScenario(value)).toMatchObject({ kind: "refused", code: "unsupported-number" });
  });
});
