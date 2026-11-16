// E2E smoke test for the Dashboard's proactive Insights card. Uses the
// "large expense" signal specifically (not the "on pace to exceed budget"
// signal, which is intentionally skipped before day 5 of the month — an
// E2E run can't control the app's real system clock, so a day-of-month-
// dependent fixture would be flaky) — seeds three small baseline "Dining
// Out" charges plus one much larger one, all dated relative to today so
// this passes regardless of what day it's actually run on.
//
// Run with: node e2e/feature10_dashboard_insights.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()

cur.execute(
    "INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')"
)
checking_id = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Dining Out')")

def dated(days_ago, description, amount):
    d = (today - datetime.timedelta(days=days_ago)).isoformat()
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
        (checking_id, d, description, amount, "Dining Out", f"{checking_id}|{d}|{description.lower()}|{amount}"),
    )

dated(150, "Cafe One", "-15.00")
dated(100, "Cafe Two", "-20.00")
dated(50, "Cafe Three", "-25.00")
dated(0, "Fancy Steakhouse", "-500.00")

anchor = (today + datetime.timedelta(days=2)).isoformat()
cur.execute(
    "INSERT INTO recurring (merchant, category, amount, cadence, anchor_date) VALUES ('Gym Membership', NULL, '-40.00', 'monthly', ?)",
    (anchor,),
)

period = today.strftime("%Y-%m")
cur.execute(
    "INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES ('Dining Out', ?, '100.00', 'flexible')",
    (period,),
)
`);

const app = await launchApp({ dbDir });
try {
  const dashboardNav = await app.browser.$("button*=Dashboard");
  await dashboardNav.click();

  const insightsCard = await app.browser.$(
    "//div[contains(@class,'card')][.//span[text()='Insights']]",
  );
  await insightsCard.waitForExist({ timeout: 10000 });
  const cardText = await insightsCard.getText();
  console.log("insights card:", cardText);
  if (!cardText.includes("Fancy Steakhouse")) {
    throw new Error(`expected a large-expense insight mentioning "Fancy Steakhouse", got:\n${cardText}`);
  }
  if (!/info/i.test(cardText)) {
    throw new Error(`expected the insight to carry an "info" severity badge, got:\n${cardText}`);
  }

  // "Recent transactions" rows drill into the Ledger tab.
  const recentRow = await app.browser.$("//button[contains(@class,'recent-transaction')][contains(.,'Fancy Steakhouse')]");
  await recentRow.waitForExist({ timeout: 5000 });
  await recentRow.click();
  const importTransactionsBtn = await app.browser.$("button*=Import transactions");
  await importTransactionsBtn.waitForExist({ timeout: 10000 });
  console.log("clicking a recent transaction navigated to the Ledger tab");

  // Back to Dashboard — "Upcoming bills" rows drill into the Recurring tab.
  await dashboardNav.click();
  const upcomingRow = await app.browser.$("//div[contains(@class,'account-name-cell')][text()='Gym Membership']");
  await upcomingRow.waitForExist({ timeout: 10000 });
  await upcomingRow.click();
  const addRecurringBtn = await app.browser.$("button*=Add recurring");
  await addRecurringBtn.waitForExist({ timeout: 10000 });
  console.log("clicking an upcoming bill navigated to the Recurring tab");

  // Back to Dashboard — the "This month's budget" card's group rows drill
  // into the Budget tab.
  await dashboardNav.click();
  const budgetGroupRow = await app.browser.$("//div[contains(@class,'clickable-row')][.//span[text()='Flexible Spending']]");
  await budgetGroupRow.waitForExist({ timeout: 10000 });
  await budgetGroupRow.click();
  const monthNav = await app.browser.$(".month-nav");
  await monthNav.waitForExist({ timeout: 10000 });
  console.log("clicking a budget group navigated to the Budget tab");

  // Reports no longer duplicates the budget table — just a link through.
  const reportsNav = await app.browser.$("button*=Reports");
  await reportsNav.click();
  const budgetLink = await app.browser.$("//div[contains(@class,'clickable-row')][.//span[text()=\"This month's budget →\"]]");
  await budgetLink.waitForExist({ timeout: 10000 });
  const reportsPage = await app.browser.$(".page");
  const reportsText = await reportsPage.getText();
  if (reportsText.includes("Category") && reportsText.includes("Budgeted") && reportsText.includes("Remaining")) {
    throw new Error(`expected Reports to no longer show a duplicate budget table, got:\n${reportsText}`);
  }
  await budgetLink.click();
  await monthNav.waitForExist({ timeout: 10000 });
  console.log("Reports no longer duplicates the budget table, and its link navigates to the Budget tab");

  console.log("FEATURE 10 E2E TEST PASSED");
} finally {
  await app.close();
}
