// Phase E Task 8: the browser-state and lock-boundary privacy probe. Fills sensitive-looking
// per-profile UI state (a recurring bill's merchant/category, a saved filter's name, and a dashboard
// widget referencing an investment account by name — the exact leak this task's audit found and
// fixed in dashboardLayout.ts/profileUiState.ts), locks the profile, and proves none of it survives
// in the DOM, in localStorage, or through a data command — then creates a second, unrelated profile
// and proves it starts with none of the first profile's content either.
//
// Run with: node e2e/feature127_browser_state_privacy_probe.mjs

import assert from "node:assert/strict";
import { launchApp, dismissFirstLaunchDialogs } from "./harness.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";

// Distinctive enough that they can only ever have come from this spec's own fixture — never a
// substring of anything else the app might render (a real transaction/category/merchant, another
// spec's fixture, chrome text, etc.).
const MERCHANT = "ZZY-SECRET-MERCHANT-127";
const CATEGORY = "ZZY-SECRET-CATEGORY-127";
const FILTER_NAME = "ZZY-SECRET-FILTER-127";
const INVESTMENT_NAME = "ZZY-SECRET-BROKERAGE-127";
const SECRETS = [MERCHANT, CATEGORY, FILTER_NAME, INVESTMENT_NAME];

async function invoke(browser, command, args = {}) {
  const result = await browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (e) => done({ error: String(e) }));
  }, command, args);
  return result;
}

// Every text node and every attribute value, concatenated — not just innerText (which skips
// display:none content) and not just innerHTML alone (attributes like title/aria-label can carry
// text innerText won't see).
async function domText(browser) {
  return browser.execute(() => document.documentElement.innerHTML + " " + (document.body.innerText || ""));
}

async function localStorageDump(browser) {
  return browser.execute(() => JSON.stringify({ ...localStorage }));
}

function assertNoSecrets(haystack, where) {
  for (const secret of SECRETS) {
    assert.ok(!haystack.includes(secret), `${where} must not contain ${secret}`);
  }
}

const today = new Date();
const anchorDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

const app = await launchApp();
try {
  const { browser } = app;

  // 1. Seed sensitive-looking state on the first (default) profile: a recurring bill (renders as real
  // UI text), a saved filter, and a dashboard layout referencing an investment account by name — the
  // exact widget-id shape (`investment:<account name>`) this task's audit found leaking into
  // localStorage.
  await invoke(browser, "create_recurring", {
    merchant: MERCHANT,
    category: CATEGORY,
    amount: "-777.77",
    cadence: "monthly",
    anchorDate,
    accountId: null,
  });
  const generation = (await invoke(browser, "get_current_generation")).ok;
  const setState = await invoke(browser, "set_profile_ui_state", {
    key: "dashboard_layout",
    value: JSON.stringify(["stat_net_worth", "stat_cash", `investment:${INVESTMENT_NAME}`]),
    expectedGeneration: generation,
  });
  assert.equal(setState.error, undefined, `seeding dashboard_layout failed: ${JSON.stringify(setState)}`);
  const setFilters = await invoke(browser, "set_profile_ui_state", {
    key: "saved_filters",
    value: JSON.stringify([
      { name: FILTER_NAME, searchText: "", filterCategory: "all", filterAccountIds: "all", filterMemberIds: "all", filterFrom: "", filterTo: "", filterTag: "all" },
    ]),
    expectedGeneration: generation,
  });
  assert.equal(setFilters.error, undefined, `seeding saved_filters failed: ${JSON.stringify(setFilters)}`);

  // All three were seeded through raw invoke calls, bypassing the frontend entirely — App already
  // fetched its initial data before this point, so a reload is needed for it to see any of it (same
  // reasoning as the reload after create_profile below).
  await browser.refresh();
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await dismissFirstLaunchDialogs(browser);

  // 2. Sanity check: the merchant genuinely renders on screen while unlocked — otherwise the later
  // "not in the DOM" assertion would pass for a trivial reason (nothing to leak in the first place).
  await (await browser.$("button*=Recurring")).click();
  await browser.waitUntil(async () => (await domText(browser)).includes(MERCHANT), {
    timeout: 10000,
    timeoutMsg: "the seeded recurring bill's merchant should be visible on the Recurring tab before any lock",
  });

  // 3. Protect and lock this profile.
  await (await browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(browser, PASSWORD);
  const generationBeforeLock = (await invoke(browser, "get_current_generation")).ok;
  await invoke(browser, "lock_current_profile", { expectedGeneration: generationBeforeLock });
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });

  // 4. While locked: nothing seeded above may appear anywhere in the DOM or in localStorage, and a
  // data command must be refused rather than answered from a stale cache.
  assertNoSecrets(await domText(browser), "the DOM while locked");
  assertNoSecrets(await localStorageDump(browser), "localStorage while locked");
  const blockedRead = await invoke(browser, "get_profile_ui_state", { key: "dashboard_layout" });
  assert.match(blockedRead.error ?? "", /PROFILE_LOCKED/, `a data command must be refused while locked, got ${JSON.stringify(blockedRead)}`);

  // 5. Create a second, unrelated profile. create_profile immediately swaps the live session onto it
  // (state.install), abandoning the first profile's slot — exactly the "switch to a different,
  // formerly-uninvolved profile" transition this probe needs; a manual refresh is required afterward
  // because, unlike lock/unlock, create_profile does not itself broadcast profile-lock-state-changed
  // (see feature107/feature125's identical use of this same refresh step).
  const created = await invoke(browser, "create_profile", { name: "Sam" });
  assert.equal(created.error, undefined, `creating the second profile failed: ${JSON.stringify(created)}`);
  await browser.refresh();
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await dismissFirstLaunchDialogs(browser);

  // 6. The second profile must start with none of the first profile's UI state or rendered content —
  // no bleed across profiles, on top of no survival past a lock.
  const samLayout = await invoke(browser, "get_profile_ui_state", { key: "dashboard_layout" });
  assert.equal(samLayout.ok, null, `a brand-new second profile must not inherit the first profile's dashboard layout, got ${JSON.stringify(samLayout)}`);
  const samFilters = await invoke(browser, "get_profile_ui_state", { key: "saved_filters" });
  assert.equal(samFilters.ok, null, `a brand-new second profile must not inherit the first profile's saved filters, got ${JSON.stringify(samFilters)}`);
  assertNoSecrets(await domText(browser), "the DOM under the second profile");
  assertNoSecrets(await localStorageDump(browser), "localStorage under the second profile");

  // 7. Unlocking the first profile again must bring its own data back intact — the lock only hid it,
  // it never lost or corrupted anything.
  const profiles = await invoke(browser, "list_profiles");
  const alex = profiles.ok.find((p) => p.name !== "Sam").id;
  await invoke(browser, "select_profile", { id: alex });
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  const unlocked = await invoke(browser, "unlock_profile", { id: alex, password: PASSWORD });
  assert.equal(unlocked.error, undefined, `unlocking the first profile again failed: ${JSON.stringify(unlocked)}`);
  const restoredLayout = await invoke(browser, "get_profile_ui_state", { key: "dashboard_layout" });
  assert.match(restoredLayout.ok ?? "", new RegExp(INVESTMENT_NAME), "the first profile's own dashboard layout must survive an unlock unchanged");
} finally {
  await app.close();
}

console.log("FEATURE 127 E2E TEST PASSED");
