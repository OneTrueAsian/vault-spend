// E2E coverage for migrating the four legacy localStorage-based settings into a profile's database
// (Phase C, Task 9): a value present at the very first launch lands in the database and is cleared
// from localStorage; migration is a one-time, device-wide flag, so a second, later-opened profile on
// the same computer never inherits it; and a `set_profile_ui_state` call carrying a generation from
// before a profile switch is refused, never silently applied to whichever profile is open by then.
//
// Seeding localStorage has to happen in the narrow window between the app's page actually loading
// (so it's on the right origin) and its own mount effect reading it — well before `launchApp`'s
// default `ready: ".brand-word"` wait resolves, confirmed empirically while writing this spec: without
// `beforeReady`, `is_ui_state_migrated` is already `true` (migration already ran and found nothing)
// by the time `launchApp()` itself returns.
//
// Run with: node e2e/feature107_profile_ui_state.mjs

import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";

async function invoke(browser, command, args = {}) {
  const result = await browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (e) => done({ error: String(e) }));
  }, command, args);
  return result;
}

const LEGACY_KEY = "meadow-saved-ledger-filters";
const LEGACY_VALUE = '[{"name":"Groceries only"}]';

const app = await launchApp({
  beforeReady: async (browser) => {
    await browser.execute((key, value) => localStorage.setItem(key, value), LEGACY_KEY, LEGACY_VALUE);
  },
});
try {
  const { browser } = app;

  // 1. The value migrates into the database, and localStorage is cleared, on the very first launch.
  await browser.waitUntil(async () => (await invoke(browser, "is_ui_state_migrated")).ok === true, {
    timeout: 10000,
    timeoutMsg: "migration should run once on the first launch",
  });
  const migratedValue = await invoke(browser, "get_profile_ui_state", { key: "saved_filters" });
  assert.equal(migratedValue.ok, LEGACY_VALUE, `expected the legacy value to have migrated, got ${JSON.stringify(migratedValue)}`);
  const remainingLocalStorage = await browser.execute((key) => localStorage.getItem(key), LEGACY_KEY);
  assert.equal(remainingLocalStorage, null, "the legacy key should be cleared from localStorage once migrated");

  // 2. A second, later-opened profile does not inherit it — migration is a one-time, device-wide
  // flag, not something that runs again for every profile that opens afterward.
  await (await browser.$("button*=Settings")).click();
  const profilesCard = await browser.$("//div[contains(@class,'card')][.//span[text()='Profiles']]");
  await profilesCard.waitForExist({ timeout: 10000 });
  await (await profilesCard.$("input")).setValue("Sam");
  await (await profilesCard.$("button*=New profile")).click();
  await browser.waitUntil(async () => (await browser.$(".status").getText()).toLowerCase().includes("sam"), {
    timeout: 10000,
    timeoutMsg: "expected a status message confirming the switch to the new Sam profile",
  });
  const samValue = await invoke(browser, "get_profile_ui_state", { key: "saved_filters" });
  assert.equal(samValue.ok, null, `a second, later-opened profile must not inherit the first profile's migrated value, got ${JSON.stringify(samValue)}`);

  // 3. A set_profile_ui_state call carrying a generation from before this switch must be refused —
  // never silently applied to whichever profile happens to be open by the time it's processed.
  const staleGeneration = (await invoke(browser, "get_current_generation")).ok - 1; // Sam's own switch just bumped it
  const rejected = await invoke(browser, "set_profile_ui_state", { key: "saved_filters", value: "[]", expectedGeneration: staleGeneration });
  assert.match(rejected.error ?? "", /active profile changed/i, `a stale-generation write must be refused, got ${JSON.stringify(rejected)}`);
} finally {
  await app.close();
}

console.log("FEATURE 107 E2E TEST PASSED");
