import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { AskVaultCard } from "../../AskVaultCard";
import type { CorpusCase, Observation } from "./manifest";

/** Same synthetic protocol fixtures as insufficientHistoryCorpus.test.tsx.
 * Observe the actual required history decision; no financial credit or native input claim. */
export async function observeHistoryCase(c: CorpusCase & { flow: "m3"|"m4"; complete: number }): Promise<Observation> {
  const revision={local:1,external:1},today="2026-10-20";
  const months=["07","08","09"].map((m,i)=>({month:`2026-${m}`,from:`2026-${m}-01`,to:`2026-${m}-${m==="09"?30:31}`,dayCount:m==="09"?30:31,coverage:i<c.complete?"complete":"no-records",recordCount:i<c.complete?1:0,total:i<c.complete?"300.00":"0.00",purchaseCount:i<c.complete?1:0}));
  const baseline={contractVersion:2,context:{generation:1,sessionRevision:1},revision,asOf:today,kind:"total",spendingBasis:"gross-negative-allocations",thresholdBasis:"absolute-parent-amount",difference:null,comparison:null,earliestRecord:"2025-01-01",
    periods:[{from:"2026-07-01",to:"2026-09-30",dayCount:92,endsToday:false,historyCoverage:"unknown",total:`${c.complete*300}.00`,purchaseCount:c.complete,categoryCount:c.complete?1:0,categories:[],purchases:[],vendors:[],vendorNameCount:0,vendorTotals:[],leftOut:{total:"0.00",purchaseCount:0,vendors:[],categories:[]},categoryTotals:[],memberTotals:[],sharedPurchaseCount:0,recordedFrom:"2025-01-01",recordedThrough:today,
      average:{basis:"per-month",numerator:`${c.complete*300}.00`,denominator:c.complete,value:c.complete?"300.00":null,unavailable:c.complete?null:"no-complete-months",monthsUsed:months.filter(m=>m.coverage==="complete").map(m=>m.month),monthsLeftOut:months.filter(m=>m.coverage!=="complete").map(m=>({month:m.month,why:m.coverage}))},months}]};
  const client={askVault:vi.fn(async(q:{contractVersion?:number;periods:{from:string;to:string}[]})=>q.contractVersion?baseline:{...baseline,contractVersion:1,periods:[{...baseline.periods[0],...q.periods[0]}]}),
    askVaultBaselines:vi.fn(async()=>({contractVersion:1,context:baseline.context,revision,asOf:today,baselines:[{category:"Groceries",snapshot:baseline}]})),dispose:vi.fn(),askVaultRetirementAccounts:vi.fn(),askVaultRetirementContext:vi.fn()};
  const container=document.createElement("div");document.body.appendChild(container);const root=createRoot(container);
  const base={caseId:c.id,seed:c.required[0].seed,contextId:c.required[0].contextId,accepted:[],meaningChoices:0,reviewed:false,consented:false} as const;
  const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,0));});
  try {
    act(()=>root.render(<AskVaultCard getContext={()=>({today,categories:["Groceries"],accounts:[],merchants:[],familyMembers:[]})} legacyAsk={()=>({matched:false,answer:"No answer"})} dataKey="history" reloadKey="history" accountNames={new Map()} createClient={()=>client as never}/>));
    const box=container.querySelector<HTMLInputElement>("input")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(box,c.text);box.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));await settle();
    if(c.flow==="m4") {const b=[...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="Review the details");if(!b||b.disabled)return {...base,accepted:[],stage:"error"};await act(async()=>b.click());await settle();}
    const text=document.body.textContent??"",dialog=document.querySelector('[role="dialog"]');
    const short=!![...(dialog?.querySelectorAll("label")??[])].find(l=>/^Use (the )?\d+ (recorded )?months?/.test(l.textContent??""));
    const manual=!!dialog?.querySelector('input[aria-label="Groceries usual month"],input[aria-label="Your usual month"],label.scenario-manual input');
    const noResult=!/What you would save|Your savings target preview/.test(text);
    return {...base,accepted:[],stage:noResult&&(c.complete?short:manual)?"history-choice":"error",reviewed:!!dialog};
  } finally {act(()=>root.unmount());container.remove();document.body.innerHTML="";}
}
