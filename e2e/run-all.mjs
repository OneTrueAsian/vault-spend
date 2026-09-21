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
import path from "node:path";
import { fileURLToPath } from "node:url";

const e2eDir = path.dirname(fileURLToPath(import.meta.url));

const concurrencyArg = process.argv.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 6;
if (!Number.isInteger(concurrency) || concurrency < 1) {
  console.error(`--concurrency must be a positive integer, got "${concurrencyArg}"`);
  process.exit(1);
}

// A spec hanging (a WebDriver session that never resolves, a blocking
// native dialog nothing dismisses) used to be able to stall this runner
// indefinitely — one stuck worker slot, forever. Every current spec finishes
// in single-digit-to-teens seconds, so 60s is a generous ceiling that only
// ever fires on a genuine hang, not a slow-but-fine run.
const SPEC_TIMEOUT_MS = 60_000;

const allSpecs = ["smoke.mjs", ...fs.readdirSync(e2eDir).filter((f) => /^feature\d+.*\.mjs$/.test(f)).sort(
  (a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]),
)];
const specArg = process.argv.find((a) => a.startsWith("--spec="));
const selectors = specArg?.slice("--spec=".length).split(",").map((s) => s.trim()).filter(Boolean);
if (specArg && !selectors?.length) {
  console.error("--spec needs a comma-separated list of feature numbers, names, or smoke");
  process.exit(1);
}
function matchesSelector(name, selector) {
  if (selector === "smoke") return name === "smoke.mjs";
  if (/^\d+$/.test(selector)) return name.startsWith(`feature${Number(selector)}_`);
  return name.toLowerCase().includes(selector.toLowerCase());
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
if (process.argv.includes("--list")) {
  console.log(specs.join("\n"));
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

function orderByHistory(names, knownDurations) {
  const withHistory = names.filter((n) => knownDurations[n] !== undefined).sort((a, b) => knownDurations[b] - knownDurations[a]);
  const withoutHistory = names.filter((n) => knownDurations[n] === undefined);
  return [...withHistory, ...withoutHistory];
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

function runSpec(name) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [path.join(e2eDir, name)], { cwd: path.resolve(e2eDir, ".."), stdio: "pipe" });
    let output = "";
    let timedOut = false;
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      output += `\n[run-all] TIMED OUT after ${SPEC_TIMEOUT_MS}ms — killing process tree (pid ${child.pid})\n`;
      killTree(child.pid);
    }, SPEC_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      output += `\n[run-all] failed to start "${name}": ${err.stack || err}\n`;
      resolve({ name, code: 1, output, durationMs: Date.now() - start });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ name, code: timedOut ? 1 : code, output, durationMs: Date.now() - start });
    });
  });
}

// A small fixed-size worker pool: `concurrency` specs in flight at once,
// each starting the next spec off the shared queue as soon as it finishes
// — simpler than a generic promise-pool dependency for a queue this small.
async function runAll(names, limit) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < names.length) {
      const name = names[next++];
      console.log(`start  ${name}`);
      const result = await runSpec(name);
      console.log(`${result.code === 0 ? "PASS  " : "FAIL  "} ${name} (${(result.durationMs / 1000).toFixed(1)}s)`);
      results.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, names.length) }, worker));
  return results;
}

const knownDurations = loadDurations();
const orderedSpecs = orderByHistory(specs, knownDurations);

const overallStart = Date.now();
console.log(`Running ${specs.length} specs with concurrency ${concurrency}...\n`);
const results = await runAll(orderedSpecs, concurrency);
const totalSeconds = ((Date.now() - overallStart) / 1000).toFixed(1);

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
if (failed.length > 0) {
  console.log("\nFAILURES:");
  for (const f of failed) {
    console.log(`\n=== ${f.name} (exit ${f.code}) ===`);
    console.log(f.output);
  }
  process.exit(1);
}
