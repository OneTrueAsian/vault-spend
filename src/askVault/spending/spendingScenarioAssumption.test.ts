import { describe, expect, it } from "vitest";
import { assumptionText } from "./spendingScenarioView";
import type { SpendingScenarioIntent } from "./spendingScenarioContract";

/** D-S3-02 (SR-03): the review says, in words, what the person is assuming: spending $X less. It is not advice and changes no budget. */
const intent = (over: Partial<SpendingScenarioIntent>): SpendingScenarioIntent => ({
  version: 1, category: "Dining", reduction: { kind: "money", amount: "50" }, cadence: "monthly",
  horizon: { kind: "prospective", from: "2026-11-01", to: "2026-12-31" }, partialMonth: "exclude", ...over,
} as SpendingScenarioIntent);
const TAIL = "It is a what-if, not advice, and nothing in your budget changes.";

describe("the assumption sentence on the spending-cut review", () => {
  it("states a monthly money reduction with its category and dates", () => {
    expect(assumptionText(intent({}))).toBe(`This assumes you spend $50.00 less on Dining each month from November 1, 2026 to December 31, 2026. ${TAIL}`);
  });
  it("states a one-time reduction with its date", () => {
    expect(assumptionText(intent({ cadence: "once", horizon: { kind: "prospective", from: "2026-11-15", to: "2026-11-15" }, partialMonth: "none", reduction: { kind: "money", amount: "25.5" } })))
      .toBe(`This assumes you spend $25.50 less on Dining once, on November 15, 2026. ${TAIL}`);
  });
  it("states a percentage as a percentage, never as dollars it has not computed", () => {
    expect(assumptionText(intent({ reduction: { kind: "percent", amount: "10" }, category: "Groceries" })))
      .toBe(`This assumes you spend 10% less on Groceries each month from November 1, 2026 to December 31, 2026. ${TAIL}`);
  });
  it("follows the category and the amount, so editing either changes the sentence", () => {
    expect(assumptionText(intent({ category: "Rent" }))).toContain("on Rent");
    expect(assumptionText(intent({ reduction: { kind: "money", amount: "75" } }))).toContain("$75.00 less");
    expect(assumptionText(intent({ reduction: { kind: "money", amount: "75" } }))).not.toContain("$50.00");
  });
  it("never offers advice, a budget change or an investment", () => {
    const text = assumptionText(intent({}));
    expect(text).not.toMatch(/should|recommend|invest|retire|budget limit|apply/i);
  });
});
