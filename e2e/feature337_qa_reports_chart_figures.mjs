// UAT-119: the other Reports charts (Income -> spending Sankey, Daily spending heatmap, category-by-month table, Year by year), read from the
// tables the page exposes (the Sankey and heatmap carry a visually hidden table), against hand calculations. Default range is the last 6 months.
// Fixture (same as feature328): month -2 income 800 / Groceries 200 on the 12th; month -1 income 800 / Groceries 880 on the 12th; this month Groceries 100 on the 1st.
// Hand totals: income 1,600.00; spending 1,180.00; left over 420.00; savings rate 26%.
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
const day = (back, d) => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth() - back, d); };
const monthShort = back => day(back, 1).toLocaleDateString('en-US', { month: 'short' });
const dayLabel = (back, d) => day(back, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const read = () => b.execute(() => {
  const rowsOf = t => t ? [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(c => c.textContent)) : null;
  const byCaption = c => [...document.querySelectorAll('.sr-only table')].find(t => t.querySelector('caption')?.textContent === c);
  const byCard = attr => document.querySelector(`[${attr}] table`);
  const head = t => t ? [...t.querySelectorAll('thead th')].map(x => x.textContent) : null;
  return {
    sankey: rowsOf(byCaption('Income and spending flow, in full dollar figures')),
    daily: rowsOf(byCaption('Daily spending totals')),
    months: { head: head(byCard('data-report-table')), rows: rowsOf(byCard('data-report-table')) },
    years: rowsOf(byCard('data-report-years')),
  };
});
try {
  await b.setWindowSize(1280, 900);
  await (await b.$('.nav-item[aria-label="Reports"]')).click();
  await waitUntilOrDiagnose(b, async () => { const r = await read(); return r.sankey?.length === 3 && (r.daily?.length ?? 0) > 0 && r.years?.length > 0; }, { timeout: 15000, timeoutMsg: 'Reports charts and tables load' });
  const r = await read();
  assert.deepEqual(r.sankey, [['Income', '$1,600.00'], ['Groceries', '$1,180.00'], ['Left over', '$420.00']], 'Sankey: income 1,600, one spending category 1,180, left over 420');
  const daily = Object.fromEntries(r.daily);
  assert.equal(daily[dayLabel(2, 12)], '$200.00', JSON.stringify(r.daily.filter(x => x[1] !== '$0.00')));
  assert.equal(daily[dayLabel(1, 12)], '$880.00');
  assert.equal(daily[dayLabel(0, 1)], '$100.00');
  const nonZero = r.daily.filter(x => x[1] !== '$0.00');
  assert.equal(nonZero.length, 3, 'only the three spending days are non-zero: ' + JSON.stringify(nonZero));
  const cats = r.months.rows;
  assert.equal(cats.length, 1, JSON.stringify(cats));
  const col = back => cats[0][r.months.head.indexOf(monthShort(back))];
  assert.equal(cats[0][0], 'Groceries');
  assert.deepEqual([col(2), col(1), col(0)], ['$200.00', '$880.00', '$100.00']);
  assert.equal(cats[0][cats[0].length - 1], '$1,180.00');
  assert.equal(cats[0].filter(x => x === '—').length, 3, 'the other three months of the range show a dash, not $0');
  // Year by year: months can straddle New Year, so group the hand figures by calendar year.
  const perYear = new Map();
  for (const [back, income, expense] of [[2, 800, 200], [1, 800, 880], [0, 0, 100]]) {
    const y = day(back, 1).getFullYear(), v = perYear.get(y) ?? { income: 0, expense: 0 };
    v.income += income; v.expense += expense; perYear.set(y, v);
  }
  const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const expectedYears = [...perYear].sort((a, c) => c[0] - a[0]).map(([y, v]) => [String(y), money(v.income), money(v.expense), money(v.income - v.expense), v.income > 0 ? Math.round(((v.income - v.expense) / v.income) * 100) + '%' : '—']);
  assert.deepEqual([...r.years].sort((a, c) => c[0] - a[0]), expectedYears);
  console.log('FEATURE 337 PASSED: Reports Sankey, daily spending, category-by-month and year-by-year figures match hand calculations.');
} finally { await app.close(); }
