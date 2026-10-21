import { createHash } from "node:crypto";

/**
 * Owner decision Q5: checks the proof written by the focused native test `ask_vault_m6_scenario_prerequisites` (core/src/store/tests/ask_vault_m6.rs). The digests were
 * produced by the native test itself (sha2 over the exact text it consumed through include_str!), so a proof is current only while every input file still hashes to them.
 * The proof validates NATIVE CONTEXT (what the store reads). It says so, and it says it does not validate any JavaScript projection. Test-only.
 */
export const SCENARIO_NATIVE_TEST = "ask_vault_m6_scenario_prerequisites";
export const SCENARIO_NATIVE_INPUTS = ["scenarioNativeFixtures.json", "scenarioNativeRequests.json", "scenarioNativeReferences.json", "contexts.json", "expectedRequests.json", "referenceResults.json"] as const;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export function scenarioProofProblems(proofText: string, readInput: (name: string) => string, expected: { baseline: string[]; thresholdBoundary: string[]; retirementContexts: string[] }): string[] {
  let proof: { test?: string; failures?: number; proves?: string; doesNotProve?: string; inputDigests?: Record<string, string>; baseline?: string[]; thresholdBoundary?: string[]; retirementContexts?: string[] };
  try { proof = JSON.parse(proofText); } catch { return ["proof is not JSON"]; }
  const problems: string[] = [];
  if (proof.test !== SCENARIO_NATIVE_TEST) problems.push(`wrong test ${proof.test}`);
  if (proof.failures !== 0) problems.push(`failures ${proof.failures}`);
  if (!/native context/i.test(proof.proves ?? "")) problems.push("does not say it proves native context validation");
  if (!/JavaScript projection/i.test(proof.doesNotProve ?? "")) problems.push("does not say it leaves JavaScript projection unproved");
  for (const name of SCENARIO_NATIVE_INPUTS) {
    const recorded = proof.inputDigests?.[name];
    if (!recorded) problems.push(`no digest for ${name}`);
    else if (recorded !== sha(readInput(name))) problems.push(`stale input ${name}`);
  }
  const same = (a: string[] | undefined, b: string[]) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
  if (!same(proof.baseline, expected.baseline)) problems.push("baseline reads checked differ from the frozen references");
  if (!same(proof.thresholdBoundary, expected.thresholdBoundary)) problems.push("threshold-boundary reads checked differ from the frozen references");
  if (!same(proof.retirementContexts, expected.retirementContexts)) problems.push("retirement contexts checked differ from the frozen fixtures");
  return problems;
}
