// UAT-022: Dashboard Net worth / Cash / Debt / Investments tiles, their change lines and breakdown rows for checking, savings, card, loan and investment accounts.
// Every transaction is dated today and every opening balance is before the trend window, so each change line equals that group's activity today.
// Cash 2000+300-100 and 500 = 2700 (+200). Card -150 owed (+150 owed). Loan 800 owed (no change). Investment 1000+50 = 1050 (+50). Net worth 2700-950+1050 = 2800 (+100).
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today=datetime.date.today().isoformat()
ids={}
for name,kind,balance in [('QA Checking','checking','2000.00'),('QA Savings','savings','500.00'),('QA Card','credit','0.00'),('QA Loan','loan','800.00'),('QA Investment','investment','1000.00')]:
    cur.execute('INSERT INTO accounts(name,account_type,starting_balance) VALUES(?,?,?)',(name,kind,balance))
    ids[name]=cur.lastrowid
for name,description,amount,category in [('QA Checking','QA Pay','300.00','Income'),('QA Checking','QA Grocer','-100.00','Groceries'),('QA Card','QA Card Shop','-150.00','Shopping'),('QA Investment','QA Deposit','50.00','Income')]:
    cur.execute('INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,?,?)',(ids[name],today,description,amount,category,'user',description))
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const tile = key => b.execute(id => {
  const w = document.querySelector(`[data-widget-id="${id}"]`);
  return { value: w.querySelector('.stat-value')?.textContent ?? null, delta: w.querySelector('.stat-delta')?.textContent.replace(/\s+/g, ' ').trim() ?? null };
}, key);
const panel = () => b.execute(() => {
  const p = document.querySelector('.stat-detail-panel');
  const rows = [...p.querySelectorAll(':scope > div[style*="space-between"]')].map(r => ({ name: r.children[0].textContent, amount: r.children[1].textContent, change: r.children[1].classList.contains('stat-delta') }));
  return { title: p.querySelector('.reports-section-title')?.textContent, balances: rows.filter(r => !r.change).map(r => [r.name, r.amount]), changes: rows.filter(r => r.change).map(r => [r.name, r.amount]) };
});
const open = async id => {
  await b.execute(i => { const w = document.querySelector(`[data-widget-id="${i}"]`); (w.matches('button') ? w : w.querySelector('button')).click(); }, id);
  await waitUntilOrDiagnose(b, async () => (await b.$('.stat-detail-panel').isExisting()), { timeout: 5000, timeoutMsg: `${id} opens its breakdown` });
};
const sorted = rows => rows.slice().sort((x, y) => x[0].localeCompare(y[0]));
try {
  await b.setWindowSize(1280, 900);
  await waitUntilOrDiagnose(b, async () => (await tile('stat_net_worth')).value === '$2,800.00', { timeout: 10000, timeoutMsg: 'net worth is 2700 - 950 + 1050' });
  assert.equal((await tile('stat_cash')).value, '$2,700.00');
  assert.equal((await tile('stat_debt')).value, '-$950.00');
  assert.equal((await tile('stat_investments')).value, '$1,050.00');
  const delta = async id => (await tile(id)).delta;
  assert.match(await delta('stat_net_worth'), /^▲ \$100 over \d+mo$/);
  assert.match(await delta('stat_cash'), /^▲ \$200 over \d+mo$/);
  assert.match(await delta('stat_debt'), /^▲ \$150 over \d+mo$/);
  assert.match(await delta('stat_investments'), /^▲ \$50 over \d+mo$/);

  await open('stat_cash');
  let p = await panel();
  assert.deepEqual(sorted(p.balances), [['QA Checking', '$2,200.00'], ['QA Savings', '$500.00']]);
  assert.deepEqual(p.changes, [['QA Checking', '▲ $200.00']], 'savings did not change, so only checking is listed');
  await open('stat_debt');
  p = await panel();
  assert.deepEqual(sorted(p.balances), [['QA Card', '-$150.00'], ['QA Loan', '-$800.00']]);
  assert.deepEqual(p.changes, [['QA Card', '▲ $150.00']], 'the loan did not change');
  await open('stat_investments');
  p = await panel();
  assert.deepEqual(p.balances, [['QA Investment', '$1,050.00']]);
  assert.deepEqual(p.changes, [['QA Investment', '▲ $50.00']]);
  await open('stat_net_worth');
  p = await panel();
  assert.deepEqual(sorted(p.balances), [['QA Card', '-$150.00'], ['QA Checking', '$2,200.00'], ['QA Investment', '$1,050.00'], ['QA Loan', '-$800.00'], ['QA Savings', '$500.00']]);
  console.log('FEATURE 329 PASSED: four Dashboard tiles, change lines and per-account breakdowns for checking, savings, card, loan and investment accounts.');
} finally { await app.close(); }
