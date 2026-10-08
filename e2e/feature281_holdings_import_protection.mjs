// Import previews must disappear on a real protected-profile lock and cannot be reused after unlocking.
import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";
const dbDir = await seedFixture(`cur.execute("INSERT INTO accounts (name,account_type,starting_balance) VALUES ('Private brokerage','investment','0')")`);
const app = await launchApp({ dbDir });
const b = app.browser, password = "temporary import test password";
async function ipc(command, args = {}) {
  const result = await b.executeAsync((command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then(value => done({ value }), error => done({ error: String(error) })), command, args);
  if (result.error) throw new Error(result.error); return result.value;
}
try {
  await b.$("button*=Settings").click(); await enableProtectionThroughUI(b, password);
  await b.waitUntil(async () => (await b.$(".page").getText()).includes("Password protection: On"), { timeout: 10000 });
  await b.$("button*=Investments").click(); await b.$("button*=Import holdings").waitForExist({ timeout: 10000 }); await b.$("button*=Import holdings").click();
  await (await b.$("[role='dialog']")).$("button=Paste rows").click();
  await b.$("[data-holding-import] textarea").setValue("Symbol,Shares,Price,Cost Basis\nSECRET,10,12.50,100\n");
  await (await b.$("[role='dialog']")).$("button=Match columns").click();
  await (await b.$("[role='dialog']")).$("button=Review holdings").waitForEnabled({ timeout: 5000 }); await (await b.$("[role='dialog']")).$("button=Review holdings").click();
  await b.$("[data-holding-import-row]").waitForExist({ timeout: 5000 });
  const generation = await ipc("get_current_generation");
  const source = await ipc("load_holding_import", { path: null, content: "S,Q,P,C\nSECRET,10,12.50,100\n", format: "csv", generation });
  const mapping = { symbol: 0, shares: 1, price: 2, cost_basis: 3, name: null, asset_class: null };
  await ipc("preview_holding_import", { id: source.id, accountId: 1, mapping, generation });
  await ipc("lock_current_profile", { expectedGeneration: generation });
  await b.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  assert.equal(await b.$("[data-holding-import]").isExisting(), false);
  assert.equal((await b.$("body").getText()).includes("SECRET"), false);
  await assert.rejects(ipc("preview_holding_import", { id: source.id, accountId: 1, mapping, generation }), /PROFILE_LOCKED/);
  await assert.rejects(ipc("commit_holding_import", { id: source.id, selectedRows: [2], generation }), /PROFILE_LOCKED/);
  await assert.rejects(ipc("list_holding_import_files", { path: null }), /PROFILE_LOCKED/);
  await b.$("#password-form-field").setValue(password); await b.$("button[type='submit']").click();
  await b.$(".brand-word").waitForExist({ timeout: 10000 });
  const current = await ipc("get_current_generation");
  await assert.rejects(ipc("commit_holding_import", { id: source.id, selectedRows: [2], generation: current }), /expired/);
  assert.equal((await ipc("list_holdings")).length, 0);
  console.log("PASS protected import preview cleared on lock, data and file access refused while locked, old preview refused after unlock");
} finally { await app.close(); }
