// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useApplicationCalls } from "./useApplicationCalls";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
document.body.append(host);
let root: ReturnType<typeof createRoot> | undefined, owner: ReturnType<typeof useApplicationCalls>;
const bound = vi.fn();
function Probe() {
  owner = useApplicationCalls(bound);
  return null;
}
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.resetAllMocks();
});
async function mount() {
  root = createRoot(host);
  await act(async () => root!.render(<Probe />));
}
it("retains a malformed-read error until an explicitly retried valid result arrives", async () => {
  await mount();
  bound.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);
  await act(async () => {
    await expect(owner.call("list_assets")).rejects.toMatchObject({ code: "invalid_response" });
  });
  expect(owner.errors.list_assets.code).toBe("invalid_response");
  expect(owner.loaded.has("list_assets")).toBe(false);
  await act(async () => {
    await owner.call("list_assets");
  });
  expect(owner.errors.list_assets).toBeUndefined();
  expect(owner.loaded.has("list_assets")).toBe(true);
});
it("invalidates financial dependents only after a successful financial write and never retries a failure", async () => {
  await mount();
  bound.mockRejectedValueOnce({ code: "internal_error", message: "not saved" });
  await act(async () => {
    await expect(owner.call("set_budget", { amount: "10" })).rejects.toMatchObject({ code: "internal_error" });
  });
  expect(bound).toHaveBeenCalledTimes(1);
  expect(owner.revision).toBe(0);
  bound.mockResolvedValue(null);
  await act(async () => {
    await owner.call("create_backup");
  });
  expect(owner.revision).toBe(0);
  await act(async () => {
    await owner.call("set_budget", { amount: "10" });
  });
  expect(owner.revision).toBe(1);
});
it("refuses a valid legacy read that finishes after its profile unmounts", async () => {
  await mount();
  let resolve!: (value: unknown) => void;
  bound.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const request = owner.call("list_assets");
  const refusal = expect(request).rejects.toMatchObject({ code: "stale_profile" });
  act(() => root!.unmount());
  root = undefined;
  resolve([]);
  await refusal;
});
it("cannot publish an older same-domain read over a newer successful load", async () => {
  await mount();
  const replies:Array<(value:unknown)=>void>=[];
  bound.mockImplementation(()=>new Promise(resolve=>replies.push(resolve)));
  const old=owner.call("portfolio_history"),refusal=expect(old).rejects.toMatchObject({code:"superseded"});
  const next=owner.call("portfolio_history");
  await act(async()=>{replies[1]([{date:"2026-10-11",value:"12.34"}]);await next;});
  await act(async()=>{replies[0]([]);await refusal;});
  expect(owner.errors.portfolio_history).toBeUndefined();
  expect(owner.loaded.has("portfolio_history")).toBe(true);
});
