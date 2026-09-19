// E2E test for Phase 2 item 17 (second backup destination):
//   - Settings -> Backups -> "Second copy": a folder can be chosen (typed
//     here; "Browse…" opens a native picker no WebDriver can drive);
//   - "Back up now" then writes the backup to BOTH places;
//   - the primary backups folder is refused as the second one, and so is a
//     folder that doesn't exist (a typo mustn't quietly create a new folder
//     somewhere else — found in Phase 2 UAT);
//   - "Stop copying" turns it off.
//
// Run with: node e2e/feature73_second_backup_copy.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
acct = cur.lastrowid
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?,?,?,?,?,?)",
            (acct, "2026-08-01", "Original", "-10.00", None, f"{acct}|2026-08-01|original|-10.00"))
`);
const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-second-copy-"));
const backupsDir = path.join(dbDir, "backups");
const missingDir = path.join(os.tmpdir(), `vaultspend-no-such-folder-${process.pid}`);
const backupFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^vaultspend-.*\.db$/.test(f)) : []);

const app = await launchApp({ dbDir });
const { browser } = app;
try {
  await browser.setWindowSize(1440, 1400);
  await (await browser.$("button*=Settings")).click();
  const section = await browser.$("[data-backup-copy]");
  await section.waitForExist({ timeout: 10000 });
  await section.scrollIntoView();

  // The primary folder is refused.
  const input = await section.$("input[aria-label='Second backup folder']");
  await input.setValue(backupsDir);
  await (await section.$("button*=Start copying")).click();
  await browser.waitUntil(async () => /different folder/i.test(await (await browser.$(".status")).getText()), {
    timeout: 10000,
    timeoutMsg: "choosing the backups folder itself should be refused with a clear message",
  });
  if (await browser.$("[data-backup-copy-dir]").isExisting()) throw new Error("a refused folder must not be saved");

  // A folder that doesn't exist is refused too — and not created for you.
  await input.setValue(missingDir);
  await (await section.$("button*=Start copying")).click();
  await browser.waitUntil(async () => /doesn't exist/i.test(await (await browser.$(".toast-stack .status")).getText()), {
    timeout: 10000,
    timeoutMsg: "a folder that doesn't exist should be refused with a message saying so",
  });
  if (await browser.$("[data-backup-copy-dir]").isExisting()) throw new Error("a missing folder must not be saved");
  if (fs.existsSync(missingDir)) throw new Error("a missing folder must not be created behind the person's back");

  // A real second folder is accepted.
  await input.setValue(copyDir);
  await (await section.$("button*=Start copying")).click();
  const shown = await browser.$("[data-backup-copy-dir]");
  await shown.waitForExist({ timeout: 10000, timeoutMsg: "the chosen folder should be shown once saved" });
  if ((await shown.getText()) !== copyDir) throw new Error(`expected ${copyDir}, shown ${await shown.getText()}`);

  // Back up now -> both folders get the file.
  const beforeManual = backupFiles(backupsDir).length;
  await (await browser.$("button*=Back up now")).click();
  await browser.waitUntil(async () => backupFiles(backupsDir).length > beforeManual, { timeout: 15000, timeoutMsg: "Back up now should add a backup" });
  const newestPrimary = () => backupFiles(backupsDir).sort().at(-1);
  await browser.waitUntil(async () => backupFiles(copyDir).includes(newestPrimary()), {
    timeout: 15000,
    timeoutMsg: "the new backup should be copied to the second folder",
  });
  const primary = backupFiles(backupsDir);
  const copies = backupFiles(copyDir);
  console.log("primary:", primary, "second:", copies);
  if (primary.length === 0) throw new Error("the normal backup must still be made");
  const newest = primary.sort().at(-1);
  if (!copies.includes(newest)) throw new Error(`the second folder should hold ${newest}, has ${copies}`);
  if (fs.statSync(path.join(copyDir, newest)).size !== fs.statSync(path.join(backupsDir, newest)).size) {
    throw new Error("the copy should be the same size as the backup");
  }
  await browser.waitUntil(async () => /copied to/i.test(await (await browser.$(".status")).getText()), {
    timeout: 10000,
    timeoutMsg: "the message after Back up now should say it was copied",
  });

  // Stop copying.
  await (await browser.$("button*=Stop copying")).click();
  await browser.waitUntil(async () => !(await browser.$("[data-backup-copy-dir]").isExisting()), { timeout: 10000, timeoutMsg: "Stop copying should clear the folder" });
  const before = backupFiles(copyDir).length;
  await (await browser.$("button*=Back up now")).click();
  await browser.waitUntil(async () => backupFiles(backupsDir).length > primary.length, { timeout: 15000 });
  await browser.pause(500);
  if (backupFiles(copyDir).length !== before) throw new Error("no more copies should be made after Stop copying");

  console.log("FEATURE 73 E2E TEST PASSED");
} finally {
  await app.close();
  fs.rmSync(copyDir, { recursive: true, force: true });
}
