// Real compiled aggregate reads, disposable-database failures and profile retirement.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { isoDaysFromNow } from "./lib/dates.mjs";

const today = isoDaysFromNow(0);
const [year, month] = today.split("-").map(Number);
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts(name, account_type, starting_balance) VALUES ('Aggregate fixture', 'checking', '100')")
account_id = cur.lastrowid
cur.execute("INSERT INTO family_members(name) VALUES ('Aggregate member')")
cur.execute("INSERT INTO transactions(account_id, date, description, amount, category, fingerprint) VALUES (?, '${today}', 'Aggregate expense', '-12.34', 'Groceries', 'f291')", (account_id,))
cur.execute("INSERT INTO budgets(period, category, monthly_amount, budget_group) VALUES (?, 'Groceries', '50', 'flexible')", ('${today.slice(0, 7)}',))
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const alterFixture = sql => execFileSync("python", ["-c", "import sqlite3,sys\ncon=sqlite3.connect(sys.argv[1])\ncon.execute(sys.argv[2])\ncon.commit()\ncon.close()", path.join(dbDir, "vaultspend.db"), sql]);
const nav = async label => b.execute(name => [...document.querySelectorAll(".nav-item")].find(el => el.textContent.trim() === name).click(), label);
let renamed = false;
try {
  const actual = await b.executeAsync((year, month, done) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    (async () => {
      const context = await invoke("get_transaction_context");
      const origin = { expectedGeneration: context.generation, expectedSessionRevision: context.sessionRevision };
      const budget = await invoke("get_budget_snapshot", { ...origin, year, month });
      const report = await invoke("get_report_range_snapshot", { ...origin, fromYear: year, fromMonth: month, toYear: year, toMonth: month });
      let stale, invalid;
      try { await invoke("get_budget_snapshot", { ...origin, year, month, expectedSessionRevision: context.sessionRevision + 1 }); } catch (error) { stale = error.code; }
      try { await invoke("get_report_range_snapshot", { ...origin, fromYear: year, fromMonth: 0, toYear: year, toMonth: month }); } catch (error) { invalid = error.code; }
      done({ budget, report, stale, invalid });
    })().catch(error => done({ fatal: String(error) }));
  }, year, month);
  assert.equal(actual.fatal, undefined);
  assert.equal(actual.budget.contractVersion, 1);
  assert.equal(actual.budget.actuals.find(row => row.category === "Groceries").actual, "12.34");
  assert.equal(actual.report.cells[0].amount, "12.34");
  assert.equal(actual.budget.flow.total_expense, actual.report.flow.total_expense);
  assert.equal(actual.stale, "stale_profile");
  assert.equal(actual.invalid, "invalid_argument");

  const ask = await b.executeAsync((today, done) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    (async () => {
      const context = await invoke("get_transaction_context");
      const origin = { expectedGeneration: context.generation, expectedSessionRevision: context.sessionRevision };
      const request = { kind: "rank-purchases", periods: [{ from: today, to: today }], categories: ["Groceries"], limit: 1 };
      const answer = await invoke("get_ask_vault_snapshot", { ...origin, request });
      // A store filter on the same purchase: the first word of its recorded description, and a name nothing matches.
      const description = answer.periods[0].purchases[0].description;
      const vendor = description.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ")[0].slice(0, 12);
      const byStore = await invoke("get_ask_vault_snapshot", { ...origin, request: { ...request, kind: "total", vendors: [vendor], limit: 5 } });
      const noStore = await invoke("get_ask_vault_snapshot", { ...origin, request: { ...request, kind: "total", vendors: ["zzyzxq"], limit: 5 } });
      let oneLetter; try { await invoke("get_ask_vault_snapshot", { ...origin, request: { ...request, kind: "total", vendors: ["a"], limit: 5 } }); } catch (error) { oneLetter = error.code; }
      // Several stores with a per-store breakdown, and things left out.
      const noCategory = { ...request, kind: "total", categories: [], limit: 5 };
      const several = await invoke("get_ask_vault_snapshot", { ...origin, request: { ...noCategory, vendors: [vendor, "zzyzxq"] } });
      const leftStore = await invoke("get_ask_vault_snapshot", { ...origin, request: { ...noCategory, excludeVendors: [vendor] } });
      const leftCategory = await invoke("get_ask_vault_snapshot", { ...origin, request: { ...noCategory, excludeCategories: ["Groceries"] } });
      let conflict; try { await invoke("get_ask_vault_snapshot", { ...origin, request: { ...noCategory, vendors: [vendor], excludeVendors: [vendor] } }); } catch (error) { conflict = error.code; }
      const errors = [];
      for (const args of [
        { ...origin, request: { ...request, limit: 51 } },
        { ...origin, expectedGeneration: context.generation + 1, request },
      ]) {
        try { await invoke("get_ask_vault_snapshot", args); errors.push("allowed"); } catch (error) { errors.push(error.code); }
      }
      await invoke("create_category", { name: "Ask revision fixture", iconKey: null });
      try { await invoke("get_ask_vault_snapshot", { ...origin, request: { ...request, expectedRevision: answer.revision } }); errors.push("allowed"); }
      catch (error) { errors.push(error.code); }
      done({ answer, errors, description, byStore, noStore, oneLetter, several, leftStore, leftCategory, conflict });
    })().catch(error => done({ fatal: JSON.stringify(error) }));
  }, today);
  assert.equal(ask.fatal, undefined);
  assert.equal(ask.answer.contractVersion, 1);
  assert.equal(ask.answer.periods[0].total, "12.34");
  assert.equal(ask.answer.periods[0].purchaseCount, 1);
  assert.equal(ask.answer.periods[0].purchases[0].amount, "12.34");
  assert.equal(ask.answer.periods[0].historyCoverage, "unknown");
  assert.deepEqual(ask.errors, ["invalid_argument", "stale_profile", "stale_data"]);
  assert.equal(ask.byStore.periods[0].total, "12.34");
  assert.equal(ask.byStore.periods[0].vendors[0].description, ask.description);
  assert.equal(ask.byStore.periods[0].vendorNameCount, 1);
  assert.equal(ask.noStore.periods[0].total, "0");
  assert.deepEqual(ask.noStore.periods[0].vendors, []);
  assert.equal(ask.oneLetter, "invalid_argument");
  assert.deepEqual(ask.several.periods[0].vendorTotals.map((l) => [l.total, l.purchaseCount]), [["12.34", 1], ["0", 0]]);
  assert.equal(ask.leftStore.periods[0].total, "0");
  assert.equal(ask.leftStore.periods[0].leftOut.total, "12.34");
  assert.equal(ask.leftStore.periods[0].leftOut.vendors[0].description, ask.description);
  assert.equal(ask.leftCategory.periods[0].leftOut.categories[0].category, "Groceries");
  assert.equal(ask.leftCategory.periods[0].leftOut.categories[0].amount, "12.34");
  assert.equal(ask.conflict, "invalid_argument");

  await nav("Budget");
  await b.$("[data-budget-summary]").waitForExist({ timeout: 10000 });
  assert.match(await b.$("[data-budget-summary]").getText(), /12\.34/);
  // Break a real query in this disposable DB, without adding a production fault API.
  alterFixture("ALTER TABLE transactions RENAME TO transactions_f291_hold"); renamed = true;
  await nav("Dashboard"); await nav("Budget");
  await b.waitUntil(() => b.execute(() => document.querySelector('[data-financial-read="Budget totals"]')?.getAttribute("role") === "alert"), { timeout: 10000 });
  assert.match(await b.$('[data-financial-read="Budget totals"]').getText(), /last loaded/);
  assert.match(await b.$("[data-budget-summary]").getText(), /12\.34/);
  for (const palette of ["transparent", "futuristic", "retro"]) for (const theme of ["light", "dark"]) {
    const geometry = await b.execute((p, t) => {
      document.documentElement.dataset.palette = p; document.documentElement.dataset.theme = t;
      const status = document.querySelector('[data-financial-read="Budget totals"]');
      const r = status.getBoundingClientRect(), button = status.querySelector("button").getBoundingClientRect();
      return { contained: r.left >= 0 && r.right <= innerWidth, aligned: button.left >= r.left && button.right <= r.right && button.top >= r.top && button.bottom <= r.bottom };
    }, palette, theme);
    assert.equal(geometry.contained, true); assert.equal(geometry.aligned, true);
  }
  await b.$('[aria-label="Previous month"]').click();
  await b.waitUntil(() => b.execute(() => document.querySelector('[data-financial-read="Budget totals"]')?.getAttribute("role") === "alert"), { timeout: 10000 });
  assert.equal(await b.$("[data-budget-summary]").isExisting(), false, "another month's failure must not display current-month figures");
  assert.equal(await b.$('[aria-label="Next month"]').isEnabled(), true);
  await nav("Household");
  await b.waitUntil(() => b.execute(() => document.querySelector('[data-financial-read="Household budget totals"]')?.getAttribute("role") === "alert"), { timeout: 10000 });
  assert.equal(await b.execute(() => document.querySelector(".reports-view")?.textContent.includes("No budgeted spending yet")), false);
  assert.equal(await b.execute(() => document.querySelector(".reports-view")?.textContent.includes("Budget, by category and person")), false);
  alterFixture("ALTER TABLE transactions_f291_hold RENAME TO transactions"); renamed = false;
  await b.$('[aria-label="Next month"]').click();
  await b.waitUntil(() => b.execute(() => document.querySelector(".reports-view")?.textContent.includes("Budget, by category and person")), { timeout: 10000 });
  await nav("Budget");
  await b.$("[data-budget-summary]").waitForExist({ timeout: 10000 });

  await nav("Reports");
  await b.$("[data-report-summary]").waitForExist({ timeout: 10000 });
  await b.$('[data-range-preset="last_month"]').click();
  await b.waitUntil(() => b.execute(() => !!document.querySelector("[data-report-summary]") && !document.querySelector('[data-financial-read="Report totals"]')), { timeout: 10000 });
  alterFixture("ALTER TABLE transactions RENAME TO transactions_f291_hold"); renamed = true;
  await b.$('[data-range-preset="current_month"]').click();
  await b.waitUntil(() => b.execute(() => document.querySelector('[data-financial-read="Report totals"]')?.getAttribute("role") === "alert"), { timeout: 10000 });
  assert.equal(await b.$("[data-report-summary]").isExisting(), false, "failed range reads must not imply zero spending");
  assert.equal(await b.$('[data-range-preset="last_month"]').isEnabled(), true);
  alterFixture("ALTER TABLE transactions_f291_hold RENAME TO transactions"); renamed = false;
  await b.$('[data-financial-read="Report totals"] button').click();
  await b.$("[data-report-summary]").waitForExist({ timeout: 10000 });
  assert.match(await b.$("[data-report-summary]").getText(), /12\.34/);

  const switched = await b.executeAsync((year, month, done) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    (async () => {
      const retired = await invoke("get_transaction_context");
      await invoke("create_profile", { name: "Aggregate second fixture" });
      const fresh = await invoke("get_transaction_context");
      const errors = [];
      for (const [command, args] of [["get_budget_snapshot", { year, month }], ["get_report_range_snapshot", { fromYear: year, fromMonth: month, toYear: year, toMonth: month }], ["get_ask_vault_snapshot", { request: { kind: "total", periods: [{ from: `${year}-${String(month).padStart(2, "0")}-01`, to: `${year}-${String(month).padStart(2, "0")}-01` }], limit: 5 } }]]) {
        try { await invoke(command, { ...args, expectedGeneration: retired.generation, expectedSessionRevision: retired.sessionRevision }); errors.push("allowed"); } catch (error) { errors.push(error.code); }
      }
      const report = await invoke("get_report_range_snapshot", { fromYear: year, fromMonth: month, toYear: year, toMonth: month, expectedGeneration: fresh.generation, expectedSessionRevision: fresh.sessionRevision });
      done({ errors, empty: report.cells.length === 0, advanced: fresh.sessionRevision > retired.sessionRevision });
    })().catch(error => done({ fatal: String(error) }));
  }, year, month);
  assert.equal(switched.fatal, undefined); assert.deepEqual(switched.errors, ["stale_profile", "stale_profile", "stale_profile"]);
  assert.equal(switched.empty, true); assert.equal(switched.advanced, true);
  console.log("FEATURE 291 FINANCIAL SNAPSHOT LIFECYCLE PASSED");
} finally {
  if (renamed) alterFixture("ALTER TABLE transactions_f291_hold RENAME TO transactions");
  await app.close();
}
