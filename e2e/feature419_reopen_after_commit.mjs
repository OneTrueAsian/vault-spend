// A protection change that has gone through, but whose new file can't be opened (VS-43). The debug-only
// reopen_after_commit failpoint makes every post-commit reopen fail. The app must close the old file,
// say the change is saved, and let the person continue with the new password (or, after removing
// protection, from the profile list). Screenshots go through saveScreenshot, so
// `npm run e2e -- --spec=419 --keep-screens` keeps them.
// Run with: npm run e2e -- --spec=419

import assert from "node:assert/strict";
import { dismissFirstLaunchDialogs, launchApp, openSettingsGroup } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { saveSecurityShot } from "./lib/securityShots.mjs";
import { enableProtectionThroughUI, seedPopulatedProfile, PROTECTION_FINISH_MS } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "maple lantern river 42";
const PASSWORD_NOTICE = "Your new password is saved, but Vault Spend couldn't reopen the profile. Unlock it with your new password.";
const REMOVED_NOTICE = "Password protection is off, but Vault Spend couldn't reopen the profile. Open it again from this list.";

async function invoke(browser, command, args = {}) {
  return browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (error) => done({ error: String(error) }));
  }, command, args);
}

// getText() reads "" while a screen is still fading in, so wait until the element shows text.
async function shownText(browser, selector) {
  const element = await browser.$(selector);
  await element.waitForDisplayed({ timeout: 10000 });
  await browser.waitUntil(async () => (await element.getText()).trim() !== "", { timeout: 5000, timeoutMsg: `${selector} should show text` });
  return (await element.getText()).trim();
}

async function unlock(browser, password) {
  await (await browser.$("#password-form-field")).setValue(password);
  await (await browser.$("button=Unlock")).click();
}

const testDbDir = freshTestDbDir();
await seedPopulatedProfile(testDbDir);
{
  const setup = await launchApp({ dbDir: testDbDir });
  try {
    await (await setup.browser.$("button*=Settings")).click();
    await enableProtectionThroughUI(setup.browser, PASSWORD);
    await setup.browser.$("button=Change password").waitForExist({ timeout: PROTECTION_FINISH_MS });
  } finally {
    await setup.close();
  }
}

process.env.VAULTSPEND_FAILPOINT = "reopen_after_commit";
let app;
try {
  app = await launchApp({ dbDir: testDbDir, ready: "[data-profile-selector]" });
} finally {
  delete process.env.VAULTSPEND_FAILPOINT;
}
try {
  const { browser } = app;
  await (await browser.$("[data-profile-option]")).click();
  await unlock(browser, PASSWORD);
  await browser.$(".brand-word").waitForExist({ timeout: 15000 });
  await dismissFirstLaunchDialogs(browser);

  // 1. Change the password. The change commits, the reopen fails: the lock screen says the new password is saved.
  await (await browser.$("button*=Settings")).click();
  await openSettingsGroup(browser, "profiles");
  await (await browser.$('[data-settings-panel="profiles"]').$("button=Change password")).click();
  await (await browser.$("#change-password-current")).setValue(PASSWORD);
  await (await browser.$("button=Continue")).click();
  await (await browser.$("#change-password-new")).waitForExist({ timeout: 10000 });
  await (await browser.$("#change-password-new")).setValue(NEW_PASSWORD);
  await (await browser.$("#change-password-confirm")).setValue(NEW_PASSWORD);
  await (await browser.$("button=Continue")).click();
  const recovery = await shownText(browser, ".change-password-dialog .protection-setup-key");
  await (await browser.$("button=I've saved it")).click();
  const groups = recovery.split("-");
  for (const index of [0, 1]) {
    const labelText = await shownText(browser, `label[for='change-password-answer-${index}']`);
    await (await browser.$(`#change-password-answer-${index}`)).setValue(groups[Number(labelText.match(/\d+/)[0]) - 1]);
  }
  await (await browser.$("button=Finish")).click();

  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: PROTECTION_FINISH_MS, timeoutMsg: "a failed reopen should close the profile" });
  assert.equal(await shownText(browser, "[data-gate-notice]"), PASSWORD_NOTICE);
  await saveSecurityShot(browser, "reopen-failed-lock-screen.png");
  assert.match((await invoke(browser, "list_transactions")).error ?? "", /PROFILE_LOCKED/, "the old file must not stay open");

  // 2. The old password no longer opens it; the new one does, and the data is all there.
  await unlock(browser, PASSWORD);
  await browser.waitUntil(async () => (await browser.$("[data-profile-lock-screen]").$("[role='alert']").getText()).trim() !== "", {
    timeout: 10000,
    timeoutMsg: "the old password should be refused",
  });
  await unlock(browser, NEW_PASSWORD);
  await browser.$(".brand-word").waitForExist({ timeout: 15000, timeoutMsg: "the new password should unlock the profile" });
  await dismissFirstLaunchDialogs(browser);
  assert.ok((await invoke(browser, "list_transactions")).ok.some((row) => row.description === "Market Basket"), "the data must survive");
  assert.equal(await browser.$("[data-gate-notice]").isExisting(), false, "opening the profile clears the notice");

  // 3. Remove protection. The reopen fails again: an unprotected profile goes back to the profile list.
  await (await browser.$("button*=Settings")).click();
  await openSettingsGroup(browser, "profiles");
  await (await browser.$("button=Remove protection")).click();
  await (await browser.$("#remove-protection-current")).setValue(NEW_PASSWORD);
  await (await browser.$("button=Continue")).click();
  const removeButton = await browser.$(".remove-protection-dialog").$("button=Remove protection");
  await removeButton.waitForExist({ timeout: PROTECTION_FINISH_MS });
  await removeButton.click();

  await browser.$("[data-profile-selector]").waitForExist({ timeout: PROTECTION_FINISH_MS, timeoutMsg: "an unprotected profile should return to the list" });
  assert.equal(await shownText(browser, "[data-gate-notice]"), REMOVED_NOTICE);
  await saveSecurityShot(browser, "reopen-failed-profile-list.png");
  await (await browser.$("[data-profile-option]")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 15000, timeoutMsg: "the profile should open without a password" });
  const profile = (await invoke(browser, "list_profiles")).ok.find((p) => p.is_active);
  assert.equal(profile.is_password_protected, false);
  assert.ok((await invoke(browser, "list_transactions")).ok.some((row) => row.description === "Market Basket"));
} finally {
  await app.close();
}

console.log("FEATURE 419 E2E TEST PASSED");
