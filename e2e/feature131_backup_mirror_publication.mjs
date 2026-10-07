// Interrupted second-folder copies (Phase F, Task 1): the local backup finishes, then the app is
// hard-killed while the second copy is being made — for an unprotected profile mid-copy, for a
// protected one after the key was published but before the database. The second folder must never
// hold a database that lacks its key or a half-written one, the local backup stays complete and
// listed, and the next backup mirrors normally without touching what was left behind.
// Debug builds only: the checkpoints are compiled out of release builds.
//
// Run with: node e2e/run-all.mjs --spec=131

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { enableProtectionThroughUI, seedPopulatedProfile } from "./lib/protection.mjs";
import { finals, invoke, keyFiles, killDuringBackupNow, launchWithFailpoint, listedBackups, openApp, PASSWORD, seedRecentBackup, stagingFiles, unlockOnlyProfile } from "./lib/backup_publication.mjs";

import { makeTempDir } from "./lib/tempDir.mjs";
function freshMirrorDir() {
  return makeTempDir("vaultspend-e2e-mirror-");
}

/** Backs up once more with no failpoint and checks the second folder gets a byte-identical copy. */
async function finishNormally(dbDir, backupsDir, mirrorDir, isProtected) {
  const app = isProtected ? await launchWithFailpoint(dbDir, undefined, { ready: "[data-profile-selector]" }) : await launchApp({ dbDir });
  try {
    if (isProtected) await unlockOnlyProfile(app.browser);
    const result = (await invoke(app.browser, "create_backup_now")).ok;
    assert.ok(result?.filename, "Back up now should succeed");
    assert.equal(result.copy_error ?? null, null, `the second copy should work again: ${result.copy_error}`);
    assert.ok(finals(mirrorDir).includes(result.filename), "the new backup reaches the second folder");
    assert.ok(fs.readFileSync(path.join(mirrorDir, result.filename)).equals(fs.readFileSync(path.join(backupsDir, result.filename))), "the second copy is byte for byte the local backup");
    if (isProtected) {
      assert.ok(fs.readFileSync(path.join(mirrorDir, `${result.filename}.key`)).equals(fs.readFileSync(path.join(backupsDir, `${result.filename}.key`))), "and so is its key file");
    }
    assert.deepEqual(await listedBackups(app.browser), finals(backupsDir), "everything local that is listed is complete");
  } finally {
    await app.close();
  }
}

// Unprotected profile: killed while the second copy is staged.
{
  const dbDir = freshTestDbDir();
  await seedPopulatedProfile(dbDir);
  seedRecentBackup(dbDir);
  const backupsDir = path.join(dbDir, "backups");
  const mirrorDir = freshMirrorDir();
  {
    const app = await launchApp({ dbDir });
    try {
      const set = await invoke(app.browser, "set_backup_copy_dir", { dir: mirrorDir });
      assert.equal(set.error, undefined, `choosing the second folder should work: ${set.error}`);
    } finally {
      await app.close();
    }
  }
  const localBefore = finals(backupsDir);
  const mirrorBefore = finals(mirrorDir);
  assert.equal(mirrorBefore.length, 1, "choosing the folder copies the newest backup straight away");

  const app = await openApp(dbDir, { failpoint: "mirror_after_staged_copy", isProtected: false });
  await killDuringBackupNow(app, dbDir, "mirror_after_staged_copy");

  assert.equal(finals(backupsDir).length, localBefore.length + 1, "the local backup finished before the second copy began");
  assert.deepEqual(finals(mirrorDir), mirrorBefore, "the interrupted second copy published nothing");
  assert.ok(stagingFiles(mirrorDir).length >= 1, "the seam should have interrupted a real staged copy");
  await finishNormally(dbDir, backupsDir, mirrorDir, false);
}

// Protected profile: killed between publishing the second copy's key and its database.
{
  const dbDir = freshTestDbDir();
  await seedPopulatedProfile(dbDir);
  seedRecentBackup(dbDir);
  const backupsDir = path.join(dbDir, "backups", "protected");
  const mirrorDir = freshMirrorDir();
  {
    const app = await launchApp({ dbDir });
    try {
      const { browser } = app;
      await (await browser.$("button*=Settings")).click();
      await enableProtectionThroughUI(browser, PASSWORD);
      await browser.$("button=Change password…").waitForExist({ timeout: 15000 });
      const set = await invoke(browser, "set_backup_copy_dir", { dir: mirrorDir });
      assert.equal(set.error, undefined, `choosing the second folder should work: ${set.error}`);
    } finally {
      await app.close();
    }
  }
  const localBefore = finals(backupsDir);
  const mirrorBefore = finals(mirrorDir);
  assert.equal(mirrorBefore.length, 1);
  assert.deepEqual(keyFiles(mirrorDir), mirrorBefore.map((f) => `${f}.key`), "the mirrored pair starts complete");

  const app = await openApp(dbDir, { failpoint: "mirror_after_key_publication", isProtected: true });
  await killDuringBackupNow(app, dbDir, "mirror_after_key_publication");

  const localAfter = finals(backupsDir);
  assert.equal(localAfter.length, localBefore.length + 1, "the local pair finished before the second copy began");
  assert.deepEqual(finals(mirrorDir), mirrorBefore, "no database was published to the second folder");
  const orphan = keyFiles(mirrorDir).filter((k) => !mirrorBefore.includes(k.replace(/\.key$/, "")));
  assert.equal(orphan.length, 1, `one orphan key marks the interrupted second copy, saw ${orphan}`);
  const orphanBytes = fs.readFileSync(path.join(mirrorDir, orphan[0]));
  await finishNormally(dbDir, backupsDir, mirrorDir, true);
  assert.ok(fs.readFileSync(path.join(mirrorDir, orphan[0])).equals(orphanBytes), "the leftover key file is never deleted or replaced");
}

console.log("FEATURE 131 E2E TEST PASSED");
