// The demo profiles behind `npm run demo` (see e2e/demo.mjs). The main profile is the shared practice household
// (e2e/lib/practice-data/, with every feature's data listed in COVERAGE.md); seedDemoRegistry builds every practice profile.

import path from "node:path";
import { buildPracticeData, seedMainHousehold } from "./practice-data/index.mjs";

/** Creates a fresh demo database in `dbDir` (which must already exist and be
 * empty, or not contain a vaultspend.db yet). */
export async function seedDemoDatabase(dbDir) {
  await seedMainHousehold(dbDir);
}

/**
 * Builds the shared practice data (see e2e/lib/practice-data/) into `dbDir`: the main household, Sam, Fresh start and
 * Locked, plus the practice files and README. Kept for existing callers; returns the main household's folder as
 * `defaultDir`, Sam's folders, and the two backup filenames actually written for Sam (their timestamps are relative
 * to today, so quote them from this return value, never hard-code a date).
 */
export async function seedDemoRegistry(dbDir) {
  const built = await buildPracticeData(dbDir);
  const dirOf = (id) => built.profiles.find((p) => p.id === id).dir;
  const samDir = dirOf("sam-1");
  return { defaultDir: dirOf("household-0"), samDir, samBackupsDir: path.join(samDir, "backups"), backupNames: built.samBackupNames };
}
