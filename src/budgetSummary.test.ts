import { describe, expect, it } from "vitest";
import { groupProgressLabel } from "./budgetSummary";

describe("groupProgressLabel", () => {
  it("says how much income has come in against the plan", () => {
    expect(groupProgressLabel("income", 2450, 8200)).toBe("$2,450.00 of $8,200.00 received");
  });

  it("says how much of an expense group's budget is used", () => {
    expect(groupProgressLabel("fixed", 2300, 3607)).toBe("$2,300.00 of $3,607.00 · 64% used");
  });

  it("calls exactly 100% on target", () => {
    expect(groupProgressLabel("flexible", 500, 500)).toBe("$500.00 of $500.00 · On target");
  });

  it("calls anything past 100% over budget", () => {
    expect(groupProgressLabel("flexible", 612.5, 500)).toBe("$612.50 of $500.00 · Over budget");
  });

  it("never prints NaN% when nothing is budgeted", () => {
    const label = groupProgressLabel("nonmonthly", 40, 0);
    expect(label).toBe("$40.00 spent, no budget set");
    expect(label).not.toContain("NaN");
  });

  it("says what came in when no income is budgeted", () => {
    expect(groupProgressLabel("income", 40, 0)).toBe("$40.00 received, no budget set");
  });

  it("rounds the percentage to a whole number", () => {
    expect(groupProgressLabel("fixed", 1, 3)).toBe("$1.00 of $3.00 · 33% used");
  });
});
