import assert from 'node:assert/strict';
import {launchApp} from './harness.mjs';
import {seedFixture} from './lib/seed.mjs';
import {askHelpers} from './lib/askRetirement.mjs';
const names=['QA First','QA Second'];
const dbDir=await seedFixture(`
import datetime
today=datetime.date.today()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Checking','checking','1000.00')")
account=cur.lastrowid
for name in ['QA First','QA Second']:
    cur.execute('INSERT OR IGNORE INTO categories(name) VALUES(?)',(name,))
    for back in [2,1]:
        index=today.year*12+today.month-1-back;y,m=divmod(index,12)
        cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,'-100.00',?,'user',?)",(account,datetime.date(y,m+1,1).isoformat(),name,name,f'{name}-{back}'))
cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,'QA Current Marker','0.00','QA First','user','currentmarker')",(account,today.isoformat()))
`);
const app=await launchApp({dbDir}),b=app.browser,h=askHelpers(b);
const selectManual=async()=>{
 for(const [i,name]of names.entries()){
  await (await h.dialog()).$(`label*=Enter my own usual month for ${name}`).click();
  await b.$(`input[aria-label="${name} usual month"]`).setValue(String((i+1)*10));
 }
};
const readRows=()=>b.execute(()=>[...document.querySelectorAll('.cut-preview-results tbody tr')].map(r=>[...r.cells].map(c=>c.innerText.trim())));
try{
 await b.setWindowSize(1280,900);await h.openDashboard();await h.ask('Where can I cut back to save $100 a month?');await h.waitText('Choose up to 20 categories','choices');
 for(const name of names){await b.$(`input[aria-label="Select ${name}"]`).click();await h.clickButton(`Allow up to 100% with floor $0 for ${name}`);}
 await (await h.dialog()).$('label*=The whole of').click();await h.clickButton('Review the details');await h.waitText('Check every detail','review');
 assert.equal(await (await h.dialog()).$('button=Show the preview').isEnabled(),false,'short history needs a deliberate decision');
 await selectManual();await h.clickButton('Show the preview');await h.waitText('Your savings target preview','result');
 assert.deepEqual(await readRows(),[['QA First','$10.00','$10.00','$0.00'],['QA Second','$20.00','$20.00','$0.00']]);
 let text=await h.text();assert.ok(text.includes('Achievable: $30.00 per month'));assert.ok(text.includes('Maximum: $30.00 per month'));assert.ok(text.includes('Shortfall: $70.00 per month'));assert.ok(text.includes('$360.00 across the selected dates'));
 await h.clickButton('Change the details');await h.waitText('Choose up to 20 categories','edited choices');assert.equal(await b.$('.cut-preview-results').isExisting(),false,'the old result is retired before edits');
 for(const [i,name]of names.entries())await b.$(`input[aria-label="${name} monthly floor"]`).setValue(String((i+1)*10));
 await h.clickButton('Review the details');await h.waitText('Check every detail','new review');await selectManual();await h.clickButton('Show the preview');await h.waitText('Your savings target preview','zero-capacity result');
 assert.deepEqual(await readRows(),[['QA First','$0.00','$0.00','$10.00'],['QA Second','$0.00','$0.00','$20.00']]);
 text=await h.text();assert.ok(text.includes('Achievable: $0.00 per month'));assert.ok(text.includes('Maximum: $0.00 per month'));assert.ok(text.includes('Shortfall: $100.00 per month'));assert.ok(text.includes('$0.00 across the selected dates'));
 console.log('FEATURE 325 PASSED: explicit short-history/manual choice, exact30 maximum/70 shortfall, editing retires results, zero capacity/full100 shortfall.');
}finally{await app.close();}
