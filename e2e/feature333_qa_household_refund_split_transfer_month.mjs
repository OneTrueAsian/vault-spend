// UAT-152: Household attribution semantics for a refund, a category split, a transfer and the viewed month (no multi-person split exists; a split line takes its parent's member).
// This month: Alex Groceries -100, Alex Groceries refund +30 (checking), Blair split -90 = Groceries -60 + Dining Out -30, Unassigned Dining Out -20, Alex Transfer -500.
// Last month: Blair Groceries -45. Budgets: Groceries 400, Dining Out 150 in both months.
// Top cards (memberBreakdowns.ts): spending = outflows only, transfers excluded, refunds NOT netted: Alex 100, Blair 90, Unassigned 20; income = isIncomeTransaction: Alex 30 (the refund).
// Budget table (monthly_budget_actuals_by_member): refunds net and splits go by line: Groceries Alex 70, Blair 60; Dining Out Unassigned 20 (listed first), Blair 30. Last month: Groceries Blair 45.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today=datetime.date.today()
def first(back):
    index=today.year*12+today.month-1-back
    y,m=divmod(index,12)
    return datetime.date(y,m+1,1)
cur.execute("INSERT INTO family_members(name) VALUES('QA Alex')"); alex=cur.lastrowid
cur.execute("INSERT INTO family_members(name) VALUES('QA Blair')"); blair=cur.lastrowid
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Checking','checking','5000.00')"); acct=cur.lastrowid
def add(back,description,amount,category,member):
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,member_id,fingerprint) VALUES(?,?,?,?,?,'user',?,?)",(acct,first(back).isoformat(),description,amount,category,member,description))
    return cur.lastrowid
add(0,'QA Alex Grocer','-100.00','Groceries',alex)
add(0,'QA Alex Refund','30.00','Groceries',alex)
split=add(0,'QA Blair Split','-90.00','Groceries',blair)
cur.execute("INSERT INTO transaction_splits(transaction_id,category,amount) VALUES(?,?,?)",(split,'Groceries','-60.00'))
cur.execute("INSERT INTO transaction_splits(transaction_id,category,amount) VALUES(?,?,?)",(split,'Dining Out','-30.00'))
add(0,'QA Unassigned Dining','-20.00','Dining Out',None)
add(0,'QA Alex Transfer','-500.00','Transfer',alex)
add(1,'QA Blair Last Month','-45.00','Groceries',blair)
for back in [0,1]:
    period=first(back).strftime('%Y-%m')
    for category,amount in [('Groceries','400.00'),('Dining Out','150.00')]:
        cur.execute("INSERT INTO budgets(category,period,monthly_amount,budget_group) VALUES(?,?,?,'flexible')",(category,period,amount))
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const read = () => b.execute(() => {
  const card = prefix => [...document.querySelectorAll('.card')].find(c => c.querySelector('h2')?.textContent.startsWith(prefix));
  const list = prefix => { const c = card(prefix); return c ? [...c.querySelectorAll('li')].map(li => [li.children[0].textContent, li.children[1].textContent]) : null; };
  const table = card('Budget, by category and person');
  const rows = table ? [...table.querySelectorAll('tbody tr')].map(tr => [...tr.cells].map(td => td.textContent)) : null;
  return { spending: list('Spending by person'), income: list('Income by person'), budget: rows };
});
const settle = async (check, why) => waitUntilOrDiagnose(b, async () => { try { check(await read()); return true; } catch { return false; } }, { timeout: 10000, timeoutMsg: why });
try {
  await b.setWindowSize(1280, 900);
  await (await b.$('.nav-item[aria-label="Household"]')).click();
  await settle(r => assert.deepEqual(r.spending, [['QA Alex', '$100.00'], ['QA Blair', '$90.00'], ['Unassigned', '$20.00']]), 'this month spending: outflows only, transfer excluded, refund not netted');
  await settle(x => assert.ok(x.budget && x.budget.length === 4), 'the budget table loads its four rows');
  let r = await read();
  assert.deepEqual(r.income, [['QA Alex', '$30.00']], 'the refund on a checking account is counted as income by the shared income rule');
  // Rows come per category in member order with the unassigned bucket first (BTreeMap<Option<i64>>), the category name and budget only on a group's first row.
  assert.deepEqual(r.budget, [['Dining Out', 'Unassigned', '$20.00', '$150.00'], ['', 'QA Blair', '$30.00', ''], ['Groceries', 'QA Alex', '$70.00', '$400.00'], ['', 'QA Blair', '$60.00', '']], 'refund nets in the budget table and the split goes line by line to its parent member');
  await (await b.$("button[aria-label='Previous month']")).click();
  await settle(r2 => assert.deepEqual(r2.spending, [['QA Blair', '$45.00']]), 'last month spending is only Blair 45');
  await settle(x => assert.ok(x.budget && x.budget.length === 1), 'last month budget table loads');
  r = await read();
  assert.deepEqual(r.income, [], 'no income last month: the card is present with no rows (its empty message)');
  assert.deepEqual(r.budget, [['Groceries', 'QA Blair', '$45.00', '$400.00']]);
  console.log('FEATURE 333 PASSED: Household refund, split, transfer, unassigned and viewed-month semantics match hand calculations.');
} finally { await app.close(); }
