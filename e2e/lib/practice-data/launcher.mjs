// The one launcher behind `npm run demo`, `npm run demo:household` and `npm run demo:statements`: it builds the shared
// practice data into `.demo-data/` and opens the real compiled app on it, with its own data and WebView2 storage, so
// the real profile and the installed app are never touched.
//
//   (no flag)  rebuild the practice data, then open the app
//   --keep     reopen on the existing practice data (keeps your changes)
//   --seed     rebuild the practice data only, do not open the app
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { demoEnv } from "../demoEnv.mjs";
import { buildPracticeData } from "./registry.mjs";

/** What a launch does. A rebuild wipes the folder, so it is refused while Vault Spend is running. */
export function launchPlan({ args, registryExists, appRunning }) {
  const launch = !args.has("--seed");
  if (args.has("--keep") && registryExists) return { action: "reuse", launch: true };
  if (appRunning) return { action: "refuse", launch: false };
  return { action: "build", launch };
}

function vaultSpendRunning() {
  try {
    const count = execFileSync("powershell", ["-NoProfile", "-Command", "(Get-Process -Name vaultspend -ErrorAction SilentlyContinue | Measure-Object).Count"], { encoding: "utf8" }).trim();
    return Number(count) > 0;
  } catch {
    return false; // the check is best-effort
  }
}

/** Builds (or reuses) `.demo-data` under `repoRoot` and opens the app on it. `extraNote` is printed before launching. */
export async function runPracticeLauncher({ repoRoot, args, extraNote }) {
  process.chdir(repoRoot); // the seed helpers resolve target/debug/init_db.exe relative to the repo
  const exe = path.join(repoRoot, "target", "debug", "vaultspend.exe");
  const dataDir = path.join(repoRoot, ".demo-data");
  const plan = launchPlan({
    args,
    registryExists: fs.existsSync(path.join(dataDir, "profiles.json")),
    appRunning: !(args.has("--keep") && fs.existsSync(path.join(dataDir, "profiles.json"))) && vaultSpendRunning(),
  });
  if (plan.action === "refuse") {
    console.error("Vault Spend is already running. Close it (including from the tray icon), then run this again, or add --keep to reopen your existing practice data.");
    process.exit(1);
  }
  if (plan.action === "build") {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    console.log("Building the practice data (relative to today)...");
    await buildPracticeData(dataDir);
  }
  console.log(`\nPractice data: ${dataDir}`);
  console.log(`What's in it (profiles, the Locked profile's password): ${path.join(dataDir, "README.txt")}`);
  console.log(`Practice files to upload or import: ${path.join(dataDir, "files")}`);
  console.log(`A second backup folder to try: ${path.join(dataDir, "second-copy")}`);
  if (extraNote) console.log(extraNote);
  if (!plan.launch) return;
  if (!fs.existsSync(exe)) {
    console.error("Build the app first: npx tauri build --debug --no-bundle (or npm run demo -- --build)");
    process.exit(1);
  }
  spawn(exe, [], { detached: true, stdio: "ignore", env: demoEnv(dataDir) }).unref();
  console.log("\nVault Spend is open on the practice data. Pick a profile; the main household is already chosen.");
  console.log("Re-run any time for a fresh copy, or add --keep to carry on where you left off.\n");
}
