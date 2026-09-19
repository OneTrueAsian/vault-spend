/** Pure budget-planning math for the Budget page — kept out of the
 * component so it can be unit tested without rendering anything. */

export type AllocationStatus = "unallocated" | "balanced" | "over";

export type BudgetAllocation = {
  /** Sum of every budgeted Income line. */
  income: number;
  /** Sum of every budgeted non-income line (fixed, flexible, non-monthly). */
  expenses: number;
  /** `income - expenses` — the part of budgeted income no expense line
   * claims yet; negative means expenses are budgeted past income. */
  unallocated: number;
  status: AllocationStatus;
};

/** How much of the month's budgeted income is spoken for. `null` when no
 * income is budgeted at all — there's nothing to allocate against, and a
 * "you've allocated $0 of $0" line would just be noise. Anything within a
 * cent of zero counts as balanced (budget amounts are entered in cents, but
 * floating point sums aren't exact). */
export function budgetAllocation(lines: { budget_group: string; budgeted: string }[]): BudgetAllocation | null {
  let income = 0;
  let expenses = 0;
  for (const line of lines) {
    const amount = parseFloat(line.budgeted);
    if (Number.isNaN(amount)) continue;
    if (line.budget_group === "income") income += amount;
    else expenses += amount;
  }
  if (income <= 0) return null;
  const unallocated = income - expenses;
  const status: AllocationStatus = Math.abs(unallocated) < 0.005 ? "balanced" : unallocated > 0 ? "unallocated" : "over";
  return { income, expenses, unallocated, status };
}

/** How far through the given month `today` is, for the Budget page's
 * "where you'd be if spending were perfectly even" marker. `null` unless
 * `today` falls in that very month — a past month is already complete and a
 * future one hasn't started, so neither has a meaningful "so far". */
export function monthElapsed(year: number, month: number, today: Date): { day: number; daysInMonth: number; fraction: number } | null {
  if (today.getFullYear() !== year || today.getMonth() + 1 !== month) return null;
  const daysInMonth = new Date(year, month, 0).getDate();
  const day = today.getDate();
  return { day, daysInMonth, fraction: day / daysInMonth };
}

export type SuggestionLine = { category: string; current: string | null; suggested: string };

/** Which suggestion rows start ticked: the categories with no budget line
 * yet. A category that already has one is left alone unless the user opts in,
 * so opening the preview never proposes overwriting a figure they set on
 * purpose. */
export function defaultSuggestionSelection(lines: SuggestionLine[]): Set<string> {
  return new Set(lines.filter((l) => l.current === null).map((l) => l.category));
}

/** "the last 3 months" / "the last 2 months" / "last month" — how far back the
 * averages reach, worded for the dialog's subtitle. */
export function suggestionWindowLabel(monthsUsed: number): string {
  if (monthsUsed <= 1) return "last month";
  return `the last ${monthsUsed} months`;
}

/** What a budget line has to spend this month: its budget plus whatever rolled
 * in unspent from earlier months (see `Store::monthly_budget_actuals`). The
 * planning figures — allocation against income — stay on the plain budget;
 * this is for "how much is left". */
export function effectiveBudget(line: { budgeted: string; rollover?: string }): number {
  const base = parseFloat(line.budgeted) || 0;
  const rolled = parseFloat(line.rollover ?? "0") || 0;
  return base + rolled;
}
