// E2E test for Phase 2 item 7c (optional unspent rollover per budget category):
//   - a category with "Roll over unspent" on carries last month's leftover into
//     this month: the row says "+ $100.00 rolled in" and "left" counts it;
//   - switching it off drops the carry; switching it back on restores it;
//   - the first month of a rollover run has nothing rolled in.
//
// Run with: node e2e/feature78_budget_rollover.mjs

import { launchApp } from "./harness.mjs";
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
const groceriesRow = () =>
  browser.$("//div[contains(@class,'cat-row')][.//span[contains(@class,'category-link')][normalize-space()='Groceries']]");
async function rowText() {
  const row = await groceriesRow();
  await row.waitForExist({ timeout: 10000, timeoutMsg: "no Groceries budget row" });
  return row.getText();
}

try {
  await browser.setWindowSize(1440, 1100);
  await nav("Budget");

  let text = await rowText();
  console.log("this month:", text.replace(/\s+/g, " "));
  if (!text.includes("+ $100.00 rolled in")) throw new Error(`this month should show $100.00 rolled in:\n${text}`);
  // $400 budget + $100 rolled in - $120 spent = $380 left.
  if (!text.includes("$380.00 left")) throw new Error(`the remaining figure should count the rolled-in money ($380.00 left):\n${text}`);
  if (!text.includes("$400.00 budget")) throw new Error(`the planned budget itself is unchanged:\n${text}`);

  // Off: the carry disappears.
  const toggle = async () => (await groceriesRow()).$(".//label[contains(., 'Roll over unspent')]//input");
  if (!(await (await toggle()).isSelected())) throw new Error("the box should start ticked");
  await (await toggle()).click();
  await browser.waitUntil(async () => !(await rowText()).includes("rolled in"), { timeout: 10000, timeoutMsg: "turning rollover off should drop the carry" });
  text = await rowText();
  if (!text.includes("$280.00 left")) throw new Error(`without the carry: $400 - $120 = $280.00 left:\n${text}`);

  // On again: it comes back.
  await (await toggle()).click();
  await browser.waitUntil(async () => (await rowText()).includes("+ $100.00 rolled in"), { timeout: 10000, timeoutMsg: "turning rollover back on should restore the carry" });

  // Last month is the first of the run: nothing rolled into it.
  await (await browser.$("button[aria-label='Previous month']")).click();
  await browser.waitUntil(async () => (await rowText()).includes("Groceries") && !(await rowText()).includes("rolled in"), {
    timeout: 10000,
    timeoutMsg: "the first month of a rollover run has no carry",
  });
  text = await rowText();
  if (!text.includes("$100.00 left")) throw new Error(`last month: $400 - $300 = $100.00 left:\n${text}`);

  console.log("FEATURE 78 E2E TEST PASSED");
} finally {
  await app.close();
}
