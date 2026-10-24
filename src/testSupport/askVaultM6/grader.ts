import { canonical, countKey, validateManifest } from "./counting";
import type { GradingInput, Observation, Reference } from "./manifest";
import { UNIT_STAND_IN_RECEIPT, verifyNativeEvidence, type EvidenceProblem } from "./nativeEvidence";
import { REQUIRED_FAMILIES, REQUIRED_FAMILY_IDS, requiredFamilyProblems } from "./registry";
import { readFileSync } from "node:fs";

const ROUTING_CASES: { id: string; family: string; expectedRoute: string }[] = JSON.parse(readFileSync(`${__dirname}/routingCases.json`, "utf8"));
// VP-05/06: preserve the original authored ambiguity golds. Some specify a
// required subset (mustOffer), while others require clarification without fixing
// copy. Never derive those constraints from the parser's observed candidates.
const CLARIFICATION_GOLDS: { cases: Record<string, { text: string; family: string; expected: { status: string; mustOffer?: string[] } }> } = JSON.parse(readFileSync(`${__dirname}/clarificationGolds.json`, "utf8"));

/** A stop stage that carries a result, or a result stage with nothing accepted or no request/result, cannot be believed either way: reject it as evidence. */
const contradiction = (o: Observation) =>
  o.stage === "result" ? o.accepted.length === 0 || o.request === undefined || o.result === undefined : o.result !== undefined;

/** VP-05/06: every required context must pass; a later recovery never erases a wrong accepted answer. */
export function gradeCorpus(input: GradingInput) {
  return gradeValidatedCorpus(input);
}

type ValidatedEvidence = { admissible: Set<string>; problems: EvidenceProblem[]; originalCaseIds: Map<string, string> };

/** Verify original package-local proof identities before building a namespaced scoring view.
 * This is not an admissible-ID escape hatch: callers supply ordinary corpus evidence,
 * never a trusted flag or prevalidated set. No signed case, proof or identity is rewritten. */
export function gradeCombinedCorpus(packages: readonly { id: string; input: GradingInput }[]) {
  const ids = new Set<string>();
  const combined: GradingInput = { cases: [], requests: {}, references: {}, observations: [], requiredFamilies: [...REQUIRED_FAMILY_IDS],
    routingObservations: [], amendments: { alternates: [] }, resolutionObservations: [], reviewedRealisticErrors: [], evidence: { kind: "corpus", proofs: {}, manifest: { proofs: {}, identities: {} }, contexts: { worlds: {}, contexts: {} } } };
  const verified: ValidatedEvidence = { admissible: new Set(), problems: [], originalCaseIds: new Map() };
  const namespaces: { package: string; cases: number; observations: number }[] = [];
  for (const { id, input } of packages) {
    if (!id || ids.has(id)) throw Error(`Duplicate or empty package ID: ${id}`);
    ids.add(id);
    if (input.evidence.kind !== "corpus") throw Error(`Package ${id} must carry real corpus evidence`);
    validateManifest(input.cases);
    const registry = requiredFamilyProblems(input.requiredFamilies);
    if (registry.length) throw Error(`Package ${id}: ${registry.join("; ")}`);
    const ns = (key: string) => JSON.stringify([id, key]);
    const alternateIds = (input.amendments?.alternates ?? []).flatMap(a => a.perSeed.map(s => s.referenceId));
    const referenced = new Set([...input.cases.flatMap(c => c.required.map(r => r.referenceId)), ...alternateIds].filter((x): x is string => x !== null && input.references[x] !== undefined));
    const proof = verifyNativeEvidence({ ...input.evidence, references: Object.fromEntries([...referenced].map(key => [key, input.references[key]])), requests: input.requests });
    for (const key of proof.verified) verified.admissible.add(ns(key));
    verified.problems.push(...proof.problems.map(p => ({ ...p, referenceId: ns(p.referenceId) })));
    for (const c of input.cases) {
      verified.originalCaseIds.set(ns(c.id), c.id);
      combined.cases.push({ ...c, id: ns(c.id), required: c.required.map(r => ({ ...r, contextId: ns(r.contextId), requestId: r.requestId === null ? null : ns(r.requestId), referenceId: r.referenceId === null ? null : ns(r.referenceId) })) });
    }
    for (const [key, request] of Object.entries(input.requests)) combined.requests[ns(key)] = request;
    for (const [key, ref] of Object.entries(input.references)) combined.references[ns(key)] = { ...ref, contextId: ns(ref.contextId), requestId: ns(ref.requestId) } as Reference;
    combined.observations.push(...input.observations.map(o => ({ ...o, caseId: ns(o.caseId), contextId: ns(o.contextId) })));
    combined.routingObservations!.push(...(input.routingObservations ?? []));
    combined.reviewedRealisticErrors!.push(...(input.reviewedRealisticErrors ?? []).map(e => ({ ...e, id: ns(e.id) })));
    // Amendments are namespaced exactly like the cases they name, so a package can never amend another package's case.
    const fr = input.amendments?.familyResolution;
    if (fr) {
      if (combined.amendments!.familyResolution) throw Error("More than one family-resolution amendment");
      combined.amendments!.familyResolution = { ...fr, approvedChoices: Object.fromEntries(Object.entries(fr.approvedChoices).map(([id, label]) => [ns(id), label])) };
    }
    for (const a of input.amendments?.alternates ?? []) combined.amendments!.alternates!.push({ caseId: ns(a.caseId), perSeed: a.perSeed.map(s => ({ ...s, contextId: ns(s.contextId), requestId: ns(s.requestId), referenceId: ns(s.referenceId) })) });
    combined.resolutionObservations!.push(...(input.resolutionObservations ?? []).map(o => ({ ...o, caseId: ns(o.caseId), contextId: ns(o.contextId) })));
    namespaces.push({ package: id, cases: input.cases.length, observations: input.observations.length });
  }
  return { ...gradeValidatedCorpus(combined, verified), namespaces };
}

/** Private only: the combined entry point obtains this evidence by checking each original proof above. */
function gradeValidatedCorpus(input: GradingInput, validated?: ValidatedEvidence) {
  validateManifest(input.cases);
  const {cases,requests,references,observations}=input;
  const issues: string[]=[],wrongAccepted: string[]=[],integrityIssues: string[]=[];
  const integrity=(message:string)=>{issues.push(message);integrityIssues.push(message);};
  const verdicts=new Map<string,{financial:boolean;direct:boolean;withinOne:boolean;stop:boolean}>();
  const caseIds=new Set(cases.map(c=>c.id));
  // F1 (VP-07): results follow the authority-backed registry, never the caller's list or the cases present.
  const registryProblems=requiredFamilyProblems(input.requiredFamilies??[]);
  for(const p of registryProblems)integrity(p);
  const registryBound=registryProblems.length===0;
  for(const c of cases)if(c.population==="P-CORE"&&!REQUIRED_FAMILY_IDS.includes(c.family))integrity(`${c.id}: unregistered family ${c.family}`);
  // F2 (VP-06/08): only receipts that verify against the real proof earn financial credit. An omitted evidence block earns nothing.
  const evidence=input.evidence??{kind:"corpus" as const,proofs:{},manifest:{proofs:{},identities:{}},contexts:{worlds:{},contexts:{}}};
  const referenced=new Set([...cases.flatMap(c=>c.required.map(r=>r.referenceId)),...(input.amendments?.alternates??[]).flatMap(a=>a.perSeed.map(s=>s.referenceId))].filter((x):x is string=>x!==null&&references[x]!==undefined));
  const evidenceProblems:EvidenceProblem[]=[...(validated?.problems ?? [])],admissible=new Set<string>(validated?.admissible);
  if(validated) { /* Original package proof identities were verified before namespacing. */ }
  else if(evidence.kind==="corpus") {
    const v=verifyNativeEvidence({references:Object.fromEntries([...referenced].map(id=>[id,references[id]])),requests,contexts:evidence.contexts,proofs:evidence.proofs,manifest:evidence.manifest});
    evidenceProblems.push(...v.problems);v.verified.forEach(id=>admissible.add(id));
  } else for(const id of referenced) {
    if(references[id].nativeReceipt===UNIT_STAND_IN_RECEIPT)admissible.add(id);
    else evidenceProblems.push({referenceId:id,code:"not-unit-stand-in",detail:"a unit-stand-in grading accepts only the stand-in marker"});
  }
  for(const o of observations)if(!caseIds.has(o.caseId))integrity(`Unexpected observed case: ${o.caseId}`);
  for(const c of cases) {
    let financial=true,direct=true,withinOne=true,stop=true;
    const clarificationGold=CLARIFICATION_GOLDS.cases[validated?.originalCaseIds.get(c.id) ?? c.id];
    if(clarificationGold&&(clarificationGold.text!==c.text||clarificationGold.family!==c.family||c.population!=="P-NC"))integrity(`${c.id}: original clarification gold identity differs`);
    for(const r of c.required) {
      const label=`${c.id}/${r.contextId}/${r.seed}`;
      const found=observations.filter(o=>o.caseId===c.id&&o.contextId===r.contextId&&o.seed===r.seed);
      if(found.length!==1){integrity(`${label}: expected one observation, got ${found.length}`);financial=direct=withinOne=stop=false;}
      for(const o of found) {
        if(contradiction(o)){integrity(`${label}: contradictory observation (stage ${o.stage})`);financial=direct=withinOne=stop=false;}
        if(r.requestId===null&&c.population==="P-OOS") {
          // Reported only (CG-11): the missing-capability tally is below. An invented answer is still a wrong acceptance.
          if(o.accepted.length||o.stage==="result"){wrongAccepted.push(label);issues.push(`${label}: answered an out-of-scope request`);}
          continue;
        }
        if(r.requestId===null) {
          const expected=r.stop==="clarification"?"clarify":r.stop==="history-choice"?"history-choice":"refusal";
          const mustOffer=clarificationGold?.expected.mustOffer??[];
          const valid=o.stage===expected&&o.accepted.length===0&&(r.choices===undefined||canonical(o.offeredChoices??[])===canonical(r.choices))
            &&mustOffer.every(label=>(o.offeredChoices??[]).includes(label));
          if(!valid){issues.push(`${label}: required ${expected} not proved`);stop=false;}
          // An unexpected result stage is a wrong acceptance even when accepted[] is empty (CG-06/09), exactly as for P-OOS and financial cases.
          if(o.accepted.length||o.stage==="result"){wrongAccepted.push(label);issues.push(`${label}: accepted a stop-only case`);stop=false;}
          financial=direct=withinOne=false;continue;
        }
        const want=requests[r.requestId],ref=r.referenceId?references[r.referenceId]:undefined;
        const same=(a:unknown,b:unknown)=>a!==undefined&&b!==undefined&&canonical(a)===canonical(b);
        const linked=want!==undefined&&ref!==undefined&&ref.requestId===r.requestId&&ref.seed===r.seed&&ref.contextId===r.contextId&&admissible.has(r.referenceId!);
        if(!linked){integrity(`${label}: missing exact reference/native receipt linkage`);financial=direct=withinOne=false;}
        // Missing evidence is INCOMPLETE, not proof that the observed amount was wrong.
        // D-R3: an explicitly amended alternate request, with its own linked reference on this seed, is accepted beside the original gold. Nothing else is.
        const alt=(input.amendments?.alternates??[]).find(a=>a.caseId===c.id)?.perSeed.find(s=>s.seed===r.seed&&s.contextId===r.contextId);
        const altWant=alt?requests[alt.requestId]:undefined,altRef=alt?references[alt.referenceId]:undefined;
        const altLinked=alt!==undefined&&altWant!==undefined&&altRef!==undefined&&altRef.requestId===alt.requestId&&altRef.seed===r.seed&&altRef.contextId===r.contextId&&admissible.has(alt.referenceId);
        const mismatch=(w:unknown,rf:Reference|undefined)=>(w!==undefined&&rf!==undefined)&&(o.accepted.some(a=>!same(a.request,w)||!same(a.result,rf.value))
          ||(o.stage==="result"&&o.request!==undefined&&o.result!==undefined&&(!same(o.request,w)||!same(o.result,rf.value))));
        const altOk=altLinked&&!mismatch(altWant,altRef);
        const wrong=mismatch(want,ref)&&!altOk;
        if(wrong){wrongAccepted.push(label);issues.push(`${label}: wrong accepted request/result`);}
        const consent=!r.requiresConsent||(o.reviewed&&o.consented);
        if(!consent&&o.stage==="result")integrity(`${label}: accepted without required live review/consent`);
        const shown=consent&&o.stage==="result"&&o.accepted.length>0;
        const correct=(linked&&!mismatch(want,ref)&&shown&&same(o.request,want)&&same(o.result,ref?.value))||(altOk&&shown&&same(o.request,altWant)&&same(o.result,altRef?.value));
        if(!correct){issues.push(`${label}: no verified completed result`);financial=direct=withinOne=false;}
        if(!Number.isSafeInteger(o.meaningChoices)||o.meaningChoices<0){integrity(`${label}: invalid clarification count`);financial=direct=withinOne=false;}
        direct&&=correct&&o.meaningChoices===0;withinOne&&=correct&&o.meaningChoices<=1;
      }
    }
    if(observations.some(o=>o.caseId===c.id&&!c.required.some(r=>r.contextId===o.contextId&&r.seed===o.seed))) {
      integrity(`${c.id}: unexpected seed/context`);financial=direct=withinOne=stop=false;
    }
    verdicts.set(c.id,{financial,direct,withinOne,stop});
  }
  // D-R2: the family-resolution measure. It reads only the amended cases of ONE family and writes nothing the direct metric, the family rows or the strict gates read.
  const amend=input.amendments?.familyResolution,resolutionObs=input.resolutionObservations??[];
  const approvedOf=(id:string)=>amend?.approvedChoices[id];
  const resolvedCases=new Set<string>();
  for(const x of resolutionObs)if(!caseIds.has(x.caseId)||approvedOf(x.caseId)===undefined)integrity(`${x.caseId}/${x.contextId}/${x.seed}: resolution observation outside the amendment`);
  if(amend)for(const c of cases){
    const approved=approvedOf(c.id);if(approved===undefined)continue;
    const same=(a:unknown,b:unknown)=>a!==undefined&&b!==undefined&&canonical(a)===canonical(b);
    if(c.family!==amend.family||c.population!=="P-CORE")integrity(`${c.id}: the amendment names a case outside ${amend.family} P-CORE`);
    let ok=c.family===amend.family&&c.population==="P-CORE";
    for(const r of c.required){
      const label=`${c.id}/${r.contextId}/${r.seed}`;
      const first=observations.filter(o=>o.caseId===c.id&&o.contextId===r.contextId&&o.seed===r.seed),res=resolutionObs.filter(o=>o.caseId===c.id&&o.contextId===r.contextId&&o.seed===r.seed);
      if(res.length>1)integrity(`${label}: expected one resolution observation, got ${res.length}`);
      if(first.length!==1||res.length!==1){ok=false;continue;}
      const o=first[0],x=res[0];
      const want=r.requestId!==null?requests[r.requestId]:undefined,ref=r.referenceId?references[r.referenceId]:undefined;
      const linked=want!==undefined&&ref!==undefined&&ref.requestId===r.requestId&&ref.seed===r.seed&&ref.contextId===r.contextId&&admissible.has(r.referenceId!);
      // An answer accepted or read before the person chose is a wrong acceptance in its own right: a store typo is never answered without a choice.
      if(o.accepted.length>0||x.readsBeforeChoice>0){wrongAccepted.push(label);issues.push(`${label}: answered before the person chose`);}
      const wrongAfter=want!==undefined&&ref!==undefined&&(x.accepted.some(a=>!same(a.request,want)||!same(a.result,ref.value))||(x.stage==="result"&&x.request!==undefined&&x.result!==undefined&&(!same(x.request,want)||!same(x.result,ref.value))));
      if(wrongAfter){wrongAccepted.push(label);issues.push(`${label}: wrong accepted resolution request/result`);}
      const offered=(o.offeredChoices??[]).some(l=>l.toLowerCase()===approved.toLowerCase());
      const good=o.stage==="clarify"&&o.accepted.length===0&&offered&&!contradiction(o)&&!contradiction(x)&&x.stage==="result"&&x.meaningChoices===1&&x.chosen.toLowerCase()===approved.toLowerCase()
        &&x.readsBeforeChoice===0&&x.accepted.length===1&&linked&&same(x.request,want)&&same(x.result,ref?.value)&&same(x.accepted[0].request,want)&&same(x.accepted[0].result,ref?.value)&&(!r.requiresConsent||(x.reviewed&&x.consented));
      if(!good)ok=false;
    }
    if(ok)resolvedCases.add(c.id);
  }
  // Collision IDs are obligations, never additional attempts or text credits.
  const groups=new Map<string,typeof cases>();
  for(const c of cases){const k=countKey(c.text);groups.set(k,[...(groups.get(k)??[]),c]);}
  const successful=(xs:typeof cases,field:"financial"|"direct"|"withinOne"|"stop")=>xs.every(c=>verdicts.get(c.id)![field]);
  const keys=[...groups.values()];
  // One normalized text is one obligation PER POPULATION: the M5 corpus repeats a sentence across rosters (m5c-019/-034/-061/-069/-070), each with its own outcome. Within a
  // population every colliding case must succeed; a case in another population is judged by that population's own rule.
  const slice=(keep:(c:typeof cases[number])=>boolean)=>keys.map(xs=>xs.filter(keep)).filter(xs=>xs.length>0);
  const population=(p:string)=>slice(c=>c.population===p);
  const score=(p:string)=>{const xs=population(p);return {total:xs.length,direct:xs.filter(x=>successful(x,"direct")).length,withinOne:xs.filter(x=>successful(x,"withinOne")).length};};
  const eligible=new Set(["P-CORE","P-LT","P-NC"]);
  const financialTexts=slice(c=>eligible.has(c.population)&&c.required.some(r=>r.requestId!==null)).filter(xs=>successful(xs,"financial")).length;
  // Q2: every registered label is reported, each against the outcomes its frozen plan gives it (completion, clarification, refusal, numeric boundary, routing).
  // A label is NOT MEASURED while any outcome it requires has no case; it passes only when its direct-answer share (completion) and all its stop checks pass.
  const STOP_POPULATIONS=["P-NC","P-ID","P-UNSAFE","P-NR"];
  const families=REQUIRED_FAMILIES.map(({id:family,outcomes})=>{
    const completion=outcomes.includes("completion"),stopOutcomes=outcomes.filter(o=>o!=="completion"&&o!=="routing");
    const xs=slice(c=>c.family===family&&c.population==="P-CORE");
    const direct=xs.filter(group=>successful(group,"direct")).length,total=xs.length;
    const stopGroups=slice(c=>c.family===family&&STOP_POPULATIONS.includes(c.population)&&c.required.every(r=>r.requestId===null));
    const stops={total:stopGroups.length,failed:stopGroups.filter(group=>!successful(group,"stop")).length};
    const outcomePresent=(outcome:string)=>stopGroups.some(group=>group.some(c=>outcome==="numeric-boundary"?c.population==="P-NR":outcome==="refusal"?c.population==="P-UNSAFE"&&c.required.every(r=>r.stop==="refusal"):c.population==="P-NC"&&c.required.every(r=>r.stop==="clarification")));
    const requiredRoutes=ROUTING_CASES.filter(c=>c.family===family);
    const routing=requiredRoutes.map(c=>{const seen=(input.routingObservations??[]).filter(o=>o.caseId===c.id);return {id:c.id,measured:seen.length>0,pass:seen.length===1&&seen[0].actualRoute===c.expectedRoute&&seen[0].retirementReads===0};});
    const measured=(!completion||total>0)&&stopOutcomes.every(outcomePresent)&&(!outcomes.includes("routing")||(routing.length>0&&routing.every(r=>r.measured)));
    const passing=(!completion||direct*100>=90*total)&&stops.failed===0&&routing.every(r=>r.pass);
    return {family,outcomes,total,direct,stops,routing,status:!measured?"NOT MEASURED":passing?"PASS":"FAIL"};
  });
  const stops=slice(c=>STOP_POPULATIONS.includes(c.population)&&c.required.every(r=>r.requestId===null));
  const core=score("P-CORE"),longTail=score("P-LT");
  // Raw tags are reported, never gated (Task 7, D-8, CG-04): the floor counts only individually reviewed membership, each entry checked against the frozen case.
  const typoTexts=population("P-CORE").filter(xs=>xs.some(c=>c.tags.some(t=>["typo","noise","realistic-error"].includes(t)))).length;
  const caseById=new Map(cases.map(c=>[c.id,c])),reviewedIds=new Set<string>(),reviewedKeys=new Set<string>();
  for(const e of input.reviewedRealisticErrors??[]) {
    const bad=(why:string)=>integrity(`reviewed realistic error ${e.id}: ${why}`);
    const c=caseById.get(e.id);
    if(reviewedIds.has(e.id)){bad("duplicate id");continue;}
    reviewedIds.add(e.id);
    if(!c){bad("unknown id, not a case in this corpus");continue;}
    if(c.population!=="P-CORE"){bad("not a P-CORE case");continue;}
    if(!c.tags.includes("typo")&&!c.tags.includes("noise")){bad("case is not tagged typo or noise");continue;}
    if(!c.tags.includes("typo")&&!(typeof e.justification==="string"&&e.justification.trim())){bad("noise-only case needs a written justification");continue;}
    if(e.text!==c.text){bad("text differs from the frozen case");continue;}
    if(!["typo","word-order","contraction"].includes(e.class)){bad("unknown error class");continue;}
    if(typeof e.rationale!=="string"||e.rationale.trim().length<20){bad("missing rationale");continue;}
    reviewedKeys.add(countKey(c.text));
  }
  const realisticErrorTexts=reviewedKeys.size;
  const outOfScope=population("P-OOS").length;
  const oosTally=new Map<string,{capability:string;total:number;unsupported:number;clarified:number;multiClarification:number;noAnswer:number;answered:number}>();
  for(const c of cases.filter(x=>x.population==="P-OOS"))for(const o of observations.filter(x=>x.caseId===c.id)){
    const t=oosTally.get(c.family)??{capability:c.family,total:0,unsupported:0,clarified:0,multiClarification:0,noAnswer:0,answered:0};
    t.total++;if(o.stage==="refusal")t.unsupported++;if(o.stage==="clarify")t.clarified++;if(o.meaningChoices>1)t.multiClarification++;
    if(o.stage==="error"||o.stage==="draft")t.noAnswer++;if(o.stage==="result"||o.accepted.length>0)t.answered++;
    oosTally.set(c.family,t);
  }
  const outOfScopeReport=[...oosTally.values()].sort((a,b)=>a.capability<b.capability?-1:1);
  const requiredStops={total:stops.length,failed:stops.filter(xs=>!successful(xs,"stop")).length};
  const gates={coreFloor:core.total>=650,coreDirect:core.total>0&&100*core.direct>=95*core.total,
    families:registryBound&&families.every(f=>f.status==="PASS"),admissibleEvidence:evidence.kind==="corpus"&&evidenceProblems.length===0,typoFloor:realisticErrorTexts>=100,financialFloor:financialTexts>=600,zeroWrong:wrongAccepted.length===0,
    longTailFloor:longTail.total>=100,longTailDirect:longTail.total>0&&100*longTail.direct>=80*longTail.total,
    longTailOne:longTail.total>0&&100*longTail.withinOne>=90*longTail.total,outOfScopeFloor:outOfScope>=100,requiredStops:requiredStops.failed===0};
  const familyResolution=amend?(()=>{
    const xs=slice(c=>c.family===amend.family&&c.population==="P-CORE"),row=families.find(f=>f.family===amend.family);
    const direct=xs.filter(g=>successful(g,"direct")).length,resolved=xs.filter(g=>g.every(c=>verdicts.get(c.id)!.direct||resolvedCases.has(c.id))).length;
    const original=(id:string)=>validated?.originalCaseIds.get(id)??id;
    return {family:amend.family,thresholdPercent:amend.thresholdPercent,direct:{total:xs.length,direct},resolution:{total:xs.length,resolved,resolvedByChoice:[...resolvedCases].map(original).sort()},
      pass:xs.length>0&&resolved*100>=amend.thresholdPercent*xs.length&&(!row||(row.stops.failed===0&&row.routing.every(r=>r.pass)))};
  })():null;
  const gatesUnderAmendment={...gates,families:registryBound&&families.every(f=>amend&&familyResolution&&f.family===amend.family?familyResolution.pass:f.status==="PASS")};
  const evidenceClass=evidence.kind==="unit-stand-in"?"unit-stand-in" as const:evidenceProblems.length===0?"native-verified" as const:"native-unverified" as const;
  return {evidenceClass,evidenceProblems,registryBound,core,longTail,financialTexts,typoTexts,realisticErrorTexts,outOfScope,outOfScopeReport,families,requiredStops,wrongAccepted:[...new Set(wrongAccepted)],issues,integrityIssues,gates,
    passed:Object.values(gates).every(Boolean)&&integrityIssues.length===0,
    /** D-R2: reported beside, never instead of, the strict result above. Null when no amendment is supplied. */
    familyResolution,gatesUnderAmendment,passedUnderAmendment:Object.values(gatesUnderAmendment).every(Boolean)&&integrityIssues.length===0};
}
