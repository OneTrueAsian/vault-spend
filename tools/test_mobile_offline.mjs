// Native IndexedDB/WebCrypto/service-worker tests against compiled assets. Synthetic data only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile,mkdtemp,mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { remote } from "webdriverio";

const root=path.resolve("dist-mobile-test"),profile=await mkdtemp(path.join(os.tmpdir(),"vault-mobile-offline-edge-"));
const output=process.env.VAULTSPEND_MOBILE_TEST_OUTPUT??path.join(os.tmpdir(),"vault-spend-mobile-offline-check");await mkdir(output,{recursive:true});
const fixture=JSON.parse(await readFile("core/tests/fixtures/mobile_snapshot_v1.json","utf8"));
fixture.profile.name="Encrypted synthetic household 7649";fixture.accounts[0].name="Private synthetic checking 7650";
const binding={installationId:fixture.installationId,profileId:fixture.profile.id,epoch:fixture.epoch};
const second={...fixture,profile:{...fixture.profile,id:"second-profile",name:"Encrypted synthetic personal 7651"}};
const secondBinding={...binding,profileId:second.profile.id};
const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".woff":"font/woff",".woff2":"font/woff2",".webmanifest":"application/manifest+json",".png":"image/png"};
const originalWorker=await readFile(path.join(root,"mobile/sw.js"),"utf8");let workerOverride=null,assetOverride=null;
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,"http://localhost");
    if(url.pathname==="/api/snapshot"||url.pathname==="/mobile/api/snapshot"){res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(fixture));return;}
    const file=path.resolve(root,"."+url.pathname);if(!file.startsWith(root+path.sep))throw new Error("Outside build");
    let body=url.pathname==="/mobile/sw.js"&&workerOverride?workerOverride:await readFile(file);
    if(url.pathname===assetOverride)body=Buffer.concat([Buffer.from(body),Buffer.from("different build")]);
    res.writeHead(200,{"Content-Type":mime[path.extname(file)]??"application/octet-stream","Cache-Control":"no-store"});res.end(body);
  }catch{res.writeHead(404);res.end("Not found");}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));const serverPort=server.address().port,url=`http://127.0.0.1:${serverPort}/mobile/storage-test.html`;
let browser,driver,port;const checks=[];
const pass=label=>{checks.push(label);console.log(`PASS ${label}`);};
try{
  driver=spawn(process.env.MSEDGEDRIVER??path.join(os.homedir(),".cargo/bin/msedgedriver.exe"),["--port=0"],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("Driver startup timeout")),15000);driver.once("error",reject);driver.stdout.on("data",b=>{const match=String(b).match(/port (\d+)/);if(match&&Number(match[1])){port=Number(match[1]);clearTimeout(timer);resolve();}});});
  const cdp=async(cmd,params)=>{const response=await fetch(`http://127.0.0.1:${port}/session/${browser.sessionId}/ms/cdp/execute`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cmd,params})});return(await response.json()).value;};
  const open=async()=>{browser=await remote({hostname:"127.0.0.1",port,path:"/",logLevel:"error",capabilities:{browserName:"MicrosoftEdge","ms:edgeOptions":{args:["--headless=new","--disable-gpu","--no-first-run",`--user-data-dir=${profile}`]}}});await browser.url(url);await cdp("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});try{await browser.$("button[aria-label='Settings']").waitForExist({timeout:15000});}catch(error){console.log(await browser.$("body").getText());console.log(await browser.execute(async()=>({url:location.href,controller:!!navigator.serviceWorker?.controller,caches:await caches.keys()})));throw error;}};
  const run=async(fn,...args)=>browser.executeAsync((fnString,values,done)=>{Promise.resolve().then(()=>new Function(`return (${fnString})`)()(...values)).then(result=>done({ok:true,result:result??null}),error=>done({ok:false,error:error.message,code:error.code??null}));},fn.toString(),args);
  const must=async(fn,...args)=>{const response=await run(fn,...args);assert.equal(response.ok,true,response.error);return response.result;};
  const save=async(data,identity=binding)=>must((json,b)=>window.mobileStorageProbe.replace(json,b),JSON.stringify(data),identity);
  const load=()=>must(()=>window.mobileStorageProbe.load().then(x=>({profiles:x.snapshots.map(s=>({id:s.profile.id,name:s.profile.name,sequence:s.sequence})),errors:x.errors.map(e=>e.code),active:x.active})));
  const rows=()=>must(()=>new Promise((resolve,reject)=>{
    const open=indexedDB.open("vault-spend-mobile-v1",1);
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction(["profiles","metadata"]),req=tx.objectStore("profiles").getAll(),meta=tx.objectStore("metadata").getAll();
      tx.oncomplete=()=>{resolve({records:req.result.map(r=>({id:r.id,sequence:r.sequence,extractable:r.key?.extractable,metadata:JSON.stringify({...r,key:undefined,ciphertext:undefined,iv:undefined}),ciphertext:new TextDecoder().decode(r.ciphertext)})),meta:JSON.stringify(meta.result)});db.close();};
    };
    open.onerror=()=>reject(open.error);
  }));
  const update=()=>must(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();return true;});
  const wait=async(fn)=>browser.waitUntil(()=>browser.execute(fn),{timeout:20000,interval:100});
  const tap=async(label)=>{if(["Remove saved profile","Forget this phone"].includes(label)){await browser.$("button[aria-label='Settings']").click();}if(["Remove saved profile","Forget this phone"].includes(label))await browser.execute(()=>document.querySelector(".mobile-connection-options").open=true);await browser.$(`button=${label}`).click();};
  const choose=async(label)=>{await browser.$("button[aria-label^='Profile:']").click();for(const option of await browser.$$("[role='menuitemradio']"))if(await option.$("span").getText()===label){await option.click();return;}throw new Error("Profile menu option missing");};
  await open();await wait(()=>!!navigator.serviceWorker.controller);
  assert.ok(!(await browser.$("body").getText()).includes("Ready offline"));pass("Empty device does not claim offline financial readiness");
  // Throwing native put at the encrypted-row boundary must roll back both ciphertext and pointer.
  const failed=await run(async(json,b)=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==="profiles")throw new DOMException("Injected quota failure","QuotaExceededError");return put.apply(this,args);};try{await window.mobileStorageProbe.replace(json,b);}finally{IDBObjectStore.prototype.put=put;}},JSON.stringify(fixture),binding);
  assert.equal(failed.ok,false);assert.equal((await rows()).records.length,0);assert.equal((await load()).active,null);pass("Native quota fault leaves no key, ciphertext or active pointer");
  await save(fixture);await save(second,secondBinding);await wait(()=>document.body.textContent.includes("Ready offline"));
  const stored=await rows();assert.equal(stored.records.length,2);assert.ok(stored.records.every(r=>r.extractable===false));
  const serialized=JSON.stringify(stored);for(const canary of [fixture.profile.name,fixture.accounts[0].name,second.profile.name])assert.ok(!serialized.includes(canary));pass("Native IndexedDB stores encrypted profiles and non-extractable keys without financial plaintext");
  await choose(second.profile.name);assert.equal((await load()).active,`${binding.installationId}/${second.profile.id}`);pass("Active profile pointer persists without a profile name");
  assert.equal(await must(()=>innerWidth),390);
  assert.ok(await must(()=>document.documentElement.scrollWidth<=innerWidth));
  await browser.saveScreenshot(path.join(output,"ready-offline.png"));pass("Saved viewer and storage controls fit a phone viewport");

  for(const route of ["/api/snapshot","/mobile/api/snapshot"])assert.equal(await must(async p=>(await fetch(p)).ok,route),true);
  const cacheUrls=await must(async()=>{const urls=[];for(const name of await caches.keys())for(const key of await(await caches.open(name)).keys())urls.push(key.url);return urls;});
  assert.ok(!cacheUrls.some(u=>u.includes("/api/")));pass("API responses never enter Cache API");
  await new Promise(r=>server.close(r));await browser.deleteSession();browser=null;await open();
  await wait(()=>document.body.textContent.includes("Ready offline"));const cold=await load();assert.deepEqual(cold.profiles.map(p=>p.name).sort(),[fixture.profile.name,second.profile.name].sort());
  assert.ok((await browser.$("button[aria-label^='Profile:']").getAttribute("aria-label")).includes(second.profile.name));pass("Cold Edge process restart reopens encrypted keys/snapshots with server stopped");
  await choose(fixture.profile.name);await tap("Reports");await browser.$(".mobile-chart button").click();await tap("Calculators");pass("Offline profile switching, reports and calculators remain usable");
  for(const route of ["/api/snapshot","/mobile/api/snapshot"])assert.equal((await run(async p=>fetch(p),route)).ok,false);pass("Offline API reads fail instead of returning cached financial responses");

  const missing=await must(async()=>{
    const channel=new MessageChannel();
    const status=await new Promise(resolve=>{channel.port1.onmessage=e=>resolve(e.data);navigator.serviceWorker.controller.postMessage({type:"offline-status"},[channel.port2]);});
    const cache=await caches.open(status.cacheName),key=(await cache.keys()).find(k=>k.url.endsWith(".woff"));await cache.delete(key);return key.url;
  });
  await browser.$("button[aria-label='Settings']").click();await must(()=>{dispatchEvent(new Event("online"));});await wait(()=>document.body.textContent.includes("Offline setup is incomplete"));pass("Missing cached asset prevents false offline readiness");
  await new Promise(r=>server.listen(serverPort,"127.0.0.1",r));
  assetOverride=new URL(missing).pathname;
  const mixed=await must(()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=e=>resolve(e.data.ready);navigator.serviceWorker.controller.postMessage({type:"repair-offline-shell"},[channel.port2]);}));
  assert.equal(mixed,false);assert.equal(await must(async url=>!!(await caches.match(url)),missing),false);pass("Shell repair rejects bytes from a different build instead of mixing versions");assetOverride=null;
  await must(()=>{dispatchEvent(new Event("online"));});await wait(()=>document.body.textContent.includes("Ready offline"));
  assert.ok(await must(async url=>!!(await caches.match(url)),missing));pass("Reconnection repairs missing static assets without replacing encrypted data");

  const abort=await run(async(json,b)=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const result=put.apply(this,args);if(this.name==="profiles")queueMicrotask(()=>this.transaction.abort());return result;};try{await window.mobileStorageProbe.replace(json,b);}finally{IDBObjectStore.prototype.put=put;}},JSON.stringify({...fixture,sequence:"2"}),binding);
  assert.equal(abort.ok,false);assert.equal((await load()).profiles.find(p=>p.id===binding.profileId).sequence,"1");pass("Interrupted native write retains the previous snapshot and key");
  for(const fault of ["key","cipher","header","version"]){
    const result=await must(async fault=>{
      const opened=await new Promise((resolve,reject)=>{const r=indexedDB.open("vault-spend-mobile-v1",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const id="installation-test/profile-test";
      const original=await new Promise(resolve=>{const r=opened.transaction("profiles").objectStore("profiles").get(id);r.onsuccess=()=>resolve(r.result);});
      const changed=structuredClone(original);
      if(fault==="key")delete changed.key;if(fault==="cipher")new Uint8Array(changed.ciphertext)[0]^=1;if(fault==="header")changed.epoch="wrong-epoch";if(fault==="version")changed.envelopeVersion=2;
      const put=row=>new Promise((resolve,reject)=>{const tx=opened.transaction("profiles","readwrite");tx.objectStore("profiles").put(row);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});
      await put(changed);const result=await window.mobileStorageProbe.load();await put(original);opened.close();return {profiles:result.snapshots.length,errors:result.errors.map(e=>e.code)};
    },fault);
    assert.equal(result.profiles,1);assert.deepEqual(result.errors,[fault==="version"?"version":"corrupt"]);assert.equal((await rows()).records.length,2);pass(`Native ${fault} fault is isolated and keeps saved rows`);
  }
  assert.equal((await run((json,b)=>window.mobileStorageProbe.replace(json,b),JSON.stringify({...fixture,minimumViewerVersion:2,sequence:"2"}),binding)).ok,false);assert.equal((await load()).profiles.find(p=>p.id===binding.profileId).sequence,"1");pass("Newer/incompatible snapshots retain the old readable copy");
  workerOverride=originalWorker.replace(/vault-mobile-shell-([a-f0-9]+)/,"vault-mobile-shell-$1-failed").replace("const allowed=new Set(assets);","assets.push(new URL('missing-test-asset.png',self.registration.scope).href);const allowed=new Set(assets);");
  await update();await wait(async()=>{const r=await navigator.serviceWorker.getRegistration();return !r.installing;});
  assert.ok(!(await must(()=>caches.keys())).some(k=>k.endsWith("-failed")));assert.ok((await browser.$("body").getText()).includes("Ready offline"));pass("Failed worker installation preserves the active complete shell");
  workerOverride=originalWorker.replace(/vault-mobile-shell-([a-f0-9]+)/,"vault-mobile-shell-$1-updated");await update();await wait(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
  assert.equal(await must(()=>navigator.serviceWorker.controller.state),"activated");pass("Worker update waits while the old viewer remains open");
  await browser.deleteSession();browser=null;await open();await wait(()=>document.body.textContent.includes("Ready offline"));assert.equal((await load()).profiles.length,2);pass("Worker activation after browser restart preserves encrypted copies");
  await tap("Remove saved profile");
  await browser.execute(await readFile(path.resolve("node_modules/axe-core/axe.min.js"),"utf8"));
  const violations=await browser.executeAsync(done=>window.axe.run({runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}}).then(r=>done(r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))));
  assert.deepEqual(violations,[]);await browser.saveScreenshot(path.join(output,"forget-dialog.png"));pass("Native removal dialog passes Axe accessibility checks");
  await tap("Cancel");assert.equal((await load()).profiles.length,2);await tap("Remove saved profile");await tap("Remove saved data");await wait(()=>!document.querySelector("dialog").open);assert.equal((await load()).profiles.length,1);pass("Confirmed selective removal deletes one profile and key; cancel keeps it");
  const mainTab=await browser.getWindowHandle();await browser.newWindow(url);const secondTab=await browser.getWindowHandle();
  await wait(()=>!!document.querySelector("button[aria-label^='Profile:']"));await browser.switchToWindow(mainTab);
  const guard=await must(b=>window.mobileStorageProbe.prepareRefresh(b),binding);
  const accessFence=await must(()=>window.mobileStorageProbe.accessFence());
  await must(fence=>window.mobileStorageProbe.remember(fence),accessFence);
  assert.equal(await must(()=>window.mobileStorageProbe.remembered()),true);pass("Remembered access intent is persisted separately from credentials");
  await tap("Forget this phone");await tap("Remove saved data");await wait(()=>!document.querySelector("dialog").open);assert.equal((await rows()).records.length,0);assert.equal((await load()).active,null);
  assert.equal((await run((json,b,guard)=>window.mobileStorageProbe.replace(json,b,{guard}),JSON.stringify(fixture),binding,guard)).ok,false);pass("Forget clears all keys/data/pointer and rejects a pre-forget refresh guard");
  assert.equal(await must(()=>window.mobileStorageProbe.remembered()),false);
  assert.equal((await run(fence=>window.mobileStorageProbe.remember(fence),accessFence)).ok,false);pass("Forget removes remembered access and fences pending pairing completion");
  await browser.switchToWindow(secondTab);await wait(()=>document.body.textContent.includes("No saved snapshot"));
  assert.ok(!(await browser.$("body").getText()).includes(second.profile.name));await browser.closeWindow();await browser.switchToWindow(mainTab);pass("Forget clears financial view state in another open tab via BroadcastChannel");
  await save(fixture);
  await must(()=>new Promise((resolve,reject)=>{const request=indexedDB.open("vault-spend-mobile-v1",2);request.onsuccess=()=>{request.result.close();resolve();};request.onerror=()=>reject(request.error);}));
  const newer=await run(()=>window.mobileStorageProbe.load());assert.equal(newer.code,"version");
  assert.equal(await must(()=>new Promise(resolve=>{const request=indexedDB.open("vault-spend-mobile-v1",2);request.onsuccess=()=>{const db=request.result,row=db.transaction("profiles").objectStore("profiles").count();row.onsuccess=()=>{resolve(row.result);db.close();};};})),1);pass("Old viewer refuses a future storage version without deleting encrypted rows");
  const injection=await cdp("Page.addScriptToEvaluateOnNewDocument",{source:"IDBFactory.prototype.open=function(){throw new DOMException('Storage blocked','SecurityError');}"});await browser.refresh();await browser.$("button[aria-label='Settings']").click();await wait(()=>document.body.textContent.includes("Encrypted storage is unavailable"));assert.ok(!(await browser.$("body").getText()).includes("Ready offline"));await cdp("Page.removeScriptToEvaluateOnNewDocument",{identifier:injection.identifier});pass("Private/denied IndexedDB fault gives recovery copy and no false readiness");
  console.log(JSON.stringify({browser:browser.capabilities.browserVersion,checks:checks.length,passed:checks,output},null,2));
}finally{if(browser)await browser.deleteSession();driver?.kill();if(server.listening)await new Promise(r=>server.close(r));}
