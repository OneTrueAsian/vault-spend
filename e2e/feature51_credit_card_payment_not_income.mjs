// E2E test for a real production bug: a credit card payment recorded as a
// plain, unlinked deposit on the credit account (not via "Apply payment
// toward a debt account") was counted as income — inflating a family
// member's reported September income from $147.70 (real interest) to
// $2,015.52. Fixed with a blanket rule: a positive amount on a credit or
// loan account is never income, regardless of category or linkage —
// Store::monthly_totals (Dashboard/Cash Flow) and memberBreakdowns.ts
// (Household) both apply it. Unlike feature50 (the Transfer exclusion),
// this needs no linking action at all — the math is just correct.
//
// Run with: node e2e/feature51_credit_card_payment_not_income.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today().isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('HYSA', 'savings', '0.00')")
savings_id = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Capital One', 'credit', '2000.00')")
credit_id = cur.lastrowid
cur.execute("INSERT INTO family_members (name) VALUES ('Joint')")
joint_id = cur.lastrowid

cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint, member_id) VALUES (?, ?, 'Interest Payment', '147.70', 'Income', 'user', 'fp-interest', ?)",
    (savings_id, today, joint_id),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint, member_id) VALUES (?, ?, 'WITHDRAWAL CAPITAL ONE', '-1867.82', 'Credit Card Payment', 'user', 'fp-withdrawal', ?)",
    (checking_id, today, joint_id),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint, member_id) VALUES (?, ?, 'CAPITAL ONE ONLINE PYMT', '1867.82', 'Credit Card Payment', 'user', 'fp-deposit', ?)",
    (credit_id, today, joint_id),
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
  if (incomeText.includes("2,015.52") || incomeText.includes("1,867.82")) {
    throw new Error(`the Capital One payment must not be counted as income, got:\n${incomeText}`);
  }
  console.log("Household correctly excludes the unlinked credit card payment from income");

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
  if (legendText.includes("2,015.52") || legendText.includes("1,867.82 income") || legendText.includes("2015.52")) {
    throw new Error(`expected Cash Flow's Income to exclude the credit card payment, got:\n${legendText}`);
  }
  // The checking withdrawal still counts as ordinary spending.
  if (!legendText.includes("1,867.82")) {
    throw new Error(`expected the checking withdrawal to still count as spending, got:\n${legendText}`);
  }

  console.log("FEATURE 51 E2E TEST PASSED");
} finally {
  await app.close();
}
