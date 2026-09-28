// Interrupted protected backups (Phase F, Task 1): a protected snapshot is a database plus its key
// file. The app is hard-killed inside "Back up now" after the snapshot is staged, between publishing
// the key and publishing the database (the crash window that used to be able to strand a half pair),
// and just after both are published. Nothing incomplete may be listed or restored; the previous
// pairs stay usable; a completed pair restores under the profile's password.
// Debug builds only: the checkpoints are compiled out of release builds.
//
// Run with: node e2e/run-all.mjs --spec=130

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { freshTestDbDir } from "./lib/seed.mjs";
import { enableProtectionThroughUI, seedPopulatedProfile } from "./lib/protection.mjs";
import { finals, invoke, keyFiles, killDuringBackupNow, launchWithFailpoint, listedBackups, openApp, PASSWORD, seedRecentBackup, stagingFiles, unlockOnlyProfile } from "./lib/backup_publication.mjs";
import { launchApp } from "./harness.mjs";

const dbDir = freshTestDbDir();
await seedPopulatedProfile(dbDir);
seedRecentBackup(dbDir);
const backupsDir = path.join(dbDir, "backups", "protected");

// Session 1: turn protection on through the real UI and take one native protected backup.
{
  const app = await launchApp({ dbDir });
  try {
    const { browser } = app;
    await (await browser.$("button*=Settings")).click();
    await enableProtectionThroughUI(browser, PASSWORD);
    await browser.$("button=Change password…").waitForExist({ timeout: 15000 });
    const before = (await listedBackups(browser)).length;
    await (await browser.$("button=Back up now")).click();
    await browser.waitUntil(async () => (await listedBackups(browser)).length > before, { timeout: 15000, timeoutMsg: "Back up now should add a protected backup" });
  } finally {
    await app.close();
  }
}
const initial = finals(backupsDir);
assert.ok(initial.length >= 2, "fixture: converted history plus a fresh protected backup");
assert.deepEqual(keyFiles(backupsDir), initial.map((f) => `${f}.key`), "every backup starts as a complete pair");

// Killed with the encrypted snapshot staged, before it is verified.
{
  const app = await openApp(dbDir, { failpoint: "backup_after_staged_copy", isProtected: true });
  await killDuringBackupNow(app, dbDir, "backup_after_staged_copy");
}
assert.deepEqual(finals(backupsDir), initial, "a kill mid-copy must not publish anything");
assert.deepEqual(keyFiles(backupsDir), initial.map((f) => `${f}.key`), "and must not leave a published key behind");
assert.ok(stagingFiles(backupsDir).length >= 1, "the seam should have interrupted a real staged copy");

// Killed after the key was published but before the database was: only an orphan key can remain.
{
  const app = await openApp(dbDir, { failpoint: "backup_after_key_publication", isProtected: true });
  try {
    assert.deepEqual(await listedBackups(app.browser), initial);
  } catch (error) {
    await app.close();
    throw error;
  }
  await killDuringBackupNow(app, dbDir, "backup_after_key_publication");
}
assert.deepEqual(finals(backupsDir), initial, "no database was published");
const orphanKeys = keyFiles(backupsDir).filter((k) => !initial.includes(k.replace(/\.key$/, "")));
assert.equal(orphanKeys.length, 1, `exactly one orphan key should mark the interrupted publication, saw ${orphanKeys}`);

// Killed just after both files were published: the new pair is whole.
{
  const app = await openApp(dbDir, { failpoint: "backup_after_database_publication", isProtected: true });
  try {
    assert.deepEqual(await listedBackups(app.browser), initial, "the orphan key must not make a backup appear");
  } catch (error) {
    await app.close();
    throw error;
  }
  await killDuringBackupNow(app, dbDir, "backup_after_database_publication");
}
const afterPublish = finals(backupsDir);
assert.equal(afterPublish.length, initial.length + 1, "a kill right after publication leaves one complete new backup");
const newest = afterPublish.filter((f) => !initial.includes(f))[0];
assert.ok(fs.existsSync(path.join(backupsDir, `${newest}.key`)), "the new backup's key file is published with it");
assert.ok(fs.readFileSync(path.join(backupsDir, newest)).subarray(0, 16).toString("latin1") !== "SQLite format 3\0", "the new backup stays encrypted on disk");

// The completed pair restores under the profile's password; the data comes back.
{
  const app = await launchWithFailpoint(dbDir, undefined, { ready: "[data-profile-selector]" });
  try {
    await unlockOnlyProfile(app.browser);
    assert.deepEqual(await listedBackups(app.browser), afterPublish);
    const generation = (await invoke(app.browser, "get_current_generation")).ok;
    const restored = await invoke(app.browser, "restore_backup", { filename: newest, password: PASSWORD, expectedGeneration: generation });
    assert.equal(restored.error, undefined, `restoring the completed protected backup should work: ${restored.error}`);
  } finally {
    await app.close();
  }
}
{
  const app = await launchWithFailpoint(dbDir, undefined, { ready: "[data-profile-selector]" });
  try {
    await unlockOnlyProfile(app.browser);
    await (await app.browser.$("button*=Transactions")).click();
    assert.match(await (await app.browser.$(".page")).getText(), /Market Basket/, "the restored profile holds its data");
  } finally {
    await app.close();
  }
}

console.log("FEATURE 130 E2E TEST PASSED");
