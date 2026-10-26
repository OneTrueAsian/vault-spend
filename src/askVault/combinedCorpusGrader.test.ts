import { describe, expect, it } from "vitest";
import { gradeCorpus } from "../testSupport/askVaultM6/grader";
import type { CorpusCase, Observation, Reference } from "../testSupport/askVaultM6/manifest";
import { UNIT_STAND_IN_RECEIPT } from "../testSupport/askVaultM6/nativeEvidence";
import { REQUIRED_FAMILY_IDS } from "../testSupport/askVaultM6/registry";

const request = { kind: "total", periods: [{ from: "2026-09-01", to: "2026-09-30" }], categories: ["Dining"], minimumPurchase: null };
const result = { total: "12.34", purchaseCount: 2 };
function fixture() {
  const c: CorpusCase = { id: "one", text: "Dining spending last month", population: "P-CORE", family: "m1:total-category", cluster: "total", tags: [], required: [101,202,303].map(seed => ({ seed, contextId: "c"+seed, requestId: "q", referenceId: "r"+seed })) };
  const refs: Record<string,Reference> = Object.fromEntries(c.required.map(r=>[r.referenceId!, { value: result, seed: r.seed, contextId: r.contextId, requestId: "q", nativeReceipt: UNIT_STAND_IN_RECEIPT }]));
  const observations: Observation[] = c.required.map(r=>({ caseId:c.id,seed:r.seed,contextId:r.contextId,stage:"result",meaningChoices:0,accepted:[{request,result}],request,result,reviewed:true,consented:true }));
  // Gap remediation: requiredFamilies is the complete registry and the evidence is explicitly the unit-test stand-in kind (see combinedCorpusGraderGaps.test.ts).
  return { cases:[c], requests:{q:request}, references:refs, observations, requiredFamilies:[...REQUIRED_FAMILY_IDS], evidence:{ kind:"unit-stand-in" as const } };
}
describe("M6 grader detection power, deliberately fabricated stand-in evidence", () => {
  it("counts one text across three seeds and across duplicate IDs, not six answers", () => {
    const f=fixture(); const duplicate={...f.cases[0],id:"alias"};
    const g=gradeCorpus({...f,cases:[...f.cases,duplicate],observations:[...f.observations,...f.observations.map(o=>({...o,caseId:"alias"}))]});
    expect(g.financialTexts).toBe(1); expect(g.core.direct).toBe(1); expect(g.wrongAccepted).toEqual([]);
  });
  it.each(["request", "result", "missing seed", "duplicate seed", "draft", "no native receipt", "missing case", "wrong then recovered", "missing consent"])("rejects %s instead of granting financial credit", failure => {
    const f=fixture();
    if(failure==="request")f.observations[0].request={...request,categories:["Rent"]};
    if(failure==="result")f.observations[0].result={...result,total:"12.35"};
    if(failure==="missing seed")f.observations.pop();
    if(failure==="duplicate seed")f.observations.push({...f.observations[0]});
    if(failure==="draft")f.observations[0].stage="draft";
    if(failure==="no native receipt")delete f.references.r101.nativeReceipt;
    if(failure==="missing case")f.observations=[];
    if(failure==="wrong then recovered")f.observations[0].accepted.unshift({request:{...request,categories:["Rent"]},result});
    if(failure==="missing consent"){f.cases[0].required[0].requiresConsent=true;f.observations[0].consented=false;}
    const g=gradeCorpus(f); expect(g.financialTexts).toBe(0); expect(g.issues.length).toBeGreaterThan(0);
    if(["request","result","wrong then recovered"].includes(failure))expect(g.wrongAccepted.length).toBeGreaterThan(0);
  });
  it("an unnecessary choice remains a direct miss even when the final amount is correct", () => {
    const f=fixture();f.observations[0].meaningChoices=1;
    const g=gradeCorpus(f);expect(g.financialTexts).toBe(1);expect(g.core.direct).toBe(0);expect(g.core.total).toBe(1);
  });
  it("a numeric refusal can pass its own expectation but never becomes a completed estimate", () => {
    const f=fixture();f.cases[0].population="P-NR";f.cases[0].required=f.cases[0].required.map(r=>({...r,requestId:null,referenceId:null,stop:"refusal"}));
    f.observations=f.observations.map(o=>({...o,stage:"refusal",request:undefined,result:undefined,accepted:[]}));
    const g=gradeCorpus(f);expect(g.financialTexts).toBe(0);expect(g.requiredStops.failed).toBe(0);
  });
  it("a required family with no eligible cases is NOT MEASURED, never silently 100 percent", () => {
    const f=fixture();
    expect(gradeCorpus(f).families.find(x=>x.family==="m2:unassigned")).toMatchObject({status:"NOT MEASURED",total:0});
  });
  it("a failure in one collision context cannot be rescued by another passing ID", () => {
    const f=fixture();const alias={...f.cases[0],id:"alias"};
    const extra=f.observations.map(o=>({...o,caseId:"alias",stage:"draft" as const}));
    expect(gradeCorpus({...f,cases:[...f.cases,alias],observations:[...f.observations,...extra]}).financialTexts).toBe(0);
  });
  it("distinguishes an observed safe coverage miss from a missing observation", () => {
    const f=fixture();f.observations[0]={...f.observations[0],stage:"refusal",accepted:[],request:undefined,result:undefined};
    const g=gradeCorpus(f);expect(g.core.direct).toBe(0);expect(g.wrongAccepted).toEqual([]);expect(g.integrityIssues).toEqual([]);
    f.observations.pop();expect(gradeCorpus(f).integrityIssues.length).toBeGreaterThan(0);
  });
  it("does not misreport an unlinked accepted amount as a proven wrong answer", () => {
    const f=fixture();delete f.references.r101;
    const g=gradeCorpus(f);expect(g.integrityIssues.length).toBeGreaterThan(0);expect(g.wrongAccepted).toEqual([]);expect(g.financialTexts).toBe(0);
  });
});

describe("M6 out-of-scope bank is reported, not graded (VP-04 P-OOS, CG-11)", () => {
  const oos = (id: string, family: string): CorpusCase => ({ id, text: `unsupported request ${id}`, population: "P-OOS", family, cluster: "oos", tags: [], required: [{ seed: 101, contextId: "c101", requestId: null, referenceId: null }] });
  const seen = (caseId: string, stage: Observation["stage"], meaningChoices = 0, accepted: Observation["accepted"] = []): Observation => ({ caseId, seed: 101, contextId: "c101", stage, meaningChoices, accepted, reviewed: false, consented: false });
  const input = (cases: CorpusCase[], observations: Observation[]) => ({ cases, requests: {}, references: {}, observations, requiredFamilies: [...REQUIRED_FAMILY_IDS], evidence: { kind: "unit-stand-in" as const } });
  it("reports unsupported, clarified, multi-clarified and unanswered counts by missing capability without failing any gate on them", () => {
    const cases = [oos("a", "oos:tax"), oos("b", "oos:tax"), oos("c", "oos:tax"), oos("d", "oos:weekly")];
    const g = gradeCorpus(input(cases, [seen("a", "refusal"), seen("b", "clarify", 2), seen("c", "error"), seen("d", "refusal")]));
    expect(g.outOfScope).toBe(4);
    expect(g.outOfScopeReport).toEqual([
      { capability: "oos:tax", total: 3, unsupported: 1, clarified: 1, multiClarification: 1, noAnswer: 1, answered: 0 },
      { capability: "oos:weekly", total: 1, unsupported: 1, clarified: 0, multiClarification: 0, noAnswer: 0, answered: 0 },
    ]);
    expect(g.issues).toEqual([]); expect(g.requiredStops.total).toBe(0);
  });
  it("an invented answer to an out-of-scope request is still a wrong acceptance, and a missing observation is still an integrity failure", () => {
    const g = gradeCorpus(input([oos("a", "oos:tax"), oos("b", "oos:tax")], [seen("a", "result", 0, [{ request: {}, result: { total: "1.00" } }])]));
    expect(g.wrongAccepted.length).toBe(1); expect(g.outOfScopeReport[0].answered).toBe(1); expect(g.integrityIssues.length).toBeGreaterThan(0);
  });
});
