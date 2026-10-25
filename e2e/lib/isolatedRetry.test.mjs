import { describe, expect, it } from "vitest";
import { parseRetryOptions, retryFailuresInIsolation } from "./isolatedRetry.mjs";

const pass = name => ({ name, code: 0, output: `${name} ok`, durationMs: 1000 });
const fail = (name, output = `${name} broke`) => ({ name, code: 1, output, durationMs: 2000 });

/** `script` maps a spec name to the results its successive retries return. */
function runner(script = {}) {
  const calls = [];
  const run = async name => { calls.push(name); const next = script[name]?.shift(); if (!next) throw new Error(`unexpected retry of ${name}`); return next; };
  return { run, calls };
}

describe("retrying failed specs once, alone, after the whole run", () => {
  it("does nothing when every spec passed", async () => {
    const { run, calls } = runner();
    const results = [pass("a.mjs"), pass("b.mjs")];
    const outcome = await retryFailuresInIsolation({ results, run, budget: 3 });
    expect(calls).toEqual([]);
    expect(outcome.results).toEqual(results);
    expect(outcome.flaky).toEqual([]);
    expect(outcome.skipped).toBeUndefined();
  });
  it("counts a spec that fails then passes alone as passed, and keeps the first failure whole", async () => {
    const { run, calls } = runner({ "b.mjs": [pass("b.mjs")] });
    const first = fail("b.mjs", "Error: recovery should reopen the profile directly");
    const outcome = await retryFailuresInIsolation({ results: [pass("a.mjs"), first, pass("c.mjs")], run, budget: 3 });
    expect(calls).toEqual(["b.mjs"]);
    expect(outcome.results.map(r => [r.name, r.code])).toEqual([["a.mjs", 0], ["b.mjs", 0], ["c.mjs", 0]]);
    expect(outcome.flaky).toEqual([{ name: "b.mjs", firstFailure: first, retry: pass("b.mjs") }]);
    expect(outcome.results[1].attempts).toEqual([first, pass("b.mjs")]);
  });
  it("keeps a spec failed when it fails again alone, with both attempts recorded", async () => {
    const second = fail("b.mjs", "second failure");
    const { run } = runner({ "b.mjs": [second] });
    const first = fail("b.mjs", "first failure");
    const outcome = await retryFailuresInIsolation({ results: [first], run, budget: 3 });
    expect(outcome.results[0].code).toBe(1);
    expect(outcome.results[0].output).toBe("second failure");
    expect(outcome.results[0].attempts).toEqual([first, second]);
    expect(outcome.flaky).toEqual([]);
  });
  it("retries one spec at a time, in the order they failed", async () => {
    const order = []; let running = 0, overlapped = false;
    const run = async name => { running++; overlapped ||= running > 1; await Promise.resolve(); order.push(name); running--; return pass(name); };
    await retryFailuresInIsolation({ results: [fail("x.mjs"), pass("y.mjs"), fail("z.mjs")], run, budget: 3 });
    expect(order).toEqual(["x.mjs", "z.mjs"]);
    expect(overlapped).toBe(false);
  });
  it("retries nothing when more specs failed than the budget, and says why", async () => {
    const { run, calls } = runner();
    const results = ["a", "b", "c", "d"].map(n => fail(`${n}.mjs`));
    const outcome = await retryFailuresInIsolation({ results, run, budget: 3 });
    expect(calls).toEqual([]);
    expect(outcome.results.every(r => r.code === 1)).toBe(true);
    expect(outcome.skipped).toMatch(/4 specs failed/);
    expect(outcome.skipped).toMatch(/budget of 3/);
  });
  it("retries exactly as many as the budget allows", async () => {
    const { run, calls } = runner({ "a.mjs": [pass("a.mjs")], "b.mjs": [pass("b.mjs")], "c.mjs": [pass("c.mjs")] });
    const outcome = await retryFailuresInIsolation({ results: [fail("a.mjs"), fail("b.mjs"), fail("c.mjs")], run, budget: 3 });
    expect(calls).toHaveLength(3);
    expect(outcome.flaky).toHaveLength(3);
  });
  it("keeps a failure failed if the retry itself throws, and reports the error", async () => {
    const run = async () => { throw new Error("driver gone"); };
    const first = fail("a.mjs");
    const outcome = await retryFailuresInIsolation({ results: [first], run, budget: 3 });
    expect(outcome.results[0].code).toBe(1);
    expect(outcome.results[0].output).toContain("first failure output is kept in attempts");
    expect(outcome.results[0].output).toContain("driver gone");
    expect(outcome.results[0].attempts[0]).toBe(first);
    expect(outcome.flaky).toEqual([]);
  });
  it("does not change the results it was given", async () => {
    const { run } = runner({ "a.mjs": [pass("a.mjs")] });
    const results = [fail("a.mjs")];
    await retryFailuresInIsolation({ results, run, budget: 3 });
    expect(results[0].code).toBe(1);
    expect(results[0].attempts).toBeUndefined();
  });
});

describe("--retry-failed", () => {
  it("is off unless asked for", () => {
    expect(parseRetryOptions(["node", "run-all.mjs"], 6)).toEqual({ enabled: false });
  });
  it("defaults to a budget of 3 specs", () => {
    expect(parseRetryOptions(["--retry-failed"], 1)).toEqual({ enabled: true, budget: 3 });
  });
  it("takes an explicit budget", () => {
    expect(parseRetryOptions(["--retry-failed=2"], 1)).toEqual({ enabled: true, budget: 2 });
  });
  it.each(["--retry-failed=0", "--retry-failed=-1", "--retry-failed=x", "--retry-failed=1.5", "--retry-failed="])("rejects %s", flag => {
    expect(() => parseRetryOptions([flag], 1)).toThrow(/--retry-failed/);
  });
  it("refuses to combine with parallel running, so a retried pass can never count as parallel proof", () => {
    expect(() => parseRetryOptions(["--retry-failed"], 2)).toThrow(/--concurrency=1/);
  });
});
