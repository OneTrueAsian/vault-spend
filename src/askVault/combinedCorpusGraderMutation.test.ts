import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import type { CorpusCase, GradingInput, Observation, Reference } from "../testSupport/askVaultM6/manifest";
import { referenceIdentity } from "../testSupport/askVaultM6/nativeEvidence";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";

/**
 * Task-4 item 6, grader detection power (Validation-Plan VP-06, CG-05/06/12). Every single-leaf change to a correct, fully verified observation set must be
 * caught: the changed case earns no financial credit, and where the change makes an accepted answer wrong it is recorded as a wrong acceptance. The
 * mutations are generated from the data itself (every leaf of the request and the result), so a field the grader forgot to compare cannot hide.
 * Everything here is synthetic and deliberately fabricated; it is not corpus evidence.
 */
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const SEEDS = [101, 202, 303];
const request = { kind: "compare", periods: [{ from: "2026-09-01", to: "2026-09-06" }, { from: "2026-08-01", to: "2026-08-06" }], accountIds: [], categories: ["Clothing"],
  minimumPurchase: { amount: "100.00", inclusive: false }, vendors: [], excludeVendors: [], excludeCategories: [], limit: 1, expectedRevision: null, contractVersion: 2,
  members: { ids: [2], unassigned: false }, groupBy: "none", average: "none", alignment: "same-days-previous-month" };
const result = { contractVersion: 2, asOf: "2026-09-06", kind: "compare", periods: [{ total: "120.00", purchaseCount: 2, categories: [{ category: "Clothing", amount: "120.00" }] }, { total: "60.00", purchaseCount: 1, categories: [] }],
  difference: "60.00", comparison: { comparable: true, absoluteChange: "60.00", percentChange: "100.0", percentOutcome: "changed" } };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function build() {
  const cases: CorpusCase[] = [{ id: "one", text: "compare purchases over $100", population: "P-CORE", family: "m2:comparison-threshold", cluster: "c", tags: [],
    required: SEEDS.map(seed => ({ seed, contextId: "c" + seed, requestId: "q", referenceId: "r" + seed, requiresConsent: true })) }];
  const requests: Record<string, unknown> = { q: clone(request) };
  const contexts = { worlds: { w: { today: "2026-09-06" } }, contexts: Object.fromEntries(SEEDS.map(s => ["c" + s, { seed: s, worldId: "w", parseContext: { today: "2026-09-06" } }])) };
  const proofText = JSON.stringify({ test: "ask_vault_m6_frozen_reference_worlds", checked: SEEDS.map(s => "r" + s), failures: 0 });
  const references: Record<string, Reference> = Object.fromEntries(SEEDS.map(s => ["r" + s, { value: clone(result), seed: s, contextId: "c" + s, requestId: "q", nativeReceipt: `p.json#sha256:${sha(proofText)}#r${s}` }]));
  const observations: Observation[] = SEEDS.map(seed => ({ caseId: "one", seed, contextId: "c" + seed, stage: "result", meaningChoices: 0, accepted: [{ request: clone(request), result: clone(result) }], request: clone(request), result: clone(result), reviewed: true, consented: true }));
  const manifest = { proofs: { "p.json": { sha256: sha(proofText) } }, identities: Object.fromEntries(SEEDS.map(s => ["r" + s, referenceIdentity(references["r" + s], requests, contexts)])) };
  const input: GradingInput = { cases, requests, references, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "corpus", contexts, proofs: { "p.json": proofText }, manifest } };
  return { input, proofText };
}

/** Every leaf path of a JSON value, e.g. ["periods", 0, "from"]. */
function leaves(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) return value.length ? value.flatMap((v, i) => leaves(v, [...path, i])) : [path];
  if (value !== null && typeof value === "object") { const e = Object.entries(value); return e.length ? e.flatMap(([k, v]) => leaves(v, [...path, k])) : [path]; }
  return [path];
}
function mutateAt(root: unknown, path: (string | number)[]): unknown {
  const copy = clone(root);
  if (!path.length) return "mutated";
  let holder: any = copy;
  for (const p of path.slice(0, -1)) holder = holder[p];
  const last = path[path.length - 1], old = holder[last];
  holder[last] = typeof old === "number" ? old + 1 : typeof old === "boolean" ? !old : typeof old === "string" ? old + "x" : old === null ? "x" : Array.isArray(old) ? [...old, "x"] : { ...old, extra: 1 };
  return copy;
}

describe("grader detection power: the unmutated fixture is a clean, verified pass for its case", () => {
  it("credits the text once, with no issue of any kind", () => {
    const g = gradeCorpus(build().input);
    expect(g.issues).toEqual([]); expect(g.financialTexts).toBe(1); expect(g.wrongAccepted).toEqual([]); expect(g.evidenceClass).toBe("native-verified");
  });
});

describe("grader detection power: every single-leaf mutation is caught", () => {
  const requestPaths = leaves(request), resultPaths = leaves(result);
  it("covers a meaningful number of mutations (so an empty loop cannot pass)", () => { expect(requestPaths.length + resultPaths.length).toBeGreaterThan(30); });
  it.each(requestPaths.map(p => [p.join(".")] as const))("the observed request changed at %s: no credit, wrong acceptance recorded", path => {
    const { input } = build(); const p = path.split(".").map(x => (/^\d+$/.test(x) ? Number(x) : x));
    const obs = input.observations[0]; obs.request = mutateAt(obs.request, p); obs.accepted = [{ request: obs.request, result: obs.result }];
    const g = gradeCorpus(input);
    expect(g.financialTexts).toBe(0); expect(g.wrongAccepted.length).toBeGreaterThan(0);
  });
  it.each(resultPaths.map(p => [p.join(".")] as const))("the observed result changed at %s: no credit, wrong acceptance recorded", path => {
    const { input } = build(); const p = path.split(".").map(x => (/^\d+$/.test(x) ? Number(x) : x));
    const obs = input.observations[1]; obs.result = mutateAt(obs.result, p); obs.accepted = [{ request: obs.request, result: obs.result }];
    const g = gradeCorpus(input);
    expect(g.financialTexts).toBe(0); expect(g.wrongAccepted.length).toBeGreaterThan(0);
  });
  it.each(requestPaths.map(p => [p.join(".")] as const))("the frozen request changed at %s after the native run: stale evidence, no credit", path => {
    const { input } = build(); const p = path.split(".").map(x => (/^\d+$/.test(x) ? Number(x) : x));
    input.requests.q = mutateAt(input.requests.q, p);
    const g = gradeCorpus(input);
    expect(g.financialTexts).toBe(0); expect(g.evidenceProblems.some(x => x.code === "identity-mismatch")).toBe(true);
  });
  it.each(resultPaths.map(p => [p.join(".")] as const))("the reference value changed at %s after the native run: stale evidence, no credit", path => {
    const { input } = build(); const p = path.split(".").map(x => (/^\d+$/.test(x) ? Number(x) : x));
    input.references.r303 = { ...input.references.r303, value: mutateAt(input.references.r303.value, p) };
    const g = gradeCorpus(input);
    expect(g.financialTexts).toBe(0); expect(g.evidenceProblems.some(x => x.code === "identity-mismatch")).toBe(true);
  });
  it.each([
    ["a changed context world", (i: GradingInput) => { (i.evidence as unknown as { contexts: { worlds: { w: { today: string } } } }).contexts.worlds.w.today = "2026-09-07"; }],
    ["a changed parse context", (i: GradingInput) => { (i.evidence as unknown as { contexts: { contexts: Record<string, { parseContext: { today: string } }> } }).contexts.contexts.c202.parseContext.today = "x"; }],
    ["a reference moved to another seed's context", (i: GradingInput) => { i.references.r101 = { ...i.references.r101, contextId: "c202" }; }],
    ["a reference pointed at another request", (i: GradingInput) => { i.requests.other = i.requests.q; i.references.r101 = { ...i.references.r101, requestId: "other" }; }],
    ["a flipped identity digest", (i: GradingInput) => { const m = (i.evidence as { manifest: { identities: Record<string, string> } }).manifest; m.identities.r101 = m.identities.r101.replace(/^./, c => (c === "0" ? "1" : "0")); }],
    ["proof bytes altered", (i: GradingInput) => { const e = i.evidence as { proofs: Record<string, string> }; e.proofs["p.json"] += " "; }],
    ["a receipt for a different id", (i: GradingInput) => { i.references.r101 = { ...i.references.r101, nativeReceipt: i.references.r101.nativeReceipt!.replace(/#r101$/, "#r202") }; }],
    ["a missing observation", (i: GradingInput) => { i.observations.pop(); }],
    ["a duplicated observation", (i: GradingInput) => { i.observations.push(clone(i.observations[0])); }],
    ["an observation for an unrequired seed", (i: GradingInput) => { i.observations[0] = { ...i.observations[0], seed: 404 }; }],
    ["consent not given", (i: GradingInput) => { i.observations[2] = { ...i.observations[2], consented: false }; }],
    ["review not shown", (i: GradingInput) => { i.observations[2] = { ...i.observations[2], reviewed: false }; }],
    ["an unnecessary meaning choice", (i: GradingInput) => { i.observations[0] = { ...i.observations[0], meaningChoices: 2 }; }],
    ["a draft instead of a result", (i: GradingInput) => { i.observations[0] = { ...i.observations[0], stage: "draft" }; }],
    ["a refusal instead of a result", (i: GradingInput) => { i.observations[0] = { ...i.observations[0], stage: "refusal", accepted: [], request: undefined, result: undefined }; }],
  ])("%s: no financial credit", (_name, change) => {
    const { input } = build(); change(input);
    const g = gradeCorpus(input);
    const fullCredit = g.financialTexts === 1 && g.core.direct === 1 && g.integrityIssues.length === 0;
    expect(fullCredit).toBe(false);
  });
  it("a changed required-family list, a missing evidence block and fabricated stand-in evidence each remove admissibility", () => {
    const a = build().input; a.requiredFamilies = a.requiredFamilies.slice(1); expect(gradeCorpus(a).registryBound).toBe(false);
    const b = build().input; delete (b as Partial<GradingInput>).evidence; expect(gradeCorpus(b).financialTexts).toBe(0);
    const c = build().input; c.evidence = { kind: "unit-stand-in" }; expect(gradeCorpus(c).gates.admissibleEvidence).toBe(false);
  });
});
