// E2E test for Task 7 of the Transactions usability plan — closing the gap
// the plan itself calls out: transaction notes must survive the operations
// that copy or re-key the whole database, not just ordinary editing.
//   - An unprotected local backup/restore round trip.
//   - Turning on password protection, then a lock/unlock cycle.
//   - A backup/restore round trip once the profile is protected.
//   - A CSV import with a Notes column reaching the UI (the export side of
//     this round trip can't be driven through WebDriver — Export CSV opens
//     a native OS save dialog with no cross-platform automation API, the
//     same limitation feature7_export.mjs documents; the export format
//     itself is proven at the Rust level by csv_loader's own notes tests).
//
// Run with: node e2e/feature137_notes_backup_and_protected_profile.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";

async function invoke(browser, command, args = {}) {
  return browser.executeAsync(
    (cmd, a, done) => {
      window.__TAURI_INTERNALS__.invoke(cmd, a).then(
        (value) => done({ ok: value }),
        (e) => done({ error: String(e) }),
      );
    },
    command,
    args,
  );
}
async function ok(browser, command, args) {
  const r = await invoke(browser, command, args);
  if (r.error !== undefined) throw new Error(`${command} failed: ${r.error}`);
  return r.ok;
}

const testDbDir = freshTestDbDir();

async function seedNotedTransaction(dbDir) {
  const app = await launchApp({ dbDir });
  try {
    const accounts0 = await ok(app.browser, "list_accounts");
    let checkingId = accounts0.find((a) => a.name === "Checking")?.id;
    if (checkingId === undefined) {
      checkingId = await ok(app.browser, "create_account", { name: "Checking", accountType: "checking", startingBalance: "1000.00" });
    }
    await ok(app.browser, "create_manual_transaction", {
      accountId: checkingId,
      date: dateInMonth(-1, 1),
      description: "Rent",
      amount: "-1200.00",
      category: null,
      memberId: null,
      notes: "Reimbursed by roommate",
    });
  } finally {
    await app.close();
  }
}
await seedNotedTransaction(testDbDir);

async function nav(browser, label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) {
      await b.click();
      return;
    }
  }
  throw new Error(`no nav button "${label}"`);
}

async function assertNotePresent(browser) {
  await nav(browser, "Transactions");
  await (await browser.$("table.ledger")).waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => (await (await browser.$("table.ledger")).getText()).includes("Reimbursed by roommate"), {
    timeout: 10000,
    timeoutMsg: "expected the seeded note to still be visible",
  });
}

const app = await launchApp({ dbDir: testDbDir });
try {
  const { browser } = app;
  await assertNotePresent(browser);
  console.log("note visible after initial seed");

  // ---- 1. Unprotected local backup/restore round trip ---------------------
  // The note is changed *after* the backup and *before* the restore, so a
  // restore that actually pulls from the backup (rather than a no-op that
  // never touched the live file) is the only way this can pass: if restore
  // did nothing, the changed text would still be showing afterward.
  const backupResult = await ok(browser, "create_backup_now");
  const backupFilename = backupResult.filename ?? backupResult;
  assert.ok(typeof backupFilename === "string" && backupFilename.length > 0, `expected a backup filename, got ${JSON.stringify(backupResult)}`);
  const rentTxnId = (await ok(browser, "list_transactions")).find((t) => t.description === "Rent").id;
  await ok(browser, "update_transaction_notes", { transactionId: rentTxnId, notes: "Changed after the backup" });
  const generation1 = await ok(browser, "get_current_generation");
  const restored1 = await invoke(browser, "restore_backup", { filename: backupFilename, password: null, expectedGeneration: generation1 });
  assert.equal(restored1.error, undefined, `unprotected restore should succeed: ${restored1.error}`);
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await assertNotePresent(browser);
  const ledgerTextAfterRestore1 = await (await browser.$("table.ledger")).getText();
  assert.ok(!ledgerTextAfterRestore1.includes("Changed after the backup"), "expected the post-backup edit to be gone — proves the restore actually ran, not a no-op");
  console.log("note survives an unprotected backup/restore round trip (and the restore demonstrably did something)");

  // ---- 2. Turn on password protection, then lock/unlock -------------------
  await nav(browser, "Settings");
  await enableProtectionThroughUI(browser, PASSWORD);
  await browser.$("button=Change password…").waitForExist({ timeout: 15000 });

  await (await browser.$(".profile-switcher-toggle")).click();
  await (await browser.$("[data-profile-switcher-lock]")).click();
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  const lockedState = await invoke(browser, "get_startup_state");
  assert.equal(lockedState.ok?.status, "locked", "expected a locked startup state after locking");
  const refused = await invoke(browser, "list_transactions");
  assert.ok(refused.error?.startsWith("PROFILE_LOCKED"), "data commands must refuse while locked");

  await (await browser.$("#password-form-field")).setValue(PASSWORD);
  await (await browser.$("button[type='submit']")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 10000, timeoutMsg: "the correct password should unlock the profile" });
  await assertNotePresent(browser);
  console.log("note survives turning on protection and a lock/unlock cycle");

  // ---- 3. Backup/restore round trip once protected -------------------------
  // Same "prove it wasn't a no-op" shape as step 1.
  const protectedBackupResult = await ok(browser, "create_backup_now");
  const protectedBackupFilename = protectedBackupResult.filename ?? protectedBackupResult;
  const rentTxnId2 = (await ok(browser, "list_transactions")).find((t) => t.description === "Rent").id;
  await ok(browser, "update_transaction_notes", { transactionId: rentTxnId2, notes: "Changed after the protected backup" });
  const generation2 = await ok(browser, "get_current_generation");
  const restored2 = await invoke(browser, "restore_backup", {
    filename: protectedBackupFilename,
    password: PASSWORD,
    expectedGeneration: generation2,
  });
  assert.equal(restored2.error, undefined, `protected restore should succeed: ${restored2.error}`);
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await assertNotePresent(browser);
  const ledgerTextAfterRestore2 = await (await browser.$("table.ledger")).getText();
  assert.ok(!ledgerTextAfterRestore2.includes("Changed after the protected backup"), "expected the post-backup edit to be gone — proves the protected restore actually ran, not a no-op");
  console.log("note survives a backup/restore round trip on a protected profile (and the restore demonstrably did something)");

  // ---- 4. CSV import with a Notes column reaches the UI --------------------
  const csvDir = fs.mkdtempSync(path.join(testDbDir, "csv-"));
  const csvPath = path.join(csvDir, "bank.csv");
  fs.writeFileSync(
    csvPath,
    ["date,description,amount,notes", `${dateInMonth(-1, 5)},Imported With Note,-42.00,"Split with Sam"`, ""].join("\n"),
  );
  const accounts = await ok(browser, "list_accounts");
  const checkingId = accounts.find((a) => a.name === "Checking").id;
  await ok(browser, "commit_import", {
    path: csvPath,
    invertAmounts: false,
    defaultAccountId: checkingId,
    includedIndices: [0],
    accountOverrides: {},
  });
  // A direct IPC call bypasses the UI's own import handler (which calls
  // refresh() itself) — reload so the frontend picks up the new row.
  await browser.refresh();
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await nav(browser, "Transactions");
  await browser.waitUntil(
    async () => {
      const text = await (await browser.$("table.ledger")).getText();
      return text.includes("Imported With Note") && text.includes("Split with Sam");
    },
    { timeout: 10000, timeoutMsg: "expected the CSV's Notes column to reach the imported transaction" },
  );
  console.log("a CSV Notes column reaches the imported transaction in the UI");

  // ---- 5. A too-long note in one CSV row doesn't abort the whole import --
  // Found by code review: update_transaction_notes used to run after every
  // selected row was already inserted, so an over-limit note's rejection
  // propagated out of commit_import as an error — with rows already
  // committed, inserted_ids lost, and categorize_uncategorized/auto-link
  // skipped. The bad row is now dropped as a row error instead, same as
  // any other malformed row, and the rest of the import still succeeds.
  const csvDir2 = fs.mkdtempSync(path.join(testDbDir, "csv2-"));
  const csvPath2 = path.join(csvDir2, "bank2.csv");
  const tooLongNote = "x".repeat(4001);
  fs.writeFileSync(
    csvPath2,
    ["date,description,amount,notes", `${dateInMonth(-1, 6)},Good Row,-10.00,"fine"`, `${dateInMonth(-1, 7)},Bad Row,-20.00,"${tooLongNote}"`, ""].join("\n"),
  );
  const commitResult = await ok(browser, "commit_import", {
    path: csvPath2,
    invertAmounts: false,
    defaultAccountId: checkingId,
    includedIndices: [0, 1],
    accountOverrides: {},
  });
  assert.equal(commitResult.inserted, 1, `expected only the valid row to be inserted, got ${JSON.stringify(commitResult)}`);
  assert.equal(commitResult.row_errors, 1, "expected the over-limit note to count as a row error, not abort the import");
  assert.equal(commitResult.inserted_ids.length, 1, "expected inserted_ids to reflect only the row that actually landed");
  const allTxns = await ok(browser, "list_transactions");
  assert.ok(allTxns.some((t) => t.description === "Good Row"), "expected the valid row to be imported");
  assert.ok(!allTxns.some((t) => t.description === "Bad Row"), "expected the row with the over-limit note to be skipped entirely, not half-imported without its note");
  console.log("an over-limit note in one CSV row is skipped as a row error, not an import-aborting failure");

  console.log("FEATURE 137 E2E TEST PASSED");
} finally {
  await app.close();
}
