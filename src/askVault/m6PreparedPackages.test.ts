import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { preparedCaseGroups, preparedRoutingCases } from "../testSupport/askVaultM6/preparedPackages";
import { computeFreeze } from "../testSupport/askVaultM6/freeze";
import { verifyNativeEvidence } from "../testSupport/askVaultM6/nativeEvidence";
import { m4Expected, m4Intent, m4Rows, nativeM4Input } from "../testSupport/askVaultM6/m4Scenario";

describe("complete task-4 preparation inventory", () => {
  it("includes every original ordinary case plus M3, M4, M5 completing/stopping and history packages without changing their populations", () => {
    const groups = preparedCaseGroups();
    expect(Object.keys(groups)).toEqual(["ordinary", "m3", "m4", "m5", "history"]);
    expect(groups.ordinary).toHaveLength(2159); expect(groups.m3).toHaveLength(480); expect(groups.m4).toHaveLength(24); expect(groups.m5).toHaveLength(70); expect(groups.history).toHaveLength(6);
    expect(groups.m5.find(c => c.id === "m5/m5c-027")?.population).toBe("P-NR");
    expect(preparedRoutingCases()).toHaveLength(7);
  });
  it("binds all scenario/grading/harness/oracle/typo files and the routing/history fixtures in the next freeze", () => {
    const freeze = computeFreeze();
    for (const f of ["m3Scenario.ts", "m4Scenario.ts", "m5Scenario.ts", "routeHarness.tsx", "routeHarnessM3.tsx", "routeHarnessM4.tsx", "routeHarnessM5.tsx", "displayCheck.ts", "m5Model.ts", "typoRules.json", "flaggedDispositions.json", "historyCases.json", "routingCases.json", "scenarioM4References.json", "nativeProofs/native-proof-scenario-prerequisites.json"]) expect(freeze.files[f], f).toMatch(/^[a-f0-9]{64}$/);
  });
  it("every M4 reference has separate exact arithmetic and both category baselines checked by the native proof", () => {
    const read = (n: string) => readFileSync(`src/testSupport/askVaultM6/${n}`, "utf8"), json = (n: string) => JSON.parse(read(n));
    const references = json("scenarioM4References.json").references, requests = json("scenarioM4Requests.json"), contexts = json("scenarioM4Contexts.json");
    const proofFile = "native-proof-scenario-prerequisites.json", proof = JSON.parse(read(`nativeProofs/${proofFile}`));
    const v = verifyNativeEvidence({ references, requests, contexts, manifest: json("scenarioM4EvidenceManifest.json"), proofs: { [proofFile]: read(`nativeProofs/${proofFile}`) } });
    expect(v.problems).toEqual([]); expect(v.verified.size).toBe(72);
    for (const row of m4Rows()) for (const seed of [101, 202, 303]) {
      const id = `m4q-${row.id.slice(3)}-${seed}`, ref = references[id];
      expect(ref.value).toEqual(m4Expected(m4Intent(row), nativeM4Input(row, seed).baselines));
      expect(ref.nativeItems).toHaveLength(2);
      for (const nativeId of ref.nativeItems) expect(proof.baseline.filter((id: string) => id === nativeId)).toHaveLength(1);
    }
  });
});
