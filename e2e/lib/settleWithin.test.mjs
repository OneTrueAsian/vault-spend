// settleWithin(promise, ms): wait for a promise, but never longer than ms, and never leave the timeout running. The harness uses it to bound
// closing a session. Its old inline timeout was left running after the session closed instantly, so every spec's Node process stayed alive
// for the rest of those 3 seconds before exiting (about 2.85 s x 230 specs of pure waiting).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settleWithin } from "./settleWithin.mjs";

afterEach(() => vi.useRealTimers());

describe("settleWithin", () => {
  it("returns the value when the promise settles first, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    await expect(settleWithin(Promise.resolve("done"), 3000)).resolves.toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("gives up after the limit when the promise never settles, resolving to undefined, with no timer left", async () => {
    vi.useFakeTimers();
    const waiting = settleWithin(new Promise(() => {}), 3000);
    await vi.advanceTimersByTimeAsync(2999);
    let settled = false; waiting.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(waiting).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("passes a rejection on (the caller decides) and still leaves no timer", async () => {
    vi.useFakeTimers();
    await expect(settleWithin(Promise.reject(new Error("boom")), 3000)).rejects.toThrow("boom");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("a promise that settles late (after the limit) does not change the result", async () => {
    vi.useFakeTimers();
    let finish; const slow = new Promise(resolve => { finish = resolve; });
    const waiting = settleWithin(slow, 100);
    await vi.advanceTimersByTimeAsync(100); finish("too late");
    await expect(waiting).resolves.toBeUndefined();
  });
  it("a process that awaits it exits promptly instead of idling out the limit (the real regression)", () => {
    const helper = pathToFileURL(path.resolve("e2e/lib/settleWithin.mjs")).href;
    const started = Date.now();
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `import { settleWithin } from ${JSON.stringify(helper)}; await settleWithin(Promise.resolve(1), 5000);`], { encoding: "utf8" });
    expect(child.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(2500); // would be about 5000 ms if the timer were left running
  });
});
