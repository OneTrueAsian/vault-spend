// Phase E Task 1: a protected profile gets the documented automatic-lock defaults, every choice
// can be changed through Settings, and those non-secret choices survive a real app restart in the
// backward-compatible profiles.json metadata.
import assert from "node:assert/strict";
import { dismissFirstLaunchDialogs, launchApp } from "./harness.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";

async function invoke(browser, command, args = {}) {
  return browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then(
      (value) => done({ ok: value }),
      (error) => done({ error: String(error) }),
    );
  }, command, args);
}

const app = await launchApp();
const dbDir = app.testDbDir;
try {
  const { browser } = app;
  await (await browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(browser, PASSWORD);

  const minutes = await browser.$("[data-auto-lock-minutes]");
  await minutes.waitForEnabled({ timeout: 10000 });
  assert.equal(await minutes.getValue(), "15", "protected profiles default to 15 minutes");
  assert.equal(await (await browser.$("[data-lock-when-hidden]")).isSelected(), true, "tray-hide lock defaults on");
  assert.equal(await (await browser.$("[data-lock-on-focus-loss]")).isSelected(), false, "focus-loss lock defaults off");
  assert.equal(await (await browser.$("[data-lock-on-system-event]")).isSelected(), true, "Windows session lock defaults on");

  await minutes.selectByAttribute("value", "30");
  const hidden = await browser.$("[data-lock-when-hidden]");
  await hidden.waitForEnabled({ timeout: 5000 });
  await hidden.click();
  const focus = await browser.$("[data-lock-on-focus-loss]");
  await focus.waitForEnabled({ timeout: 5000 });
  await focus.click();
  const system = await browser.$("[data-lock-on-system-event]");
  await system.waitForEnabled({ timeout: 5000 });
  await system.click();

  await browser.waitUntil(async () => {
    const result = await invoke(browser, "get_auto_lock_settings");
    return result.ok?.inactivity_minutes === 30
      && result.ok?.lock_when_hidden === false
      && result.ok?.lock_on_focus_loss === true
      && result.ok?.lock_on_system_event === false;
  }, { timeout: 10000, timeoutMsg: "automatic-lock settings should persist after all four UI changes" });
} finally {
  await app.close();
}

const relaunched = await launchApp({ dbDir, ready: "[data-profile-selector]" });
try {
  const { browser } = relaunched;
  await (await browser.$("[data-profile-option]")).click();
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  await (await browser.$("#password-form-field")).setValue(PASSWORD);
  await (await browser.$("button[type='submit']")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await dismissFirstLaunchDialogs(browser);
  await (await browser.$("button*=Settings")).click();

  const minutes = await browser.$("[data-auto-lock-minutes]");
  await minutes.waitForEnabled({ timeout: 10000 });
  assert.equal(await minutes.getValue(), "30");
  assert.equal(await (await browser.$("[data-lock-when-hidden]")).isSelected(), false);
  assert.equal(await (await browser.$("[data-lock-on-focus-loss]")).isSelected(), true);
  assert.equal(await (await browser.$("[data-lock-on-system-event]")).isSelected(), false);
} finally {
  await relaunched.close();
}

console.log("FEATURE 121 E2E TEST PASSED");
