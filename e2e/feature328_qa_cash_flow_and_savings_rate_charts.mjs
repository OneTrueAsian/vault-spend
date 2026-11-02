// UAT-119 / UAT-118 / Batch B: Cash Flow bar tooltips and legend totals, and the Reports savings-rate trend, against independent hand calculations.
// Months (relative to today): -2 income 800 expense 200 -> 75%; -1 income 800 expense 880 -> -10%; current month expense 100, no income -> 0%.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose, withFocusRetry } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today=datetime.date.today()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Checking','checking','5000.00')")
account=cur.lastrowid
def month(back):
    index=today.year*12+today.month-1-back
    y,m=divmod(index,12)
    return y,m+1
def add(y,m,d,description,amount,category):
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,'user',?)",(account,datetime.date(y,m,d).isoformat(),description,amount,category,description))
for back,income,expense in [(2,'800.00','-200.00'),(1,'800.00','-880.00')]:
    y,m=month(back)
    add(y,m,10,f'QA Pay {back}',income,'Salary')
    add(y,m,12,f'QA Spend {back}',expense,'Groceries')
y,m=month(0)
add(y,m,1,'QA Spend now','-100.00','Groceries')
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const nav = async label => { await (await b.$(`.nav-item[aria-label="${label}"]`)).click(); };
const short = back => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() - back, 1).toLocaleDateString('en-US', { month: 'short' }); };
const card = title => b.$(`//div[contains(@class,"card")][.//span[text()="${title}"]]`);
// Hover every month group of a chart card and collect the tooltip title + lines.
const tooltips = async title => {
  const hits = await (await card(title)).$$('svg rect[fill="transparent"]');
  const out = {};
  for (let i = 0; i < hits.length; i++) {
    // mouseenter stops firing when another window takes OS focus, so retry only when focus was really lost.
    await withFocusRetry(b, async () => {
      // Off the chart first, so a pointer already resting inside this group (after a layout shift) still produces a fresh mouseenter.
      await (await (await card(title)).$('.reports-section-title')).moveTo();
      await hits[i].moveTo();
      await waitUntilOrDiagnose(b, async () => (await (await card(title)).$$('.chart-tooltip-title, .chart-tooltip-text')).length > 0, { timeout: 5000, timeoutMsg: `${title}: tooltip for group ${i}`, extra: () => b.execute(() => ({ rects: document.querySelectorAll('svg rect[fill="transparent"]').length, tooltips: document.querySelectorAll('.chart-tooltip-title').length, y: window.scrollY })) });
    });
    const { heading, lines } = await b.execute(titleText => {
      const c = [...document.querySelectorAll('.card')].find(x => [...x.querySelectorAll('.reports-section-title')].some(h => h.textContent === titleText));
      return { heading: c.querySelector('.chart-tooltip-title')?.textContent ?? null, lines: [...c.querySelectorAll('.chart-tooltip-text')].map(x => x.textContent) };
    }, title);
    out[heading ?? `#${i}`] = lines;
  }
  return out;
};
try {
  await b.setWindowSize(1280, 900);
  await nav('Cash Flow');
  const c = await card('Income vs. expenses');
  await c.waitForDisplayed({ timeout: 10000 });
  await waitUntilOrDiagnose(b, async () => (await (await card('Income vs. expenses')).getText()).includes('Income · $1,600.00'), { timeout: 10000, timeoutMsg: 'legend income is 800 + 800' });
  const legend = await (await card('Income vs. expenses')).getText();
  assert.ok(legend.includes('Expenses · $1,180.00'), `legend expenses are 200 + 880 + 100: ${legend}`);
  assert.ok(legend.includes('Net $420.00 (26% savings rate)'), `net 420 on income 1600 is 26%: ${legend}`);
  const bars = await tooltips('Income vs. expenses');
  const find = back => Object.entries(bars).find(([k]) => k.startsWith(short(back)))?.[1];
  assert.deepEqual(find(2), ['Income: $800', 'Expenses: $200'], JSON.stringify(bars));
  assert.deepEqual(find(1), ['Income: $800', 'Expenses: $880'], JSON.stringify(bars));
  assert.deepEqual(find(0), ['Income: $0', 'Expenses: $100'], JSON.stringify(bars));

  await nav('Reports');
  const trend = await card('Savings rate trend');
  await trend.waitForDisplayed({ timeout: 10000 });
  const rates = await tooltips('Savings rate trend');
  const rate = back => Object.entries(rates).find(([k]) => k.startsWith(short(back)))?.[1];
  assert.deepEqual(rate(2), ['75%'], JSON.stringify(rates));
  assert.deepEqual(rate(1), ['-10%'], JSON.stringify(rates));
  assert.deepEqual(rate(0), ['0%'], 'a month with no income is shown as 0%, not a division error: ' + JSON.stringify(rates));
  console.log('FEATURE 328 PASSED: Cash Flow bar tooltips and legend totals, and savings-rate trend values 75/-10/0, match hand calculations.');
} finally { await app.close(); }
