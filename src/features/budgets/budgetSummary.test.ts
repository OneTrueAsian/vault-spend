import { describe, expect, it } from "vitest";
import { planBarRows } from "./budgetSummary";

describe("planBarRows", () => {
  const l = (category: string, budgeted: string, actual: string, over: Partial<{ budget_group: string; rollover: string }> = {}) => ({
    category,
    budget_group: "flexible",
    budgeted,
    actual,
    rollover: "0",
    ...over,
  });

  it("leaves income out and keeps a line that has a plan or spending, never one with neither", () => {
    const { rows } = planBarRows([l("Paycheck", "5000.00", "4000.00", { budget_group: "income" }), l("Groceries", "400.00", "100.00"), l("Gifts", "0.00", "25.00"), l("Idle", "0.00", "0.00")]);
    expect(rows.map((r) => r.category)).toEqual(["Gifts", "Groceries"]);
  });

  it("lists overspending first, the biggest overspend on top, then the larger plans", () => {
    const { rows } = planBarRows([l("Small plan", "100.00", "10.00"), l("Big plan", "900.00", "10.00"), l("Over a bit", "50.00", "60.00"), l("Over a lot", "100.00", "1340.00")]);
    expect(rows.map((r) => r.category)).toEqual(["Over a lot", "Over a bit", "Big plan", "Small plan"]);
    expect(rows[0]).toMatchObject({ plan: 100, spent: 1340, over: 1240 });
  });

  it("plans with what the month has to spend: the budget plus anything rolled over", () => {
    const { rows } = planBarRows([l("Groceries", "400.00", "450.00", { rollover: "75.50" })]);
    expect(rows[0]).toMatchObject({ plan: 475.5, spent: 450, over: 0 });
  });

  it("treats spending equal to the plan as not over, even with floating point noise", () => {
    const { rows } = planBarRows([l("Groceries", "0.30", "0.30")]);
    expect(rows[0].over).toBe(0);
  });

  it("reads a negative plan as no plan, so everything spent is over", () => {
    const { rows } = planBarRows([l("Odd", "-50.00", "80.00")]);
    expect(rows[0]).toMatchObject({ plan: 0, spent: 80, over: 80 });
  });

  it("keeps a category that is all refunds, with its negative figure", () => {
    const { rows } = planBarRows([l("Returns", "100.00", "-40.00")]);
    expect(rows[0]).toMatchObject({ plan: 100, spent: -40, over: 0 });
  });

  it("shows eight rows and counts what is left out", () => {
    const lines = Array.from({ length: 11 }, (_, i) => l(`Cat${i}`, String(1000 - i * 10) + ".00", "10.00"));
    const { rows, more } = planBarRows(lines);
    expect(rows).toHaveLength(8);
    expect(more).toEqual({ count: 3, spent: 30, plan: 2730 });
  });

  it("has no 'more' note when everything fits", () => {
    expect(planBarRows([l("Groceries", "400.00", "100.00")]).more).toBeNull();
  });
});
