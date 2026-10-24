// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonical } from "../testSupport/askVaultM6/counting";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import { M3_SEEDS, M3_TODAY, m3Cases, m3ExpectedResult, m3Intent, m3ReferenceId, m3RequestId, m3Rows, m3WorldId, type M3Result, type NativeMonth } from "../testSupport/askVaultM6/m3Scenario";
import type { CorpusCase, Observation } from "../testSupport/askVaultM6/manifest";
import { referenceIdentity, verifyNativeEvidence } from "../testSupport/askVaultM6/nativeEvidence";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";
import { m3IndexKey, observeM3Case, type M3Env } from "../testSupport/askVaultM6/routeHarnessM3";
import type { ParseContext } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Task-4 item 6, M3 conversion (owner instruction of 21 October 2026): the 480 retained catalogue prompts become P-CORE cases with the 60 gold intents as full intended requests
 * and 180 separate exact results (intent x seed) from an independent integer-cent calculator over each seed's native baseline read. The real card is then driven for every
 * case and seed, and graded on the real native proof. See m3Scenario.ts for the method and its provenance caveat.
 */
const DIR = "src/testSupport/askVaultM6";
const read = (name: string) => readFileSync(`${DIR}/${name}`, "utf8");
const json = (name: string) => JSON.parse(read(name));
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const PROOF_FILE = "native-proof-scenario-prerequisites.json";
const OUT = ["scenarioM3Cases.json", "scenarioM3Requests.json", "scenarioM3References.json", "scenarioM3Contexts.json", "scenarioM3EvidenceManifest.json", "scenarioM3Excluded.json"];
const nativeRefs = json("scenarioNativeReferences.json").references as Record<string, { kind: string; worldId: string; label: string; value: { periods: { months: NativeMonth[] }[] } }>;
const baselineFor = (seed: number, category: string) => Object.entries(nativeRefs).find(([, r]) => r.kind === "baseline" && r.worldId === m3WorldId(seed) && r.label === category)!;

if (process.env.M6_WRITE_M3_SCENARIO === "1") {
  if (OUT.some(f => existsSync(`${DIR}/${f}`))) throw new Error("The M3 scenario package already exists; a change needs a new, disclosed version.");
  const rows = m3Rows(), intents = new Map(rows.map(r => [m3RequestId(r), m3Intent(r)]));
  const resultOf = (requestId: string, seed: number): M3Result => { const intent = intents.get(requestId)!; return m3ExpectedResult(intent, baselineFor(seed, intent.category)[1].value.periods[0].months); };
  const { cases, mixed, refusedEverywhere } = m3Cases((requestId, seed) => resultOf(requestId, seed).outcome);
  const proofSha = sha(read(`nativeProofs/${PROOF_FILE}`)), requests: Record<string, unknown> = {}, references: Record<string, unknown> = {};
  for (const [requestId, intent] of intents) {
    if (!cases.some(c => c.required[0].requestId === requestId)) continue;
    requests[requestId] = intent;
    for (const seed of M3_SEEDS) {
      const [baselineId] = baselineFor(seed, intent.category);
      references[m3ReferenceId(requestId, seed)] = { value: resultOf(requestId, seed), seed, contextId: m3WorldId(seed), requestId, nativeItem: baselineId, nativeReceipt: `${PROOF_FILE}#sha256:${proofSha}#${baselineId}`,
        calculation: "independent integer-cent calculator (src/testSupport/askVaultM6/m3Scenario.ts): JavaScript projection, not native" };
    }
  }
  const ordinary = json("contexts.json");
  const contexts = { worlds: Object.fromEntries(M3_SEEDS.map(s => [m3WorldId(s), ordinary.worlds[m3WorldId(s)]])), contexts: Object.fromEntries(M3_SEEDS.map(s => [m3WorldId(s), { seed: s, worldId: m3WorldId(s), parseContext: { today: M3_TODAY } }])) };
  const cache = new Map<string, string>();
  const identities = Object.fromEntries(Object.entries(references).map(([id, r]) => [id, referenceIdentity(r as never, requests, contexts as never, cache)]));
  const w = (name: string, value: unknown) => writeFileSync(`${DIR}/${name}`, JSON.stringify(value, null, 1) + "\n");
  w("scenarioM3Cases.json", cases); w("scenarioM3Requests.json", requests);
  w("scenarioM3References.json", { version: "m6-scenario-m3-references-1", writtenBy: "session bec4530a-cba4-40c4-b585-ecb9aed91bfa, 2026-10-21", references });
  w("scenarioM3Contexts.json", contexts); w("scenarioM3EvidenceManifest.json", { version: "m6-scenario-m3-evidence-manifest-1", proofs: { [PROOF_FILE]: { sha256: proofSha } }, identities });
  w("scenarioM3Excluded.json", { note: "Rows whose outcome is not the same on all three seeds, or that every seed refuses, are not P-CORE completions. Disclosed, never dropped silently.", mixedOutcome: mixed, refusedOnEverySeed: refusedEverywhere });
}

const cases = json("scenarioM3Cases.json") as CorpusCase[], requests = json("scenarioM3Requests.json"), references = json("scenarioM3References.json").references, contexts = json("scenarioM3Contexts.json");
const manifest = json("scenarioM3EvidenceManifest.json"), excluded = json("scenarioM3Excluded.json"), proofText = read(`nativeProofs/${PROOF_FILE}`);

describe("the M3 scenario package: gold intents, separate exact results, native baseline links", () => {
  it("rebuilds the 480 retained rows (3 categories: 288 monthly money, 144 monthly percentage, 48 one-time money) and the 60 distinct gold intents", () => {
    const rows = m3Rows();
    expect(rows).toHaveLength(480);
    expect(rows.filter(r => r.kind === "money" && r.cadence === "monthly")).toHaveLength(288); expect(rows.filter(r => r.kind === "percent")).toHaveLength(144); expect(rows.filter(r => r.cadence === "once")).toHaveLength(48);
    expect(new Set(rows.map(m3RequestId)).size).toBe(60);
    expect(new Set(rows.map(r => canonical(r.text.toLowerCase()))).size).toBeLessThanOrEqual(480);
  });
  it("accounts for every row: a P-CORE completion on all three seeds, or disclosed as mixed-outcome / refused on every seed", () => {
    expect(cases.length + excluded.mixedOutcome.length + excluded.refusedOnEverySeed.length).toBe(480);
    for (const c of cases) { expect(c.population).toBe("P-CORE"); expect(c.required.map(r => r.seed)).toEqual(M3_SEEDS); expect(c.required.every(r => r.requiresConsent && r.referenceId)).toBe(true); }
  });
  it("every row's intent is the gold written beside the row (the 15 November once schedule, or November to December with whole months only)", () => {
    for (const [id, q] of Object.entries(requests) as [string, Record<string, any>][]) {
      expect(q.version).toBe(1); expect(q.horizon.kind).toBe("prospective");
      expect(q.cadence === "once" ? [q.horizon.from, q.horizon.to, q.partialMonth] : [q.horizon.from, q.horizon.to, q.partialMonth]).toEqual(q.cadence === "once" ? ["2026-11-15", "2026-11-15", "none"] : ["2026-11-01", "2026-12-31", "exclude"]);
      expect(id).toBe(m3RequestId({ text: "", category: q.category, amount: q.reduction.amount, kind: q.reduction.kind, cadence: q.cadence }));
    }
  });
  it("the seeds differ: the same intent has a different exact result on each seed (their native baselines differ)", () => {
    const different = Object.keys(requests).filter(rid => new Set(M3_SEEDS.map(s => JSON.stringify(references[m3ReferenceId(rid, s)].value))).size > 1);
    expect(different.length).toBeGreaterThan(Object.keys(requests).length / 2);
  });
  it("hand check: Dining $50 a month on seed 101 uses the 2 complete months (June $801.09, July $362.47): usual $581.78, total $100.00, limit $531.78", () => {
    const rid = m3RequestId({ text: "", category: "Dining", amount: "50", kind: "money", cadence: "monthly" });
    expect(references[m3ReferenceId(rid, 101)].value).toEqual({ outcome: "preview", monthsUsed: 2, usualMonth: "581.78", totalSaving: "100.00", months: [{ month: "November 2026", saved: "50.00" }, { month: "December 2026", saved: "50.00" }], monthlyLimit: "531.78" });
  });
  it("hand check: Groceries 33.33 percent on seed 101: usual (978.95 + 1,574.33) / 2 = 1,276.64; a month 425.50; total round(2 x 425.503392) = 851.01; limit 851.14", () => {
    const rid = m3RequestId({ text: "", category: "Groceries", amount: "33.33", kind: "percent", cadence: "monthly" });
    expect(references[m3ReferenceId(rid, 101)].value).toMatchObject({ usualMonth: "1276.64", totalSaving: "851.01", monthlyLimit: "851.14", months: [{ month: "November 2026", saved: "425.50" }, { month: "December 2026", saved: "425.50" }] });
  });
  it("all references verify against the real native proof: each names the baseline read it was computed from; the calculation is stated to be separate JavaScript", () => {
    const v = verifyNativeEvidence({ references, requests, contexts, proofs: { [PROOF_FILE]: proofText }, manifest });
    expect(v.problems).toEqual([]); expect(v.verified.size).toBe(Object.keys(references).length);
    for (const r of Object.values(references) as { calculation: string }[]) expect(r.calculation).toMatch(/JavaScript projection, not native/);
  });
});

describe("the real card against the M3 gold, on three seeds", () => {
  it("every observation is graded on the real proof: no malformed observation, no wrong acceptance; a summary is written for the report", async () => {
    const ordinary = json("contexts.json"), idx = new Map<number, Map<string, unknown>>();
    for (const seed of M3_SEEDS) { const m = new Map<string, unknown>(); for (const r of Object.values(nativeRefs)) if (r.kind === "baseline" && r.worldId === m3WorldId(seed)) m.set("", ""); idx.set(seed, m); }
    const requestsNative = json("scenarioNativeRequests.json"), refsNative = json("scenarioNativeReferences.json").references as Record<string, { kind: string; worldId: string; requestId: string; value: unknown }>;
    for (const seed of M3_SEEDS) { const m = new Map<string, unknown>(); for (const r of Object.values(refsNative)) if (r.kind === "baseline" && r.worldId === m3WorldId(seed)) m.set(m3IndexKey(requestsNative[r.requestId]), r.value); idx.set(seed, m); }
    const env = (seed: number): M3Env => ({ index: idx.get(seed)!, parseContext: { ...ordinary.contexts[`m1-origin-101-seed-${seed}`].parseContext, familyMembers: [] } as ParseContext });
    const observations: Observation[] = [];
    for (const c of cases) for (const r of c.required) observations.push(await observeM3Case(c, r, env));
    const g = gradeCorpus({ cases, requests, references, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "corpus", proofs: { [PROOF_FILE]: proofText }, manifest, contexts } });
    if (process.env.M6_M3_SUMMARY_OUT) writeFileSync(process.env.M6_M3_SUMMARY_OUT, JSON.stringify({ cases: cases.length, observations: observations.length, financialTexts: g.financialTexts, core: g.core, wrongAccepted: g.wrongAccepted.slice(0, 20), integrityIssues: g.integrityIssues.slice(0, 20), evidenceProblems: g.evidenceProblems.slice(0, 5),
      families: g.families.filter(f => f.family.startsWith("m3:")), issues: g.issues.slice(0, 40), stages: observations.reduce((n: Record<string, number>, o) => ({ ...n, [o.stage]: (n[o.stage] ?? 0) + 1 }), {}) }, null, 1));
    expect(g.evidenceProblems).toEqual([]); expect(g.integrityIssues).toEqual([]); expect(g.wrongAccepted).toEqual([]);
    expect(g.core.direct).toBe(g.core.total); expect(g.financialTexts).toBe(480);
    expect(g.families.filter(f => f.family.startsWith("m3:")).every(f => f.status === "PASS")).toBe(true);
  }, 900_000);
});
