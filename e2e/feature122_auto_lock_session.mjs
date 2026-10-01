// Phase E Task 3: the managed inactivity timer warns without stealing keyboard focus, lets the
// user keep working, locks at expiry, unmounts in-progress UI state, and closes the backend data
// boundary. The clock seam used here exists only in debug builds.
import assert from "node:assert/strict";
import { launchApp, chooseMenuOption } from "./harness.mjs";
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

const app = await launchApp();
try {
  const { browser } = app;
  await (await browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(browser, PASSWORD);

  const minutes = await browser.$("[data-auto-lock-minutes]");
  await minutes.waitForEnabled({ timeout: 10000 });
  await chooseMenuOption(minutes, { value: "1" });
  await browser.waitUntil(async () => (await invoke(browser, "get_auto_lock_settings")).ok?.inactivity_minutes === 1, {
    timeout: 10000,
    timeoutMsg: "the one-minute automatic-lock choice should be saved before exercising the timer",
  });

  // Keep focus on the select while the backend raises its warning. The status must announce itself
  // without moving keyboard focus into the banner.
  await browser.execute(() => document.querySelector("[data-auto-lock-minutes]")?.focus());
  const warning = await invoke(browser, "debug_advance_auto_lock", { seconds: 50 });
  assert.deepEqual(warning, { ok: null }, `debug clock advance failed: ${JSON.stringify(warning)}`);
  const countdown = await browser.$("[data-auto-lock-countdown]");
  await countdown.waitForExist({ timeout: 5000 });
  assert.equal(await countdown.getAttribute("role"), "status");
  assert.equal(await countdown.getAttribute("aria-live"), "polite");
  // Raised with 10 seconds left, but it counts down in real time: on a loaded machine a second or more can
  // pass before it is read, so "9 seconds" is the same correct warning.
  assert.match(await countdown.getText(), /lock in ([7-9]|10) seconds/i);
  assert.equal(
    await browser.execute(() => document.activeElement?.getAttribute("data-auto-lock-minutes") !== null),
    true,
    "showing the warning must not steal keyboard focus",
  );
  await browser.waitUntil(async () => /lock in [1-9] seconds/i.test(await countdown.getText()), {
    timeout: 3000,
    timeoutMsg: "the visible warning should count down locally between backend ticks",
  });

  await (await browser.$("[data-stay-unlocked]")).click();
  await countdown.waitForExist({ reverse: true, timeout: 5000 });
  assert.equal((await invoke(browser, "get_startup_state")).ok?.status, "open", "Stay unlocked should cancel the pending lock");

  // Leave a draft in React state, then force the next idle deadline. StartupGate must remove the
  // entire app tree before showing the lock screen so that draft cannot remain in the locked DOM.
  await (await browser.$("button*=Transactions")).click();
  const search = await browser.$('input[aria-label="Search description"]');
  await search.waitForExist({ timeout: 5000 });
  await search.setValue("SENSITIVE-DRAFT-122");

  const expired = await invoke(browser, "debug_advance_auto_lock", { seconds: 60 });
  assert.deepEqual(expired, { ok: null }, `expiry clock advance failed: ${JSON.stringify(expired)}`);
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 5000 });
  assert.equal(
    await browser.execute(() => document.body.textContent.includes("SENSITIVE-DRAFT-122")),
    false,
    "locked DOM must not retain the in-progress transaction search",
  );

  const refused = await invoke(browser, "list_accounts");
  assert.ok(refused.error?.startsWith("PROFILE_LOCKED"), `data commands must fail closed after automatic lock: ${JSON.stringify(refused)}`);

  await (await browser.$("#password-form-field")).setValue(PASSWORD);
  await (await browser.$("button[type='submit']")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await (await browser.$("button*=Transactions")).click();
  const freshSearch = await browser.$('input[aria-label="Search description"]');
  await freshSearch.waitForExist({ timeout: 5000 });
  assert.equal(await freshSearch.getValue(), "", "unlocking should mount a fresh app tree with no stale draft");
} finally {
  await app.close();
}

console.log("FEATURE 122 E2E TEST PASSED");
