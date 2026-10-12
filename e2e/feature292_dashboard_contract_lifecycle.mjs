// Real native contracts, Dashboard failure/retry and origin-bound export/profile operations.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { isoDaysFromNow } from "./lib/dates.mjs";
const today = isoDaysFromNow(0),
  [year, month] = today.split("-").map(Number);
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts(name, account_type, starting_balance) VALUES ('Dashboard fixture', 'checking', '100')")
account_id=cur.lastrowid
cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,fingerprint,notes) VALUES (?, '${today}', 'Exact fixture', '-12.34', 'Groceries', 'f292', 'first line\\nsecond line')", (account_id,))
cur.execute("INSERT INTO budgets(period,category,monthly_amount,budget_group) VALUES ('${today.slice(0, 7)}','Groceries','50','flexible')")
`);
const bundle = await build({
  entryPoints: ["src/compactTransactionContracts.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "VaultCompact",
  platform: "browser",
});
const app = await launchApp({ dbDir }),
  b = app.browser;
const alter = (sql) =>
  execFileSync("python", [
    "-c",
    "import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);c.execute(sys.argv[2]);c.commit();c.close()",
    path.join(dbDir, "vaultspend.db"),
    sql,
  ]);
let renamed = false;
try {
  await b.execute(bundle.outputFiles[0].text + "\nwindow.VaultCompact=VaultCompact;");
  const actual = await b.executeAsync(
    (year, month, done) => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      (async () => {
        const context = await invoke("get_transaction_context"),
          origin = { expectedGeneration: context.generation, expectedSessionRevision: context.sessionRevision };
        const full = await invoke("get_transaction_snapshot", { ...origin, ids: null }),
          wire = await invoke("get_transaction_snapshot_compact", { ...origin, ids: null });
        const decoded = window.VaultCompact.validateTransactionWireSnapshot(wire);
        const dashboard = await invoke("get_dashboard_snapshot", origin),
          summary = await invoke("get_report_summary_snapshot", origin),
          budget = await invoke("get_budget_snapshot", { ...origin, year, month });
        done({ full, decoded, wireVersion: wire.contractVersion, dashboard, summary, budget });
      })().catch((e) => done({ fatal: String(e) }));
    },
    year,
    month,
  );
  assert.equal(actual.fatal, undefined);
  assert.deepEqual(actual.decoded, actual.full);
  assert.equal(actual.wireVersion, 2);
  assert.equal(actual.dashboard.report.budget_actuals.find((x) => x.category === "Groceries").actual, "12.34");
  assert.deepEqual(actual.dashboard.report, actual.summary.report);
  assert.equal(actual.summary.accounts[0].current_balance, "87.66");
  assert.equal(actual.dashboard.spending[0].amount, actual.budget.flow.total_expense);
  await b.$('[data-widget-id="stat_net_worth"] .stat-value').waitForExist({ timeout: 15000 });
  assert.match(await b.$('[data-widget-id="stat_net_worth"]').getText(), /87\.66/);
  alter("ALTER TABLE transactions RENAME TO transactions_f292_hold");
  renamed = true;
  await b.execute(() => {
    [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "Budget").click();
  });
  await b.execute(() => {
    [...document.querySelectorAll(".nav-item")].find((x) => x.textContent.trim() === "Dashboard").click();
  });
  // Dashboard refresh on re-entry must retain the last model and expose its failed read.
  await b.waitUntil(
    () =>
      b.execute(
        () => document.querySelector('[data-financial-read="Dashboard totals"]')?.getAttribute("role") === "alert",
      ),
    { timeout: 15000 },
  );
  assert.match(await b.$('[data-widget-id="stat_net_worth"]').getText(), /87\.66/);
  alter("ALTER TABLE transactions_f292_hold RENAME TO transactions");
  renamed = false;
  await b.$('[data-financial-read="Dashboard totals"] button').click();
  await b.waitUntil(() => b.execute(() => !document.querySelector('[data-financial-read="Dashboard totals"]')), {
    timeout: 15000,
  });
  const forbidden = path.join(dbDir, "must-not-export.csv");
  const mirror = path.join(dbDir, "second-profile-mirror");
  fs.mkdirSync(mirror);
  const retired = await b.executeAsync((forbidden, mirror, done) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    (async () => {
      const c = await invoke("get_transaction_context"),
        old = { expectedGeneration: c.generation, expectedSessionRevision: c.sessionRevision };
      await invoke("create_profile", { ...old, name: "Dashboard second fixture" });
      await invoke("set_backup_copy_dir", { dir: mirror });
      const refused = [];
      for (const [command, args] of [
        ["get_dashboard_snapshot", {}],
        ["get_report_summary_snapshot", {}],
        ["write_text_file", { path: forbidden, content: "private old profile" }],
        ["fetch_live_quote", { symbol: "FIXTURE" }],
        ["refresh_live_prices", {}],
        ["create_profile", { name: "Must not create" }],
        ["set_backup_copy_dir", { dir: null }],
        ["list_backups", {}],
      ]) {
        try {
          await invoke(command, { ...old, ...args });
          refused.push("allowed");
        } catch (e) {
          refused.push(e.code ?? String(e));
        }
      }
      done({ refused, mirror: await invoke("get_backup_copy_dir"), profiles: (await invoke("list_profiles")).map((x) => x.name) });
    })().catch((e) => done({ fatal: String(e) }));
  }, forbidden, mirror);
  assert.equal(retired.fatal, undefined);
  assert.equal(retired.refused.length, 8);
  assert.ok(
    retired.refused.every((x) => x === "stale_profile" || x.startsWith("STALE_PROFILE")),
    JSON.stringify(retired.refused),
  );
  assert.equal(retired.profiles.includes("Must not create"), false);
  assert.equal(retired.mirror, mirror, "an old profile cannot clear the new profile's backup mirror");
  assert.equal(fs.existsSync(forbidden), false);
  console.log("FEATURE 292 DASHBOARD CONTRACT LIFECYCLE PASSED");
} finally {
  if (renamed) alter("ALTER TABLE transactions_f292_hold RENAME TO transactions");
  await app.close();
}
