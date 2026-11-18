// `npm run demo:household` — opens the REAL compiled app on a complete, tidy two-person household:
// 15 months of history, and every account (checking, savings, two cards, three loans, three
// investment accounts) holding a balance that its own transactions explain. Unlike `npm run demo`,
// there are no deliberate loose ends; it is for trying features (Comparisons in particular, which
// needs 12 completed months of spending) against data that simply looks like a real household.
//
// The data is rebuilt from scratch on every run, relative to today, in `.demo-household/`
// (gitignored) through the same VAULTSPEND_DB_DIR switch the e2e suite uses — never your real data.
//
// Usage:
//   npm run demo:household             # rebuild the data, launch the app
//   npm run demo:household -- --keep   # relaunch on the existing data (keeps your changes)
//   npm run demo:household -- --seed   # rebuild the data only, do not launch

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedTidyHousehold } from "./lib/practice-data/index.mjs";
import { demoEnv } from "./lib/demoEnv.mjs";

/** Creates the household database in `dbDir` (which must exist and not hold a vaultspend.db yet). */
export async function seedHouseholdDatabase(dbDir) {
  await seedTidyHousehold(dbDir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.chdir(repoRoot); // seed.mjs resolves target/debug/init_db.exe relative to cwd
  const exe = path.join(repoRoot, "target", "debug", "vaultspend.exe");
  const dataDir = path.join(repoRoot, ".demo-household");
  const args = new Set(process.argv.slice(2));

  if (!args.has("--keep") || !fs.existsSync(path.join(dataDir, "vaultspend.db"))) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    console.log("Seeding the household data (relative to today)...");
    await seedHouseholdDatabase(dataDir);
  }
  if (args.has("--seed")) {
    console.log(`Household data is in ${dataDir}`);
  } else {
    if (!fs.existsSync(exe)) {
      console.error("Build the app first: npx tauri build --debug --no-bundle");
      process.exit(1);
    }
    spawn(exe, [], { detached: true, stdio: "ignore", env: demoEnv(dataDir) }).unref();
    console.log(`Vault Spend is open on the household data in ${dataDir}. Re-run for a fresh copy.`);
  }
}
