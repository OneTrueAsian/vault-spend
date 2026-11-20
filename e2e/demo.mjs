// `npm run demo` — opens the REAL compiled app (not a mock, not the dev server) on the shared practice data
// (e2e/lib/practice-data/, every feature's data listed in COVERAGE.md): the main household, Sam, Fresh start and
// Locked, plus practice files. It is rebuilt from scratch every launch, relative to today, in `.demo-data/`
// (gitignored), with its own data and WebView2 storage (demoEnv), so nothing touches your real profile.
//
// Usage:
//   npm run demo                # rebuild the practice data, launch the app
//   npm run demo -- --keep      # relaunch on the existing practice data (keeps your changes)
//   npm run demo -- --seed      # rebuild the practice data only, do not launch
//   npm run demo -- --build     # (re)build the app first
//
// Needs: python (for seeding — already required by the e2e suite) and a built
// app (`npx tauri build --debug --no-bundle`; this script builds it if missing).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPracticeLauncher } from "./lib/practice-data/launcher.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(repoRoot); // seed.mjs resolves target/debug/init_db.exe relative to cwd

const exe = path.join(repoRoot, "target", "debug", "vaultspend.exe");
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
  run("npm", ["run", "build:app", ...(args.has("--build") ? ["--", "--force"] : [])]);
}
// Always, so an older helper without --protect (the Locked practice profile) is brought up to date; cheap when current.
{
  console.log("Checking the database seeding helper...");
  run("node", ["e2e/with-access.mjs", "demo-init-db", "--", "cargo", "build", "-p", "budget_core", "--bin", "init_db"]);
}

// A demo already running would hold the practice data open; the launcher refuses to rebuild under it.
await runPracticeLauncher({ repoRoot, args });
