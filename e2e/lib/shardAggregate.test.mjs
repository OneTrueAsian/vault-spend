import { describe, expect, it } from "vitest";
import { aggregateShardResults, renderSummary } from "./shardAggregate.mjs";

const prepared = { exeSha256: "EXE", buildKey: "KEY", sourceSha: "s".repeat(40) };
const expected = ["smoke.mjs", "feature1.mjs", "feature2.mjs", "feature3.mjs", "feature4.mjs", "feature5.mjs"];
const entry = (name, code = 0, attempts) => ({ name, code, durationMs: 1000, output: "", ...(attempts ? { attempts } : {}) });
const retried = (name, finalCode = 0) => entry(name, finalCode, [entry(name, 1), entry(name, finalCode)]);
const shard = (index, names, over = {}, executed) => ({
  index, meta: { index, total: 2, runAttempt: 1, outcome: "success" },
  record: { sourceValid: true, valid: true, concurrency: 1, elapsedSeconds: 60, identity: { artifactStatus: "fresh", exeSha256: "EXE", buildKey: "KEY", testKey: "T" }, selected: names, executed: executed ?? names.map(n => entry(n)), ...over },
});
const first = () => shard(1, expected.slice(0, 3));
const second = (over, executed) => shard(2, expected.slice(3), over, executed);
const run = (shards, over = {}) => aggregateShardResults({ expected, total: 2, prepared, runAttempt: 1, shards, ...over });

describe("sharded gate aggregation", () => {
  it("passes only with complete, disjoint, valid shards on the prepared executable", () => {
    const r = run([first(), second()]);
    expect(r.ok).toBe(true);
    expect(r.totals).toMatchObject({ expected: 6, ran: 6, passed: 6, failed: 0, retried: 0 });
  });
  it("fails when a shard is missing", () => { expect(run([first()]).problems).toContain("Shard 2/2: expected exactly one result, found 0."); });
  it("fails when a shard has no run record", () => { expect(run([first(), { ...second(), record: undefined }]).ok).toBe(false); });
  it("fails when a spec ran in no shard (incomplete primary coverage)", () => {
    const r = run([first(), shard(2, expected.slice(3, 5))]);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain("feature5.mjs ran in no shard.");
  });
  it("fails when a spec ran in two shards or an unknown spec ran", () => {
    expect(run([first(), shard(2, expected.slice(2))]).problems.some(p => p.includes("ran in shard 1 and in shard 2"))).toBe(true);
    expect(run([shard(1, [...expected.slice(0, 3), "ghost.mjs"]), second()]).problems.some(p => p.includes("not a discovered spec"))).toBe(true);
  });
  it("fails when a shard executed fewer specs than it selected", () => {
    expect(run([first(), second({}, [entry("feature4.mjs")])]).problems.some(p => p.includes("executed are not the specs it selected"))).toBe(true);
  });
  it("fails on a different executable, build key, stale artifact, or invalid run", () => {
    const withIdentity = identity => [first(), second({ identity: { artifactStatus: "fresh", exeSha256: "EXE", buildKey: "KEY", testKey: "T", ...identity } })];
    expect(run(withIdentity({ exeSha256: "OTHER" })).ok).toBe(false);
    expect(run(withIdentity({ buildKey: "OTHER" })).ok).toBe(false);
    expect(run(withIdentity({ artifactStatus: "stale" })).ok).toBe(false);
    expect(run([first(), second({ valid: false })]).ok).toBe(false);
    expect(run([first(), second({ sourceValid: false })]).ok).toBe(false);
    expect(run([first(), second({ concurrency: 3 })]).ok).toBe(false);
  });
  it("fails when shards ran different test sources", () => {
    const s2 = second(); s2.record.identity.testKey = "U";
    expect(run([first(), s2]).problems.some(p => p.includes("different test sources"))).toBe(true);
  });
  it("fails on mixed run attempts (a re-run of only some jobs)", () => {
    const s2 = second(); s2.meta.runAttempt = 2;
    expect(run([first(), s2], { runAttempt: 2 }).problems.some(p => p.includes("Re-run all jobs"))).toBe(true);
  });
  it("records failures separately and fails the gate", () => {
    const r = run([first(), second({}, [entry("feature3.mjs"), entry("feature4.mjs", 1), entry("feature5.mjs")])]);
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([{ shard: 2, name: "feature4.mjs", code: 1, attempts: 1 }]);
    expect(r.retries).toEqual([]);
  });
  it("records a retried pass as a retry, not a failure, and still passes within the gate-wide budget", () => {
    const r = run([first(), second({}, [retried("feature4.mjs"), entry("feature3.mjs"), entry("feature5.mjs")])]);
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.retries).toEqual([{ shard: 2, name: "feature4.mjs", firstExit: 1, finalExit: 0, passedOnRetry: true }]);
    expect(r.totals).toMatchObject({ passed: 6, retried: 1, passedOnRetry: 1, failed: 0 });
  });
  it("applies the retry budget to the whole gate, not to each shard", () => {
    const s1 = shard(1, expected.slice(0, 3), {}, expected.slice(0, 3).map(n => retried(n)));
    const s2 = second({}, [retried("feature4.mjs"), entry("feature3.mjs"), entry("feature5.mjs")]);
    expect(run([s1, s2]).problems.some(p => p.includes("gate-wide budget of 3"))).toBe(true);
    expect(run([s1, s2], { retryBudget: 4 }).ok).toBe(true);
  });
  it("keeps a failed retry visible as both a failure and a retry", () => {
    const r = run([first(), second({}, [retried("feature4.mjs", 1), entry("feature3.mjs"), entry("feature5.mjs")])]);
    expect(r.failures[0]).toMatchObject({ name: "feature4.mjs", attempts: 2 });
    expect(r.retries[0]).toMatchObject({ name: "feature4.mjs", passedOnRetry: false });
  });
  it("renders failures and retries under separate headings", () => {
    const text = renderSummary(run([first(), second({}, [retried("feature4.mjs"), entry("feature3.mjs"), entry("feature5.mjs", 1)])]), { runAttempt: 1, prepared });
    expect(text).toContain("### Retries (recorded separately from failures)");
    expect(text).toContain("### Failures");
    expect(text).toContain("FAILED");
  });
});
