// Current-month Reports, category spending drilldowns, Budget net, and the
// per-profile Safe to spend switch in a real compiled Tauri app.
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
period = today.strftime("%Y-%m")
day = today.replace(day=1).isoformat()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", (period,))
for category, amount, group in [('Income', '2000.00', 'income'), ('Groceries', '300.00', 'flexible'), ('Household', '100.00', 'flexible')]:
    cur.execute("INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES (?, ?, ?, ?)", (category, period, amount, group))

def tx(description, amount, category):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
                (acct, day, description, amount, category, f'{acct}|{day}|{description.lower()}|{amount}'))
    return cur.lastrowid

tx('Paycheck', '1800.00', 'Income')
split = tx('Costco', '-100.00', 'Groceries')
cur.execute("INSERT INTO transaction_splits (transaction_id, category, amount) VALUES (?, 'Groceries', '-60.00')", (split,))
cur.execute("INSERT INTO transaction_splits (transaction_id, category, amount) VALUES (?, 'Household', '-40.00')", (split,))
tx('Corner Grocer', '-25.00', 'Groceries')
tx('Cafe', '-20.00', 'Dining Out')
tx('Mystery', '-10.00', None)
tx('Savings transfer', '-500.00', 'Transfer')
payday = (today + datetime.timedelta(days=9)).isoformat()
cur.execute("INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id) VALUES ('Next paycheck', 'Income', '2000.00', 'biweekly', ?, ?)", (payday, acct))
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const button of await browser.$$("nav button")) {
    if ((await button.getText()).trim() === label) return button.click();
  }
  throw new Error(`missing nav button: ${label}`);
}
async function text(selector) { return (await browser.$(selector)).getText(); }
async function openGroceries() {
  const buttons = await browser.$$(".chart-legend-button");
  for (const button of buttons) {
    if ((await button.getText()).includes("Groceries")) return button.click();
  }
  throw new Error("Groceries category button was not available");
}

try {
  await browser.setWindowSize(1440, 1050);
  await nav("Dashboard");
  await browser.$(".chart-legend-button").waitForExist({ timeout: 15000 });
  await openGroceries();
  await browser.$("[data-category-spend-detail]").waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => (await text("[data-category-spend-detail]")).includes("Costco"), {
    timeout: 10000, timeoutMsg: "Dashboard category detail never loaded Costco",
  });
  const dashboardDetail = await text("[data-category-spend-detail]");
  if (!dashboardDetail.includes("$85.00") || !dashboardDetail.includes("Costco") || !dashboardDetail.includes("$60.00")) {
    throw new Error(`Dashboard split drilldown did not reconcile: ${dashboardDetail}`);
  }
  await (await browser.$("[data-category-spend-detail] .modal-actions button")).click();

  await nav("Cash Flow");
  await browser.$(".cashflow-category-body .chart-legend-button").waitForExist({ timeout: 15000 });
  await openGroceries();
  await browser.$("[data-category-spend-detail]").waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => (await text("[data-category-spend-detail]")).includes("Costco"), {
    timeout: 10000, timeoutMsg: "Cash Flow category detail never loaded Costco",
  });
  if (!(await text("[data-category-spend-detail]")).includes("$85.00")) throw new Error("Cash Flow category detail did not total $85.00");
  await (await browser.$("[data-category-spend-detail] .modal-actions button")).click();

  await nav("Reports");
  await (await browser.$("[data-range-preset='current_month']")).click();
  await browser.waitUntil(async () => (await text("[data-summary-spending]")) === "$155.00", { timeout: 15000 });
  if ((await text("[data-summary-income]")) !== "$1,800.00") throw new Error("Current month income was wrong");
  if ((await browser.$$("[data-report-table] thead th")).length !== 3) throw new Error("Current month must have one table month");

  await nav("Budget");
  await browser.waitUntil(async () => (await text("[data-planned-net]")) === "$1,600.00", { timeout: 15000 });
  await browser.waitUntil(async () => (await text("[data-actual-net]")) === "$1,645.00", { timeout: 15000 });

  await nav("Transactions");
  if ((await browser.$$(".density-toggle")).length !== 0) throw new Error("Density selector should be hidden");

  await nav("Settings");
  const toggle = await browser.$("[data-feature-toggle='safe_to_spend_enabled'] input");
  await toggle.waitForExist({ timeout: 10000 });
  if (!(await toggle.isSelected())) throw new Error("Safe to spend should default on");
  await toggle.click();
  await browser.waitUntil(async () => !(await toggle.isSelected()), { timeout: 10000 });
  await nav("Dashboard");
  if ((await browser.$$(".safe-to-spend-card")).length !== 0) throw new Error("Safe to spend remained on Dashboard after disabling");
  await nav("Settings");
  await (await browser.$("[data-feature-toggle='safe_to_spend_enabled'] input")).click();
  await nav("Dashboard");
  await browser.$(".safe-to-spend-card").waitForExist({ timeout: 15000 });
  console.log("FEATURE 143 E2E TEST PASSED");
} finally {
  await app.close();
}
