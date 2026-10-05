// Production browser assets -> loopback test proxy -> actual compiled HTTPS/API/queue.
// Only this proxy holds the fixture cookie and trusts its CA. Browser TLS/cookie support
// is deliberately NOT claimed by this test; that is the Task 8 device/browser gate.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile,mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { remote } from "webdriverio";
import { launchApp,chooseMenuOption } from "./harness.mjs";
import { ipc,client } from "./mobileHttpsHarness.mjs";
const app=await launchApp();let browser,driver,server,cookie="",offline=false,requests=[];
try{
 const base=(await ipc(app,"list_profiles"))[0];await ipc(app,"create_profile",{name:"Mobile work"});const work=(await ipc(app,"list_profiles")).find(p=>p.is_active);
 const [listener,certificate]=await ipc(app,"debug_start_mobile_asset_server");const request=client(listener.origin,certificate.pem),root=path.resolve("dist-mobile");
 const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".woff":"font/woff",".woff2":"font/woff2",".webmanifest":"application/manifest+json",".png":"image/png"};
 server=createServer(async(req,res)=>{
  try{
   const route=new URL(req.url,"http://localhost").pathname;
   if(route.startsWith("/api/")){
    requests.push(route);if(offline){res.destroy();return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
    const response=await request(route,{method:req.method,body,cookie,headers:req.headers["x-vault-csrf"]?{"X-Vault-CSRF":req.headers["x-vault-csrf"]}:{}});
    if(response.headers["set-cookie"]){const value=response.headers["set-cookie"][0];cookie=value.includes("Max-Age=0")?"":value.split(";")[0];}
    res.writeHead(response.status,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(response.body);return;
   }
   const file=path.resolve(root,"."+route);assert.ok(file.startsWith(root+path.sep));const body=await readFile(file);
   res.writeHead(200,{"Content-Type":mime[path.extname(file)]??"application/octet-stream","Cache-Control":"no-store"});res.end(body);
  }catch{res.writeHead(503);res.end('{}');}
 });await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const url=`http://127.0.0.1:${server.address().port}/mobile/index.html`;
 const profile=await mkdtemp(path.join(os.tmpdir(),"vault-mobile-refresh-edge-"));let port;
 driver=spawn(process.env.MSEDGEDRIVER??path.join(os.homedir(),".cargo/bin/msedgedriver.exe"),["--port=0"],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Edge driver startup timeout")),15000);driver.once("error",reject);driver.stdout.on("data",bytes=>{const match=String(bytes).match(/port (\d+)/);if(match&&Number(match[1])){port=Number(match[1]);clearTimeout(timer);resolve();}});});
 browser=await remote({hostname:"127.0.0.1",port,path:"/",logLevel:"error",capabilities:{browserName:"MicrosoftEdge","ms:edgeOptions":{args:["--headless=new","--disable-gpu","--no-first-run",`--user-data-dir=${profile}`]}}});
 const code=await ipc(app,"mobile_begin_pairing");await browser.url(`${url}#pair=${code}`);
 await browser.$("input[aria-label='One-time pairing code']").waitForExist({timeout:10000});assert.equal(await browser.execute(()=>location.hash),"","The ephemeral code must be removed from browser history");
 await browser.waitUntil(async()=>await browser.$("button*=Request desktop approval").isEnabled(),{timeout:10000});
 await (await browser.$("button*=Request desktop approval")).click();
 await app.browser.waitUntil(async()=>(await ipc(app,"mobile_pending_pairings")).length===1,{timeout:5000});
 await app.browser.waitUntil(async()=>app.browser.execute(()=>document.querySelectorAll(".modal-overlay input[type=checkbox]").length===2),{timeout:5000});
 await app.browser.execute(()=>{for(const input of document.querySelectorAll(".modal-overlay input[type=checkbox]"))input.click();[...document.querySelectorAll("button")].find(b=>b.textContent==="Approve phone").click();});
 await browser.$("button[aria-label^='Profile:']").waitForExist({timeout:12000});
 const identity=JSON.parse((await request("/api/status",{cookie})).body),workGrant=identity.profiles.find(p=>p.name===work.name),baseGrant=identity.profiles.find(p=>p.name===base.name);
 // First grant order follows desktop choices. Download the active profile explicitly if needed.
 if(!(await browser.$("button[aria-label^='Profile:']").getAttribute("aria-label")).includes(work.name)){
  await chooseMenuOption(await browser.$("button[aria-label^='Profile:']"),{value:`${identity.installationId}/${workGrant.id}`});await (await browser.$("button*=Download selected snapshot")).click();
 }
 await browser.waitUntil(async()=>browser.execute(()=>!!document.querySelector(".mobile-sync")),{timeout:10000});
 await ipc(app,"switch_profile",{id:base.id});requests=[];
 await chooseMenuOption(await browser.$("button[aria-label^='Profile:']"),{value:`${identity.installationId}/${baseGrant.id}`});
 await (await browser.$("button*=Download selected snapshot")).click();
 await browser.waitUntil(async()=>browser.execute(()=>!!document.querySelector(".mobile-sync")),{timeout:10000});
 assert.deepEqual(requests.filter(p=>p.startsWith("/api/snapshot/")),[`/api/snapshot/${baseGrant.id}`]);
 const rows=()=>browser.executeAsync(done=>{const open=indexedDB.open("vault-spend-mobile-v1");open.onsuccess=()=>{const db=open.result,tx=db.transaction("profiles"),req=tx.objectStore("profiles").getAll();tx.oncomplete=()=>{done(req.result.map(r=>({id:r.id,sequence:r.sequence})));db.close();};};});
 assert.equal((await rows()).length,2);
 await chooseMenuOption(await browser.$("button[aria-label^='Profile:']"),{value:`${identity.installationId}/${workGrant.id}`});
 const before=await rows();await (await browser.$("button=Refresh")).click();await browser.waitUntil(async()=>(await browser.$("body").getText()).includes("Open and unlock this profile"),{timeout:10000});assert.deepEqual(await rows(),before);assert.equal((await ipc(app,"list_profiles")).find(p=>p.is_active).id,base.id,"Phone selection must not switch desktop profiles");
 await browser.waitUntil(async()=>browser.execute(()=>document.body.textContent.includes("Ready offline")),{timeout:10000});
 offline=true;await browser.refresh();await browser.$(".mobile-sync").waitForExist({timeout:10000});await browser.waitUntil(async()=>(await browser.$("body").getText()).includes("Desktop unavailable"),{timeout:10000});assert.deepEqual(await rows(),before);
 if(!await browser.execute(()=>document.querySelector(".mobile-connection-options").open))await (await browser.$(".mobile-connection-options > summary")).click();
 await (await browser.$("button*=Forget this phone")).click();await (await browser.$("button*=Remove saved data")).click();await browser.waitUntil(async()=>browser.execute(()=>document.querySelectorAll(".mobile-storage-dialog[open]").length===0),{timeout:10000});assert.deepEqual(await rows(),[]);
 offline=false;requests=[];await browser.refresh();await browser.$("button[aria-label='Appearance']").waitForExist({timeout:10000});await browser.pause(300);assert.equal(requests.filter(p=>p.startsWith("/api/")).length,0,"An offline-forgotten phone must not silently reuse its remaining protected cookie");
 assert.equal((await request("/api/status",{cookie})).status,200,"Offline Forget truthfully leaves the desktop grant until revoked");
 console.log(`PASS Edge ${browser.capabilities.browserVersion}: pairing, real compiled snapshots, selected-profile-only refresh, inactive retention, saved reopen, offline Forget and no silent reconnect (test-only TLS proxy)`);
}catch(error){if(browser)console.error("Mobile flow diagnostic:",await browser.$("body").getText(),requests);throw error;}finally{if(browser)await browser.deleteSession();driver?.kill();if(server?.listening)await new Promise(resolve=>server.close(resolve));await app.close();}
