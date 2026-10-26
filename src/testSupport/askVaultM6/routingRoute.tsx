import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { AskVaultCard } from "../../AskVaultCard";
import { answerTransactionQuestion, type QaContext } from "../../transactionQa";
import { LEGACY_PROFILE } from "./exampleMap";
import type { RoutingObservation } from "./manifest";

export async function observeRoutingCase(c:{id:string;text:string}):Promise<RoutingObservation> {
  const container=document.createElement("div");document.body.appendChild(container);const root=createRoot(container);
  const client={askVault:vi.fn(async()=>{throw Error("Routing-only, no financial credit");}),askVaultBaselines:vi.fn(),dispose:vi.fn(),askVaultRetirementAccounts:vi.fn(),askVaultRetirementContext:vi.fn()};
  const legacy=vi.fn((q:string)=>answerTransactionQuestion(q,{...LEGACY_PROFILE,categories:[],today:new Date(...LEGACY_PROFILE.today)} as unknown as QaContext));
  try {
    act(()=>root.render(<AskVaultCard getContext={()=>({today:"2026-09-06",historyStart:"2025-01-01",categories:["Dining","Shopping","Retirement Gifts"],accounts:[{id:5,name:"Roth IRA"}],investmentAccounts:[{id:5,name:"Roth IRA"}],merchants:[],familyMembers:[]})} legacyAsk={legacy} dataKey="route" reloadKey="route" accountNames={new Map()} createClient={()=>client as never}/>));
    const box=container.querySelector<HTMLInputElement>("input")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(box,c.text);box.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
    await act(async()=>{await new Promise(r=>setTimeout(r,0));});
    const text=document.body.textContent??"";
    return {caseId:c.id,actualRoute:client.askVault.mock.calls.length?"ordinary":legacy.mock.calls.length?"legacy":text.includes("Where would you like to cut back?")?"m4":text.includes("Before I work this out")&&document.querySelector('[role="dialog"]')?"m3":container.querySelector(".ledger-qa-hint")?"ordinary-refusal":"unclaimed",retirementReads:client.askVaultRetirementAccounts.mock.calls.length+client.askVaultRetirementContext.mock.calls.length};
  } finally {act(()=>root.unmount());container.remove();document.body.innerHTML="";}
}
