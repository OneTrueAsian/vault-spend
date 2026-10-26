// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import { countKey } from "../testSupport/askVaultM6/counting";
import { m5CompletingIds, m5Cases, m5ExpectedResult, m5References, m5Requests, M5_SEEDS, type M5Fixture } from "../testSupport/askVaultM6/m5Scenario";
import type { CorpusCase, Observation } from "../testSupport/askVaultM6/manifest";
import { referenceIdentity, verifyNativeEvidence } from "../testSupport/askVaultM6/nativeEvidence";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";
import { observeM5Case } from "../testSupport/askVaultM6/routeHarnessM5";
import { m5StopCases } from "../testSupport/askVaultM6/scenarioPreparation";
import { RETIREMENT_CORPUS } from "./retirementCorpus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Task-4 item 6, M5 conversion (owner instruction of 21 October 2026). Writes (once) and checks the frozen M5 scenario package:
 * 28 completing cases with full intended requests, 84 separate exact results (3 seeds) from the independent model, each linked to a native-validated retirement context.
 * Then it drives the REAL card for every case and seed, and for the 42 stop cases and the m5c-027 refusal, and grades the observations against the real native context proof.
 */
const DIR = "src/testSupport/askVaultM6";
const read = (name: string) => readFileSync(`${DIR}/${name}`, "utf8");
const json = (name: string) => JSON.parse(read(name));
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const PROOF_FILE = "native-proof-scenario-prerequisites.json";
const fixtures = (json("scenarioNativeFixtures.json").retirement as M5Fixture[]).filter(f => f.id.startsWith("m6-m5-"));
const OUT = ["scenarioM5Cases.json", "scenarioM5Requests.json", "scenarioM5References.json", "scenarioM5Contexts.json", "scenarioM5EvidenceManifest.json"];

if (process.env.M6_WRITE_M5_SCENARIO === "1") {
  if (OUT.some(f => existsSync(`${DIR}/${f}`))) throw new Error("The M5 scenario package already exists; a change needs a new, disclosed version.");
  const proofSha = sha(read(`nativeProofs/${PROOF_FILE}`));
  const requests = m5Requests(), references = m5References(fixtures, id => `${PROOF_FILE}#sha256:${proofSha}#${id}`);
  const contexts = { worlds: Object.fromEntries(fixtures.map(f => [f.id, f.seed])),
    contexts: Object.fromEntries(fixtures.map(f => [f.id, { seed: f.worldSeed, worldId: f.id, parseContext: { today: f.today, accountId: f.accountId, accountName: f.expected.reply.account.name } }])) };
  const cache = new Map<string, string>();
  const identities = Object.fromEntries(Object.entries(references).map(([id, r]) => [id, referenceIdentity(r as never, requests, contexts as never, cache)]));
  const w = (name: string, value: unknown) => writeFileSync(`${DIR}/${name}`, JSON.stringify(value, null, 1) + "\n");
  w("scenarioM5Cases.json", m5Cases()); w("scenarioM5Requests.json", requests);
  w("scenarioM5References.json", { version: "m6-scenario-m5-references-1", writtenBy: "session bec4530a-cba4-40c4-b585-ecb9aed91bfa, 2026-10-21", references });
  w("scenarioM5Contexts.json", contexts);
  w("scenarioM5EvidenceManifest.json", { version: "m6-scenario-m5-evidence-manifest-1", proofs: { [PROOF_FILE]: { sha256: proofSha } }, identities });
}

const cases = json("scenarioM5Cases.json") as CorpusCase[], requests = json("scenarioM5Requests.json"), references = json("scenarioM5References.json").references, contexts = json("scenarioM5Contexts.json");
const manifest = json("scenarioM5EvidenceManifest.json"), proofText = read(`nativeProofs/${PROOF_FILE}`);

describe("the M5 scenario package: requests, separate exact results, native context links", () => {
  it("holds the 28 completing cases of the frozen M5 corpus, each on three seeds, with a full intended request and one reference per seed (84)", () => {
    expect(cases).toHaveLength(28); expect(Object.keys(references)).toHaveLength(84); expect(Object.keys(requests)).toHaveLength(28);
    expect(cases.map(c => c.id.slice(3)).sort()).toEqual([...m5CompletingIds()].sort());
    for (const c of cases) { expect(c.population).toBe("P-CORE"); expect(c.required.map(r => r.seed)).toEqual(M5_SEEDS); expect(c.required.every(r => r.requiresConsent)).toBe(true); }
    expect(cases.some(c => c.id === "m5/m5c-027")).toBe(false);   // the numeric-boundary refusal is P-NR, never an estimate
  });
  it("every full intended request names account, extra, start, month, the consent path for the return and the display unit", () => {
    for (const q of Object.values(requests) as Record<string, any>[]) {
      expect(Object.keys(q).sort()).toEqual(["accountName", "displayUnit", "extra", "family", "retirementMonth", "returnChoice", "startDate"]);
      expect(q.startDate).toBe("today"); expect(q.displayUnit).toBe("future-dollars"); expect(["question", "saved-plan"]).toContain(q.returnChoice.source);
    }
  });
  it("the seeds really differ: the same request has a different exact result on each seed, so a result cannot be borrowed across seeds", () => {
    for (const c of cases) { const vals = c.required.map(r => JSON.stringify(references[r.referenceId!].value)); expect(new Set(vals).size, c.id).toBeGreaterThan(1); }
  });
  it("each result is recomputed from the seed's native context by the independent model", () => {
    for (const c of cases) for (const r of c.required) {
      const gold = RETIREMENT_CORPUS.find(x => x.id === c.id.slice(3))!, fixture = fixtures.find(f => f.id === r.contextId)!;
      expect(references[r.referenceId!].value, `${c.id} ${r.seed}`).toEqual(m5ExpectedResult(gold, fixture));
    }
  });
  it("all 84 references verify against the real native context proof; the proof validates the context only, and the calculation is stated to be a separate JavaScript model", () => {
    const v = verifyNativeEvidence({ references, requests, contexts, proofs: { [PROOF_FILE]: proofText }, manifest });
    expect(v.problems).toEqual([]); expect(v.verified.size).toBe(84);
    expect(JSON.parse(proofText).doesNotProve).toMatch(/JavaScript projection/);
    for (const r of Object.values(references) as { calculation: string }[]) expect(r.calculation).toMatch(/JavaScript projection, not native/);
  });
  it("a stale request, a swapped context and a changed result are caught", () => {
    const anyId = Object.keys(references)[0];
    const bad = (change: (x: any) => void) => { const copy = JSON.parse(JSON.stringify({ references, requests, contexts })); change(copy); return verifyNativeEvidence({ ...copy, proofs: { [PROOF_FILE]: proofText }, manifest }).problems.map(p => p.code); };
    expect(bad(x => { x.requests[x.references[anyId].requestId].retirementMonth = "2051-01"; })).toContain("identity-mismatch");
    expect(bad(x => { x.references[anyId].value.extraDeposits = "1.00"; })).toContain("identity-mismatch");
    expect(bad(x => { x.contexts.worlds[x.references[anyId].contextId].plans[0].monthly = "1.00"; })).toContain("identity-mismatch");
    expect(bad(x => { x.references[anyId].contextId = "m6-m5-seed-101-account-8"; })).toContain("receipt-context-mismatch");
  });
});

describe("the real card against the M5 gold: completing cases, stops and the m5c-027 refusal", () => {
  it("every observation is graded on the real context proof; nothing malformed, no wrong acceptance; a sample summary is written for the report", async () => {
    const stops = m5StopCases();
    const all = [...cases, ...stops];
    const observations: Observation[] = [];
    for (const c of all) for (const r of c.required) observations.push(await observeM5Case(c, r, fixtures));
    const g = gradeCorpus({ cases: all, requests, references, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "corpus", proofs: { [PROOF_FILE]: proofText }, manifest, contexts } });
    if (process.env.M6_M5_SUMMARY_OUT) writeFileSync(process.env.M6_M5_SUMMARY_OUT, JSON.stringify({ cases: all.length, observations: observations.length, financialTexts: g.financialTexts, core: g.core, requiredStops: g.requiredStops, wrongAccepted: g.wrongAccepted,
      integrityIssues: g.integrityIssues, evidenceProblems: g.evidenceProblems, families: g.families.filter(f => f.family.startsWith("m5:")), issues: g.issues }, null, 1));
    expect(g.evidenceProblems).toEqual([]); expect(g.integrityIssues).toEqual([]); expect(g.wrongAccepted).toEqual([]);
    expect(g.core.direct).toBe(g.core.total);
    expect(g.financialTexts).toBe(new Set(cases.map(c => countKey(c.text))).size);
    expect(g.requiredStops.failed).toBe(0);
    expect(g.families.filter(f => f.family.startsWith("m5:") && !f.outcomes.includes("routing")).every(f => f.status === "PASS")).toBe(true);
  }, 600_000);
});
