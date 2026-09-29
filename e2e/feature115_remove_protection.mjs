// Remove-protection coverage through the compiled app, including pre-commit crash recovery.
// Run with: node e2e/run-all.mjs --spec=115
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dismissFirstLaunchDialogs, launchApp } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { enableProtectionThroughUI, killAtFailpoint, seedPopulatedProfile } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";
async function invoke(browser, command, args = {}) {
  return browser.executeAsync((command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (error) => done({ error: String(error) })), command, args);
}
async function fixture() {
  const testDbDir = freshTestDbDir();
  await seedPopulatedProfile(testDbDir);
  const app = await launchApp({ dbDir: testDbDir });
  await (await app.browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(app.browser, PASSWORD);
  await app.browser.$("button=Remove protection…").waitForExist({ timeout: 15000 });
  return { testDbDir, app };
}
async function prepare(browser) {
  await (await browser.$("button=Remove protection…")).click();
  await (await browser.$("#remove-protection-current")).setValue(PASSWORD);
  await (await browser.$("button=Continue")).click();
  await browser.$("button=Remove protection").waitForExist({ timeout: 10000 });
}
// `list_profiles`'s DTO deliberately has no db_path (the frontend never needs a filesystem path),
// so use the dedicated command for the authoritative path and compare it with Settings' display.
async function currentDataFilePath(browser) {
  return (await invoke(browser, "get_data_file_location")).ok;
}

{
  const { app } = await fixture();
  try {
    const before = await currentDataFilePath(app.browser);
    const backupDir = path.join(path.dirname(before), "backups", "protected");
    const countBefore = fs.readdirSync(backupDir).filter((name) => name.endsWith(".db")).length;
    await prepare(app.browser);
    await (await app.browser.$("button=Remove protection")).click();
    await app.browser.$(".remove-protection-dialog").waitForExist({ reverse: true, timeout: 15000 });
    const after = await currentDataFilePath(app.browser);
    assert.notEqual(after, before, "removal should repoint the active profile at a new plaintext file");
    await app.browser.waitUntil(
      async () => (await app.browser.$("[data-data-file] .path-box").getText()).trim() === after,
      { timeout: 10000, timeoutMsg: "Settings should refresh the displayed data-file path after removing protection" },
    );
    const profile = (await invoke(app.browser, "list_profiles")).ok.find((p) => p.is_active);
    assert.equal(profile.is_password_protected, false);
    assert.equal(fs.readFileSync(after, { encoding: "utf8", flag: "r" }).slice(0, 15), "SQLite format 3");
    assert.equal(fs.readdirSync(backupDir).filter((name) => name.endsWith(".db")).length, countBefore + 1);
    assert.ok((await invoke(app.browser, "list_transactions")).ok.some((row) => row.description === "Market Basket"));
  } finally { await app.close(); }
}

{
  const { testDbDir, app: setup } = await fixture();
  await setup.close();
  process.env.VAULTSPEND_FAILPOINT = "removal_after_export";
  const app = await launchApp({ dbDir: testDbDir, ready: "[data-profile-selector]" });
  delete process.env.VAULTSPEND_FAILPOINT;
  await (await app.browser.$("[data-profile-option]")).click();
  await (await app.browser.$("#password-form-field")).setValue(PASSWORD);
  await (await app.browser.$("button=Unlock")).click();
  await app.browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await dismissFirstLaunchDialogs(app.browser);
  await (await app.browser.$("button*=Settings")).click();
  await prepare(app.browser);
  const pid = (await invoke(app.browser, "debug_process_id")).ok;
  await killAtFailpoint(testDbDir, "removal_after_export", pid, () => app.browser.execute(() => [...document.querySelectorAll("button")].find((button) => button.textContent === "Remove protection").click()));
  await app.close();
  const relaunched = await launchApp({ dbDir: testDbDir, ready: "[data-profile-selector]" });
  try {
    assert.ok(!fs.existsSync(path.join(testDbDir, "protection-removal-journal.json")));
    await (await relaunched.browser.$("[data-profile-option]")).click();
    await (await relaunched.browser.$("#password-form-field")).setValue(PASSWORD);
    await (await relaunched.browser.$("button=Unlock")).click();
    await relaunched.browser.$(".brand-word").waitForExist({ timeout: 10000 });
  } finally { await relaunched.close(); }
}
console.log("FEATURE 115 E2E TEST PASSED");
