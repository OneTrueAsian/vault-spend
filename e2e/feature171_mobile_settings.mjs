// Compiled desktop controls + strictly validated fixture HTTPS; no LAN opt-in or global CA.
import assert from "node:assert/strict";
import { readFile,mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { launchApp } from "./harness.mjs";
import { ipc,client,pair } from "./mobileHttpsHarness.mjs";
const app=await launchApp();
try{
 const clickSetting=async(name)=>{
  await app.browser.waitUntil(async()=>app.browser.execute(name=>[...document.querySelectorAll("[data-mobile-settings] button")].some(b=>b.textContent===name&&!b.disabled),name),{timeout:5000});
  await app.browser.execute(name=>[...document.querySelectorAll("[data-mobile-settings] button")].find(b=>b.textContent===name).click(),name);
 };
 const clickConfirm=async()=>{
  await app.browser.waitUntil(async()=>app.browser.execute(()=>[...document.querySelectorAll("[role=dialog] button")].some(b=>b.textContent==="Confirm"&&!b.disabled)),{timeout:5000});
  await app.browser.execute(()=>[...document.querySelectorAll("[role=dialog] button")].find(b=>b.textContent==="Confirm").click());
 };
 await (await app.browser.$("button*=Settings")).click();await app.browser.$("[data-mobile-settings]").waitForExist({timeout:5000});
 assert.equal(await ipc(app,"mobile_saved_config"),null,"Opening settings must not enable networking");
 assert.ok((await app.browser.$("[data-mobile-settings]").getText()).includes("Mobile access is stopped"));
 assert.equal(await app.browser.execute(()=>document.querySelector("[data-mobile-settings] select")===null),true);
 const [server,certificate]=await ipc(app,"debug_start_mobile_asset_server");const request=client(server.origin,certificate.pem);
 // Re-enter settings to query fixture status without waiting for its management timer.
 await (await app.browser.$("button*=Dashboard")).click();await (await app.browser.$("button*=Settings")).click();
 await app.browser.waitUntil(async()=>(await app.browser.$("[data-mobile-settings]").getText()).includes(server.origin),{timeout:6000});
 await clickSetting("Pair a phone");
 await app.browser.waitUntil(async()=>app.browser.execute(()=>!!document.querySelector("[data-mobile-settings] svg")),{timeout:5000});
 assert.ok((await app.browser.$("[data-mobile-settings]").getText()).includes("/mobile/#pair="));
 await clickSetting("Cancel pairing");
 await app.browser.waitUntil(async()=>app.browser.execute(()=>!document.querySelector("[data-mobile-settings] svg")),{timeout:5000});
 const base=(await ipc(app,"list_profiles"))[0],cookie=await pair(app,request,[base.id],"Settings phone");
 const auth=JSON.parse((await request("/api/status",{cookie})).body),saved=await request(`/api/snapshot/${auth.profiles[0].id}`,{cookie});assert.equal(saved.status,200);assert.deepEqual(JSON.parse(saved.body).accounts,[],"An initialized empty profile has a valid first snapshot");
 await app.browser.waitUntil(async()=>(await app.browser.$("[data-mobile-settings]").getText()).includes("Settings phone"),{timeout:6500});
 const output=process.env.VAULTSPEND_MOBILE_TASK7_OUTPUT??path.join(os.tmpdir(),"vault-mobile-task7-settings");await mkdir(output,{recursive:true});
 await app.browser.execute(await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"),"utf8"));
 const original=await app.browser.execute(()=>({palette:document.documentElement.dataset.palette,theme:document.documentElement.dataset.theme,motion:document.documentElement.dataset.motion}));
 await app.browser.execute(()=>document.querySelector("[data-mobile-settings]").scrollIntoView({block:"start"}));
 for(const palette of ["transparent","futuristic","retro"])for(const theme of ["light","dark"]){
  await app.browser.execute((palette,theme)=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=theme;document.documentElement.dataset.motion="reduced";},palette,theme);
  await app.browser.pause(200);
  const violations=await app.browser.executeAsync(done=>window.axe.run(document.querySelector("[data-mobile-settings]"),{runOnly:{type:"tag",values:["wcag2a","wcag2aa"]}}).then(result=>done(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))));
  assert.deepEqual(violations,[],`${palette}/${theme} settings accessibility`);await app.browser.saveScreenshot(path.join(output,`settings-${palette}-${theme}.png`));
 }
 await app.browser.execute(original=>{for(const key of ["palette","theme","motion"]){if(original[key])document.documentElement.dataset[key]=original[key];else delete document.documentElement.dataset[key];}},original);
 await clickSetting("Remove profile access");
 assert.equal((await request("/api/status",{cookie})).status,200,"Opening confirmation must not mutate grants");
 await clickConfirm();
 await app.browser.waitUntil(async()=>JSON.parse((await request("/api/status",{cookie})).body).profiles.length===0,{timeout:5000});
 assert.equal((await request(`/api/snapshot/${auth.profiles[0].id}`,{cookie})).status,403);
 await clickSetting("Revoke phone");
 await clickConfirm();
 await app.browser.waitUntil(async()=>(await request("/api/status",{cookie})).status===401,{timeout:5000});
 await app.browser.waitUntil(async()=>app.browser.execute(()=>[...document.querySelectorAll("[data-mobile-settings] button")].find(b=>b.textContent==="Disable mobile access")?.disabled===false),{timeout:5000});
 await app.browser.execute(()=>{const button=[...document.querySelectorAll("[data-mobile-settings] button")].find(b=>b.textContent==="Disable mobile access");button.closest("details").open=true;});
 await clickSetting("Disable mobile access");
 await app.browser.waitUntil(async()=>!(await ipc(app,"mobile_server_status")).running,{timeout:5000});
 assert.equal(await ipc(app,"mobile_saved_config"),null,"Disposable fixture never writes LAN opt-in");
 console.log("PASS mobile settings, ephemeral QR, empty-profile snapshot, six themes, grant removal, revoke and disable");
}finally{await app.close();}
