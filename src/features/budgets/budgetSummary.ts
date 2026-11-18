import { effectiveBudget } from "../../shared/lib/budgetPlan";

/** v9's "Spending against the plan" shows eight categories; the rest are counted in a line under them. */
const PLAN_ROWS_SHOWN = 8;

export type PlanBarRow = { category: string; plan: number; spent: number; over: number };

/** The rows for "Spending against the plan": one per spending category (income is not spending) that has
 * a plan or something spent. The plan is what the month has to spend, the budget plus anything rolled over,
 * and a negative plan reads as none. Overspending comes first, the biggest overspend on top, then the larger
 * plans. `over` is compared in whole cents so float noise can't tip a category that used its plan exactly. */
export function planBarRows(lines: { category: string; budget_group: string; budgeted: string; rollover?: string; actual: string }[]) {
  const all: PlanBarRow[] = lines
    .filter((line) => line.budget_group !== "income")
    .map((line) => {
      const plan = Math.max(0, effectiveBudget(line));
      const spent = parseFloat(line.actual) || 0;
      const over = Math.round(spent * 100) > Math.round(plan * 100) ? spent - plan : 0;
      return { category: line.category, plan, spent, over };
    })
    .filter((row) => row.plan > 0 || row.spent > 0)
    .sort((a, b) => b.over - a.over || b.plan - a.plan || a.category.localeCompare(b.category));
  const rest = all.slice(PLAN_ROWS_SHOWN);
  return {
    rows: all.slice(0, PLAN_ROWS_SHOWN),
    more: rest.length ? { count: rest.length, spent: rest.reduce((sum, r) => sum + r.spent, 0), plan: rest.reduce((sum, r) => sum + r.plan, 0) } : null,
  };
}
