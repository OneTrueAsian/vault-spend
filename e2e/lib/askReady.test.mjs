import { describe, expect, it } from "vitest";
import { withAskReady } from "./askReady.mjs";

describe("compiled questions respect the live Ask readiness guard", () => {
  it("waits for the prepared form before asking, even when the question starts empty", async () => {
    const events = [];
    const browser = { $: async selector => {
      events.push(selector);
      return { waitForExist: async options => { events.push(options); events.push("ready"); } };
    } };
    expect(await withAskReady(browser, async () => { events.push("ask"); return "review"; })).toBe("review");
    expect(events).toEqual(['.ledger-qa-card form[aria-busy="false"]', { timeout: 5000 }, "ready", "ask"]);
  });
  it("does not submit while readiness is still pending", async () => {
    let release;
    let asked = false;
    const pending = new Promise(resolve => { release = resolve; });
    const work = withAskReady({ $: async () => ({ waitForExist: () => pending }) }, () => { asked = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(asked).toBe(false);
    release();
    await work;
    expect(asked).toBe(true);
  });
  it("preserves a readiness failure and never asks afterward", async () => {
    const failed = new Error("Ask never became enabled");
    let asked = false;
    await expect(withAskReady({ $: async () => ({ waitForExist: async () => { throw failed; } }) }, () => { asked = true; })).rejects.toBe(failed);
    expect(asked).toBe(false);
  });
});
