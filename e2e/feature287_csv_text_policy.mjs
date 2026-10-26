// Actual compiled export + independent CSV parser + production import preview.
// Inert arithmetic only: no external links, DDE or executable formulas.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchApp } from './harness.mjs';
import { seedFixture } from './lib/seed.mjs';
import { makeTempDir } from './lib/tempDir.mjs';
import { dateInMonth } from './lib/dates.mjs';
const date=dateInMonth(0,1);
const corpus=JSON.parse(fs.readFileSync(new URL('../src/testSupport/csvCorpus.json',import.meta.url),'utf8'));
const fixture=corpus.map((c,i)=>({...c,amount:i===0?'-9007199254740992.01':'-50.25',note:i===17?'Receipt, "verified"\nCafé follow-up':'Ordinary note'}));
const dbDir=await seedFixture(`
import json
rows=json.loads(${JSON.stringify(JSON.stringify(fixture))})
cur.execute("INSERT INTO accounts (name,account_type,starting_balance) VALUES ('Café Checking','checking','0')")
account=cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Café Category')")
for i,row in enumerate(rows):
    cur.execute("INSERT INTO transactions (account_id,date,description,amount,category,category_source,fingerprint,notes) VALUES (?, ?, ?, ?, 'Café Category','user',?,?)",(account,${JSON.stringify(date)},row['value'],row['amount'],'csv-policy-'+str(i),row['note']))
    cur.execute("INSERT INTO transaction_tags (transaction_id,tag) VALUES (?, 'Café tag')",(cur.lastrowid,))
`);
const exportDir=makeTempDir('vaultspend-csv-policy-');const csvPath=path.join(exportDir,'corpus.csv');
const app=await launchApp({dbDir});const b=app.browser;
async function call(command,args={}){const r=await b.executeAsync((c,a,done)=>window.__TAURI_INTERNALS__.invoke(c,a).then(value=>done({value}),error=>done({error:String(error)})),command,args);assert.equal(r.error,undefined,`${command}: ${r.error}`);return r.value;}
try{
 await b.$('button[aria-label="Transactions"]').click();await b.$('table.ledger').waitForExist({timeout:15000});
 // Guarded save-picker stub, scoped to this spec; all file writing remains real backend IPC.
 await b.execute(p=>{
  const original=window.fetch;window.__csvIpcSeen=0;
  window.fetch=function(input,...rest){const url=decodeURIComponent(String(typeof input==='string'?input:input.url));
   if(!url.includes('ipc.localhost'))return original.call(window,input,...rest);
   window.__csvIpcSeen++;
   if(url.endsWith('plugin:dialog|save'))return Promise.resolve(new Response(JSON.stringify(p),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}}));
   const attempt=left=>original.call(window,input,...rest).catch(e=>left?new Promise(r=>setTimeout(r,150)).then(()=>attempt(left-1)):Promise.reject(e));return attempt(5);
  };
 },csvPath);
 await call('list_accounts');assert.ok(await b.execute(()=>window.__csvIpcSeen>0),'refuse to open an uncontrolled OS picker');
 await b.$('.more-menu button').click();await b.$('button*=Export CSV').click();
 await b.waitUntil(()=>fs.existsSync(csvPath),{timeout:15000});
 const parsed=JSON.parse(execFileSync('python',['-c','import csv,json,sys; print(json.dumps(list(csv.reader(open(sys.argv[1], encoding="utf-8-sig", newline=""))), ensure_ascii=True))',csvPath],{encoding:'utf8',windowsHide:true}));
 assert.deepEqual(parsed[0],['Date','Description','Amount','Account','Category','Tags','Notes']);assert.equal(parsed.length,fixture.length+1);
 for(const row of fixture){const expected=row.prefixed?`'${row.value}`:row.value;const found=parsed.slice(1).find(r=>r[1]===expected&&r[2]===row.amount&&r[6]===row.note);assert.deepEqual(found,[date,expected,row.amount,'Café Checking','Café Category','Café tag',row.note]);}
 const accountId=(await call('list_accounts'))[0].id;
 const preview=await call('preview_import',{path:csvPath,invertAmounts:false,accountId});
 const ordinary=preview.rows.find(r=>r.description==='Café Résumé — imported vendor');
 assert.ok(ordinary,'ordinary Unicode descriptions survive production import');
 assert.equal(ordinary.amount,'-50.25');assert.equal(ordinary.category,'Café Category');
 assert.ok(preview.rows.some(r=>r.description==="'=1+1"),'prefix stays as literal data on import');
 const priorIds=new Set((await call('list_transactions')).map(t=>t.id));
 const precise=preview.rows.find(r=>r.amount==='-9007199254740992.01');assert.ok(precise);
 await call('commit_import',{path:csvPath,invertAmounts:false,defaultAccountId:accountId,reviewToken:preview.review_token,includedIndices:[ordinary.index,precise.index],accountOverrides:{},categoryChoices:{},rowChoices:{}});
 const imported=(await call('list_transactions')).filter(t=>!priorIds.has(t.id));assert.equal(imported.length,2);
 const ordinaryImported=imported.find(t=>t.description===ordinary.description);assert.ok(ordinaryImported);
 assert.equal(ordinaryImported.date,date);assert.equal(ordinaryImported.amount,'-50.25');assert.equal(ordinaryImported.account_name,'Café Checking');assert.equal(ordinaryImported.category,'Café Category');
 assert.deepEqual(ordinaryImported.tags,['Café tag']);assert.equal(ordinaryImported.notes,'Receipt, "verified"\nCafé follow-up');
 const preciseImported=imported.find(t=>t.description==="'=1+1");assert.ok(preciseImported);assert.equal(preciseImported.amount,'-9007199254740992.01');
 if(process.env.VAULTSPEND_CSV_POLICY_OUTPUT){fs.mkdirSync(process.env.VAULTSPEND_CSV_POLICY_OUTPUT,{recursive:true});fs.copyFileSync(csvPath,path.join(process.env.VAULTSPEND_CSV_POLICY_OUTPUT,'compiled-export.csv'));fs.writeFileSync(path.join(process.env.VAULTSPEND_CSV_POLICY_OUTPUT,'parsed-export.json'),JSON.stringify(parsed,null,2));fs.writeFileSync(path.join(process.env.VAULTSPEND_CSV_POLICY_OUTPUT,'import-preview.json'),JSON.stringify(preview,null,2));fs.writeFileSync(path.join(process.env.VAULTSPEND_CSV_POLICY_OUTPUT,'imported-round-trip.json'),JSON.stringify(imported,null,2));}
 console.log('FEATURE 287 PASSED: compiled typed export, 22 inert rows, exact CSV structure/text/amounts and production import round trip');
}finally{await app.close();}
