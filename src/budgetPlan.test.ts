import { describe, expect, it } from "vitest";
import { budgetAllocation, defaultSuggestionSelection, effectiveBudget, monthElapsed, suggestionWindowLabel } from "./budgetPlan";

describe("budgetAllocation", () => {
  it("splits budgeted income from budgeted expenses and reports the unallocated remainder", () => {
    const result = budgetAllocation([
      { budget_group: "income", budgeted: "6400.00" },
      { budget_group: "fixed", budgeted: "2320.00" },
      { budget_group: "flexible", budgeted: "1480.00" },
      { budget_group: "nonmonthly", budgeted: "200.00" },
    ]);

    expect(result).toEqual({ income: 6400, expenses: 4000, unallocated: 2400, status: "unallocated" });
  });

  it("is 'balanced' when every budgeted income dollar is allocated (to the cent)", () => {
    const result = budgetAllocation([
      { budget_group: "income", budgeted: "3000.00" },
      { budget_group: "fixed", budgeted: "1800.00" },
      { budget_group: "flexible", budgeted: "1200.004" },
    ]);

    expect(result?.status).toBe("balanced");
  });

  it("is 'over' when expenses are budgeted past budgeted income", () => {
    const result = budgetAllocation([
      { budget_group: "income", budgeted: "3000.00" },
      { budget_group: "fixed", budgeted: "3500.00" },
    ]);

    expect(result).toEqual({ income: 3000, expenses: 3500, unallocated: -500, status: "over" });
  });

  it("returns null when no income is budgeted — there's nothing to allocate against", () => {
    expect(budgetAllocation([{ budget_group: "fixed", budgeted: "500.00" }])).toBeNull();
    expect(budgetAllocation([])).toBeNull();
  });

  it("sums several income lines", () => {
    const result = budgetAllocation([
      { budget_group: "income", budgeted: "2000.00" },
      { budget_group: "income", budgeted: "1000.00" },
      { budget_group: "fixed", budgeted: "1000.00" },
    ]);

    expect(result?.income).toBe(3000);
    expect(result?.unallocated).toBe(2000);
  });
});

describe("monthElapsed", () => {
  it("is the fraction of the month through today for the current month", () => {
    const result = monthElapsed(2026, 9, new Date(2026, 8, 18));

    expect(result).toEqual({ day: 18, daysInMonth: 30, fraction: 18 / 30 });
  });

  it("is 1 on the last day of the month", () => {
    expect(monthElapsed(2026, 2, new Date(2026, 1, 28))?.fraction).toBe(1);
  });

  it("handles a leap-year February", () => {
    expect(monthElapsed(2028, 2, new Date(2028, 1, 15))).toEqual({ day: 15, daysInMonth: 29, fraction: 15 / 29 });
  });

  it("is null for a past or a future month — there's no 'so far' to mark", () => {
    expect(monthElapsed(2026, 8, new Date(2026, 8, 18))).toBeNull();
    expect(monthElapsed(2026, 10, new Date(2026, 8, 18))).toBeNull();
    expect(monthElapsed(2025, 9, new Date(2026, 8, 18))).toBeNull();
  });
});

describe("defaultSuggestionSelection", () => {
  it("ticks categories with no budget line yet and leaves budgeted ones alone", () => {
    const picked = defaultSuggestionSelection([
      { category: "Groceries", current: null, suggested: "450" },
      { category: "Rent", current: "1500.00", suggested: "1500" },
      { category: "Dining Out", current: null, suggested: "120" },
    ]);

    expect([...picked].sort()).toEqual(["Dining Out", "Groceries"]);
  });

  it("is empty when there is nothing to suggest", () => {
    expect(defaultSuggestionSelection([]).size).toBe(0);
  });
});

describe("suggestionWindowLabel", () => {
  it("words the averaging window, including short histories", () => {
    expect(suggestionWindowLabel(3)).toBe("the last 3 months");
    expect(suggestionWindowLabel(2)).toBe("the last 2 months");
    expect(suggestionWindowLabel(1)).toBe("last month");
  });
});

describe("effectiveBudget", () => {
  it("is just the budget when nothing rolled in", () => {
    expect(effectiveBudget({ budgeted: "400.00", rollover: "0" })).toBe(400);
    expect(effectiveBudget({ budgeted: "400.00" })).toBe(400);
  });

  it("adds what rolled in from earlier months", () => {
    expect(effectiveBudget({ budgeted: "400.00", rollover: "60.50" })).toBe(460.5);
  });

  it("ignores an unreadable rollover rather than poisoning the total", () => {
    expect(effectiveBudget({ budgeted: "400.00", rollover: "" })).toBe(400);
  });
});
