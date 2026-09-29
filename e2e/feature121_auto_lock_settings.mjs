// Phase E Task 1: a protected profile gets the documented automatic-lock defaults, every choice
// can be changed through Settings, and those non-secret choices survive a real app restart in the
// backward-compatible profiles.json metadata.
//
// This spec switches ON "Lock when the window loses focus". Under the parallel runner another spec's
// window launching takes OS foreground from this one, and the app then locks the profile — correctly, it
// is exactly what that setting is for. So the spec never relies on the profile staying unlocked: what was
// saved is checked from profiles.json on disk, and the UI checks unlock again and retry if (and only if)
// the lock screen is what interrupted them.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dismissFirstLaunchDialogs, launchApp, waitUntilOrDiagnose } from "./harness.mjs";
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

// What is saved for the protected profile, read straight from the registry file — independent of whether
// the profile is currently unlocked. null while the file is missing or mid-write.
function savedAutoLock(dbDir) {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(dbDir, "profiles.json"), "utf8"));
    const entry = registry.profiles.find((p) => p.protection);
    const s = entry?.protection?.auto_lock;
    return s ? { minutes: s.inactivity_minutes, hidden: s.lock_when_hidden, focus: s.lock_on_focus_loss, system: s.lock_on_system_event } : null;
  } catch {
    return null;
  }
}

// The four controls' values in one read, or null while they are missing or still disabled (settings not
// loaded, or a save in flight). One execute, so a lock cannot land between the reads.
const readControls = (browser) =>
  browser.execute(() => {
    const minutes = document.querySelector("[data-auto-lock-minutes]");
    const hidden = document.querySelector("[data-lock-when-hidden]");
    const focus = document.querySelector("[data-lock-on-focus-loss]");
    const system = document.querySelector("[data-lock-on-system-event]");
    if (!minutes || !hidden || !focus || !system || minutes.disabled) return null;
    return { minutes: minutes.value, hidden: hidden.checked, focus: focus.checked, system: system.checked };
  });

// The controls stay disabled until the profile shows as protected AND its settings have loaded. If that
// never happens, say which of the two is missing instead of just timing out.
async function waitForControls(browser, when) {
  await waitUntilOrDiagnose(browser, async () => (await readControls(browser)) !== null, {
    timeout: 10000,
    timeoutMsg: `the automatic-lock controls should enable ${when}`,
    extra: async () => {
      const settings = await invoke(browser, "get_auto_lock_settings");
      const profiles = await invoke(browser, "list_profiles");
      const section = await browser.execute(() => document.querySelector("[data-auto-lock-settings]")?.innerText.replace(/\s+/g, " ").slice(0, 300) ?? null);
      return { settings, profiles: (profiles.ok ?? []).map((p) => [p.name, p.is_password_protected, p.is_active]), profilesError: profiles.error, section };
    },
  });
}

async function unlockIfLocked(browser) {
  if (!(await browser.$("[data-profile-lock-screen]").isExisting())) return;
  await (await browser.$("#password-form-field")).setValue(PASSWORD);
  await (await browser.$("button[type='submit']")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await dismissFirstLaunchDialogs(browser);
}

// Runs `step`; if the lock screen is what stopped it (focus-loss lock, see the header), unlocks and runs it
// again, up to four times. Any failure with no lock screen showing is a real failure and is thrown as is.
async function retryAcrossFocusLocks(browser, step) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    await unlockIfLocked(browser);
    try {
      return await step();
    } catch (error) {
      lastError = error;
      if (!(await browser.$("[data-profile-lock-screen]").isExisting())) throw error;
    }
  }
  throw lastError;
}

const app = await launchApp();
const dbDir = app.testDbDir;
try {
  const { browser } = app;
  await (await browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(browser, PASSWORD);

  await waitForControls(browser, "after turning protection on");
  const defaults = await readControls(browser);
  assert.deepEqual(defaults, { minutes: "15", hidden: true, focus: false, system: true }, "protected profiles start on the documented defaults");

  const minutes = await browser.$("[data-auto-lock-minutes]");
  await minutes.selectByAttribute("value", "30");
  // Each save briefly disables the controls, so wait for each to be usable again. The focus-loss toggle goes
  // last: once it is on, the profile may lock itself the moment this window loses OS focus.
  for (const marker of ["[data-lock-when-hidden]", "[data-lock-on-system-event]", "[data-lock-on-focus-loss]"]) {
    const control = await browser.$(marker);
    await control.waitForEnabled({ timeout: 5000 });
    await control.click();
  }

  await waitUntilOrDiagnose(browser, async () => {
    const saved = savedAutoLock(dbDir);
    return saved?.minutes === 30 && saved.hidden === false && saved.focus === true && saved.system === false;
  }, {
    timeout: 10000,
    timeoutMsg: "automatic-lock settings should persist after all four UI changes",
    extra: async () => ({ saved: savedAutoLock(dbDir) }),
  });
} finally {
  await app.close();
}

const relaunched = await launchApp({ dbDir, ready: "[data-profile-selector]" });
try {
  const { browser } = relaunched;
  await (await browser.$("[data-profile-option]")).click();
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  await retryAcrossFocusLocks(browser, async () => {
    await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  });

  const values = await retryAcrossFocusLocks(browser, async () => {
    await (await browser.$("button*=Settings")).click();
    await waitForControls(browser, "after unlocking on relaunch");
    return readControls(browser);
  });
  assert.deepEqual(values, { minutes: "30", hidden: false, focus: true, system: false }, "the saved choices show after a restart");
} finally {
  await relaunched.close();
}

console.log("FEATURE 121 E2E TEST PASSED");
