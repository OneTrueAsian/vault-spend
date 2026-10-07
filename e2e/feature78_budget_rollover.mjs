// E2E test for Phase 2 item 7c (optional unspent rollover per budget category):
//   - a category with "Roll over unspent" on carries last month's leftover into
//     this month: the row says "+ $100.00 rolled in" and its Left column counts it;
//   - switching it off (in the row's ⋯ menu since 1.3.0) drops the carry and the
//     row's "Rolls over" marker; switching it back on restores both;
//   - the first month of a rollover run has nothing rolled in.
//
// Run with: node e2e/feature78_budget_rollover.mjs

import { chooseRowAction, launchApp } from "./harness.mjs";
import { budgetRowMenu, budgetRowMenuItems, waitForBudgetRow } from "./lib/budgetRows.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()

def month_start(back):
    total = today.year * 12 + today.month - 1 - back
    y, m = divmod(total, 12)
    return datetime.date(y, m + 1, 1)

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid

def spend(back, day, desc, amount, category):
    d = (month_start(back) + datetime.timedelta(days=day)).isoformat()
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, "-" + amount, category, "user", f"{acct}|{d}|{desc.lower()}|-{amount}"))

# Groceries budgeted $400 both months, rollover on in both. Last month spent $300 ($100 left); this month $120 so far.
for back in (1, 0):
    period = month_start(back).strftime("%Y-%m")
    cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", (period,))
    cur.execute("INSERT OR REPLACE INTO budgets (category, period, monthly_amount, budget_group, rollover_enabled) VALUES ('Groceries', ?, '400.00', 'flexible', 1)", (period,))
spend(1, 8, "Grocers Last Month", "300.00", "Groceries")
spend(0, 0, "Grocers This Month", "120.00", "Groceries")
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
const row = (test, timeoutMsg) => waitForBudgetRow(browser, "Groceries", test, { timeoutMsg });
const rollOver = (browser) => chooseRowAction(browser, budgetRowMenu(browser, "Groceries"), "Roll over unspent");

try {
  await browser.setWindowSize(1440, 1100);
  await nav("Budget");

  // The row reads Budget | Spent | Left under the group's column headings.
  let r = await row((g) => g.text.includes("rolled in"), "this month should show what rolled in");
  console.log("this month:", JSON.stringify(r));
  if (!r.text.includes("+ $100.00 rolled in")) throw new Error(`this month should show $100.00 rolled in: ${r.text}`);
  // $400 budget + $100 rolled in - $120 spent = $380 left.
  if (r.left !== "$380.00") throw new Error(`the remaining figure should count the rolled-in money ($380.00 left): ${JSON.stringify(r)}`);
  if (Number(r.budget) !== 400) throw new Error(`the planned budget itself is unchanged ($400): ${JSON.stringify(r)}`);
  if (!r.text.includes("Rolls over")) throw new Error(`the row should say it rolls over: ${r.text}`);
  const item = (await budgetRowMenuItems(browser, "Groceries")).find((i) => i.label === "Roll over unspent");
  if (!item || item.checked !== true) throw new Error(`the menu's "Roll over unspent" should start ticked: ${JSON.stringify(item)}`);

  // Off: the carry disappears.
  await rollOver(browser);
  r = await row((g) => !g.text.includes("rolled in") && g.left === "$280.00", "turning rollover off should drop the carry ($400 - $120 = $280.00 left)");
  if (r.text.includes("Rolls over")) throw new Error(`the "Rolls over" marker should go with it: ${r.text}`);

  // On again: it comes back.
  await rollOver(browser);
  await row((g) => g.text.includes("+ $100.00 rolled in") && g.text.includes("Rolls over"), "turning rollover back on should restore the carry");

  // Last month is the first of the run: nothing rolled into it.
  await (await browser.$("button[aria-label='Previous month']")).click();
  await row((g) => !g.text.includes("rolled in") && g.left === "$100.00", "last month is the first of the run: no carry, $400 - $300 = $100.00 left");

  console.log("FEATURE 78 E2E TEST PASSED");
} finally {
  await app.close();
}
