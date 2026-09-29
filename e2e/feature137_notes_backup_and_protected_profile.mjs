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
      date: "2026-09-01",
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
  const backupResult = await ok(browser, "create_backup_now");
  const backupFilename = backupResult.filename ?? backupResult;
  assert.ok(typeof backupFilename === "string" && backupFilename.length > 0, `expected a backup filename, got ${JSON.stringify(backupResult)}`);
  const generation1 = await ok(browser, "get_current_generation");
  const restored1 = await invoke(browser, "restore_backup", { filename: backupFilename, password: null, expectedGeneration: generation1 });
  assert.equal(restored1.error, undefined, `unprotected restore should succeed: ${restored1.error}`);
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await assertNotePresent(browser);
  console.log("note survives an unprotected backup/restore round trip");

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
  const protectedBackupResult = await ok(browser, "create_backup_now");
  const protectedBackupFilename = protectedBackupResult.filename ?? protectedBackupResult;
  const generation2 = await ok(browser, "get_current_generation");
  const restored2 = await invoke(browser, "restore_backup", {
    filename: protectedBackupFilename,
    password: PASSWORD,
    expectedGeneration: generation2,
  });
  assert.equal(restored2.error, undefined, `protected restore should succeed: ${restored2.error}`);
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await assertNotePresent(browser);
  console.log("note survives a backup/restore round trip on a protected profile");

  // ---- 4. CSV import with a Notes column reaches the UI --------------------
  const csvDir = fs.mkdtempSync(path.join(testDbDir, "csv-"));
  const csvPath = path.join(csvDir, "bank.csv");
  fs.writeFileSync(
    csvPath,
    ["date,description,amount,notes", '2026-09-05,Imported With Note,-42.00,"Split with Sam"', ""].join("\n"),
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

  console.log("FEATURE 137 E2E TEST PASSED");
} finally {
  await app.close();
}
