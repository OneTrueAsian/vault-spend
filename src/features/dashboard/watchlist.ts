import type { CategoryAmount, Transaction } from "../../shared/lib/types";
import type { SavedTransactionFilter } from "../../shared/native/appTypes";
import type { WatchKind } from "../../shared/lib/dashboardLayout";
import { matchesTransactionFilter, NO_TRANSACTION_FILTER, savedFilterValues, type TransactionFilterValues } from "../transactions/transactionFilter";

/** A Dashboard watch tile (VS-46): this month's spending so far on one category, tag, store or saved filter,
 * against a usual month, the average of the last 3 full months (owner decision 22 Nov 2026). */
export type WatchTarget = { kind: WatchKind; name: string };
export type WatchTotals = { thisMonth: number; previous: number[] };
export type WatchMonth = { year: number; month: number; from: string; to: string };

export const WATCH_KIND_LABEL: Record<WatchKind, string> = { category: "Category", tag: "Tag", store: "Store", filter: "Saved filter" };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** This month up to `today`, and the 3 full months before it, newest first. */
export function watchMonths(today: Date): { thisMonth: { from: string; to: string }; previous: WatchMonth[] } {
  const previous = [1, 2, 3].map((back) => {
    const first = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const last = new Date(today.getFullYear(), today.getMonth() - back + 1, 0);
    return { year: first.getFullYear(), month: first.getMonth() + 1, from: iso(first), to: iso(last) };
  });
  return { thisMonth: { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) }, previous };
}

/** The average of the earlier months that history fully covers (each starts on or after the first transaction),
 * so a profile started last month is not averaged with empty months. `null` when there is no such month. */
export function usualMonth(previousTotals: number[], months: WatchMonth[], earliestDate: string | null): number | null {
  if (!earliestDate) return null;
  const covered = previousTotals.filter((_, i) => months[i].from >= earliestDate);
  return covered.length === 0 ? null : covered.reduce((a, b) => a + b, 0) / covered.length;
}

/** The Transactions filter a tag, store or saved-filter watch stands for; its "See transactions" link opens the
 * ledger with the same values plus this month's dates. A saved filter's own dates are left out. `null` for a
 * category (counted like Budget, see `categoryWatchTotals`) or a saved filter that no longer exists. */
export function watchFilterValues(target: WatchTarget, savedFilters: SavedTransactionFilter[]): TransactionFilterValues | null {
  if (target.kind === "tag") return { ...NO_TRANSACTION_FILTER, filterTag: target.name };
  if (target.kind === "store") return { ...NO_TRANSACTION_FILTER, searchText: target.name };
  if (target.kind === "filter") {
    const saved = savedFilters.find((f) => f.name === target.name);
    return saved ? { ...savedFilterValues(saved), filterFrom: "", filterTo: "" } : null;
  }
  return null;
}

/** What a watch tile's "See this month's transactions" sets on the Transactions filter bar: the watch's own
 * filter (a category by name) on this month. `null` for a saved filter that no longer exists. */
export function watchLedgerFilter(target: WatchTarget, savedFilters: SavedTransactionFilter[], today: Date): TransactionFilterValues | null {
  const values = target.kind === "category" ? { ...NO_TRANSACTION_FILTER, filterCategory: target.name } : watchFilterValues(target, savedFilters);
  if (!values) return null;
  const { thisMonth } = watchMonths(today);
  return { ...values, filterFrom: thisMonth.from, filterTo: thisMonth.to };
}

/** Money out, leaving out moves between your own accounts. "Exclude from budget" rows still count: they are
 * still spending, only not budgeted. */
function isSpending(t: Transaction): boolean {
  return parseFloat(t.amount) < 0 && t.transfer_counterpart_id === null && t.category !== "Transfer";
}

/** Spending on the rows that match `values`, this month so far and in each earlier month. Summed in cents. */
export function watchTotals(transactions: Transaction[], values: TransactionFilterValues, months: ReturnType<typeof watchMonths>): WatchTotals {
  const spent = (from: string, to: string) =>
    transactions
      .filter((t) => isSpending(t) && matchesTransactionFilter(t, { ...values, filterFrom: from, filterTo: to }))
      .reduce((cents, t) => cents - Math.round(parseFloat(t.amount) * 100), 0) / 100;
  return { thisMonth: spent(months.thisMonth.from, months.thisMonth.to), previous: months.previous.map((m) => spent(m.from, m.to)) };
}

/** A category watch, from the same per-category spending Budget shows (split lines counted by their own category). */
export function categoryWatchTotals(category: string, thisMonth: CategoryAmount[], previous: CategoryAmount[][]): WatchTotals {
  const amount = (rows: CategoryAmount[]) => parseFloat(rows.find((r) => r.category === category)?.amount ?? "0");
  return { thisMonth: amount(thisMonth), previous: previous.map(amount) };
}
