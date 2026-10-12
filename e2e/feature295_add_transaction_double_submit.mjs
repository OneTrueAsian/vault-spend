// Pressing Add transaction twice in a row (a double click, or Enter then a click) must add one row.
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { isoDaysFromNow } from "./lib/dates.mjs";
import { enterTransactionAmount } from "./lib/transactionAmount.mjs";

const TODAY = isoDaysFromNow(0);
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '1000.00')")
acct = cur.lastrowid
for d, desc, amt in (("${TODAY}", "Corner Bakery", "-12.40"), ("${TODAY}", "Fuel Stop", "-41.00"), ("${TODAY}", "Hardware Store", "-8.10")):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, amt, "Groceries", "user", f"{acct}|{d}|{desc.lower()}|{amt}"))
`);
const dbPath = path.join(dbDir, "vaultspend.db");
const countRows = (description) =>
  Number(
    execFileSync("python", [
      "-c",
      "import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);print(c.execute('SELECT COUNT(*) FROM transactions WHERE description=? AND deleted_at IS NULL',(sys.argv[2],)).fetchone()[0])",
      dbPath,
      description,
    ])
      .toString()
      .trim(),
  );

const app = await launchApp({ dbDir });
const { browser } = app;
try {
  await (await browser.$(".nav-item[data-tab=ledger]")).click();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.querySelectorAll("table.ledger tbody tr[data-payment-row]").length >= 3), {
    timeout: 20000,
    timeoutMsg: "the Transactions table should list the seeded transactions",
  });
  await (await browser.$("button*=Add transaction")).click();
  const panel = await browser.$(".modal-panel");
  await panel.waitForDisplayed({ timeout: 10000 });
  await (await panel.$('input[placeholder=\'e.g. "Coffee shop"\']')).setValue("Double Press Check");
  await enterTransactionAmount(browser, panel, "-9.99");
  // Two submissions in the same tick: nothing can have re-rendered between them.
  await browser.execute(() => {
    const form = document.querySelector(".modal-panel form");
    form.requestSubmit();
    form.requestSubmit();
  });
  await waitUntilOrDiagnose(browser, () => browser.execute(() => !document.querySelector(".modal-panel")), {
    timeoutMsg: "the dialog should close once the transaction is added",
  });
  assert.equal(countRows("Double Press Check"), 1, "one press of Add transaction twice must add exactly one transaction");
} finally {
  await app.close();
}
console.log("FEATURE 295 ADD TRANSACTION DOUBLE SUBMIT PASSED");
