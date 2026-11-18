// E2E test for a real production bug: transactions categorized "Transfer"
// (money moving between the household's own accounts) were being counted
// as both income and spending everywhere sign-based totals are computed —
// Household's "Income by person"/"Spending by person" cards, and the
// Dashboard/Cash Flow "Income vs. expenses" figures (via Store::
// monthly_totals on the backend). A $6,000 internal transfer (checking ->
// savings) inflated a family member's reported September income from
// $147.70 (real interest) to $8,015.52 in the reported case.
//
// Run with: node e2e/feature50_transfer_excluded_from_income.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today().isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Savings', 'savings', '0.00')")
savings_id = cur.lastrowid
cur.execute("INSERT INTO family_members (name) VALUES ('Joint')")
joint_id = cur.lastrowid

cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint, member_id) VALUES (?, ?, 'Interest Payment', '147.70', 'Income', 'user', 'fp-interest', ?)",
    (savings_id, today, joint_id),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint, member_id) VALUES (?, ?, 'Groceries Run', '-80.00', 'Groceries', 'user', 'fp-groceries', ?)",
    (checking_id, today, joint_id),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint, member_id) VALUES (?, ?, 'Transfer to savings', '-6000.00', 'Transfer', 'user', 'fp-transfer-out', ?)",
    (checking_id, today, joint_id),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint, member_id) VALUES (?, ?, 'Transfer from checking', '6000.00', 'Transfer', 'user', 'fp-transfer-in', ?)",
    (savings_id, today, joint_id),
)
`);

const app = await launchApp({ dbDir });
try {
  const householdNav = await app.browser.$("button*=Household");
  await householdNav.click();

  const incomeCard = await app.browser.$("[data-month-by-person]");
  await incomeCard.waitForExist({ timeout: 10000 });
  const incomeText = await app.browser.execute(() => [...document.querySelectorAll('[data-month-by-person] tbody tr')].map(tr => `${tr.cells[0].textContent}: ${tr.cells[1].textContent}`).join("\n"));
  console.log("income by person card:", incomeText);
  if (!incomeText.includes("147.70")) {
    throw new Error(`expected Joint's real $147.70 interest income, got:\n${incomeText}`);
  }
  if (incomeText.includes("8,015.52") || incomeText.includes("6,147.70")) {
    throw new Error(`the $6,000 transfer must not be counted as income, got:\n${incomeText}`);
  }

  const spendingCard = await app.browser.$("//h2[contains(.,'Spending by person')]/parent::div");
  const spendingText = await spendingCard.getText();
  console.log("spending by person card:", spendingText);
  if (!spendingText.includes("80.00")) {
    throw new Error(`expected Joint's real $80.00 grocery spending, got:\n${spendingText}`);
  }
  if (spendingText.includes("6,080.00")) {
    throw new Error(`the $6,000 transfer must not be counted as spending, got:\n${spendingText}`);
  }
  console.log("Household correctly excludes the Transfer pair from both income and spending");

  const cashFlowNav = await app.browser.$("button*=Cash Flow");
  await cashFlowNav.click();

  // Income vs. expenses is in Cash Flow's "Month by month" tab (VS-31).
  await (await app.browser.$("#cashflow-tab-by-month")).waitForDisplayed({ timeout: 10000 });
  await (await app.browser.$("#cashflow-tab-by-month")).click();
  const legend = await app.browser.$("#cashflow-panel-by-month .chart-legend");
  await legend.waitForExist({ timeout: 10000 });
  const legendText = await legend.getText();
  console.log("cash flow legend:", legendText);
  if (!legendText.includes("147.70")) {
    throw new Error(`expected Cash Flow's Income total to include the real $147.70, got:\n${legendText}`);
  }
  if (legendText.includes("6,147.70") || legendText.includes("6,080.00")) {
    throw new Error(`expected Cash Flow's Income/Expenses to exclude the $6,000 transfer, got:\n${legendText}`);
  }

  console.log("FEATURE 50 E2E TEST PASSED");
} finally {
  await app.close();
}
