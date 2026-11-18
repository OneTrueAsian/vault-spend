// `npm run demo:household` — opens the REAL compiled app on the shared practice data (see e2e/demo.mjs and
// e2e/lib/practice-data/), the same as `npm run demo`. The main household there is this tidy household plus every
// feature's practice data. Flags: --keep (reopen without rebuilding), --seed (rebuild only).
//
// `seedHouseholdDatabase` below is the tidy household alone (every balance explained, no loose ends), for specs that
// check its exact figures.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedTidyHousehold } from "./lib/practice-data/index.mjs";
import { runPracticeLauncher } from "./lib/practice-data/launcher.mjs";

/** Creates the household database in `dbDir` (which must exist and not hold a vaultspend.db yet). */
export async function seedHouseholdDatabase(dbDir) {
  await seedTidyHousehold(dbDir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await runPracticeLauncher({ repoRoot, args: new Set(process.argv.slice(2)) });
}
