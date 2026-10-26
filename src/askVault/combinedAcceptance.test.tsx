// @vitest-environment jsdom
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadAcceptancePackages, gradeAcceptancePackages } from "../testSupport/askVaultM6/combinedAcceptance";
import { observeAcceptancePackage } from "../testSupport/askVaultM6/combinedAcceptanceRoutes";
import { computeFreeze } from "../testSupport/askVaultM6/freeze";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe("M6 complete combined acceptance, not a representative sample", () => {
  it("loads every frozen package, native identity, stop and nonfinancial routing obligation", () => {
    const packages = loadAcceptancePackages();
    expect(packages.map(p => [p.id, p.input.cases.length])).toEqual([["ordinary",2159],["m3",480],["m4",24],["m5",70],["history",6]]);
    expect(packages.reduce((n,p) => n+p.input.cases.reduce((m,c) => m+c.required.length,0),0)).toBe(8123);
    expect(packages.every(p => p.input.evidence.kind === "corpus")).toBe(true);
    expect(packages.every(p => p.input.observations.length === 0)).toBe(true);
  });
  it("grades all required original texts, contexts and seeds only after the successor freeze is signed", async () => {
    const freeze = JSON.parse(readFileSync("src/testSupport/askVaultM6/scoringFreeze.json","utf8"));
    expect(freeze.version).toBe("m6-acceptance-scoring-freeze-15");
    for (const [key,value] of Object.entries(computeFreeze())) expect(freeze[key],key).toEqual(value);
    const packages = loadAcceptancePackages();
    const save = (status: string, error?: string) => {
      if (process.env.M6_COMBINED_OUT) writeFileSync(process.env.M6_COMBINED_OUT,JSON.stringify({freezeVersion:freeze.version,status,error,packages:packages.map(p=>({id:p.id,cases:p.input.cases.map(c=>c.id),observations:p.input.observations,resolutionObservations:p.input.resolutionObservations??[],routingObservations:p.input.routingObservations??[]}))},null,1)+"\n");
    };
    try { for (const p of packages) { await observeAcceptancePackage(p); save(`observed-${p.id}`); } }
    catch (error) { save("observation-failed",String(error)); throw error; }
    const result = gradeAcceptancePackages(packages);
    if (process.env.M6_COMBINED_OUT) writeFileSync(process.env.M6_COMBINED_OUT,JSON.stringify({ freezeVersion:freeze.version, result, packages:packages.map(p=>({id:p.id,cases:p.input.cases.map(c=>c.id),observations:p.input.observations,resolutionObservations:p.input.resolutionObservations??[],routingObservations:p.input.routingObservations??[]})) },null,1)+"\n");
    expect(result.evidenceProblems).toEqual([]); expect(result.integrityIssues).toEqual([]);
    expect(result.wrongAccepted).toEqual([]);
    // Owner amendment D-R2 (21 October 2026, Task5-Remediation-Completion/Decisions-Ledger.md): the strict result and the original direct score of m1:several-stores stay reported,
    // and closure for that one family may rest on its separate resolution score. Every other gate is the strict gate, unchanged.
    const report = JSON.stringify({strictGates:result.gates,strictPassed:result.passed,familyResolution:result.familyResolution,gatesUnderAmendment:result.gatesUnderAmendment,core:result.core,longTail:result.longTail,families:result.families.filter(f=>f.status!=="PASS"),issues:result.issues.slice(0,20)});
    const row = result.families.find(f=>f.family==="m1:several-stores")!;
    expect(result.familyResolution?.direct,"the original direct score is reported beside the resolution score").toEqual({total:row.total,direct:row.direct});
    expect(result.passedUnderAmendment,report).toBe(true);
  },900_000);
});
