// A credit card whose export shows charges as positive (Amex Blue does): fixing rows already imported
// the wrong way round, and the import's sign question remembering and suggesting the right answer.
//
//   1. "Flip signs…" on the Transactions tab negates the selected rows (after naming what it will do)
//      and the card's balance follows.
//   2. Importing a mostly-positive file into a credit card suggests "Flip the signs" and says why; the
//      answer is remembered, so the next import into that account preselects it and says so.
//
// The native file picker is answered by stubFilePicker (harness.mjs), which wraps window.fetch (Tauri IPC goes out as fetch, and
// __TAURI_INTERNALS__.invoke itself is not writable): a `plugin:dialog|open` request gets the path of a
// CSV this spec wrote. Everything else is the real app.
//
// Run with: node e2e/run-all.mjs --spec=150

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose, stubFilePicker } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Amex Blue', 'credit', '1000.00')")
a = cur.lastrowid
for date, desc, amount in [("${dateInMonth(-1, 10)}", "HULU", "19.99"), ("${dateInMonth(-1, 20)}", "PAYMENT - THANK YOU", "-50.00")]:
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, NULL, ?)",
        (a, date, desc, amount, f"{a}|{date}|{desc.lower()}|{amount}"),
    )
`);

// Statements as the card exports them: charges positive, the payment negative.
const csvDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-e2e-flip-"));
const writeCsv = (name, rows) => {
  const file = path.join(csvDir, name);
  fs.writeFileSync(file, ["Date,Description,Amount", ...rows, ""].join("\n"));
  return file;
};
const firstStatement = writeCsv("first.csv", [`${dateInMonth(-1, 21)},RING MULTI PLAN,9.99`, `${dateInMonth(-1, 22)},APPLE.COM/BILL,2.99`, `${dateInMonth(-1, 25)},AUTOPAY PAYMENT,-12.98`]);
const secondStatement = writeCsv("second.csv", [`${dateInMonth(-1, 26)},HULU PLUS,19.99`]);

const app = await launchApp({ dbDir });
const { browser } = app;

async function invoke(command, args = {}) {
  const result = await browser.executeAsync(
    (command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then((ok) => done({ ok }), (e) => done({ error: String(e) })),
    command,
    args,
  );
  if (result.error) throw new Error(`${command} failed: ${result.error}`);
  return result.ok;
}
const amex = async () => (await invoke("list_accounts")).find((a) => a.name === "Amex Blue");
const amountOf = async (description) => (await invoke("list_transactions")).find((t) => t.description === description)?.amount;

try {
  await (await browser.$("button*=Transactions")).click();

  // ---- 1. Flip signs on rows already imported --------------------------------------------------------
  for (const desc of ["HULU", "PAYMENT - THANK YOU"]) {
    const checkbox = await browser.$(`//tr[.//td[contains(.,'${desc}')]]//input[@type='checkbox']`);
    await checkbox.waitForExist({ timeout: 10000 });
    await checkbox.click();
  }
  await (await browser.$("button=Flip signs…")).click();
  const confirm = await browser.$("[data-flip-signs-confirm]");
  await confirm.waitForDisplayed({ timeout: 5000 });
  assert.match(await confirm.getText(), /Flip the sign of 2 transactions in Amex Blue\?/);
  await (await confirm.$("button=Flip 2")).click();

  await waitUntilOrDiagnose(browser, async () => (await amountOf("HULU")) === "-19.99", {
    timeout: 10000,
    timeoutMsg: "the charge should become money out",
  });
  assert.equal(await amountOf("PAYMENT - THANK YOU"), "50.00", "the payment should become money in");
  assert.equal((await amex()).current_balance, "1030.01", "the card's balance should follow: 1000 - 19.99 + 50");

  // ---- 2. The import suggests flipping, then remembers it ---------------------------------------------
  await stubFilePicker(browser, [firstStatement, secondStatement]);
  assert.equal((await amex()).import_flip_signs, null, "nothing has been imported into Amex Blue yet");

  const askSigns = async () => {
    await (await browser.$("button=Import transactions…")).click();
    const hint = await browser.$("[data-import-sign-hint]");
    await hint.waitForDisplayed({ timeout: 10000 });
    return {
      hint: await hint.getText(),
      focused: await browser.execute(() => document.activeElement?.textContent?.trim() ?? null),
    };
  };

  const first = await askSigns();
  assert.match(first.hint, /Most amounts in this file are positive/, "a mostly-positive file on a credit card suggests flipping");
  assert.equal(first.focused, "Flip the signs", "and preselects it");
  await (await browser.$("button=Flip the signs")).click();
  const importButton = await browser.$("button*=Import 3 transaction");
  await importButton.waitForDisplayed({ timeout: 10000 });
  // A fresh profile has no history to guess these merchants from, so the review asks about them;
  // this spec is about signs, so they are left uncategorized.
  const leaveRest = await browser.$("button=Leave the rest uncategorized");
  if (await leaveRest.isExisting()) await leaveRest.click();
  await importButton.waitForEnabled({ timeout: 5000, timeoutMsg: "Import should turn on once every row has a choice" });
  await importButton.click();
  await waitUntilOrDiagnose(browser, async () => (await amountOf("RING MULTI PLAN")) === "-9.99", {
    timeout: 10000,
    timeoutMsg: "the flipped import should store the charge as money out",
  });
  assert.equal(await amountOf("AUTOPAY PAYMENT"), "12.98");
  assert.equal((await amex()).import_flip_signs, true, "the answer is remembered on the account");
  // An import opens its review inbox on the new rows; close it to reach the import button again.
  const inboxClose = await browser.$("[data-inbox-close]");
  await inboxClose.waitForDisplayed({ timeout: 10000, timeoutMsg: "the import's review inbox should open" });
  await inboxClose.click();
  await inboxClose.waitForExist({ reverse: true, timeout: 5000 });

  const second = await askSigns();
  assert.equal(second.hint, "Last import into Amex Blue: flipped the signs.");
  assert.equal(second.focused, "Flip the signs");
  await (await browser.$("button=Keep as-is")).click();
  const cancel = await browser.$("//div[contains(@class,'dup-review-actions')]//button[normalize-space()='Cancel']");
  await cancel.waitForDisplayed({ timeout: 10000 });
  await cancel.click();
  assert.equal((await amex()).import_flip_signs, true, "a cancelled import changes nothing");

  console.log("FEATURE 150 E2E TEST PASSED");
} finally {
  await app.close();
  fs.rmSync(csvDir, { recursive: true, force: true });
}
