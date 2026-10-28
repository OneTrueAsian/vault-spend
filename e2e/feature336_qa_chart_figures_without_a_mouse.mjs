// UAT-119 / QA-OBS-002: the Cash Flow bars and the Reports savings-rate trend show their figures in a hover-only tooltip. Each also carries a visually
// hidden table of the same figures (src/charts.tsx), so a keyboard or screen-reader user can read them. Same fixture and hand calculations as feature328.
// Months (relative to today): -2 income 800 expense 200 -> 75%; -1 income 800 expense 880 -> -10%; current month expense 100, no income -> 0%.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
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
// The hidden table inside the card whose title is `title`, read as the page exposes it: is it in the accessibility tree, and what does it say?
const hiddenTable = title => b.execute(titleText => {
  const card = [...document.querySelectorAll('.card')].find(x => [...x.querySelectorAll('.reports-section-title')].some(h => h.textContent === titleText));
  const table = card?.querySelector('.sr-only table');
  if (!table) return null;
  let inTree = true;
  for (let e = table; e && e !== document.body; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || e.getAttribute('aria-hidden') === 'true' || e.hidden) inTree = false;
  }
  const svg = card.querySelector('svg[role="img"]');
  return { inTree, caption: table.querySelector('caption')?.textContent, label: svg?.getAttribute('aria-label') ?? null, rows: [...table.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(c => c.textContent)) };
}, title);
try {
  await b.setWindowSize(1280, 900);
  await nav('Cash Flow');
  await waitUntilOrDiagnose(b, async () => (await hiddenTable('Income vs. expenses'))?.rows.length === 6, { timeout: 10000, timeoutMsg: 'the Cash Flow chart lists three months of income and expenses' });
  const flow = await hiddenTable('Income vs. expenses');
  assert.equal(flow.inTree, true, 'the table is reachable by assistive technology, not display:none or aria-hidden');
  assert.equal(flow.caption, 'Income and expenses by month');
  assert.equal(flow.label, 'Income and expenses by month', 'the picture is named, not read as unlabelled shapes');
  const monthRows = back => flow.rows.filter(([label]) => label.startsWith(short(back)));
  assert.deepEqual(monthRows(2).map(r => r.slice(1)), [['Income', '$800.00'], ['Expenses', '$200.00']], JSON.stringify(flow.rows));
  assert.deepEqual(monthRows(1).map(r => r.slice(1)), [['Income', '$800.00'], ['Expenses', '$880.00']], JSON.stringify(flow.rows));
  assert.deepEqual(monthRows(0).map(r => r.slice(1)), [['Income', '$0.00'], ['Expenses', '$100.00']], JSON.stringify(flow.rows));

  await nav('Reports');
  await waitUntilOrDiagnose(b, async () => (await hiddenTable('Savings rate trend'))?.rows.length === 3, { timeout: 10000, timeoutMsg: 'the savings-rate chart lists three months' });
  const rates = await hiddenTable('Savings rate trend');
  assert.equal(rates.inTree, true);
  assert.equal(rates.caption, 'Savings rate by month');
  const rate = back => rates.rows.find(([label]) => label.startsWith(short(back)))?.[1];
  assert.equal(rate(2), '75%', JSON.stringify(rates.rows));
  assert.equal(rate(1), '-10%', JSON.stringify(rates.rows));
  assert.equal(rate(0), '0%', 'a month with no income is 0%, not a division error: ' + JSON.stringify(rates.rows));
  console.log('FEATURE 336 PASSED: Cash Flow and savings-rate chart figures are readable from a hidden table in the accessibility tree and match hand calculations.');
} finally { await app.close(); }
