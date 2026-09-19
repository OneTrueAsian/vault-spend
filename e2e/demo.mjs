// `npm run demo` — opens the REAL compiled app (not a mock, not the dev
// server) on a freshly seeded demo database, so a phase of the enhancement
// program can be tried out by hand with realistic data. The data is rebuilt
// from scratch every launch, relative to today's date, so every run starts
// the same and nothing you do in the demo can leak into real data: it uses a
// throwaway folder (`.demo-data/`, gitignored) through the same
// VAULTSPEND_DB_DIR switch the e2e suite uses, never your real AppData file.
//
// Usage:
//   npm run demo                # rebuild the demo data, launch the app
//   npm run demo -- --keep      # relaunch on the existing demo data (keeps your changes)
//   npm run demo -- --build     # (re)build the app first
//
// Needs: python (for seeding — already required by the e2e suite) and a built
// app (`npx tauri build --debug --no-bundle`; this script builds it if missing).

import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedDemoDatabase } from "./lib/demo-seed.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(repoRoot); // seed.mjs resolves target/debug/init_db.exe relative to cwd

const exe = path.join(repoRoot, "target", "debug", "vaultspend.exe");
const initDb = path.join(repoRoot, "target", "debug", "init_db.exe");
const demoDir = path.join(repoRoot, ".demo-data");
const args = new Set(process.argv.slice(2));

function run(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: true, cwd: repoRoot });
  if (result.status !== 0) {
    console.error(`\n"${cmd} ${cmdArgs.join(" ")}" failed (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
}

if (args.has("--build") || !fs.existsSync(exe)) {
  console.log("Building the app (this takes a minute or two)...");
  run("npx", ["tauri", "build", "--debug", "--no-bundle"]);
}
if (!fs.existsSync(initDb)) {
  console.log("Building the database seeding helper...");
  run("cargo", ["build", "-p", "budget_core", "--bin", "init_db"]);
}

// A demo already running would hold the database file open.
try {
  const running = execFileSync("powershell", ["-NoProfile", "-Command", "(Get-Process -Name vaultspend -ErrorAction SilentlyContinue | Measure-Object).Count"], { encoding: "utf8" }).trim();
  if (Number(running) > 0 && !args.has("--keep")) {
    console.error("Vault Spend is already running. Close it (a running copy would hold the demo data open), then run this again.");
    process.exit(1);
  }
} catch {
  /* the check is best-effort — carry on */
}

if (!args.has("--keep") || !fs.existsSync(path.join(demoDir, "vaultspend.db"))) {
  fs.rmSync(demoDir, { recursive: true, force: true });
  fs.mkdirSync(demoDir, { recursive: true });
  console.log("Seeding demo data (relative to today)...");
  await seedDemoDatabase(demoDir);
}

// Things to point the Phase 2 features at: a folder for the second backup copy,
// and a small statement to import (which opens the review inbox afterwards).
fs.mkdirSync(path.join(demoDir, "second-copy"), { recursive: true });
const iso = (daysAgo) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
fs.writeFileSync(
  path.join(demoDir, "sample-import.csv"),
  [
    "Date,Description,Amount",
    `${iso(2)},Kroger,-64.12`,
    `${iso(2)},STARBUCKS #2210 BELLEVUE,-7.10`,
    `${iso(1)},Zenith Plumbing Services,-185.00`,
    `${iso(1)},PAYPAL *WHOLESALER,-46.80`,
    `${iso(1)},Ferrywood Coffee,-4.55`,
    `${iso(0)},Trader Joe's,-52.30`,
    `${iso(0)},Local Thai Kitchen,-33.90`,
    `${iso(0)},Amazon Marketplace,-312.00`,
  ].join("\n") + "\n",
);

console.log(`\nLaunching Vault Spend on the demo data in ${demoDir}\n`);
const child = spawn(exe, [], {
  detached: true,
  stdio: "ignore",
  env: { ...process.env, VAULTSPEND_DB_DIR: demoDir },
});
child.unref();
console.log(`Second backup folder to try:  ${path.join(demoDir, "second-copy")}`);
console.log(`Sample file to import:        ${path.join(demoDir, "sample-import.csv")}`);
console.log("Vault Spend is open. This is throwaway demo data — change anything you like.");
console.log("Re-run `npm run demo` any time for a fresh copy.\n");
