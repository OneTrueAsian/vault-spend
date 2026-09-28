// Phase E Task 5: protected profiles lock on Windows workstation-lock and suspend messages when
// enabled. Resume is inert and the debug-only injector exercises the production coordinator
// without locking or suspending the test machine.
import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
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

async function protect(browser) {
  await (await browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(browser, PASSWORD);
  await browser.waitUntil(async () => (await browser.$(".page").getText()).includes("Password protection: On"), {
    timeout: 10000,
    timeoutMsg: "password protection should finish before testing system session events",
  });
}

// Lock defaults on, resume never locks, and resume cannot unlock after a lock event.
{
  const app = await launchApp();
  try {
    const { browser } = app;
    await protect(browser);

    assert.deepEqual(await invoke(browser, "debug_apply_system_session_event", { event: "resumed" }), { ok: false });
    assert.equal((await invoke(browser, "get_startup_state")).ok?.status, "open");
    assert.deepEqual(await invoke(browser, "debug_apply_system_session_event", { event: "locked" }), { ok: true });
    await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
    assert.deepEqual(await invoke(browser, "debug_apply_system_session_event", { event: "resumed" }), { ok: false });
    assert.equal((await invoke(browser, "get_startup_state")).ok?.status, "locked");
  } finally {
    await app.close();
  }
}

// The per-profile setting suppresses both events; re-enabling it makes suspend lock immediately.
{
  const app = await launchApp();
  try {
    const { browser } = app;
    await protect(browser);
    const generation = (await invoke(browser, "get_current_generation")).ok;
    const defaults = (await invoke(browser, "get_auto_lock_settings")).ok;
    assert.equal(defaults.lock_on_system_event, true);

    const disabled = { ...defaults, lock_on_system_event: false };
    assert.deepEqual(await invoke(browser, "set_auto_lock_settings", { settings: disabled, expectedGeneration: generation }), { ok: null });
    assert.deepEqual(await invoke(browser, "debug_apply_system_session_event", { event: "locked" }), { ok: false });
    assert.deepEqual(await invoke(browser, "debug_apply_system_session_event", { event: "suspending" }), { ok: false });
    assert.equal((await invoke(browser, "get_startup_state")).ok?.status, "open");

    assert.deepEqual(
      await invoke(browser, "set_auto_lock_settings", { settings: defaults, expectedGeneration: generation }),
      { ok: null },
    );
    assert.deepEqual(await invoke(browser, "debug_apply_system_session_event", { event: "suspending" }), { ok: true });
    await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  } finally {
    await app.close();
  }
}

console.log("FEATURE 124 E2E TEST PASSED");
