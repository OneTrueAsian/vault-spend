import { isIncomeTransaction } from "../../shared/lib/accountGroups";
import type { Account, Transaction } from "../../shared/lib/types";

export type SavingsRatePoint = { month: string; label: string; value: number; partial: boolean };

/** Savings rate, (income - expenses) / income as a percentage, for each month in
 * `months` that has at least one transaction. Income uses `isIncomeTransaction`
 * (the rule Cash Flow's own income figure uses); an expense is any negative amount
 * except "Transfer" (money moving between the household's own accounts). The
 * `currentMonth` point, still in progress, is marked partial and labelled "so far". */
export function savingsRateByMonth(transactions: Transaction[], accounts: Account[], months: string[], currentMonth: string): SavingsRatePoint[] {
  const monthly = new Map<string, { income: number; expense: number }>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    if (!months.includes(month)) continue;
    const entry = monthly.get(month) ?? { income: 0, expense: 0 };
    const amount = parseFloat(t.amount);
    if (isIncomeTransaction(t, accounts)) entry.income += amount;
    else if (amount < 0 && t.category !== "Transfer") entry.expense += Math.abs(amount);
    monthly.set(month, entry);
  }
  return months
    .filter((month) => monthly.has(month))
    .map((month) => {
      const { income, expense } = monthly.get(month)!;
      const short = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" });
      const partial = month === currentMonth;
      return { month, label: partial ? `${short} so far` : short, value: income > 0 ? ((income - expense) / income) * 100 : 0, partial };
    });
}
