// E2E test for the "Add transaction" dialog's backdated-transaction
// warning: a transaction dated on or before an account's last balance
// checkpoint (a monthly rollover or manual correction) can't move today's
// balance — see Store::account_balance_as_of's `since_date` on the
// backend. The dialog should warn about this instead of letting it be a
// silent surprise (the real scenario that prompted this feature: an old
// transaction added to a Car Loan account left "owed" completely
// unchanged with no explanation).
//
// Run with: node e2e/feature58_backdated_transaction_warning.mjs

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

// Local-date math (not toISOString, which reads the UTC calendar day and
// can silently land on the wrong side of a day boundary — see format.ts's
// own toLocalIsoDate doc comment) so the checkpoint date seeded here and
// the date typed into the UI agree exactly.
function isoDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
const yesterday = isoDateDaysAgo(1);
const today = isoDateDaysAgo(0);

// A checking account whose balance was manually corrected as of
// "yesterday" — the same checkpoint shape a monthly rollover produces.
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute(
    "INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?, ?, ?, ?)",
    (checking_id, "manual:${yesterday}", "${yesterday}", "1200.00"),
)
`);

async function setDateField(browser, iso) {
  const input = await browser.$('input[type="date"]');
  await input.waitForExist({ timeout: 10000 });
  // Native date inputs need their value set directly and a React-visible
  // "input" event fired — plain setValue/keys unreliably round-trips
  // through the OS date picker under WebDriver.
  await browser.execute((el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, input, iso);
  return input;
}

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  const addButton = await app.browser.$("button*=Add transaction");
  await addButton.waitForExist({ timeout: 10000 });
  await addButton.click();

  // Dated exactly on the checkpoint — this transaction cannot move
  // today's balance. Warning must appear, naming the account and the
  // checkpoint date.
  await setDateField(app.browser, yesterday);
  const warning = await app.browser.$(".field-warning");
  await warning.waitForExist({ timeout: 5000 });
  const warningText = await warning.getText();
  console.log("warning text (backdated):", warningText);
  if (!warningText.includes("Checking") || !warningText.includes(yesterday)) {
    throw new Error(`expected the warning to name the account and checkpoint date (${yesterday}): "${warningText}"`);
  }

  // Today's default date is always after any checkpoint (a checkpoint is
  // always dated at latest yesterday) — the warning must disappear.
  await setDateField(app.browser, today);
  const stillWarning = await app.browser.$$(".field-warning");
  if (stillWarning.length !== 0) {
    throw new Error(`expected the warning to be gone for a today-dated transaction, found ${stillWarning.length}`);
  }

  // Actually submit the backdated one, matching the real scenario: old
  // transaction, dated on the checkpoint.
  await setDateField(app.browser, yesterday);
  const descriptionInput = await app.browser.$('input[placeholder=\'e.g. "Coffee shop"\']');
  await descriptionInput.setValue("Old grocery run");
  const amountInput = await app.browser.$("input[placeholder='Negative = money out']");
  await amountInput.setValue("-50.00");
  const submit = await app.browser.$("button=Add transaction");
  await submit.click();

  // Wait for the ledger refresh to actually land (the new row showing up
  // is the signal) before checking the Accounts page's balance.
  await app.browser.waitUntil(
    async () => {
      const rows = await app.browser.$$("tbody tr");
      return rows.length >= 1;
    },
    { timeout: 10000 },
  );

  const accountsNav = await app.browser.$("button*=Accounts");
  await accountsNav.click();
  const balanceEl = await app.browser.$(".bal.amount-editable");
  await balanceEl.waitForExist({ timeout: 10000 });
  const balanceText = await balanceEl.getText();
  console.log("balance after adding the backdated transaction:", balanceText);
  if (!balanceText.includes("1,200.00")) {
    throw new Error(`expected the backdated transaction to leave today's balance at $1,200.00 (unchanged), got "${balanceText}"`);
  }
} finally {
  await app.close();
}

// Confirm directly in the database too: the transaction really was
// recorded (not silently dropped), it's only excluded from today's sum.
const txRow = query(dbDir, "SELECT amount, date FROM transactions WHERE description = 'Old grocery run'");
console.log("transaction row:", txRow);
if (txRow.length !== 1 || txRow[0][0] !== "-50.00" || txRow[0][1] !== yesterday) {
  throw new Error(`expected one -50.00 transaction dated ${yesterday}, got ${JSON.stringify(txRow)}`);
}

console.log("FEATURE 58 E2E TEST PASSED");
