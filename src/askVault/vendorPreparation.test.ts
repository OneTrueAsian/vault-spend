import { afterEach, describe, expect, it, vi } from "vitest";
import { anyVendorMatches, prepareVendors, resolveVendor } from "./vendor";

// Task7 E / PF-06: same exact roster semantics, scheduled preparation before new submissions.
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe("scheduled per-roster vendor preparation", () => {
  it("yields before preparing and publishes the same matching/frequency/choice result", async () => {
    vi.useFakeTimers();
    const names=["COSTCO WHSE #1","COSTCO GAS #2","COSTCO WHSE #1","SAMS CLUB #3","SAMANTHAS BAKERY #4","CUT ABOVE SALON"];
    const expected=["costco","sam","cut above","missing"].map(s=>resolveVendor(s,[...names]));
    let finished=false;const work=prepareVendors(names,new AbortController().signal).then(v=>{finished=v;});
    await Promise.resolve();expect(finished).toBe(false);
    await vi.runAllTimersAsync();await work;expect(finished).toBe(true);
    expect(["costco","sam","cut above","missing"].map(s=>resolveVendor(s,names))).toEqual(expected);
    const tokenize=vi.spyOn(String.prototype,"toLowerCase");expect(anyVendorMatches(names,"costco")).toBe(true);expect(tokenize).not.toHaveBeenCalled();
  });
  it("slices work instead of moving one full synchronous preparation into a timer", async () => {
    vi.useFakeTimers();let clock=0;vi.spyOn(performance,"now").mockImplementation(()=>++clock);
    const names=Array.from({length:400},(_,i)=>`Fictional store ${i}`);let finished=false;
    const work=prepareVendors(names,new AbortController().signal).then(v=>{finished=v;});
    await vi.advanceTimersToNextTimerAsync();expect(finished).toBe(false);expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.runAllTimersAsync();await work;expect(finished).toBe(true);
  });
  it("does not publish an aborted partial roster and does not resurrect it after a replacement", async () => {
    vi.useFakeTimers();let clock=0;vi.spyOn(performance,"now").mockImplementation(()=>++clock);
    const old=Array.from({length:100},(_,i)=>`Old merchant ${i}`),next=["NEW SHOP"],abort=new AbortController();
    const pending=prepareVendors(old,abort.signal);await vi.advanceTimersToNextTimerAsync();abort.abort();
    const current=prepareVendors(next,new AbortController().signal);await vi.runAllTimersAsync();
    expect(await pending).toBe(false);expect(await current).toBe(true);
    const tokenize=vi.spyOn(String.prototype,"toLowerCase");expect(anyVendorMatches(next,"new")).toBe(true);expect(tokenize).not.toHaveBeenCalled();
    expect(anyVendorMatches(old,"old")).toBe(true);expect(tokenize).toHaveBeenCalled();
  });
  it("prepares a new equal-content array independently and preserves the old cache", async () => {
    vi.useFakeTimers();const first=["A B SHOP"],second=[...first];
    const a=prepareVendors(first,new AbortController().signal);await vi.runAllTimersAsync();expect(await a).toBe(true);
    let finished=false;const b=prepareVendors(second,new AbortController().signal).then(v=>{finished=v;});await Promise.resolve();expect(finished).toBe(false);
    await vi.runAllTimersAsync();await b;expect(finished).toBe(true);expect(anyVendorMatches(second,"ab")).toBe(true);
  });
});
