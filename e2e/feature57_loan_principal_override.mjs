// E2E test for the loan "principal override": a transaction recorded
// directly on a loan account (as opposed to via "Apply to a debt" from a
// different account) can specify that only part of it counts toward what's
// owed — the mortgage-payment-bundles-principal-and-escrow scenario.
//
// Run with: node e2e/feature57_loan_principal_override.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
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

// A Mortgage (loan) account starting at 300000.00 owed, with one $2500
// payment recorded directly on it (no checking-account leg at all) — the
// exact real-world scenario a mortgage statement produces.
const dbDir = await seedFixture(`
import datetime
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Mortgage', 'loan', '300000.00')")
loan_id = cur.lastrowid
today = datetime.date.today().isoformat()
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (loan_id, today, "Mortgage Payment", "2500.00", "Housing", "fp-mortgage-1"),
)
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  const splitTrigger = await app.browser.$(".debt-apply-trigger");
  await splitTrigger.waitForExist({ timeout: 10000 });
  const triggerText = await splitTrigger.getText();
  if (!triggerText.includes("Split principal")) throw new Error(`expected "Split principal" trigger, got "${triggerText}"`);
  await splitTrigger.click();

  // The amount field pre-fills with the full transaction amount (2500.00)
  // — clear it and type just the principal portion.
  const amountInput = await app.browser.$(".debt-apply-amount");
  await amountInput.waitForExist({ timeout: 5000 });
  await amountInput.setValue("500.00");

  const confirm = await app.browser.$(".debt-apply-confirm");
  await confirm.click();

  // Wait for the optimistic refresh: the trigger button is replaced by a
  // "Principal: $500.00" badge.
  const badge = await app.browser.$(".debt-applied-badge");
  await badge.waitForExist({ timeout: 10000 });
  const badgeText = await badge.getText();
  console.log("badge text:", badgeText);
  if (!badgeText.includes("Principal") || !badgeText.includes("500.00")) {
    throw new Error(`expected a "Principal: $500.00" badge, got "${badgeText}"`);
  }
} finally {
  await app.close();
}

// Verify directly in the database: the transaction's own amount stays the
// full 2500.00 (for record-keeping), but principal_amount is 500.00, and
// only that reduces what's owed: 300000 - 500 = 299500.
const txRow = query(dbDir, "SELECT amount, principal_amount FROM transactions WHERE description = 'Mortgage Payment'");
console.log("transaction row:", txRow);
if (txRow.length !== 1 || txRow[0][0] !== "2500.00" || txRow[0][1] !== "500.00") {
  throw new Error(`expected amount=2500.00, principal_amount=500.00, got ${JSON.stringify(txRow)}`);
}

// Verify the actual computed balance too, not just the stored row — read
// the real Accounts tab figure (AccountsView.tsx renders it as
// `Owed ${formatAmount(owed)}` in a `.bal.amount-editable` span).
const app2 = await launchApp({ dbDir });
let owedText;
try {
  const accountsNav = await app2.browser.$("button*=Accounts");
  await accountsNav.click();
  const owedEl = await app2.browser.$(".bal.amount-editable");
  await owedEl.waitForExist({ timeout: 10000 });
  owedText = await owedEl.getText();
} finally {
  await app2.close();
}
console.log("Accounts tab owed text:", owedText);
if (!owedText.includes("299,500.00")) {
  throw new Error(`expected the Mortgage's owed amount to read "Owed $299,500.00" (only the $500 principal counted), got "${owedText}"`);
}

console.log("FEATURE 57 E2E TEST PASSED");
