// E2E smoke test for budget threshold alerts: seeds a category budgeted at
// $400 with $450 already spent this month (over budget), launches the app,
// and confirms both the Budget page's "Over" badge and the Dashboard's
// alert banner render — plus, opening the banner's breakdown, that the
// over-budget category shows a *negative* remaining amount styled as
// over-budget (same "budgeted minus actual" sign convention as the Budget
// tab's own Remaining column). A prior version of the breakdown computed
// "actual minus budgeted" instead — backwards, so a genuinely over-budget
// category rendered as a normal-looking positive number while merely-
// approaching categories rendered negative/alarming instead.
//
// Run with: node e2e/feature2_budget_alerts.mjs

import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const today = new Date();
const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
const dateStr = `${period}-05`;

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES ('Groceries', '${period}', '400.00', 'flexible')")
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES ('${period}')")
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "${dateStr}", "Big Grocery Run", "-450.00", "Groceries", f"{checking_id}|${dateStr}|big grocery run|-450.00"),
)
`);

const app = await launchApp({ dbDir });
try {
  // Dashboard is the default tab — the alert banner should already show.
  // The banner names the category (UI review s4) rather than counting categories.
  let bannerText = null;
  await waitUntilOrDiagnose(
    app.browser,
    async () => {
      bannerText = await app.browser.execute(() => document.querySelector(".budget-alert-banner")?.textContent ?? null);
      return bannerText === "Groceries is over its budget";
    },
    { timeout: 10000, timeoutMsg: 'expected the banner to read "Groceries is over its budget"', extra: () => bannerText },
  );
  console.log("dashboard banner:", bannerText);
  const banner = await app.browser.$(".budget-alert-banner");

  await banner.click();
  const groceriesRow = await app.browser.$(
    "//div[contains(@class,'stat-detail-panel')]//span[text()='Groceries']/following-sibling::span",
  );
  await groceriesRow.waitForExist({ timeout: 5000 });
  const groceriesAmountText = await groceriesRow.getText();
  console.log("Groceries remaining in the breakdown:", groceriesAmountText);
  if (!groceriesAmountText.includes("-$50.00")) {
    throw new Error(`expected Groceries to show -$50.00 remaining ($400 budgeted - $450 spent), got "${groceriesAmountText}"`);
  }
  const groceriesClass = await groceriesRow.getAttribute("class");
  if (!groceriesClass.includes("report-over-budget")) {
    throw new Error(`expected the over-budget category to carry the over-budget styling class, got "${groceriesClass}"`);
  }

  const budgetNav = await app.browser.$("button*=Budget");
  await budgetNav.click();

  const badge = await app.browser.$(".budget-alert-over");
  await badge.waitForExist({ timeout: 10000 });
  console.log("budget row badge text:", await badge.getText());

  console.log("FEATURE 2 E2E TEST PASSED");
} finally {
  await app.close();
}
