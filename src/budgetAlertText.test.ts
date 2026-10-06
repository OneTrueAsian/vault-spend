import { describe, expect, it } from "vitest";
import { describeBudgetAlerts } from "./budgetAlertText";

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
});
