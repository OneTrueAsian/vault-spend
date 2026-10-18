import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { createFinancialClient } from "../financialReads";
import type { AskVaultRequest, AskVaultRequestV2 } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const context = { contractVersion: 1, generation: 3, sessionRevision: 7 };
const request: AskVaultRequest = {
  kind: "total",
  periods: [{ from: "2026-08-01", to: "2026-08-31" }],
  accountIds: [],
  categories: ["Groceries"],
  minimumPurchase: null,
  vendors: [],
  excludeVendors: [],
  excludeCategories: [],
  limit: 1,
  expectedRevision: null,
};
const reply = (over: Record<string, unknown> = {}) => ({
  contractVersion: 1,
  context,
  revision: { local: 5, external: 2 },
  asOf: "2026-09-06",
  kind: "total",
  spendingBasis: "gross-negative-allocations",
  thresholdBasis: "absolute-parent-amount",
  periods: [
    { from: "2026-08-01", to: "2026-08-31", dayCount: 31, endsToday: false, historyCoverage: "unknown", total: "317.13", purchaseCount: 3, categoryCount: 1, categories: [], purchases: [], vendors: [], vendorNameCount: 0, vendorTotals: [], leftOut: { total: "0", purchaseCount: 0, vendors: [], categories: [] } },
  ],
  difference: null,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 6, 12, 0, 0));
  vi.mocked(invoke).mockImplementation(async (c) => (c === "get_transaction_context" ? context : reply()));
});
afterEach(() => vi.useRealTimers());

const memberRequest: AskVaultRequestV2 = { ...request, contractVersion: 2, members: { ids: [], unassigned: false }, groupBy: "member", average: "none", alignment: "as-requested" };
const roster = [{ id: 1, name: "Sam" }, { id: 2, name: "Robin" }];
const memberReply = () => ({
  ...reply(), contractVersion: 2, earliestRecord: "2026-08-01", comparison: null,
  periods: [{ ...reply().periods[0], categoryTotals: [], sharedPurchaseCount: 0, months: [], recordedFrom: null, recordedThrough: null, average: null,
    memberTotals: [{ memberId: 1, name: "Sam", total: "317.13", purchaseCount: 3 }, { memberId: 2, name: "Robin", total: "0.00", purchaseCount: 0 }, { memberId: null, name: null, total: "0.00", purchaseCount: 0 }],
  }],
});

describe("M2 client and independent member roster", () => {
  it("sends the complete M2 request and retains the validated M2 reply", async () => {
    vi.mocked(invoke).mockImplementation(async c => c === "get_transaction_context" ? context : memberReply());
    const result = await createFinancialClient().askVault(memberRequest, { familyMembers: roster });
    expect(result.contractVersion).toBe(2);
    if (result.contractVersion === 2) expect(result.periods[0].memberTotals).toHaveLength(3);
    expect(invoke).toHaveBeenCalledWith("get_ask_vault_snapshot", { request: memberRequest, expectedGeneration: 3, expectedSessionRevision: 7 });
  });
  it("rejects a dropped zero-spend person using the caller's roster", async () => {
    const bad = memberReply(); bad.periods[0].memberTotals.splice(1, 1);
    vi.mocked(invoke).mockImplementation(async c => c === "get_transaction_context" ? context : bad);
    await expect(createFinancialClient().askVault(memberRequest, { familyMembers: roster })).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("fails closed before dispatch when an everyone-by-member request has no roster", async () => {
    vi.mocked(invoke).mockImplementation(async c => c === "get_transaction_context" ? context : memberReply());
    await expect(createFinancialClient().askVault(memberRequest)).rejects.toMatchObject({ code: "invalid_response" });
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "get_ask_vault_snapshot")).toHaveLength(0);
  });
  it("captures the roster before dispatch rather than trusting a list mutated while awaiting the reply", async () => {
    const people = roster.map(p => ({ ...p }));
    let complete!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementation(async c => c === "get_transaction_context" ? context : new Promise(resolve => { complete = resolve; }));
    const pending = createFinancialClient().askVault(memberRequest, { familyMembers: people });
    const refused = expect(pending).rejects.toMatchObject({ code: "invalid_response" });
    await vi.waitFor(() => expect(complete).toBeDefined());
    people.splice(1, 1);
    const bad = memberReply(); bad.periods[0].memberTotals.splice(1, 1); complete(bad);
    await refused;
  });
});

describe("the Ask the Vault read", () => {
  it("sends only the typed request plus the captured profile origin, and returns the exact total", async () => {
    const result = await createFinancialClient().askVault(request);
    expect(result.periods[0].total).toBe("317.13");
    expect(invoke).toHaveBeenCalledWith("get_ask_vault_snapshot", { request, expectedGeneration: 3, expectedSessionRevision: 7 });
  });

  it("refuses a reply that belongs to another profile session", async () => {
    vi.mocked(invoke).mockImplementation(async (c) => (c === "get_transaction_context" ? context : reply({ context: { ...context, sessionRevision: 8 } })));
    await expect(createFinancialClient().askVault(request)).rejects.toMatchObject({ code: "stale_profile" });
  });

  it("refuses a reply computed for another day", async () => {
    vi.mocked(invoke).mockImplementation(async (c) => (c === "get_transaction_context" ? context : reply({ asOf: "2026-09-05" })));
    await expect(createFinancialClient().askVault(request)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("refuses a reply that does not echo the question", async () => {
    vi.mocked(invoke).mockImplementation(async (c) => (c === "get_transaction_context" ? context : reply({ kind: "compare" })));
    await expect(createFinancialClient().askVault(request)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("keeps a structured refusal and does not retry it", async () => {
    vi.mocked(invoke).mockImplementation(async (c) => {
      if (c === "get_transaction_context") return context;
      throw { code: "stale_data", message: "Your transactions changed. Ask again using the current data." };
    });
    await expect(createFinancialClient().askVault(request)).rejects.toMatchObject({ code: "stale_data" });
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "get_ask_vault_snapshot")).toHaveLength(1);
  });

  it("a disposed client never dispatches", async () => {
    const client = createFinancialClient();
    client.dispose();
    await expect(client.askVault(request)).rejects.toMatchObject({ code: "stale_profile" });
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "get_ask_vault_snapshot")).toHaveLength(0);
  });
});


describe('M4 batch baseline financial boundary',()=>{
 const request=()=>({contractVersion:1 as const,categories:['Dining','Travel'],expectedRevision:{local:5,external:2}});
 function batch(){const req=request();return {contractVersion:1,context:{generation:3,sessionRevision:7},revision:{local:5,external:2},asOf:'2026-09-06',baselines:req.categories.map(category=>({category,snapshot:{...reply(),context:{...context},contractVersion:2,earliestRecord:'2026-05-01',comparison:null,periods:[{...reply().periods[0],from:'2026-06-01',to:'2026-08-31',dayCount:92,total:'150.00',purchaseCount:2,categoryCount:1,categoryTotals:[],sharedPurchaseCount:0,memberTotals:[],recordedFrom:'2026-05-01',recordedThrough:'2026-09-06',average:{basis:'per-month',numerator:'150.00',denominator:3,value:'50.00',unavailable:null,monthsUsed:['2026-06','2026-07','2026-08'],monthsLeftOut:[]},months:[['2026-06',30,'100.00',1],['2026-07',31,'0',0],['2026-08',31,'50',1]].map(([month,days,total,count])=>({month,from:month+'-01',to:month+'-'+days,dayCount:days,coverage:'complete',recordCount:1,total,purchaseCount:count}))}]}}))};}
 it('BP1/BP2 makes one bounded batch IPC and retains every independent validated v2 snapshot',async()=>{vi.mocked(invoke).mockImplementation(async c=>c==='get_transaction_context'?context:batch());const r=await createFinancialClient().askVaultBaselines(request());expect(r.baselines.map(x=>x.category)).toEqual(['Dining','Travel']);expect(invoke).toHaveBeenCalledWith('get_ask_vault_baselines',{request:request(),expectedGeneration:3,expectedSessionRevision:7});expect(vi.mocked(invoke).mock.calls.filter(([c])=>c==='get_ask_vault_snapshot')).toHaveLength(0);});
 const malformed:[string,(r:any)=>void][]=[['empty',r=>r.categories=[]],['21',r=>r.categories=Array.from({length:21},(_,i)=>'C'+i)],['duplicates',r=>r.categories=['Dining','Dining']],['blank',r=>r.categories=[' ']],['nonstring',r=>r.categories=[1]],['oversized name',r=>r.categories=['x'.repeat(513)]],['version',r=>r.contractVersion=2],['date',r=>r.asOf='2026-01-01'],['SQL',r=>r.sql='SELECT 1'],['missing revision',r=>delete r.expectedRevision],['revision extra',r=>r.expectedRevision.extra=1],['negative revision',r=>r.expectedRevision.local=-1]];
 it.each(malformed)('BP1 rejects %s before dispatch',async(_,mutate)=>{const r=request();mutate(r);await expect(createFinancialClient().askVaultBaselines(r)).rejects.toMatchObject({code:'invalid_argument'});expect(invoke).not.toHaveBeenCalled();});
 const corrupt:[string,(r:any)=>void][]=[['missing category',r=>r.baselines.pop()],['duplicate category',r=>r.baselines[1]=r.baselines[0]],['wrong order',r=>r.baselines.reverse()],['unexpected row key',r=>r.baselines[0].manual=true],['changed snapshot session',r=>r.baselines[1].snapshot.context.sessionRevision++],['changed snapshot revision',r=>r.baselines[1].snapshot.revision.external++],['changed snapshot day',r=>r.baselines[1].snapshot.asOf='2026-09-05'],['wrong coverage',r=>r.baselines[1].snapshot.periods[0].months[1].coverage='no-records'],['wrong average',r=>r.baselines[0].snapshot.periods[0].average.value='99'],['extra reply field',r=>r.question='private'],['wrong period',r=>r.baselines[0].snapshot.periods[0].from='2026-05-01'],['stale common date',r=>r.asOf='2026-09-05'],['common source mismatch',r=>r.revision.local++]];
 it.each(corrupt)('BP2/BP3 rejects the whole bundle: %s',async(_,mutate)=>{const b=batch();mutate(b);vi.mocked(invoke).mockImplementation(async c=>c==='get_transaction_context'?context:b);await expect(createFinancialClient().askVaultBaselines(request())).rejects.toMatchObject({code:'invalid_response'});expect(vi.mocked(invoke).mock.calls.filter(([c])=>c==='get_ask_vault_baselines')).toHaveLength(1);});
 it('BP4 snapshots caller labels before IPC and returns a copy',async()=>{let resolve!:(v:unknown)=>void;vi.mocked(invoke).mockImplementation(async c=>c==='get_transaction_context'?context:new Promise(r=>resolve=r));const r=request(),pending=createFinancialClient().askVaultBaselines(r);void pending.catch(()=>{});await vi.waitFor(()=>expect(resolve).toBeDefined());r.categories.reverse();r.expectedRevision.local++;const raw=batch();resolve(raw);const got=await pending;raw.baselines[0].snapshot.periods[0].total='900';expect(got.baselines[0].category).toBe('Dining');expect(got.baselines[0].snapshot.periods[0].total).toBe('150.00');});
 it('BP4 disposed pending reads cannot return a bundle',async()=>{let resolve!:(v:unknown)=>void;vi.mocked(invoke).mockImplementation(async c=>c==='get_transaction_context'?context:new Promise(r=>resolve=r));const c=createFinancialClient(),pending=c.askVaultBaselines(request()),refused=expect(pending).rejects.toMatchObject({code:'stale_profile'});void refused.catch(()=>{});await vi.waitFor(()=>expect(resolve).toBeDefined());c.dispose();resolve(batch());await refused;});
 it('BP4 no retry or legacy fallback after structured native refusal',async()=>{vi.mocked(invoke).mockImplementation(async c=>{if(c==='get_transaction_context')return context;throw {code:'stale_data',message:'Data changed'};});await expect(createFinancialClient().askVaultBaselines(request())).rejects.toMatchObject({code:'stale_data'});expect(vi.mocked(invoke).mock.calls.filter(([c])=>c!=='get_transaction_context')).toHaveLength(1);});
});
