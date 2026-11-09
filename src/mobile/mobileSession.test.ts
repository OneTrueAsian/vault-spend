import { expect, it, vi } from "vitest";
import { refreshSelectedMobile, forgetMobileAccess } from "./mobileSession";
import type { MobileRepository } from "./mobileRepository";
import { mobileConnectionMessage } from "./mobileSession";
import { MobileSnapshotVersionError } from "./mobileSnapshot";
const root="a".repeat(32), profile="b".repeat(64), epoch="c".repeat(64), other="d".repeat(64);
const status={installationId:root,csrf:"e".repeat(64),profiles:[{id:profile,epoch,name:"Personal",icon:null},{id:other,epoch,name:"Work",icon:null}]};
it("explains a newer viewer requirement without implying missing desktop data",()=>{expect(mobileConnectionMessage(new MobileSnapshotVersionError())).toContain("newer viewer");});
function repository(){return {remembered:vi.fn(async()=>true),accessFence:vi.fn(async()=>"fence"),load:vi.fn(async()=>({snapshots:[],active:null,errors:[]})),prepareRefresh:vi.fn(async()=>({id:`${root}/${profile}`,fence:"fence"})),replace:vi.fn(async()=>"saved"),forget:vi.fn(async()=>{})} as unknown as MobileRepository;}
it("refreshes only the selected authorized profile",async()=>{
 const repo=repository(),fetcher=vi.fn(async(input:RequestInfo|URL)=>new Response(String(input)==="/api/status"?JSON.stringify(status):"snapshot"));
 await refreshSelectedMobile(repo,`${root}/${other}`,fetcher);
 expect(fetcher.mock.calls.map(c=>c[0])).toEqual(["/api/status",`/api/snapshot/${other}`]);
 expect(repo.replace).toHaveBeenCalledWith("snapshot",{installationId:root,profileId:other,epoch},{guard:{id:`${root}/${profile}`,fence:"fence"}});
});
it("never silently substitutes an ungranted selected profile",async()=>{
 const repo=repository(),fetcher=vi.fn(async()=>new Response(JSON.stringify(status)));
 await expect(refreshSelectedMobile(repo,`${root}/missing`,fetcher)).rejects.toThrow("mobile_access_denied");
 expect(repo.replace).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not reconnect a forgotten phone or resurrect data forgotten during status",async()=>{
 const repo=repository(),fetcher=vi.fn(async()=>new Response(JSON.stringify(status)));
 vi.mocked(repo.remembered).mockResolvedValue(false);
 await expect(refreshSelectedMobile(repo,null,fetcher)).rejects.toThrow("mobile_access_forgotten");expect(fetcher).not.toHaveBeenCalled();
 vi.mocked(repo.remembered).mockResolvedValue(true);vi.mocked(repo.prepareRefresh).mockResolvedValue({id:"saved",fence:"after-forget"});
 await expect(refreshSelectedMobile(repo,null,fetcher)).rejects.toThrow("mobile_access_forgotten");expect(repo.replace).not.toHaveBeenCalled();
});
it("keeps data on unavailable desktop and permits a later retry",async()=>{
 const repo=repository(),fetcher=vi.fn(async(input:RequestInfo|URL)=>new Response(String(input)==="/api/status"?JSON.stringify(status):'{}',{status:String(input)==="/api/status"?200:409}));
 await expect(refreshSelectedMobile(repo,null,fetcher)).rejects.toThrow();expect(repo.replace).not.toHaveBeenCalled();
 fetcher.mockImplementation(async(input)=>new Response(String(input)==="/api/status"?JSON.stringify(status):"snapshot"));
 await refreshSelectedMobile(repo,null,fetcher);expect(repo.replace).toHaveBeenCalledOnce();
});
it("forgets local data even if offline logout fails",async()=>{
 const repo=repository();expect(await forgetMobileAccess(repo,async()=>{throw new TypeError("offline");})).toBe(false);expect(repo.forget).toHaveBeenCalledOnce();
});
it("requires explicit approval to replace a saved epoch",async()=>{
 const repo=repository(),previous="f".repeat(64);
 vi.mocked(repo.load).mockResolvedValue({snapshots:[{installationId:root,profile:{id:profile},epoch:previous} as Awaited<ReturnType<MobileRepository["load"]>>["snapshots"][number]],active:`${root}/${profile}`,errors:[]});
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>new Response(String(input)==="/api/status"?JSON.stringify(status):"snapshot"));
 await expect(refreshSelectedMobile(repo,`${root}/${profile}`,fetcher)).rejects.toThrow("Confirm replacing");expect(repo.replace).not.toHaveBeenCalled();
 await refreshSelectedMobile(repo,`${root}/${profile}`,fetcher,previous);
 expect(repo.replace).toHaveBeenCalledWith("snapshot",{installationId:root,profileId:profile,epoch},{replaceEpoch:previous,guard:{id:`${root}/${profile}`,fence:"fence"}});
});
it("retains the saved copy when authenticated status has no initialized profile grants",async()=>{
 const repo=repository();await expect(refreshSelectedMobile(repo,null,async()=>new Response(JSON.stringify({...status,profiles:[]})))).rejects.toThrow();expect(repo.replace).not.toHaveBeenCalled();
});
it("chooses an active unlocked first download and avoids queuing an inactive selected profile",async()=>{
 const repo=repository(),available={...status,profiles:[{...status.profiles[0],refreshable:false},{...status.profiles[1],refreshable:true}]};
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>new Response(String(input)==="/api/status"?JSON.stringify(available):"snapshot"));
 expect((await refreshSelectedMobile(repo,null,fetcher)).profiles[0].id).toBe(other);
 expect(fetcher.mock.calls[1][0]).toBe(`/api/snapshot/${other}`);fetcher.mockClear();
 await expect(refreshSelectedMobile(repo,`${root}/${profile}`,fetcher)).rejects.toThrow("mobile_profile_unavailable");expect(fetcher).toHaveBeenCalledTimes(1);
});
