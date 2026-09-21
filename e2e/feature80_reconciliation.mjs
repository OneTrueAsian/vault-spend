// E2E test for Phase 2 item 4 (account detail page + reconciliation):
//   - Accounts -> Details opens the account's own page with a balance chart;
//   - Reconcile: enter a statement's ending balance, tick the transactions on
//     it, and the Difference reaches $0.00 — only then can it be finished;
//   - finishing is remembered ("Last reconciled"), settled rows drop out of the
//     next reconciliation, and the transaction list marks cleared rows.
//
// Run with: node e2e/feature80_reconciliation.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '1000.00')")
acct = cur.lastrowid
for days, desc, amt in ((40, "Deposit", "200.00"), (30, "Coffee", "-50.00"), (10, "Gas", "-30.00"), (5, "Lunch", "-20.00")):
    d = (today - datetime.timedelta(days=days)).isoformat()
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, amt, None, None, f"{acct}|{d}|{desc.lower()}|{amt}"))
`);

const todayIso = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
const row = (desc) => browser.$(`[data-reconcile-row='${desc}']`);
async function tick(desc) {
  await (await (await row(desc)).$("input[type='checkbox']")).click();
}
async function differenceText() {
  return (await (await browser.$("[data-difference]")).getText()).trim();
}
async function waitForDifference(expected) {
  await browser.waitUntil(async () => (await differenceText()) === expected, {
    timeout: 10000,
    timeoutMsg: `the difference should read ${expected}, it reads ${await differenceText()}`,
  });
}

try {
  await browser.setWindowSize(1440, 1400);
  await nav("Accounts");
  await (await browser.$("[data-account-details]")).click();
  const page = await browser.$("[data-account-detail]");
  await page.waitForExist({ timeout: 10000, timeoutMsg: "Details should open the account's page" });
  await browser.waitUntil(async () => (await page.getText()).includes("Everyday Checking"), { timeout: 5000 });
  if (!(await page.$("svg").isExisting())) throw new Error("the balance history should draw a chart");
  if ((await (await browser.$("[data-last-reconciled]")).getText()).includes(todayIso)) throw new Error("nothing has been reconciled yet");

  // --- start ---------------------------------------------------------------------
  const balance = await browser.$("[data-statement-balance]");
  await balance.setValue("1120.00");
  await (await browser.$("[data-reconcile-start]")).click();
  await browser.$("[data-reconcile-summary]").waitForExist({ timeout: 10000 });
  await row("Lunch").waitForExist({ timeout: 10000 });
  await waitForDifference("$120.00"); // statement $1,120.00 vs a $1,000.00 opening balance
  if (!(await (await browser.$("[data-reconcile-finish]")).getAttribute("disabled"))) throw new Error("Finish must be disabled until the difference is zero");

  // --- tick what's on the statement -------------------------------------------------
  await tick("Deposit");
  await waitForDifference("-$80.00");
  await tick("Coffee");
  await waitForDifference("-$30.00");
  await tick("Gas");
  await waitForDifference("$0.00");
  if ((await (await browser.$("[data-difference]")).getAttribute("data-balanced")) !== "true") throw new Error("a zero difference should read as balanced");
  if (await (await browser.$("[data-reconcile-finish]")).getAttribute("disabled")) throw new Error("Finish should be enabled at $0.00");

  // A mistaken tick throws it off again.
  await tick("Lunch");
  await waitForDifference("$20.00"); // clearing a $20 charge the statement doesn't have: statement 1,120 vs cleared 1,100
  if (!(await (await browser.$("[data-reconcile-finish]")).getAttribute("disabled"))) throw new Error("Finish must be disabled again");
  await tick("Lunch");
  await waitForDifference("$0.00");

  // --- finish ---------------------------------------------------------------------------
  await (await browser.$("[data-reconcile-finish]")).click();
  await browser.waitUntil(async () => (await (await browser.$("[data-last-reconciled]")).getText()).includes(todayIso), {
    timeout: 10000,
    timeoutMsg: "the page should show today as the last reconciled date",
  });
  await browser.$("[data-reconcile-start]").waitForExist({ timeout: 10000 });

  // Cleared rows are marked in the transaction list (3 of the 4).
  const marks = await browser.$$("//table//td[contains(@class,'dup-review-check')][normalize-space()='✓']");
  if (marks.length !== 3) throw new Error(`three transactions should be marked cleared, found ${marks.length}`);

  // --- the next reconciliation only offers what's left ------------------------------
  await (await browser.$("[data-statement-balance]")).setValue("1100.00");
  await (await browser.$("[data-reconcile-start]")).click();
  await row("Lunch").waitForExist({ timeout: 10000 });
  const offered = await browser.$$("[data-reconcile-row]");
  if (offered.length !== 1) throw new Error(`only the uncleared Lunch row should be offered, got ${offered.length}`);
  await tick("Lunch");
  await waitForDifference("$0.00");

  // --- back ---------------------------------------------------------------------------------
  await (await browser.$("[data-account-back]")).click();
  await browser.$("//h1[normalize-space()='Accounts']").waitForExist({ timeout: 10000 });

  console.log("FEATURE 80 E2E TEST PASSED");
} finally {
  await app.close();
}
