// E2E test: adding an account with a name already in use is refused, and never changes the existing
// account (2026-10-02 QA, H1: "CAR LOAN" used to reset Car Loan's balance, bank and digits).
//
// - The New account dialog flags a taken name as the person types (ignoring case and spaces) and
//   keeps "Create account" disabled; a new name enables it again.
// - The backend refuses the same name on its own, with a plain message, and leaves the account as is.
//
// Run with: node e2e/feature155_duplicate_account_name.mjs

import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { seedDemoDatabase } from "./lib/demo-seed.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";

const invoke = (browser, cmd, args = {}) =>
  browser.executeAsync((c, a, done) => window.__TAURI_INTERNALS__.invoke(c, a).then((v) => done({ ok: v }), (e) => done({ error: String(e) })), cmd, args);

const dbDir = freshTestDbDir();
await seedDemoDatabase(dbDir);
const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  const before = (await invoke(browser, "list_accounts")).ok;
  const loan = before.find((a) => a.name === "Car Loan");
  assert.ok(loan, "the demo data has a Car Loan");

  // The dialog
  await browser.execute(() => [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === "Accounts").click());
  const add = await browser.$("button*=Add account");
  await add.waitForExist({ timeout: 10000 });
  await add.click();
  const name = await browser.$('input[placeholder=\'e.g. "Everyday Checking"\']');
  await name.waitForExist({ timeout: 5000 });
  await name.setValue("  car LOAN ");
  const error = await browser.$("#new-account-name-error");
  await error.waitForExist({ timeout: 3000, timeoutMsg: "the taken name should be flagged" });
  assert.match(await error.getText(), /You already have an account called "Car Loan"/);
  assert.equal(await name.getAttribute("aria-invalid"), "true");
  const create = await browser.$("button=Create account");
  assert.equal(await create.isEnabled(), false, "Create account stays disabled for a taken name");

  await name.setValue("Car Loan 2");
  await browser.waitUntil(async () => !(await browser.$("#new-account-name-error").isExisting()), { timeout: 3000, timeoutMsg: "a new name clears the message" });
  assert.equal(await create.isEnabled(), true);
  await (await browser.$("button=Cancel")).click();

  // The backend, on its own
  const refused = await invoke(browser, "create_account", {
    name: "car loan", accountType: "checking", startingBalance: "0", institution: "Other Bank", mask: "9999", iconKey: null,
  });
  assert.match(refused.error ?? "", /You already have an account called "car loan"\. Choose a different name\./);

  const after = (await invoke(browser, "list_accounts")).ok;
  assert.equal(after.length, before.length, "no account was added");
  const same = after.find((a) => a.id === loan.id);
  assert.deepEqual(
    { name: same.name, starting_balance: same.starting_balance, institution: same.institution, mask: same.mask, account_type: same.account_type },
    { name: loan.name, starting_balance: loan.starting_balance, institution: loan.institution, mask: loan.mask, account_type: loan.account_type },
    "the existing Car Loan is unchanged",
  );

  console.log("FEATURE 155 E2E TEST PASSED");
} finally {
  await app.close();
}
