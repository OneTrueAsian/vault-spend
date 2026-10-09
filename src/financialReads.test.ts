import { expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createFinancialClient } from "./financialReads";
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn()}));
const context={contractVersion:1,generation:3,sessionRevision:7};
const response=()=>({contractVersion:1,context,revision:{local:1,external:1},year:2026,month:10,actuals:[],alerts:[],members:[],flow:{months:[{year:2026,month:10,month_label:"Oct",income:"0",expense:"0"}],top_categories:[],top_merchants:[],total_income:"0",total_expense:"0"}});
beforeEach(()=>{vi.resetAllMocks();vi.mocked(invoke).mockImplementation(async c=>c==="get_transaction_context"?context:response());});
it("sends captured generation/session metadata and validates returned totals",async()=>{
 const client=createFinancialClient();expect((await client.budget(2026,10)).month).toBe(10);
 expect(invoke).toHaveBeenCalledWith("get_budget_snapshot",{year:2026,month:10,expectedGeneration:3,expectedSessionRevision:7});
});
it("refuses a different period or profile even when the payload is otherwise valid",async()=>{
 for(const changed of [{...response(),context:{...context,sessionRevision:8}},{...response(),year:2025,flow:{...response().flow,months:[{...response().flow.months[0],year:2025}]}}]){
  vi.mocked(invoke).mockImplementation(async c=>c==="get_transaction_context"?context:changed);
  await expect(createFinancialClient().budget(2026,10)).rejects.toMatchObject({code:changed.context.sessionRevision===8?"stale_profile":"invalid_response"});
 }
});
it("keeps structured refusal identity and does not retry failed reads automatically",async()=>{
 vi.mocked(invoke).mockImplementation(async c=>{if(c==="get_transaction_context")return context;throw {code:"profile_locked",message:"Wording independent"};});
 await expect(createFinancialClient().budget(2026,10)).rejects.toMatchObject({code:"profile_locked",message:"Wording independent"});
 expect(vi.mocked(invoke).mock.calls.filter(([c])=>c==="get_budget_snapshot")).toHaveLength(1);
});
it("disposing during context lookup prevents a command dispatch",async()=>{
 let resolve!:(v:unknown)=>void;vi.mocked(invoke).mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const client=createFinancialClient(),request=client.budget(2026,10);client.dispose();resolve(context);
 await expect(request).rejects.toMatchObject({code:"stale_profile"});expect(invoke).toHaveBeenCalledTimes(1);
});
it("disposing after dispatch refuses a late completed reply",async()=>{
 let resolve!:(v:unknown)=>void;vi.mocked(invoke).mockImplementation(async c=>c==="get_transaction_context"?context:new Promise(r=>{resolve=r;}));
 const client=createFinancialClient(),request=client.budget(2026,10);
 await vi.waitFor(()=>expect(resolve).toBeDefined());client.dispose();resolve(response());
 await expect(request).rejects.toMatchObject({code:"stale_profile"});
});
