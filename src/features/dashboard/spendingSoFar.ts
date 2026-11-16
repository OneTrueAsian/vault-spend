/** The numbers behind the Dashboard's "Spending in <month> so far" card (VS-31, after v9's Home).
 * This month's rows are the backend's own `spendingThisMonth`, so they match what the old donut showed.
 * The same days last month are worked out from the transaction list with the backend's rules for what
 * counts as spending: money out, with a category, that is not a Transfer or one leg of a linked transfer. */
import type { CategoryAmount, Recurring, Transaction } from "../../shared/lib/types";

export const EVERYTHING_ELSE_KEY = "__everything_else__";

/** v9 shows eight rows: seven categories, then everything smaller folded into one. */
const ROWS_SHOWN = 8;

export type SpendingRow = { key: string; label: string; amount: number; previous: number };

export type BiggestOneOff = { description: string; amount: number; date: string; category: string | null };

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (year: number, monthIndex: number, day: number) => `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
const shortMonth = (year: number, monthIndex: number) => new Date(year, monthIndex, 1).toLocaleDateString("en-US", { month: "short" });

function countsAsSpending(t: Transaction): boolean {
  return parseFloat(t.amount) < 0 && t.category !== null && t.category !== "Transfer" && t.transfer_counterpart_id === null;
}

export function spendingSoFar({ spendingThisMonth, transactions, today }: { spendingThisMonth: CategoryAmount[]; transactions: Transaction[]; today: Date }) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
  const previousYear = month === 0 ? year - 1 : year;
  const previousMonth = (month + 11) % 12;
  const previousEndDay = Math.min(day, new Date(year, month, 0).getDate());
  const from = isoDate(previousYear, previousMonth, 1);
  const to = isoDate(previousYear, previousMonth, previousEndDay);

  const before = new Map<string, number>();
  for (const t of transactions) {
    if (t.date < from || t.date > to || !countsAsSpending(t)) continue;
    before.set(t.category!, (before.get(t.category!) ?? 0) - parseFloat(t.amount));
  }

  const rows: SpendingRow[] = spendingThisMonth
    .map((c) => ({ key: c.category, label: c.category, amount: parseFloat(c.amount), previous: before.get(c.category) ?? 0 }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));

  return {
    title: `Spending in ${today.toLocaleDateString("en-US", { month: "long", year: "numeric" })} so far`,
    subtitle: `${shortMonth(year, month)} 1\u2013${day}, largest first. The change is against ${shortMonth(previousYear, previousMonth)} 1\u2013${previousEndDay}.`,
    rows,
    total: rows.reduce((sum, r) => sum + r.amount, 0),
  };
}

/** Past eight rows, everything from the seventh down becomes one "Everything else (n)" row. */
export function foldSmallest(rows: SpendingRow[]): SpendingRow[] {
  if (rows.length <= ROWS_SHOWN) return rows;
  const rest = rows.slice(ROWS_SHOWN - 1);
  return [
    ...rows.slice(0, ROWS_SHOWN - 1),
    {
      key: EVERYTHING_ELSE_KEY,
      label: `Everything else (${rest.length})`,
      amount: rest.reduce((sum, r) => sum + r.amount, 0),
      previous: rest.reduce((sum, r) => sum + r.previous, 0),
    },
  ];
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The largest single charge so far this month that is not one of the bills you pay every month. */
export function biggestOneOff({ transactions, recurring, today }: { transactions: Transaction[]; recurring: Recurring[]; today: Date }): BiggestOneOff | null {
  const from = isoDate(today.getFullYear(), today.getMonth(), 1);
  const to = isoDate(today.getFullYear(), today.getMonth(), today.getDate());
  const bills = recurring.filter((r) => r.status !== "canceled").map((r) => normalize(r.merchant)).filter(Boolean);
  let best: Transaction | null = null;
  for (const t of transactions) {
    if (t.date < from || t.date > to || parseFloat(t.amount) >= 0 || t.category === "Transfer" || t.transfer_counterpart_id !== null) continue;
    const name = normalize(t.description);
    if (bills.some((b) => name.includes(b))) continue;
    if (!best || parseFloat(t.amount) < parseFloat(best.amount)) best = t;
  }
  return best && { description: best.description, amount: -parseFloat(best.amount), date: best.date, category: best.category };
}
