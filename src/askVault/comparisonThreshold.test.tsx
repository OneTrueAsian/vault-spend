// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import type { CorpusCase, Observation } from "../testSupport/askVaultM6/manifest";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";
import { answer, request as oracleRequest } from "../testSupport/askVaultM6/referenceOracle";
import { buildReplyIndex, observeCase, type RouteEnv } from "../testSupport/askVaultM6/routeHarness";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Owner instruction Q3 (answers of 21 October 2026): the approved gold `m2-enabled-comparison-v1` for "compare purchases over $100 this month to last month"
 * must be answered, not refused. Public-route tests, written before the harness change (RED first).
 *
 * Finding that shapes the fix: the shipped Dashboard ALWAYS hands the card a family list (src/DashboardView.tsx:321-322 `familyMembers: familyMembers.map(...)`, an array
 * that may be empty), and the parser treats a defined family list as the M2 context (src/askVault/parser.ts:994 `version2`), where a threshold in a comparison is
 * allowed (parserV2.test.ts "comparison purchase thresholds"). The three M1-origin cases were refused only because the frozen M1-era parse context has NO family list,
 * a context the shipped app never builds. So the defect was in how the harness mounted the card, not in the parser; the intentional M1-mode refusal is kept.
 */
const DIR = "src/testSupport/askVaultM6";
const read = (name: string) => JSON.parse(readFileSync(`${DIR}/${name}`, "utf8"));
const cases: CorpusCase[] = read("cases.json"), contexts = read("contexts.json"), requests = read("expectedRequests.json"), references = read("referenceResults.json");
const env: RouteEnv = { contexts, requests, references };
const family = cases.filter(c => c.family === "m2:comparison-threshold");
const proofs = { "native-proof-ordinary.json": readFileSync(`${DIR}/nativeProofs/native-proof-ordinary.json`, "utf8") };
const manifest = read("nativeEvidenceManifest.json");

describe("comparison with a purchase threshold, through the real card as the app mounts it", () => {
  it("covers the 27 approved cases (3 M1-origin and 24 M2) on three seeds each", () => {
    expect(family).toHaveLength(27);
    expect(family.filter(c => c.id.startsWith("m1/")).length).toBe(3);
    expect(family.every(c => c.required.length === 3)).toBe(true);
    expect(new Set(family.flatMap(c => c.required.map(r => r.seed)))).toEqual(new Set([101, 202, 303]));
  });
  it("every case on every seed sends the exact approved full request and shows both periods' results, graded clean on the real native proof", async () => {
    const index = buildReplyIndex(env), observations: Observation[] = [];
    for (const c of family) for (const r of c.required) observations.push(await observeCase(c, r, env, index));
    expect(observations.every(o => o.stage === "result")).toBe(true);
    const g = gradeCorpus({ cases: family, requests, references, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "corpus", proofs, manifest, contexts } });
    expect(g.issues.filter(m => !/comparison-threshold/.test(m))).toEqual([]);
    expect(g.integrityIssues).toEqual([]); expect(g.evidenceProblems).toEqual([]); expect(g.wrongAccepted).toEqual([]);
    const distinct = new Set(family.map(c => c.text.normalize("NFC").trim().replace(/s+/gu, " ").toLowerCase())).size;
    expect(g.families.find(f => f.family === "m2:comparison-threshold")).toMatchObject({ status: "PASS", total: distinct, direct: distinct });
    for (const o of observations) expect((o.result as { displayMismatch?: boolean }).displayMismatch).toBeUndefined();
  }, 120_000);
  it("strict and inclusive thresholds are distinct full requests in the approved gold", () => {
    const strict = family.find(c => c.text === "compare what sam spent on clothing over 100.00 this month to last month")!;
    const inclusive = family.find(c => c.text === "compare what sam spent on clothing at least 100.00 this month to last month")!;
    expect(requests[strict.required[0].requestId!].minimumPurchase).toEqual({ amount: "100.00", inclusive: false });
    expect(requests[inclusive.required[0].requestId!].minimumPurchase).toEqual({ amount: "100.00", inclusive: true });
  });
  it("DISCLOSED GAP GUARD: the frozen worlds hold no purchase on the 100.00 boundary, so strict, inclusive and 100.01 give identical results there; boundary sensitivity is proved separately in comparisonThresholdBoundary.test.tsx", () => {
    const sig = (c: CorpusCase) => JSON.stringify(c.required.map(r => references[r.referenceId!].value.periods.map((p: { total: string; purchaseCount: number }) => [p.total, p.purchaseCount])));
    const byText = (t: string) => sig(family.find(c => c.text === t)!);
    expect(byText("compare what sam spent on clothing over 100.00 this month to last month")).toBe(byText("compare what sam spent on clothing at least 100.00 this month to last month"));
    expect(byText("compare what sam spent on clothing over 100.00 this month to last month")).toBe(byText("compare what sam spent on clothing over 100.01 this month to last month"));
  });
  it("the exact results are reproduced by the independent oracle (parent-amount thresholds, both periods) on every seed's world", () => {
    let checked = 0;
    for (const c of family) for (const r of c.required) {
      const world = contexts.worlds[contexts.contexts[r.contextId].worldId];
      const req = requests[r.requestId!], ref = references[r.referenceId!].value;
      const { contractVersion: _v, ...rest } = req;
      const expected = answer(world, oracleRequest({ ...rest, members: req.members ?? { ids: [], unassigned: false } }));
      expect(ref.thresholdBasis).toBe("absolute-parent-amount");
      expect(ref.periods.map((p: { total: string; purchaseCount: number }) => [p.total, p.purchaseCount]), `${c.id} ${r.seed}`).toEqual(expected.periods.map(p => [p.total, p.purchaseCount]));
      expect(ref.difference).toBe(expected.difference); checked++;
    }
    expect(checked).toBe(81);
  });
  it("unsupported combinations are still refused with nothing read", async () => {
    const base = cases.find(c => c.id === "m1/101-0295")!;
    for (const text of ["compare groceries under $100 this month to last month", "compare groceries over $100 and over $200 this month to last month", "compare 3 purchases this month to last month", "compare purchases over $100 this month to last month as a percentage"]) {
      const o = await observeCase({ ...base, text }, base.required[0], env, buildReplyIndex(env));
      expect(o.stage, text).not.toBe("result"); expect(o.accepted, text).toEqual([]);
    }
  }, 60_000);
  it("the intentional M1-mode refusal is kept for a context with no family list, which the shipped app never builds", async () => {
    const m1 = family.find(c => c.id === "m1/101-0295")!;
    const o = await observeCase(m1, m1.required[0], env, buildReplyIndex(env), { contextMode: "frozen" });
    expect(o.stage).toBe("refusal");
    const dashboard = readFileSync("src/DashboardView.tsx", "utf8");
    expect(dashboard).toContain("familyMembers: familyMembers.map(({ id, name }) => ({ id, name })),");
  }, 30_000);
});
