import assert from 'node:assert/strict';
import { launchApp, waitUntilOrDiagnose, withFocusRetry } from './harness.mjs';
import { seedFixture } from './lib/seed.mjs';
const dbDir=await seedFixture(`
import datetime
today=datetime.date.today()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA History','checking','1000.00')")
account=cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories(name) VALUES('Dining Out')")
def add(date,description,amount):
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,'Dining Out','user',?)",(account,date.isoformat(),description,amount,description))
for back in [3,2,1]:
    index=today.year*12+today.month-1-back
    y,m=divmod(index,12)
    for day in [2,4]: add(datetime.date(y,m+1,day),f'QA Baseline {back} {day}','-10.00')
add(today.replace(day=2),'QA Current Regular','-30.00')
add(today,'QA Fancy Meal','-90.00')
add(today+datetime.timedelta(days=1),'QA Tomorrow Meal','-5.00')
cur.execute("INSERT INTO budgets(category,period,monthly_amount,budget_group) VALUES('Dining Out',?,'100.00','flexible')",(today.strftime('%Y-%m'),))
`);
// The last history point is the balance as of today: purchases dated today or earlier count, later ones do not. Worked from the rows above.
//   1000 starting balance - 60 (three earlier months, two $10 purchases each) = 940 at the end of last month.
//   Today adds the $90 meal. The $30 purchase is dated the 2nd, so it counts only from the 2nd (on the 1st it is still ahead).
//   The $5 purchase is dated tomorrow, so it never counts today.
const dayToday=new Date().getDate();
const latest=1000-60-90-(dayToday>=2?30:0);
const app=await launchApp({dbDir}),b=app.browser;
try {
  await b.setWindowSize(1280,900);
  const insights=()=>b.$('//div[contains(@class,"card")][.//span[text()="Insights"]]');
  await waitUntilOrDiagnose(b,async()=>(await (await insights()).getText()).includes('QA Fancy Meal'),{timeout:10000,timeoutMsg:'large-expense insight compares90 against the independent10 baseline'});
  const text=await (await insights()).getText();
  if(new Date().getDate()>=5)assert.ok(text.includes("on pace to exceed Dining Out"),'eligible gradual spending has a pace warning too');
  else console.log('Pace warning not applicable before day5; not credited as observed.');
  await b.$('.nav-item[aria-label="Accounts"]').click();
  const row=()=>b.$('.account-card[data-account-id]');
  // Account names open details; changing its balance would create a checkpoint and ruin this history fixture.
  await (await (await row()).$('button[data-account-details]')).click();
  const card=()=>b.$('//div[contains(@class,"card")][.//span[text()="Balance over the last year"]]');
  await (await card()).waitForDisplayed({timeout:10000});
  await waitUntilOrDiagnose(b,async()=>(await (await card()).$$('svg rect[fill="transparent"]')).length===12,{timeout:10000,timeoutMsg:'12 independently dated balance points loaded'});
  for(const [index,value] of [[10,'$940'],[11,`$${latest}`]]){
    const hit=await (await card()).$$('svg rect[fill="transparent"]');
    // A tooltip comes from mouseenter, which stops firing when another window takes OS focus (the failed batch run showed hasFocus:false), so retry only when focus was really lost.
    await withFocusRetry(b,async()=>{
      await hit[index].moveTo();
      await waitUntilOrDiagnose(b,async()=>await (await (await card()).$('.chart-tooltip-text')).getText()===value,{timeout:5000,timeoutMsg:`history point${index} equals${value}, from 1000 minus the 60 of earlier months, today's 90, and 30 only when today is the 2nd or later (tomorrow's 5 never counts)`});
    });
  }
  console.log(`FEATURE 323 PASSED: actual Insights signals and exact 940/${latest} account-history tooltip values (day ${dayToday}: the day-2 purchase is ${dayToday>=2?'counted':'not yet counted'}, tomorrow's is not).`);
}finally{await app.close();}
