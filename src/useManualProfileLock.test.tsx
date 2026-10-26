// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { captureManualLockGeneration, useManualProfileLock } from "./useManualProfileLock";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, state: ReturnType<typeof useManualProfileLock>, current: number, dirty: boolean, origin: number | undefined;
const lock = vi.fn(async () => {}), onError = vi.fn();
function Harness() { state = useManualProfileLock({ generation: async () => current, originGeneration: async () => origin ?? current, lock, dirty: () => dirty, onError }); return null; }
beforeEach(() => { vi.clearAllMocks(); current = 1; origin = undefined; dirty = true; root = createRoot(document.createElement("div")); act(() => root.render(<Harness />)); });
afterEach(() => act(() => root.unmount()));
it("cancels without locking and only confirms the captured profile generation", async () => {
  await act(() => state.start()); expect(state.needsConfirmation).toBe(true); act(() => state.cancel()); expect(lock).not.toHaveBeenCalled();
  await act(() => state.start()); current = 2; await act(() => state.confirm()); expect(lock).not.toHaveBeenCalled();
  await act(() => state.start()); await act(() => state.confirm()); expect(lock).toHaveBeenCalledExactlyOnceWith(2);
});
it("locks clean input immediately and refuses duplicate concurrent requests", async () => {
  dirty = false; await act(async () => { await Promise.all([state.start(), state.start()]); }); expect(lock).toHaveBeenCalledExactlyOnceWith(1);
});
it("does not execute a captured confirmation after unmount", async () => {
  await act(() => state.start()); const confirm = state.confirm; act(() => root.unmount()); await confirm(); expect(lock).not.toHaveBeenCalled();
});
it("a delayed lock initiation cannot adopt a newer profile than its captured origin", async () => {
  origin = 1; current = 2; dirty = false; await act(() => state.start()); expect(lock).not.toHaveBeenCalled();
  dirty = true; await act(() => state.start()); await act(() => state.confirm()); expect(lock).not.toHaveBeenCalled();
});
it("accepts a new generation for the same displayed profile after in-place protection changes", async () => {
  await expect(captureManualLockGeneration("a", async () => 2, async () => "a")).resolves.toBe(2);
});
it("rejects another active profile or a transition during identity capture", async () => {
  await expect(captureManualLockGeneration("a", async () => 2, async () => "b")).rejects.toThrow("changed");
  const generation = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
  await expect(captureManualLockGeneration("a", generation, async () => "a")).rejects.toThrow("changed");
});
