// E2E smoke test for split transactions: seeds one $100 Target transaction,
// drives the real Ledger UI to split it into Groceries $60 / Household $40,
// confirms the "Split (2)" summary renders, then verifies the underlying
// transaction_splits rows directly in the test database.
//
// Run with: node e2e/feature4_split_transactions.mjs

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

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Groceries')")
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Household')")
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "2026-08-05", "Target", "-100.00", "Groceries", f"{checking_id}|2026-08-05|target|-100.00"),
)
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  const splitToggle = await app.browser.$(".split-toggle");
  await splitToggle.waitForExist({ timeout: 10000 });
  await splitToggle.click();

  // One line is pre-seeded with the full $100 under "Groceries" — change
  // its amount to 60, then add a second line for Household $40.
  const firstAmountInput = await app.browser.$(".split-editor-line .debt-apply-amount");
  await firstAmountInput.setValue("60.00");

  const addLineButton = await app.browser.$("button=Add line");
  await addLineButton.click();

  const amountInputs = await app.browser.$$(".split-editor-line .debt-apply-amount");
  await amountInputs[1].setValue("40.00");
  const categorySelects = await app.browser.$$(".split-editor-line select");
  await categorySelects[1].selectByAttribute("value", "Household");

  const remaining = await app.browser.$(".split-remaining-ok");
  await remaining.waitForExist({ timeout: 5000 });
  console.log("remaining text:", await remaining.getText());

  const saveButton = await app.browser.$("button=Save splits");
  await saveButton.click();

  const summary = await app.browser.$(".split-summary");
  await summary.waitForExist({ timeout: 10000 });
  const summaryText = await summary.getText();
  console.log("split summary:", summaryText);
  if (!summaryText.includes("2")) throw new Error(`expected "Split (2)", got "${summaryText}"`);
} finally {
  await app.close();
}

const splits = query(
  dbDir,
  "SELECT category, amount FROM transaction_splits ORDER BY category",
);
console.log("transaction_splits rows:", splits);
if (splits.length !== 2) throw new Error(`expected 2 split rows, got ${JSON.stringify(splits)}`);
const byCategory = Object.fromEntries(splits);
if (byCategory["Groceries"] !== "-60.00" || byCategory["Household"] !== "-40.00") {
  throw new Error(`unexpected split amounts: ${JSON.stringify(splits)}`);
}

console.log("FEATURE 4 E2E TEST PASSED");
