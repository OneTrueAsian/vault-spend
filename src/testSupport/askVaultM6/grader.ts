import { canonical, countKey, validateManifest } from "./counting";
import type { GradingInput, Observation } from "./manifest";
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
  const referenced=new Set(cases.flatMap(c=>c.required.map(r=>r.referenceId)).filter((x):x is string=>x!==null&&references[x]!==undefined));
  const evidenceProblems:EvidenceProblem[]=[],admissible=new Set<string>();
  if(evidence.kind==="corpus") {
    const v=verifyNativeEvidence({references:Object.fromEntries([...referenced].map(id=>[id,references[id]])),requests,contexts:evidence.contexts,proofs:evidence.proofs,manifest:evidence.manifest});
    evidenceProblems.push(...v.problems);v.verified.forEach(id=>admissible.add(id));
  } else for(const id of referenced) {
    if(references[id].nativeReceipt===UNIT_STAND_IN_RECEIPT)admissible.add(id);
    else evidenceProblems.push({referenceId:id,code:"not-unit-stand-in",detail:"a unit-stand-in grading accepts only the stand-in marker"});
  }
  for(const o of observations)if(!caseIds.has(o.caseId))integrity(`Unexpected observed case: ${o.caseId}`);
  for(const c of cases) {
    let financial=true,direct=true,withinOne=true,stop=true;
    const clarificationGold=CLARIFICATION_GOLDS.cases[c.id];
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
        const wrong=(want!==undefined&&ref!==undefined)&&(o.accepted.some(a=>!same(a.request,want)||!same(a.result,ref.value))
          ||(o.stage==="result"&&o.request!==undefined&&o.result!==undefined&&(!same(o.request,want)||!same(o.result,ref.value))));
        if(wrong){wrongAccepted.push(label);issues.push(`${label}: wrong accepted request/result`);}
        const consent=!r.requiresConsent||(o.reviewed&&o.consented);
        if(!consent&&o.stage==="result")integrity(`${label}: accepted without required live review/consent`);
        const correct=linked&&!wrong&&consent&&o.stage==="result"&&o.accepted.length>0&&same(o.request,want)&&same(o.result,ref?.value);
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
  const typoTexts=population("P-CORE").filter(xs=>xs.some(c=>c.tags.some(t=>["typo","noise","realistic-error"].includes(t)))).length;
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
    families:registryBound&&families.every(f=>f.status==="PASS"),admissibleEvidence:evidence.kind==="corpus"&&evidenceProblems.length===0,typoFloor:typoTexts>=100,financialFloor:financialTexts>=600,zeroWrong:wrongAccepted.length===0,
    longTailFloor:longTail.total>=100,longTailDirect:longTail.total>0&&100*longTail.direct>=80*longTail.total,
    longTailOne:longTail.total>0&&100*longTail.withinOne>=90*longTail.total,outOfScopeFloor:outOfScope>=100,requiredStops:requiredStops.failed===0};
  const evidenceClass=evidence.kind==="unit-stand-in"?"unit-stand-in" as const:evidenceProblems.length===0?"native-verified" as const:"native-unverified" as const;
  return {evidenceClass,evidenceProblems,registryBound,core,longTail,financialTexts,typoTexts,outOfScope,outOfScopeReport,families,requiredStops,wrongAccepted:[...new Set(wrongAccepted)],issues,integrityIssues,gates,
    passed:Object.values(gates).every(Boolean)&&integrityIssues.length===0};
}
