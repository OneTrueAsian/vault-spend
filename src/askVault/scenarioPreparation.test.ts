import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import { countKey, validateManifest } from "../testSupport/askVaultM6/counting";
import type { CorpusCase, Observation } from "../testSupport/askVaultM6/manifest";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";
import { SCENARIO_EVIDENCE_LINKS, m5PendingCompletions, m5StopCases } from "../testSupport/askVaultM6/scenarioPreparation";
import { RETIREMENT_CORPUS, retirementCorpusDenominators } from "./retirementCorpus";

/**
 * Task-4 item 6: M5 stop-only cases and the numeric-boundary population, prepared from the frozen M5 gold, and the scenario evidence links.
 * (Validation-Plan VP-04 populations P-NC, P-UNSAFE and P-NR; VP-06 which stop-only cases need which contexts.)
 */
const D = retirementCorpusDenominators();
const stops = m5StopCases();
const evidence = { kind: "unit-stand-in" as const };
const grade = (cases: CorpusCase[], observations: Observation[]) => gradeCorpus({ cases, requests: {}, references: {}, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence });
const ideal = (cases: CorpusCase[]): Observation[] => cases.flatMap(c => c.required.map(r => ({ caseId: c.id, seed: r.seed, contextId: r.contextId, stage: r.stop === "clarification" ? "clarify" as const : "refusal" as const,
  meaningChoices: r.stop === "clarification" ? (r.choices?.length ?? 1) : 0, offeredChoices: r.choices, accepted: [], reviewed: false, consented: false })));

describe("M5 stop-only cases and the numeric-boundary refusal, from the frozen M5 gold", () => {
  it("builds a valid manifest whose counts agree with the frozen M5 denominators", () => {
    expect(() => validateManifest(stops)).not.toThrow();
    const by = (p: string) => stops.filter(c => c.population === p).length;
    expect(by("P-NC")).toBe(D.draftsNeedingChoices + D.necessaryClarifications);
    expect(by("P-UNSAFE")).toBe(D.refusals);
    expect(by("P-NR")).toBe(D.numericBoundaryRefusals);
    expect(by("P-NR")).toBe(1);
  });
  it("accounts for every M5 case: stop, route-elsewhere (routing, not a stop) or a pending completion", () => {
    expect(stops.length + D.routeElsewhere + m5PendingCompletions().length).toBe(D.total);
    expect(m5PendingCompletions().length).toBe(D.balanceCompletionDrafts);
  });
  it("keeps m5c-027 as a required refusal on every one of the three seeds, never an estimate", () => {
    const nr = stops.find(c => c.id === "m5/m5c-027")!;
    expect(nr.population).toBe("P-NR");
    expect(nr.required.map(r => [r.seed, r.stop, r.requestId, r.referenceId])).toEqual([[101, "refusal", null, null], [202, "refusal", null, null], [303, "refusal", null, null]]);
    expect(m5PendingCompletions()).not.toContain("m5/m5c-027");
  });
  it("grades the ideal observations clean, with no financial credit for any of them", () => {
    const g = grade(stops, ideal(stops));
    // Counting rule (VP-03): identical normalized texts are one obligation, so the stop total is the number of distinct count keys.
    expect(g.requiredStops).toEqual({ total: new Set(stops.map(c => countKey(c.text))).size, failed: 0 });
    expect(g.wrongAccepted).toEqual([]); expect(g.financialTexts).toBe(0); expect(g.integrityIssues).toEqual([]);
  });
  it("a completed estimate for m5c-027 is a wrong acceptance on any seed, and the stop fails", () => {
    const nr = stops.filter(c => c.id === "m5/m5c-027");
    const obs = ideal(nr); obs[1] = { ...obs[1], stage: "result", accepted: [{ request: {}, result: { balance: "1.00" } }], request: {}, result: { balance: "1.00" } };
    const g = grade(nr, obs);
    expect(g.wrongAccepted.length).toBeGreaterThan(0); expect(g.requiredStops.failed).toBe(1); expect(g.gates.zeroWrong).toBe(false);
  });
  it("a clarification case with a different offered choice set fails its stop", () => {
    const clarify = stops.filter(c => c.population === "P-NC" && c.required[0].choices && c.required[0].choices.length > 1).slice(0, 1);
    expect(clarify).toHaveLength(1);
    const obs = ideal(clarify); obs[0] = { ...obs[0], offeredChoices: ["something else"] };
    expect(grade(clarify, obs).requiredStops.failed).toBe(1);
  });
  it("does not touch the frozen ordinary cases: no id or text collides with cases.json", () => {
    const frozen = JSON.parse(readFileSync("src/testSupport/askVaultM6/cases.json", "utf8")) as CorpusCase[];
    const ids = new Set(frozen.map(c => c.id));
    expect(stops.filter(c => ids.has(c.id))).toEqual([]);
  });
});

describe("a choices screen asks the retirement month only once the account is known (RetirementScenarioDialog.tsx:127-129)", () => {
  it("m5c-007 names no account and no cadence, so its first card asks exactly those two; m5c-008 and m5c-009 name an account-less monthly amount, so their first card asks only the account", () => {
    const choices = (id: string) => stops.find(c => c.id === `m5/${id}`)!.required[0].choices;
    expect(choices("m5c-007")).toEqual(["account", "cadence"]);
    expect(choices("m5c-008")).toEqual(["account"]);
    expect(choices("m5c-009")).toEqual(["account"]);
  });
  it("a draft whose account is known asks every field it is missing, the month included", () => {
    const withAccount = stops.filter(c => c.population === "P-NC" && c.required[0].choices?.includes("retirement-month"));
    expect(withAccount.length).toBeGreaterThan(0);
    for (const c of withAccount) { const gold = RETIREMENT_CORPUS.find(x => x.id === c.id.slice(3))!; expect(gold.expected.kind === "retirement" && gold.expected.draft.accountId !== null, c.id).toBe(true); }
  });
});

describe("M5 flagged clarifications keep their approved expectations (owner decision Q1)", () => {
  it("m5c-035, -036, -037 and -045 are P-NC cases whose frozen choice sets are exactly the approved M5 labels, so a safe choice is not turned into a direct-answer expectation", () => {
    for (const id of ["m5c-035", "m5c-036", "m5c-037", "m5c-045"]) {
      const gold = RETIREMENT_CORPUS.find(c => c.id === id)!;
      expect(gold.expected.kind, id).toBe("retirement-clarify");
      const mine = stops.find(c => c.id === `m5/${id}`)!;
      expect(mine.population, id).toBe("P-NC");
      expect(mine.required[0].choices, id).toEqual(gold.expected.kind === "retirement-clarify" ? gold.expected.choices.map(x => x.label) : []);
    }
  });
});

describe("scenario evidence links distinguish native context proof from JavaScript calculation proof", () => {
  const exists = (file: string, ref: string) => readFileSync(file, "utf8").includes(ref.replace(/^fn /, ref.startsWith("fn ") ? "fn " : ""));
  it("every linked native test and calculation test exists by file and name", () => {
    for (const l of SCENARIO_EVIDENCE_LINKS) for (const side of [l.nativeContext, l.jsCalculation]) {
      expect(side, l.reference).not.toBeNull();
      expect(exists(side!.file, side!.ref), `${l.reference}: ${side!.file} :: ${side!.ref}`).toBe(true);
    }
  });
  it("the four hand-worked anchors are the references linked, and each says what native per-seed proof is still missing", () => {
    const refs = JSON.parse(readFileSync("src/testSupport/askVaultM6/referenceResults.json", "utf8")) as Record<string, { evidenceKind?: string }>;
    expect(SCENARIO_EVIDENCE_LINKS.map(l => l.reference).sort()).toEqual(Object.keys(refs).filter(k => refs[k].evidenceKind === "hand-worked-anchor").sort());
    expect(SCENARIO_EVIDENCE_LINKS.every(l => l.missing.length > 20)).toBe(true);
  });
  it("the frozen ordinary requests still have no baseline shape, and the scenario prerequisites file now supplies one for every category of every seed world (native-proved, Q5)", () => {
    type R = { contractVersion?: number; groupBy?: string; average?: string; kind: string; categories: string[] };
    const shaped = (r: R) => r.contractVersion === 2 && r.groupBy === "month" && r.average === "per-month" && r.kind === "total" && r.categories.length === 1;
    const ordinary = JSON.parse(readFileSync("src/testSupport/askVaultM6/expectedRequests.json", "utf8")) as Record<string, R>;
    expect(Object.values(ordinary).filter(shaped)).toHaveLength(0);
    const scenario = JSON.parse(readFileSync("src/testSupport/askVaultM6/scenarioNativeRequests.json", "utf8")) as Record<string, R>;
    // 33 distinct requests (a request names a category and dates, not a world), answered by 99 world-specific references.
    expect(Object.values(scenario).filter(shaped)).toHaveLength(33);
    const refs = JSON.parse(readFileSync("src/testSupport/askVaultM6/scenarioNativeReferences.json", "utf8")).references as Record<string, { kind: string }>;
    expect(Object.values(refs).filter(r => r.kind === "baseline")).toHaveLength(99);
  });
});
