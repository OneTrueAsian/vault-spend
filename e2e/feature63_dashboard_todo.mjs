// E2E test for Phase 1 item 15: the Dashboard's "Needs a look" widget now
// leads with a "To do" list of things to act on — uncategorized
// transactions, bills due within 3 days, and everyday accounts with no
// activity for 30+ days — and each row jumps to the screen where it's fixed.
//
// Run with: node e2e/feature63_dashboard_todo.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
soon = today + datetime.timedelta(days=2)
long_ago = today - datetime.timedelta(days=60)

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '2000.00')")
everyday = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Old Checking', 'checking', '500.00')")
old = cur.lastrowid

def add(account_id, date, desc, amount, category, n):
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (account_id, date.isoformat(), desc, amount, category, "user" if category else None, f"fp-{n}"),
    )

add(everyday, today, "Mystery Vendor", "-20.00", None, 1)
add(everyday, today, "Paypal Transfer", "-30.00", None, 2)
add(everyday, today, "Green Leaf Grocers", "-45.00", "Groceries", 3)
add(old, long_ago, "Dormant Deposit", "10.00", "Income", 4)

cur.execute(
    "INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id) VALUES ('Geico Auto', 'Insurance', '-175.00', 'monthly', ?, ?)",
    (soon.isoformat(), everyday),
)
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  const buttons = await browser.$$("nav button");
  for (const b of buttons) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
try {
  await browser.setWindowSize(1440, 1000);
  await nav("Dashboard");

  const list = await browser.$(".todo-list");
  await list.waitForExist({ timeout: 10000 });
  const text = await list.getText();
  console.log("to do:", text.replace(/\n/g, " | "));
  for (const expected of [
    "2 transactions need a category",
    "1 bill due in the next 3 days",
    "Geico Auto",
    "1 account with no activity in 30+ days",
    "Old Checking",
  ]) {
    if (!text.includes(expected)) throw new Error(`expected the To do list to mention "${expected}", got:\n${text}`);
  }
  if (text.includes("Everyday Checking")) throw new Error("an account with activity today must not be flagged as stale");

  async function clickRow(fragment) {
    const rows = await browser.$$(".todo-row");
    for (const r of rows) {
      if ((await r.getText()).includes(fragment)) return r.click();
    }
    throw new Error(`no To do row containing "${fragment}"`);
  }

  // Uncategorized -> Transactions, already filtered to just those two.
  await clickRow("need a category");
  await browser.waitUntil(async () => (await browser.$$("table tbody tr")).length === 2, {
    timeout: 10000,
    timeoutMsg: "expected the Transactions tab to be filtered to the 2 uncategorized transactions",
  });

  // Bills -> Recurring.
  await nav("Dashboard");
  await (await browser.$(".todo-list")).waitForExist({ timeout: 10000 });
  await clickRow("bill due");
  const recurringTitle = await browser.$("h1.view-title=Recurring");
  await recurringTitle.waitForExist({ timeout: 10000 });

  // Stale account -> Accounts.
  await nav("Dashboard");
  await (await browser.$(".todo-list")).waitForExist({ timeout: 10000 });
  await clickRow("no activity");
  const accountsTitle = await browser.$("h1.view-title=Accounts");
  await accountsTitle.waitForExist({ timeout: 10000 });

  console.log("FEATURE 63 E2E TEST PASSED");
} finally {
  await app.close();
}
