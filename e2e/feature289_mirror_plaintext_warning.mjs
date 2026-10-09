// Regression: retain only mirror originals, rediscover on Settings remount/restart,
// and explicitly delete only known plaintext while the active encrypted pair survives.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, dismissFirstLaunchDialogs } from './harness.mjs';
import { enableProtectionThroughUI, seedPopulatedProfile } from './lib/protection.mjs';
import { freshTestDbDir } from './lib/seed.mjs';
import { makeTempDir } from './lib/tempDir.mjs';
const dbDir=freshTestDbDir();await seedPopulatedProfile(dbDir);
const mirrorRoot=makeTempDir('vaultspend-plaintext-mirror-');const mirror=path.join(mirrorRoot,'live');const offlineMirror=path.join(mirrorRoot,'offline');fs.mkdirSync(mirror);
function moveMirror(from,to){for(const target of [from,to])assert.ok(path.resolve(target).startsWith(path.resolve(mirrorRoot)+path.sep),'move stays within the owned fixture root');fs.renameSync(from,to);}
const password='correct horse battery staple';
const regionSelector='[role="region"][aria-label="Leftover plaintext files"]';
const shots=process.env.VAULTSPEND_PLAINTEXT_UI_OUTPUT;const geometry=[];
async function inspectThemes(b,state){
 for(const width of [1280,800]){await b.setWindowSize(width,800);for(const palette of ['transparent','retro','futuristic'])for(const theme of ['light','dark']){
  await b.execute((p,t)=>{document.documentElement.dataset.palette=p;document.documentElement.dataset.theme=t;},palette,theme);
  await b.executeAsync(done=>document.fonts.ready.then(()=>done(true)));
  await b.execute(selector=>document.querySelector(selector).scrollIntoView({block:'center'}),regionSelector);
  const metrics=await b.execute(selector=>{
   const region=document.querySelector(selector),box=region.getBoundingClientRect();const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
   return{card:rect(region),scrollWidth:region.scrollWidth,clientWidth:region.clientWidth,buttons:[...region.querySelectorAll('button')].map(e=>({text:e.textContent,...rect(e)})),colors:{text:getComputedStyle(region).color,background:getComputedStyle(region).backgroundColor},contained:[...region.querySelectorAll('button,input')].every(e=>{const r=e.getBoundingClientRect();return r.left>=box.left-1&&r.right<=box.right+1;})};
  },regionSelector);
  geometry.push({state,width,palette,theme,...metrics});
  if(shots){fs.mkdirSync(shots,{recursive:true});fs.writeFileSync(path.join(shots,'geometry.json'),JSON.stringify(geometry,null,2));}
  assert.ok(metrics.contained,`${state}/${width}/${palette}/${theme}: controls fit their card`);assert.ok(metrics.scrollWidth<=metrics.clientWidth+1,`${state}/${width}/${palette}/${theme}: no horizontal overflow`);
  for(const button of metrics.buttons)assert.ok(button.height>0&&button.width>0,'actions remain visible');
  for(let i=0;i<metrics.buttons.length;i++)for(let j=i+1;j<metrics.buttons.length;j++){const a=metrics.buttons[i],c=metrics.buttons[j];assert.ok(a.right<=c.x+1||c.right<=a.x+1||a.bottom<=c.y+1||c.bottom<=a.y+1,'action buttons do not overlap');}
  if(shots){fs.mkdirSync(shots,{recursive:true});await b.saveScreenshot(path.join(shots,`${state}-${width}-${palette}-${theme}.png`));}
 }}
 await b.setWindowSize(1280,800);
 if(shots)fs.writeFileSync(path.join(shots,'geometry.json'),JSON.stringify(geometry,null,2));
}
async function call(b,command,args={}){const r=await b.executeAsync((c,a,done)=>window.__TAURI_INTERNALS__.invoke(c,a).then(value=>done({value}),error=>done({error:String(error)})),command,args);assert.equal(r.error,undefined,`${command}: ${r.error}`);return r.value;}
async function settings(b){await b.$('button[aria-label="Settings"]').click();await b.$('[data-data-file]').waitForExist({timeout:10000});}
let app=await launchApp({dbDir});let live;
try {
 const b=app.browser;await call(b,'set_backup_copy_dir',{dir:mirror});
 await settings(b);await enableProtectionThroughUI(b,password);
 await b.$(regionSelector).waitForExist({timeout:10000});
 await b.waitUntil(()=>b.$('button=Delete plaintext copies now').isEnabled(),{timeout:10000});
 live=await call(b,'get_data_file_location');
 await b.$('button=Delete plaintext copies now').click();
 await b.waitUntil(()=>!fs.existsSync(path.join(dbDir,'vaultspend.db')),{timeout:10000});
 await b.waitUntil(async()=>await b.$(regionSelector).isExisting()&&/Local plaintext copies: 0/.test(await b.$(regionSelector).getText()),{timeout:10000,timeoutMsg:'mirror-only plaintext warning must remain visible after local deletion'});
 assert.ok(fs.readdirSync(mirror).some(f=>f.endsWith('.db')),'mirror copies remain on disk');
 assert.equal(await (await b.$(regionSelector)).$('button=Delete plaintext copies now').isEnabled(),false);
 await inspectThemes(b,'mirror-only');
 moveMirror(mirror,offlineMirror);
 await b.$('button[aria-label="Transactions"]').click();await settings(b);
 await b.waitUntil(async()=>/Cleanup status could not be checked/.test(await b.$(regionSelector).getText()),{timeout:10000});
 assert.equal(await (await b.$(regionSelector)).$('button=Delete plaintext copies now').isEnabled(),false);
 await inspectThemes(b,'discovery-error');
 moveMirror(offlineMirror,mirror);await b.$('button=Retry cleanup check').click();
 await b.waitUntil(async()=>/Second-folder copies: [1-9]/.test(await b.$(regionSelector).getText()),{timeout:10000});
 await b.$('button=Keep for now').click();
 await b.$('button[aria-label="Transactions"]').click();await settings(b);
 await b.$(regionSelector).waitForExist({timeout:10000});
}finally{await app.close();}
app=await launchApp({dbDir,ready:'[data-profile-selector]'});
try{
 const b=app.browser;await b.$('[data-profile-option]').click();await b.$('#password-form-field').setValue(password);await b.$('button[type="submit"]').click();await b.$('.brand-word').waitForExist({timeout:15000});await dismissFirstLaunchDialogs(b);await settings(b);
 await b.$(regionSelector).waitForExist({timeout:10000});await b.waitUntil(async()=>/Second-folder copies: [1-9]/.test(await b.$(regionSelector).getText()),{timeout:10000});
 const generation=await call(b,'get_current_generation');const profileId=(await call(b,'list_profiles')).find(p=>p.is_active).id;
 for(const origin of [{expectedProfileId:profileId,expectedGeneration:generation-1},{expectedProfileId:'wrong-profile',expectedGeneration:generation}]){
  const result=await b.executeAsync((args,done)=>window.__TAURI_INTERNALS__.invoke('delete_protection_leftovers',args).then(value=>done({value}),error=>done({error:String(error)})),{pathsToDelete:fs.readdirSync(mirror).filter(f=>f.endsWith('.db')).map(f=>path.join(mirror,f)),...origin});
  assert.match(result.error??'',/active profile changed/,'stale cleanup identity must be refused');
  assert.ok(fs.readdirSync(mirror).some(f=>f.endsWith('.db')),'refused cleanup must not remove files');
 }
 await b.$(`${regionSelector} input[type="checkbox"]`).click();await b.$('button=Delete plaintext copies now').click();
 await b.waitUntil(async()=>!(await b.$(regionSelector).isExisting()),{timeout:10000});
 assert.ok(!fs.readdirSync(mirror).some(f=>f.endsWith('.db')&&!fs.existsSync(path.join(mirror,f+'.key'))),'no plaintext mirror DB remains');
 assert.ok(fs.existsSync(live),'active encrypted DB survives');
 assert.ok(fs.existsSync(live+'.key'),'active key survives');
 assert.ok((await call(b,'list_transactions')).length>0,'financial data remains readable after cleanup');
 console.log('FEATURE 289 PASSED: mirror-only warning, discovery error/retry, 24 theme/width geometry checks, remount/restart, stale cleanup refusal and active-pair preservation');
}finally{await app.close();}
