// Phase E Task 4: focus loss is opt-in, closing to the enabled tray follows the per-profile hide
// choice, and reopening a hidden protected session reaches the lock screen. Debug commands inject
// the native cause through the production decision/coordinator and hide/show the real Tauri window;
// they are absent from release builds.
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
    timeoutMsg: "password protection should finish before testing window triggers",
  });
}

// Focus loss defaults off, then locks only after the person opts in. A real parallel run may take
// foreground immediately after opt-in; that is itself the native event under test, so accept it and
// use the deterministic injector only if the session is still open.
{
  const app = await launchApp();
  try {
    const { browser } = app;
    await protect(browser);

    const ignored = await invoke(browser, "debug_apply_window_lock_trigger", { trigger: "focus_lost" });
    assert.deepEqual(ignored, { ok: false }, `default-off focus loss should be ignored: ${JSON.stringify(ignored)}`);
    assert.equal((await invoke(browser, "get_startup_state")).ok?.status, "open");

    const focusToggle = await browser.$("[data-lock-on-focus-loss]");
    await focusToggle.click();
    await browser.waitUntil(async () => {
      const state = await invoke(browser, "get_startup_state");
      if (state.ok?.status === "locked") return true;
      const settings = await invoke(browser, "get_auto_lock_settings");
      return settings.ok?.lock_on_focus_loss === true;
    }, { timeout: 10000, timeoutMsg: "focus-loss opt-in should persist or immediately react to a real focus loss" });

    if ((await invoke(browser, "get_startup_state")).ok?.status === "open") {
      const applied = await invoke(browser, "debug_apply_window_lock_trigger", { trigger: "focus_lost" });
      assert.deepEqual(applied, { ok: true }, `opted-in focus loss should lock: ${JSON.stringify(applied)}`);
    }
    await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  } finally {
    await app.close();
  }
}

// Use a separate fresh app so the focus-loss opt-in above cannot race this tray round trip.
{
  const app = await launchApp();
  try {
    const { browser } = app;
    await protect(browser);
    const generation = (await invoke(browser, "get_current_generation")).ok;
    const defaults = (await invoke(browser, "get_auto_lock_settings")).ok;
    await invoke(browser, "set_tray_enabled", { enabled: true });
    await browser.waitUntil(async () => (await invoke(browser, "get_background_settings")).ok?.tray_enabled === true, {
      timeout: 10000,
      timeoutMsg: "the tray must exist before exercising close-to-tray behavior",
    });

    const disabled = { ...defaults, lock_when_hidden: false };
    assert.deepEqual(await invoke(browser, "set_auto_lock_settings", { settings: disabled, expectedGeneration: generation }), { ok: null });
    assert.deepEqual(
      await invoke(browser, "debug_apply_window_lock_trigger", { trigger: "hidden_to_tray" }),
      { ok: false },
      "a protected profile may opt out of locking when hidden",
    );
    assert.deepEqual(await invoke(browser, "debug_apply_window_lock_trigger", { trigger: "quit" }), { ok: false }, "Quit never becomes a lock request");
    assert.deepEqual(await invoke(browser, "debug_set_main_window_visible", { visible: false }), { ok: false });
    assert.deepEqual(await invoke(browser, "debug_set_main_window_visible", { visible: true }), { ok: true });
    assert.equal((await invoke(browser, "get_startup_state")).ok?.status, "open", "opted-out tray round trip should remain open");

    const enabled = { ...defaults, lock_when_hidden: true };
    assert.deepEqual(await invoke(browser, "set_auto_lock_settings", { settings: enabled, expectedGeneration: generation }), { ok: null });
    assert.deepEqual(await invoke(browser, "debug_apply_window_lock_trigger", { trigger: "hidden_to_tray" }), { ok: true });
    assert.deepEqual(await invoke(browser, "debug_set_main_window_visible", { visible: false }), { ok: false });
    assert.deepEqual(await invoke(browser, "debug_set_main_window_visible", { visible: true }), { ok: true });
    await browser.$("[data-profile-lock-screen]").waitForExist({
      timeout: 10000,
      timeoutMsg: "reopening an opted-in protected profile from the tray should show its lock screen",
    });
  } finally {
    await app.close();
  }
}

console.log("FEATURE 123 E2E TEST PASSED");
