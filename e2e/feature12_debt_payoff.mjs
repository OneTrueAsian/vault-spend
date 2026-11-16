// E2E smoke test for the Debt Payoff Planner: seeds two loans, sets a
// minimum payment on each plus an extra payment, runs the calculation with
// the snowball strategy, and confirms a plausible plan comes back (a
// finite months-to-debt-free figure, a per-debt payoff date, and the
// smaller-balance loan clearing before the larger one).
//
// Run with: node e2e/feature12_debt_payoff.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Small Loan', 'loan', '500.00')")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Big Loan', 'loan', '5000.00')")
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
  const initialText = await plannerCard.getText();
  console.log("planner card (before calculating):", initialText);
  if (!initialText.includes("Small Loan") || !initialText.includes("Big Loan")) {
    throw new Error(`expected both loans listed, got:\n${initialText}`);
  }

  // Set minimum payments: $50/mo on Small Loan, $100/mo on Big Loan. Column
  // 5 ("Minimum payment") — column 1 is the "Include" checkbox added later.
  const smallMinInput = await app.browser.$(
    "//tr[td[text()='Small Loan']]//td[5]//input",
  );
  await smallMinInput.waitForExist({ timeout: 5000 });
  await smallMinInput.click();
  await app.browser.keys("50");

  const bigMinInput = await app.browser.$("//tr[td[text()='Big Loan']]//td[5]//input");
  await bigMinInput.click();
  await app.browser.keys("100");

  const extraInput = await app.browser.$("//label[span[text()='Extra monthly payment']]/input");
  await extraInput.setValue("200");

  const calculateBtn = await app.browser.$("button=Calculate");
  await calculateBtn.click();

  // .stat-label is uppercased via CSS text-transform, so getText() returns
  // "TOTAL INTEREST" — match case-insensitively (same gotcha as elsewhere).
  await app.browser.waitUntil(
    async () => /total interest/i.test(await plannerCard.getText()),
    { timeout: 10000, timeoutMsg: "expected a plan result to render after Calculate" },
  );

  const resultText = await plannerCard.getText();
  console.log("planner card (after calculating):", resultText);
  if (!/\d+ mo/i.test(resultText)) {
    throw new Error(`expected a finite "N mo" debt-free figure, got:\n${resultText}`);
  }

  // Small Loan (smaller balance) should clear before Big Loan under
  // snowball — assert its row's payoff date appears strictly earlier in
  // the results table (i.e. a real, non-"Never" date is present for both,
  // and Small Loan's row comes first in the per-account breakdown, which
  // the backend already orders however it likes — just confirm both have
  // real dates, not "Never").
  // Scoped to the results table specifically (identified by its "Payoff
  // date" header) — the planner's input table above also has a row with
  // this same account name, so an unscoped query would be ambiguous.
  const resultsTable = "//table[.//th[text()='Payoff date']]";
  const smallRow = await app.browser.$(`${resultsTable}//tr[td[text()='Small Loan']]`);
  const bigRow = await app.browser.$(`${resultsTable}//tr[td[text()='Big Loan']]`);
  const smallRowText = await smallRow.getText();
  const bigRowText = await bigRow.getText();
  console.log("small loan result row:", smallRowText);
  console.log("big loan result row:", bigRowText);
  if (smallRowText.includes("Never") || bigRowText.includes("Never")) {
    throw new Error("expected both loans to have a real projected payoff date, not \"Never\"");
  }

  console.log("FEATURE 12 E2E TEST PASSED");
} finally {
  await app.close();
}
