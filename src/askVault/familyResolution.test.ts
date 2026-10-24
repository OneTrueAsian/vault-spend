import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import type { CorpusCase, GradingInput, Observation, Reference, ResolutionObservation } from "../testSupport/askVaultM6/manifest";
import { UNIT_STAND_IN_RECEIPT } from "../testSupport/askVaultM6/nativeEvidence";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";

// Owner decisions D-R2 and D-R3 (Task5-Remediation-Completion/Decisions-Ledger.md; Task-Authority-2.txt:61-126), written BEFORE the grader changes (RED first).
//  D-R2: for m1:several-stores ONLY, a separate family-resolution measure sits beside the unchanged direct metric. A store-typo clarification counts only after the approved
//        choice is clicked, the question reparsed, and the full request and exact displayed result are right on every required seed. Offering a button earns nothing.
//  D-R3: m1/202-0210 ("Shel or sam's club"): the actual request vendors ["shel","sams club"] is an authority-backed alternate to the original gold, with its own linked reference.
// Everything here is a deliberately fabricated stand-in built only to provoke the grader; none of it is corpus evidence.
const R = "src/testSupport/askVaultM6/";
const cases: CorpusCase[] = JSON.parse(readFileSync(R + "cases.json", "utf8"));
const goldRequests: Record<string, unknown> = JSON.parse(readFileSync(R + "expectedRequests.json", "utf8"));
const FAMILY = "m1:several-stores";
const SPOTIFY = cases.find(c => c.id === "m1/101-0168")!;
const KROGER = cases.find(c => c.id === "m1/101-0189")!;
const OTHER_FAMILY = cases.find(c => c.family === "m1:store" && c.population === "P-CORE")!;
const amendment = { family: FAMILY, thresholdPercent: 90, approvedChoices: { "m1/101-0168": "spotify", "m1/101-0189": "kroger" } };

const value = (id: string) => ({ total: "10.00", id });
const refs = (c: CorpusCase): Record<string, Reference> => Object.fromEntries(c.required.map(r => [r.referenceId!, { value: value(r.referenceId!), seed: r.seed, contextId: r.contextId, requestId: r.requestId!, nativeReceipt: UNIT_STAND_IN_RECEIPT }]));
const requestsOf = (c: CorpusCase) => Object.fromEntries(c.required.map(r => [r.requestId!, goldRequests[r.requestId!]]));
const clarify = (c: CorpusCase, label: string): Observation[] => c.required.map(r => ({ caseId: c.id, seed: r.seed, contextId: r.contextId, stage: "clarify", meaningChoices: 1, offeredChoices: [label], accepted: [], reviewed: false, consented: false }));
const resolved = (c: CorpusCase, chosen: string, over: Partial<ResolutionObservation> = {}): ResolutionObservation[] => c.required.map(r => {
  const request = goldRequests[r.requestId!], result = value(r.referenceId!);
  return { caseId: c.id, seed: r.seed, contextId: r.contextId, stage: "result", meaningChoices: 1, accepted: [{ request, result }], request, result, reviewed: false, consented: false, chosen, readsBeforeChoice: 0, ...over };
});
const grade = (c: CorpusCase, observations: Observation[], resolutionObservations: ResolutionObservation[] | undefined, extra: Partial<GradingInput> = {}) =>
  gradeCorpus({ cases: [c], requests: requestsOf(c), references: refs(c), observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "unit-stand-in" },
    amendments: { familyResolution: amendment }, resolutionObservations, ...extra } as GradingInput) as ReturnType<typeof gradeCorpus> & { familyResolution: any; gatesUnderAmendment: Record<string, boolean>; passedUnderAmendment: boolean };
const family = (r: ReturnType<typeof grade>) => r.families.find(f => f.family === FAMILY)!;

describe("the original direct metric is untouched and reported beside the resolution measure", () => {
  it("an offered but unclicked choice earns no resolution credit and the direct metric stays at a miss", () => {
    const r = grade(SPOTIFY, clarify(SPOTIFY, "SPOTIFY"), undefined);
    expect(family(r)).toMatchObject({ total: 1, direct: 0, status: "FAIL" });
    expect(r.familyResolution).toMatchObject({ family: FAMILY, thresholdPercent: 90, direct: { total: 1, direct: 0 }, resolution: { total: 1, resolved: 0 }, pass: false });
    expect(r.gates.families).toBe(false);
  });
  it("a correct click on the approved choice counts as resolved, while direct stays a miss and the strict gate stays false", () => {
    const r = grade(SPOTIFY, clarify(SPOTIFY, "SPOTIFY"), resolved(SPOTIFY, "SPOTIFY"));
    expect(family(r)).toMatchObject({ total: 1, direct: 0, status: "FAIL" });
    expect(r.familyResolution).toMatchObject({ direct: { total: 1, direct: 0 }, resolution: { total: 1, resolved: 1, resolvedByChoice: ["m1/101-0168"] }, pass: true });
    expect(r.gates.families).toBe(false);
    expect(r.wrongAccepted).toEqual([]);
    expect(r.integrityIssues).toEqual([]);
  });
});

describe("what must NOT count as resolved", () => {
  const notResolved = (r: ReturnType<typeof grade>) => { expect(r.familyResolution.resolution.resolved).toBe(0); expect(r.familyResolution.pass).toBe(false); expect(r.gatesUnderAmendment.families).toBe(false); };
  it("a wrong choice (not the approved candidate)", () => notResolved(grade(SPOTIFY, clarify(SPOTIFY, "SPOTIFY"), resolved(SPOTIFY, "KROGER"))));
  it("a right click that produced a wrong request", () => {
    const r = grade(SPOTIFY, clarify(SPOTIFY, "SPOTIFY"), resolved(SPOTIFY, "SPOTIFY", { request: { kind: "total" }, accepted: [{ request: { kind: "total" }, result: value("x") }] }));
    notResolved(r); expect(r.wrongAccepted.length).toBeGreaterThan(0);
  });
  it("a right request with a wrong displayed result", () => {
    const r = grade(SPOTIFY, clarify(SPOTIFY, "SPOTIFY"), resolved(SPOTIFY, "SPOTIFY", { result: { total: "99.99" }, accepted: [{ request: goldRequests[SPOTIFY.required[0].requestId!], result: { total: "99.99" } }] }));
    notResolved(r); expect(r.wrongAccepted.length).toBeGreaterThan(0);
  });
  it("a result whose display did not match (display mismatch is part of the result)", () => {
    const r = grade(SPOTIFY, clarify(SPOTIFY, "SPOTIFY"), resolved(SPOTIFY, "SPOTIFY").map(o => ({ ...o, result: { ...(o.result as object), displayMismatch: ["row 1"] } })));
    notResolved(r);
  });
  it("a missing seed", () => notResolved(grade(SPOTIFY, clarify(SPOTIFY, "SPOTIFY"), resolved(SPOTIFY, "SPOTIFY").slice(0, 2))));
  it("a duplicated seed observation", () => notResolved(grade(SPOTIFY, clarify(SPOTIFY, "SPOTIFY"), [...resolved(SPOTIFY, "SPOTIFY"), ...resolved(SPOTIFY, "SPOTIFY").slice(0, 1)])));
  it("more than one exchange (a second clarification after the click)", () => notResolved(grade(SPOTIFY, clarify(SPOTIFY, "SPOTIFY"), resolved(SPOTIFY, "SPOTIFY", { meaningChoices: 2 }))));
  it("a final stage that is not a result", () => notResolved(grade(SPOTIFY, clarify(SPOTIFY, "SPOTIFY"), resolved(SPOTIFY, "SPOTIFY", { stage: "clarify", accepted: [], request: undefined, result: undefined }))));
  it("an answer read from the native store BEFORE the person chose (wrong intermediate acceptance) also breaks the zero-wrong rule", () => {
    const r = grade(SPOTIFY, clarify(SPOTIFY, "SPOTIFY"), resolved(SPOTIFY, "SPOTIFY", { readsBeforeChoice: 1 }));
    notResolved(r); expect(r.wrongAccepted.length).toBeGreaterThan(0); expect(r.gates.zeroWrong).toBe(false); expect(r.passedUnderAmendment).toBe(false);
  });
  it("an intermediate acceptance recorded on the clarification itself breaks the zero-wrong rule", () => {
    const first = clarify(SPOTIFY, "SPOTIFY").map(o => ({ ...o, accepted: [{ request: goldRequests[SPOTIFY.required[0].requestId!], result: value("x") }] }));
    const r = grade(SPOTIFY, first, resolved(SPOTIFY, "SPOTIFY"));
    notResolved(r); expect(r.wrongAccepted.length).toBeGreaterThan(0); expect(r.gates.zeroWrong).toBe(false); expect(r.passedUnderAmendment).toBe(false);
  });
  it("a choice that was never offered", () => notResolved(grade(SPOTIFY, clarify(SPOTIFY, "NETFLIX"), resolved(SPOTIFY, "SPOTIFY"))));
  it("a case the amendment does not name", () => {
    const r = grade(OTHER_FAMILY, clarify(OTHER_FAMILY, "X"), resolved(OTHER_FAMILY, "X"));
    expect(r.integrityIssues.some(m => m.includes("resolution observation"))).toBe(true);
    expect(r.passedUnderAmendment).toBe(false);
  });
  it("a deliberate refusal never becomes a completed answer", () => {
    const refusal: Observation[] = SPOTIFY.required.map(r => ({ caseId: SPOTIFY.id, seed: r.seed, contextId: r.contextId, stage: "refusal", meaningChoices: 0, accepted: [], reviewed: false, consented: false }));
    notResolved(grade(SPOTIFY, refusal, resolved(SPOTIFY, "SPOTIFY")));
  });
});

describe("the amendment cannot reach another family or the direct gates", () => {
  it("adding resolution observations changes no direct count, family row or strict gate", () => {
    const without = grade(SPOTIFY, clarify(SPOTIFY, "SPOTIFY"), undefined);
    const withIt = grade(SPOTIFY, clarify(SPOTIFY, "SPOTIFY"), resolved(SPOTIFY, "SPOTIFY"));
    expect(withIt.core).toEqual(without.core);
    expect(withIt.families).toEqual(without.families);
    expect(withIt.gates).toEqual(without.gates);
    expect(withIt.passed).toBe(without.passed);
    expect(withIt.financialTexts).toBe(without.financialTexts);
  });
  it("another family keeps its own direct rule: a clarified case of that family is a miss and is not rescued", () => {
    const r = grade(OTHER_FAMILY, clarify(OTHER_FAMILY, "X"), undefined);
    expect(r.families.find(f => f.family === OTHER_FAMILY.family)).toMatchObject({ total: 1, direct: 0, status: "FAIL" });
    expect(r.gatesUnderAmendment.families).toBe(false);
  });
  it("without an amendment object nothing is reported and nothing changes", () => {
    const r = gradeCorpus({ cases: [SPOTIFY], requests: requestsOf(SPOTIFY), references: refs(SPOTIFY), observations: clarify(SPOTIFY, "SPOTIFY"), requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "unit-stand-in" } }) as any;
    expect(r.familyResolution ?? null).toBeNull();
    expect(r.gatesUnderAmendment.families).toBe(r.gates.families);
  });
  it("two approved texts: one resolved and one not gives half, below the 90% threshold", () => {
    const input = (obs: Observation[], res: ResolutionObservation[]) => gradeCorpus({ cases: [SPOTIFY, KROGER], requests: { ...requestsOf(SPOTIFY), ...requestsOf(KROGER) }, references: { ...refs(SPOTIFY), ...refs(KROGER) },
      observations: obs, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "unit-stand-in" }, amendments: { familyResolution: amendment }, resolutionObservations: res } as GradingInput) as any;
    const r = input([...clarify(SPOTIFY, "SPOTIFY"), ...clarify(KROGER, "KROGER")], resolved(SPOTIFY, "SPOTIFY"));
    expect(r.familyResolution).toMatchObject({ resolution: { total: 2, resolved: 1 }, pass: false });
  });
});

describe("D-R3: the alternate request for m1/202-0210", () => {
  const SHEL = cases.find(c => c.id === "m1/202-0210")!;
  const alt = SHEL.required.map(r => ({ seed: r.seed, contextId: r.contextId, requestId: `alt-q-${r.seed}`, referenceId: `alt-r-${r.seed}` }));
  const goldReq = (r: (typeof SHEL.required)[number]) => goldRequests[r.requestId!] as { vendors: string[] };
  const altRequest = (seed: number) => { const g = goldReq(SHEL.required.find(r => r.seed === seed)!); return { ...g, vendors: ["shel", g.vendors[1]] }; };
  const requests = () => ({ ...requestsOf(SHEL), ...Object.fromEntries(alt.map(a => [a.requestId, altRequest(a.seed)])) });
  const references = (receipt: string | null = UNIT_STAND_IN_RECEIPT): Record<string, Reference> => ({ ...refs(SHEL), ...Object.fromEntries(alt.map(a => [a.referenceId, { value: { total: "10.00", alt: a.seed }, seed: a.seed, contextId: a.contextId, requestId: a.requestId, nativeReceipt: receipt as string }])) });
  const observe = (pick: (seed: number) => { request: unknown; result: unknown }): Observation[] => SHEL.required.map(r => { const { request, result } = pick(r.seed); return { caseId: SHEL.id, seed: r.seed, contextId: r.contextId, stage: "result", meaningChoices: 0, accepted: [{ request, result }], request, result, reviewed: false, consented: false }; });
  const run = (observations: Observation[], refMap = references()) => gradeCorpus({ cases: [SHEL], requests: requests(), references: refMap, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "unit-stand-in" },
    amendments: { alternates: [{ caseId: SHEL.id, perSeed: alt }] } } as GradingInput) as ReturnType<typeof gradeCorpus>;
  const family2 = (r: ReturnType<typeof gradeCorpus>) => r.families.find(f => f.family === SHEL.family)!;
  it("the original gold request still counts as before", () => {
    const r = run(observe(seed => ({ request: goldReq(SHEL.required.find(x => x.seed === seed)!), result: value(SHEL.required.find(x => x.seed === seed)!.referenceId!) })));
    expect(family2(r).direct).toBe(1); expect(r.wrongAccepted).toEqual([]);
  });
  it("the alternate request with its own linked reference counts as a correct direct answer on every seed", () => {
    const r = run(observe(seed => ({ request: altRequest(seed), result: { total: "10.00", alt: seed } })));
    expect(family2(r).direct).toBe(1); expect(r.wrongAccepted).toEqual([]); expect(r.integrityIssues).toEqual([]);
  });
  it("the alternate request with the GOLD request's result is a wrong acceptance (the application's answer is not borrowed)", () => {
    const r = run(observe(seed => ({ request: altRequest(seed), result: value(SHEL.required.find(x => x.seed === seed)!.referenceId!) })));
    expect(family2(r).direct).toBe(0); expect(r.wrongAccepted.length).toBeGreaterThan(0);
  });
  it("any other request is a wrong acceptance", () => {
    const r = run(observe(seed => ({ request: { ...altRequest(seed), vendors: ["she", "sams club"] }, result: { total: "10.00", alt: seed } })));
    expect(family2(r).direct).toBe(0); expect(r.wrongAccepted.length).toBeGreaterThan(0);
  });
  it("an alternate whose reference carries no admissible receipt earns nothing", () => {
    const r = run(observe(seed => ({ request: altRequest(seed), result: { total: "10.00", alt: seed } })), references("not-a-receipt"));
    expect(family2(r).direct).toBe(0);
  });
  it("one seed on the alternate and the others missing the result is not a direct answer", () => {
    const r = run(observe(seed => seed === 303 ? { request: altRequest(seed), result: { total: "99.00" } } : { request: altRequest(seed), result: { total: "10.00", alt: seed } }));
    expect(family2(r).direct).toBe(0);
  });
});
