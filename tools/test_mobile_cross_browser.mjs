// Native browser engines with synthetic, ingress-validated snapshots. HTTP loopback only:
// this tests UI/storage/worker compatibility, not TLS or phone/home-screen trust.
import assert from "node:assert/strict";
import { readFile,mkdir,writeFile,mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { chromium,firefox,webkit } from "playwright";
import { makeTempDir } from "../e2e/lib/tempDir.mjs";
const root=path.resolve("dist-mobile-test"),output=process.env.VAULTSPEND_MOBILE_TASK8_OUTPUT??path.join(os.tmpdir(),"vault-mobile-task8-browsers");await mkdir(output,{recursive:true});
const fixture=JSON.parse(await readFile("core/tests/fixtures/mobile_snapshot_v1.json","utf8"));fixture.profile.name="Browser acceptance household";
const second={...fixture,profile:{...fixture.profile,id:"second-profile",name:"Browser acceptance personal"}};
const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".woff":"font/woff",".woff2":"font/woff2",".webmanifest":"application/manifest+json",".png":"image/png"};
let networkDown=false;
const server=createServer(async(req,res)=>{if(networkDown){res.destroy();return;}try{const route=new URL(req.url,"http://localhost").pathname,file=path.resolve(root,"."+route);assert.ok(file.startsWith(root+path.sep));const body=await readFile(file);res.writeHead(200,{"Content-Type":mime[path.extname(file)]??"application/octet-stream","Cache-Control":"no-store"});res.end(body);}catch{res.writeHead(404);res.end("Not found");}});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const url=`http://127.0.0.1:${server.address().port}/mobile/storage-test.html`,results=[];
try{
 for(const engine of [chromium,firefox,webkit]){
  const profile=makeTempDir(`vault-mobile-task8-${engine.name()}-`);
  const context=await engine.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},hasTouch:true,ignoreHTTPSErrors:false}),browser=context.browser(),page=await context.newPage();
  const result={engine:engine.name(),version:browser.version(),checks:[],offlineReopen:null};results.push(result);
  const pass=label=>{result.checks.push(label);console.log(`PASS ${engine.name()} ${label}`);};
  const menu=async(label,value)=>{const trigger=page.getByRole("button",{name:new RegExp(`^${label}:`)});await trigger.click();await page.locator(`[role=menuitemradio][data-value="${value}"]`).click();await page.waitForFunction(({label,value})=>[...document.querySelectorAll("button")].some(b=>b.getAttribute("aria-label")?.startsWith(label+":")&&b.dataset.value===value),{label,value});};
  const fit=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,"No horizontal page overflow");
  try{
   await page.goto(url);await page.waitForFunction(()=>!!window.mobileStorageProbe);
   for(const snapshot of [fixture,second])await page.evaluate(snapshot=>window.mobileStorageProbe.replace(JSON.stringify(snapshot),{installationId:snapshot.installationId,profileId:snapshot.profile.id,epoch:snapshot.epoch}),snapshot);
   await page.locator(".mobile-snapshot-status").waitFor();await page.waitForFunction(()=>document.body.textContent.includes("Ready offline"));pass("Native encrypted snapshots and completed offline shell");
   assert.equal(await page.getByRole("button",{name:"Pair this phone",exact:true}).count(),0);assert.equal(await page.locator(".mobile-sync").count(),0);pass("Overview omits connection and detailed snapshot controls");
   assert.equal(await page.evaluate(()=>document.querySelectorAll("select").length),0);pass("No native dropdowns");
   for(const width of [320,360,390,430,768]){await page.setViewportSize({width,height:844});for(const tab of ["Overview","Accounts","Budget","Reports","Calculators","Settings"]){await page.getByRole("button",{name:tab,exact:true}).click();await fit();}pass(`All six tabs fit ${width}px`);}
   await page.setViewportSize({width:390,height:844});await page.getByRole("button",{name:"Reports",exact:true}).click();
   for(const range of ["3","6","12","year_to_date","last_month","current_month","custom"]){await menu("Report range",range);await fit();}pass("All seven report periods and custom controls");
   await menu("Report range","12");await page.locator(".mobile-chart button").first().tap();assert.ok(await page.locator(".mobile-month-detail").textContent());pass("Touch selects month detail");
   const chart=page.locator(".mobile-chart button").last();await chart.focus();await page.keyboard.press("Enter");assert.equal(await chart.getAttribute("aria-pressed"),"true");pass("Keyboard selects month detail");
   await page.locator(".mobile-chart button").first().locator(":scope > span").last().tap();assert.equal(await page.locator(".mobile-chart button").first().getAttribute("aria-pressed"),"true");pass("Touch on month label selects the correct detail");
   await page.getByRole("button",{name:"Settings",exact:true}).click();
   for(const palette of ["transparent","futuristic","retro"])for(const mode of ["light","dark"]){
    await page.getByRole("button",{name:"Settings",exact:true}).click();await menu("Theme",palette);await menu("Color mode",mode);await page.waitForFunction(({palette,mode})=>document.documentElement.dataset.palette===palette&&document.documentElement.dataset.theme===mode,{palette,mode});await page.evaluate(()=>document.documentElement.dataset.motion="reduced");
    await page.getByRole("button",{name:"Reports",exact:true}).click();await page.getByRole("button",{name:/^Report range:/}).click();
    const clipping=await page.locator('[role="menu"]').filter({visible:true}).evaluate(menu=>{const box=menu.getBoundingClientRect();return box.left>=-1&&box.right<=innerWidth+1&&box.top>=-1&&box.bottom<=innerHeight+1;});assert.equal(clipping,true);
    await page.keyboard.press("Escape");assert.equal(await page.getByRole("button",{name:/^Report range:/}).evaluate(el=>el===document.activeElement),true);
    await page.addScriptTag({path:path.resolve("node_modules/axe-core/axe.min.js")});const violations=await page.evaluate(()=>window.axe.run({runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}}).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));assert.deepEqual(violations,[]);
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    await page.addScriptTag({path:path.resolve("node_modules/axe-core/axe.min.js")});assert.deepEqual(await page.evaluate(()=>window.axe.run({runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}}).then(r=>r.violations.map(v=>v.id))),[]);
    await page.screenshot({path:path.join(output,engine.name()+"-"+palette+"-"+mode+"-settings.png")});
    const connection=page.locator(".mobile-connection-options");
    if(!await connection.evaluate(e=>e.open))await connection.locator("summary").click();
    await page.getByRole("button",{name:"Pair this phone",exact:true}).click();
    const inputStyle=await page.getByRole("textbox",{name:"Phone name",exact:true}).evaluate(e=>({appearance:getComputedStyle(e).appearance,size:parseFloat(getComputedStyle(e).fontSize)}));
    assert.equal(inputStyle.appearance,"none");assert.ok(inputStyle.size>=16);
    await page.getByRole("button",{name:"Pair this phone",exact:true}).click();
    await page.getByRole("button",{name:"Remove saved profile",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"Remove this saved profile?"});
    await dialog.waitFor();
    const geometry=await dialog.locator("button").evaluateAll(buttons=>buttons.map(e=>{const r=e.getBoundingClientRect(),style=getComputedStyle(e);return {top:r.top,width:r.width,height:r.height,appearance:style.appearance,bg:style.backgroundColor};}));
    assert.equal(geometry.length,2);assert.ok(Math.abs(geometry[0].top-geometry[1].top)<1);assert.ok(Math.abs(geometry[0].width-geometry[1].width)<1);assert.ok(geometry.every(b=>b.height>=44&&b.appearance==="none"));
    assert.deepEqual(await page.evaluate(()=>window.axe.run(document.querySelector("dialog[open]"),{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}}).then(r=>r.violations.map(v=>v.id))),[]);
    await page.screenshot({path:path.join(output,`${engine.name()}-${palette}-${mode}-dialog.png`)});
    await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
    await page.getByRole("button",{name:"Calculators",exact:true}).click();await menu("Calculator","debt");
    const checkbox=page.locator('.mobile-check input[type=checkbox]').first();
    if(await checkbox.count()){
      assert.equal(await checkbox.evaluate(e=>getComputedStyle(e).appearance),"none");
      await checkbox.check();assert.ok(await checkbox.isChecked());await checkbox.uncheck();assert.equal(await checkbox.isChecked(),false);
    }
    await menu("Calculator","accumulation");
    assert.equal(await page.locator('input[type=month],input[type=date],select').count(),0);
    await page.setViewportSize({width:320,height:844});
    const geometryAtResize=await page.locator(".mobile-month-field").evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scrollWidth:document.documentElement.scrollWidth};});
    if(geometryAtResize.left< -1||geometryAtResize.right>geometryAtResize.width+1)console.log("Withdrawal picker resize geometry",engine.name(),palette,mode,geometryAtResize);
    await page.waitForFunction(()=>{const r=document.querySelector(".mobile-month-field").getBoundingClientRect();return innerWidth===320&&r.left>=-1&&r.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth+1;},null,{timeout:10000});
    await page.screenshot({path:path.join(output,`${engine.name()}-${palette}-${mode}-calculator.png`)});
    await page.setViewportSize({width:390,height:844});
    await page.getByRole("button",{name:"Reports",exact:true}).click();
    pass(`${palette}/${mode} pairing fields, themed dialog, aligned actions and custom checkbox`);
    await page.screenshot({path:path.join(output,`${engine.name()}-${palette}-${mode}.png`)});pass(`${palette}/${mode} menu containment, focus restoration and accessibility`);
   }
   await page.getByRole("button",{name:"Hide amounts",exact:true}).click();assert.equal(await page.locator(".mobile-chart button").first().getAttribute("aria-label").then(text=>text.includes("$")),false);pass("Privacy conceals chart values");
   await menu("Profile",`${second.installationId}/${second.profile.id}`);await page.getByRole("button",{name:"Accounts",exact:true}).click();pass("Independent saved profile selection");
   await page.waitForFunction(async()=>{const data=await window.mobileStorageProbe.load();return data.active?.endsWith("/second-profile");});
   assert.equal(await page.evaluate(()=>localStorage.getItem("vault-mobile-palette")),"retro");
   networkDown=true;await page.reload();await page.locator(".mobile-snapshot-status").waitFor({timeout:10000});await page.waitForFunction(()=>document.documentElement.dataset.palette==="retro");result.offlineReopen=true;pass("Offline reload preserves encrypted data and theme");
   await page.getByRole("button",{name:"Reports",exact:true}).click();await page.locator(".mobile-chart button").first().click();await page.getByRole("button",{name:"Calculators",exact:true}).click();pass("Offline reports and calculators remain usable");
  }catch(error){console.error(engine.name(),"browser state",await page.evaluate(()=>({url:location.href,theme:document.documentElement.dataset.palette,savedTheme:localStorage.getItem("vault-mobile-palette"),keys:Object.keys(localStorage),body:document.body.textContent.slice(0,600)})).catch(()=>null));result.error=error.message;await page.screenshot({path:path.join(output,`${engine.name()}-failure.png`)}).catch(()=>undefined);throw error;}
  finally{networkDown=false;await context.close();await writeFile(path.join(output,"results.json"),JSON.stringify(results,null,2));}
 }
 console.log(JSON.stringify({results,output},null,2));
}finally{await new Promise(resolve=>server.close(resolve));}
