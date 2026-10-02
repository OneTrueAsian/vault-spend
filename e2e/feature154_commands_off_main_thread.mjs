// E2E test: the app's commands run on their own worker thread, so the window stays responsive while
// a large profile loads (see src-tauri/src/command_thread.rs).
//
// - Every app command the page sends runs off the main thread (from the VAULTSPEND_PERF_LOG timing log).
// - An unknown command is still rejected the way Tauri words it.
// - With 20,000 transactions, the startup reads take a while, and a trivial main-thread call sent
//   alongside them keeps answering instead of waiting behind them (before the worker, the window froze
//   for the whole batch).
//
// Run with: node e2e/feature154_commands_off_main_thread.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROWS = 20000;
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000')")
account_id = cur.lastrowid
cur.executemany(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    ((account_id, '2026-' + str(i % 9 + 1).zfill(2) + '-' + str(i % 28 + 1).zfill(2), 'Store ' + str(i) + ' ref', '-12.34', 'Groceries', 'f154-' + str(i)) for i in range(${ROWS}))
)
`);
const log = path.join(os.tmpdir(), `vaultspend-feature154-${process.pid}.jsonl`);
fs.rmSync(log, { force: true });
process.env.VAULTSPEND_PERF_LOG = log;

const app = await launchApp({ dbDir });
try {
  const { browser } = app;

  // The startup batch of reads, with the app version (a main-thread call) pinged every 25 ms.
  const run = await browser.executeAsync((done) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const reads = ["list_transactions", "get_stats", "list_accounts", "list_categories", "list_anomaly_flags", "dashboard_insights", "list_transactions", "get_stats"];
    const pings = [];
    let loading = true;
    const ping = () => {
      if (!loading) return;
      const sent = performance.now();
      invoke("plugin:app|version").then(() => {
        pings.push(performance.now() - sent);
        setTimeout(ping, 25);
      });
    };
    const started = performance.now();
    ping();
    Promise.all(reads.map((cmd) => invoke(cmd))).then(
      (results) => {
        const loadMs = performance.now() - started;
        loading = false;
        setTimeout(() => done({ loadMs, pings, rows: results[0].length }), 100);
      },
      (e) => done({ error: String(e) }),
    );
  });
  assert.equal(run.error, undefined, run.error);
  assert.equal(run.rows, ROWS, "the reads returned the whole profile");
  const slowest = Math.max(...run.pings);
  console.log(`reads took ${Math.round(run.loadMs)} ms; ${run.pings.length} pings, slowest ${Math.round(slowest)} ms`);
  assert.ok(run.pings.length >= 5, `the main thread kept answering during the reads (${run.pings.length} pings in ${Math.round(run.loadMs)} ms)`);
  assert.ok(slowest < run.loadMs / 2, `no ping waited behind the batch (slowest ${Math.round(slowest)} ms of ${Math.round(run.loadMs)} ms)`);

  // An unknown command is rejected, not left hanging.
  const unknown = await browser.executeAsync((done) => {
    window.__TAURI_INTERNALS__.invoke("no_such_command").then(() => done("resolved"), (e) => done(String(e)));
  });
  assert.match(unknown, /Command no_such_command not found/);

  // Every app command ran on the worker.
  const lines = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.some((l) => l.cmd === "list_transactions"), "the timing log saw the reads");
  const onMain = lines.filter((l) => l.main_thread).map((l) => l.cmd);
  assert.deepEqual(onMain, [], "no app command ran on the main thread");

  console.log("FEATURE 154 E2E TEST PASSED");
} finally {
  await app.close();
  fs.rmSync(log, { force: true });
}
