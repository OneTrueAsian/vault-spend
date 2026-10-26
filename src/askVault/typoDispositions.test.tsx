// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import type { CorpusCase, Observation } from "../testSupport/askVaultM6/manifest";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";
import { buildReplyIndex, observeCase, type RouteEnv } from "../testSupport/askVaultM6/routeHarness";
import { ordinaryCandidates, storeCandidates, type Roster } from "../testSupport/askVaultM6/typoRulesOracle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Owner decision Q1 (21 October 2026): freeze, BEFORE grading, each flagged case's intended subject, permitted candidates, classification and preserved clauses,
 * keeping the existing matching bounds (typoRules.json) and the flagged cases in their existing P-CORE denominators. The dispositions are frozen in
 * flaggedDispositions.json; the permitted candidates come from the independent restatement of the rules (typoRulesOracle.ts) over each case's own roster; the intended
 * subject is the reviewed wording of the retained batch and is cross-checked against the approved gold request. This test then compares the live card with them.
 */
const DIR = "src/testSupport/askVaultM6";
const read = (name: string) => JSON.parse(readFileSync(`${DIR}/${name}`, "utf8"));
const cases: CorpusCase[] = read("cases.json"), contexts = read("contexts.json"), requests = read("expectedRequests.json"), references = read("referenceResults.json");
const env: RouteEnv = { contexts, requests, references };
const key = (t: string) => t.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
const rosterOf = (contextId: string): Roster => { const p = contexts.contexts[contextId].parseContext; return { categories: p.categories, accounts: p.accounts, members: p.members ?? [], merchants: p.merchants }; };

const FLAGGED = "E:/misc/Programming/Agents/Implementations/Ask Vault Ehancements/M6/parallel/agent-a/Flagged-Clarifications.json";
if (process.env.M6_WRITE_TYPO_DISPOSITIONS === "1") {
  const target = `${DIR}/flaggedDispositions.json`;
  if (existsSync(target)) throw new Error("flaggedDispositions.json already exists; a change needs a new, disclosed version.");
  const flagged = JSON.parse(readFileSync(FLAGGED, "utf8")) as { ordinaryObservedRows: { suite: string; id: string; seed: number; text: string; typedClause: string; proposedCandidateForReview: string; tags: string[] }[] };
  const byText = new Map<string, typeof flagged.ordinaryObservedRows>();
  for (const r of flagged.ordinaryObservedRows) byText.set(key(r.text), [...(byText.get(key(r.text)) ?? []), r]);
  const entries = [...byText.entries()].map(([k, rows]) => {
    const c = cases.find(x => key(x.text) === k)!;
    const roster = rosterOf(c.required[0].contextId), typed = rows[0].typedClause, intended = rows[0].proposedCandidateForReview;
    const store = rows[0].tags.includes("store-typo");
    const gold = requests[c.required[0].requestId!];
    const candidates = store ? storeCandidates(typed, roster).suggestions : ordinaryCandidates(typed, roster);
    const intendedTerm = intended.toLowerCase();
    const preserved = { kind: gold.kind, periods: gold.periods, limit: gold.limit, minimumPurchase: gold.minimumPurchase, categories: store ? gold.categories : gold.categories.filter((x: string) => key(x) !== key(intended)),
      vendors: store ? gold.vendors.filter((v: string) => !intendedTerm.startsWith(v) && v !== intendedTerm) : gold.vendors, excludeVendors: gold.excludeVendors, excludeCategories: gold.excludeCategories,
      contractVersion: gold.contractVersion ?? 1, groupBy: gold.groupBy ?? "none", average: gold.average ?? "none" };
    return { caseId: c.id, text: c.text, population: c.population, family: c.family, flaggedSources: rows.map(r => `${r.suite}:${r.id}@${r.seed}`),
      entityClass: store ? "store" : "ordinary-entity", rule: store ? "R-STORE" : "R-ORDINARY", typedClause: typed, intendedSubject: intended, permittedCandidates: candidates,
      classification: candidates.length === 1 && !store ? "bounded-correction-answers" : "candidate-choice", preservedClauses: preserved,
      goldRequestIds: c.required.map(r => r.requestId), countsAs: { directAnswer: false, completionCountsToward600: true, denominator: c.population } };
  });
  writeFileSync(target, JSON.stringify({ version: "m6-flagged-dispositions-1", writtenBy: "session bec4530a-cba4-40c4-b585-ecb9aed91bfa, 2026-10-21", authority: "Owner decision Q1, 21 October 2026; rules in typoRules.json",
    standing: ["A unique bounded correction may answer when the contract permits, with the correction disclosed", "Genuine ambiguity must ask", "A permitted candidate choice is a direct-answer miss; a correct completion may count toward the 600",
      "Flagged supported cases stay in their existing P-CORE denominators", "No universal edit distance or margin, no wider matching, no account aliases"], entries }, null, 1) + "\n");
}

const disp = read("flaggedDispositions.json") as { entries: { caseId: string; text: string; entityClass: string; typedClause: string; intendedSubject: string; permittedCandidates: string[]; classification: string;
  preservedClauses: Record<string, any>; goldRequestIds: string[]; countsAs: { denominator: string } }[] };
const squash = (s: string) => s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();

describe("flagged typo cases are frozen with subject, candidates, classification and preserved clauses", () => {
  it("covers all 17 distinct flagged ordinary texts, each an existing P-CORE case with its approved full request on three seeds", () => {
    expect(disp.entries).toHaveLength(17);
    for (const e of disp.entries) {
      const c = cases.find(x => x.id === e.caseId)!;
      expect(c.population, e.caseId).toBe("P-CORE"); expect(e.countsAs.denominator).toBe("P-CORE");
      expect(c.required.map(r => r.requestId)).toEqual(e.goldRequestIds); expect(e.goldRequestIds.every(Boolean)).toBe(true);
    }
  });
  it("each intended subject is in the approved gold request, and each preserved clause equals the gold's, so a completion cannot drop or change a clause", () => {
    for (const e of disp.entries) {
      const gold = requests[e.goldRequestIds[0]!];
      const subject = squash(e.intendedSubject);
      const inGold = [...gold.categories, ...gold.vendors].some((x: string) => squash(x) === subject || squash(x).startsWith(subject) || subject.startsWith(squash(x)));
      expect(inGold, `${e.caseId}: ${e.intendedSubject} in ${JSON.stringify([gold.categories, gold.vendors])}`).toBe(true);
      expect(e.preservedClauses.periods).toEqual(gold.periods); expect(e.preservedClauses.kind).toBe(gold.kind); expect(e.preservedClauses.limit).toBe(gold.limit);
      expect(e.preservedClauses.minimumPurchase).toEqual(gold.minimumPurchase);
    }
  });
  it("the intended subject is among the permitted candidates, and no case is classified as an unasked correction", () => {
    for (const e of disp.entries) {
      expect(e.permittedCandidates.length, e.caseId).toBeGreaterThan(0);
      expect(e.permittedCandidates.map(squash).some(x => x.startsWith(squash(e.intendedSubject)) || squash(e.intendedSubject).startsWith(x)), `${e.caseId} ${e.intendedSubject} in ${e.permittedCandidates}`).toBe(true);
      expect(e.classification, e.caseId).toBe("candidate-choice");
    }
  });
  it("the live card offers exactly the permitted candidates, then completes the intended one to the exact approved request on every seed, graded as a direct miss that counts toward the 600", async () => {
    const index = buildReplyIndex(env);
    const picked = disp.entries.map(e => cases.find(c => c.id === e.caseId)!);
    const firsts: Observation[] = [], completions: Observation[] = [];
    for (const e of disp.entries) {
      const c = cases.find(x => x.id === e.caseId)!;
      for (const r of c.required) {
        const first = await observeCase(c, r, env, index);
        expect(first.stage, `${e.caseId} ${r.seed}`).toBe("clarify");
        const offered = (first.offeredChoices ?? []).map(squash);
        expect([...offered].sort(), `${e.caseId} ${r.seed}`).toEqual(e.permittedCandidates.map(squash).sort());
        firsts.push(first);
        completions.push(await observeCase(c, r, env, index, { choose: labels => labels.find(l => squash(l) === squash(e.intendedSubject) || squash(l).startsWith(squash(e.intendedSubject))) ?? null }));
      }
    }
    const g = gradeCorpus({ cases: picked, requests, references, observations: completions, requiredFamilies: [...REQUIRED_FAMILY_IDS],
      evidence: { kind: "corpus", proofs: { "native-proof-ordinary.json": readFileSync(`${DIR}/nativeProofs/native-proof-ordinary.json`, "utf8") }, manifest: read("nativeEvidenceManifest.json"), contexts } });
    expect(g.integrityIssues).toEqual([]); expect(g.evidenceProblems).toEqual([]); expect(g.wrongAccepted).toEqual([]);
    expect(g.financialTexts).toBe(17);            // every correct completion counts toward the 600
    expect(g.core).toEqual({ total: 17, direct: 0, withinOne: 17 });   // and none is a direct answer
    expect(firsts.every(o => o.accepted.length === 0)).toBe(true);     // nothing was answered before the person chose
  }, 240_000);
  it("choosing a candidate that is not the intended subject does not match the approved request", async () => {
    const index = buildReplyIndex(env);
    const e = disp.entries.find(x => x.permittedCandidates.length > 1)!;
    const c = cases.find(x => x.id === e.caseId)!;
    const other = await observeCase(c, c.required[0], env, index, { choose: labels => labels.find(l => squash(l) !== squash(e.intendedSubject)) ?? null });
    if (other.stage === "result") expect(JSON.stringify(other.request)).not.toBe(JSON.stringify(requests[c.required[0].requestId!]));
    else expect(other.accepted).toEqual([]);
  }, 60_000);
});
