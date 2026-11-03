// Hosted sharded gate: `stage <dir>` (after the build) packs the debug executable, its build record and the database fixture tool;
// `receive <dir>` (in each test job) unpacks them and prints what the unchanged build-identity guard says. Only "fresh" exits 0.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { BUILD_MODE, exePath, recordPath, repoRoot } from "../e2e/lib/accessPaths.mjs";
import { collectInputs, readToolchain } from "../e2e/lib/buildIdentity.mjs";
import { receiveBuild, stageBuild } from "../e2e/lib/buildTransfer.mjs";

const [action, dir] = process.argv.slice(2);
if (!["stage", "receive"].includes(action) || !dir) { console.error("Usage: node tools/transfer-build.mjs stage|receive <directory>"); process.exit(2); }
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const common = { exePath, recordPath, initDbPath: path.join(repoRoot, "target", "debug", "init_db.exe"), stageDir: path.resolve(dir), sourceSha, inputs: await collectInputs(repoRoot), toolchain: readToolchain(), mode: BUILD_MODE };
try {
  if (action === "stage") {
    const manifest = stageBuild(common);
    console.log(`Staged ${exePath}: SHA-256 ${manifest.exeSha256}, build key ${manifest.buildKey}, source ${manifest.sourceSha}.`);
  } else {
    const result = receiveBuild(common);
    console.log(`Build-identity check on the transferred executable: ${result.status}.`);
    for (const problem of result.problems) console.log(`  - ${problem}`);
    if (result.status !== "fresh" || result.problems.length) process.exit(1);
    console.log(`Accepted: SHA-256 ${result.manifest.exeSha256}, build key ${result.manifest.buildKey}.`);
  }
} catch (error) { console.error(error.message); process.exit(1); }
