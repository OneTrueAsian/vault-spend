// R2: parallel-safe specs share a bounded pool; an exclusive spec runs completely alone across the whole runner (workers drained first,
// nothing new started until it ends); anything unclassified is exclusive. Every selected spec runs exactly once and every failure
// is reported. The specs here are fakes with controllable duration; no app is started.
import { describe, expect, it } from "vitest";
import { classifySpecs, runSchedule, validateClassification } from "./scheduler.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
/** A fake spec runner that records overlap. */
function fake({ durations = {}, codes = {}, throws = {} } = {}) {
  const log = [], state = { active: 0, max: 0, activeNames: new Set() };
  const run = async name => {
    if (throws[name]) { log.push({ event: "start", name, activeBefore: state.active }); throw new Error(throws[name]); }
    log.push({ event: "start", name, activeBefore: state.active, others: [...state.activeNames] });
    state.active++; state.activeNames.add(name); state.max = Math.max(state.max, state.active);
    await sleep(durations[name] ?? 15);
    state.active--; state.activeNames.delete(name);
    log.push({ event: "end", name });
    return { name, code: codes[name] ?? 0, output: "", durationMs: durations[name] ?? 15 };
  };
  return { run, log, state };
}
const config = (parallelSafe, exclusive) => ({ parallelSafe, exclusive: Object.fromEntries(exclusive.map(n => [n, "test"])) });

describe("classification", () => {
  it("a spec in neither list is exclusive", () => {
    const { parallel, exclusive } = classifySpecs(["a", "b", "c"], config(["a"], ["b"]));
    expect(parallel).toEqual(["a"]); expect(exclusive).toEqual(["b", "c"]);
  });
  it("a spec in both lists is exclusive (the stricter reading wins)", () => {
    const { parallel, exclusive } = classifySpecs(["a"], config(["a"], ["a"]));
    expect(parallel).toEqual([]); expect(exclusive).toEqual(["a"]);
  });
  it("a missing or malformed configuration makes everything exclusive", () => {
    for (const bad of [undefined, null, {}, { parallelSafe: "a" }, { parallelSafe: [1, 2] }]) expect(classifySpecs(["a", "b"], bad)).toEqual({ parallel: [], exclusive: ["a", "b"] });
  });
  it("validation names entries for specs that no longer exist, duplicates, and specs in both lists", () => {
    const problems = validateClassification(["a", "b"], { parallelSafe: ["a", "a", "gone"], exclusive: { a: "x", b: "y", alsoGone: "z" } });
    expect(problems.map(p => p.kind).sort()).toEqual(["both-lists", "duplicate", "unknown-spec", "unknown-spec"]);
  });
  it("validation of a consistent configuration finds nothing", () => expect(validateClassification(["a", "b"], config(["a"], ["b"]))).toEqual([]));
});

describe("scheduling", () => {
  it("runs every selected spec exactly once and returns every result", async () => {
    const specs = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const { run } = fake();
    const results = await runSchedule({ specs, classification: config(specs.slice(0, 8), specs.slice(8)), concurrency: 4, run });
    expect(results.map(r => r.name).sort()).toEqual([...specs].sort());
  });
  it("parallel-safe specs overlap, but never beyond the concurrency limit", async () => {
    const specs = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const f = fake({ durations: Object.fromEntries(specs.map(s => [s, 40])) });
    await runSchedule({ specs, classification: config(specs, []), concurrency: 3, run: f.run });
    expect(f.state.max).toBe(3);
  });
  it("an exclusive spec never overlaps anything, before or after", async () => {
    const f = fake({ durations: { x1: 30, x2: 30, p0: 20, p1: 20, p2: 20, p3: 20 } });
    await runSchedule({ specs: ["p0", "x1", "p1", "x2", "p2", "p3"], classification: config(["p0", "p1", "p2", "p3"], ["x1", "x2"]), concurrency: 4, run: f.run });
    for (const entry of f.log.filter(e => e.event === "start" && e.name.startsWith("x"))) expect(entry.activeBefore, `${entry.name} started alongside ${entry.others}`).toBe(0);
    // and nothing else starts while an exclusive spec is running
    let exclusiveRunning = false;
    for (const e of f.log) {
      if (e.event === "start") { if (exclusiveRunning) throw new Error(`${e.name} started during an exclusive spec`); if (e.name.startsWith("x")) exclusiveRunning = true; }
      else if (e.name.startsWith("x")) exclusiveRunning = false;
    }
  });
  it("drains the parallel workers before the first exclusive spec starts", async () => {
    const f = fake({ durations: { slow: 120, p1: 10, p2: 10, x: 10 } });
    await runSchedule({ specs: ["slow", "p1", "p2", "x"], classification: config(["slow", "p1", "p2"], ["x"]), concurrency: 3, run: f.run });
    const slowEnd = f.log.findIndex(e => e.event === "end" && e.name === "slow"), xStart = f.log.findIndex(e => e.event === "start" && e.name === "x");
    expect(xStart).toBeGreaterThan(slowEnd);
  });
  it("concurrency 1 never overlaps anything, exclusive or not", async () => {
    const f = fake();
    await runSchedule({ specs: ["a", "b", "c", "d"], classification: config(["a", "b"], ["c", "d"]), concurrency: 1, run: f.run });
    expect(f.state.max).toBe(1);
  });
  it("with nothing classified it behaves like a fully serial run, whatever the concurrency", async () => {
    const f = fake({ durations: { a: 30, b: 30, c: 30 } });
    await runSchedule({ specs: ["a", "b", "c"], classification: undefined, concurrency: 6, run: f.run });
    expect(f.state.max).toBe(1);
  });
  it("starts the longest known spec first within each class, unknown ones last", async () => {
    const f = fake();
    await runSchedule({ specs: ["a", "b", "c", "d"], classification: config(["a", "b", "c", "d"], []), concurrency: 1, durations: { b: 900, d: 100, a: 500 }, run: f.run });
    expect(f.log.filter(e => e.event === "start").map(e => e.name)).toEqual(["b", "a", "d", "c"]);
  });
  it("handles an empty selection", async () => expect(await runSchedule({ specs: [], classification: config([], []), concurrency: 3, run: fake().run })).toEqual([]));
});

describe("failures", () => {
  it("reports every failing spec, parallel and exclusive, and still runs all the others", async () => {
    const f = fake({ codes: { p1: 1, x1: 3 } });
    const results = await runSchedule({ specs: ["p0", "p1", "p2", "x1", "x2"], classification: config(["p0", "p1", "p2"], ["x1", "x2"]), concurrency: 3, run: f.run });
    expect(results).toHaveLength(5);
    expect(results.filter(r => r.code !== 0).map(r => [r.name, r.code]).sort()).toEqual([["p1", 1], ["x1", 3]]);
  });
  it("a runner that throws becomes a failed result carrying the message, not a lost spec", async () => {
    const f = fake({ throws: { p1: "could not start" } });
    const results = await runSchedule({ specs: ["p0", "p1", "x"], classification: config(["p0", "p1"], ["x"]), concurrency: 2, run: f.run });
    expect(results.map(r => r.name).sort()).toEqual(["p0", "p1", "x"]);
    expect(results.find(r => r.name === "p1")).toMatchObject({ code: 1 });
    expect(results.find(r => r.name === "p1").output).toMatch(/could not start/);
    expect(results.find(r => r.name === "x").code).toBe(0);
  });
  it("a spec listed twice is refused rather than run twice", async () => {
    await expect(runSchedule({ specs: ["a", "a"], classification: config(["a"], []), concurrency: 2, run: fake().run })).rejects.toThrow(/more than once|duplicate/i);
  });
  it.each([0, -1, 1.5, NaN, "3"])("rejects concurrency %j", async value => {
    await expect(runSchedule({ specs: ["a"], classification: config(["a"], []), concurrency: value, run: fake().run })).rejects.toThrow(/concurrency/i);
  });
});

describe("cancellation", () => {
  it("stops starting specs, lets the running ones end, and reports the rest as not run (never a silent omission)", async () => {
    const f = fake({ durations: { a: 60, b: 60, c: 10, d: 10, x: 10 } });
    const controller = new AbortController();
    const done = runSchedule({ specs: ["a", "b", "c", "d", "x"], classification: config(["a", "b", "c", "d"], ["x"]), concurrency: 2, run: f.run, signal: controller.signal });
    await sleep(25); controller.abort();
    const results = await done;
    const byName = Object.fromEntries(results.map(r => [r.name, r]));
    expect(byName.a.code).toBe(0); expect(byName.b.code).toBe(0); // the running ones finished normally
    for (const name of ["c", "d", "x"]) expect(byName[name]).toMatchObject({ code: 1, notRun: true });
    expect(results).toHaveLength(5);
    expect(f.state.active).toBe(0);
  });
});
