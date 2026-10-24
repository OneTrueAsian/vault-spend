import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scenarioProofProblems } from "../testSupport/askVaultM6/scenarioNativeProof";

/**
 * Owner decision Q5. The retained native proof of the focused scenario prerequisites test is checked against the frozen inputs; staleness, a forged digest and a
 * proof that overstates what it proves are each rejected. The ORIGINAL ordinary-spending proof is untouched (its SHA-256 is asserted). Real proof: retained from the
 * native run of 21 October 2026 (gap-remediation/native-proof-scenario-prerequisites.json, byte copy).
 */
const DIR = "src/testSupport/askVaultM6";
const read = (name: string) => readFileSync(`${DIR}/${name}`, "utf8");
const proofText = read("nativeProofs/native-proof-scenario-prerequisites.json");
const refs = JSON.parse(read("scenarioNativeReferences.json")).references as Record<string, { kind: string }>;
const fixtures = JSON.parse(read("scenarioNativeFixtures.json")).retirement as { id: string }[];
const expected = { baseline: Object.keys(refs).filter(k => refs[k].kind === "baseline"), thresholdBoundary: Object.keys(refs).filter(k => refs[k].kind === "threshold-boundary"), retirementContexts: fixtures.map(f => f.id) };
const input = (name: string) => read(name);

describe("native scenario prerequisites proof", () => {
  it("is a clean proof of 99 baseline-shaped reads, 5 threshold-boundary reads and 15 retirement-account contexts (3 for the examples, 12 for the M5 corpus) against the current inputs", () => {
    expect(expected.baseline).toHaveLength(99); expect(expected.thresholdBoundary).toHaveLength(5); expect(expected.retirementContexts).toHaveLength(15);
    expect(scenarioProofProblems(proofText, input, expected)).toEqual([]);
  });
  it("was produced by the native test: it carries native-computed digests, and says what it does and does not validate", () => {
    const proof = JSON.parse(proofText);
    expect(proof.proves).toMatch(/native context validation/); expect(proof.doesNotProve).toMatch(/JavaScript projection/);
    expect(Object.keys(proof.inputDigests)).toHaveLength(6);
  });
  it("keeps the original ordinary-spending proof byte for byte, separate from this one", () => {
    expect(createHash("sha256").update(read("nativeProofs/native-proof-ordinary.json")).digest("hex")).toBe("17f4d55bf53c7d4c78336ae25389b3039e61ce340405d8b832bb23eb6b30fd4d");
    expect(JSON.parse(read("nativeProofs/native-proof-ordinary.json")).test).toBe("ask_vault_m6_frozen_reference_worlds");
  });
  it("rejects a stale input, a forged digest, a wrong test, failures, an overstated proof and a different checked set", () => {
    const stale = (name: string) => (n: string) => (n === name ? input(n) + " " : input(n));
    for (const name of ["scenarioNativeFixtures.json", "scenarioNativeRequests.json", "scenarioNativeReferences.json", "contexts.json", "expectedRequests.json", "referenceResults.json"])
      expect(scenarioProofProblems(proofText, stale(name), expected), name).toContain(`stale input ${name}`);
    const edit = (change: (p: Record<string, any>) => void) => { const p = JSON.parse(proofText); change(p); return JSON.stringify(p); };
    expect(scenarioProofProblems(edit(p => { p.inputDigests["contexts.json"] = "0".repeat(64); }), input, expected)).toContain("stale input contexts.json");
    expect(scenarioProofProblems(edit(p => { delete p.inputDigests["contexts.json"]; }), input, expected)).toContain("no digest for contexts.json");
    expect(scenarioProofProblems(edit(p => { p.test = "other"; }), input, expected)).toContain("wrong test other");
    expect(scenarioProofProblems(edit(p => { p.failures = 1; }), input, expected)).toContain("failures 1");
    expect(scenarioProofProblems(edit(p => { p.doesNotProve = ""; }), input, expected)).toContain("does not say it leaves JavaScript projection unproved");
    expect(scenarioProofProblems(edit(p => { p.baseline.pop(); }), input, expected)).toContain("baseline reads checked differ from the frozen references");
    expect(scenarioProofProblems(edit(p => { p.retirementContexts = []; }), input, expected)).toContain("retirement contexts checked differ from the frozen fixtures");
    expect(scenarioProofProblems("not json", input, expected)).toEqual(["proof is not JSON"]);
  });
});
