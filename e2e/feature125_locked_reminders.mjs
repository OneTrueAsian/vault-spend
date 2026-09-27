// Phase E Task 6: the real worker with OS delivery captured by a debug-only command.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";
const app = await launchApp();
try {
  const { browser } = app;
  async function invoke(command, args = {}) {
    const result = await browser.executeAsync((command, args, done) => {
      window.__TAURI_INTERNALS__.invoke(command, args).then(value => done({ value }), error => done({ error: String(error) }));
    }, command, args);
    assert.equal(result.error, undefined, `${command}: ${result.error}`);
    return result.value;
  }
  // Far enough ahead that the normal background thread cannot consume these occurrences.
  const date = new Date();
  date.setDate(date.getDate() + 10);
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  date.setDate(date.getDate() + 2);
  const due = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  date.setDate(date.getDate() + 2);
  const laterDue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  date.setDate(date.getDate() - 3);
  const tomorrow = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const check = () => invoke("debug_check_reminders", { today });
  const cache = () => JSON.parse(fs.readFileSync(path.join(app.testDbDir, "device-settings.json"), "utf8")).reminder_index;
  const bill = merchant => invoke("create_recurring", { merchant, category: "Secret category", amount: "-123.45", cadence: "monthly", anchorDate: due, accountId: null });
  const profiles = await invoke("list_profiles");
  const alex = profiles.find(p => p.is_active).id;
  await invoke("rename_profile", { id: alex, newName: "Alex" });
  const removed = await bill("DELETE-ME-125");
  assert.equal(cache()[alex].entries.length, 1, "create must immediately refresh the cache");
  await invoke("delete_recurring", { id: removed });
  assert.equal(cache()[alex].entries.length, 0, "delete must immediately remove the occurrence");
  const paused = await bill("CANCEL-ME-125");
  await invoke("set_recurring_status", { id: paused, status: "canceled" });
  assert.equal(cache()[alex].entries.length, 0);
  await bill("ALEX-SECRET-125");
  await invoke("create_profile", { name: "Sam" });
  const sam = (await invoke("list_profiles")).find(p => p.name === "Sam").id;
  await invoke("select_profile", { id: sam });
  await browser.refresh();
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await bill("SAM-SECRET-125");
  await invoke("create_recurring", { merchant: "NO-PROFILE-125", category: null, amount: "-123.45", cadence: "monthly", anchorDate: laterDue, accountId: null });
  await (await browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(browser, PASSWORD);
  assert.deepEqual(await check(), [], "tray off must suppress delivery without marking reminders sent");
  await invoke("set_tray_enabled", { enabled: true });
  const lock = async () => {
    await invoke("lock_current_profile", { expectedGeneration: await invoke("get_current_generation") });
    await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  };
  await lock();
  await invoke("rename_profile", { id: alex, newName: "Alex renamed" });
  assert.equal(cache()[alex].profile_name, "Alex renamed");
  assert.deepEqual((await check()).sort(), ["A bill is due soon in Alex renamed", "A bill is due soon in Sam"]);
  assert.deepEqual(await check(), [], "locked repeat must be suppressed");
  await invoke("show_profile_selector");
  assert.equal((await invoke("get_startup_state")).status, "selector");
  assert.deepEqual(await check(), [], "no-profile repeat must be suppressed");
  assert.deepEqual(await invoke("debug_check_reminders", { today: tomorrow }), ["A bill is due soon in Sam"], "a future cached due date becomes eligible without a database");
  assert.deepEqual(await invoke("debug_check_reminders", { today: tomorrow }), []);
  await invoke("select_profile", { id: alex });
  assert.deepEqual(await check(), [], "opening must preserve locked sent markers");
  await bill("OPEN-ALEX-125");
  assert.match((await check())[0], /^OPEN-ALEX-125 — \$123\.45 due /);
  await invoke("select_profile", { id: sam });
  await invoke("unlock_profile", { id: sam, password: PASSWORD });
  assert.deepEqual(await check(), [], "unlock must not repeat the locked reminder");
  await bill("PROTECTED-GENERIC-125");
  assert.deepEqual(await check(), ["A bill is due soon."]);
  await invoke("set_profile_ui_state", { key: "show_bill_names_in_reminders", value: "true", expectedGeneration: await invoke("get_current_generation") });
  await bill("PROTECTED-NAMED-125");
  assert.match((await check())[0], /^PROTECTED-NAMED-125 — \$123\.45 due /);
  await bill("LOCKED-OPTIN-125");
  await lock();
  assert.deepEqual(await check(), ["A bill is due soon in Sam"], "opt-in never reveals locked bill details");
  await invoke("delete_profile", { id: alex });
  assert.equal(cache()[alex], undefined, "deletion removes only that profile's slice");
  assert.ok(cache()[sam]);
  const text = fs.readFileSync(path.join(app.testDbDir, "device-settings.json"), "utf8");
  for (const secret of ["SECRET-125", "GENERIC-125", "NAMED-125", "OPTIN-125", "123.45", "Secret category", "recurring_id", "transaction_id", "merchant", "amount", "category", "account", "notes"]) {
    assert.ok(!text.includes(secret), `cache leaked ${secret}`);
  }
  for (const entry of cache()[sam].entries) {
    assert.deepEqual(Object.keys(entry).sort(), ["due_date", "last_notified", "opaque_id"]);
    assert.match(entry.opaque_id, /^[0-9a-f]{32}$/);
  }
} finally {
  await app.close();
}
console.log("FEATURE 125 E2E TEST PASSED");
