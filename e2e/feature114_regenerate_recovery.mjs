// Regenerate-recovery coverage through the compiled app. Uses the debug-only
// debug_recovery_code_unlocks probe deliberately (this spec is about the regenerate flow, not the
// recover-via-code UI feature116 covers) rather than the real "Forgot your password?" entry Task 5
// added — checking whether a code unlocks the on-disk key file is a strictly narrower, faster check
// than walking the full recovery-and-reset UI just to prove the old code stopped working.
// The second half kills the app at the rotation_after_staging failpoint mid-regeneration: regenerating
// now rotates the database key, so an interrupted run must be discarded by startup recovery and leave
// the password and the OLD recovery code working (nothing was committed).
// Run with: npm run e2e -- --spec=114

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dismissFirstLaunchDialogs, launchApp, openSettingsGroup } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { enableProtectionThroughUI, killAtFailpoint, seedPopulatedProfile, PROTECTION_FINISH_MS } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";
const SHOTS = process.env.VAULTSPEND_E2E_SHOTS ?? path.join(os.tmpdir(), "vaultspend-e2e-security-shots");
const REGENERATE_COPY =
  "Write down this new recovery key. Your previous recovery key no longer opens this profile or its backups. Copies in your second backup folder and files you exported earlier still open with the old key, so delete them if the old key may have been seen.";

async function invoke(browser, command, args = {}) {
  return browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (error) => done({ error: String(error) }));
  }, command, args);
}

const testDbDir = freshTestDbDir();
await seedPopulatedProfile(testDbDir);
const app = await launchApp({ dbDir: testDbDir });
try {
  const { browser } = app;
  await (await browser.$("button*=Settings")).click();
  const oldRecovery = await enableProtectionThroughUI(browser, PASSWORD);
  await browser.$("button=Regenerate recovery key").waitForExist({ timeout: PROTECTION_FINISH_MS });

  await (await browser.$("button=Regenerate recovery key")).click();
  await (await browser.$("#regenerate-recovery-current")).setValue(PASSWORD);
  await (await browser.$("button=Continue")).click();
  const recoveryEl = await browser.$(".regenerate-recovery-dialog .protection-setup-key");
  await recoveryEl.waitForExist({ timeout: 10000 });
  const newRecovery = (await recoveryEl.getText()).trim();
  assert.notEqual(newRecovery, oldRecovery);
  assert.equal((await browser.$(".regenerate-recovery-dialog .modal-message").getText()).trim(), REGENERATE_COPY);
  fs.mkdirSync(SHOTS, { recursive: true });
  await browser.saveScreenshot(path.join(SHOTS, "regenerate-recovery-key.png"));

  await (await browser.$("button=I've saved it")).click();
  const label0 = await browser.$("label[for='regenerate-recovery-answer-0']");
  const label1 = await browser.$("label[for='regenerate-recovery-answer-1']");
  const group0 = Number((await label0.getText()).match(/\d+/)[0]) - 1;
  const group1 = Number((await label1.getText()).match(/\d+/)[0]) - 1;
  const groups = newRecovery.split("-");
  await (await browser.$("#regenerate-recovery-answer-0")).setValue(groups[group0]);
  await (await browser.$("#regenerate-recovery-answer-1")).setValue(groups[group1]);
  await (await browser.$("button=Finish")).click();
  await browser.$(".regenerate-recovery-dialog").waitForExist({ reverse: true, timeout: 15000 });

  const generation = (await invoke(browser, "get_current_generation")).ok;
  assert.equal((await invoke(browser, "verify_current_password", { password: PASSWORD, expectedGeneration: generation })).error, undefined);
  assert.equal((await invoke(browser, "debug_recovery_code_unlocks", { code: oldRecovery })).ok, false);
  assert.equal((await invoke(browser, "debug_recovery_code_unlocks", { code: newRecovery })).ok, true);
} finally {
  await app.close();
}

// Kill after the rotated database and backups are staged but before the registry commits. Startup must
// discard the staged rotation: the journal goes, the password unlocks, and the old recovery code still works.
{
  const crashDbDir = freshTestDbDir();
  await seedPopulatedProfile(crashDbDir);
  const setupApp = await launchApp({ dbDir: crashDbDir });
  let crashOldRecovery;
  try {
    await (await setupApp.browser.$("button*=Settings")).click();
    crashOldRecovery = await enableProtectionThroughUI(setupApp.browser, PASSWORD);
    await setupApp.browser.$("button=Regenerate recovery key").waitForExist({ timeout: PROTECTION_FINISH_MS });
  } finally {
    await setupApp.close();
  }

  process.env.VAULTSPEND_FAILPOINT = "rotation_after_staging";
  let app;
  try {
    app = await launchApp({ dbDir: crashDbDir, ready: "[data-profile-selector]" });
  } finally {
    delete process.env.VAULTSPEND_FAILPOINT;
  }
  const { browser } = app;
  await (await browser.$("[data-profile-option]")).click();
  await (await browser.$("#password-form-field")).setValue(PASSWORD);
  await (await browser.$("button=Unlock")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await dismissFirstLaunchDialogs(browser);
  await (await browser.$("button*=Settings")).click();
  await openSettingsGroup(browser, "profiles");
  await (await browser.$("button=Regenerate recovery key")).click();
  await (await browser.$("#regenerate-recovery-current")).setValue(PASSWORD);
  await (await browser.$("button=Continue")).click();
  const crashRecoveryEl = await browser.$(".regenerate-recovery-dialog .protection-setup-key");
  await crashRecoveryEl.waitForExist({ timeout: 10000 });
  const crashNewRecovery = (await crashRecoveryEl.getText()).trim();
  await (await browser.$("button=I've saved it")).click();
  const crashGroup0 = Number((await (await browser.$("label[for='regenerate-recovery-answer-0']")).getText()).match(/\d+/)[0]) - 1;
  const crashGroup1 = Number((await (await browser.$("label[for='regenerate-recovery-answer-1']")).getText()).match(/\d+/)[0]) - 1;
  const crashGroups = crashNewRecovery.split("-");
  await (await browser.$("#regenerate-recovery-answer-0")).setValue(crashGroups[crashGroup0]);
  await (await browser.$("#regenerate-recovery-answer-1")).setValue(crashGroups[crashGroup1]);
  const pid = (await invoke(browser, "debug_process_id")).ok;
  await killAtFailpoint(crashDbDir, "rotation_after_staging", pid, () =>
    browser.execute(() => [...document.querySelectorAll("button")].find((button) => button.textContent === "Finish").click()),
  );
  await app.close();

  assert.ok(fs.existsSync(path.join(crashDbDir, "protection-rotation-journal.json")));
  const relaunched = await launchApp({ dbDir: crashDbDir, ready: "[data-profile-selector]" });
  try {
    assert.ok(!fs.existsSync(path.join(crashDbDir, "protection-rotation-journal.json")), "startup should retire the pre-commit journal");
    await (await relaunched.browser.$("[data-profile-option]")).click();
    await (await relaunched.browser.$("#password-form-field")).setValue(PASSWORD);
    await (await relaunched.browser.$("button=Unlock")).click();
    await relaunched.browser.$(".brand-word").waitForExist({ timeout: 10000, timeoutMsg: "the password should still unlock after recovery" });
    assert.equal((await invoke(relaunched.browser, "debug_recovery_code_unlocks", { code: crashOldRecovery })).ok, true, "nothing was committed, so the old recovery code still works");
    assert.equal((await invoke(relaunched.browser, "debug_recovery_code_unlocks", { code: crashNewRecovery })).ok, false, "the never-committed new code must not work");
  } finally {
    await relaunched.close();
  }
}

console.log("FEATURE 114 E2E TEST PASSED");
