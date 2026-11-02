// UAT-255: inclusive calendar-month boundaries, through real Budget arrows and Reports range buttons.
// Independent fixture arithmetic: previous month 100 - 12.34 = 87.66 left;
// current month 200 - 56.78 = 143.22 left. The older 90.01 is in neither budget month.
// Reports last month: income 900, spending 12.34, net 887.66. Last six months:
// income 1900, spending 90.01 + 12.34 + 56.78 = 159.13, net 1740.87.
// The Windows clock is never changed. Dates are derived before the isolated fixture is created.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { waitForBudgetRow } from "./lib/budgetRows.mjs";
import { dateInMonth, monthFromNow } from "./lib/dates.mjs";

const now = new Date();
const lastDay = back => new Date(now.getFullYear(), now.getMonth() + back + 1, 0).getDate();
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('Boundary Checking','checking','10000.00')")
a=cur.lastrowid
for date,description,amount,category in [
 ('${monthFromNow(-2)}-${lastDay(-2)}','Older month last day','-90.01','Groceries'),
 ('${monthFromNow(-1)}-${lastDay(-1)}','Previous month last day','-12.34','Groceries'),
 ('${dateInMonth(0, 1)}','Current month first day','-56.78','Groceries'),
 ('${monthFromNow(-1)}-${lastDay(-1)}','Previous month income','900.00','Salary'),
 ('${dateInMonth(0, 1)}','Current month income','1000.00','Salary')]:
 cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,'user',?)",(a,date,description,amount,category,description))
for period,amount in [('${monthFromNow(-1)}','100.00'),('${monthFromNow(0)}','200.00')]:
 cur.execute("INSERT OR IGNORE INTO budget_periods(period) VALUES(?)",(period,))
 cur.execute("INSERT INTO budgets(category,period,monthly_amount,budget_group,rollover_enabled) VALUES('Groceries',?,?,'flexible',0)",(period,amount))
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const budget = (spent, left) => waitForBudgetRow(b, "Groceries", r => r.spent === spent && r.left === left, { timeoutMsg: `Groceries must show ${spent} spent and ${left} left` });
const summary = () => b.execute(() => ["income", "spending", "net"].map(k => document.querySelector(`[data-summary-${k}]`)?.textContent.trim() ?? null));
async function reports(preset, expected) {
  await b.$(`[data-range-preset="${preset}"]`).click();
  await waitUntilOrDiagnose(b, async () => JSON.stringify(await summary()) === JSON.stringify(expected), { timeout: 12000, timeoutMsg: `${preset} must use only its calendar months`, extra: summary });
  assert.deepEqual(await summary(), expected);
}
try {
  await b.$('.nav-item[aria-label="Budget"]').click();
  assert.equal((await budget("$56.78", "$143.22")).budget, "200.00");
  await b.$('button[aria-label="Previous month"]').click();
  assert.equal((await budget("$12.34", "$87.66")).budget, "100.00");
  await b.$('button[aria-label="Next month"]').click();
  await budget("$56.78", "$143.22");
  await b.$('.nav-item[aria-label="Reports"]').click();
  await b.$('[data-range-preset="last_month"]').waitForDisplayed({ timeout: 10000 });
  await reports("last_month", ["$900.00", "$12.34", "$887.66"]);
  await reports("last_6", ["$1,900.00", "$159.13", "$1,740.87"]);
  await reports("last_month", ["$900.00", "$12.34", "$887.66"]);
  console.log("FEATURE 362 PASSED: Budget and Reports include each month's boundary dates exactly once and remain correct after switching ranges back and forth.");
} finally { await app.close(); }
