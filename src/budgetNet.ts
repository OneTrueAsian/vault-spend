import type { ReportBudgetLine } from "./types";

/** Budget and Cash Flow amounts are serialized as decimal strings. Keep the
 * monthly summary in integer cents so multiple lines cannot accumulate
 * floating point rounding errors. */
function cents(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error(`Invalid money amount: ${value}`);
  const amount = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0") || "0");
  return match[1] ? -amount : amount;
}

function money(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function budgetNetSummary(
  lines: Pick<ReportBudgetLine, "budget_group" | "budgeted">[],
  actualIncome: string,
  actualExpense: string,
) {
  let plannedIncome = 0n;
  let plannedExpense = 0n;
  for (const line of lines) {
    if (line.budget_group === "income") plannedIncome += cents(line.budgeted);
    else plannedExpense += cents(line.budgeted);
  }
  const income = cents(actualIncome);
  const expense = cents(actualExpense);
  return {
    plannedIncome: money(plannedIncome),
    plannedExpense: money(plannedExpense),
    plannedNet: money(plannedIncome - plannedExpense),
    actualIncome: money(income),
    actualExpense: money(expense),
    actualNet: money(income - expense),
  };
}
