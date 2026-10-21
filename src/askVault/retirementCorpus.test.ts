import { describe, expect, it } from "vitest";
import {
  CORPUS_CONTEXTS, CORPUS_VERSION, LEDGER_INTERACTIONS, RETIREMENT_CORPUS, RETIREMENT_GATES, UNSUPPORTED_CODES, retirementCorpusDenominators, retirementScoringPlan,
} from "./retirementCorpus";
import type { CorpusCase } from "./retirementCorpus";
import { retirementNativeFixtures } from "./retirementNativeFixtures";
import { validateRetirementDraft } from "./retirementScenarioContract";
import type { RetirementDraft } from "./retirementScenarioContract";

// Frozen copy of the 13 m5-retire entries of the original development bank (corpus.ts, run 2026-10-14). Do not edit to improve a score.
const ORIGINALS: { id: string; text: string; expectation: string }[] = [
  { id: "m5-retire-01", text: "How much would my Roth IRA balance increase if I saved an extra $50 per month until June 2050, assuming 6% a year", expectation: "answer" },
  { id: "m5-retire-02", text: "What about $100 instead?", expectation: "answer" },
  { id: "m5-retire-03", text: "extra $100 per month into my Roth IRA until June 2050 at 7%", expectation: "answer" },
  { id: "m5-retire-04", text: "what if I add a one-time $5,000 to my Roth IRA now, retiring June 2050 at 6%", expectation: "answer" },
  { id: "m5-retire-05", text: "extra $50 a month into the Roth IRA until June 2050 with no growth", expectation: "answer" },
  { id: "m5-retire-06", text: "an extra $200 per month in my Roth IRA until June 2050 at 5%", expectation: "answer" },
  { id: "m5-retire-07", text: "how much would my retirement increase if I saved an extra $50", expectation: "clarify" },
  { id: "m5-retire-08", text: "how much would my retirement balance increase if I saved an extra $50 per month", expectation: "clarify" },
  { id: "m5-retire-09", text: "what if I saved an extra $200 a month for retirement", expectation: "clarify" },
  { id: "m5-retire-10", text: "how much income will I have in retirement", expectation: "unsupported" },
  { id: "m5-retire-11", text: "will I have enough to retire", expectation: "refuse" },
  { id: "m5-retire-12", text: "what if I saved an extra $50 a month in my 401k", expectation: "not-found" },
  { id: "m5-retire-13", text: "include my employer match in the extra $50 a month", expectation: "unsupported" },
];
const FAMILIES = ["monthly-extra", "once-extra", "return-wording", "inflation-wording", "account-choice", "close-name", "quoted-name", "missing-choice", "date-wording", "future-start", "unsupported-scope", "unsupported-advice",
  "interacting-clause", "boundary", "route-elsewhere", "negation", "follow-up", "original-clarify"];
const draftOf = (c: CorpusCase): RetirementDraft | null => (c.expected.kind === "retirement" ? { sourceText: c.text, ...structuredClone(c.expected.draft) } : null);

describe("A6-1 the corpus is frozen, versioned and executable", () => {
  it("has a version and unique, ordered ids", () => {
    expect(CORPUS_VERSION).toMatch(/^m5-corpus-v\d+$/);
    const ids = RETIREMENT_CORPUS.map(c => c.id); expect(new Set(ids).size).toBe(ids.length); expect(ids.every(id => /^m5c-\d{3}$/.test(id))).toBe(true);
    expect([...ids].sort()).toEqual(ids);
  });
  it("uses only known contexts whose rosters are valid", () => {
    for (const c of RETIREMENT_CORPUS) expect(CORPUS_CONTEXTS[c.context]).toBeDefined();
    for (const [name, context] of Object.entries(CORPUS_CONTEXTS)) { expect(new Set(context.investmentAccounts.map(a => a.id)).size, name).toBe(context.investmentAccounts.length); expect(context.today).toBe("2026-09-06"); }
  });
  for (const c of RETIREMENT_CORPUS) {
    it(`case ${c.id} (${c.family}) is a well-formed expectation`, () => {
      expect(c.text.trim().length).toBeGreaterThan(5); expect([...c.text].length).toBeLessThanOrEqual(520);
      expect(FAMILIES).toContain(c.family);
      const draft = draftOf(c);
      if (draft) { expect(validateRetirementDraft(draft, CORPUS_CONTEXTS[c.context])).toEqual({ ok: true }); expect(draft.hints.every(h => draft.sourceText.slice(h.start, h.end) === h.text)).toBe(true); }
      if (c.expected.kind === "retirement-clarify") { expect(c.expected.choices.length).toBeGreaterThan(0); expect(new Set(c.expected.choices.map(x => x.label)).size).toBe(c.expected.choices.length); expect(c.expected.why.length).toBeGreaterThan(5); }
      if (c.expected.kind === "retirement-unsupported") expect(UNSUPPORTED_CODES).toContain(c.expected.reasonCode);
    });
  }
  it("covers every outcome kind and every family at least twice", () => {
    expect(new Set(RETIREMENT_CORPUS.map(c => c.expected.kind))).toEqual(new Set(["retirement", "retirement-clarify", "retirement-unsupported", "route-elsewhere"]));
    for (const family of FAMILIES) expect(RETIREMENT_CORPUS.filter(c => c.family === family).length, family).toBeGreaterThanOrEqual(2);
  });
  it("freezes every unsupported reason code with at least one case, and no code is unused", () => {
    const used = new Set(RETIREMENT_CORPUS.flatMap(c => (c.expected.kind === "retirement-unsupported" ? [c.expected.reasonCode] : [])));
    for (const code of UNSUPPORTED_CODES) expect(used.has(code), code).toBe(true);
  });
  it("never accepts an assumed return, cadence, account or retirement month: absent terms stay null and listed as missing", () => {
    for (const c of RETIREMENT_CORPUS) { const d = draftOf(c); if (!d) continue;
      if (d.accountId === null) expect(d.missing).toContain("account");
      if (d.extra.kind === null) expect(d.missing).toContain("cadence");
      if (d.extra.amount === null) expect(d.missing).toContain("extra-amount");
      if (d.retirementMonth === null) expect(d.missing).toContain("retirement-month");
    }
  });
  it("an unstated start is the supported start (today); a stated later start stays visible as a missing choice", () => {
    const today = CORPUS_CONTEXTS.single.today;
    for (const c of RETIREMENT_CORPUS) { const d = draftOf(c); if (!d) continue; expect(d.startDate === today || d.startDate === null).toBe(true); if (d.startDate === null) { expect(d.missing).toContain("start-date"); expect(d.hints.some(h => h.field === "start-date")).toBe(true); } }
  });
  it("never lets an assumption candidate outside the preview bounds into a draft", () => {
    for (const c of RETIREMENT_CORPUS) { const d = draftOf(c); if (!d) continue; for (const v of [d.assumptions.annualReturnPct]) if (v !== null) { expect(Number(v)).toBeGreaterThanOrEqual(-100); expect(Number(v)).toBeLessThanOrEqual(100); } }
  });
});

describe("A6-2 original-bank reconciliation", () => {
  const originals = RETIREMENT_CORPUS.filter(c => c.provenance === "original-bank");
  it("keeps all 13 original entries verbatim, in order, with their original expectation class and a stated drift", () => {
    expect(originals.map(c => c.original?.id)).toEqual(ORIGINALS.map(o => o.id));
    for (const [i, o] of ORIGINALS.entries()) { expect(originals[i].text).toBe(o.text); expect(originals[i].original!.expectation).toBe(o.expectation); expect(originals[i].original!.drift.length).toBeGreaterThan(15); }
  });
  it("older labels never bypass current safeguards: no original 'answer' maps to an immediate result", () => {
    for (const c of originals.filter(x => x.original!.expectation === "answer")) expect(["retirement", "route-elsewhere"]).toContain(c.expected.kind);
  });
  it("a scope gap is kept visible as a gap, not relabelled as unsupported to improve a score", () => {
    const gaps = originals.filter(c => c.original!.knownGap);
    expect(gaps.map(c => c.original!.id)).toEqual(["m5-retire-02"]);
    for (const g of gaps) expect(g.expected.kind).toBe("route-elsewhere");
    expect(originals.filter(c => c.expected.kind === "retirement-unsupported").every(c => ["unsupported", "refuse", "not-found"].includes(c.original!.expectation))).toBe(true);
  });
  it("supplements never reuse an original id", () => { for (const c of RETIREMENT_CORPUS.filter(x => x.provenance === "supplement")) expect(c.original).toBeUndefined(); });
});

describe("A6-3 grading units and explicit denominators (E9)", () => {
  const d = retirementCorpusDenominators();
  it("reports interpretation, necessary clarification, refusal, route-elsewhere and completed paths separately", () => {
    for (const key of ["total", "originals", "supplements", "interpretationDrafts", "fullySpecifiedDrafts", "draftsNeedingChoices", "necessaryClarifications", "refusals", "routeElsewhere", "knownGaps", "consentActions", "choiceActions"])
      expect(typeof d[key], key).toBe("number");
    expect(d.total).toBe(RETIREMENT_CORPUS.length);
    expect(d.interpretationDrafts + d.necessaryClarifications + d.refusals + d.routeElsewhere).toBe(d.total);
    expect(d.originals + d.supplements).toBe(d.total);
    expect(d.fullySpecifiedDrafts + d.draftsNeedingChoices).toBe(d.interpretationDrafts);
  });
  it("counts consent for every draft and never removes it to improve a score", () => {
    expect(d.consentActions).toBe(d.interpretationDrafts);
    const choices = RETIREMENT_CORPUS.reduce((n, c) => n + (c.expected.kind === "retirement" ? c.expected.draft.missing.length : 0), 0);
    expect(d.choiceActions).toBe(choices);
  });
  it("does not report any draft as a completed answer", () => { expect(d.completedWithoutConsent ?? 0).toBe(0); expect(Object.keys(d)).not.toContain("directAnswers"); });
  it("the declared denominators are frozen", () => {
    expect(d).toMatchObject({ total: 77, originals: 13, supplements: 64, knownGaps: 1, choiceActions: 19, consentActions: 44 });
    expect(d.interpretationDrafts).toBe(DECLARED.interpretationDrafts); expect(d.fullySpecifiedDrafts).toBe(DECLARED.fullySpecifiedDrafts); expect(d.necessaryClarifications).toBe(DECLARED.necessaryClarifications);
    expect(d.refusals).toBe(DECLARED.refusals); expect(d.routeElsewhere).toBe(DECLARED.routeElsewhere);
  });
  it("counts clusters (families) and per-family totals that sum to the corpus", () => {
    const byFamily = Object.entries(d).filter(([k]) => k.startsWith("family:"));
    expect(byFamily.length).toBe(FAMILIES.length); expect(byFamily.reduce((n, [, v]) => n + v, 0)).toBe(d.total);
  });
});

const DECLARED = { interpretationDrafts: 44, fullySpecifiedDrafts: 29, necessaryClarifications: 4, refusals: 22, routeElsewhere: 7 };

describe("A6-4/A6-5 gates and the performance protocol are recorded with explicit values", () => {
  it("carries the section 3 accuracy gates", () => {
    expect(RETIREMENT_GATES.section3).toMatchObject({ directAnswerCoverage: 0.95, perFamilyCoverage: 0.9, unnecessaryClarification: 0.05, wrongAcceptance: 0, necessaryAmbiguityCorrect: 1, unsupportedUnsafeCorrect: 1,
      longTail: { minCases: 100, direct: 0.8, withinOneClarification: 0.9 }, outOfScope: { minCases: 100 }, minimumLedgerSeeds: 3 });
  });
  it("does not invent an M5-only 650-prompt quota and says so", () => {
    expect(RETIREMENT_GATES.section3.releaseWide).toEqual({ prompts: 650, acceptedCases: 600, appliesToM5Only: false });
  });
  it("carries the section 9 gates and sample protocol", () => {
    expect(RETIREMENT_GATES.parser).toEqual({ normalP95Ms: 50, stressP95Ms: 100 });
    expect(RETIREMENT_GATES.confirmationToResultP95Ms).toBe(500); expect(RETIREMENT_GATES.inputAndCancelP95Ms).toBe(100); expect(RETIREMENT_GATES.longTaskMs).toBe(50);
    expect(RETIREMENT_GATES.samples).toEqual({ warmups: 5, warm: 30, freshStarts: 10 });
    expect(RETIREMENT_GATES.shapes).toEqual({ rows: [1000, 10000, 50000], layouts: ["concentrated", "spread"], names: ["long", "near-duplicate"] });
    expect(RETIREMENT_GATES.matchedQuery).toEqual({ toleranceMs: 50, toleranceFraction: 0.1 });
    expect(RETIREMENT_GATES.memory).toMatchObject({ investigationTriggerMiB: 100, hardCapMiB: null });
  });
  it("records an explicit, separate context-load target (E8): not inherited, not hidden behind the 500 ms gate", () => {
    const load = RETIREMENT_GATES.contextLoad;
    expect(load.recordedBy).toMatch(/prerequisite 6/i);
    expect(load.inheritsM4).toBe(false);
    expect(load.commandRoundTripWarmP95Ms).toEqual({ 1000: 300, 10000: 300, 50000: 300 });
    expect(load.submitToReviewReadyWarmP95Ms).toBe(500);
    expect(load.firstAfterLaunchMs).toBe(2000);
    expect(load.excludedFrom500msGate).toBe(true);
    expect(load.stages).toEqual(["parse", "ipc-dispatch", "native-read", "reply-validation", "review-render"]);
  });
});

describe("A6-6 every ledger interaction has proof assigned", () => {
  const caseIds = new Set(RETIREMENT_CORPUS.map(c => c.id)), fixtureIds = new Set(retirementNativeFixtures().map(f => f.id));
  it("lists the twelve interactions from the checklist", () => { expect(LEDGER_INTERACTIONS).toHaveLength(12); expect(new Set(LEDGER_INTERACTIONS.map(i => i.id)).size).toBe(12); });
  for (const interaction of LEDGER_INTERACTIONS) it(`interaction ${interaction.id} has existing evidence and an owner`, () => {
    expect(interaction.description.length).toBeGreaterThan(20); expect(interaction.owner.length).toBeGreaterThan(3);
    for (const id of interaction.cases) expect(caseIds.has(id), id).toBe(true);
    for (const id of interaction.fixtures) expect(fixtureIds.has(id), id).toBe(true);
    expect(interaction.cases.length + interaction.fixtures.length + interaction.tests.length).toBeGreaterThan(0);
    expect(["contract-proven", "specified-only", "assigned-to-workstream"]).toContain(interaction.status);
    if (interaction.status === "specified-only") expect(interaction.cases.length).toBeGreaterThan(0);
    if (interaction.status === "contract-proven") expect(interaction.fixtures.length + interaction.tests.length).toBeGreaterThan(0);
  });
});

// ---- Review defects F9 and F10 (independent review of 18 October 2026) ---------------------------------------------------------------------------------------
describe("F9 clarification cases freeze the ready replacement questions and the expected re-parse", () => {
  const clarifications = RETIREMENT_CORPUS.filter(c => c.expected.kind === "retirement-clarify");
  const byText = (text: string, context: string) => { const found = clarifications.find(c => c.text === text && c.context === context); if (!found) throw new Error("no clarification: " + text); return found; };
  // Hand-written gold, independent of the corpus module: [original text, context, [label, ready question, account id, month]].
  const GOLD: [string, string, [string, string, number, string][]][] = [
    ["extra $50 a month into my Roth IRA or Brokerage until June 2050", "two", [["Roth IRA", "extra $50 a month into my Roth IRA until June 2050", 5, "2050-06"], ["Brokerage", "extra $50 a month into my Brokerage until June 2050", 8, "2050-06"]]],
    ["extra $50 a month into my Roth IRAA until June 2050", "single", [["Roth IRA", "extra $50 a month into my Roth IRA until June 2050", 5, "2050-06"]]],
    ["extra $50 a month into my Roth IR until June 2050", "single", [["Roth IRA", "extra $50 a month into my Roth IRA until June 2050", 5, "2050-06"]]],
    ["extra $50 a month into my Roth IRA until June", "single", [["June 2027", "extra $50 a month into my Roth IRA until June 2027", 5, "2027-06"], ["June 2028", "extra $50 a month into my Roth IRA until June 2028", 5, "2028-06"], ["June 2029", "extra $50 a month into my Roth IRA until June 2029", 5, "2029-06"]]],
  ];
  it("has exactly the four clarification cases, and the gold covers each", () => {
    expect(clarifications).toHaveLength(4);
    expect(GOLD.map(g => byText(g[0], g[1]).id).sort()).toEqual(clarifications.map(c => c.id).sort());
  });
  for (const [text, context, choices] of GOLD) {
    it(`"${text}" keeps its original question and offers exactly the gold replacement questions`, () => {
      const c = byText(text, context); if (c.expected.kind !== "retirement-clarify") throw new Error("not a clarification");
      expect(c.expected.originalQuestion).toBe(text);
      expect(c.expected.choices.map(x => x.label)).toEqual(choices.map(g => g[0]));
      expect(c.expected.choices.map(x => x.replacementQuestion)).toEqual(choices.map(g => g[1]));
    });
    it(`"${text}" freezes the next draft each choice must re-parse to, retaining every clause`, () => {
      const c = byText(text, context); if (c.expected.kind !== "retirement-clarify") throw new Error("not a clarification");
      for (const [i, [label, question, accountId, month]] of choices.entries()) {
        const choice = c.expected.choices[i], next = choice.next;
        expect(next.kind, label).toBe("retirement");
        const draft: RetirementDraft = { sourceText: choice.replacementQuestion, ...structuredClone(next.draft) };
        expect(validateRetirementDraft(draft, CORPUS_CONTEXTS[c.context]), label).toEqual({ ok: true });
        // The amount, the cadence and the date survive the choice: nothing is dropped or guessed.
        expect(draft.accountId, label).toBe(accountId); expect(draft.extra, label).toEqual({ kind: "monthly", amount: "50" }); expect(draft.retirementMonth, label).toBe(month);
        expect(draft.startDate, label).toBe(CORPUS_CONTEXTS[c.context].today); expect(draft.missing, label).toEqual([]);
        expect(question).toContain("$50 a month"); expect(choice.replacementQuestion).toBe(question);
        expect(draft.hints.some(h => h.field === "account" && h.start >= 0), label).toBe(true); expect(draft.hints.some(h => h.field === "retirement-month"), label).toBe(true);
      }
    });
  }
  it("every replacement question is a different, ready, bounded question that keeps all of the original's other clauses", () => {
    for (const c of clarifications) { if (c.expected.kind !== "retirement-clarify") continue;
      expect(new Set(c.expected.choices.map(x => x.replacementQuestion)).size, c.id).toBe(c.expected.choices.length);
      expect(new Set(c.expected.choices.map(x => x.label)).size, c.id).toBe(c.expected.choices.length);
      for (const choice of c.expected.choices) {
        expect(choice.replacementQuestion, c.id).not.toBe(c.text); expect([...choice.replacementQuestion].length).toBeLessThanOrEqual(512);
        expect(choice.replacementQuestion.startsWith("extra $50 a month into my "), c.id).toBe(true);
        expect(choice.replacementQuestion.includes("until June"), c.id).toBe(true);
      }
    }
  });
  it("a re-parse expectation agrees with any other corpus case that has the same text and context", () => {
    for (const c of clarifications) { if (c.expected.kind !== "retirement-clarify") continue;
      for (const choice of c.expected.choices) for (const other of RETIREMENT_CORPUS) if (other.text === choice.replacementQuestion && other.context === c.context) expect(other.expected, `${c.id} -> ${other.id}`).toEqual({ kind: "retirement", draft: choice.next.draft });
    }
  });
  it("counts the re-parse expectations as their own denominator, separate from the first-pass clarification count", () => {
    const d = retirementCorpusDenominators();
    expect(d.necessaryClarifications).toBe(4); expect(d.clarificationChoices).toBe(7); expect(d.reparseDrafts).toBe(7);
    expect(d.interpretationDrafts).toBe(44); // re-parse drafts are not added to the first-pass draft count
  });
});

describe("F10 per-family completion denominators and the scoring rules are frozen", () => {
  const plan = retirementScoringPlan();
  // Hand-checked against the corpus listing: [cases, fully specified, needing choices, clarifications, refusals, route-elsewhere, known gaps].
  const TABLE: Record<string, [number, number, number, number, number, number, number]> = {
    "monthly-extra": [9, 9, 0, 0, 0, 0, 0], "once-extra": [4, 4, 0, 0, 0, 0, 0], "return-wording": [8, 7, 0, 0, 1, 0, 0], "inflation-wording": [2, 2, 0, 0, 0, 0, 0],
    "account-choice": [4, 1, 2, 1, 0, 0, 0], "close-name": [2, 0, 0, 2, 0, 0, 0], "quoted-name": [2, 2, 0, 0, 0, 0, 0], "missing-choice": [5, 0, 5, 0, 0, 0, 0],
    "date-wording": [6, 0, 3, 1, 2, 0, 0], "future-start": [2, 0, 2, 0, 0, 0, 0], "unsupported-scope": [12, 0, 0, 0, 12, 0, 0], "unsupported-advice": [3, 0, 0, 0, 3, 0, 0],
    "interacting-clause": [2, 0, 0, 0, 2, 0, 0], boundary: [4, 2, 0, 0, 2, 0, 0], "route-elsewhere": [5, 0, 0, 0, 0, 5, 0], negation: [2, 2, 0, 0, 0, 0, 0],
    "follow-up": [2, 0, 0, 0, 0, 2, 1], "original-clarify": [3, 0, 3, 0, 0, 0, 0],
  };
  it("lists every family with explicit counts by outcome", () => {
    expect(Object.keys(plan.families).sort()).toEqual(Object.keys(TABLE).sort());
    for (const [family, [cases, full, choices, clar, refuse, away, gap]] of Object.entries(TABLE)) {
      const f = plan.families[family as keyof typeof plan.families];
      expect([f.cases, f.fullySpecifiedDrafts, f.draftsNeedingChoices, f.necessaryClarifications, f.refusals, f.routeElsewhere, f.knownGaps], family).toEqual([cases, full, choices, clar, refuse, away, gap]);
      expect(f.cases, family).toBe(f.fullySpecifiedDrafts + f.draftsNeedingChoices + f.necessaryClarifications + f.refusals + f.routeElsewhere);
    }
  });
  it("completion excludes the owner-approved numeric refusal, while all 29 fully specified drafts remain", () => {
    let sum = 0;
    for (const [family, row] of Object.entries(TABLE)) { const f = plan.families[family as keyof typeof plan.families]; expect(f.completionDenominator, family).toBe(row[1] - (family === "return-wording" ? 1 : 0)); sum += f.completionDenominator; }
    expect(sum).toBe(28); expect(sum).toBe(retirementCorpusDenominators().balanceCompletionDrafts); expect(retirementCorpusDenominators().fullySpecifiedDrafts).toBe(29);
  });
  it("the 90 percent family gate needs ceil(0.9 x denominator) successes, which is every case up to 9, and is not applicable at zero", () => {
    for (const [family, row] of Object.entries(TABLE)) {
      const f = plan.families[family as keyof typeof plan.families];
      if (row[1] === 0) { expect(f.completionApplicable, family).toBe(false); expect(f.completionRequiredPassing, family).toBeNull(); }
      else { expect(f.completionApplicable, family).toBe(true); expect(f.completionRequiredPassing, family).toBe(Math.ceil(0.9 * (row[1] - (family === "return-wording" ? 1 : 0)))); }
    }
    expect(plan.families["monthly-extra"].completionRequiredPassing).toBe(9); expect(plan.families["return-wording"].completionRequiredPassing).toBe(6); expect(plan.families["account-choice"].completionRequiredPassing).toBe(1);
  });
  it("a family with no completion denominator is reported as not applicable, never as a pass, a fail or 100 percent", () => {
    expect(plan.rules.zeroDenominator).toBe("not-applicable");
    const na = Object.entries(plan.families).filter(([, f]) => !f.completionApplicable).map(([name]) => name).sort();
    expect(na).toEqual(["close-name", "date-wording", "follow-up", "future-start", "interacting-clause", "missing-choice", "original-clarify", "route-elsewhere", "unsupported-advice", "unsupported-scope"]);
    // Those families are still scored on their own populations below, at 100 percent.
    for (const name of na) { const f = plan.families[name as keyof typeof plan.families]; expect(f.cases, name).toBeGreaterThan(0); }
  });
  it("freezes the separate populations with their denominators and thresholds", () => {
    expect(plan.populations).toEqual({
      completion: { denominator: 28, requiredPassing: 27, fraction: 0.95, observed: "through the review card and consent in the compiled app, three ledger seeds" },
      unnecessaryClarification: { denominator: 28, allowedAtMost: 1, fraction: 0.05 },
      numericBoundaryRefusals: { denominator: 1, requiredFraction: 1 },
      interpretation: { denominator: 44, wrongAcceptanceAllowed: 0 },
      necessaryChoice: { draftsNeedingChoices: 15, choiceActions: 19, clarifications: 4, clarificationChoices: 7, requiredFraction: 1 },
      refusals: { denominator: 22, requiredFraction: 1 },
      routeNonInterference: { denominator: 7, requiredFraction: 1 },
      wrongAcceptance: { denominator: 77, allowed: 0 },
      originalBank: { entries: 13, knownGaps: 1 },
    });
  });
  it("scores known gaps in one place each: a miss in the original-bank report, and a pass in route non-interference when the question is left to the older routes", () => {
    expect(plan.rules.knownGap).toEqual({ originalBankReport: "miss", routeNonInterference: "pass-when-left-to-older-routes", completion: "excluded", otherReports: "excluded" });
    expect(plan.populations.originalBank).toEqual({ entries: 13, knownGaps: 1 });
  });
  it("never lets one population's rate stand in for another", () => {
    expect(plan.rules.separateReports).toEqual(["completion", "unnecessaryClarification", "interpretation", "necessaryChoice", "refusals", "numericBoundaryRefusals", "routeNonInterference", "wrongAcceptance", "originalBank"]);
    expect(plan.rules.draftsAreNotCompletions).toBe(true); expect(plan.rules.consentNeverRemoved).toBe(true);
  });
  it("matches the section 3 constants in the gates", () => {
    expect(Math.ceil(RETIREMENT_GATES.section3.directAnswerCoverage * plan.populations.completion.denominator)).toBe(plan.populations.completion.requiredPassing);
    expect(Math.floor(RETIREMENT_GATES.section3.unnecessaryClarification * plan.populations.unnecessaryClarification.denominator)).toBe(plan.populations.unnecessaryClarification.allowedAtMost);
  });
});
