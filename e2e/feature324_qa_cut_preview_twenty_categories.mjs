import assert from 'node:assert/strict';
import {launchApp,waitUntilOrDiagnose} from './harness.mjs';
import {seedFixture} from './lib/seed.mjs';
import {askHelpers} from './lib/askRetirement.mjs';
const dbDir=await seedFixture(`
import datetime
today=datetime.date.today()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Checking','checking','10000.00')")
account=cur.lastrowid
for i in range(1,22):
    name=f'QQ{i:02}'
    cur.execute('INSERT OR IGNORE INTO categories(name) VALUES(?)',(name,))
    if i<=20:
        for back in [3,2,1]:
            index=today.year*12+today.month-1-back;y,m=divmod(index,12)
            date=datetime.date(y,m+1,15).isoformat()
            cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,'-100.00',?,'user',?)",(account,date,name,name,f'{name}-{back}'))
for back in [4,0]:
    index=today.year*12+today.month-1-back;y,m=divmod(index,12)
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,'QA Coverage','0.00','QQ01','user',?)",(account,datetime.date(y,m+1,1).isoformat(),f'coverage-{back}'))
`);
const app=await launchApp({dbDir}),b=app.browser,h=askHelpers(b);
try{
 await b.setWindowSize(1280,900);await h.openDashboard();await h.ask('Where can I cut back to save $1 a month?');
 await h.waitText('Choose up to 20 categories','choices');
 for(let i=1;i<=20;i++){
  const name=`QQ${String(i).padStart(2,'0')}`;
  await b.$(`input[aria-label="Select ${name}"]`).click();
  await h.clickButton(`Allow up to 100% with floor $0 for ${name}`);
 }
 assert.equal(await b.$('input[aria-label="Select QQ21"]').isEnabled(),false,'21st selection is disabled without dropping the 20 supported choices');
 await (await h.dialog()).$('label*=The whole of').click();
 await h.clickButton('Review the details');await h.waitText('Check every detail','review');
 assert.equal((await (await h.dialog()).$$('table.scenario-table')).length,20);
 assert.ok(!(await h.text()).includes('choose a valid usual month'),'each category has three complete100-dollar months');
 await h.clickButton('Show the preview');await h.waitText('Your savings target preview','result');
 const rows=await b.execute(()=>[...document.querySelectorAll('.cut-preview-results tbody tr')].map(r=>[...r.cells].map(c=>c.innerText.trim())));
 assert.equal(rows.length,20);
 for(let i=0;i<20;i++)assert.deepEqual(rows[i],[`QQ${String(i+1).padStart(2,'0')}`,'$0.05','$0.05','$99.95']);
 const text=await h.text();assert.ok(text.includes('Goal: $1.00 per month'));assert.ok(text.includes('Maximum: $2,000.00 per month'));assert.ok(text.includes('Shortfall: $0.00 per month'));assert.ok(text.includes('$12.00 across the selected dates'));
 assert.ok(text.includes('Nothing in your data was changed.'));
 await h.closeDialog();
 // UI-only readback: selecting categories and confirming a preview did not spend or move money.
 await waitUntilOrDiagnose(b,async()=>await b.$('[data-widget-id="stat_cash"] .stat-value').getText()==='$4,000.00',{timeout:10000,timeoutMsg:'financial data stays10000 minus60 purchases of100'});
 console.log('FEATURE 324 PASSED: supported20-category calculation, 21st-choice bound, exact5-cent allocations,99.95 limits and12-dollar year total.');
}finally{await app.close();}
