import { describe, expect, it } from "vitest";
import { answer, request } from "../testSupport/askVaultM6/referenceOracle";
import type { World } from "../testSupport/askVaultM6/referenceWorld";
import { readFileSync } from "node:fs";

// Independent hand anchors for the copied M2 oracle and the M1 leave-out extension.
// Sources: M2/oracle/oracle.ts:33-63; M1/acceptance/native.ts:28-65; M2 Financial-Rules.
const world: World = { name:"hand",today:"2026-10-20",categories:["Dining","Groceries"],accounts:[{id:1,name:"Checking",memberId:null}],members:[{id:1,name:"Alex"}],ledger:[
  {id:1,accountId:1,date:"2026-09-01",description:"Store One",cents:-3000,category:null,memberId:1,splits:[{category:"Dining",cents:-1000},{category:"Groceries",cents:-2000}]},
  {id:2,accountId:1,date:"2026-09-02",description:"Store Two",cents:-500,category:"Dining",memberId:null},
  {id:3,accountId:1,date:"2026-09-03",description:"Refund",cents:400,category:"Dining",memberId:1},
] };
const base={kind:"total" as const,periods:[{from:"2026-09-01",to:"2026-09-30"}]};
describe("M6 independent reference anchors",()=>{
  it("retains negative split allocations, counts parents once, and excludes refunds",()=>{
    expect(answer(world,request(base)).periods[0]).toMatchObject({total:"35.00",purchaseCount:2,categoryCount:2});
    expect(answer(world,request({...base,categories:["Dining"]})).periods[0]).toMatchObject({total:"15.00",purchaseCount:2});
  });
  it("thresholds use the full parent before category filtering, with strict versus inclusive preserved",()=>{
    expect(answer(world,request({...base,categories:["Dining"],minimumPurchase:{amount:"30.00",inclusive:false}})).periods[0].total).toBe("0.00");
    expect(answer(world,request({...base,categories:["Dining"],minimumPurchase:{amount:"30.00",inclusive:true}})).periods[0].total).toBe("10.00");
  });
  it("overlapping store/category exclusions never double the removed amount or parent count",()=>{
    const p=answer(world,request({...base,excludeVendors:["store one"],excludeCategories:["Dining"]})).periods[0];
    expect(p.total).toBe("0.00");expect(p.leftOut).toEqual({total:"35.00",purchaseCount:2,vendors:[{description:"Store One",purchaseCount:1}],categories:[{category:"Dining",amount:"15.00",purchaseCount:2}]});
  });
  it("category-only removal of a split leaves the other allocation and distinct parent intact",()=>{
    expect(answer(world,request({...base,excludeCategories:["Dining"]})).periods[0]).toMatchObject({total:"20.00",purchaseCount:1,leftOut:{total:"15.00",purchaseCount:2}});
  });
  it("the separately prepared scenario references include the hand-worked monthly/once/zero-month anchors",()=>{
    const refs=JSON.parse(readFileSync("src/testSupport/askVaultM6/referenceResults.json","utf8"));
    expect(refs["anchor.m3.monthly"].value).toMatchObject({totalSaving:{numerator:"100",denominator:"1"}});
    expect(refs["anchor.m4.penny"].value).toMatchObject({allocatedCents:"1",allocations:[{category:"Dining",allocatedCents:"1"},{category:"Groceries",allocatedCents:"0"}]});
    expect(refs["anchor.m5.one-month-monthly"].value).toMatchObject({months:1,extraDeposits:"50.00",confirmedReturn:{display:{baseline:{roundedDollars:1100},scenario:{roundedDollars:1200},difference:{roundedDollars:50}}}});
    expect(refs["anchor.m5.zero-month-once"].value).toMatchObject({months:0,extraDeposits:"50.00",confirmedReturn:{display:{baseline:{roundedDollars:1000},scenario:{roundedDollars:1100},difference:{roundedDollars:50}}}});
  });
});
