// Runs smoke.mjs + every feature*.mjs spec with bounded concurrency,
// instead of one at a time. Safe to parallelize because each spec already
// gets its own throwaway SQLite file (harness.mjs's freshTestDbDir/seedFixture)
// and, since harness.mjs picks a fresh OS-assigned port per launchApp() call
// instead of a hardcoded one, its own tauri-driver instance too — no two
// concurrent specs share any state.
//
// Usage:
//   node e2e/run-all.mjs                 # default concurrency (6)
//   node e2e/run-all.mjs --concurrency=8
//   node e2e/run-all.mjs --concurrency=1  # effectively the old sequential behavior
//   node e2e/run-all.mjs --spec=75,77      # only matching feature numbers
//   node e2e/run-all.mjs --spec=smoke      # quick launch check
//   node e2e/run-all.mjs --list            # show selected specs without launching
//
// Default was benchmarked on this machine (16 logical cores) at 4/6/8 with
// this same runner: 4 ~66.8s avg, 6 ~55.2s avg, 8 ~53.5s avg but with an
// early sign of resource contention (one spec spiking to 15.3s that
// normally takes ~4-6s). 6 gets essentially all of 8's wall-time benefit
// without pushing into that contention zone — see the "reduce E2E testing
// time" report for the full methodology. Re-benchmark if the spec count or
// machine changes meaningfully.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedTempEnv, keepTempFiles, makeTempDir, removeDir, removeStaleDirs } from "./lib/tempDir.mjs";
import { resolveSpecTimeout } from "./lib/specTimeout.mjs";
import { BUILD_MODE, exePath, lastRunPath, lockDir, recordPath, repoRoot } from "./lib/accessPaths.mjs";
import { collectInputs, readToolchain } from "./lib/buildIdentity.mjs";
import { GuardRefusal, beginGuardedRun } from "./lib/runGuard.mjs";
import { classifySpecs, runSchedule } from "./lib/scheduler.mjs";
import { matchesSelector } from "./lib/specSelectors.mjs";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));

const concurrencyArg = process.argv.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 6;
if (!Number.isInteger(concurrency) || concurrency < 1) {
  console.error(`--concurrency must be a positive integer, got "${concurrencyArg}"`);
  process.exit(1);
}

// --schedule=pool (default): every spec shares one pool of `concurrency` workers, as before.
// --schedule=classified: only specs listed parallel-safe in e2e/spec-classification.json share the pool; every other spec is exclusive
// and runs completely alone, after the pool has drained. A spec the file does not mention is exclusive.
const scheduleArg = process.argv.find((a) => a.startsWith("--schedule="));
const schedule = scheduleArg ? scheduleArg.split("=")[1] : "pool";
if (!["pool", "classified"].includes(schedule)) {
  console.error(`--schedule must be "pool" or "classified", got "${scheduleArg.split("=")[1]}"`);
  process.exit(1);
}

// A spec hanging (a WebDriver session that never resolves, a blocking
// native dialog nothing dismisses) used to be able to stall this runner
// indefinitely — one stuck worker slot, forever. Every current spec finishes
// in single-digit-to-teens seconds, so 60s is a generous ceiling that only
// ever fires on a genuine hang, not a slow-but-fine run.
const SPEC_TIMEOUT_MS = resolveSpecTimeout();

const allSpecs = ["smoke.mjs", ...fs.readdirSync(e2eDir).filter((f) => /^feature\d+.*\.mjs$/.test(f)).sort(
  (a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]),
)];
const specArg = process.argv.find((a) => a.startsWith("--spec="));
const selectors = specArg?.slice("--spec=".length).split(",").map((s) => s.trim()).filter(Boolean);
if (specArg && !selectors?.length) {
  console.error("--spec needs a comma-separated list of feature numbers, names, or smoke");
  process.exit(1);
}
if (selectors) {
  for (const selector of selectors) {
    if (!allSpecs.some((name) => matchesSelector(name, selector))) {
      console.error(`No E2E spec matches "${selector}". Use --list to see available specs.`);
      process.exit(1);
    }
  }
}
const specs = selectors ? allSpecs.filter((name) => selectors.some((selector) => matchesSelector(name, selector))) : allSpecs;
let classification;
try { classification = JSON.parse(fs.readFileSync(path.join(e2eDir, "spec-classification.json"), "utf8")); } catch { classification = undefined; } // unreadable: everything exclusive
const effectiveClassification = schedule === "classified" ? classification : { parallelSafe: specs };
const classes = classifySpecs(specs, effectiveClassification);
if (process.argv.includes("--list")) {
  console.log(schedule === "classified"
    ? specs.map((name) => `${name}  [${classes.parallel.includes(name) ? "parallel-safe" : "exclusive"}]`).join("\n")
    : specs.join("\n"));
  process.exit(0);
}

// Longest-first scheduling: sort specs by their last recorded duration
// (descending) so the slowest ones start first instead of landing wherever
// numeric file order happens to put them — a slow spec starting last can
// leave every other worker idle while the whole run waits on just it. Specs
// with no recorded duration yet (a fresh checkout, or a spec added since
// the last successful run) keep their natural file order, appended after
// everything we do have data for. On a brand new checkout with no history
// file at all, every spec is "unknown" and this degrades to the original
// plain file-order behavior.
const DURATIONS_PATH = path.join(e2eDir, ".e2e-durations.json");

function loadDurations() {
  try {
    return JSON.parse(fs.readFileSync(DURATIONS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveDurations(map) {
  try {
    fs.writeFileSync(DURATIONS_PATH, JSON.stringify(map, null, 2) + "\n");
  } catch {
    /* best effort — scheduling data is an optimization, not correctness */
  }
}

// child_process.kill() on Windows only signals the immediate process, not
// any processes *it* spawned (tauri-driver, in turn, launches msedgedriver
// and the app itself) — killing just the outer `node spec.mjs` process on
// timeout would orphan those. taskkill's /t walks the whole process tree.
function killTree(pid) {
  try {
    execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
  } catch {
    /* already exited, or taskkill itself unavailable — nothing more to do */
  }
}

// Every spec gets a temp folder of its own (TEMP/TMP point at it, so the spec, its databases, tauri-driver,
// msedgedriver and the app's WebView2 profiles all write there), deleted when the spec ends — passed, failed
// or killed on timeout, when its own exit cleanup never runs. This is what keeps a full run from leaving
// gigabytes of scoped_dir* WebView2 profiles behind. VAULTSPEND_KEEP_E2E_TEMP=1 keeps them for debugging.
const RUNS_ROOT = path.join(os.tmpdir(), "vaultspend-e2e-runs");
// A run killed before it could clean up leaves its folder behind; delete those once they are clearly not a
// run still going on alongside this one.
removeStaleDirs(RUNS_ROOT, 6 * 60 * 60 * 1000);
fs.mkdirSync(RUNS_ROOT, { recursive: true });
const runTempDir = makeTempDir("run-", { base: RUNS_ROOT });

function runSpec(name) {
  return new Promise((resolve) => {
    const start = Date.now();
    const specTempDir = fs.mkdtempSync(path.join(runTempDir, `${path.basename(name, ".mjs")}-`));
    const child = spawn(process.execPath, [path.join(e2eDir, name)], {
      cwd: path.resolve(e2eDir, ".."),
      stdio: "pipe",
      env: { ...process.env, ...isolatedTempEnv(specTempDir) },
    });
    let output = "";
    let timedOut = false;
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      output += `\n[run-all] TIMED OUT after ${SPEC_TIMEOUT_MS}ms — killing process tree (pid ${child.pid})\n`;
      killTree(child.pid);
    }, SPEC_TIMEOUT_MS);
    const removeSpecTemp = () => {
      if (keepTempFiles()) output += `\n[run-all] temp files kept in ${specTempDir}\n`;
      else removeDir(specTempDir);
    };
    child.on("error", (err) => {
      clearTimeout(timer);
      output += `\n[run-all] failed to start "${name}": ${err.stack || err}\n`;
      removeSpecTemp();
      resolve({ name, code: 1, output, durationMs: Date.now() - start });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      removeSpecTemp();
      resolve({ name, code: timedOut ? 1 : code, output, durationMs: Date.now() - start });
    });
  });
}

// Scheduling lives in lib/scheduler.mjs (bounded pool for parallel-safe specs, exclusive specs alone); this adds the progress lines.
async function runAndReport(name) {
  console.log(`start  ${name}`);
  const result = await runSpec(name);
  console.log(`${result.code === 0 ? "PASS  " : "FAIL  "} ${name} (${(result.durationMs / 1000).toFixed(1)}s)`);
  return result;
}

const knownDurations = loadDurations();

// Exclusive access to the shared executable for the whole run, and proof that the executable is the one built from the current
// inputs. A refusal changes nothing and starts nothing. --wait queues behind a build or another run instead of refusing.
let guard;
try {
  guard = await beginGuardedRun({
    operation: "desktop-run", lockDir, exePath, recordPath, collectInputs: () => collectInputs(repoRoot), toolchain: readToolchain(), mode: BUILD_MODE,
    wait: process.argv.includes("--wait"), timeoutMs: 30 * 60 * 1000, allowStale: process.argv.includes("--allow-stale-artifact"),
  });
} catch (error) {
  if (error instanceof GuardRefusal || error.name === "AccessHeldError" || error.name === "AccessTimeoutError") { console.error(error.message); process.exit(2); }
  throw error;
}
process.once("SIGINT", () => { guard.abort(); process.exit(130); });
if (guard.artifact.status === "unknown") console.log(`Note: ${guard.artifact.reason} Results are labelled artifact=unknown. Use "npm run build:app" to record it.`);
else if (guard.artifact.status === "stale") console.log(`WARNING: running against a stale executable (--allow-stale-artifact). ${guard.artifact.reason}`);

const overallStart = Date.now();
console.log(schedule === "classified"
  ? `Running ${specs.length} specs, classified: ${classes.parallel.length} parallel-safe at concurrency ${concurrency}, then ${classes.exclusive.length} exclusive one at a time...\n`
  : `Running ${specs.length} specs with concurrency ${concurrency}...\n`);
const results = await runSchedule({ specs, classification: effectiveClassification, concurrency, run: runAndReport, durations: knownDurations });
const totalSeconds = ((Date.now() - overallStart) / 1000).toFixed(1);
const verdict = await guard.finish();

// Only trust timings from specs that actually ran to a normal exit — a
// killed-on-timeout duration is an artifact of the timeout, not the spec,
// and would poison future scheduling by making it look permanently slow.
const updatedDurations = { ...knownDurations };
for (const r of results) {
  if (r.code === 0) updatedDurations[r.name] = r.durationMs;
}
saveDurations(updatedDurations);

const failed = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} passed in ${totalSeconds}s (concurrency ${concurrency})`);
const slowest = [...results].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);
console.log("Slowest specs: " + slowest.map((r) => `${r.name} ${(r.durationMs / 1000).toFixed(1)}s`).join(", "));
// A launch that stalls before its page loads is retried by harness.mjs. That is worth knowing about even
// when every spec then passes, so count the reports the specs printed.
const launchRetries = results.reduce((n, r) => n + (r.output.match(/\[harness\] launch retry/g)?.length ?? 0), 0);
if (launchRetries > 0) console.log(`Launch retries this run: ${launchRetries} (a driver/webview stall before any page loaded; see e2e/harness.mjs)`);
const timeouts = results.filter((r) => r.output.includes("[run-all] TIMED OUT")).length;
// Identity of what these results are evidence for: the build key and executable they ran against, and whether they remain valid.
console.log(`Artifact: ${verdict.identity.artifactStatus}, executable SHA-256 ${verdict.identity.exeSha256}, build key ${verdict.identity.buildKey?.slice(0, 16) ?? "unavailable"}, test key ${verdict.identity.testKey?.slice(0, 16) ?? "unavailable"}`);
try {
  fs.mkdirSync(path.dirname(lastRunPath), { recursive: true });
  fs.writeFileSync(lastRunPath, JSON.stringify({
    identity: verdict.identity, valid: verdict.valid, problems: verdict.problems, schedule, parallelSafe: classes.parallel.length, exclusive: classes.exclusive.length, concurrency, specTimeoutMs: SPEC_TIMEOUT_MS, elapsedSeconds: Number(totalSeconds), launchRetries, timeouts,
    selected: specs, executed: results.map((r) => ({ name: r.name, code: r.code, durationMs: r.durationMs })),
  }, null, 2) + "\n");
} catch { /* the record is evidence for the report, not part of the verdict */ }
if (failed.length > 0) {
  console.log("\nFAILURES:");
  for (const f of failed) {
    console.log(`\n=== ${f.name} (exit ${f.code}) ===`);
    console.log(f.output);
  }
}
if (!verdict.valid) {
  console.log("\nINVALID EVIDENCE: the source or the executable changed while this run was in progress, so its results do not describe a single build:");
  for (const p of verdict.problems) console.log(`  - ${p.kind}${p.changed ? ` changed: ${[...p.changed, ...p.added].join(", ")}` : ""}${p.removed?.length ? ` removed: ${p.removed.join(", ")}` : ""}${p.after !== undefined ? ` (SHA-256 ${p.before} -> ${p.after ?? "missing"})` : ""}`);
}
if (failed.length > 0) process.exit(1);
if (!verdict.valid) process.exit(3);
