// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTransactionRowActions } from "./useTransactionRowActions";
import type { Transaction } from "./types";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let actions: ReturnType<typeof useTransactionRowActions>;
const call=vi.fn(); const refresh=vi.fn(); const refreshRows=vi.fn(); const status=vi.fn();
const row: Transaction = { id: 1, date: "2026-10-01", description: "Fixture", amount: "-12.34", account_id: 1, account_name: "Checking", category: "Food", category_source: "user", confidence: null, transfer_counterpart_id: null, applied_to_debt: null, principal_amount: null, split_count: 0, tags: [], member_id: null, member_name: null, notes: null };
function Harness() { actions=useTransactionRowActions({ data: { call,refresh,refreshRows }, accounts: [], categories: ["Food"], onStatus: status }); return null; }
beforeEach(() => { vi.resetAllMocks(); call.mockResolvedValue(null); refresh.mockResolvedValue(null); refreshRows.mockResolvedValue(null); root=createRoot(document.createElement("div")); act(() => root.render(<Harness/>)); });
afterEach(() => act(() => root.unmount()));
it("clears editing state and publishes the changed row through the shared owner", async () => {
  act(() => actions.setEditingAmount({ id: 1,value: "-12.34" }));
  await act(async () => { await actions.commitAmountEdit(1," -25.01 "); });
  expect(actions.editingAmount).toBe(null); expect(call).toHaveBeenCalledWith("update_transaction_amount", { id: 1,amount: "-25.01" });
  expect(refreshRows).toHaveBeenCalledWith([1]); expect(refresh).not.toHaveBeenCalled();
});
it("a refused write reports the error without replacing the financial read model", async () => {
  call.mockRejectedValue({ code: "stale_profile",message: "Profile changed" });
  await act(async () => { await actions.commitDescriptionEdit(1,"Changed"); });
  expect(status).toHaveBeenCalledWith("Profile changed"); expect(refreshRows).not.toHaveBeenCalled();
});
it("split editing preserves signs and notes and reloads the complete affected model", async () => {
  call.mockResolvedValueOnce([]);
  await act(async () => { await actions.toggleSplitEditor(row); });
  expect(actions.expandedSplitId).toBe(1); expect(actions.splitLines).toEqual([{ category:"Food",amount:"12.34",note:"" }]);
  act(() => { actions.updateSplitLine(0,{ amount:"7.00",note:"Lunch" }); actions.addSplitLine(); });
  act(() => actions.updateSplitLine(1,{ amount:"5.34" }));
  expect(actions.splitRemaining(row)).toBeCloseTo(0);
  await act(async () => { await actions.saveSplits(row); });
  expect(call).toHaveBeenLastCalledWith("set_transaction_splits",{ transactionId: 1,splits: [["Food","-7.00","Lunch"],["Food","-5.34",null]] });
  expect(actions.expandedSplitId).toBe(null); expect(refresh).toHaveBeenCalledTimes(1);
});
it("notes propagate refresh failures so the dialog can remain open for recovery", async () => {
  refreshRows.mockRejectedValue(new Error("Read failed"));
  await expect(actions.handleSaveNotes(1,"Fixture note")).rejects.toThrow("Read failed");
});
