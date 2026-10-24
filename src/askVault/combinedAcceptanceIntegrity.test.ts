import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gradeCombinedCorpus } from "../testSupport/askVaultM6/grader";
import type { CorpusCase, GradingInput, Observation } from "../testSupport/askVaultM6/manifest";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";
import { validateManifest } from "../testSupport/askVaultM6/counting";

const read = (name: string) => JSON.parse(readFileSync(`src/testSupport/askVaultM6/${name}`, "utf8"));
function input(): GradingInput {
  const c = (read("cases.json") as CorpusCase[]).find(c => c.population === "P-CORE")!;
  const requests = read("expectedRequests.json"), references = read("referenceResults.json");
  const observations: Observation[] = c.required.map(r => ({ caseId: c.id, contextId: r.contextId, seed: r.seed, stage: "result", meaningChoices: 0, request: requests[r.requestId!], result: references[r.referenceId!].value, accepted: [{ request: requests[r.requestId!], result: references[r.referenceId!].value }], reviewed: true, consented: true }));
  return { cases: [structuredClone(c)], observations, requests, references, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "corpus", manifest: read("nativeEvidenceManifest.json"), contexts: read("contexts.json"), proofs: { "native-proof-ordinary.json": readFileSync("src/testSupport/askVaultM6/nativeProofs/native-proof-ordinary.json", "utf8") } } };
}
describe("combined acceptance validates original proofs before namespace/global counting", () => {
  it("keeps frozen empty-input unsafe refusal fixtures, while rejecting empty financial, core or choice fixtures", () => {
    const c = (read("cases.json") as CorpusCase[]).find(c => c.id === "m1/101-0304")!;
    expect(c.text).toBe("");
    expect(() => validateManifest([c])).not.toThrow();
    expect(() => validateManifest([{...c,population:"P-CORE"}])).toThrow(/Incomplete/);
    expect(() => validateManifest([{...c,population:"P-NC"}])).toThrow(/Incomplete/);
    expect(() => validateManifest([{...c,required:c.required.map(r=>({...r,requestId:"financial",referenceId:"financial"}))}])).toThrow(/Incomplete/);
    expect(() => validateManifest([{...c,required:c.required.map(r=>({...r,stop:"clarification"}))}])).toThrow(/Incomplete/);
  });
  it("deduplicates identical texts across packages while preserving their colliding local IDs and all seeds", () => {
    const first = input(), second = input(), before = JSON.stringify([first, second]);
    const result = gradeCombinedCorpus([{ id: "ordinary", input: first }, { id: "alias", input: second }]);
    expect(result.integrityIssues).toEqual([]); expect(result.evidenceProblems).toEqual([]);
    expect(result.financialTexts).toBe(1); expect(result.core).toEqual({ total: 1, direct: 1, withinOne: 1 });
    expect(JSON.stringify([first, second])).toBe(before);
  });
  it("a failure in one aliased package cannot borrow the other package's passing result", () => {
    const first = input(), second = input(); second.observations[0] = { ...second.observations[0], stage: "refusal", accepted: [], request: undefined, result: undefined };
    const result = gradeCombinedCorpus([{ id: "ordinary", input: first }, { id: "alias", input: second }]);
    expect(result.financialTexts).toBe(0); expect(result.core.direct).toBe(0);
  });
  it("rejects a tampered original context before any namespace rewrite or count", () => {
    const first = input(), second = input();
    if (second.evidence.kind !== "corpus") throw Error("real corpus evidence required");
    const context = second.evidence.contexts.contexts[second.cases[0].required[0].contextId]; context.seed += 1;
    const result = gradeCombinedCorpus([{ id: "ordinary", input: first }, { id: "alias", input: second }]);
    expect(result.evidenceProblems.length).toBeGreaterThan(0); expect(result.financialTexts).toBe(0);
  });
  it("rejects duplicate package IDs rather than allowing object-spread overwrites", () => {
    expect(() => gradeCombinedCorpus([{ id: "same", input: input() }, { id: "same", input: input() }])).toThrow(/package/i);
  });
  it("does not promote unit stand-ins to native-verified aggregate evidence", () => {
    const x = input(); x.evidence = { kind: "unit-stand-in" };
    expect(() => gradeCombinedCorpus([{ id: "stand-in", input: x }])).toThrow(/corpus/i);
  });
});
