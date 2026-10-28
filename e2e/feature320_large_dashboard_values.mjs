// QA-UI-001: exact very large values stay within their tiles across affected palettes/modes/widths.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
const dbDir=await seedFixture(`cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Big Checking','checking','-9999999002.99')")`);
const app=await launchApp({dbDir});
const shots=process.env.VS_QA_COMPLETION_SHOTS;if(shots)fs.mkdirSync(shots,{recursive:true});
try {
 const b=app.browser;
 for(const [label,palette] of [["Default","transparent"],["Futuristic","futuristic"],["Retro","retro"]]) {
  await chooseStyle(b,label,palette);
  for(const theme of ["light","dark"]) {
   await b.$(`//div[contains(@class,"theme-toggle")]//button[normalize-space()="${theme==="light"?"Light":"Dark"}"]`).click();
   await b.waitUntil(()=>b.execute(t=>document.documentElement.dataset.theme===t,theme),{timeout:5000});
   await b.$('.nav-item[aria-label="Dashboard"]').click();
   for(const width of [720,960,1280]) {
    await b.setWindowSize(width,900);
    await b.waitUntil(()=>b.execute(()=>document.getAnimations().every(a=>!(a.pending||a.playState==='running')||a.effect?.getComputedTiming?.().iterations===Infinity)),{timeout:3000,timeoutMsg:"finite page transitions settle before checking actual tile geometry"});
    await b.executeAsync(done=>document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    await waitUntilOrDiagnose(b,()=>b.execute(()=>[...document.querySelectorAll('.dashboard-stat-row .stat-value')].filter(e=>e.textContent==='-$9,999,999,002.99').length===2),{timeout:10000,timeoutMsg:"Net worth and Cash retain the full exact value"});
    const geometry=await b.execute(()=>[...document.querySelectorAll('.dashboard-stat-row .stat-value')].filter(e=>e.textContent==='-$9,999,999,002.99').map(e=>{const tile=e.closest('.stat').getBoundingClientRect();const r=document.createRange();r.selectNodeContents(e);return {text:e.textContent,tile:{left:tile.left,right:tile.right,top:tile.top,bottom:tile.bottom},lines:[...r.getClientRects()].map(x=>({left:x.left,right:x.right,top:x.top,bottom:x.bottom}))};}));
    assert.equal(geometry.length,2);
    for(const value of geometry)for(const line of value.lines)assert.ok(line.left>=value.tile.left-1&&line.right<=value.tile.right+1&&line.top>=value.tile.top-1&&line.bottom<=value.tile.bottom+1,JSON.stringify({palette,theme,width,value}));
    if(shots)await b.saveScreenshot(path.join(shots,`feature320-${palette}-${theme}-${width}.png`));
   }
  }
 }
 console.log("FEATURE 320 PASSED: 18 actual rendered tile configurations; no exact amount hidden, clipped or replaced by an abbreviation.");
} finally {await app.close();}
