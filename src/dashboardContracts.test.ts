import { expect, it } from "vitest";
import { validateDashboardSnapshot, validateReportSummarySnapshot } from "./financialContracts";
const fixture=()=>({contractVersion:1,context:{contractVersion:1,generation:3,sessionRevision:7},revision:{local:1,external:1},asOf:"2026-10-08",report:{total_saved:"9007199254740992.01",income_total:"0",month_label:"October 2026",budget_actuals:[]},netWorth:["2026-05-31","2026-06-30","2026-07-31","2026-08-31","2026-09-30","2026-10-08"].map(as_of=>({as_of,month_label:"fixture",value:"12.34",cash:"12.34",debt:"0",investments:"0"})),spending:[],alerts:[],insights:[],averageSpend:"0",contributions:[]});
it("preserves exact Dashboard money and accepts explicit empty financial arrays",()=>{
  expect(validateDashboardSnapshot(fixture()).report.total_saved).toBe("9007199254740992.01");
  const {netWorth,spending,alerts,insights,averageSpend,contributions,...summary}=fixture();
  void netWorth;void spending;void alerts;void insights;void averageSpend;void contributions;
  expect(validateReportSummarySnapshot({...summary,accounts:[],averageSpend}).accounts).toEqual([]);
});
it("rejects missing nested totals, unsafe revisions, unknown insight tags and incomplete histories",()=>{
  for(const change of [(x:ReturnType<typeof fixture>)=>{x.report.income_total="NaN";},(x:ReturnType<typeof fixture>)=>{x.revision.local=Number.MAX_SAFE_INTEGER+1;},(x:ReturnType<typeof fixture>)=>{x.netWorth.pop();},(x:ReturnType<typeof fixture>)=>{x.netWorth[0].as_of=x.netWorth[1].as_of;},(x:ReturnType<typeof fixture>)=>{x.netWorth[5].as_of="2026-10-07";}]){
    const value=fixture();change(value);expect(()=>validateDashboardSnapshot(value)).toThrow();
  }
  expect(()=>validateDashboardSnapshot({...fixture(),insights:[{severity:"warning",kind:"unknown",message:"fixture"}]})).toThrow();
});
it("refuses malformed account balances instead of exporting an incomplete report summary",()=>{
  expect(()=>validateReportSummarySnapshot({...fixture(),accounts:[{id:1,name:"fixture",current_balance:12.34}]})).toThrow();
});
