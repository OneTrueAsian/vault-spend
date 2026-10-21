import { CHANGED_BODY } from "./changedState";
import type { AskVaultRequestV2 } from "./types";
import { describe, expect, it, vi } from "vitest";
import { validateAskVaultSnapshot } from "./contract";
import type { AskMonthCoverage, AskVaultSnapshotV2 } from "./contractV2";
import { calculateSpendingScenario, scenarioMoneyToCents } from "./spendingScenarioMath";
import { baselineFromSnapshot, baselineRequest, readScenarioBaseline, sameScenarioSource } from "./spendingScenarioBaseline";
import type { ScenarioSource } from "./spendingScenarioContract";
import { TransactionError } from "../transactionContracts";
import { readCutPreviewBaselines } from "./cutPreviewBaseline";

const ASOF = "2026-10-15";
const current = (over: Partial<ScenarioSource> = {}): ScenarioSource => ({ generation: 3, sessionRevision: 4, revision: { local: 5, external: 2 }, asOf: ASOF, ...over });

type Month = [string, AskMonthCoverage, string, number];
const JUL_SEP: [Month, Month, Month] = [
  ["2026-07", "complete", "300.00", 3],
  ["2026-08", "complete", "330.00", 3],
  ["2026-09", "complete", "270.00", 3],
];

/** A reply the production validator accepts for the request this module builds, written out by hand. */
function reply(months: Month[] = JUL_SEP, over: Record<string, unknown> = {}, source: ScenarioSource = current()): AskVaultSnapshotV2 {
  const lastDay: Record<string, string> = { "07": "31", "08": "31", "09": "30", "10": "31", "11": "30", "12": "31" };
  const total = months.reduce((sum, m) => sum + Number(m[2]), 0).toFixed(2);
  const complete = months.filter((m) => m[1] === "complete");
  const numerator = complete.reduce((sum, m) => sum + Number(m[2]), 0).toFixed(2);
  return {
    contractVersion: 2,
    context: { generation: source.generation, sessionRevision: source.sessionRevision },
    revision: source.revision,
    asOf: source.asOf,
    earliestRecord: "2026-01-02",
    kind: "total",
    spendingBasis: "gross-negative-allocations",
    thresholdBasis: "absolute-parent-amount",
    difference: null,
    comparison: null,
    periods: [
      {
        from: "2026-07-01",
        to: "2026-09-30",
        dayCount: 92,
        endsToday: false,
        historyCoverage: "unknown",
        total,
        purchaseCount: months.reduce((sum, m) => sum + m[3], 0),
        categoryCount: 1,
        categories: [],
        purchases: [],
        vendors: [],
        vendorNameCount: 0,
        vendorTotals: [],
        leftOut: { total: "0.00", purchaseCount: 0, vendors: [], categories: [] },
        categoryTotals: [],
        sharedPurchaseCount: 0,
        memberTotals: [],
        recordedFrom: "2026-01-02",
        recordedThrough: "2026-10-10",
        months: months.map(([month, coverage, amount, count]) => ({
          month,
          from: `${month}-01`,
          to: `${month}-${lastDay[month.slice(5)]}`,
          dayCount: Number(lastDay[month.slice(5)]),
          coverage,
          recordCount: count,
          total: amount,
          purchaseCount: count,
        })),
        // The rounded average is deliberately wrong-looking for a scenario: the calculator must never read it.
        average: {
          basis: "per-month",
          numerator,
          denominator: complete.length,
          value: complete.length ? (Number(numerator) / complete.length).toFixed(2) : null,
          unavailable: complete.length ? null : "no-complete-months",
          monthsUsed: complete.map((m) => m[0]),
          monthsLeftOut: months.filter((m) => m[1] !== "complete").map((m) => ({ month: m[0], why: m[1] })),
        },
        ...over,
      },
    ],
  } as unknown as AskVaultSnapshotV2;
}

describe("the baseline request", () => {
  it("asks for the three whole months before this month, one category, the whole household, grouped by month", () => {
    expect(baselineRequest("Dining", ASOF, null)).toEqual({
      contractVersion: 2,
      kind: "total",
      periods: [{ from: "2026-07-01", to: "2026-09-30" }],
      accountIds: [],
      categories: ["Dining"],
      members: { ids: [], unassigned: false },
      minimumPurchase: null,
      vendors: [],
      excludeVendors: [],
      excludeCategories: [],
      limit: 1,
      groupBy: "month",
      average: "per-month",
      alignment: "as-requested",
      expectedRevision: null,
    });
  });

  it("never includes the current month, even on its first or last day", () => {
    expect(baselineRequest("Dining", "2026-10-01", null).periods[0]).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(baselineRequest("Dining", "2026-10-31", null).periods[0]).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("reaches back across a year end and across a leap February", () => {
    expect(baselineRequest("Dining", "2027-01-10", null).periods[0]).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(baselineRequest("Dining", "2028-05-02", null).periods[0]).toEqual({ from: "2028-02-01", to: "2028-04-30" });
    expect(baselineRequest("Dining", "2028-03-01", null).periods[0]).toEqual({ from: "2027-12-01", to: "2028-02-29" });
  });

  it("carries the data revision it was started on, so a changed ledger fails the read", () => {
    expect(baselineRequest("Dining", ASOF, { local: 5, external: 2 }).expectedRevision).toEqual({ local: 5, external: 2 });
  });

  it("is accepted by the production reply validator together with a matching reply", () => {
    const request = baselineRequest("Dining", ASOF, current().revision);
    expect(() => validateAskVaultSnapshot(reply(), request)).not.toThrow();
  });
});

describe("turning a reply into a baseline", () => {
  const request = baselineRequest("Dining", ASOF, null);

  it("keeps all three months with their coverage, plus the source that was read", () => {
    const baseline = baselineFromSnapshot(reply([JUL_SEP[0], ["2026-08", "no-records", "0.00", 0], JUL_SEP[2]]), request);
    expect(baseline).toEqual({
      kind: "recorded",
      months: [
        { month: "2026-07", total: "300.00", coverage: "complete" },
        { month: "2026-08", total: "0.00", coverage: "no-records" },
        { month: "2026-09", total: "270.00", coverage: "complete" },
      ],
      source: current(),
    });
  });

  it("feeds the calculator exact month totals and never the rounded average", () => {
    // 100.00 + 100.00 + 101.00 over three months is exactly 301/3; the reply's rounded average says 100.33.
    const baseline = baselineFromSnapshot(reply([["2026-07", "complete", "100.00", 3], ["2026-08", "complete", "100.00", 3], ["2026-09", "complete", "101.00", 3]]), request);
    const result = calculateSpendingScenario({
      intent: { version: 1, category: "Dining", reduction: { kind: "money", amount: "100.34" }, cadence: "monthly", horizon: { kind: "prospective", from: "2026-11-01", to: "2026-11-30" }, partialMonth: "exclude" },
      baseline,
      confirmed: true,
    });
    expect(result).toEqual({ kind: "reduction-too-large", monthlyBaseline: { numerator: "301", denominator: "3" } });
  });

  it("produces a baseline the calculator accepts end to end", () => {
    const baseline = baselineFromSnapshot(reply(), request);
    const result = calculateSpendingScenario({
      intent: { version: 1, category: "Dining", reduction: { kind: "money", amount: "50" }, cadence: "monthly", horizon: { kind: "prospective", from: "2026-11-01", to: "2026-12-31" }, partialMonth: "exclude" },
      baseline,
      confirmed: true,
    });
    expect(result.kind).toBe("preview");
    if (result.kind === "preview") expect(scenarioMoneyToCents(result.totalSaving)).toBe("100.00");
  });

  it("takes the source from the reply, not from the request", () => {
    const source = current({ generation: 9, sessionRevision: 8, revision: { local: 7, external: 6 } });
    expect(baselineFromSnapshot(reply(JUL_SEP, {}, source), request).source).toEqual(source);
  });

  const refused = (value: unknown) => expect(() => baselineFromSnapshot(value as AskVaultSnapshotV2, request)).toThrow();

  it("refuses a reply that is not the version 2 total for the three months asked", () => {
    refused({ ...reply(), contractVersion: 1 });
    refused({ ...reply(), kind: "rank-categories" });
    refused({ ...reply(), periods: [...reply().periods, ...reply().periods] });
    refused({ ...reply(), asOf: "2026-11-02" }); // another month: the three months asked are no longer the three before it
    refused(reply(JUL_SEP, { from: "2026-06-01" }));
    refused(reply(JUL_SEP, { to: "2026-10-31" }));
    refused(reply([JUL_SEP[0], JUL_SEP[1]]));
    refused(reply([["2026-06", "complete", "1.00", 1], JUL_SEP[0], JUL_SEP[1]]));
    refused(reply(JUL_SEP, { months: [] }));
    refused(null);
  });
});

describe("reading the baseline", () => {
  const client = (impl: () => Promise<AskVaultSnapshotV2>) => ({ askVault: vi.fn(impl) });

  it("reads once with the live revision and returns the baseline", async () => {
    const fake = client(async () => reply());
    const result = await readScenarioBaseline({ category: "Dining", client: fake, currentSource: () => current() });
    expect(fake.askVault).toHaveBeenCalledTimes(1);
    expect(fake.askVault).toHaveBeenCalledWith(expect.objectContaining({ categories: ["Dining"], expectedRevision: { local: 5, external: 2 } }));
    expect(result).toMatchObject({ status: "baseline", baseline: { kind: "recorded", source: current() } });
  });

  it("reads nothing when there is no live source", async () => {
    const fake = client(async () => reply());
    expect(await readScenarioBaseline({ category: "Dining", client: fake, currentSource: () => null })).toEqual({ status: "stale" });
    expect(fake.askVault).not.toHaveBeenCalled();
  });

  it("drops the result when the session, data or date moved while it was being read", async () => {
    for (const moved of [current({ generation: 4 }), current({ sessionRevision: 5 }), current({ revision: { local: 6, external: 2 } }), current({ revision: { local: 5, external: 3 } }), current({ asOf: "2026-10-16" })]) {
      let live = current();
      const fake = client(async () => {
        live = moved;
        return reply();
      });
      expect(await readScenarioBaseline({ category: "Dining", client: fake, currentSource: () => live })).toEqual({ status: "stale" });
    }
  });

  it("takes the source by value: a provider that updates its own object in place is still caught", async () => {
    const live = current();
    const fake = client(async () => {
      live.revision.local += 1; // the app moves on, mutating the same object it handed over
      return reply(JUL_SEP, {}, { ...current(), revision: { ...live.revision } });
    });
    expect(await readScenarioBaseline({ category: "Dining", client: fake, currentSource: () => live })).toEqual({ status: "stale" });
    expect(fake.askVault).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: { local: 5, external: 2 } }));
  });

  it("drops the result when the app is locked while reading", async () => {
    let live: ScenarioSource | null = current();
    const fake = client(async () => {
      live = null;
      return reply();
    });
    expect(await readScenarioBaseline({ category: "Dining", client: fake, currentSource: () => live })).toEqual({ status: "stale" });
  });

  it("drops a reply that belongs to a different source than the one the app is on", async () => {
    const fake = client(async () => reply(JUL_SEP, {}, current({ revision: { local: 4, external: 2 } })));
    expect(await readScenarioBaseline({ category: "Dining", client: fake, currentSource: () => current() })).toEqual({ status: "stale" });
  });

  it("drops the result when it was cancelled, whether before or during the read", async () => {
    const early = new AbortController();
    early.abort();
    const fake = client(async () => reply());
    expect(await readScenarioBaseline({ category: "Dining", client: fake, currentSource: () => current(), signal: early.signal })).toEqual({ status: "stale" });
    expect(fake.askVault).not.toHaveBeenCalled();
    const late = new AbortController();
    const slow = client(async () => {
      late.abort();
      return reply();
    });
    expect(await readScenarioBaseline({ category: "Dining", client: slow, currentSource: () => current(), signal: late.signal })).toEqual({ status: "stale" });
  });

  it("says plainly that the transactions changed, and what to do when the profile moved", async () => {
    const changed = client(async () => {
      throw new TransactionError("stale_data", "internal wording");
    });
    expect(await readScenarioBaseline({ category: "Dining", client: changed, currentSource: () => current() })).toEqual({
      status: "stale",
      message: CHANGED_BODY,
    });
    const moved = client(async () => {
      throw new TransactionError("stale_profile", "internal wording");
    });
    expect(await readScenarioBaseline({ category: "Dining", client: moved, currentSource: () => current() })).toEqual({ status: "stale", message: CHANGED_BODY });
  });

  it("turns any other failure into a plain message without internal wording", async () => {
    const broken = client(async () => {
      throw new Error("sqlite: disk I/O error at 0xdeadbeef");
    });
    const result = await readScenarioBaseline({ category: "Dining", client: broken, currentSource: () => current() });
    expect(result).toEqual({ status: "error", message: "I couldn't answer that right now. Try again in a moment." });
  });

  it("reports a reply that is the wrong shape as a plain error and never builds a baseline from it", async () => {
    const wrong = client(async () => ({ ...reply(), contractVersion: 1 }) as unknown as AskVaultSnapshotV2);
    const result = await readScenarioBaseline({ category: "Dining", client: wrong, currentSource: () => current() });
    expect(result.status).toBe("error");
  });
});

describe("comparing sources", () => {
  it("matches only when generation, session, both revisions and the date are all the same", () => {
    expect(sameScenarioSource(current(), current())).toBe(true);
    expect(sameScenarioSource(current(), current({ generation: 4 }))).toBe(false);
    expect(sameScenarioSource(current(), current({ sessionRevision: 5 }))).toBe(false);
    expect(sameScenarioSource(current(), current({ revision: { local: 6, external: 2 } }))).toBe(false);
    expect(sameScenarioSource(current(), current({ revision: { local: 5, external: 3 } }))).toBe(false);
    expect(sameScenarioSource(current(), current({ asOf: "2026-10-16" }))).toBe(false);
    expect(sameScenarioSource(current(), null)).toBe(false);
  });
});

describe("M4 baseline bundle workstream", () => {
  it("returns category-labelled exact month evidence without accepting short history", async () => {
    const askVault = vi.fn(async () => reply([JUL_SEP[0], ["2026-08", "no-records", "0.00", 0], JUL_SEP[2]]));
    const result = await readCutPreviewBaselines({ categories: ["Dining", "Travel"], client: { askVault }, currentSource: () => current() });
    expect(result.status).toBe("baseline");
    if (result.status !== "baseline") throw new Error("Expected the complete source-consistent bundle.");
    expect(result.baselines.map(row => row.category)).toEqual(["Dining", "Travel"]);
    for (const row of result.baselines) {
      expect(row.baseline).toMatchObject({ kind: "recorded", months: [{ total: "300.00" }, { coverage: "no-records", total: "0.00" }, { total: "270.00" }] });
      expect(row.baseline).not.toHaveProperty("shortHistoryAccepted");
    }
  });
  it("discards earlier categories when the source changes during a later read", async () => {
    let live = current();
    const askVault = vi.fn(async () => { if (askVault.mock.calls.length === 2) live = current({ generation: 99 }); return reply(); });
    expect(await readCutPreviewBaselines({ categories: ["Dining", "Travel"], client: { askVault }, currentSource: () => live })).toEqual({ status: "stale" });
  });
  it("does not return partial evidence on an IPC failure", async () => {
    const askVault = vi.fn(async () => { if (askVault.mock.calls.length === 2) throw new Error("private sqlite path"); return reply(); });
    expect(await readCutPreviewBaselines({ categories: ["Dining", "Travel"], client: { askVault }, currentSource: () => current() })).toEqual({ status: "error", message: "I couldn't answer that right now. Try again in a moment." });
  });
});


describe("Portable M4 full regression - baseline reader", () => {
const source=():ScenarioSource=>({generation:3,sessionRevision:4,revision:{local:5,external:2},asOf:'2026-10-16'});
function reply(request:AskVaultRequestV2,s=source(),coverage=['complete','complete','complete'],amounts=['100.00','200.00','300.00']){
 const cents=(v:string)=>BigInt(v.replace('.',''));const format=(v:bigint)=>v/100n+'.'+String(v%100n).padStart(2,'0');
 const allMissing=coverage.every(x=>x==='no-records'),monthNames=['2026-07','2026-08','2026-09'],days=[31,31,30];
 const months=monthNames.map((month,i)=>({month,from:month+'-01',to:month+'-'+days[i],dayCount:days[i],coverage:coverage[i],recordCount:coverage[i]==='no-records'?0:2,purchaseCount:amounts[i]==='0.00'?0:1,total:amounts[i]}));
 const used=months.filter(m=>m.coverage==='complete'),num=used.reduce((s,m)=>s+cents(m.total),0n),den=BigInt(used.length),avg=den?(num/den+(num%den*2n>=den?1n:0n)):null;
 const value={contractVersion:2,context:{generation:s.generation,sessionRevision:s.sessionRevision},revision:{...s.revision},asOf:s.asOf,earliestRecord:allMissing?null:'2026-01-01',kind:'total',spendingBasis:'gross-negative-allocations',thresholdBasis:'absolute-parent-amount',difference:null,comparison:null,periods:[{...request.periods[0],dayCount:92,endsToday:false,historyCoverage:'unknown',total:format(months.reduce((s,m)=>s+cents(m.total),0n)),purchaseCount:months.reduce((s,m)=>s+m.purchaseCount,0),categoryCount:amounts.every(x=>x==='0.00')?0:1,categories:[],purchases:[],vendors:[],vendorNameCount:0,vendorTotals:[],leftOut:{total:'0.00',purchaseCount:0,vendors:[],categories:[]},categoryTotals:[],sharedPurchaseCount:0,memberTotals:[],recordedFrom:allMissing?null:'2026-01-01',recordedThrough:allMissing?null:'2026-10-16',months,average:{basis:'per-month',numerator:format(num),denominator:used.length,value:avg===null?null:format(avg),unavailable:den?null:'no-complete-months',monthsUsed:used.map(x=>x.month),monthsLeftOut:months.filter(m=>m.coverage!=='complete').map(m=>({month:m.month,why:m.coverage}))}}]};
 return validateAskVaultSnapshot(value,request);
}

const args=(askVault:any=vi.fn(async(r:any)=>reply(r)))=>({categories:['Dining','Travel'],client:{askVault},currentSource:()=>source()});
describe('M4 source-consistent native baseline bundle',()=>{
 it('reads exactly neutral v2 baseline requests with one shared revision',async()=>{const a=args(),r=await readCutPreviewBaselines(a);expect(r.status).toBe('baseline');expect(a.client.askVault).toHaveBeenCalledTimes(2);for(const [i,category]of ['Dining','Travel'].entries())expect(a.client.askVault.mock.calls[i][0]).toEqual({contractVersion:2,kind:'total',periods:[{from:'2026-07-01',to:'2026-09-30'}],accountIds:[],categories:[category],members:{ids:[],unassigned:false},minimumPurchase:null,vendors:[],excludeVendors:[],excludeCategories:[],limit:1,groupBy:'month',average:'per-month',alignment:'as-requested',expectedRevision:{local:5,external:2}});});
 it('keeps labels, all exact rows and source in request order',async()=>{const r=await readCutPreviewBaselines(args());expect(r).toEqual({status:'baseline',source:source(),baselines:['Dining','Travel'].map(category=>({category,baseline:{kind:'recorded',source:source(),months:[{month:'2026-07',total:'100.00',coverage:'complete'},{month:'2026-08',total:'200.00',coverage:'complete'},{month:'2026-09',total:'300.00',coverage:'complete'}]}}))});});
 it('preserves missing and short history as evidence, without acceptance or fake zero',async()=>{const r=await readCutPreviewBaselines(args(vi.fn(async(request:any)=>request.categories[0]==='Dining'?reply(request,source(),['no-records','no-records','no-records'],['0.00','0.00','0.00']):reply(request,source(),['complete','no-records','complete'],['120.00','0.00','180.00']))));expect(r.status).toBe('baseline');if(r.status!=='baseline')throw Error('bundle');expect(r.baselines[0].baseline.kind).toBe('recorded');for(const row of r.baselines)expect(row.baseline).not.toHaveProperty('shortHistoryAccepted');expect(r.baselines[1].baseline).toMatchObject({months:[{total:'120.00'},{coverage:'no-records'},{total:'180.00'}]});});
 it.each([[],['Dining','Dining'],[''],Array.from({length:21},(_,i)=>'C'+i)].map(categories=>({categories})))('rejects invalid category selection before IPC: $categories',async ({categories})=>{const a={...args(),categories};expect((await readCutPreviewBaselines(a)).status).toBe('error');expect(a.client.askVault).not.toHaveBeenCalled();});
 it('accepts20 categories without truncation',async()=>{const a={...args(),categories:Array.from({length:20},(_,i)=>'C'+i)};const r=await readCutPreviewBaselines(a);expect(r.status).toBe('baseline');expect(a.client.askVault).toHaveBeenCalledTimes(20);});
 it('takes a copy of categories before the first await',async()=>{const a=args(vi.fn(async(r:any)=>{a.categories[1]='Rent';return reply(r);}));const result=await readCutPreviewBaselines(a);expect(result.status).toBe('baseline');if(result.status==='baseline')expect(result.baselines.map(x=>x.category)).toEqual(['Dining','Travel']);});
 it('does not read while locked',async()=>{const a={...args(),currentSource:()=>null};expect(await readCutPreviewBaselines(a)).toEqual({status:'stale'});expect(a.client.askVault).not.toHaveBeenCalled();});
 it('does not read when already cancelled',async()=>{const controller=new AbortController();controller.abort();const a={...args(),signal:controller.signal};expect(await readCutPreviewBaselines(a)).toEqual({status:'stale'});expect(a.client.askVault).not.toHaveBeenCalled();});
 it.each(['generation','sessionRevision','local','external','asOf','locked'])('drops the whole bundle if %s moves during a later read',async field=>{let live:any=source();const a={...args(vi.fn(async(r:any)=>{const result=reply(r);if(r.categories[0]==='Travel'){if(field==='locked')live=null;else if(field==='asOf')live.asOf='2026-10-17';else if(field==='local'||field==='external')live.revision[field]++;else live[field]++;}return result;})),currentSource:()=>live};expect((await readCutPreviewBaselines(a)).status).toBe('stale');});
 it('stops further reads when the first source moves',async()=>{let live=source();const a={...args(vi.fn(async(r:any)=>{const result=reply(r);live={...live,generation:9};return result;})),currentSource:()=>live};expect((await readCutPreviewBaselines(a)).status).toBe('stale');expect(a.client.askVault).toHaveBeenCalledTimes(1);});
 it('rejects an individually valid reply from another revision',async()=>{const a=args(vi.fn(async(r:any)=>reply(r,{...source(),revision:{local:6,external:2}})));expect((await readCutPreviewBaselines(a)).status).toBe('stale');expect(a.client.askVault).toHaveBeenCalledTimes(1);});
 it('never turns an IPC failure into missing history or a partial bundle',async()=>{const a=args(vi.fn(async(r:any)=>{if(r.categories[0]==='Travel')throw new Error('private sqlite path');return reply(r);}));const r=await readCutPreviewBaselines(a);expect(r).toEqual({status:'error',message:"I couldn't answer that right now. Try again in a moment."});expect(r).not.toHaveProperty('baselines');});
 it('reports a stale-data error without returning partial rows',async()=>{const a=args(vi.fn(async()=>{throw new TransactionError('stale_data','internal');}));expect(await readCutPreviewBaselines(a)).toEqual({status:'stale',message:CHANGED_BODY});});
 it('does not accept a malformed snapshot',async()=>{const a=args(vi.fn(async()=>({contractVersion:1})));expect((await readCutPreviewBaselines(a)).status).toBe('error');});
 it('settles cancellation promptly even when a native reply remains pending',async()=>{let resolve:any;const pending=new Promise(r=>{resolve=r;}),ask=vi.fn(()=>pending);const controller=new AbortController();const p=readCutPreviewBaselines({...args(ask),signal:controller.signal});controller.abort();expect(await Promise.race([p,new Promise(r=>setTimeout(()=>r('timed-out'),100))])).toEqual({status:'stale'});resolve({});await new Promise(r=>setTimeout(r,0));expect(ask).toHaveBeenCalledTimes(1);});
 it('returns copied evidence, not mutable reply/source references',async()=>{let raw:any;const live=source();const a={...args(vi.fn(async(r:any)=>{raw=reply(r);return raw;})),currentSource:()=>live};const r=await readCutPreviewBaselines(a);expect(r.status).toBe('baseline');raw.periods[0].months[0].total='999.00';live.revision.local++;if(r.status==='baseline'){expect(r.source.revision.local).toBe(5);expect(r.baselines[1].baseline).toMatchObject({months:[{total:'100.00'},{},{ }]});}});
});

describe('M4 baseline contract edge audit',()=>{
 it('returns a stale result when a failed read also invalidated the source',async()=>{let live:any=source();const a={...args(vi.fn(async()=>{live=null;throw new Error('private');})),currentSource:()=>live};expect(await readCutPreviewBaselines(a)).toEqual({status:'stale'});});
 it.each(['not-a-date','2101-01-01'])('rejects invalid live date before IPC: %s',asOf=>{const a={...args(),currentSource:()=>({...source(),asOf})};return readCutPreviewBaselines(a).then(r=>{expect(r.status).toBe('error');expect(a.client.askVault).not.toHaveBeenCalled();});});
 it('stops at the first failed read without calling subsequent categories',async()=>{const a=args(vi.fn(async()=>{throw new Error('private');}));expect((await readCutPreviewBaselines(a)).status).toBe('error');expect(a.client.askVault).toHaveBeenCalledTimes(1);});
 it('rejects a source with an invalid revision',async()=>{const a={...args(),currentSource:()=>({...source(),revision:{local:-1,external:2}})};expect((await readCutPreviewBaselines(a)).status).toBe('error');expect(a.client.askVault).not.toHaveBeenCalled();});
});

});


describe('M4 native batch reader behavior',()=>{
 function packet(categories=['Dining','Travel']){return {contractVersion:1 as const,context:{generation:3,sessionRevision:4},revision:{local:5,external:2},asOf:ASOF,baselines:categories.map(category=>({category,snapshot:reply()}))};}
 it('BP2 20categories use one batch call, preserve labels/source and never call legacy path',async()=>{const names=Array.from({length:20},(_,i)=>'C'+i),client={askVault:vi.fn(async()=>reply()),askVaultBaselines:vi.fn(async()=>packet(names))};const got=await readCutPreviewBaselines({categories:names,client,currentSource:current});expect(got.status).toBe('baseline');expect(client.askVaultBaselines).toHaveBeenCalledOnce();expect(client.askVault).not.toHaveBeenCalled();expect(client.askVaultBaselines).toHaveBeenCalledWith({contractVersion:1,categories:names,expectedRevision:{local:5,external:2}});if(got.status==='baseline')expect(got.baselines.map(row=>row.category)).toEqual(names);});
 it('BP4 batch rejection never falls back to20legacy reads',async()=>{const client={askVault:vi.fn(async()=>reply()),askVaultBaselines:vi.fn(async()=>{throw new TransactionError('internal_error','private database');})};const got=await readCutPreviewBaselines({categories:['Dining','Travel'],client,currentSource:current});expect(got.status).toBe('error');expect(JSON.stringify(got)).not.toContain('private database');expect(client.askVault).not.toHaveBeenCalled();});
 it.each(['generation','session','local','external','day','closed'])('BP4 source change during batch drops entire answer: %s',async what=>{let live:ScenarioSource|null=current();const client={askVault:vi.fn(async()=>reply()),askVaultBaselines:vi.fn(async()=>{if(what==='closed')live=null;else if(what==='generation')live!.generation++;else if(what==='session')live!.sessionRevision++;else if(what==='day')live!.asOf='2026-10-16';else if(what==='local')live!.revision.local++;else live!.revision.external++;return packet();})};expect(await readCutPreviewBaselines({categories:['Dining','Travel'],client,currentSource:()=>live})).toEqual({status:'stale'});expect(client.askVault).not.toHaveBeenCalled();});
 it('BP4 abort releases a hung batch and observes its late rejection',async()=>{let reject!:(e:unknown)=>void;const client={askVault:vi.fn(async()=>reply()),askVaultBaselines:vi.fn(()=>new Promise<never>((_,r)=>reject=r))},controller=new AbortController();const pending=readCutPreviewBaselines({categories:['Dining','Travel'],client,currentSource:current,signal:controller.signal});controller.abort();expect(await pending).toEqual({status:'stale'});expect(reject).toBeDefined();reject(new Error('late secret'));await new Promise(r=>setTimeout(r,0));expect(client.askVault).not.toHaveBeenCalled();});
});

describe('M4 batch cancellation interacting with failure',()=>{
 it('BP4 a real batch failure with an un-aborted signal stays error, never stale',async()=>{const client={askVault:vi.fn(async()=>reply()),askVaultBaselines:vi.fn(async()=>{throw new TransactionError('internal_error','private database detail');})};const result=await readCutPreviewBaselines({categories:['Dining'],client,currentSource:current,signal:new AbortController().signal});expect(result.status).toBe('error');expect(JSON.stringify(result)).not.toContain('private database detail');});
});
