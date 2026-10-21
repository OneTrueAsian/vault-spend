import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import type { CorpusCase, GradingInput, Observation, Reference } from "../testSupport/askVaultM6/manifest";
import { UNIT_STAND_IN_RECEIPT, referenceIdentity } from "../testSupport/askVaultM6/nativeEvidence";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";

// Task-4 gap remediation (Task4-Overnight-Validation-2026-10-21.md F1, F2, F4). Everything below is a deliberately fabricated stand-in or a
// synthetic proof built only to provoke the grader; none of it is corpus evidence. Written before the grader changes (RED first).
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const request = { kind: "total", periods: [{ from: "2026-09-01", to: "2026-09-30" }], categories: ["Dining"], minimumPurchase: null };
const result = { total: "12.34", purchaseCount: 2 };
const FAMILY = "m1:total-category";
const SEEDS = [101, 202, 303];

describe("task-4 final review: preserve the original mustOffer clarification constraints", () => {
  // M1/acceptance/generate.ts:315-334 and M2/acceptance/generate.ts:211-221,
  // Validation-Plan VP-05/06: a generic clarification is not proof of the required choices.
  const cases: CorpusCase[] = JSON.parse(readFileSync("src/testSupport/askVaultM6/cases.json", "utf8"));
  const choices: [string, string[]][] = [
    ["m1/101-0254", ["Categories", "Purchases"]],
    ["m1/101-0255", ["Dining", "Dining Out"]],
    ["m2/m2-101-0301", ["Per purchase", "Per month"]],
    ["m2/m2-101-0316", ["The last 12 months", "The last 4 years"]],
  ];
  const grade = (id: string, offered: (seed: number) => string[] | undefined) => {
    const c = cases.find(c => c.id === id)!;
    const observations: Observation[] = c.required.map(r => ({ caseId: id, contextId: r.contextId, seed: r.seed, stage: "clarify", meaningChoices: 1,
      offeredChoices: offered(r.seed), accepted: [], reviewed: false, consented: false }));
    return gradeCorpus({ cases: [c], requests: {}, references: {}, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "unit-stand-in" } });
  };
  it.each(choices)("%s accepts its required original choices on every seed", (id, expected) => {
    expect(grade(id, () => expected).requiredStops).toEqual({ total: 1, failed: 0 });
  });
  it.each(choices)("%s rejects unrelated choices instead of granting stop credit", (id) => {
    expect(grade(id, () => ["Rent", "Travel"]).requiredStops.failed).toBe(1);
  });
  it.each(choices)("%s rejects a missing required choice on even one seed", (id, expected) => {
    expect(grade(id, seed => seed === 202 ? expected.slice(0, 1) : expected).requiredStops.failed).toBe(1);
  });
  it.each(choices)("%s rejects an unrecorded choice list", id => {
    expect(grade(id, () => undefined).requiredStops.failed).toBe(1);
  });
  const recovered = JSON.parse(readFileSync("src/testSupport/askVaultM6/clarificationGolds.json", "utf8")) as { cases: Record<string, { text: string; expected: { status: string; mustOffer?: string[] } }> };
  it("recovers every original ambiguity expectation without changing original cases or adding exhaustive labels", () => {
    expect(Object.keys(recovered.cases).sort()).toEqual(cases.filter(c => c.population === "P-NC").map(c => c.id).sort());
    expect(Object.keys(recovered.cases)).toHaveLength(98);
    expect(Object.values(recovered.cases).filter(g => g.expected.mustOffer?.length)).toHaveLength(55);
    for (const [id, gold] of Object.entries(recovered.cases)) {
      expect(gold.text).toBe(cases.find(c => c.id === id)!.text); expect(gold.expected.status).toBe("clarify");
    }
    for (const [id, expected] of choices) expect(recovered.cases[id].expected.mustOffer).toEqual(expected);
  });
  it.each(Object.entries(recovered.cases).filter((entry): entry is [string, { text: string; expected: { status: string; mustOffer: string[] } }] => !!entry[1].expected.mustOffer?.length))
    ("%s enforces every pre-existing required-choice subset on all seeds", (id, gold) => {
      const labels = gold.expected.mustOffer;
      expect(grade(id, () => [...labels].reverse()).requiredStops.failed).toBe(0);
      expect(grade(id, seed => seed === 303 ? labels.slice(1) : labels).requiredStops.failed).toBe(1);
      expect(grade(id, () => ["unrelated choice"]).requiredStops.failed).toBe(1);
    });
});

function financial(evidence: "stand-in" | "corpus") {
  const c: CorpusCase = { id: "one", text: "Dining spending last month", population: "P-CORE", family: FAMILY, cluster: "total", tags: [],
    required: SEEDS.map(seed => ({ seed, contextId: "c" + seed, requestId: "q", referenceId: "r" + seed })) };
  const requests = { q: request };
  const contexts = { worlds: { w: { today: "2026-09-06" } }, contexts: Object.fromEntries(SEEDS.map(s => ["c" + s, { seed: s, worldId: "w", parseContext: {} }])) };
  const proofText = JSON.stringify({ test: "ask_vault_m6_frozen_reference_worlds", checked: SEEDS.map(s => "r" + s), failures: 0 });
  const references: Record<string, Reference> = Object.fromEntries(SEEDS.map(s => ["r" + s, { value: result, seed: s, contextId: "c" + s, requestId: "q",
    nativeReceipt: evidence === "stand-in" ? UNIT_STAND_IN_RECEIPT : `synthetic.json#sha256:${sha(proofText)}#r${s}` }]));
  const observations: Observation[] = SEEDS.map(seed => ({ caseId: "one", seed, contextId: "c" + seed, stage: "result", meaningChoices: 0, accepted: [{ request, result }], request, result, reviewed: true, consented: true }));
  const evidenceInput: GradingInput["evidence"] = evidence === "stand-in" ? { kind: "unit-stand-in" }
    : { kind: "corpus", contexts, proofs: { "synthetic.json": proofText }, manifest: { proofs: { "synthetic.json": { sha256: sha(proofText) } },
      identities: Object.fromEntries(SEEDS.map(s => ["r" + s, referenceIdentity(references["r" + s], requests, contexts)])) } };
  return { cases: [c], requests, references, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: evidenceInput } satisfies GradingInput;
}

describe("F2: financial credit needs verified native evidence, not a nonempty string", () => {
  it("credits a text whose synthetic proof, checksum, membership, outcome and identity all verify", () => {
    const g = gradeCorpus(financial("corpus"));
    expect(g.evidenceProblems).toEqual([]);
    expect(g.financialTexts).toBe(1);
    expect(g.evidenceClass).toBe("native-verified");
    expect(g.gates.admissibleEvidence).toBe(true);
  });
  it.each(["does-not-exist.json#fake", "synthetic.json#sha256:" + "0".repeat(64) + "#r101", UNIT_STAND_IN_RECEIPT, "x"])("grants no credit for the receipt %s in a corpus grading", receipt => {
    const f = financial("corpus"); f.references.r101.nativeReceipt = receipt;
    const g = gradeCorpus(f);
    expect(g.financialTexts).toBe(0);
    expect(g.evidenceProblems.length).toBeGreaterThan(0);
    expect(g.integrityIssues.length).toBeGreaterThan(0);
    expect(g.wrongAccepted).toEqual([]); // missing evidence is not a proven wrong amount
  });
  it("grants no credit when the request changed after the native run (stale evidence)", () => {
    const f = financial("corpus"); f.requests = { q: { ...request, categories: ["Rent"] } };
    expect(gradeCorpus(f).financialTexts).toBe(0);
  });
  it("grants no credit when no evidence block is supplied at all", () => {
    const f = financial("corpus") as Partial<GradingInput>; delete f.evidence;
    expect(gradeCorpus(f as GradingInput).financialTexts).toBe(0);
  });
  it("keeps fabricated unit-test evidence distinguishable and never admissible for acceptance", () => {
    const g = gradeCorpus(financial("stand-in"));
    expect(g.financialTexts).toBe(1);
    expect(g.evidenceClass).toBe("unit-stand-in");
    expect(g.gates.admissibleEvidence).toBe(false);
    expect(g.passed).toBe(false);
  });
  it("a stand-in grading rejects any receipt that is not the stand-in marker", () => {
    const f = financial("stand-in"); f.references.r202.nativeReceipt = "anything-nonempty";
    expect(gradeCorpus(f).financialTexts).toBe(0);
  });
});

describe("F1: grading is bound to the complete authority-backed family registry", () => {
  const mutate = (list: string[]) => gradeCorpus({ ...financial("stand-in"), requiredFamilies: list });
  it("reports every registered family, including those with zero cases, as NOT MEASURED and blocks closure", () => {
    const g = gradeCorpus(financial("stand-in"));
    expect(g.families.map(f => f.family)).toEqual([...REQUIRED_FAMILY_IDS]);
    expect(g.families.filter(f => f.status === "NOT MEASURED").length).toBe(REQUIRED_FAMILY_IDS.length - 1);
    expect(g.families.find(f => f.family === FAMILY)).toMatchObject({ total: 1, status: "PASS" });
    expect(g.gates.families).toBe(false);
    expect(g.registryBound).toBe(true);
  });
  it.each([
    ["empty", [] as string[]],
    ["truncated", REQUIRED_FAMILY_IDS.slice(0, -1)],
    ["only the families that have cases", [FAMILY]],
    ["substituted", [...REQUIRED_FAMILY_IDS.slice(1), "m9:substituted"]],
    ["duplicated", [...REQUIRED_FAMILY_IDS, REQUIRED_FAMILY_IDS[0]]],
    ["padded with an unknown family", [...REQUIRED_FAMILY_IDS, "m9:unknown"]],
  ])("rejects a %s required-family list as an integrity failure", (_name, list) => {
    const g = mutate(list);
    expect(g.registryBound).toBe(false);
    expect(g.integrityIssues.some(m => /required-family/i.test(m))).toBe(true);
    expect(g.gates.families).toBe(false);
    expect(g.passed).toBe(false);
    expect(g.families.map(f => f.family)).toEqual([...REQUIRED_FAMILY_IDS]); // results never follow the caller's list
  });
  it("rejects a P-CORE case whose family is not in the registry instead of ignoring it", () => {
    const f = financial("stand-in"); f.cases[0] = { ...f.cases[0], family: "m9:invented" };
    const g = gradeCorpus(f);
    expect(g.integrityIssues.some(m => /unregistered family/i.test(m))).toBe(true);
    expect(g.gates.families).toBe(false);
  });
});

describe("F4: stop-only cases report wrong acceptance consistently", () => {
  const stopCase = (population: CorpusCase["population"], stop: "refusal" | "clarification"): CorpusCase => ({ id: "stop", text: `stop only ${population}`, population, family: "stop:" + population, cluster: "stop", tags: [],
    required: SEEDS.map(seed => ({ seed, contextId: "c" + seed, requestId: null, referenceId: null, stop })) });
  const seen = (stage: Observation["stage"], extra: Partial<Observation> = {}): Observation[] => SEEDS.map(seed => ({ caseId: "stop", seed, contextId: "c" + seed, stage, meaningChoices: stage === "clarify" ? 1 : 0, accepted: [], reviewed: false, consented: false, ...extra }));
  const grade = (population: CorpusCase["population"], stop: "refusal" | "clarification", observations: Observation[]) =>
    gradeCorpus({ cases: [stopCase(population, stop)], requests: {}, references: {}, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "unit-stand-in" } });
  const populations = ["P-NC", "P-ID", "P-UNSAFE", "P-NR"] as const;
  const stopFor = (p: string) => (p === "P-NC" || p === "P-ID" ? "clarification" : "refusal") as "refusal" | "clarification";
  const good = (p: string) => seen(stopFor(p) === "clarification" ? "clarify" : "refusal");

  it.each(populations)("%s: the expected stop with nothing accepted is clean", p => {
    const g = grade(p, stopFor(p), good(p));
    expect(g.gates.zeroWrong).toBe(true); expect(g.requiredStops).toEqual({ total: 1, failed: 0 }); expect(g.integrityIssues).toEqual([]);
  });
  it.each(populations)("%s: a result stage with accepted[] empty is a wrong acceptance, not zeroWrong", p => {
    const g = grade(p, stopFor(p), seen("result", { request: {}, result: { total: "1.00" } }));
    expect(g.gates.zeroWrong).toBe(false); expect(g.wrongAccepted.length).toBeGreaterThan(0); expect(g.requiredStops.failed).toBe(1);
  });
  it.each(populations)("%s: wrong-then-recovered (an accepted answer before the expected stop) stays a wrong acceptance", p => {
    const obs = good(p); obs[0] = { ...obs[0], accepted: [{ request: {}, result: { total: "1.00" } }] };
    const g = grade(p, stopFor(p), obs);
    expect(g.gates.zeroWrong).toBe(false); expect(g.wrongAccepted.length).toBeGreaterThan(0);
  });
  it.each(populations)("%s: a stop stage that carries a result is rejected as a contradictory observation", p => {
    const g = grade(p, stopFor(p), good(p).map(o => ({ ...o, result: { total: "1.00" } })));
    expect(g.integrityIssues.some(m => /contradict/i.test(m))).toBe(true); expect(g.passed).toBe(false);
  });
  it.each(populations)("%s: a missing observation is missing evidence, not a proven wrong answer", p => {
    const g = grade(p, stopFor(p), good(p).slice(1));
    expect(g.wrongAccepted).toEqual([]); expect(g.integrityIssues.length).toBeGreaterThan(0); expect(g.requiredStops.failed).toBe(1);
  });
  it("a different safe stage (clarification where a refusal was required) fails the stop but is not a wrong acceptance", () => {
    const g = grade("P-UNSAFE", "refusal", seen("clarify"));
    expect(g.requiredStops.failed).toBe(1); expect(g.wrongAccepted).toEqual([]); expect(g.gates.zeroWrong).toBe(true);
  });
  it("a financial case that reports the result stage with accepted[] empty and no request is a contradictory observation", () => {
    const f = financial("stand-in"); f.observations[0] = { ...f.observations[0], accepted: [], request: undefined, result: undefined };
    const g = gradeCorpus(f);
    expect(g.integrityIssues.some(m => /contradict/i.test(m))).toBe(true); expect(g.financialTexts).toBe(0);
  });
});

// ---- Owner decision Q2: every label stays visible, each with the outcome requirement its frozen plan gives it ------------------------------------------------------
describe("Q2: family status follows each label's outcome requirements", () => {
  const stopCase = (id: string, family: string, population: CorpusCase["population"], stop: "refusal" | "clarification", choices?: string[]): CorpusCase => ({ id, text: "stop " + id, population, family, cluster: family, tags: [],
    required: [{ seed: 101, contextId: "c101", requestId: null, referenceId: null, stop, ...(choices ? { choices } : {}) }] });
  const seenStop = (caseId: string, stage: Observation["stage"], accepted: Observation["accepted"] = [], offeredChoices?: string[]): Observation =>
    ({ caseId, seed: 101, contextId: "c101", stage, meaningChoices: stage === "clarify" ? (offeredChoices?.length ?? 1) : 0, offeredChoices, accepted, ...(stage === "result" ? { request: {}, result: {} } : {}), reviewed: false, consented: false });
  const grade = (cases: CorpusCase[], observations: Observation[]) => gradeCorpus({ cases, requests: {}, references: {}, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "unit-stand-in" } });
  const fam = (g: ReturnType<typeof grade>, id: string) => g.families.find(f => f.family === id)!;

  it("a refusal-only family passes on its refusal checks alone, with no direct-answer requirement", () => {
    const g = grade([stopCase("a", "m5:unsupported-advice", "P-UNSAFE", "refusal")], [seenStop("a", "refusal")]);
    expect(fam(g, "m5:unsupported-advice")).toMatchObject({ status: "PASS", total: 0, stops: { total: 1, failed: 0 } });
  });
  it("a refusal-only family FAILS when a refusal case is answered, and is NOT MEASURED with no case", () => {
    const bad = grade([stopCase("a", "m5:unsupported-advice", "P-UNSAFE", "refusal")], [seenStop("a", "result", [{ request: {}, result: {} }])]);
    expect(fam(bad, "m5:unsupported-advice").status).toBe("FAIL");
    expect(fam(grade([], []), "m5:unsupported-advice").status).toBe("NOT MEASURED");
  });
  it("a clarification family needs its clarification cases; a wrong choice set fails it", () => {
    const c = stopCase("c", "m5:missing-choice", "P-NC", "clarification", ["account"]);
    expect(fam(grade([c], [seenStop("c", "clarify", [], ["account"])]), "m5:missing-choice").status).toBe("PASS");
    expect(fam(grade([c], [seenStop("c", "clarify", [], ["other"])]), "m5:missing-choice").status).toBe("FAIL");
    expect(fam(grade([], []), "m5:missing-choice").status).toBe("NOT MEASURED");
  });
  it("a mixed family needs completion, ordinary refusal and numeric-boundary checks separately", () => {
    const f = financial("stand-in"); f.cases[0] = { ...f.cases[0], family: "m5:return-wording" };
    expect(fam(gradeCorpus(f), "m5:return-wording")).toMatchObject({ status: "NOT MEASURED", total: 1, direct: 1 });
    const numeric = stopCase("numeric", "m5:return-wording", "P-NR", "refusal");
    expect(fam(gradeCorpus({ ...f, cases: [...f.cases, numeric], observations: [...f.observations, seenStop("numeric", "refusal")] }), "m5:return-wording").status).toBe("NOT MEASURED");
    const nr = stopCase("nr", "m5:return-wording", "P-UNSAFE", "refusal");
    const g = gradeCorpus({ ...f, cases: [...f.cases, nr, numeric], observations: [...f.observations, seenStop("nr", "refusal"), seenStop("numeric", "refusal")] });
    expect(fam(g, "m5:return-wording")).toMatchObject({ status: "PASS", direct: 1, stops: { total: 2, failed: 0 } });
    const wrong = gradeCorpus({ ...f, cases: [...f.cases, nr, numeric], observations: [...f.observations, seenStop("numeric", "refusal"), seenStop("nr", "result", [{ request: {}, result: {} }])] });
    expect(fam(wrong, "m5:return-wording").status).toBe("FAIL");
  });
  it("a routing label is NOT MEASURED without cases and every label stays in the report", () => {
    const g = grade([], []);
    expect(fam(g, "m5:route-elsewhere")).toMatchObject({ status: "NOT MEASURED" });
    expect(g.families.map(f => f.family)).toEqual([...REQUIRED_FAMILY_IDS]);
  });
});

// ---- A text shared by cases in different populations (the M5 corpus repeats one sentence across rosters: m5c-019, -034, -061, -069, -070) ----------------------------------
describe("a normalized text shared across populations is judged once per population", () => {
  const sameText = "EXTRA $50 A MONTH INTO MY ROTH IRA UNTIL JUNE 2050";
  function shared(refusalObserved: "refusal" | "result") {
    const f = financial("stand-in"); f.cases[0] = { ...f.cases[0], text: sameText, family: "m5:monthly-extra" };
    const stop: CorpusCase = { id: "stop", text: "extra $50 a month into my roth ira until june 2050", population: "P-UNSAFE", family: "m5:unsupported-scope", cluster: "x", tags: [],
      required: [{ seed: 101, contextId: "none", requestId: null, referenceId: null, stop: "refusal" }] };
    const observation: Observation = refusalObserved === "refusal"
      ? { caseId: "stop", seed: 101, contextId: "none", stage: "refusal", meaningChoices: 0, accepted: [], reviewed: false, consented: false }
      : { caseId: "stop", seed: 101, contextId: "none", stage: "result", meaningChoices: 0, accepted: [{ request: {}, result: {} }], request: {}, result: {}, reviewed: false, consented: false };
    return gradeCorpus({ ...f, cases: [...f.cases, stop], observations: [...f.observations, observation] });
  }
  it("the completing case keeps its direct credit and the refusal case its own stop credit, though they share a count key", () => {
    const g = shared("refusal");
    expect(g.core).toEqual({ total: 1, direct: 1, withinOne: 1 }); expect(g.financialTexts).toBe(1); expect(g.requiredStops).toEqual({ total: 1, failed: 0 }); expect(g.integrityIssues).toEqual([]);
  });
  it("a refusal case that is answered fails only its own stop and is a wrong acceptance; the completing case is unaffected", () => {
    const g = shared("result");
    expect(g.requiredStops).toEqual({ total: 1, failed: 1 }); expect(g.wrongAccepted.length).toBeGreaterThan(0); expect(g.core.direct).toBe(1);
  });
  it("two completing cases with one text are still ONE text that fails if either context fails (collisions within a population stay obligations)", () => {
    const f = financial("stand-in"); const alias = { ...f.cases[0], id: "alias" };
    const bad = f.observations.map(o => ({ ...o, caseId: "alias", stage: "draft" as const }));
    expect(gradeCorpus({ ...f, cases: [...f.cases, alias], observations: [...f.observations, ...bad] }).core.direct).toBe(0);
  });
});
