// Missing QA clauses: mixed-account totals, quiet-account notice, rate chart and empty chosen period.
import assert from 'node:assert/strict';
import { launchApp, waitUntilOrDiagnose, withFocusRetry } from './harness.mjs';
import { seedFixture } from './lib/seed.mjs';
const dbDir = await seedFixture(`
import datetime
today=datetime.date.today()
ids={}
for name,kind,balance in [('QA Checking','checking','1000.00'),('QA Card','credit','1000.00'),('QA Loan','loan','500.00'),('QA Investment','investment','300.00'),('QA Quiet','checking','0.00')]:
    cur.execute('INSERT INTO accounts(name,account_type,starting_balance) VALUES(?,?,?)',(name,kind,balance))
    ids[name]=cur.lastrowid
for name,description,amount,category in [('QA Checking','QA Pay','500.00','Income'),('QA Checking','QA Grocer','-30.00','Groceries'),('QA Checking','QA Dining','-20.00','Dining Out'),('QA Card','QA Card Shop','-200.00','Shopping')]:
    cur.execute('INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,?,?)',(ids[name],today.isoformat(),description,amount,category,'user',description))
cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,'QA Old Zero','0.00','Groceries','user','oldzero')",(ids['QA Quiet'],(today-datetime.timedelta(days=40)).isoformat()))
cur.execute("INSERT INTO assets(name,asset_type,value,valued_on) VALUES('QA Property','other','100.00',?)",(today.isoformat(),))
`);
const app=await launchApp({dbDir}),b=app.browser;
const nav=async name=>{await (await b.$(`.nav-item[aria-label="${name}"]`)).click();};
const page=()=>b.execute(()=>document.querySelector('[role="main"]')?.innerText??'');
const tile=key=>b.$(`[data-widget-id="${key}"] .stat-value`).getText();
try {
  await b.setWindowSize(1280,900);
  await waitUntilOrDiagnose(b,async()=>await tile('stat_net_worth')==='$1,150.00',{timeout:10000,timeoutMsg:'mixed-account headline equals1450cash minus700debt plus300investment plus100property'});
  assert.equal(await tile('stat_cash'),'$1,450.00');
  assert.equal(await tile('stat_debt'),'-$700.00');
  assert.equal(await tile('stat_investments'),'$300.00');
  await waitUntilOrDiagnose(b,async()=>/QA Quiet/.test(await page())&&/no activity in 30\+ days/.test(await page()),{timeout:10000,timeoutMsg:'quiet checking account is named separately from hidden-account behavior'});
  await nav('Accounts');
  const worth=await b.$("//span[text()='Net worth']/parent::button");
  await waitUntilOrDiagnose(b,async()=>(await worth.getText()).includes('$1,150.00'),{timeout:10000,timeoutMsg:'Accounts agrees with independent mixed-account net worth'});
  for(const [label,value] of [['What you own','$1,850.00'],['What you owe','$700.00']]){
    const texts=await b.execute(()=>[...document.querySelectorAll('.stats .stat')].map(s=>s.innerText));
    assert.ok(texts.some(t=>t.toLowerCase().includes(label.toLowerCase())&&t.includes(value)),`${label} is ${value}: ${texts.join('; ')}`);
  }
  await nav('Reports');
  await waitUntilOrDiagnose(b,async()=>await b.$('[data-summary-income]').getText()==='$500.00',{timeout:10000,timeoutMsg:'known report income'});
  assert.equal(await b.$('[data-summary-spending]').getText(),'$250.00');
  assert.equal(await b.$('[data-summary-net]').getText(),'$250.00');
  assert.equal(await b.$('[data-summary-rate]').getText(),'50%');
  const rateCard=()=>b.$('//div[contains(@class,"card")][.//span[text()="Savings rate trend"]]');
  const hit=await (await rateCard()).$$('svg rect[fill="transparent"]');
  assert.equal(hit.length,2,'old zero-activity month and current month');
  for(const [index,expected] of [[0,'0%'],[1,'50%']]){
    // mouseenter stops firing when another window takes OS focus, so retry only when focus was really lost.
    await withFocusRetry(b,async()=>{
      await hit[index].moveTo();
      await waitUntilOrDiagnose(b,async()=>await (await (await rateCard()).$('.chart-tooltip-text')).getText()===expected,{timeout:5000,timeoutMsg:`rate tooltip ${index} is ${expected}`});
    });
  }
  // Current month is populated; previous month contains only a zero marker.
  await b.$('[data-range-preset="last_month"]').click();
  await waitUntilOrDiagnose(b,async()=>await b.$('[data-summary-income]').getText()==='$0.00',{timeout:10000,timeoutMsg:'changing to the empty period changes the actual report amounts'});
  assert.equal(await b.$('[data-summary-spending]').getText(),'$0.00');
  assert.equal(await b.$('[data-summary-net]').getText(),'$0.00');
  assert.equal(await b.$('[data-summary-rate]').getText(),'—');
  assert.ok((await page()).includes('No income or spending in this range.'));
  console.log('FEATURE 322 PASSED: mixed-account/Accounts totals, quiet-account notice, savings rate0/50%, populated-profile empty period.');
}finally{await app.close();}
