// E2E coverage for locking/unlocking a real protected profile (Phase C, Task 9): a correct password
// unlocks; a wrong one shows the message and re-tries at the documented delay after the 4th failure;
// a locked profile refuses to leak data through a direct backend call.
//
// Run with: node e2e/feature102_profile_unlock_lock.mjs

import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";

async function invoke(browser, command, args = {}) {
  const result = await browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (e) => done({ error: String(e) }));
  }, command, args);
  return result;
}

const PASSWORD = "correct horse battery staple";

const app = await launchApp();
try {
  const { browser } = app;
  await (await browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(browser, PASSWORD);
  await browser.waitUntil(async () => (await browser.$(".page").getText()).includes("Password protection: On"), {
    timeout: 10000,
    timeoutMsg: "expected Password protection: On after finishing setup",
  });

  // Lock, in-session, via the profile switcher.
  await (await browser.$(".profile-switcher-toggle")).click();
  await (await browser.$("[data-profile-switcher-lock]")).click();
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });

  // A direct backend call must report locked, never open, while the lock screen is up.
  const state = await invoke(browser, "get_startup_state");
  assert.equal(state.ok?.status, "locked", `expected a locked startup state, got ${JSON.stringify(state)}`);
  const refused = await invoke(browser, "list_accounts");
  assert.ok(refused.error?.startsWith("PROFILE_LOCKED"), `a data command must refuse while locked, got ${JSON.stringify(refused)}`);

  // `unlock_profile` checks the delay BEFORE trying the password, so a failure's own delay only
  // shows up on the NEXT attempt, not the one that caused it: 3 free failures return the plain
  // message with no delay, the 4th (which pushes the failure count to 4) still returns the plain
  // message, and only the 5th attempt — now checking a nonzero delay before even trying — is
  // refused with the "Try again in N seconds" message, whatever password it's given.
  async function tryPassword(password) {
    await (await browser.$("#password-form-field")).setValue(password);
    await (await browser.$("button[type='submit']")).click();
    await browser.waitUntil(async () => (await browser.$('[role="alert"]').getText()) !== "", {
      timeout: 5000,
      timeoutMsg: "expected an error message after a failed unlock attempt",
    });
    return (await browser.$('[role="alert"]')).getText();
  }

  for (let i = 0; i < 4; i++) {
    const message = await tryPassword("wrong password");
    assert.equal(message, "That password didn't work.", `attempt ${i + 1} of 4 should carry no delay message, got: ${message}`);
  }

  const tooSoon = await tryPassword(PASSWORD); // the RIGHT password, but the delay hasn't elapsed
  assert.match(tooSoon, /Try again in \d+ seconds?\./, `an attempt right after the 4th failure must be refused by the delay, got: ${tooSoon}`);

  await new Promise((r) => setTimeout(r, 2200)); // the documented 2-second delay after the 4th failure

  await (await browser.$("#password-form-field")).setValue(PASSWORD);
  await (await browser.$("button[type='submit']")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 10000, timeoutMsg: "the correct password should unlock once the delay has passed" });

  const openState = await invoke(browser, "get_startup_state");
  assert.equal(openState.ok?.status, "open", `expected an open startup state after unlocking, got ${JSON.stringify(openState)}`);
} finally {
  await app.close();
}

console.log("FEATURE 102 E2E TEST PASSED");
