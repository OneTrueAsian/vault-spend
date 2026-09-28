// Interrupted plaintext backups (Phase F, Task 1): the app is hard-killed at three exact points
// inside "Back up now" — after the snapshot is staged, after it verifies, and after it is published.
// Before publication nothing may look like a backup (no listed partial, no restorable partial, the
// earlier snapshots untouched); after it the new snapshot must be complete and restorable.
// Debug builds only: the checkpoints are compiled out of release builds.
//
// Run with: node e2e/run-all.mjs --spec=129

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { seedPopulatedProfile } from "./lib/protection.mjs";
import {
  finals,
  invoke,
  killDuringBackupNow,
  listedBackups,
  openApp,
  plaintextBackupIsSound,
  seedRecentBackup,
  stagingFiles,
} from "./lib/backup_publication.mjs";

const dbDir = freshTestDbDir();
await seedPopulatedProfile(dbDir);
seedRecentBackup(dbDir);
const backupsDir = path.join(dbDir, "backups");
const initial = finals(backupsDir);
assert.equal(initial.length, 3, "fixture: two old backups and one recent one");

// Killed with the snapshot staged but not yet verified.
{
  const app = await openApp(dbDir, { failpoint: "backup_after_staged_copy", isProtected: false });
  await killDuringBackupNow(app, dbDir, "backup_after_staged_copy");
}
assert.deepEqual(finals(backupsDir), initial, "a kill mid-copy must not publish anything");
assert.ok(stagingFiles(backupsDir).length >= 1, "the seam should have interrupted a real staged copy");

// Killed after the snapshot verified but before it was published.
{
  const app = await openApp(dbDir, { failpoint: "backup_after_verification", isProtected: false });
  try {
    assert.deepEqual(await listedBackups(app.browser), initial, "the interrupted copy must not be listed as a backup");
  } catch (error) {
    await app.close();
    throw error;
  }
  await killDuringBackupNow(app, dbDir, "backup_after_verification");
}
assert.deepEqual(finals(backupsDir), initial, "a kill before publication must not publish anything");

// Killed just after publication: the new snapshot is whole.
{
  const app = await openApp(dbDir, { failpoint: "backup_after_database_publication", isProtected: false });
  try {
    assert.deepEqual(await listedBackups(app.browser), initial, "earlier interruptions must still not be listed");
  } catch (error) {
    await app.close();
    throw error;
  }
  await killDuringBackupNow(app, dbDir, "backup_after_database_publication");
}
const afterPublish = finals(backupsDir);
assert.equal(afterPublish.length, initial.length + 1, "a kill right after publication leaves one complete new backup");
for (const name of afterPublish) {
  assert.ok(plaintextBackupIsSound(path.join(backupsDir, name)), `${name} must be a sound database with the seeded data`);
}

// A normal launch lists exactly the complete snapshots, and the newest one restores.
const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  assert.deepEqual(await listedBackups(browser), afterPublish);
  const newest = afterPublish.at(-1);
  const generation = (await invoke(browser, "get_current_generation")).ok;
  const restored = await invoke(browser, "restore_backup", { filename: newest, password: null, expectedGeneration: generation });
  assert.equal(restored.error, undefined, `restoring the newest listed backup should work: ${restored.error}`);
  const livePath = (await invoke(browser, "get_data_file_location")).ok;
  assert.match(path.basename(livePath), /^vaultspend-restored-/, "restore points the app at a new file");
  assert.ok(plaintextBackupIsSound(livePath), "the restored database must hold the seeded data");
  assert.ok(fs.existsSync(path.join(backupsDir, newest)), "the source backup is left in place");
} finally {
  await app.close();
}

console.log("FEATURE 129 E2E TEST PASSED");
