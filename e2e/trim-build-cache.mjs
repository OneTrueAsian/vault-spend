// node e2e/trim-build-cache.mjs [--dry-run] [--limit-gb=10] [--max-age-days=14]
// Cleans the external Cargo build-dir named by CARGO_BUILD_BUILD_DIR (VS-6). Run it between sessions: it skips, deleting nothing,
// when a build or desktop run holds exclusive access. The next build after a purge is slower; it recreates everything.
import { lockDir, repoRoot } from "./lib/accessPaths.mjs";
import { trimBuildCache } from "./lib/buildCache.mjs";

const flag = (name, fallback) => { const hit = process.argv.find(a => a.startsWith(`--${name}=`)); return hit ? Number(hit.split("=")[1]) : fallback; };
const buildDir = process.env.CARGO_BUILD_BUILD_DIR;
if (!buildDir) { console.error("CARGO_BUILD_BUILD_DIR is not set, so there is no external build cache to clean."); process.exit(64); }
try {
  const result = await trimBuildCache({ buildDir, repoRoot, lockDir, dryRun: process.argv.includes("--dry-run"), limitBytes: flag("limit-gb", 10) * 1024 ** 3, maxAgeDays: flag("max-age-days", 14) });
  console.log(`${result.dryRun ? "[dry run] " : ""}${result.action}: ${(result.bytes / 1024 ** 3).toFixed(2)} GB in ${buildDir}${result.reason ? `\n${result.reason}` : ""}`);
  process.exit(result.action === "skipped-busy" ? 2 : 0);
} catch (error) { console.error(error.message); process.exit(1); }
