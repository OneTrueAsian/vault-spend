// E2E coverage for locking/unlocking a real protected profile (Phase C, Task 9): a correct password
// unlocks; a wrong one shows the message and re-tries at the documented delay after the 4th failure;
// a locked profile refuses to leak data through a direct backend call; the lock screen's "Switch
// profile" button (Task 10 finding) actually reaches the selector instead of re-showing itself; the
// sign-in redesign (Task 10) actually carries the app's standard entry-field styling, not a bare
// browser-default input.
//
// Run with: node e2e/feature102_profile_unlock_lock.mjs

import assert from "node:assert/strict";
import { dismissFirstLaunchDialogs, launchApp } from "./harness.mjs";
import { enableProtectionThroughUI, seedProfiles } from "./lib/protection.mjs";

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

  // Every lock-screen button keeps its label inside its box, in every style (a wider typeface
  // pushed "Forgot the password? Remove this profile from the list" past the edge).
  for (const palette of ["transparent", "futuristic", "retro"]) {
    // A style's typeface downloads the first time text uses it; measure once it has arrived.
    const spilling = await browser.executeAsync((p, done) => {
      document.documentElement.dataset.palette = p;
      const buttons = [...document.querySelectorAll("[data-profile-lock-screen] button")];
      const fonts = buttons.map((b) => {
        const cs = getComputedStyle(b);
        return document.fonts.load(`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, b.textContent);
      });
      Promise.all(fonts).then(() =>
        requestAnimationFrame(() => done(buttons.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()))),
      );
    }, palette);
    assert.deepEqual(spilling, [], `${palette}: lock-screen button labels spill out of their buttons`);
  }
  await browser.execute(() => (document.documentElement.dataset.palette = "transparent"));

  // The sign-in redesign (Task 10): the password field must actually carry the app's standard
  // entry-field styling (feature88's own convention — a real border, real radius, not the bare
  // browser-default box PasswordForm rendered before this phase's restyle).
  const fieldStyle = await browser.execute(() => {
    const el = document.getElementById("password-form-field");
    const cs = getComputedStyle(el);
    return { class: el.className, borderStyle: cs.borderTopStyle, borderRadius: cs.borderRadius };
  });
  assert.match(fieldStyle.class, /\btext-input\b/, `expected the password field to carry the standard text-input class, got "${fieldStyle.class}"`);
  assert.equal(fieldStyle.borderStyle, "solid", `expected a real border, got ${fieldStyle.borderStyle}`);
  assert.notEqual(fieldStyle.borderRadius, "0px", "expected a rounded field, not a square browser-default box");

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

// "Switch profile" on the lock screen (Task 10 finding, found by a real UAT walk, invisible to
// every jsdom/Rust unit test the same way every other Task 9 wiring gap was): it must actually reach
// the selector, not just re-report the same Locked state it started from — which is exactly what
// happened before `show_profile_selector` released the lock first. Needs a real registry (two
// profiles) so there is an actual selector, distinct from a single-profile launch's direct-open path.
{
  const dbDir = await seedProfiles([{ name: "Alex" }, { name: "Blair" }]);
  const app2 = await launchApp({ dbDir, ready: "[data-profile-selector]" });
  try {
    const { browser } = app2;
    const alex = await browser.$("[data-profile-option]"); // "Alex" sorts/lists first, opens unprotected
    assert.match(await alex.getText(), /Alex/);
    await alex.click();
    await browser.$(".brand-word").waitForExist({ timeout: 10000 });
    await dismissFirstLaunchDialogs(browser);

    await (await browser.$("button*=Settings")).click();
    await enableProtectionThroughUI(browser, PASSWORD);
    await browser.waitUntil(async () => (await browser.$(".page").getText()).includes("Password protection: On"), { timeout: 10000 });

    await (await browser.$(".profile-switcher-toggle")).click();
    await (await browser.$("[data-profile-switcher-lock]")).click();
    await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });

    await (await browser.$("[data-switch-profile]")).click();
    await browser.$("[data-profile-selector]").waitForExist({
      timeout: 10000,
      timeoutMsg: "Switch profile should reach the real selector, not re-show the same lock screen",
    });
    const options = [];
    for (const o of await browser.$$("[data-profile-option]")) options.push((await o.getText()).trim());
    assert.equal(options.length, 2, `expected both profiles offered, got ${JSON.stringify(options)}`);
    assert.ok(options.some((t) => /Alex/.test(t) && /🔒|protected/i.test(t)), `expected Alex to show as protected, got ${JSON.stringify(options)}`);
    assert.ok(options.some((t) => /Blair/.test(t)), `expected Blair still offered, got ${JSON.stringify(options)}`);
  } finally {
    await app2.close();
  }
}

console.log("FEATURE 102 E2E TEST PASSED");
