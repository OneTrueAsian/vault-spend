// @vitest-environment jsdom
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { observeCase, buildReplyIndex, type RouteEnv } from "../testSupport/askVaultM6/routeHarness";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";
import type { CorpusCase, Observation } from "../testSupport/askVaultM6/manifest";
import { observeHistoryCase } from "../testSupport/askVaultM6/historyRoute";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const read = (file: string) => JSON.parse(readFileSync(`src/testSupport/askVaultM6/${file}`, "utf8"));
const cases: CorpusCase[] = read("cases.json");
const env: RouteEnv = { contexts: read("contexts.json"), requests: read("expectedRequests.json"), references: read("referenceResults.json") };
const historyObservations: Observation[] = [];
afterAll(() => { if (process.env.M6_HISTORY_OUT) writeFileSync(process.env.M6_HISTORY_OUT,JSON.stringify({evidenceBoundary:"Fresh actual-card history-control observations, no financial credit",observations:historyObservations},null,2)+"\n"); });

describe("clarification burden counts exchanges, not candidate buttons (CG-11)", () => {
  it.each(read("historyCases.json") as (CorpusCase & {flow:"m3"|"m4";complete:number})[])("$id observes the actual labelled manual/history control without granting financial credit", async c => {
    const observation = await observeHistoryCase(c);
    historyObservations.push(observation);
    expect(observation.stage).toBe("history-choice");
    expect(observation.accepted).toEqual([]);
    expect(observation.consented).toBe(false);
  });
  it("one actual clarification with several choices is one exchange and not a multi-clarification", async () => {
    const c = cases.find(c => c.id === "m1/101-0250")!;
    expect(c).toBeDefined();
    const observation = await observeCase(c, c.required[0], env, buildReplyIndex(env));
    expect(observation.stage).toBe("clarify");
    expect(observation.offeredChoices!.length).toBeGreaterThanOrEqual(3);
    expect(observation.meaningChoices).toBe(1);
    const oos: CorpusCase = { ...c, population: "P-OOS", family: "oos:clarification-counter", required: [{ ...c.required[0], requestId: null, referenceId: null }] };
    const result = gradeCorpus({ cases: [oos], requests: {}, references: {}, observations: [observation], requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "corpus", proofs: {}, manifest: { proofs: {}, identities: {} }, contexts: { worlds: {}, contexts: {} } } });
    expect(result.outOfScopeReport[0]).toMatchObject({ clarified: 1, multiClarification: 0 });
    expect(result.financialTexts).toBe(0);
  });
});
