import { matchesPaymentAccount } from "./paymentDiscovery";
import { UNCATEGORIZED_FILTER, type SavedTransactionFilter } from "../../shared/native/appTypes";
import type { Transaction } from "../../shared/lib/types";

/** The Transactions filter bar's values. The ledger and the Dashboard's watch tiles (VS-46) both test rows with
 * `matchesTransactionFilter`, so a tile's total is made of exactly the rows its "See transactions" link shows. */
export type TransactionFilterValues = {
  searchText: string;
  filterCategory: string;
  filterAccountIds: "all" | ReadonlySet<number>;
  filterMemberIds: "all" | ReadonlySet<number>;
  filterFrom: string;
  filterTo: string;
  filterTag: string;
};

export const NO_TRANSACTION_FILTER: TransactionFilterValues = {
  searchText: "",
  filterCategory: "all",
  filterAccountIds: "all",
  filterMemberIds: "all",
  filterFrom: "",
  filterTo: "",
  filterTag: "all",
};

export function matchesTransactionFilter(t: Transaction, f: TransactionFilterValues): boolean {
  if (f.searchText.trim() && !t.description.toLowerCase().includes(f.searchText.trim().toLowerCase())) {
    return false;
  }
  if (f.filterCategory === UNCATEGORIZED_FILTER) {
    if (t.category) return false;
  } else if (f.filterCategory !== "all" && t.category !== f.filterCategory) {
    return false;
  }
  if (!matchesPaymentAccount(t, f.filterAccountIds)) return false;
  if (f.filterMemberIds !== "all" && (t.member_id === null || !f.filterMemberIds.has(t.member_id))) return false;
  if (f.filterFrom && t.date < f.filterFrom) return false;
  if (f.filterTo && t.date > f.filterTo) return false;
  if (f.filterTag !== "all" && !t.tags.includes(f.filterTag)) return false;
  return true;
}

/** A saved filter's values, with its stored account and member lists back as sets. */
export function savedFilterValues(f: SavedTransactionFilter): TransactionFilterValues {
  return {
    searchText: f.searchText,
    filterCategory: f.filterCategory,
    filterAccountIds: f.filterAccountIds === "all" ? "all" : new Set(f.filterAccountIds),
    filterMemberIds: f.filterMemberIds === "all" ? "all" : new Set(f.filterMemberIds),
    filterFrom: f.filterFrom,
    filterTo: f.filterTo,
    filterTag: f.filterTag,
  };
}
