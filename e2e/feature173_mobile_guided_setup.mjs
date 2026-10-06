// Compiled guided controls and certificate-only bootstrap; loopback fixtures only.
import assert from "node:assert/strict";
import {readFile,mkdir} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import os from "node:os";
import {chromium,firefox,webkit} from "playwright";
import {launchApp,waitUntilOrDiagnose} from "./harness.mjs";
import {ipc} from "./mobileHttpsHarness.mjs";
const app=await launchApp();
const output=process.env.VAULTSPEND_MOBILE_GUIDED_OUTPUT??path.join(os.tmpdir(),"vault-mobile-guided-setup");
await mkdir(output,{recursive:true});
let engine;
try{
 await (await app.browser.$("button*=Settings")).click();await app.browser.$("[data-mobile-settings]").waitForExist({timeout:5000});
 await app.browser.execute(()=>[...document.querySelectorAll("[data-mobile-settings] button")].find(b=>b.textContent==="Set up a phone").click());
 await app.browser.$(".mobile-setup-wizard").waitForExist({timeout:5000});
 // Existence can precede readable text during the shared overlay entrance animation.
 // Wait for the actual initial instructions; a persistent wrong/empty screen still fails.
 await waitUntilOrDiagnose(app.browser,async()=>{
  const text=await app.browser.$(".mobile-setup-wizard").getText();
  return text.includes("On your computer")&&text.includes("Take your balances with you");
 },{timeout:5000,timeoutMsg:"the guide must show readable initial computer instructions",
 extra:async()=>({wizard:await app.browser.$(".mobile-setup-wizard").getText()})});
 assert.equal(await ipc(app,"mobile_saved_config"),null);
 const axe=await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"),"utf8");
 await app.browser.execute(axe);
 const original=await app.browser.execute(()=>({palette:document.documentElement.dataset.palette,theme:document.documentElement.dataset.theme,motion:document.documentElement.dataset.motion}));
 await app.browser.execute(()=>{document.documentElement.dataset.motion="reduced";});
 for(const palette of ["transparent","futuristic","retro"])for(const theme of ["light","dark"]){
  await app.browser.execute((palette,theme)=>{document.documentElement.dataset.palette=palette;document.documentElement.dataset.theme=theme;},palette,theme);
  const violations=await app.browser.executeAsync(done=>window.axe.run(document.querySelector('[role="dialog"]'),{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}}).then(r=>done(r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})))));
  assert.deepEqual(violations,[],palette+"/"+theme);
  await app.browser.saveScreenshot(path.join(output,"wizard-"+palette+"-"+theme+".png"));
 }
 await app.browser.execute(original=>{for(const [k,v]of Object.entries(original))if(v)document.documentElement.dataset[k]=v;else delete document.documentElement.dataset[k];},original);
 await app.browser.execute(()=>[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent==="Close guide").click());await app.browser.$(".mobile-setup-wizard").waitForExist({reverse:true,timeout:5000});
 const [,certificate]=await ipc(app,"debug_start_mobile_asset_server");
 const setup=await ipc(app,"debug_start_mobile_setup_server");
 const response=await fetch(setup.url+"certificate.crt");assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");assert.equal(await response.text(),certificate.pem);
 const profile=await fetch(setup.url+"certificate.mobileconfig");assert.equal(profile.status,200);assert.ok((await profile.text()).includes("com.apple.security.root"));
 for(const route of ["api/status","api/snapshot","../certificate.crt","private-key.pem"]){assert.equal((await fetch(setup.url+route)).status,404);}
 assert.equal((await fetch(setup.url+"certificate.crt",{method:"POST"})).status,404);
 assert.equal((await fetch(setup.url,{headers:{Origin:"http://evil.local"}})).status,404);
 for(const [name,type]of Object.entries({chromium,firefox,webkit})){
  engine=await type.launch({headless:true});
  const page=await engine.newPage({viewport:{width:360,height:800}});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(setup.url);
  for(const platform of ["ios","android"]){
   await page.locator("#"+platform).click();let count=0;
   while(count<9){
    const title=await page.locator("#guide h2").innerText();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+" "+title);
    if(await page.locator("#verified").count()){assert.equal(await page.locator("#next").isDisabled(),true);await page.locator("#verified").check();}
    if(title==="Open the secure viewer")break;
    await page.locator("#next").click();count++;
   }
   assert.ok(count<9);
  }
  await page.locator(".appearance > summary").click();
  await page.evaluate(await readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"),"utf8"));
  for(const palette of ["transparent","futuristic","retro"])for(const mode of ["light","dark"]){
   await page.locator(`[data-palette-choice="${palette}"]`).click();await page.locator(`[data-mode-choice="${mode}"]`).click();
   await page.locator("#ios").click();await page.locator("#next").click();await page.locator("#next").click();
   await page.locator("#verified").check();
   assert.equal(await page.locator("#verified").evaluate(e=>getComputedStyle(e).appearance),"none");
   const buttons=await page.locator(".actions button").evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return {top:r.top,height:r.height,right:r.right,fits:r.right<=innerWidth};}));
   assert.ok(Math.abs(buttons[0].top-buttons[1].top)<1&&buttons.every(b=>b.height>=44&&b.fits));
   assert.deepEqual(await page.evaluate(()=>window.axe.run({runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}}).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))),[],`${name} setup ${palette}/${mode}`);
   await page.screenshot({path:path.join(output,`phone-${name}-${palette}-${mode}.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(output,"phone-"+name+".png"),fullPage:true});
  await engine.close();engine=null;
 }
 await ipc(app,"mobile_cancel_setup");
 await assert.rejects(fetch(setup.url+"certificate.crt"));
 assert.equal(await ipc(app,"mobile_setup_status"),null);
 assert.equal(await ipc(app,"mobile_saved_config"),null);
 console.log("PASS guided opt-in desktop UI/six themes/Axe; actual public root/profile download; HTTP route isolation/cancel; three-engine 360px phone instructions. No LAN/OS trust/phone acceptance.");
}finally{if(engine)await engine.close();await app.close();}
