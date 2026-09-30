// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePaymentSource } from "./usePaymentSource";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentGeneration } from "./profileUiState";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./profileUiState", () => ({ getCurrentGeneration: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let open: (id: number) => Promise<void>;
let mounted: boolean;
const ready = vi.fn();
const error = vi.fn();
const source = { id: 1, applied_to_debt: { debt_account_id: 2 } };
function Harness() { open = usePaymentSource(ready, error); return null; }
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentGeneration).mockResolvedValue(1);
  vi.mocked(invoke).mockResolvedValue([source]);
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<Harness />));
  mounted = true;
});
afterEach(() => { if (mounted) act(() => root.unmount()); });
it("refreshes once and resolves the exact linked source", async () => {
  await open(1);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("list_transactions");
  expect(ready).toHaveBeenCalledWith(source, [source]);
});
it("reports a deleted or unapplied payment instead of navigating elsewhere", async () => {
  vi.mocked(invoke).mockResolvedValue([{ id: 1, applied_to_debt: null }]);
  await open(1);
  expect(ready).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith("Payment is no longer available.");
});
it("cancels across a profile-generation change", async () => {
  vi.mocked(getCurrentGeneration).mockResolvedValueOnce(1).mockResolvedValueOnce(2);
  await open(1);
  expect(ready).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
it("cancels an in-flight read on unmount or lock", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(() => new Promise(r => { resolve = r; }));
  const pending = open(1);
  await Promise.resolve();
  act(() => root.unmount()); mounted = false;
  resolve([source]);
  await pending;
  expect(ready).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
it("a newer request wins even when the old final generation read resolves last", async () => {
  let resolve!: (value: number) => void;
  vi.mocked(getCurrentGeneration)
    .mockResolvedValueOnce(1)
    .mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const old = open(99);
  await Promise.resolve(); await Promise.resolve();
  await open(1);
  resolve(1);
  await old;
  expect(ready).toHaveBeenCalledTimes(1);
  expect(error).not.toHaveBeenCalled();
});
