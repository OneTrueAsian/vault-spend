// Direct packaged HTTPS, real Firefox cookie jar/storage/worker. CA installation is
// scoped to a copied test browser and its disposable profile, never the OS store.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp,mkdir,mkdtemp,writeFile,readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { firefox } from "playwright";
import { launchApp } from "../e2e/harness.mjs";
import { ipc } from "../e2e/mobileHttpsHarness.mjs";
import { seedFixture } from "../e2e/lib/seed.mjs";
import { dateInMonth } from "../e2e/lib/dates.mjs";
import { makeTempDir } from "../e2e/lib/tempDir.mjs";
const dbDir=await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Trusted browser checking', 'checking', '1000.00')")
account=cur.lastrowid
cur.execute("INSERT INTO transactions (account_id,date,description,amount,category,fingerprint) VALUES (?, '${dateInMonth(-1,4)}','Synthetic private merchant','-125.00','Groceries','trusted-browser-fixture')", (account,))
`);
const app=await launchApp({dbDir}),directory=makeTempDir("vault-mobile-trusted-firefox-");
const output=process.env.VAULTSPEND_MOBILE_TASK8_OUTPUT??path.join(os.tmpdir(),"vault-mobile-task8-browsers");await mkdir(output,{recursive:true});
const checks=[],pass=label=>{checks.push(label);console.log(`PASS ${label}`);};let context,page;
try{
 const [server,certificate]=await ipc(app,"debug_start_mobile_asset_server"),url=server.origin+"/mobile/index.html";
 context=await firefox.launchPersistentContext(path.join(directory,"untrusted"),{headless:true,ignoreHTTPSErrors:false,firefoxUserPrefs:{"security.enterprise_roots.enabled":false}});page=await context.newPage();
 await assert.rejects(page.goto(url,{timeout:10000}),/SEC_ERROR_UNKNOWN_ISSUER|SSL_ERROR|certificate|NS_ERROR/i);pass("Untrusted root is rejected without certificate-error bypass");await context.close();context=null;
 const source=path.dirname(firefox.executablePath()),copy=path.join(directory,"browser");await cp(source,copy,{recursive:true});
 const publicPath=path.join(directory,"public-root.pem");await writeFile(publicPath,certificate.pem);
 const executablePath=path.join(copy,path.basename(firefox.executablePath())),profile=path.join(directory,"trusted");
 const launch=async()=>firefox.launchPersistentContext(profile,{headless:true,executablePath,ignoreHTTPSErrors:false,viewport:{width:390,height:844},firefoxUserPrefs:{"security.enterprise_roots.enabled":false}});
 context=await launch();await context.close();context=null;execFileSync("python",[path.resolve("tools/mobile_test_firefox_ca.py"),profile,copy,publicPath],{stdio:"inherit"});
 context=await launch();page=await context.newPage();const requests=[];page.on("request",req=>requests.push(req.url()));
 await assert.rejects(page.goto(url.replace("127.0.0.1","localhost"),{timeout:10000}),/SSL_ERROR_BAD_CERT_DOMAIN|certificate.*domain/i);pass("Trusted root still rejects the wrong hostname");requests.length=0;
 const before=await ipc(app,"debug_mobile_database_digest"),code=await ipc(app,"mobile_begin_pairing");await page.goto(url+`#pair=${code}`);assert.equal(new URL(page.url()).hash,"");pass("Trusted root serves packaged viewer directly over HTTPS");
 await page.getByRole("button",{name:"Request desktop approval",exact:true}).click();
 await app.browser.waitUntil(async()=>(await ipc(app,"mobile_pending_pairings")).length===1,{timeout:5000});
 await app.browser.waitUntil(async()=>app.browser.execute(()=>!!document.querySelector(".modal-overlay input[type=checkbox]")),{timeout:5000});
 await app.browser.execute(()=>{document.querySelector(".modal-overlay input[type=checkbox]").click();[...document.querySelectorAll("button")].find(b=>b.textContent==="Approve phone").click();});
 await page.locator(".mobile-sync").waitFor({timeout:12000});await page.waitForFunction(()=>document.body.textContent.includes("Ready offline"),{timeout:10000});
 await page.getByRole("button",{name:"Overview",exact:true}).click();assert.ok((await page.locator("body").innerText()).includes("$875.00"));await page.getByRole("button",{name:"Settings",exact:true}).click();pass("Desktop-approved real projection replaces the encrypted saved copy");
 const cookies=await context.cookies(server.origin),credential=cookies.find(c=>c.name==="__Host-vaultspend-device");assert.ok(credential);assert.equal(credential.httpOnly,true);assert.equal(credential.secure,true);assert.equal(credential.sameSite,"Strict");assert.equal(credential.path,"/");assert.ok(credential.expires>Date.now()/1000+300*86400);
 assert.equal(await page.evaluate(()=>document.cookie.includes("__Host-vaultspend-device")),false);pass("Actual browser honors Secure, HttpOnly, Strict and remembered expiry");
 const state=await page.evaluate(()=>new Promise((resolve,reject)=>{
  const open=indexedDB.open("vault-spend-mobile-v1");open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{
   const db=open.result,tx=db.transaction(["profiles","metadata"]),rows=tx.objectStore("profiles").getAll(),metadata=tx.objectStore("metadata").getAll();
   tx.oncomplete=()=>{
    resolve({rows:rows.result.map(r=>({sequence:r.sequence,extractable:r.key.extractable,metadata:JSON.stringify({...r,key:undefined,ciphertext:undefined,iv:undefined}),ciphertext:new TextDecoder().decode(r.ciphertext)})),metadata:JSON.stringify(metadata.result)});
    db.close();
   };
  };
 }));
 assert.equal(state.rows.length,1);assert.equal(state.rows[0].extractable,false);assert.ok(!JSON.stringify(state).includes(credential.value));assert.ok(!JSON.stringify(state).includes("Trusted browser checking"));pass("IndexedDB stores ciphertext, non-extractable key and non-secret intent without credential");
 assert.equal(await ipc(app,"debug_mobile_database_digest"),before);assert.ok(requests.every(request=>request.startsWith(server.origin+"/")));pass("Reads preserve desktop database and request only the packaged origin");
 const savedTime=await page.locator(".mobile-sync").innerText();await page.getByRole("button",{name:"Refresh",exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes("Wait 30 seconds"));assert.equal(await page.locator(".mobile-sync").innerText(),savedTime);pass("Rate-limited refresh preserves the readable saved snapshot and timestamp");
 await context.close();context=null;await ipc(app,"mobile_disable");
 context=await launch();page=await context.newPage();await page.goto(url,{timeout:15000});await page.locator(".mobile-snapshot-status").waitFor({timeout:10000});assert.ok((await page.locator("body").innerText()).includes("$875.00"));pass("Cold Firefox restart opens encrypted snapshot with HTTPS desktop stopped");
 await page.screenshot({path:path.join(output,"trusted-firefox-offline.png")});
 await page.getByRole("button",{name:"Settings",exact:true}).click();
 if(!await page.locator(".mobile-connection-options").evaluate(e=>e.open))await page.locator(".mobile-connection-options > summary").click();
 await page.getByRole("button",{name:"Forget this phone",exact:true}).click();await page.getByRole("button",{name:"Remove saved data",exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes("Automatic reconnection is disabled"));assert.equal(await page.locator(".mobile-sync").count(),0);pass("Offline Forget erases finances and leaves an explicit desktop-revocation instruction");
 const version=context.browser()?.version()??await page.evaluate(()=>navigator.userAgent);
 await context.close();context=null;execFileSync("python",[path.resolve("tools/mobile_test_firefox_ca.py"),profile,copy,publicPath,"remove"],{stdio:"inherit"});
 const [resumed]=await ipc(app,"debug_start_mobile_asset_server");context=await launch();page=await context.newPage();
 // Outside worker scope: a cached offline shell is independent of certificate trust.
 await assert.rejects(page.goto(resumed.origin+"/uncached-trust-check",{timeout:10000}),/SEC_ERROR_UNKNOWN_ISSUER|SSL_ERROR|certificate/i);pass("Removing profile root trust rejects new HTTPS after browser restart");
 await writeFile(path.join(output,"trusted-firefox-results.json"),JSON.stringify({version,checks,certificateTrust:"Copied browser NSS library imports/removes trust in disposable profile only; OS trust untouched",directory,output},null,2));
 console.log(JSON.stringify({version,checks:checks.length,passed:checks,output},null,2));
}catch(error){if(page)console.error("Trusted browser diagnostic:",await page.locator("body").innerText().catch(()=>"Unavailable"));throw error;}finally{if(context)await context.close();await app.close();}
