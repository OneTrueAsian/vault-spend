// Reproduces load-dependent E2E failures on demand. Runs one spec many times, several copies at the same
// instant (each with its own app, driver and throwaway database, exactly like run-all.mjs), with busy-loop
// processes hogging CPU alongside, then reports the pass rate and each distinct failure. A spec that passes
// alone but fails in full runs usually fails here too, so a fix can be shown to work (fails before, passes
// after) instead of "it passed this time".
//
//   node e2e/stress.mjs <spec file> [rounds=5] [copies=6] [spinners=12]
//   node e2e/stress.mjs e2e/feature121_auto_lock_settings.mjs 8 6 12
//
// Build the app first (see README.md) and point VAULTSPEND_EXE at it if it is not target/debug. Full output
// of every failing run is written to a stress-fail-*.txt file in STRESS_OUT (default: the temp folder).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [spec, roundsArg = "5", copiesArg = "6", spinnersArg = "12"] = process.argv.slice(2);
if (!spec) {
  console.error("usage: node e2e/stress.mjs <spec file> [rounds=5] [copies=6] [spinners=12]");
  process.exit(1);
}
const rounds = Number(roundsArg);
const copies = Number(copiesArg);
const spinners = Number(spinnersArg);
const outDir = process.env.STRESS_OUT ?? os.tmpdir();
// Longer than run-all.mjs's 60 s cap on purpose: a hang should show up as a hang, not be cut short.
const TIMEOUT_MS = 90_000;

function killTree(pid) {
  try {
    execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
  } catch {
    /* already gone */
  }
}

const load = Array.from({ length: spinners }, () => spawn(process.execPath, ["-e", "for(;;){}"], { stdio: "ignore" }));

function runOnce() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.resolve(spec)], { stdio: "pipe" });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      out += "\n[stress] TIMED OUT";
      killTree(child.pid);
    }, TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

const failures = new Map();
let passed = 0;
let total = 0;
let retries = 0;
try {
  for (let round = 1; round <= rounds; round++) {
    const results = await Promise.all(Array.from({ length: copies }, runOnce));
    for (const res of results) {
      total++;
      retries += (res.out.match(/\[harness\] launch retry/g) ?? []).length;
      if (res.code === 0) {
        passed++;
        continue;
      }
      const lines = res.out.split(/\r?\n/);
      const headline = lines.find((l) => /^(\w*Error|AssertionError)[\s:[]/.test(l)) ?? lines.find((l) => /TIMED OUT/.test(l)) ?? lines.at(-3) ?? "";
      const key = headline.trim().slice(0, 700);
      failures.set(key, (failures.get(key) ?? 0) + 1);
      fs.writeFileSync(path.join(outDir, `stress-fail-${path.basename(spec, ".mjs")}-${total}.txt`), res.out);
    }
    console.log(`round ${round}/${rounds}: ${results.filter((r) => r.code === 0).length}/${copies} passed`);
  }
} finally {
  for (const p of load) p.kill();
}
console.log(`\n${path.basename(spec)}: ${passed}/${total} passed (copies=${copies}, spinners=${spinners}), launch retries used: ${retries}`);
for (const [message, count] of failures) console.log(`  ${count}x  ${message}`);
process.exit(failures.size === 0 ? 0 : 1);
