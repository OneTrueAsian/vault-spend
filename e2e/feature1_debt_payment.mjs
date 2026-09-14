// E2E smoke test for "apply a payment to a debt": seeds a checking account
// with a payment transaction and a loan account, drives the real Ledger UI
// to apply the payment, then verifies the result directly in the test
// database (more reliable than scraping formatted currency text back out
// of the DOM, and just as trustworthy — it's the same underlying command).
//
// Run with: node e2e/feature1_debt_payment.mjs

import { launchApp } from "./harness.mjs";
import { seedDebtPaymentFixture } from "./lib/seed.mjs";
import { execFileSync } from "node:child_process";
import path from "node:path";

function query(dbDir, sql) {
  const dbPath = path.join(dbDir, "vaultspend.db");
  const out = execFileSync("python", [
    "-c",
    `
import sqlite3, json
con = sqlite3.connect(r"${dbPath}")
cur = con.cursor()
cur.execute("""${sql}""")
print(json.dumps(cur.fetchall()))
`,
  ]);
  return JSON.parse(out.toString());
}

const dbDir = await seedDebtPaymentFixture();
const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  const applyButton = await app.browser.$(".debt-apply-trigger");
  await applyButton.waitForExist({ timeout: 10000 });
  await applyButton.click();

  // The amount field should already be pre-filled with the transaction's
  // own amount (500.00) — leave it as-is and just confirm.
  const applyConfirm = await app.browser.$(".debt-apply-confirm");
  await applyConfirm.waitForExist({ timeout: 5000 });
  await applyConfirm.click();

  // Wait for the optimistic refresh to land: the "Apply to a debt" button
  // for this row should disappear, replaced by the "→ Car Loan" badge.
  const badge = await app.browser.$(".debt-applied-badge");
  await badge.waitForExist({ timeout: 10000 });
  const badgeText = await badge.getText();
  console.log("badge text:", badgeText);
  if (!badgeText.includes("Car Loan")) throw new Error(`expected badge to mention "Car Loan", got "${badgeText}"`);
} finally {
  await app.close();
}

// Verify directly in the database: two transactions now exist (the source
// payment plus the generated one on the loan account), one debt_payments
// link row, and the loan's generated transaction is 500.00 (positive — a
// payment reduces what's owed, same sign convention as a credit payment).
const txCount = query(dbDir, "SELECT COUNT(*) FROM transactions");
const linkCount = query(dbDir, "SELECT COUNT(*) FROM debt_payments");
const loanTx = query(
  dbDir,
  "SELECT amount FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.name = 'Car Loan'",
);

console.log("transaction count:", txCount, "debt_payments rows:", linkCount, "loan account transactions:", loanTx);

if (txCount[0][0] !== 2) throw new Error(`expected 2 transactions, got ${txCount[0][0]}`);
if (linkCount[0][0] !== 1) throw new Error(`expected 1 debt_payments row, got ${linkCount[0][0]}`);
if (loanTx.length !== 1 || loanTx[0][0] !== "500.00") {
  throw new Error(`expected the loan account to have one 500.00 transaction, got ${JSON.stringify(loanTx)}`);
}

console.log("FEATURE 1 E2E TEST PASSED");
