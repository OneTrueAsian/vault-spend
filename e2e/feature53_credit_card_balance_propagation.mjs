// A dynamic QA sweep for credit card balance propagation: starting from a
// clean, empty credit card, drives the real UI to add a charge, add a
// payment, then delete the charge — checking after every single step that
// the account's own Owed/Available figures, Net Worth, Total Liabilities,
// and Cash Flow's income/expense totals all update correctly together.
// Unlike feature51/52 (which seed the final state directly), this exercises
// the actual mutation commands (create_manual_transaction, delete_transaction)
// live, the same way a real user's actions would.
//
// Run with: node e2e/feature53_credit_card_balance_propagation.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Visa', 'credit', '2000.00')")
`);

// Word-boundary match on class "stat" — a naive contains(@class,'stat')
// also matches the outer .stats *container* ("stats" contains "stat").
async function statValue(app, label) {
  const stat = await app.browser.$(
    `//*[contains(concat(' ', normalize-space(@class), ' '), ' stat ')][.//span[text()='${label}']]`,
  );
  return (await stat.$(".stat-value")).getText();
}

async function visaOwedAndAvailable(app) {
  const card = await app.browser.$("//div[contains(@class,'account-card')][.//div[contains(@class,'account-name-cell')][text()='Visa']]");
  const owed = await (await card.$(".bal")).getText();
  const available = await (await card.$(".sub.amount-editable")).getText();
  return { owed, available };
}

async function addTransaction(app, { accountName, description, amount }) {
  const addBtn = await app.browser.$("button*=Add transaction");
  await addBtn.click();
  const dialog = await app.browser.$("//h2[contains(@class,'modal-title')][text()='Add transaction']");
  await dialog.waitForExist({ timeout: 10000 });
  const panel = await app.browser.$(".modal-panel");

  // "Account" is the dialog's first field/select, in document order.
  const accountSelect = (await panel.$$("select"))[0];
  await accountSelect.selectByVisibleText(accountName);
  await (await panel.$("input[placeholder='e.g. \"Coffee shop\"']")).setValue(description);
  await (await panel.$("input[placeholder='Negative = money out']")).setValue(amount);

  const submit = await panel.$("button=Add transaction");
  await submit.click();
  await dialog.waitForExist({ timeout: 5000, reverse: true });
}

async function deleteTransaction(app, description) {
  const row = await app.browser.$(`//tr[td[contains(.,'${description}')]]`);
  const deleteBtn = await row.$("button=Delete");
  await deleteBtn.click();
  const confirmBtn = await row.$(".btn-danger");
  await confirmBtn.waitForExist({ timeout: 5000 });
  await confirmBtn.click();
  await row.waitForExist({ timeout: 5000, reverse: true });
}

async function cashFlowLegendText(app) {
  const cashFlowNav = await app.browser.$("button*=Cash Flow");
  await cashFlowNav.click();
  const legend = await app.browser.$(".chart-legend");
  await legend.waitForExist({ timeout: 10000 });
  return legend.getText();
}

const app = await launchApp({ dbDir });
try {
  // --- Baseline: a brand-new, unused credit card ---
  const accountsNav = await app.browser.$("button*=Accounts");
  await accountsNav.click();
  await (await app.browser.$(".account-card")).waitForExist({ timeout: 10000 });

  let { owed, available } = await visaOwedAndAvailable(app);
  console.log("baseline:", { owed, available });
  if (owed !== "Owed $0.00") throw new Error(`expected a fresh card to owe $0.00, got "${owed}"`);
  if (available !== "Available $2,000.00") throw new Error(`expected $2,000.00 available, got "${available}"`);

  let netWorth = await statValue(app, "Net Worth");
  if (netWorth !== "$5,000.00") throw new Error(`expected baseline Net Worth $5,000.00 (unused credit contributes $0), got ${netWorth}`);
  console.log("Baseline correct: unused credit card owes $0 and contributes nothing to net worth");

  // --- Action A: add a $300 charge on Visa ---
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();
  await addTransaction(app, { accountName: "Visa", description: "Grocery Charge", amount: "-300.00" });
  await (await app.browser.$(".page")).waitForExist({ timeout: 5000 });
  await app.browser.waitUntil(async () => (await (await app.browser.$(".page")).getText()).includes("Grocery Charge"), {
    timeout: 10000,
    timeoutMsg: "expected the new charge to appear in the Ledger",
  });

  await accountsNav.click();
  ({ owed, available } = await visaOwedAndAvailable(app));
  console.log("after $300 charge:", { owed, available });
  if (owed !== "Owed $300.00") throw new Error(`expected $300.00 owed after the charge, got "${owed}"`);
  if (available !== "Available $1,700.00") throw new Error(`expected $1,700.00 available after the charge, got "${available}"`);

  netWorth = await statValue(app, "Net Worth");
  if (netWorth !== "$4,700.00") throw new Error(`expected Net Worth $4,700.00 after the $300 charge, got ${netWorth}`);
  let liabilities = await statValue(app, "Total Liabilities");
  if (liabilities !== "-$300.00") throw new Error(`expected Total Liabilities -$300.00, got ${liabilities}`);

  let legendText = await cashFlowLegendText(app);
  if (!legendText.includes("Income · $0.00")) throw new Error(`expected $0.00 income, got:\n${legendText}`);
  if (!legendText.includes("Expenses · $300.00")) throw new Error(`expected $300.00 expense from the charge, got:\n${legendText}`);
  console.log("Charge correctly increases owed, decreases available, and counts as spending everywhere");

  // --- Action B: add a $150 payment on Visa (a positive amount, added
  // live through the real UI — not pre-seeded — must never count as
  // income, per this release's blanket rule) ---
  await ledgerNav.click();
  await addTransaction(app, { accountName: "Visa", description: "CC Payment", amount: "150.00" });
  await app.browser.waitUntil(async () => (await (await app.browser.$(".page")).getText()).includes("CC Payment"), {
    timeout: 10000,
    timeoutMsg: "expected the new payment to appear in the Ledger",
  });

  await accountsNav.click();
  ({ owed, available } = await visaOwedAndAvailable(app));
  console.log("after $150 payment:", { owed, available });
  if (owed !== "Owed $150.00") throw new Error(`expected $150.00 owed after the payment, got "${owed}"`);
  if (available !== "Available $1,850.00") throw new Error(`expected $1,850.00 available after the payment, got "${available}"`);

  netWorth = await statValue(app, "Net Worth");
  if (netWorth !== "$4,850.00") throw new Error(`expected Net Worth $4,850.00 after the payment, got ${netWorth}`);

  legendText = await cashFlowLegendText(app);
  if (!legendText.includes("Income · $0.00")) {
    throw new Error(`the live-added $150 credit card payment must not count as income, got:\n${legendText}`);
  }
  if (!legendText.includes("Expenses · $300.00")) {
    throw new Error(`expenses should be unaffected by the payment (still just the $300 charge), got:\n${legendText}`);
  }
  console.log("Payment correctly decreases owed, increases available, and is never counted as income");

  // --- Action C: delete the original charge, leaving only the payment
  // (an intentionally unusual "overpaid" state — the card now owes a
  // negative amount, i.e. it's owed money back) ---
  await ledgerNav.click();
  await deleteTransaction(app, "Grocery Charge");
  await app.browser.waitUntil(
    async () => !(await (await app.browser.$(".page")).getText()).includes("Grocery Charge"),
    { timeout: 10000, timeoutMsg: "expected the deleted charge to disappear from the Ledger" },
  );

  await accountsNav.click();
  ({ owed, available } = await visaOwedAndAvailable(app));
  console.log("after deleting the charge:", { owed, available });
  if (owed !== "Owed -$150.00") throw new Error(`expected an overpaid $-150.00 owed, got "${owed}"`);
  if (available !== "Available $2,150.00") throw new Error(`expected $2,150.00 available, got "${available}"`);

  netWorth = await statValue(app, "Net Worth");
  if (netWorth !== "$5,150.00") throw new Error(`expected Net Worth $5,150.00 (checking $5,000 + $150 overpayment), got ${netWorth}`);
  liabilities = await statValue(app, "Total Liabilities");
  if (liabilities !== "$150.00") {
    throw new Error(`expected Total Liabilities to flip to +$150.00 once overpaid (documented sign convention), got ${liabilities}`);
  }

  legendText = await cashFlowLegendText(app);
  if (!legendText.includes("Income · $0.00") || !legendText.includes("Expenses · $0.00")) {
    throw new Error(`expected both income and expense back to $0.00 after deleting the only charge, got:\n${legendText}`);
  }
  console.log("Deleting the charge correctly reverts the balance, net worth, and cash flow everywhere");

  console.log("FEATURE 53 E2E TEST PASSED");
} finally {
  await app.close();
}
