// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTransactionBulkActions } from "./useTransactionBulkActions";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host:HTMLDivElement,root:ReturnType<typeof createRoot>,owner:ReturnType<typeof useTransactionBulkActions>;
const call=vi.fn(),refresh=vi.fn(),onStatus=vi.fn();
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);vi.resetAllMocks();refresh.mockResolvedValue(undefined);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
function mount(ids:number[]) {
 const p={data:{call,refresh,refreshRows:vi.fn(),setTransactions:vi.fn(),snapshot:{transactions:[]}},list:{selectedIds:new Set(ids),setSelectedIds:vi.fn()},onStatus,onBusy:vi.fn(),askNewCategory:vi.fn(),refreshRecurring:vi.fn()} as unknown as Parameters<typeof useTransactionBulkActions>[0];
 function Probe(){owner=useTransactionBulkActions(p);return null;}
 act(()=>root.render(<Probe/>));
}
it.each([0,1,2])("delete/undo reports the actual affected count in plain language (%i)",async count=>{
 const ids=Array.from({length:count},(_,i)=>i+1);mount([1,2,3]);call.mockResolvedValueOnce(ids);
 await act(async()=>owner.handleBulkDelete());
 expect(owner.undoToast?.text).toBe(`Deleted ${count} transaction${count===1?"":"s"}.`);
 call.mockResolvedValueOnce(null);await act(async()=>owner.handleUndoBulkDelete());
 expect(onStatus).toHaveBeenLastCalledWith(`Restored ${count} transaction${count===1?"":"s"}.`,"success");
 expect(call).toHaveBeenLastCalledWith("restore_transactions",{ids});
});
it("a failed deletion offers no invented undo and retains the real error",async()=>{
 mount([1]);call.mockRejectedValueOnce(new Error("Not saved"));await act(async()=>owner.handleBulkDelete());
 expect(owner.undoToast).toBeNull();expect(onStatus).toHaveBeenCalledWith("Not saved");
});
it.each([0,1,2])("undo alone reports the actual restored count without placeholder plurals (%i)",async count=>{
 const ids=Array.from({length:count},(_,i)=>i+1);mount([]);act(()=>owner.setUndoToast({text:"Earlier deletion",ids}));call.mockResolvedValueOnce(null);
 await act(async()=>owner.handleUndoBulkDelete());expect(onStatus).toHaveBeenLastCalledWith(`Restored ${count} transaction${count===1?"":"s"}.`,"success");
});
