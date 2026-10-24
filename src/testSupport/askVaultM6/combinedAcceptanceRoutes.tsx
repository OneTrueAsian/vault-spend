import { readFileSync } from "node:fs";
import type { ParseContext } from "../../askVault/types";
// Install the transparent M4 dialog observer before any other harness imports AskVaultCard.
// Otherwise the already-cached card bypasses the observation wrapper while still rendering correctly.
import { observeM4 } from "./routeHarnessM4";
import { buildReplyIndex, observeCase, type RouteEnv } from "./routeHarness";
import { m3IndexKey, observeM3Case, type M3Env } from "./routeHarnessM3";
import { m3WorldId } from "./m3Scenario";
import { m4Rows } from "./m4Scenario";
import { observeM5Case } from "./routeHarnessM5";
import type { M5Fixture } from "./m5Scenario";
import { observeHistoryCase } from "./historyRoute";
import { observeRoutingCase } from "./routingRoute";
import type { AcceptancePackage } from "./combinedAcceptance";
import { preparedRoutingCases } from "./preparedPackages";

const json=(name:string)=>JSON.parse(readFileSync(`${__dirname}/${name}`,"utf8"));
/** Every public route uses the original text and frozen fixtures; original package identities stay intact until grading. */
export async function observeAcceptancePackage(p:AcceptancePackage):Promise<void> {
  if(p.input.observations.length)throw Error(`Package ${p.id} already observed; retain the old run separately`);
  const ordinary=json("contexts.json"),requests=json("scenarioNativeRequests.json");
  const refs=Object.values(json("scenarioNativeReferences.json").references) as {kind:string;worldId:string;requestId:string;value:unknown}[];
  const indexes=new Map<number,Map<string,unknown>>();
  for(const seed of [101,202,303])indexes.set(seed,new Map(refs.filter(r=>r.kind==="baseline"&&r.worldId===m3WorldId(seed)).map(r=>[m3IndexKey(requests[r.requestId]),r.value])));
  const env=(seed:number):M3Env=>({index:indexes.get(seed)!,parseContext:{...ordinary.contexts[`m1-origin-101-seed-${seed}`].parseContext,familyMembers:[]} as ParseContext});
  const routeEnv:RouteEnv={contexts:ordinary,requests:p.input.requests,references:p.input.references};
  const index=p.id==="ordinary"?buildReplyIndex(routeEnv):new Map<string,unknown>();
  const fixtures=(json("scenarioNativeFixtures.json").retirement as M5Fixture[]).filter(f=>f.id.startsWith("m6-m5-"));
  const rows=m4Rows();
  for(const c of p.input.cases)for(const r of c.required) {
    if(p.id==="ordinary") {
      const first=await observeCase(c,r,routeEnv,index);p.input.observations.push(first);
      // D-R2: only the approved store-typo clarifications of the amended family get the second, clicked observation; its result earns the separate resolution measure only.
      const approved=p.input.amendments?.familyResolution?.approvedChoices[c.id];
      if(approved!==undefined&&first.stage==="clarify") {
        const clicked=await observeCase(c,r,routeEnv,index,{choose:labels=>labels.find(l=>l.toLowerCase()===approved.toLowerCase())??null});
        (p.input.resolutionObservations??=[]).push({...clicked,chosen:clicked.chosen??"",readsBeforeChoice:clicked.readsBeforeChoice??-1});
      }
    }
    else if(p.id==="m3")p.input.observations.push(await observeM3Case(c,r,env));
    else if(p.id==="m4") {
      const row=rows.find(row=>row.id===c.id);if(!row||row.text!==c.text)throw Error(`M4 text membership mismatch ${c.id}`);
      const shown=await observeM4(row,r.seed),result=shown.displayProblems.length?{...shown.result,displayMismatch:shown.displayProblems}:shown.result;
      p.input.observations.push({caseId:c.id,seed:r.seed,contextId:r.contextId,stage:"result",meaningChoices:0,reviewed:true,consented:!shown.beforeConsent,request:shown.request,result,accepted:[{request:shown.request,result}]});
    } else if(p.id==="m5")p.input.observations.push(await observeM5Case(c,r,fixtures));
    else p.input.observations.push(await observeHistoryCase(c as Parameters<typeof observeHistoryCase>[0]));
  }
  if(p.id==="m5") {p.input.routingObservations=[];for(const c of preparedRoutingCases())p.input.routingObservations.push(await observeRoutingCase(c));}
}
