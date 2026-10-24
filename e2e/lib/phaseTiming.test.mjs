import { describe, expect, it } from "vitest";
import * as timing from "./axeSession.mjs";

describe("optional matrix stage profiling preserves the real operation", () => {
  it("returns the real result and records one complete asynchronous operation", async () => {
    const records = []; let calls = 0, clock = 0;
    const value = await timing.measurePhase("fixture", async () => { calls++; await Promise.resolve(); return { id: 1 }; }, { enabled: true, now: () => clock += 10, write: x => records.push(JSON.parse(x)) });
    expect(value).toEqual({ id: 1 }); expect(calls).toBe(1);
    expect(records).toEqual([{ phase: "fixture", durationMs: 10, outcome: "returned" }]);
  });
  it("keeps the original operation error and records it without retrying", async () => {
    const records = [], error = new Error("original failure"); let calls = 0;
    await expect(timing.measurePhase("assertion", async () => { calls++; throw error; }, { enabled: true, now: () => 0, write: x => records.push(JSON.parse(x)) })).rejects.toBe(error);
    expect(calls).toBe(1); expect(records[0].outcome).toBe("threw");
  });
  it("does not collect timing or change results when profiling is disabled", async () => {
    let observed = 0;
    expect(await timing.measurePhase("disabled", async () => 42, { enabled: false, now: () => observed++, write: () => observed++ })).toBe(42);
    expect(observed).toBe(0);
  });
});
