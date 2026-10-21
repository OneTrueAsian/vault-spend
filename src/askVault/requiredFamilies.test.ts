import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REQUIRED_FAMILIES, REQUIRED_FAMILY_IDS, requiredFamilyProblems } from "../testSupport/askVaultM6/registry";
import type { CorpusCase } from "../testSupport/askVaultM6/manifest";
import { retirementScoringPlan } from "./retirementCorpus";

// VP-07 (Validation-Plan.md:116-125) and CG-03 (Requirements-Checklist.md:94): the registry is authority-backed and complete,
// independent of which cases happen to exist today.
const cases: CorpusCase[] = JSON.parse(readFileSync("src/testSupport/askVaultM6/cases.json", "utf8"));
describe("required-family registry (authority-backed, not derived from the cases present)", () => {
  it("lists every family once, each with a milestone, an authority citation and its gate", () => {
    expect(new Set(REQUIRED_FAMILY_IDS).size).toBe(REQUIRED_FAMILY_IDS.length);
    for (const f of REQUIRED_FAMILIES) {
      expect(f.id).toMatch(/^m[1-5]:[a-z0-9-]+$/);
      expect(f.authority.length).toBeGreaterThan(10);
      expect(f.gate.length).toBeGreaterThan(10);
      if (f.outcomes.includes("completion")) expect(f.gate).toMatch(/90%/);
      expect(f.applicability).toBe("applicable");
    }
  });
  it("covers M1 ordinary, M2 extended, M3 spending, M4 savings and M5 retirement", () => {
    const by = (m: string) => REQUIRED_FAMILIES.filter(f => f.milestone === m).length;
    expect([by("M1"), by("M2"), by("M3"), by("M4"), by("M5")]).toEqual([10, 9, 3, 2, 18]);
  });
  it("contains exactly the M5 families the frozen retirement scoring plan defines (src/askVault/retirementCorpus.ts)", () => {
    const m5 = REQUIRED_FAMILIES.filter(f => f.milestone === "M5").map(f => f.id.slice(3)).sort();
    expect(m5).toEqual(Object.keys(retirementScoringPlan().families).sort());
  });
  it("contains every family that has P-CORE cases today, so no present case escapes the gate", () => {
    const present = new Set(cases.filter(c => c.population === "P-CORE").map(c => c.family));
    expect([...present].filter(f => !REQUIRED_FAMILY_IDS.includes(f))).toEqual([]);
  });
  it("includes applicable families that currently have zero cases, which is exactly why the list is not derived from cases", () => {
    const present = new Set(cases.filter(c => c.population === "P-CORE").map(c => c.family));
    const zero = REQUIRED_FAMILY_IDS.filter(f => !present.has(f));
    expect(zero.length).toBeGreaterThan(0);
    expect(zero.every(f => /^m[345]:/.test(f))).toBe(true);
  });
  it("compares caller lists as sets of exact IDs", () => {
    expect(requiredFamilyProblems([...REQUIRED_FAMILY_IDS].reverse())).toEqual([]);
    expect(requiredFamilyProblems([]).length).toBe(REQUIRED_FAMILY_IDS.length);
  });
});

// ---- Owner decision Q2 (21 October 2026): confirmed families, conditional crosswalk, and outcome requirements that follow the frozen M5 plan --------------------------------
import { crosswalkFamily } from "../testSupport/askVaultM6/registry";
describe("owner-confirmed M3/M4 families and the conditional crosswalk (Q2)", () => {
  it("M3 is monthly-money, monthly-percentage and one-time-money; M4 is monthly-target and total-target; the registry marks them owner-confirmed", () => {
    expect(REQUIRED_FAMILIES.filter(f => f.milestone === "M3").map(f => f.id)).toEqual(["m3:monthly-money", "m3:monthly-percentage", "m3:one-time-money"]);
    expect(REQUIRED_FAMILIES.filter(f => f.milestone === "M4").map(f => f.id)).toEqual(["m4:monthly-target", "m4:total-target"]);
    for (const f of REQUIRED_FAMILIES.filter(x => x.milestone === "M3" || x.milestone === "M4")) expect(f.authority, f.id).toMatch(/owner decision Q2/i);
  });
  it("m2:m1:X maps to m1:X only when that family exists with the same gate and counting population; m2:m1:comparison-threshold maps to m2:comparison-threshold", () => {
    expect(crosswalkFamily("m2:m1:total-category")).toBe("m1:total-category");
    expect(crosswalkFamily("m2:m1:comparison-threshold")).toBe("m2:comparison-threshold");
    expect(crosswalkFamily("m2:m1:not-a-family")).toBeNull();      // no target: not silently mapped
    expect(crosswalkFamily("m1:total-category")).toBe("m1:total-category");   // a registered id maps to itself
    expect(crosswalkFamily("m5:negation")).toBe("m5:negation");
    for (const f of REQUIRED_FAMILIES.filter(x => x.milestone === "M1")) {
      const target = REQUIRED_FAMILIES.find(x => x.id === crosswalkFamily(`m2:m1:${f.id.slice(3)}`)!)!;
      expect(target.gate, f.id).toBe(f.gate); expect(target.population, f.id).toBe(f.population);
    }
  });
  it("the crosswalk is recorded in the registry file with its condition", () => {
    const file = JSON.parse(readFileSync("src/testSupport/askVaultM6/requiredFamilies.json", "utf8"));
    expect(file.crosswalk.map((c: { from: string }) => c.from)).toEqual(["m2:m1:*", "m2:m1:comparison-threshold"]);
    expect(file.crosswalk[0].condition).toMatch(/capability and counting obligations are unchanged/);
  });
});

describe("M5 labels keep their outcome requirements from the frozen retirementScoringPlan (Q2)", () => {
  const plan = retirementScoringPlan().families;
  const derived = (id: string) => {
    const f = (plan as Record<string, { cases: number; completionApplicable: boolean; draftsNeedingChoices: number; necessaryClarifications: number; refusals: number; routeElsewhere: number; numericBoundaryRefusals: number }>)[id.slice(3)];
    const out: string[] = [];
    if (f.completionApplicable) out.push("completion");
    if (f.draftsNeedingChoices + f.necessaryClarifications > 0) out.push("clarification");
    if (f.refusals > 0) out.push("refusal");
    if (f.numericBoundaryRefusals > 0) out.push("numeric-boundary");
    if (f.routeElsewhere > 0) out.push("routing");
    return out;
  };
  it("every M5 row lists exactly the outcomes its frozen plan has, so no label is deleted and none is forced into a direct-answer gate", () => {
    for (const f of REQUIRED_FAMILIES.filter(x => x.milestone === "M5")) expect(f.outcomes, f.id).toEqual(derived(f.id));
  });
  it("a refusal-only label such as unsupported-advice needs refusal checks, not direct answers; a completion label such as monthly-extra needs direct answers", () => {
    const by = (id: string) => REQUIRED_FAMILIES.find(f => f.id === id)!;
    expect(by("m5:unsupported-advice").outcomes).toEqual(["refusal"]);
    expect(by("m5:unsupported-scope").outcomes).toEqual(["refusal"]);
    expect(by("m5:route-elsewhere").outcomes).toEqual(["routing"]);
    expect(by("m5:monthly-extra").outcomes).toEqual(["completion"]);
    expect(by("m5:original-clarify").outcomes).toEqual(["clarification"]);
  });
  it("M1 to M4 rows are completion families; every row cites where its outcome requirement comes from", () => {
    for (const f of REQUIRED_FAMILIES.filter(x => x.milestone !== "M5")) expect(f.outcomes, f.id).toEqual(["completion"]);
    for (const f of REQUIRED_FAMILIES) expect(f.outcomeAuthority.length, f.id).toBeGreaterThan(15);
  });
});
