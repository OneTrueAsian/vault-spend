// Measures where launch and data loading spend their time, on a disposable synthetic profile.
// Run after `npx tauri build --debug --no-bundle`:
//
//   node tools/startup-perf.mjs [rows=5000] [concentrated|spread] [look-alike|distinct]
//
// - concentrated: every row is dated in October 2026; spread: rows are spread over 2025.
// - look-alike: rows share an amount and a merchant once trailing numbers are dropped (the
//   2026-10-02 QA shape, the worst case for duplicate detection); distinct: they don't.
//
// Prints each command that took 20 ms or more (from VAULTSPEND_PERF_LOG, see src-tauri/src/perf_log.rs:
// start and duration in ms, and whether it ran on the main thread), the anomaly-flag reply as the page
// sees it, and how long the Transactions and Dashboard tabs take to show.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp } from "../e2e/harness.mjs";
import { seedFixture } from "../e2e/lib/seed.mjs";

const count = Number(process.argv[2] ?? 5000);
const shape = process.argv[3] ?? "concentrated";
const descriptions = process.argv[4] ?? "look-alike";
const SETTLE_MS = 5000;

const date = shape === "spread"
  ? "'2025-' + str(i % 12 + 1).zfill(2) + '-' + str((i // 12) % 28 + 1).zfill(2)"
  : "'2026-10-' + str(i % 28 + 1).zfill(2)";
const description = descriptions === "distinct" ? "'Performance entry ' + str(i) + ' ref'" : "'Performance entry ' + str(i)";
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Performance Checking', 'checking', '1000')")
account_id = cur.lastrowid
cur.execute("INSERT INTO categories (name) VALUES ('Performance')")
cur.executemany(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    ((account_id, ${date}, ${description}, '-12.34', 'Performance', 'perf-' + str(i)) for i in range(${count}))
)
`);

const log = path.join(os.tmpdir(), `vaultspend-perf-${count}-${shape}-${descriptions}-${Date.now()}.jsonl`);
process.env.VAULTSPEND_PERF_LOG = log;
console.log(`${count} rows, ${shape}, ${descriptions} descriptions`);

const launchStarted = Date.now();
const app = await launchApp({ dbDir });
const { browser } = app;
try {
  console.log("launch to usable shell:", Date.now() - launchStarted, "ms");
  await browser.pause(SETTLE_MS);

  const flags = await browser.executeAsync((done) => {
    const started = performance.now();
    window.__TAURI_INTERNALS__.invoke("list_anomaly_flags").then(
      (f) => done({ flags: f.length, ms: Math.round(performance.now() - started), bytes: JSON.stringify(f).length }),
      (e) => done({ error: String(e) }),
    );
  });
  console.log("list_anomaly_flags from the page:", JSON.stringify(flags));

  // Main-thread responsiveness: the startup batch of reads (App.tsx `refresh` and `refreshDashboard`),
  // while a trivial main-thread call (the app version) is pinged every 25 ms. The window can only
  // react to the person while the main thread is free, so the slowest ping is how long it froze.
  const responsiveness = await browser.executeAsync((done) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const now = new Date();
    const reads = [
      ["list_transactions"], ["get_stats"], ["list_accounts"], ["list_categories"], ["list_categories_with_icons"],
      ["list_anomaly_flags"], ["list_all_tags"], ["list_family_members"], ["net_worth_history", { months: 6 }],
      ["spending_this_month"], ["budget_alerts_for_month", { year: now.getFullYear(), month: now.getMonth() + 1 }],
      ["dashboard_insights"], ["average_monthly_spend"],
    ];
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
    Promise.all(reads.map(([cmd, args]) => invoke(cmd, args))).then(
      () => {
        const loadMs = performance.now() - started;
        loading = false;
        setTimeout(() => done({ loadMs: Math.round(loadMs), pings: pings.length, slowestPingMs: Math.round(Math.max(...pings)) }), 100);
      },
      (e) => done({ error: String(e) }),
    );
  });
  console.log("startup reads with main-thread pings:", JSON.stringify(responsiveness));

  // What the page re-reads after an edit: the whole-ledger refresh() vs refreshRows() for one row.
  const afterEdit = await browser.executeAsync((done) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const time = async (calls) => {
      const started = performance.now();
      await Promise.all(calls.map(([cmd, args]) => invoke(cmd, args)));
      return Math.round(performance.now() - started);
    };
    const common = [["get_stats"], ["list_accounts"], ["list_categories"], ["list_anomaly_flags"], ["list_all_tags"]];
    invoke("list_transactions").then(async (rows) => {
      const full = await time([["list_transactions"], ["list_categories_with_icons"], ["list_family_members"], ...common]);
      const oneRow = await time([["list_transactions_by_ids", { ids: [rows[0].id] }], ...common]);
      done({ fullRefreshMs: full, oneRowRefreshMs: oneRow });
    }, (e) => done({ error: String(e) }));
  });
  console.log("re-read after an edit:", JSON.stringify(afterEdit));

  // Additive measurement of the new path. The earlier legacy batches stay comparable with baseline.
  const coherent = await browser.executeAsync(done => {
    (async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const context = await invoke("get_transaction_context");
      const args = { expectedGeneration: context.generation, expectedSessionRevision: context.sessionRevision, ids: null };
      const pings = []; let capturing = true; let lastPing = Promise.resolve();
      const ping = () => {
        if (!capturing) return;
        const sent = performance.now();
        lastPing = invoke("plugin:app|version").then(() => { pings.push(performance.now() - sent); if (capturing) setTimeout(ping, 25); });
      };
      ping();
      const started = performance.now();
      const full = await invoke("get_transaction_snapshot", args);
      const fullMs = performance.now() - started;
      capturing = false; await lastPing;
      const encodedAt = performance.now(); const json = JSON.stringify(full); const stringifyMs = performance.now() - encodedAt;
      const parseAt = performance.now(); JSON.parse(json); const parseMs = performance.now() - parseAt;
      const rowAt = performance.now(); await invoke("get_transaction_snapshot", { ...args, ids: [full.transactions[0].id] });
      const oneRowMs = performance.now() - rowAt;
      await invoke("update_transaction_notes", { transactionId: full.transactions[0].id, notes: "Disposable performance fixture note", expectedSessionRevision: context.sessionRevision });
      const editedFullAt = performance.now(); await invoke("get_transaction_snapshot", args); const editedFullMs = performance.now() - editedFullAt;
      await invoke("update_transaction_notes", { transactionId: full.transactions[0].id, notes: null, expectedSessionRevision: context.sessionRevision });
      const editedRowAt = performance.now(); await invoke("get_transaction_snapshot", { ...args, ids: [full.transactions[0].id] }); const editedRowMs = performance.now() - editedRowAt;
      document.documentElement.setAttribute("data-vault-transaction-perf", ""); window.__vaultTransactionPerf = [];
      done({ fullMs: Math.round(fullMs), oneRowMs: Math.round(oneRowMs), editedFullMs: Math.round(editedFullMs), editedRowMs: Math.round(editedRowMs), pings: pings.length, slowestPingMs: Math.round(Math.max(0, ...pings)), rows: full.transactions.length, flags: full.flags.length, bytes: new TextEncoder().encode(json).length, stringifyMs, parseMs, amount: full.transactions[0].amount, balance: full.accounts[0].current_balance });
    })().catch(error => done({ error: String(error) }));
  });
  console.log("coherent snapshot:", JSON.stringify(coherent));

  for (const tab of ["Transactions", "Dashboard"]) {
    const started = await browser.execute((label) => {
      [...document.querySelectorAll("nav button")].find((b) => b.textContent.trim() === label).click();
      return performance.now();
    }, tab);
    if (tab === "Transactions") {
      await browser.waitUntil(() => browser.execute(() => document.querySelectorAll("table.ledger tbody tr").length > 0), { timeout: 60000, interval: 20 });
    } else {
      await browser.pause(300);
    }
    console.log(`${tab} tab:`, Math.round((await browser.execute(() => performance.now())) - started), "ms");
  }
  console.log("transaction stage samples:", JSON.stringify(await browser.execute(() => window.__vaultTransactionPerf ?? [])));
} finally {
  await app.close();
}

const lines = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
console.log("\n  start_ms      ms  thread  command");
for (const l of lines.filter((l) => l.ms >= 20)) {
  console.log(`${l.start_ms.toFixed(0).padStart(10)} ${l.ms.toFixed(0).padStart(7)}  ${l.main_thread ? "main  " : "worker"}  ${l.cmd}`);
}
console.log(`\n${lines.length} commands, ${lines.reduce((a, l) => a + l.ms, 0).toFixed(0)} ms in total. Log: ${log}`);
