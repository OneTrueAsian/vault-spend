// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import type { CorpusCase, Observation } from "../testSupport/askVaultM6/manifest";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";
import { buildReplyIndex, observeCase, type RouteEnv } from "../testSupport/askVaultM6/routeHarness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Task-4 item 6: the combined public-route harness, exercised end to end on a deterministic sample (the first case of every population and family), graded
 * against the REAL retained native proof. It is not the corpus run: the full 2,159-case run, the freeze signature for the scenario families and the typo lock
 * are still outstanding, so this sample cannot satisfy any gate and is not reported as a score.
 */
const DIR = "src/testSupport/askVaultM6";
const read = (name: string) => JSON.parse(readFileSync(`${DIR}/${name}`, "utf8"));
const cases: CorpusCase[] = read("cases.json"), contexts = read("contexts.json"), requests = read("expectedRequests.json"), references = read("referenceResults.json");
const proofs = { "native-proof-ordinary.json": readFileSync(`${DIR}/nativeProofs/native-proof-ordinary.json`, "utf8") };
const manifest = read("nativeEvidenceManifest.json");
const env: RouteEnv = { contexts, requests, references };

function sample(): CorpusCase[] {
  const seen = new Set<string>(), out: CorpusCase[] = [];
  for (const c of [...cases].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const key = `${c.population}|${c.family}`;
    if (!seen.has(key)) { seen.add(key); out.push(c); }
  }
  return out;
}

describe("combined public-route harness, deterministic sample", () => {
  it("runs the real card for every required seed/context, grades against the real proof, and reports without hiding a miss", async () => {
    const picked = sample();
    expect(picked.length).toBeGreaterThan(40);
    const index = buildReplyIndex(env);
    const observations: Observation[] = [];
    for (const c of picked) for (const r of c.required) observations.push(await observeCase(c, r, env, index));
    expect(observations.length).toBe(picked.reduce((n, c) => n + c.required.length, 0));
    const g = gradeCorpus({ cases: picked, requests, references, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "corpus", proofs, manifest, contexts } });
    // Pipeline properties: nothing malformed, every reference verified against the real proof, no invented or wrong answer.
    expect(g.integrityIssues).toEqual([]);
    expect(g.evidenceProblems).toEqual([]);
    expect(g.evidenceClass).toBe("native-verified");
    expect(g.wrongAccepted).toEqual([]);
    // It is a sample, so no gate can pass; the zero-case scenario families keep the family gate shut.
    expect(g.gates.families).toBe(false); expect(g.passed).toBe(false);
    expect(g.families.filter(f => f.status === "NOT MEASURED").map(f => f.family).every(f => /^m[345]:/.test(f))).toBe(true);
    const misses = g.issues.filter(m => /no verified completed result|required .* not proved/.test(m));
    // A sample miss is a finding about the app or the gold, never a harness pass condition. Recorded for the report.
    if (process.env.M6_ROUTE_SAMPLE_OUT) writeFileSync(process.env.M6_ROUTE_SAMPLE_OUT, JSON.stringify({ cases: picked.length, observations: observations.length, financialTexts: g.financialTexts, core: g.core, longTail: g.longTail, requiredStops: g.requiredStops, outOfScope: g.outOfScopeReport.length, misses }, null, 1));
  }, 120_000);


  it("example L12 (\"compare this month to last month\") reuses valid exact references: the three corpus cases with that text are answered through the real card, on the native-verified proof, with no wrong acceptance", async () => {
    const mapped = cases.filter(c => c.text === "compare this month to last month");
    expect(mapped.map(c => c.id).sort()).toEqual(["m1/101-0067", "m1/202-0117", "m1/303-0017"]);
    const index = buildReplyIndex(env), observations: Observation[] = [];
    for (const c of mapped) for (const r of c.required) observations.push(await observeCase(c, r, env, index));
    const g = gradeCorpus({ cases: mapped, requests, references, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "corpus", proofs, manifest, contexts } });
    expect(g.integrityIssues).toEqual([]); expect(g.evidenceProblems).toEqual([]); expect(g.wrongAccepted).toEqual([]);
    expect(g.financialTexts).toBe(1); expect(g.core).toEqual({ total: 1, direct: 1, withinOne: 1 });
  }, 60_000);

  it("a card that renders a different figure than the reply it was given is a wrong acceptance (harness detection power)", async () => {
    const c = cases.find(x => x.population === "P-CORE")!;
    const r = c.required[0];
    const index = buildReplyIndex(env);
    const real = await observeCase(c, r, env, index);
    expect(real.stage).toBe("result");
    expect((real.result as { displayMismatch?: boolean }).displayMismatch).toBeUndefined();
    const good = [real];
    for (const requirement of c.required.slice(1)) good.push(await observeCase(c, requirement, env, index));
    const grade = (observations: Observation[]) => gradeCorpus({ cases: [c], requests, references, observations,
      requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "corpus", proofs, manifest, contexts } });
    expect(grade(good).financialTexts).toBe(1);
    // Deliberately corrupt the real DOM immediately before its comparison. The old
    // version copied the reply map unchanged and never introduced any fault.
    const altered = new Map(index);
    const read = altered.get.bind(altered);
    let reads = 0;
    const spy = vi.spyOn(altered, "get").mockImplementation(key => {
      if (++reads === 2) {
        const headline = document.querySelector(".ledger-qa-headline");
        expect(headline).not.toBeNull();
        headline!.textContent = "A deliberately wrong rendered amount.";
      }
      return read(key);
    });
    try {
      const mismatch = await observeCase(c, r, env, altered);
      expect(reads).toBe(2);
      expect(mismatch.stage).toBe("result");
      expect((mismatch.result as { displayMismatch?: string[] }).displayMismatch?.length).toBeGreaterThan(0);
      const g = grade([mismatch, ...good.slice(1)]);
      expect(g.wrongAccepted).toContain(`${c.id}/${r.contextId}/${r.seed}`);
      expect(g.financialTexts).toBe(0);
    } finally { spy.mockRestore(); }
  }, 30_000);

  it("a request that has no frozen reference gets no borrowed answer", async () => {
    const c = { ...cases.find(x => x.population === "P-CORE")! };
    const r = c.required[0];
    const empty = new Map<string, unknown>();
    const o = await observeCase(c, r, env, empty);
    expect(o.stage).toBe("error"); expect(o.accepted).toEqual([]);
  }, 30_000);
});
