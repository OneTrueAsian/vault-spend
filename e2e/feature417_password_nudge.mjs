// The password hint, the 12-character rule and the post-unlock password nudge, through the compiled app.
// A profile with a password shorter than 12 characters cannot be made through the UI any more, so the
// debug-only debug_enable_protection_short_password command (disposable data only, refuses a compliant
// password) stands in for a profile protected before the rule. Screenshots go through saveScreenshot, so
// `npm run e2e -- --spec=417 --keep-screens` keeps them.
// Run with: npm run e2e -- --spec=417

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dismissFirstLaunchDialogs, dismissStatusMessages, launchApp, openSettingsGroup } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { PROTECTION_FINISH_MS, seedPopulatedProfile } from "./lib/protection.mjs";

const SHORT_PASSWORD = "elevenchars"; // 11 characters
const NEW_PASSWORD = "maple lantern river 42";
const HINT = "Use at least 12 characters. A few unrelated words works well.";
const NUDGE = "Your password is shorter than we now recommend. A longer one is much harder to guess.";
const NUDGE_MARKER = "shorter than we now recommend";
const SHOTS = process.env.VAULTSPEND_E2E_SHOTS ?? path.join(os.tmpdir(), "vaultspend-e2e-security-shots");

async function invoke(browser, command, args = {}) {
  return browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (error) => done({ error: String(error) }));
  }, command, args);
}

// getText() reads "" while a dialog is still fading in, so wait until the element shows text.
async function shownText(browser, selector) {
  const element = await browser.$(selector);
  await element.waitForDisplayed({ timeout: 5000 });
  await browser.waitUntil(async () => (await element.getText()).trim() !== "", { timeout: 5000, timeoutMsg: `${selector} should show text` });
  return (await element.getText()).trim();
}

// The nudge lives in the toast stack, so look there; Settings has its own "Change password" button.
async function nudgeState(browser) {
  return browser.execute((marker) => {
    const note = [...document.querySelectorAll(".toast-stack .status")].find((el) => el.textContent.includes(marker));
    if (!note) return null;
    return {
      text: note.querySelector(".status-text")?.textContent.trim(),
      buttons: [...note.querySelectorAll("button")].map((button) => button.textContent.trim()),
    };
  }, NUDGE_MARKER);
}

async function clickNudgeButton(browser, label) {
  await browser.execute((marker, label) => {
    const note = [...document.querySelectorAll(".toast-stack .status")].find((el) => el.textContent.includes(marker));
    [...note.querySelectorAll("button")].find((button) => button.textContent.trim() === label).click();
  }, NUDGE_MARKER, label);
}

async function waitForNudge(browser) {
  await browser.waitUntil(async () => (await nudgeState(browser)) !== null, { timeout: 10000, timeoutMsg: "the password nudge should show after unlocking with a short password" });
}

async function unlockFromSelector(browser, password) {
  await (await browser.$("[data-profile-option]")).click();
  await (await browser.$("#password-form-field")).setValue(password);
  await (await browser.$("button=Unlock")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 15000, timeoutMsg: "the password should unlock the profile" });
  await dismissFirstLaunchDialogs(browser);
}

async function lockAndUnlock(browser, password) {
  await (await browser.$(".profile-switcher-toggle")).click();
  await (await browser.$("[data-profile-switcher-lock]")).click();
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  await (await browser.$("#password-form-field")).setValue(password);
  await (await browser.$("button[type='submit']")).click();
  await browser.$("[data-profile-lock-screen]").waitForExist({ reverse: true, timeout: 15000 });
  await browser.$(".brand-word").waitForExist({ timeout: 15000 });
}

const testDbDir = freshTestDbDir();
await seedPopulatedProfile(testDbDir);
fs.mkdirSync(SHOTS, { recursive: true });

// 1. The setup dialog shows the hint and refuses an 11-character password; then make the short-password profile.
{
  const app = await launchApp({ dbDir: testDbDir });
  try {
    const { browser } = app;
    await openSettingsGroup(browser, "profiles");
    await dismissStatusMessages(browser); // the profile's opening message can cover the button
    await (await browser.$("button=Turn on password protection")).click();
    await (await browser.$("#protection-setup-password")).waitForExist({ timeout: 5000 });
    assert.equal(await shownText(browser, "#protection-setup-password-hint"), HINT);
    await (await browser.$("#protection-setup-password")).setValue(SHORT_PASSWORD);
    await (await browser.$("#protection-setup-confirm")).setValue(SHORT_PASSWORD);
    assert.equal(await (await browser.$("button=Continue")).isEnabled(), false, "11 characters must keep Continue disabled");
    await browser.saveScreenshot(path.join(SHOTS, "protection-setup-password-hint.png"));
    await (await browser.$("button=Cancel")).click();
    await browser.$("#protection-setup-password").waitForExist({ reverse: true, timeout: 5000 });

    // Conversion derives keys and re-encrypts the profile and its backups: allow a slow runner.
    await browser.setTimeout({ script: PROTECTION_FINISH_MS * 2 });
    const seeded = await invoke(browser, "debug_enable_protection_short_password", { password: SHORT_PASSWORD });
    assert.equal(seeded.error, undefined, `seeding the short-password profile failed: ${seeded.error}`);
  } finally {
    await app.close();
  }
}

// 2. Unlock with the short password: the nudge shows, "Not now" hides it, and it is back after the next unlock.
const app = await launchApp({ dbDir: testDbDir, ready: "[data-profile-selector]" });
try {
  const { browser } = app;
  await unlockFromSelector(browser, SHORT_PASSWORD);
  await waitForNudge(browser);
  const nudge = await nudgeState(browser);
  assert.equal(nudge.text, NUDGE);
  assert.deepEqual(nudge.buttons, ["Change password", "Not now"]);
  await browser.saveScreenshot(path.join(SHOTS, "password-nudge.png"));

  await clickNudgeButton(browser, "Not now");
  await browser.waitUntil(async () => (await nudgeState(browser)) === null, { timeout: 5000, timeoutMsg: "Not now should hide the nudge" });

  await lockAndUnlock(browser, SHORT_PASSWORD);
  await waitForNudge(browser);

  // 3. "Change password" opens Settings > Profiles & security.
  await clickNudgeButton(browser, "Change password");
  await browser.$('[data-settings-panel="profiles"]').waitForDisplayed({ timeout: 10000, timeoutMsg: "the nudge should open Profiles & security" });
  await (await browser.$('[data-settings-panel="profiles"]').$("button=Change password")).click();
  await (await browser.$("#change-password-current")).setValue(SHORT_PASSWORD);
  await (await browser.$("button=Continue")).click();
  await (await browser.$("#change-password-new")).waitForExist({ timeout: 10000 });
  assert.equal(await shownText(browser, ".change-password-dialog .protection-setup-hint"), HINT);
  await (await browser.$("#change-password-new")).setValue(SHORT_PASSWORD);
  await (await browser.$("#change-password-confirm")).setValue(SHORT_PASSWORD);
  assert.equal(await (await browser.$("button=Continue")).isEnabled(), false, "11 characters must keep Continue disabled");
  await (await browser.$("#change-password-new")).setValue(NEW_PASSWORD);
  await (await browser.$("#change-password-confirm")).setValue(NEW_PASSWORD);
  await (await browser.$("button=Continue")).click();
  const recoveryEl = await browser.$(".change-password-dialog .protection-setup-key");
  await recoveryEl.waitForExist({ timeout: PROTECTION_FINISH_MS });
  const recovery = await shownText(browser, ".change-password-dialog .protection-setup-key");
  await (await browser.$("button=I've saved it")).click();
  const groups = recovery.split("-");
  for (const index of [0, 1]) {
    const labelText = await shownText(browser, `label[for='change-password-answer-${index}']`);
    await (await browser.$(`#change-password-answer-${index}`)).setValue(groups[Number(labelText.match(/\d+/)[0]) - 1]);
  }
  await (await browser.$("button=Finish")).click();
  await browser.$(".change-password-dialog").waitForExist({ reverse: true, timeout: PROTECTION_FINISH_MS });

  // 4. The nudge is gone after the change, and does not come back after unlocking with the new password.
  const generation = (await invoke(browser, "get_current_generation")).ok;
  await browser.waitUntil(async () => (await invoke(browser, "password_nudge", { expectedGeneration: generation })).ok === false, { timeout: 5000 });
  await browser.waitUntil(async () => (await nudgeState(browser)) === null, { timeout: 5000, timeoutMsg: "the nudge should be gone after the password is changed" });

  await lockAndUnlock(browser, NEW_PASSWORD);
  const afterGeneration = (await invoke(browser, "get_current_generation")).ok;
  assert.equal((await invoke(browser, "password_nudge", { expectedGeneration: afterGeneration })).ok, false, "a 12+ character password must not raise the nudge");
  await browser.pause(1000); // the nudge asks the backend once the app is up; give a wrong answer time to appear
  assert.equal(await nudgeState(browser), null, "no nudge after unlocking with the new password");
} finally {
  await app.close();
}

console.log("FEATURE 417 E2E TEST PASSED");
