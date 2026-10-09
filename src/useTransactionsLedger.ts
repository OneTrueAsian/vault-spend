import { useEffect, useMemo, useState } from "react";
import { transactionPerf } from "./transactionPerf";
import { useLedgerFilters } from "./useLedgerFilters";
import { matchesPaymentAccount } from "./paymentDiscovery";
import { compareTransactionsBy } from "./ledgerHelpers";
import { canLinkAsTransfer, collapseTransferPairs } from "./transfers";
import { transactionsInRows } from "./ledgerPaging";
import { canSelectMore, isBatchSelected, selectAllNext, selectAllNote, unselectBatch, type SelectAllBatch } from "./ledgerSelection";
import { UNCATEGORIZED_FILTER, type LedgerSortColumn } from "./appTypes";
import type { Transaction } from "./types";

/** Owns ledger query/paging/selection. Shared transaction reads and mutation orchestration
 * remain in the shell until subsequent M/O slices. Saved-filter persistence is delegated
 * to useLedgerFilters; this controller performs no transaction mutations. */
export function useTransactionsLedger({ transactions, pendingPaymentId, onSelectionLimit, active = true }: {
  transactions: Transaction[];
  pendingPaymentId: number | null;
  onSelectionLimit: () => void;
  active?: boolean;
}) {
  const {
    searchText,
    setSearchText,
    filterCategory,
    setFilterCategory,
    filterAccountIds,
    setFilterAccountIds,
    filterMemberIds,
    setFilterMemberIds,
    filterFrom,
    setFilterFrom,
    filterTo,
    setFilterTo,
    filterTag,
    setFilterTag,
    savedFilters,
    savingFilter,
    setSavingFilter,
    newFilterName,
    setNewFilterName,
    saveCurrentFilter,
    applySavedFilter,
    deleteSavedFilter,
  } = useLedgerFilters();
  const [sortColumn, setSortColumn] = useState<LedgerSortColumn>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [pageSize, setPageSize] = useState(50);
  // How many matching rows the ledger shows; "Show N more" adds a step (see ledgerPaging.ts).
  const [shownCount, setShownCount] = useState(50);
  // The current Select all batch (see ledgerSelection.ts), and the note it leaves when capped.
  const [selectAllBatch, setSelectAllBatch] = useState<SelectAllBatch | null>(null);
  const [selectAllMessage, setSelectAllMessage] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Preserve the existing client-side query contract; backend paging remains conditional on F profiling.
  const filteredTransactions = useMemo(
    () =>
      transactionPerf("filter", () => (active ? transactions : []).filter((t) => {
        if (searchText.trim() && !t.description.toLowerCase().includes(searchText.trim().toLowerCase())) {
          return false;
        }
        if (filterCategory === UNCATEGORIZED_FILTER) {
          if (t.category) return false;
        } else if (filterCategory !== "all" && t.category !== filterCategory) {
          return false;
        }
        if (!matchesPaymentAccount(t, filterAccountIds)) return false;
        if (filterMemberIds !== "all" && (t.member_id === null || !filterMemberIds.has(t.member_id))) return false;
        if (filterFrom && t.date < filterFrom) return false;
        if (filterTo && t.date > filterTo) return false;
        if (filterTag !== "all" && !t.tags.includes(filterTag)) return false;
        return true;
      })),
    [active, transactions, searchText, filterCategory, filterAccountIds, filterMemberIds, filterFrom, filterTo, filterTag],
  );

  // The backend returns transactions in insertion order, not date order —
  // sorting is client-side too, same reasoning as filtering above.
  const sortedTransactions = useMemo(
    () =>
      transactionPerf("sort", () => [...filteredTransactions].sort((a, b) => {
        const cmp = compareTransactionsBy(a, b, sortColumn);
        return sortDirection === "asc" ? cmp : -cmp;
      })),
    [filteredTransactions, sortColumn, sortDirection],
  );

  function toggleSort(column: LedgerSortColumn) {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  // A linked transfer shows as one row, not two — see `collapseTransferPairs`.
  // Done after filtering and sorting so it only ever merges legs that are
  // both actually on screen, and before paging so page sizes stay honest.
  const { rows: displayTransactions, inLegByOutId } = useMemo(() => transactionPerf("transfer-collapse", () => collapseTransferPairs(sortedTransactions)), [sortedTransactions]);
  const pagedTransactions = displayTransactions.slice(0, shownCount);
  // The count under the table is in transactions, like the selection: a merged transfer row is two.
  const shownTransactions = transactionsInRows(
    displayTransactions.map((t) => (inLegByOutId.has(t.id) ? 2 : 1)),
    shownCount,
  );

  // Exactly two rows ticked that could be the two legs of one transfer.
  const selectedPairForLink = useMemo(() => {
    if (selectedIds.size !== 2) return null;
    const [a, b] = Array.from(selectedIds).map((id) => transactions.find((t) => t.id === id));
    return a && b && canLinkAsTransfer(a, b) ? [a, b] : null;
  }, [selectedIds, transactions]);
  const selectedAccountNames = useMemo(
    () => selectedIds.size ? [...new Set(transactions.filter((t) => selectedIds.has(t.id)).map((t) => t.account_name))].sort() : [],
    [selectedIds, transactions],
  );
  // A new filter, search, sort or step starts over: the first step of rows, and fresh Select all batches.
  useEffect(() => {
    if (pendingPaymentId === null) setShownCount(pageSize);
    setSelectAllBatch(null);
    setSelectAllMessage(null);
    // Pending navigation owns how many rows show during the explicit filter reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, filterCategory, filterAccountIds, filterMemberIds, filterFrom, filterTo, filterTag, pageSize, sortColumn, sortDirection]);

  // The Select all note only describes a selection that is still there.
  useEffect(() => {
    if (selectedIds.size === 0) setSelectAllMessage(null);
  }, [selectedIds]);

  function toggleSelectedMany(ids: number[]) {
    const adding = ids.filter((id) => !selectedIds.has(id)).length;
    if (adding > 0 && !canSelectMore(selectedIds, adding)) {
      onSelectionLimit();
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (ids.every((id) => next.has(id))) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleSelected(id: number) {
    if (!selectedIds.has(id) && !canSelectMore(selectedIds, 1)) {
      onSelectionLimit();
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (isBatchSelected(selectAllBatch, selectedIds)) {
      setSelectedIds(new Set());
      setSelectAllBatch((batch) => (batch ? unselectBatch(batch) : batch));
      return;
    }
    // Every matching row, not just those shown; a merged transfer row stands for two transactions.
    const rows = displayTransactions.map((t) => {
      const inLeg = inLegByOutId.get(t.id);
      return inLeg ? [t.id, inLeg.id] : [t.id];
    });
    const result = selectAllNext(rows, selectedIds, selectAllBatch);
    setSelectedIds(result.selected);
    setSelectAllBatch(result.batch);
    setSelectAllMessage(selectAllNote(result));
  }


  return {
    searchText,
    setSearchText,
    filterCategory,
    setFilterCategory,
    filterAccountIds,
    setFilterAccountIds,
    filterMemberIds,
    setFilterMemberIds,
    filterFrom,
    setFilterFrom,
    filterTo,
    setFilterTo,
    filterTag,
    setFilterTag,
    savedFilters,
    savingFilter,
    setSavingFilter,
    newFilterName,
    setNewFilterName,
    saveCurrentFilter,
    applySavedFilter,
    deleteSavedFilter,
    sortColumn,
    setSortColumn,
    sortDirection,
    setSortDirection,
    pageSize,
    setPageSize,
    shownCount,
    setShownCount,
    selectAllBatch,
    selectAllMessage,
    selectedIds,
    setSelectedIds,
    filteredTransactions,
    sortedTransactions,
    displayTransactions,
    inLegByOutId,
    pagedTransactions,
    shownTransactions,
    selectedPairForLink,
    selectedAccountNames,
    toggleSort,
    toggleSelectedMany,
    toggleSelected,
    toggleSelectAll,
  };
}
