import { describe, expect, it } from "vitest";
import { offlineReadiness } from "./mobileOfflineStatus";
describe("truthful offline readiness",()=>{
  const state={storage:true,savedProfiles:1,storageErrors:0,shell:{ready:true,updateWaiting:false,message:""}};
  it("requires reopened financial data and completed controlling-worker cache",()=>{
    expect(offlineReadiness(state)).toContain("Ready offline");
    for(const changed of [{storage:false},{savedProfiles:0},{storageErrors:1},{shell:{...state.shell,ready:false}}])expect(offlineReadiness({...state,...changed})).not.toContain("Ready offline");
  });
  it("reports waiting updates without prematurely discarding an existing offline shell",()=>{
    expect(offlineReadiness({...state,shell:{...state.shell,updateWaiting:true}})).toContain("update is waiting");
  });
});
