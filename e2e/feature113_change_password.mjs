// Change-password coverage through the compiled app, including pre-commit process-kill recovery.
// Run with: node e2e/run-all.mjs --spec=113

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dismissFirstLaunchDialogs, launchApp } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { enableProtectionThroughUI, killAtFailpoint, seedPopulatedProfile } from "./lib/protection.mjs";

const OLD_PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "brand new password!!";

async function invoke(browser, command, args = {}) {
  return browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (error) => done({ error: String(error) }));
  }, command, args);
}

async function prepareChange(browser, currentPassword, newPassword) {
  await (await browser.$("button=Change password…")).click();
  await (await browser.$("#change-password-current")).setValue(currentPassword);
  await (await browser.$("button=Continue")).click();
  await (await browser.$("#change-password-new")).setValue(newPassword);
  await (await browser.$("#change-password-confirm")).setValue(newPassword);
  await (await browser.$("button=Continue")).click();
  const recoveryEl = await browser.$(".change-password-dialog .protection-setup-key");
  await recoveryEl.waitForExist({ timeout: 10000 });
  const recovery = (await recoveryEl.getText()).trim();
  await (await browser.$("button=I've saved it")).click();
  const label0 = await browser.$("label[for='change-password-answer-0']");
  const label1 = await browser.$("label[for='change-password-answer-1']");
  const group0 = Number((await label0.getText()).match(/\d+/)[0]) - 1;
  const group1 = Number((await label1.getText()).match(/\d+/)[0]) - 1;
  const groups = recovery.split("-");
  await (await browser.$("#change-password-answer-0")).setValue(groups[group0]);
  await (await browser.$("#change-password-answer-1")).setValue(groups[group1]);
  return recovery;
}

async function createProtectedFixture() {
  const testDbDir = freshTestDbDir();
  await seedPopulatedProfile(testDbDir);
  const app = await launchApp({ dbDir: testDbDir });
  await (await app.browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(app.browser, OLD_PASSWORD);
  await app.browser.$("button=Change password…").waitForExist({ timeout: 15000 });
  return { testDbDir, app };
}

// Happy path: old password stops working, new password works, and the confirmed recovery key is
// exactly the one the backend reports as committed.
{
  const { app } = await createProtectedFixture();
  try {
    const recovery = await prepareChange(app.browser, OLD_PASSWORD, NEW_PASSWORD);
    await (await app.browser.$("button=Finish")).click();
    await app.browser.$(".change-password-dialog").waitForExist({ reverse: true, timeout: 15000 });

    const newGeneration = (await invoke(app.browser, "get_current_generation")).ok;
    const oldCheck = await invoke(app.browser, "verify_current_password", { password: OLD_PASSWORD, expectedGeneration: newGeneration });
    assert.match(oldCheck.error, /didn't work/);
    const newCheck = await invoke(app.browser, "verify_current_password", { password: NEW_PASSWORD, expectedGeneration: newGeneration });
    assert.equal(newCheck.error, undefined);
    assert.match(recovery, /^(?:[A-Z0-9]{4}-){6}[A-Z0-9]{4}$/);
  } finally {
    await app.close();
  }
}

// Kill after every new file and backup is staged but before the registry commits. Startup must
// discard the staged rotation and leave the original password usable.
{
  const { testDbDir, app: setupApp } = await createProtectedFixture();
  await setupApp.close();

  process.env.VAULTSPEND_FAILPOINT = "rotation_after_staging";
  let app;
  try {
    app = await launchApp({ dbDir: testDbDir, ready: "[data-profile-selector]" });
  } finally {
    delete process.env.VAULTSPEND_FAILPOINT;
  }
  const { browser } = app;
  await (await browser.$("[data-profile-option]")).click();
  await (await browser.$("#password-form-field")).setValue(OLD_PASSWORD);
  await (await browser.$("button=Unlock")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await dismissFirstLaunchDialogs(browser);
  await (await browser.$("button*=Settings")).click();
  await prepareChange(browser, OLD_PASSWORD, NEW_PASSWORD);
  const pid = (await invoke(browser, "debug_process_id")).ok;
  await killAtFailpoint(testDbDir, "rotation_after_staging", pid, () =>
    browser.execute(() => [...document.querySelectorAll("button")].find((button) => button.textContent === "Finish").click()),
  );
  await app.close();

  assert.ok(fs.existsSync(path.join(testDbDir, "protection-rotation-journal.json")));
  const relaunched = await launchApp({ dbDir: testDbDir, ready: "[data-profile-selector]" });
  try {
    assert.ok(!fs.existsSync(path.join(testDbDir, "protection-rotation-journal.json")), "startup should retire the pre-commit journal");
    await (await relaunched.browser.$("[data-profile-option]")).click();
    await (await relaunched.browser.$("#password-form-field")).setValue(OLD_PASSWORD);
    await (await relaunched.browser.$("button=Unlock")).click();
    await relaunched.browser.$(".brand-word").waitForExist({ timeout: 10000, timeoutMsg: "the original password should still unlock after recovery" });
  } finally {
    await relaunched.close();
  }
}

console.log("FEATURE 113 E2E TEST PASSED");
