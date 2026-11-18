// E2E smoke test for excluding a debt from the payoff planner (e.g. a
// credit card paid off in full every month shouldn't be treated as debt to
// pay down): seeds two loans, unchecks "Include" on one, calculates a
// plan, and confirms only the still-included loan appears in the results
// — through the real `set_account_excluded_from_debt_payoff` command and
// the backend's own filtering, not just a frontend display filter.
//
// Run with: node e2e/feature19_debt_payoff_exclude.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Paid Off Monthly Card', 'loan', '500.00')")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Real Debt', 'loan', '2000.00')")
`);

const app = await launchApp({ dbDir });
try {
  const cashFlowNav = await app.browser.$("button*=Cash Flow");
  await cashFlowNav.click();

  // The Debt Payoff Planner lives behind its own Cash Flow tab ("Debt
  // payoff", VS-31), rather than always being visible on one long scroll.
  const debtSubTab = await app.browser.$("#cashflow-tab-debt");
  await debtSubTab.waitForExist({ timeout: 10000 });
  await debtSubTab.click();

  const plannerCard = await app.browser.$(
    "//div[contains(@class,'card')][.//span[text()='Debt Payoff Planner']]",
  );
  await plannerCard.waitForExist({ timeout: 10000 });
  const beforeText = await plannerCard.getText();
  console.log("planner before excluding:", beforeText);
  if (!beforeText.includes("Paid Off Monthly Card") || !beforeText.includes("Real Debt")) {
    throw new Error(`expected both debts listed initially, got:\n${beforeText}`);
  }

  // Uncheck "Include" on the row for "Paid Off Monthly Card".
  const checkbox = await app.browser.$(
    "//tr[td[text()='Paid Off Monthly Card']]//input[@type='checkbox']",
  );
  await checkbox.waitForExist({ timeout: 5000 });
  await checkbox.click();

  const calculateBtn = await app.browser.$("button=Calculate");
  await calculateBtn.click();

  await app.browser.waitUntil(
    async () => /total interest/i.test(await plannerCard.getText()),
    { timeout: 10000, timeoutMsg: "expected a plan result to render after Calculate" },
  );

  const resultsTable = "//table[.//th[text()='Payoff date']]";
  const resultsText = await (await app.browser.$(resultsTable)).getText();
  console.log("results table after excluding:", resultsText);
  if (resultsText.includes("Paid Off Monthly Card")) {
    throw new Error(`excluded debt should NOT appear in the plan results, got:\n${resultsText}`);
  }
  if (!resultsText.includes("Real Debt")) {
    throw new Error(`expected the non-excluded debt in the plan results, got:\n${resultsText}`);
  }

  console.log("FEATURE 19 E2E TEST PASSED");
} finally {
  await app.close();
}
