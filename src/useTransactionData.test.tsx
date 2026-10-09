// @vitest-environment jsdom
import { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTransactionData } from "./useTransactionData";
import { createTransactionClient } from "./transactionReads";
import type { TransactionSnapshot } from "./transactionContracts";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const context = { contractVersion: 1 as const, generation: 3, sessionRevision: 7 };
const row = { id: 1, transfer_counterpart_id: null, date: "2026-10-01", description: "Fixture", amount: "-12.34", category: null, category_source: null, confidence: null, account_id: 1, account_name: "Checking", applied_to_debt: null, principal_amount: null, split_count: 0, tags: [], member_id: null, member_name: null, notes: null };
const snapshot = (local = 1): TransactionSnapshot => ({ contractVersion: 1, context, revision: { local, external: 1 }, requestedIds: null, transactions: [row], stats: { total: 1, auto_categorized: 0, user_confirmed: 0, uncategorized: 1 }, accounts: [], categories: [], categoryIcons: [], flags: [], tags: [], members: [] });
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
let root: Root; let mounted: boolean; let data: ReturnType<typeof useTransactionData>;
function Harness() { data=useTransactionData(); return null; }
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(invoke).mockImplementation(async command => command === "get_transaction_context" ? context : snapshot());
  root=createRoot(document.createElement("div"));
  act(() => root.render(<StrictMode><Harness /></StrictMode>)); mounted=true;
});
afterEach(() => { if(mounted) act(() => root.unmount()); });

it("publishes the whole validated model once and works after StrictMode cleanup", async () => {
  await act(async () => { await data.refresh(); });
  expect(data.snapshot).toEqual(snapshot());
  expect(invoke).toHaveBeenCalledWith("get_transaction_snapshot", { ids: null, expectedGeneration: 3, expectedSessionRevision: 7 });
  const first=data.snapshot;
  await act(async () => { await data.refresh(); });
  expect(data.snapshot).toBe(first);
});
it("keeps the last coherent model on failure, exposes stale state, and retries", async () => {
  await act(async () => { await data.refresh(); });
  vi.mocked(invoke).mockRejectedValueOnce({ code: "internal_error", message: "Fixture failure" });
  await act(async () => { await expect(data.refresh()).rejects.toMatchObject({ code: "internal_error" }); });
  expect(data.snapshot).toEqual(snapshot()); expect(data.error?.code).toBe("internal_error"); expect(data.loading).toBe(false);
  await act(async () => { await data.refresh(); }); expect(data.error).toBe(null);
});

it("an initial refusal never publishes empty financial totals and Retry can acquire a valid context", async () => {
  vi.mocked(invoke).mockRejectedValueOnce({ code: "profile_locked", message: "Unlock this fixture profile" });
  await act(async () => { await expect(data.refresh()).rejects.toMatchObject({ code: "profile_locked" }); });
  expect(data.snapshot).toBe(null); expect(data.loading).toBe(false); expect(data.error?.code).toBe("profile_locked");
  await act(async () => { await data.refresh(); });
  expect(data.snapshot?.stats.total).toBe(1); expect(data.error).toBe(null);
});
it("does not publish malformed or wrong-profile replies", async () => {
  for(const reply of [{ ...snapshot(), tags: undefined }, { ...snapshot(), context: { ...context, generation: 4 } }]) {
    await act(async () => { await data.refresh(); });
    vi.mocked(invoke).mockResolvedValueOnce(reply);
    await act(async () => { await expect(data.refresh()).rejects.toMatchObject({ code: reply.tags === undefined ? "invalid_response" : "stale_profile" }); });
    expect(data.snapshot?.context.generation).toBe(3);
  }
});
it("a newer targeted response wins when an older full request resolves last", async () => {
  await act(async () => { await data.refresh(); });
  const unchangedAccounts=data.snapshot?.accounts;
  const old=deferred<TransactionSnapshot>(); const fresh=deferred<TransactionSnapshot>();
  vi.mocked(invoke).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  let first!: Promise<TransactionSnapshot>; let second!: Promise<TransactionSnapshot>;
  await act(async () => { first=data.refresh(); await Promise.resolve(); second=data.refreshRows([1]); await Promise.resolve(); });
  await act(async () => { fresh.resolve({ ...snapshot(3), transactions: [{ ...row, amount: "-25.01" }] }); await second; });
  await act(async () => { old.resolve(snapshot(2)); await expect(first).rejects.toMatchObject({ code: "superseded" }); });
  expect(data.snapshot?.transactions[0].amount).toBe("-25.01");
  expect(data.snapshot?.accounts).toBe(unchangedAccounts);
});

it("overlapping row edits reload a complete model so neither discarded delta is lost", async () => {
  const pair = (local: number, first: string, second: string) => ({ ...snapshot(local), transactions: [{ ...row, amount: first }, { ...row, id: 2, amount: second }], stats: { ...snapshot().stats, total: 2 } });
  vi.mocked(invoke).mockImplementation(async command => command === "get_transaction_context" ? context : pair(1,"-12.34","-12.34"));
  await act(async () => { await data.refresh(); });
  const old=deferred<TransactionSnapshot>(); const newest=deferred<TransactionSnapshot>();
  vi.mocked(invoke).mockReturnValueOnce(old.promise).mockReturnValueOnce(newest.promise);
  let first!: Promise<TransactionSnapshot>; let second!: Promise<TransactionSnapshot>;
  await act(async () => { first=data.refreshRows([1]); for(let i=0;i<5;i++) await Promise.resolve(); second=data.refreshRows([2]); for(let i=0;i<5;i++) await Promise.resolve(); });
  expect(vi.mocked(invoke).mock.calls.at(-1)?.[1]).toMatchObject({ ids: null });
  await act(async () => { newest.resolve(pair(3,"-20.01","-30.02")); await second; });
  await act(async () => { old.resolve({ ...pair(2,"-20.01","-12.34"), requestedIds: [1], transactions: [{ ...row, amount:"-20.01" }] }); await expect(first).rejects.toMatchObject({ code:"superseded" }); });
  expect(data.snapshot?.transactions.map(t => t.amount)).toEqual(["-20.01","-30.02"]);
});

it("an external commit forces a full read even when targeted row counts still match", async () => {
  await act(async () => { await data.refresh(); });
  const external={ ...snapshot(1), revision:{local:1,external:2}, transactions:[{...row,description:"External change"}] };
  vi.mocked(invoke).mockResolvedValueOnce({ ...external,requestedIds:[1] }).mockResolvedValueOnce(external);
  await act(async () => { await data.refreshRows([1]); });
  expect(vi.mocked(invoke).mock.calls.at(-1)?.[1]).toMatchObject({ids:null});
  expect(data.snapshot?.transactions[0].description).toBe("External change");
});
it("falls back to a complete snapshot if targeted counts expose another inserted row", async () => {
  await act(async () => { await data.refresh(); });
  const complete = { ...snapshot(3), transactions: [row,{ ...row,id: 2 }], stats: { ...snapshot().stats,total: 2 } };
  vi.mocked(invoke).mockResolvedValueOnce({ ...complete, requestedIds: [1], transactions: [row] }).mockResolvedValueOnce(complete);
  await act(async () => { await data.refreshRows([1]); });
  expect(data.snapshot?.transactions).toHaveLength(2);
});
it("discards in-flight replies and refuses new actions after unmount", async () => {
  const pending=deferred<TransactionSnapshot>();
  vi.mocked(invoke).mockImplementation(async command => command === "get_transaction_context" ? context : pending.promise);
  let result!: Promise<TransactionSnapshot>;
  await act(async () => { result=data.refresh(); await Promise.resolve(); });
  act(() => root.unmount()); mounted=false;
  pending.resolve(snapshot());
  await expect(result).rejects.toMatchObject({ code: "superseded" });
  await expect(data.call("delete_transaction", { id: 1 })).rejects.toMatchObject({ code: "stale_profile" });
});
it("coalesces duplicate pending mutations and does not retry a failed write", async () => {
  const write=deferred<null>();
  vi.mocked(invoke).mockImplementation(async command => command === "get_transaction_context" ? context : write.promise);
  const client=createTransactionClient();
  const first=client.call("create_manual_transaction", { amount: "-1.01" });
  const second=client.call("create_manual_transaction", { amount: "-1.01" });
  await Promise.resolve(); await Promise.resolve();
  write.reject({ code: "stale_profile", message: "Fixture refusal" });
  await expect(first).rejects.toMatchObject({ code: "stale_profile" }); await expect(second).rejects.toMatchObject({ code: "stale_profile" });
  expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "create_manual_transaction")).toHaveLength(1);
});
it("does not dispatch an action when the session closes before context acquisition", async () => {
  const origin=deferred<typeof context>(); vi.mocked(invoke).mockReturnValue(origin.promise);
  const client=createTransactionClient(); const write=client.call("delete_transaction", { id: 1 });
  client.dispose(); origin.resolve(context);
  await expect(write).rejects.toMatchObject({ code: "stale_profile" }); expect(invoke).toHaveBeenCalledTimes(1);
});
