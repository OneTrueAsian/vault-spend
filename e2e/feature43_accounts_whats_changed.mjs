// E2E test for the Accounts tab's "What changed" breakdown (U-2 from the
// performance/UI review): AccountsView's stat panels share the exact same
// StatDetailPanel component the Dashboard's do, but previously never
// passed it `changeRows` — this confirms the same account_contribution_deltas
// data now flows through to Accounts too, not just Dashboard.
//
// Reuses feature42's fixture shape: a loan growing from $5,000 to $8,000
// owed, and a flat $10,000 loan, over the same trailing-months window.
//
// Run with: node e2e/feature43_accounts_whats_changed.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { monthFromNow } from "./lib/dates.mjs";

function loanResetsFixture(name, varName, balances) {
  // The five months before this one: the Dashboard/Accounts delta spans the trailing 6 months ending now, so a fixed
  // calendar would slide out of the window as time passes.
  const periods = [-5, -4, -3, -2, -1].map((offset) => monthFromNow(offset));
  const rows = periods.map((period, i) => `("${period}", "${period}-28", "${balances[i].toFixed(2)}")`).join(", ");
  return `
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('${name}', 'loan', '${balances[0].toFixed(2)}')")
${varName}_id = cur.lastrowid
for period, reset_date, balance in [${rows}]:
    cur.execute(
        "INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?, ?, ?, ?)",
        (${varName}_id, period, reset_date, balance),
    )
`;
}

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '4000.00')")
${loanResetsFixture("Auto Loan", "auto_loan", [5000, 6000, 6500, 7000, 8000])}
${loanResetsFixture("Mortgage", "mortgage", [10000, 10000, 10000, 10000, 10000])}
`);

const app = await launchApp({ dbDir });
try {
  const accountsNav = await app.browser.$("button*=Accounts");
  await accountsNav.click();

  const liabilitiesStat = await app.browser.$("button*=What you owe");
  await liabilitiesStat.waitForExist({ timeout: 10000 });
  await liabilitiesStat.click();

  const panel = await app.browser.$(".stat-detail-panel");
  await panel.waitForExist({ timeout: 5000 });
  const panelText = await panel.getText();
  console.log("accounts liabilities detail panel:", panelText);

  if (!panelText.includes("What changed")) {
    throw new Error(`expected a "What changed" section on the Accounts tab: ${panelText}`);
  }
  if (!panelText.includes("Auto Loan") || !panelText.includes("▲") || !panelText.includes("3,000.00")) {
    throw new Error(`expected Auto Loan's $3,000 increase to be called out: ${panelText}`);
  }

  console.log("FEATURE 43 E2E TEST PASSED");
} finally {
  await app.close();
}
