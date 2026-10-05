import assert from "node:assert/strict";
import https from "node:https";
import tls from "node:tls";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
export function ipc(app,command,args={}) {
  return app.browser.executeAsync((command,args,done)=>window.__TAURI_INTERNALS__.invoke(command,args).then(value=>done({ok:true,value}),error=>done({ok:false,error})),command,args).then(result=>{assert.ok(result.ok,String(result.error));return result.value;});
}
export function client(origin,pem) {
  return (route,options={})=>new Promise((resolve,reject)=>{
    const data=options.body===undefined?undefined:JSON.stringify(options.body);
    const request=https.request(origin+route,{method:options.method??(data?"POST":"GET"),ca:pem,rejectUnauthorized:true,family:4,
      checkServerIdentity:(_name,certificate)=>tls.checkServerIdentity(new URL(origin).hostname,certificate),timeout:18000,
      headers:{"X-Vault-Request":"1",...(data?{"Content-Type":"application/json",Origin:origin,"Content-Length":Buffer.byteLength(data)}:{}),...(options.cookie?{Cookie:options.cookie}:{}),...options.headers}},response=>{
      const chunks=[];response.on("data",chunk=>chunks.push(chunk));
      response.on("error",error=>reject(Object.assign(error,{received:Buffer.concat(chunks).toString()})));
      response.on("end",()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString()}));
    });request.on("error",reject);request.on("timeout",()=>request.destroy(new Error("HTTPS timeout")));request.end(data);
  });
}
export async function pair(app,request,profiles,label="Test phone",useUi=false) {
  const code=await ipc(app,"mobile_begin_pairing");
  const redeemed=await request("/api/pair/redeem",{body:{code,label}});assert.equal(redeemed.status,202);
  assert.equal((await request("/api/pair/redeem",{body:{code,label}})).status,403,"A redeemed code cannot create a second pending device");
  const claim=JSON.parse(redeemed.body).claim;
  assert.equal((await request("/api/pair/complete",{body:{claim}})).status,409,"Redeeming alone cannot authorize a phone");
  const pending=await ipc(app,"mobile_pending_pairings");assert.equal(pending.length,1);
  if(useUi){
    await app.browser.waitUntil(async()=>app.browser.execute(()=>Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Approve phone")),{timeout:5000});
    assert.equal(await app.browser.execute(()=>Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Approve phone").disabled),true);
    await app.browser.execute(()=>document.querySelector(".modal-overlay input[type=checkbox]").click());
    const output=process.env.VAULTSPEND_MOBILE_TASK6_OUTPUT??path.join(os.tmpdir(),"vault-mobile-task6-dialog");fs.mkdirSync(output,{recursive:true});
    const initial=await app.browser.execute(()=>({palette:document.documentElement.dataset.palette,theme:document.documentElement.dataset.theme,motion:document.documentElement.dataset.motion}));
    await app.browser.execute(()=>{document.documentElement.dataset.motion="reduced";});
    await app.browser.execute(fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"),"utf8"));
    for(const palette of ["transparent","futuristic","retro"])for(const theme of ["light","dark"]){
      await app.browser.execute((palette,theme)=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=theme;},palette,theme);
      await app.browser.pause(200); // Use the app's Reduce motion setting while switching styles.
      const violations=await app.browser.executeAsync(done=>window.axe.run(document.querySelector('[role="dialog"]'),{runOnly:{type:"tag",values:["wcag2a","wcag2aa"]}}).then(result=>done(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary,html:n.html}))})))));
      assert.equal(await app.browser.execute(()=>{const panel=document.querySelector('[role="dialog"]');return panel.scrollWidth<=panel.clientWidth+1;}),true,"Confirmation must not overflow horizontally");
      await app.browser.saveScreenshot(path.join(output,`pairing-${palette}-${theme}.png`));
      assert.deepEqual(violations,[],`${palette}/${theme} dialog accessibility`);
    }
    await app.browser.execute(initial=>{document.documentElement.dataset.palette=initial.palette;if(initial.theme)document.documentElement.dataset.theme=initial.theme;else document.documentElement.removeAttribute("data-theme");if(initial.motion)document.documentElement.dataset.motion=initial.motion;else document.documentElement.removeAttribute("data-motion");},initial);
    await app.browser.execute(()=>Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Approve phone").click());
    await app.browser.waitUntil(async()=>(await ipc(app,"mobile_pending_pairings")).length===0,{timeout:5000});
  }else{await ipc(app,"mobile_decide_pairing",{id:pending[0].id,profiles});}
  const completed=await request("/api/pair/complete",{body:{claim}});assert.equal(completed.status,200);
  const cookie=completed.headers["set-cookie"][0];assert.match(cookie,/Secure; HttpOnly; SameSite=Strict/);
  assert.equal((await request("/api/pair/complete",{body:{claim}})).status,403);
  return cookie.split(";")[0];
}
