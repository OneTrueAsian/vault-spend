import { expect, it } from "vitest";
import { budgetNetSummary } from "./budgetNet";

it("uses entered budgets and all recorded Cash Flow actuals without rounding drift", () => {
  expect(budgetNetSummary(
    [
      { budget_group: "income", budgeted: "3000.00" },
      { budget_group: "fixed", budgeted: "1200.10" },
      { budget_group: "flexible", budgeted: "400.20" },
    ],
    "2700.30",
    "1700.40",
  )).toEqual({
    plannedIncome: "3000.00",
    plannedExpense: "1600.30",
    plannedNet: "1399.70",
    actualIncome: "2700.30",
    actualExpense: "1700.40",
    actualNet: "999.90",
  });
});

it("shows negative net and works without budget lines", () => {
  expect(budgetNetSummary([], "0", "12.50").actualNet).toBe("-12.50");
  expect(budgetNetSummary([], "0", "0").plannedNet).toBe("0.00");
});
