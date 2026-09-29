// Recover-via-recovery-code coverage through the compiled app (Phase D, Task 5), plus the separate
// "Forgot the password? Remove this profile from the list" escape.
// Run with: node e2e/run-all.mjs --spec=116

import assert from "node:assert/strict";
import fs from "node:fs";
import { dismissFirstLaunchDialogs, launchApp } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { enableProtectionThroughUI, seedPopulatedProfile, seedProfiles } from "./lib/protection.mjs";

const OLD_PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "recovered brand new password!!";

async function invoke(browser, command, args = {}) {
  return browser.executeAsync(
    (command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (error) => done({ error: String(error) })),
    command,
    args,
  );
}

async function lockViaSwitcher(browser) {
  await (await browser.$(".profile-switcher-toggle")).click();
  await (await browser.$("[data-profile-switcher-lock]")).click();
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
}

// Reads every [data-profile-option] card's text. `browser.$$(...)`'s collection doesn't support a
// plain Array.prototype.map the way it looks like it should (found the hard way — Promise.all(options
// .map(...)) throws "object is not iterable"); the proven pattern elsewhere in this suite (feature102)
// is a plain for...of over the awaited collection.
async function profileOptionTexts(browser) {
  const texts = [];
  for (const option of await browser.$$("[data-profile-option]")) texts.push((await option.getText()).trim());
  return texts;
}

// Recover via code: wrong code refuses and stays put, the right code plus a fresh password reopens
// the profile with its data intact, and both the old password and the code just used stop working.
{
  const testDbDir = freshTestDbDir();
  await seedPopulatedProfile(testDbDir);
  const app = await launchApp({ dbDir: testDbDir });
  try {
    const { browser } = app;
    await (await browser.$("button*=Settings")).click();
    const oldRecovery = await enableProtectionThroughUI(browser, OLD_PASSWORD);
    await browser.waitUntil(async () => (await browser.$(".page").getText()).includes("Password protection: On"), { timeout: 10000 });
    await lockViaSwitcher(browser);

    await (await browser.$("[data-forgot-password]")).click();
    await (await browser.$("#recover-profile-code")).setValue("not-a-real-code");
    await (await browser.$("button=Continue")).click();
    // Scoped to the dialog: the lock screen's own PasswordForm carries an always-present (usually
    // empty) [role="alert"] paragraph of its own, and the dialog portals into <body> as a later
    // sibling, so a bare [role="alert"] selector would match that one first, not this error.
    const dialogAlert = () => browser.$(".recover-profile-dialog [role='alert']");
    await browser.waitUntil(async () => (await dialogAlert().getText()) !== "", { timeout: 5000 });
    assert.match(await dialogAlert().getText(), /didn't work/);
    assert.ok(!(await browser.$("#recover-profile-new").isExisting()), "a wrong code must not advance to choosing a new password");

    await (await browser.$("#recover-profile-code")).setValue(oldRecovery);
    await (await browser.$("button=Continue")).click();
    await (await browser.$("#recover-profile-new")).setValue(NEW_PASSWORD);
    await (await browser.$("#recover-profile-confirm")).setValue(NEW_PASSWORD);
    await (await browser.$("button=Continue")).click();
    const recoveryEl = await browser.$(".recover-profile-dialog .protection-setup-key");
    await recoveryEl.waitForExist({ timeout: 10000 });
    const newRecovery = (await recoveryEl.getText()).trim();
    assert.notEqual(newRecovery, oldRecovery);
    await (await browser.$("button=I've saved it")).click();
    const label0 = await browser.$("label[for='recover-profile-answer-0']");
    const label1 = await browser.$("label[for='recover-profile-answer-1']");
    const group0 = Number((await label0.getText()).match(/\d+/)[0]) - 1;
    const group1 = Number((await label1.getText()).match(/\d+/)[0]) - 1;
    const groups = newRecovery.split("-");
    await (await browser.$("#recover-profile-answer-0")).setValue(groups[group0]);
    await (await browser.$("#recover-profile-answer-1")).setValue(groups[group1]);
    await (await browser.$("button=Finish")).click();

    await browser.$(".brand-word").waitForExist({ timeout: 10000, timeoutMsg: "recovery should reopen the profile directly" });
    assert.ok((await invoke(browser, "list_transactions")).ok.some((row) => row.description === "Market Basket"), "the data must survive recovery");

    const generation = (await invoke(browser, "get_current_generation")).ok;
    assert.match((await invoke(browser, "verify_current_password", { password: OLD_PASSWORD, expectedGeneration: generation })).error, /didn't work/);
    assert.equal((await invoke(browser, "verify_current_password", { password: NEW_PASSWORD, expectedGeneration: generation })).error, undefined);
    assert.equal((await invoke(browser, "debug_recovery_code_unlocks", { code: oldRecovery })).ok, false, "the code just used to recover must stop working");
    assert.equal((await invoke(browser, "debug_recovery_code_unlocks", { code: newRecovery })).ok, true);
  } finally {
    await app.close();
  }
}

// The "Forgot the password? Remove this profile from the list" escape: two profiles so there's a
// real selector to land back on; protect and lock the second, remove it from the list, and confirm
// the first is still offered while the removed profile's encrypted files remain on disk untouched.
{
  const dbDir = await seedProfiles([{ name: "Alex" }, { name: "Blair" }]);
  const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
  let blairDbPath;
  try {
    const { browser } = app;
    const texts = await profileOptionTexts(browser);
    const blairIndex = texts.findIndex((t) => /Blair/.test(t));
    const options = await browser.$$("[data-profile-option]");
    await options[blairIndex].click();
    await browser.$(".brand-word").waitForExist({ timeout: 10000 });
    await dismissFirstLaunchDialogs(browser);

    await (await browser.$("button*=Settings")).click();
    await enableProtectionThroughUI(browser, OLD_PASSWORD);
    await browser.waitUntil(async () => (await browser.$(".page").getText()).includes("Password protection: On"), { timeout: 10000 });
    blairDbPath = (await invoke(browser, "get_data_file_location")).ok;
    await lockViaSwitcher(browser);

    await (await browser.$("[data-forgot-remove-profile]")).click();
    assert.match(await (await browser.$(".profile-gate-remove-confirm")).getText(), /Blair/);
    await (await browser.$("[data-confirm-remove-profile]")).click();

    await browser.$("[data-profile-selector]").waitForExist({ timeout: 10000, timeoutMsg: "removing the locked profile should land back on the selector" });
    const remaining = await profileOptionTexts(browser);
    assert.equal(remaining.length, 1, `expected only Alex left, got ${JSON.stringify(remaining)}`);
    assert.match(remaining[0], /Alex/);
  } finally {
    await app.close();
  }

  assert.ok(fs.existsSync(blairDbPath), "Blair's encrypted database file must remain on disk after the escape");
  assert.ok(fs.existsSync(`${blairDbPath}.key`), "Blair's key file must remain on disk (unreadable without the password or recovery key)");
}

console.log("FEATURE 116 E2E TEST PASSED");
