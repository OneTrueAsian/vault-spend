// Regenerate-recovery coverage through the compiled app. Uses the debug-only
// debug_recovery_code_unlocks probe deliberately (this spec is about the regenerate flow, not the
// recover-via-code UI feature116 covers) rather than the real "Forgot your password?" entry Task 5
// added — checking whether a code unlocks the on-disk key file is a strictly narrower, faster check
// than walking the full recovery-and-reset UI just to prove the old code stopped working.
// Run with: node e2e/run-all.mjs --spec=114

import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { enableProtectionThroughUI, seedPopulatedProfile } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";

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
  await browser.$("button=Regenerate recovery key…").waitForExist({ timeout: 15000 });

  await (await browser.$("button=Regenerate recovery key…")).click();
  await (await browser.$("#regenerate-recovery-current")).setValue(PASSWORD);
  await (await browser.$("button=Continue")).click();
  const recoveryEl = await browser.$(".regenerate-recovery-dialog .protection-setup-key");
  await recoveryEl.waitForExist({ timeout: 10000 });
  const newRecovery = (await recoveryEl.getText()).trim();
  assert.notEqual(newRecovery, oldRecovery);

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

console.log("FEATURE 114 E2E TEST PASSED");
