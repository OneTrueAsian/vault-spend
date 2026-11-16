// UAT-152: Household attribution semantics for a refund, a category split, a transfer and the viewed month (no multi-person split exists; a split line takes its parent's member).
// This month: Alex Groceries -100, Alex Groceries refund +30 (checking), Blair split -90 = Groceries -60 + Dining Out -30, Unassigned Dining Out -20, Alex Transfer -500.
// Last month: Blair Groceries -45. Budgets: Groceries 400, Dining Out 150 in both months.
// Top cards (memberBreakdowns.ts): spending = outflows only, transfers excluded, refunds NOT netted: Alex 100, Blair 90, Unassigned 20; income = isIncomeTransaction: Alex 30 (the refund).
// Budget table (monthly_budget_actuals_by_member): refunds net and splits go by line: Groceries Alex 70, Blair 60; Dining Out Unassigned 20 (listed first), Blair 30. Last month: Groceries Blair 45.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "./lib/tempDir.mjs";
import { typeDate } from "./lib/dateFieldInput.mjs";
import { launchApp, chooseStyle, dismissStatusMessages, withFocusRetry, waitUntilOrDiagnose } from "./harness.mjs";
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
cur.execute("UPDATE accounts SET member_id=? WHERE id=?", (alex,acct))
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
const shots = process.env.VS_STEP1_SHOTS ?? makeTempDir("vaultspend-step1-household-");
fs.mkdirSync(shots, {recursive: true});
const app = await launchApp({ dbDir });
const b = app.browser;
const read = () => b.execute(() => {
  const card = prefix => [...document.querySelectorAll('.card')].find(c => c.querySelector('h2')?.textContent.startsWith(prefix));
  const list = prefix => { const c = card(prefix); return c ? [...c.querySelectorAll('li')].map(li => [li.children[0].textContent, li.children[1].textContent]) : null; };
  const table = card('Budget by person,');
  const rows = table ? [...table.querySelectorAll('tbody tr')].map(tr => [...tr.cells].map(td => td.textContent)) : null;
  return { spending: list('Spending by person'), monthly: [...document.querySelectorAll('[data-month-by-person] tbody tr')].map(tr => [...tr.cells].map(td => td.textContent)), budget: rows };
});
const settle = async (check, why) => waitUntilOrDiagnose(b, async () => { try { check(await read()); return true; } catch { return false; } }, { timeout: 10000, timeoutMsg: why });
try {
  await b.setWindowSize(1280, 900);
  await (await b.$('.nav-item[aria-label="Household"]')).click();
  await settle(r => assert.deepEqual(r.spending, [['QA Alex', '$100.00'], ['QA Blair', '$90.00'], ['Unassigned', '$20.00']]), 'this month spending: outflows only, transfer excluded, refund not netted');
  await settle(x => assert.ok(x.budget && x.budget.length === 2), 'the budget table loads its two category rows');
  let r = await read();
  assert.deepEqual(r.monthly, [['QA Alex', '$30.00', '$100.00'], ['QA Blair', '$0.00', '$90.00'], ['Shared', '$0.00', '$20.00']], 'the refund on a checking account is counted as income by the shared income rule');
  // Rows come per category in member order with the unassigned bucket first (BTreeMap<Option<i64>>), the category name and budget only on a group's first row.
  assert.deepEqual(r.budget, [['Dining Out', '$150.00', '$0.00', '$30.00', '$20.00'], ['Groceries', '$400.00', '$70.00', '$60.00', '$0.00']], 'refund nets in the budget table and the split goes line by line to its parent member');
  await (await b.$("button[aria-label='Previous month']")).click();
  await settle(r2 => assert.deepEqual(r2.spending, [['QA Blair', '$45.00']]), 'last month spending is only Blair 45');
  await settle(x => assert.ok(x.budget && x.budget.length === 1), 'last month budget table loads');
  r = await read();
  assert.deepEqual(r.monthly, [['QA Alex', '$0.00', '$0.00'], ['QA Blair', '$0.00', '$45.00'], ['Shared', '$0.00', '$0.00']], 'last month has no income, but every person and Shared remain visible');
  assert.deepEqual(r.budget, [['Groceries', '$400.00', '$0.00', '$45.00', '$0.00']]);
  for (const theme of ["light", "dark"]) {
    await b.setWindowSize(1440, 1000);
    await chooseStyle(b, "Default", "transparent");
    await b.execute(t => [...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find(el => el.textContent.trim().toLowerCase() === t).click(), theme);
    await b.$('.nav-item[data-tab="household"]').click();
    await b.$('.household-cards').waitForExist({timeout: 10000});
    await dismissStatusMessages(b);
    assert.ok(await b.execute(() => [...document.querySelectorAll('[data-budget-by-person] tbody tr')].every(row => row.getBoundingClientRect().height < 100)), "category artwork remains inside a compact table row");
    await b.saveScreenshot(path.join(shots, `household-${theme}-1440.png`));
    await b.$('[data-budget-by-person]').scrollIntoView({block: "start"});
    await b.saveScreenshot(path.join(shots, `household-budget-${theme}-1440.png`));
    await b.$('[data-privacy-toggle]').click();
    await waitUntilOrDiagnose(b, () => b.execute(() => !/\$[\d,]+\.\d{2}/.test(document.querySelector('.household-view').textContent)), {timeoutMsg: "Household figures are masked"});
    await b.saveScreenshot(path.join(shots, `household-${theme}-hidden.png`));
    await b.$('[data-privacy-toggle]').click();
    await b.setWindowSize(720, 520);
    await waitUntilOrDiagnose(b, () => b.execute(() => document.querySelector('.main').scrollWidth <= document.querySelector('.main').clientWidth + 1), {timeoutMsg: "Household fits 720px"});
    await b.$('.household-cards').scrollIntoView({block: "start"});
    await b.saveScreenshot(path.join(shots, `household-${theme}-720.png`));
  }
  await b.setWindowSize(1280, 900);
  await b.$('[aria-label="Rename QA Alex"]').waitForExist({timeout: 10000});
  await b.$('[aria-label="Rename QA Alex"]').click();
  await withFocusRetry(b, async () => {
    const field = await b.$('[aria-label="Name for QA Alex"]');
    await field.click(); await b.keys(["Control", "a"]); await b.keys("Control"); await field.addValue("QA Alexandra");
    await b.$('.household-people button[type="submit"]').click();
  });
  await b.$('[aria-label="Rename QA Alexandra"]').waitForExist({timeout: 10000});
  await b.$('[aria-label="Remove QA Alexandra"]').click();
  assert.ok((await b.$('.household-remove-confirm').getText()).includes("becomes unassigned"));
  await b.$('.household-remove-confirm .modal-secondary').click();
  assert.equal(await b.$('[aria-label="Rename QA Alexandra"]').isExisting(), true, "Cancel keeps the person");
  await b.$('[aria-label="Remove QA Alexandra"]').click();
  await b.$('.household-remove-confirm .btn-danger').click();
  await waitUntilOrDiagnose(b, async () => !(await b.$('[aria-label="Rename QA Alexandra"]').isExisting()), {timeoutMsg: "existing remove handler removes the person"});
  const worth = await b.execute(() => [...document.querySelectorAll('.household-cards .breakdown-list li')].map(el => el.textContent));
  assert.ok(worth.some(row => row.startsWith('Shared') && row.includes('$4,275.00')), `removing a person preserves the account value as Shared: ${worth}`);
  await withFocusRetry(b, () => typeDate(b, 'input[aria-label="Household month"]', "2025-03"));
  await waitUntilOrDiagnose(b, () => b.execute(() => document.querySelector('[data-month-by-person] h2').textContent === "March 2025 by person"), {timeoutMsg: "picker selects across year boundaries"});
  assert.deepEqual(await b.execute(() => [...document.querySelectorAll('.household-cards .breakdown-list li')].map(el => el.textContent)), worth, "net worth uses today's values regardless of selected month");
  await b.$('button=Add person').click();
  await b.$('[role="dialog"]').waitForExist({timeout: 5000});
  assert.ok((await b.$('[role="dialog"]').getText()).includes("Manage family members"), "Add person opens the existing dialog");
  console.log("Household actions: People rename, cancel, remove, retained assets, existing Add dialog and cross-year month picker");

  console.log('FEATURE 333 PASSED: Household refund, split, transfer, unassigned and viewed-month semantics match hand calculations.');
} finally { await app.close(); }
