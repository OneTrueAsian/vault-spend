// Compiled snapshot contract, origin refusal and refresh failure/retry. Disposable fixture only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { isoDaysFromNow } from "./lib/dates.mjs";
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts(name, account_type, starting_balance) VALUES ('Fixture Checking', 'checking', '100')")
account_id = cur.lastrowid
cur.execute("INSERT INTO transactions(account_id, date, description, amount, category, fingerprint) VALUES (?, '${isoDaysFromNow(0)}', 'Lifecycle fixture', '-12.34', 'Groceries', 'f283')", (account_id,))
`);
const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  const result = await browser.executeAsync(done => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    (async () => {
      const context = await invoke("get_transaction_context");
      const args = { expectedGeneration: context.generation, expectedSessionRevision: context.sessionRevision, ids: null };
      const full = await invoke("get_transaction_snapshot", args);
      const refuse = async (command, args) => { try { await invoke(command, args); return { allowed: true }; } catch(error) { return { allowed: false, error }; } };
      done({ version: full.contractVersion, total: full.stats.total, amount: full.transactions[0].amount, balance: full.accounts[0].current_balance, nullable: full.transactions[0].notes,
        stale: await refuse("get_transaction_snapshot", { ...args, expectedSessionRevision: context.sessionRevision + 1 }),
        write: await refuse("update_transaction_description", { id: full.transactions[0].id, description: "Must not write", expectedSessionRevision: context.sessionRevision + 1 }),
        invalid: await refuse("get_transaction_snapshot", { ...args, ids: [] }),
        after: (await invoke("get_transaction_snapshot", args)).transactions[0].description });
    })().catch(error => done({ fatal: String(error) }));
  });
  assert.equal(result.fatal, undefined); assert.equal(result.version, 1); assert.equal(result.total, 1);
  assert.equal(result.amount, "-12.34"); assert.equal(result.balance, "87.66"); assert.equal(result.nullable, null);
  assert.equal(result.stale.error.code, "stale_profile"); assert.equal(result.invalid.error.code, "invalid_argument");
  assert.equal(result.write.allowed, false); assert.equal(result.after, "Lifecycle fixture", "stale mutation changed nothing");
  await browser.execute(() => [...document.querySelectorAll(".nav-item")].find(b => b.textContent.trim() === "Transactions").click());
  await browser.waitUntil(() => browser.execute(() => !!document.querySelector("table.ledger tbody tr")), { timeout: 15000 });
  const alterFixture = sql => execFileSync("python", ["-c", "import sqlite3,sys\ncon=sqlite3.connect(sys.argv[1])\ncon.execute(sys.argv[2])\ncon.commit()\ncon.close()", path.join(dbDir, "vaultspend.db"), sql], { stdio: "inherit" });
  // Rename and restore one table in this managed disposable fixture; no production fault command.
  alterFixture("ALTER TABLE transaction_tags RENAME TO transaction_tags_f283_hold");
  await browser.executeAsync(done => {
    const started = performance.now();
    const open = () => {
      const input = document.querySelector("table.ledger .row-edit-input");
      if (!input) {
        document.querySelector("table.ledger span.amount-editable[title='Click to fix the description']")?.click();
        if (performance.now() - started > 10000) return done(false);
        return requestAnimationFrame(open);
      }
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Lifecycle fixture updated");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      requestAnimationFrame(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); done(true); });
    }; open();
  });
  await browser.waitUntil(() => browser.execute(() => !!document.querySelector("[data-transaction-read-error]")), { timeout: 10000 });
  assert.match(await browser.$("[data-transaction-read-error]").getText(), /last loaded data/);
  assert.match(await browser.$("table.ledger").getText(), /Lifecycle fixture/);
  alterFixture("ALTER TABLE transaction_tags_f283_hold RENAME TO transaction_tags");
  await browser.$("[data-transaction-read-error] button").click();
  await browser.waitUntil(() => browser.execute(() => !document.querySelector("[data-transaction-read-error]") && document.querySelector("table.ledger")?.textContent.includes("Lifecycle fixture updated")), { timeout: 10000 });
  const switched = await browser.executeAsync((today, done) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    (async () => {
      const original = (await invoke("list_profiles")).find(p => p.is_active);
      await invoke("create_profile", { name: "Lifecycle second fixture" });
      const prior = (await invoke("list_profiles")).find(p => !p.is_active && p.name === original.name);
      const accountId = await invoke("create_account", { name: "Second fixture", accountType: "checking" });
      const id = await invoke("create_manual_transaction", { accountId, date: today, description: "Second profile row", amount: "-1.01", category: "Groceries", memberId: null, notes: null });
      const retired = await invoke("get_transaction_context");
      await invoke("switch_profile", { id: prior.id });
      const current = await invoke("get_transaction_context");
      let refused = false;
      try { await invoke("update_transaction_description", { id, description: "Wrong profile overwrite", expectedSessionRevision: retired.sessionRevision }); } catch { refused = true; }
      const snapshot = await invoke("get_transaction_snapshot", { ids: null, expectedGeneration: current.generation, expectedSessionRevision: current.sessionRevision });
      done({ refused, advanced: current.sessionRevision > retired.sessionRevision, description: snapshot.transactions[0].description });
    })().catch(error => done({ error: String(error) }));
  }, isoDaysFromNow(0));
  assert.equal(switched.error, undefined); assert.equal(switched.advanced, true);
  assert.equal(switched.refused, true, "the real switch path retires legacy financial commands from the previous profile");
  assert.equal(switched.description, "Lifecycle fixture updated", "colliding transaction IDs do not permit a cross-profile edit");
  console.log("FEATURE 283 TRANSACTION SNAPSHOT LIFECYCLE PASSED");
} finally { await app.close(); }
