import { afterEach, describe, expect, it, vi } from "vitest";
import { actUntil } from "./actUntil.mjs";

// A fake browser whose waitUntil polls up to 20 times, like the pattern in clickUntilShown.test.mjs.
const fakeBrowser = () => ({
  waitUntil: async (condition, { timeout, timeoutMsg }) => {
    for (let i = 0; i < 20; i++) if (await condition()) return true;
    throw new Error(timeoutMsg ?? `timed out after ${timeout}ms`);
  },
});

// `doneAfter` is how many acts it takes before done() is true (Infinity = never).
function fakeStep(doneAfter) {
  const state = { acts: 0 };
  return { state, done: async () => state.acts >= doneAfter, act: async () => { state.acts++; } };
}

afterEach(() => vi.restoreAllMocks());

describe("actUntil", () => {
  it("does nothing when it is done at once", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const step = fakeStep(0);
    const result = await actUntil(fakeBrowser(), { label: "open it", done: step.done, act: step.act });
    expect(result).toEqual({ acts: 0, repeats: 0 });
    expect(step.state.acts).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });
  it("counts no repeat and prints nothing when the first act works", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const step = fakeStep(1);
    const result = await actUntil(fakeBrowser(), { label: "open it", done: step.done, act: step.act });
    expect(result).toEqual({ acts: 1, repeats: 0 });
    expect(log).not.toHaveBeenCalled();
  });
  it("counts every act after the first as a repeat and prints it once", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const step = fakeStep(3);
    const result = await actUntil(fakeBrowser(), { label: "open it", done: step.done, act: step.act });
    expect(result).toEqual({ acts: 3, repeats: 2 });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[harness] action repeated 2x: open it");
  });
  it("with actFirst, acts once before checking, and that first act is not a repeat", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const step = fakeStep(1);
    const result = await actUntil(fakeBrowser(), { label: "pick it", done: step.done, act: step.act, actFirst: true });
    expect(result).toEqual({ acts: 1, repeats: 0 });
    expect(log).not.toHaveBeenCalled();
  });
  it("with actFirst, acts even when done is already true, then never again", async () => {
    const step = fakeStep(0);
    const result = await actUntil(fakeBrowser(), { label: "pick it", done: step.done, act: step.act, actFirst: true });
    expect(result).toEqual({ acts: 1, repeats: 0 });
  });
  it("with actFirst, counts the acts after the first as repeats", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const step = fakeStep(3);
    const result = await actUntil(fakeBrowser(), { label: "pick it", done: step.done, act: step.act, actFirst: true });
    expect(result).toEqual({ acts: 3, repeats: 2 });
    expect(log).toHaveBeenCalledWith("[harness] action repeated 2x: pick it");
  });
  it("fails with the message given and still prints the repeats so far", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const step = fakeStep(Infinity);
    await expect(actUntil(fakeBrowser(), { label: "open it", done: step.done, act: step.act, timeoutMsg: "it should open" })).rejects.toThrow("it should open");
    expect(step.state.acts).toBe(20);
    expect(log).toHaveBeenCalledWith("[harness] action repeated 19x: open it");
  });
  it("uses the wait it is given, with the timeout and interval", async () => {
    const seen = [];
    const wait = async (condition, opts) => { seen.push(opts); await condition(); };
    const step = fakeStep(Infinity);
    await actUntil(fakeBrowser(), { label: "x", done: step.done, act: step.act, timeout: 12345, interval: 77, timeoutMsg: "msg", wait });
    expect(seen).toEqual([{ timeout: 12345, interval: 77, timeoutMsg: "msg" }]);
  });
  it("defaults the interval to 1500 ms", async () => {
    const seen = [];
    const browser = { waitUntil: async (condition, opts) => { seen.push(opts); } };
    await actUntil(browser, { label: "x", done: async () => true, act: async () => {}, timeout: 5000 });
    expect(seen[0].interval).toBe(1500);
  });
});
