import { describe, expect, it } from "vitest";
import { describeBudgetAlerts, isUsedInFull } from "./budgetAlertText";
import { effectiveBudget } from "./budgetPlan";
import { usedInFull } from "./colourStatus";

const over = (category: string) => ({ category, level: "over" as const });
const close = (category: string) => ({ category, level: "warning" as const });
const used = (category: string) => ({ category, level: "warning" as const, budgeted: "2140.00", actual: "2140.00" });

describe("describeBudgetAlerts", () => {
  it("is empty with no alerts", () => {
    expect(describeBudgetAlerts([])).toBe("");
  });

  it("names one category over its budget", () => {
    expect(describeBudgetAlerts([over("Dining")])).toBe("Dining is over its budget");
  });

  it("names one category close to its budget", () => {
    expect(describeBudgetAlerts([close("Groceries")])).toBe("Groceries is close to its budget");
  });

  it("names two categories over their budgets", () => {
    expect(describeBudgetAlerts([over("Dining"), over("Fuel")])).toBe("Dining and Fuel are over their budgets");
  });

  it("names two categories close to their budgets", () => {
    expect(describeBudgetAlerts([close("Groceries"), close("Fuel")])).toBe("Groceries and Fuel are close to their budgets");
  });

  it("names at most two of a kind, then says how many more", () => {
    expect(describeBudgetAlerts([over("Dining"), close("Groceries"), close("Fuel"), close("Gifts"), close("Pets")])).toBe(
      "Dining is over its budget; Groceries, Fuel and 2 more are close to theirs",
    );
  });

  it("counts one more as '1 more'", () => {
    expect(describeBudgetAlerts([over("Dining"), over("Fuel"), over("Gifts")])).toBe("Dining, Fuel and 1 more are over their budgets");
  });

  it("puts over-budget categories first whatever order they arrive in", () => {
    expect(describeBudgetAlerts([close("Groceries"), over("Dining")])).toBe(
      "Dining is over its budget; Groceries is close to its budget",
    );
  });

  it("says 'theirs' after the over-budget part when several are close", () => {
    expect(describeBudgetAlerts([over("Dining"), over("Fuel"), close("Groceries"), close("Pets")])).toBe(
      "Dining and Fuel are over their budgets; Groceries and Pets are close to theirs",
    );
  });

  it("says a budget used exactly in full has been used, not that it is close", () => {
    expect(describeBudgetAlerts([used("Mortgage")])).toBe("Mortgage has used its whole budget");
    expect(describeBudgetAlerts([used("Mortgage"), used("Phone")])).toBe("Mortgage and Phone have used their whole budgets");
  });

  it("still calls a warning with its amounts close when it isn't at 100%", () => {
    expect(describeBudgetAlerts([{ category: "Groceries", level: "warning", budgeted: "800.00", actual: "700.00" }])).toBe(
      "Groceries is close to its budget",
    );
  });

  it("puts used-in-full last, after over and close", () => {
    expect(describeBudgetAlerts([used("Mortgage"), close("Groceries"), over("Dining")])).toBe(
      "Dining is over its budget; Groceries is close to its budget; Mortgage has used its whole budget",
    );
    expect(describeBudgetAlerts([over("Dining"), used("Mortgage"), used("Phone"), used("Gym")])).toBe(
      "Dining is over its budget; Mortgage, Phone and 1 more have used all of theirs",
    );
  });

  it("counts rollover in what the month had, as the backend's alert does", () => {
    // Store::budget_alerts_for_month sends budgeted = budget + rollover.
    expect(describeBudgetAlerts([{ category: "Gifts", level: "warning", budgeted: "400.00", actual: "400.00" }])).toBe(
      "Gifts has used its whole budget",
    );
    expect(describeBudgetAlerts([{ category: "Gifts", level: "warning", budgeted: "500.00", actual: "400.00" }])).toBe(
      "Gifts is close to its budget",
    );
  });
});

// The Dashboard banner reads the alert; the Budget row reads its own line. Both must agree.
describe("used in full: banner and Budget row agree", () => {
  const cases = [
    { budgeted: "400.00", rollover: "0", actual: "400.00" },
    { budgeted: "300.00", rollover: "100.00", actual: "400.00" },
    { budgeted: "300.10", rollover: "99.90", actual: "400.00" },
    { budgeted: "400.00", rollover: "100.00", actual: "400.00" },
    { budgeted: "400.00", rollover: "0", actual: "399.99" },
  ];
  for (const line of cases) {
    it(`agrees for budget ${line.budgeted} + rollover ${line.rollover}, spent ${line.actual}`, () => {
      // How the backend builds the alert: budgeted is the budget plus rollover (see budgets.rs).
      const alert = {
        category: "Gifts",
        level: "warning" as const,
        budgeted: (parseFloat(line.budgeted) + parseFloat(line.rollover)).toFixed(2),
        actual: line.actual,
      };
      expect(isUsedInFull(alert)).toBe(usedInFull(effectiveBudget(line), line.actual));
    });
  }
});
