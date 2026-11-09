import {expect,it} from "vitest";
import {rolloverMessage,contributionMessage} from "./maintenanceMessages";
it("names the one rolled-forward account without a placeholder plural",()=>{
 expect(rolloverMessage(["QA Checking"])).toBe("Rolled forward this month's starting balance for 1 account: QA Checking.");
});
it("retains both affected account names with a real plural",()=>{
 expect(rolloverMessage(["QA Checking","QA Savings"])).toBe("Rolled forward this month's starting balance for 2 accounts: QA Checking, QA Savings.");
});
it("names one automatically funded bucket",()=>{
 expect(contributionMessage(["QA Car"])).toBe("Added this month's automatic contribution for 1 bucket: QA Car.");
});
it("names both automatically funded buckets",()=>{
 expect(contributionMessage(["QA Car","QA Trip"])).toBe("Added this month's automatic contribution for 2 buckets: QA Car, QA Trip.");
});
