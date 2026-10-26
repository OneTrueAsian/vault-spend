import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonical } from "../testSupport/askVaultM6/counting";
import { addDays, daysIn } from "../testSupport/askVaultM6/referenceCalendar";
import { answer, request as oracleRequest } from "../testSupport/askVaultM6/referenceOracle";
import type { World } from "../testSupport/askVaultM6/referenceWorld";

/**
 * Owner decision Q5 (21 October 2026): the missing native prerequisites for the scenario families. This file writes (once) and checks the frozen request and expected-result
 * files the focused native test `ask_vault_m6_scenario_prerequisites` consumes:
 *  - baseline-shaped reads: for every category of every one of the nine seed worlds, the read an M3 review and an M4 bundle make (one category, by month, average per month,
 *    the three full calendar months before this month; M3 Contract.md:21-25);
 *  - the comparison-threshold boundary reads (strict, inclusive, 100.01, parent-amount split) on the hand-worked boundary world.
 * Expected values come from the attributed, independent M2 oracle, never from the native code. The native test compares the store's own answers with them.
 */
const DIR = "src/testSupport/askVaultM6";
const read = (name: string) => JSON.parse(readFileSync(`${DIR}/${name}`, "utf8"));
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const REQUESTS = `${DIR}/scenarioNativeRequests.json`, REFERENCES = `${DIR}/scenarioNativeReferences.json`;
const contexts = read("contexts.json") as { worlds: Record<string, World>; contexts: Record<string, { worldId: string; seed: number }> };
const fixtures = read("scenarioNativeFixtures.json") as { worlds: Record<string, World> };

/** The three immediately preceding full calendar months (M3 Contract.md:25), as one period. */
function baselinePeriod(today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const start = new Date(Date.UTC(y, m - 1 - 3, 1)), end = new Date(Date.UTC(y, m - 1, 0));
  const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { from: iso(start), to: iso(end) };
}
const strip = (snapshot: ReturnType<typeof answer>) => { const { context: _c, revision: _r, ...value } = snapshot; return value; };

if (process.env.M6_WRITE_SCENARIO_NATIVE === "1") {
  if (existsSync(REQUESTS) || existsSync(REFERENCES)) throw new Error("The scenario native files already exist; a change needs a new, disclosed version.");
  const requests: Record<string, unknown> = {}, references: Record<string, unknown> = {};
  const add = (kind: string, worldId: string, seed: number | null, label: string, world: World, req: ReturnType<typeof oracleRequest>) => {
    const id = "s-" + sha(canonical(req)).slice(0, 24);
    requests[id] = req;
    references[`sr-${worldId}-${id}`] = { kind, worldId, seed, label, requestId: id, value: strip(answer(world, req)) };
  };
  for (const [worldId, world] of Object.entries(contexts.worlds)) {
    const seed = Object.values(contexts.contexts).find(c => c.worldId === worldId)!.seed;
    for (const category of world.categories) add("baseline", worldId, seed, category, world, oracleRequest({ kind: "total", periods: [baselinePeriod(world.today)], categories: [category], groupBy: "month", average: "per-month" }));
  }
  const boundary = fixtures.worlds["m6-threshold-boundary"];
  const periods = [{ from: "2026-10-01", to: "2026-10-20" }, { from: "2026-09-01", to: "2026-09-30" }];
  for (const [amount, inclusive] of [["100.00", false], ["100.00", true], ["100.01", false], ["100.01", true]] as const)
    add("threshold-boundary", "m6-threshold-boundary", null, `${inclusive ? "at least" : "over"} ${amount}`, boundary, oracleRequest({ kind: "compare", periods, categories: ["Clothing"], minimumPurchase: { amount, inclusive } }));
  // Parent-amount threshold on a single period with no category filter: the 150.00 split parent qualifies, its 60.00 and 90.00 allocations alone would not.
  add("threshold-boundary", "m6-threshold-boundary", null, "all spending over 100.00, October", boundary, oracleRequest({ kind: "total", periods: [periods[0]], minimumPurchase: { amount: "100.00", inclusive: false } }));
  writeFileSync(REQUESTS, JSON.stringify(requests, null, 1) + "\n");
  writeFileSync(REFERENCES, JSON.stringify({ version: "m6-scenario-native-references-1", writtenBy: "session bec4530a-cba4-40c4-b585-ecb9aed91bfa, 2026-10-21", expectedBy: "src/testSupport/askVaultM6/referenceOracle.ts (independent, attributed M2 oracle)", references }, null, 1) + "\n");
}

describe("scenario native request and reference files (Q5)", () => {
  const requests = read("scenarioNativeRequests.json") as Record<string, { kind: string; periods: { from: string; to: string }[]; categories: string[]; groupBy: string; average: string; contractVersion: number }>;
  const refs = read("scenarioNativeReferences.json").references as Record<string, { kind: string; worldId: string; requestId: string; label: string; value: { periods: { total: string; purchaseCount: number }[] } }>;
  const baseline = Object.values(refs).filter(r => r.kind === "baseline");
  it("has a baseline-shaped read for every category of every seed world, over the three full calendar months before that world's today", () => {
    const expected = Object.values(contexts.worlds).reduce((n, w) => n + w.categories.length, 0);
    expect(baseline).toHaveLength(expected);
    for (const r of baseline) {
      const req = requests[r.requestId], world = contexts.worlds[r.worldId];
      expect(req).toMatchObject({ kind: "total", contractVersion: 2, groupBy: "month", average: "per-month" });
      expect(req.categories).toEqual([r.label]);
      const { from, to } = baselinePeriod(world.today);
      expect(req.periods).toEqual([{ from, to }]);
      expect(to).toBe(addDays(`${to.slice(0, 7)}-01`, daysIn(Number(to.slice(0, 4)), Number(to.slice(5, 7))) - 1));
    }
  });
  it("holds the threshold-boundary reads, whose hand-worked results are 160.01/200.00, 260.01/200.00, 60.00/200.00 and 160.01/200.00", () => {
    const by = (label: string) => Object.values(refs).find(r => r.kind === "threshold-boundary" && r.label === label)!.value.periods.map(p => [p.total, p.purchaseCount]);
    expect(by("over 100.00")).toEqual([["160.01", 2], ["200.00", 1]]);
    expect(by("at least 100.00")).toEqual([["260.01", 3], ["200.00", 1]]);
    expect(by("over 100.01")).toEqual([["60.00", 1], ["200.00", 1]]);
    expect(by("at least 100.01")).toEqual([["160.01", 2], ["200.00", 1]]);
    expect(by("all spending over 100.00, October")).toEqual([["250.01", 2]]);   // 100.01 + the 150.00 split parent (60.00 + 90.00); the 100.00 and 99.99 purchases are out
  });
});
