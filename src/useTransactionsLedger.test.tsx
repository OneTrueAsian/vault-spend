// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTransactionsLedger } from "./useTransactionsLedger";
import type { Transaction } from "./types";
import { UNCATEGORIZED_FILTER } from "./appTypes";
import { saveSavedFilters } from "./appStorage";

vi.mock("./appStorage", () => ({ loadSavedFilters: vi.fn(async () => []), saveSavedFilters: vi.fn() }));
vi.mock("./profileUiState", () => ({ ensureUiStateMigrated: vi.fn(async () => {}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function row(id: number, overrides: Partial<Transaction> = {}): Transaction {
  return { id, account_id: 1, account_name: "Checking", date: "2026-10-01", description: `Purchase ${id}`,
    amount: "-5.00", category: "Food", category_source: "user", confidence: null,
    transfer_counterpart_id: null, applied_to_debt: null, principal_amount: null, split_count: 0,
    tags: [], member_id: null, member_name: null, notes: null, ...overrides };
}
let root: Root;
let ledger: ReturnType<typeof useTransactionsLedger>;
let transactions: Transaction[];
let pendingPaymentId: number | null;
let active: boolean;
const selectionLimit = vi.fn();
function Harness() { ledger = useTransactionsLedger({ transactions, pendingPaymentId, active, onSelectionLimit: selectionLimit }); return null; }
async function render() { await act(async () => { root.render(<Harness />); }); }
beforeEach(async () => {
  vi.clearAllMocks(); transactions = []; pendingPaymentId = null; active = true;
  root = createRoot(document.createElement("div")); await render();
});
afterEach(() => { act(() => root.unmount()); });

it("skips inactive ledger work and restores its saved query and selection on entry", async () => {
  transactions = [row(1), row(2, { description: "Other" })]; await render();
  act(() => { ledger.setSearchText("Purchase"); ledger.toggleSelected(1); });
  const description = vi.fn(() => "Purchase 1");
  transactions = [{ ...row(1), get description() { return description(); } }, row(2, { description: "Other" })];
  active = false; await render();
  expect(description).not.toHaveBeenCalled(); expect(ledger.displayTransactions).toEqual([]);
  expect([...ledger.selectedIds]).toEqual([1]); expect(ledger.searchText).toBe("Purchase");
  active = true; await render(); expect(description).toHaveBeenCalled(); expect(ledger.displayTransactions.map(t => t.id)).toEqual([1]);
});

it("preserves description-only search and inclusive category/account/member/date/tag filters", async () => {
  transactions = [row(1, { description: "Coffee Shop", category: null, member_id: 3, tags: ["work"],
    applied_to_debt: { date: "2026-10-01", debt_account_id: 9, debt_account_name: "Card", amount: "5.00" } }),
    row(2, { notes: "Coffee Shop" }), row(3, { description: "Coffee Shop", date: "2026-10-02" })];
  await render();
  act(() => { ledger.setSearchText(" COFFEE "); ledger.setFilterCategory(UNCATEGORIZED_FILTER);
    ledger.setFilterAccountIds(new Set([9])); ledger.setFilterMemberIds(new Set([3]));
    ledger.setFilterFrom("2026-10-01"); ledger.setFilterTo("2026-10-01"); ledger.setFilterTag("work"); });
  expect(ledger.filteredTransactions.map(t => t.id)).toEqual([1]);
  act(() => { ledger.setFilterMemberIds(new Set([4])); });
  expect(ledger.filteredTransactions).toEqual([]);
});

it("sorts before collapsing transfers and pages display rows without losing exportable legs", async () => {
  transactions = [row(1, { transfer_counterpart_id: 2, amount: "-10.00", date: "2026-10-03" }),
    row(2, { transfer_counterpart_id: 1, account_id: 2, amount: "10.00", date: "2026-10-03" }),
    row(3, { date: "2026-10-02" })]; await render();
  act(() => { ledger.setPageSize(1); });
  expect(ledger.pagedTransactions.map(t => t.id)).toEqual([1]);
  expect(ledger.shownTransactions).toEqual({ shown: 2, total: 3 });
  expect(ledger.sortedTransactions.map(t => t.id)).toEqual([1, 2, 3]);
  act(() => { ledger.setShownCount(count => count + ledger.pageSize); });
  expect(ledger.pagedTransactions.map(t => t.id)).toEqual([1, 3]);
  act(() => { ledger.setFilterAccountIds(new Set([2])); });
  expect(ledger.displayTransactions.map(t => t.id)).toEqual([2]);
  expect(ledger.inLegByOutId.size).toBe(0);
});

it("selects matching rows beyond the visible page, caps whole transfer pairs, and advances applied batches", async () => {
  transactions = Array.from({ length: 251 }, (_, i) => row(i + 1)); await render();
  expect(ledger.pagedTransactions).toHaveLength(50);
  act(() => { ledger.toggleSelectAll(); });
  expect(ledger.selectedIds.size).toBe(250);
  expect(ledger.selectAllMessage).toContain("251");
  act(() => { ledger.toggleSelected(251); });
  expect(selectionLimit).toHaveBeenCalledOnce(); expect(ledger.selectedIds.size).toBe(250);
  act(() => { ledger.setSelectedIds(new Set()); });
  expect(ledger.selectAllMessage).toBeNull();
  act(() => { ledger.toggleSelectAll(); });
  expect([...ledger.selectedIds]).toEqual([251]);
  expect(ledger.selectAllMessage).toContain("250 done");
});

it("unticking Select all does not mark the batch applied and filter/sort changes reset paging and batch history", async () => {
  transactions = Array.from({ length: 251 }, (_, i) => row(i + 1)); await render();
  act(() => { ledger.toggleSelectAll(); }); act(() => { ledger.toggleSelectAll(); });
  expect(ledger.selectedIds.size).toBe(0);
  act(() => { ledger.toggleSelectAll(); }); expect(ledger.selectedIds.size).toBe(250);
  act(() => { ledger.setShownCount(150); ledger.toggleSort("description"); });
  expect(ledger.shownCount).toBe(50); expect(ledger.selectAllBatch).toBeNull();
  expect(ledger.selectedIds.size).toBe(250); // Existing behavior retains manually selected IDs.
  expect(ledger.sortDirection).toBe("asc");
  act(() => { ledger.toggleSort("description"); }); expect(ledger.sortDirection).toBe("desc");
});

it("selects both transfer legs together and preserves explicit payment-navigation paging", async () => {
  transactions = [row(1, { transfer_counterpart_id: 2, amount: "-10.00" }),
    row(2, { transfer_counterpart_id: 1, account_id: 2, account_name: "Savings", amount: "10.00" })]; await render();
  act(() => { ledger.toggleSelectedMany([1, 2]); });
  expect([...ledger.selectedIds]).toEqual([1, 2]);
  expect(ledger.selectedPairForLink).toBeNull(); // Already linked pairs cannot be linked again.
  expect(ledger.selectedAccountNames).toEqual(["Checking", "Savings"]);
  transactions = transactions.map(t => ({ ...t, transfer_counterpart_id: null })); await render();
  expect(ledger.selectedPairForLink?.map(t => t.id)).toEqual([1, 2]);
  pendingPaymentId = 1; await render();
  act(() => { ledger.setShownCount(150); ledger.setSearchText("Purchase"); });
  expect(ledger.shownCount).toBe(150);
  pendingPaymentId = null; await render(); expect(ledger.shownCount).toBe(150);
  act(() => { ledger.setSearchText(""); }); expect(ledger.shownCount).toBe(50);
});

it("never splits a merged transfer across the Select all cap", async () => {
  transactions = [...Array.from({ length: 249 }, (_, i) => row(i + 1)),
    row(250, { transfer_counterpart_id: 251, amount: "-10.00" }),
    row(251, { transfer_counterpart_id: 250, account_id: 2, amount: "10.00" }), row(252)];
  await render(); act(() => { ledger.toggleSelectAll(); });
  expect(ledger.selectedIds.size).toBe(249);
  expect(ledger.selectedIds.has(250)).toBe(false); expect(ledger.selectedIds.has(251)).toBe(false);
});

it("saves and reapplies filter snapshots and resets transient state on profile remount", async () => {
  transactions = [row(1)]; await render();
  act(() => { ledger.setSearchText("Purchase"); ledger.setNewFilterName("My filter"); });
  act(() => { ledger.saveCurrentFilter(); }); expect(saveSavedFilters).toHaveBeenCalledOnce();
  const saved = ledger.savedFilters[0];
  act(() => { ledger.setSearchText(""); }); act(() => { ledger.applySavedFilter(saved); });
  expect(ledger.searchText).toBe("Purchase");
  act(() => { ledger.toggleSelected(1); ledger.setShownCount(150); });
  await act(async () => { root.render(<Harness key="next-profile" />); });
  expect(ledger.searchText).toBe(""); expect(ledger.selectedIds.size).toBe(0); expect(ledger.shownCount).toBe(50);
});
