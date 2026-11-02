import {expect,it} from "vitest";
import {emptySetupMessage,setupImportMessage} from "./setupImportMessage";
const counts=(n:number)=>({accounts_created:n,categories_created:n,budgets_set:n,buckets_created:n,holdings_created:n,skipped:[],row_errors:0});
it("names one imported item of every kind without placeholder plurals",()=>{
 expect(setupImportMessage(counts(1))).toBe("Setup import done: 1 account, 1 category, 1 budget line, 1 goal, 1 holding.");
});
it("reports plural/zero counts while retaining distinct skipped details and one failed row",()=>{
 expect(setupImportMessage({...counts(2),holdings_created:0,skipped:["QA Existing","QA Unselected"],row_errors:1})).toBe("Setup import done: 2 accounts, 2 categories, 2 budget lines, 2 goals, 0 holdings. Skipped: QA Existing; QA Unselected. 1 row had errors and was ignored.");
});
it("keeps failed-row information separate from imported totals",()=>{
 expect(setupImportMessage({...counts(0),row_errors:2})).toBe("Setup import done: 0 accounts, 0 categories, 0 budget lines, 0 goals, 0 holdings. 2 rows had errors and were ignored.");
});
it("explains why no setup rows can be imported",()=>{
 expect(emptySetupMessage(1)).toBe("Nothing importable found — 1 row had errors.");
 expect(emptySetupMessage(2)).toBe("Nothing importable found — 2 rows had errors.");
 expect(emptySetupMessage(0)).toBe("Nothing importable found in that file — is it a filled-in setup template?");
});
