import { afterEach, describe, expect, it, vi } from "vitest";
import vm from "node:vm";
import * as axeSession from "./axeSession.mjs";

afterEach(() => vi.useRealTimers());
function browser({ animations = () => [], ancestors = () => [], connected = () => true, rect = () => ({ x: 0, y: 0, width: 600, height: 400 }), supported = true } = {}) {
  let elapsed = 0, frames = 0;
  const dialog = { parentElement: { getAnimations: ancestors }, get isConnected() { return connected(); }, getAnimations: supported ? animations : undefined, getBoundingClientRect: rect };
  const context = vm.createContext({ document: { querySelector: () => dialog }, performance: { now: () => elapsed },
    requestAnimationFrame: callback => setTimeout(() => { elapsed += 16; frames++; callback(elapsed); }, 16), setTimeout, clearTimeout });
  return { get elapsed() { return elapsed; }, get frames() { return frames; }, pause: vi.fn(),
    executeAsync: (fn, ...args) => new Promise(resolve => { context.args = [...args, resolve]; vm.runInContext(`(${fn.toString()})(...args)`, context); }) };
}
describe("visual readiness uses current rendered state instead of a fixed sleep", () => {
  it("returns after stable frames without spending the former 450 ms", async () => {
    vi.useFakeTimers(); const b = browser();
    const pending = axeSession.waitForVisualStability(b);
    await vi.runAllTimersAsync(); await pending;
    expect(b.elapsed).toBeLessThan(100); expect(b.frames).toBeGreaterThanOrEqual(2); expect(b.pause).not.toHaveBeenCalled();
  });
  it("waits for delayed transitions and a later geometry change to finish", async () => {
    vi.useFakeTimers(); let b;
    b = browser({ animations: () => b.elapsed < 160 ? [{ playState: "running", pending: b.elapsed < 32 }] : [],
      rect: () => ({ x: 0, y: 0, width: b.elapsed < 176 ? 600 : 620, height: 400 }) });
    const pending = axeSession.waitForVisualStability(b);
    await vi.runAllTimersAsync(); await pending;
    expect(b.elapsed).toBeGreaterThanOrEqual(208); expect(b.elapsed).toBeLessThanOrEqual(450);
  });
  it("also waits for ancestor theme transitions which can affect inherited colours", async () => {
    vi.useFakeTimers(); let b;
    b = browser({ ancestors: () => b.elapsed < 160 ? [{ playState: "running", pending: false }] : [] });
    const pending = axeSession.waitForVisualStability(b);
    await vi.runAllTimersAsync(); await pending;
    expect(b.elapsed).toBeGreaterThanOrEqual(192);
  });
  it("can inspect an intentional infinite progress spinner without waiting forever", async () => {
    vi.useFakeTimers();
    const b = browser({ animations: () => [{ playState: "running", effect: { getComputedTiming: () => ({ iterations: Infinity }) } }] });
    const pending = axeSession.waitForVisualStability(b);
    await vi.runAllTimersAsync(); await pending; expect(b.elapsed).toBeLessThan(100);
  });
  it("does not accept a detached dialog or a transition that never settles", async () => {
    vi.useFakeTimers(); const detached = browser({ connected: () => false });
    const stuck = browser({ animations: () => [{ playState: "running", pending: false }] });
    const p1 = expect(axeSession.waitForVisualStability(detached)).rejects.toThrow(/detached|dialog/i);
    const p2 = expect(axeSession.waitForVisualStability(stuck)).rejects.toThrow(/450|settle|transition/i);
    await vi.runAllTimersAsync(); await Promise.all([p1, p2]);
  });
  it("fails closed if the browser cannot observe active animations", async () => {
    const b = browser({ supported: false });
    await expect(axeSession.waitForVisualStability(b)).rejects.toThrow(/animation|support/i);
  });
  it("propagates a WebDriver execution error", async () => {
    await expect(axeSession.waitForVisualStability({ executeAsync: async () => { throw new Error("driver disconnected"); } })).rejects.toThrow("driver disconnected");
  });
});
