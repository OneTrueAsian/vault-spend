import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { ipc,client,pair } from "./mobileHttpsHarness.mjs";
async function waitFile(file) {
  const until=Date.now()+15000;
  while(Date.now()<until){try{return await readFile(file,"utf8");}catch{await new Promise(resolve=>setTimeout(resolve,10));}}
  throw new Error("Compiled mobile authorization barrier did not arrive");
}
export async function runRaceSuite(stage) {
  const app=await launchApp();
  try {
    const [server,certificate]=await ipc(app,"debug_start_mobile_asset_server");const request=client(server.origin,certificate.pem);
    const base=(await ipc(app,"list_profiles"))[0];
    for(const action of ["lock","switch","revoke"]){
      const name=`Race ${stage} ${action}`;
      await ipc(app,"create_profile",{name});
      const active=(await ipc(app,"list_profiles")).find(p=>p.is_active);
      const cookie=await pair(app,request,[active.id],`Phone ${action}`);
      const status=JSON.parse((await request("/api/status",{cookie})).body);
      const devices=await ipc(app,"mobile_list_devices");
      const target=action==="switch"?base.id:action==="revoke"?devices.at(-1).id:active.id;
      const nonce=await ipc(app,"debug_mobile_authorization_race",{stage,action,target});
      const marker=suffix=>path.join(app.testDbDir,`mobile-race-${nonce}.${suffix}`);
      const responsePromise=request(`/api/snapshot/${status.profiles[0].id}`,{cookie}).then(response=>({response}),error=>({error}));
      await waitFile(marker("reached"));
      // A lock/switch during the coherent read waits for the SQLite/session lock.
      // Release the build, then the native post-build barrier waits for that actor.
      if(stage==="building")await writeFile(marker("release"),"1");
      assert.equal(await waitFile(marker("changed")),"ok",`Native ${action} must complete`);
      if(stage!=="building")await writeFile(marker("release"),"1");
      const result=await responsePromise;
      const body=result.response?.body??result.error?.received??"";
      assert.ok(!body.includes('"overview"')&&!body.includes(name),`${stage}/${action} must not deliver an unsent financial projection`);
      if(result.response)assert.notEqual(result.response.status,200,body);
    }
    console.log(`PASS compiled ${stage} financial delivery barriers: lock, switch and revoke`);
  }finally{await app.close();}
}
