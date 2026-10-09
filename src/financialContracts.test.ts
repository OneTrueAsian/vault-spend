import { expect, it } from "vitest";
import { validateBudgetSnapshot, validateReportSnapshot } from "./financialContracts";
import line from "../core/tests/fixtures/budget_line.json";

const common = { contractVersion: 1, context: { contractVersion: 1, generation: 2, sessionRevision: 7 }, revision: { local: 4, external: 1 } };
const flow = { months: [{ year: 2026, month: 10, month_label: "Oct '26", income: "0", expense: "12.34" }], top_categories: [], top_merchants: [], total_income: "0", total_expense: "12.34" };
const budget = { ...common, year: 2026, month: 10, actuals: [line], alerts: [], flow, members: [{ category: "Fixture", budget_group: "flexible", budgeted: line.budgeted, member_id: null, member_name: null, actual: "12.34" }] };
const report = { ...common, fromYear: 2026, fromMonth: 10, toYear: 2026, toMonth: 10, cells: [{ month: "2026-10", category: "Fixture", amount: "12.34" }], flow, daily: [{ date: "2026-10-01", amount: "12.34" }] };
it("preserves exact decimal strings and explicit nulls in both aggregate contracts", () => {
  expect(validateBudgetSnapshot(budget)).toBe(budget);
  expect(validateReportSnapshot(report)).toBe(report);
});
it("rejects malformed money, missing nulls, versions and unsafe session counters", () => {
  for (const changed of [{ ...budget, actuals: [{ ...line, actual: 12.34 }] }, { ...budget, members: [{ ...budget.members[0], member_id: undefined }] }, { ...budget, contractVersion: 2 }, { ...budget, context: { ...common.context, sessionRevision: Number.MAX_SAFE_INTEGER + 1 } }]) expect(() => validateBudgetSnapshot(changed)).toThrow();
});
it("rejects invalid or inconsistent periods and out-of-range response rows", () => {
  for (const changed of [{ ...budget, month: 13 }, { ...budget, flow: { ...flow, months: [{ ...flow.months[0], month: 9 }] } }]) expect(() => validateBudgetSnapshot(changed)).toThrow();
  for (const changed of [{ ...report, toMonth: 9 }, { ...report, daily: [{ date: "2026-02-30", amount: "1" }] }, { ...report, cells: [{ month: "2026-09", category: "Fixture", amount: "1" }] }]) expect(() => validateReportSnapshot(changed)).toThrow();
});
