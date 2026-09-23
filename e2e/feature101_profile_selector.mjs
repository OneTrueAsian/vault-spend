// E2E coverage for the profile selector (Phase C, Task 9; card-grid redesign + rename/delete/add in
// Task 10): a fresh install with no registry never shows it; a real registry does, as a card grid of
// any size (no drop-down mode); the last-used profile is pre-selected; an empty registry (every
// profile deleted) offers the create-a-profile escape instead of inventing a Default. Also covers the
// new inline Rename/Delete/Add-profile actions added directly to the selector, reusing the existing
// rename_profile/delete_profile/create_profile commands.
//
// Run with: node e2e/feature101_profile_selector.mjs

import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { seedProfiles } from "./lib/protection.mjs";

// A real WebView2/tauri-driver quirk, found writing this spec: `elementSendKeys` (what `.setValue()`
// uses) reliably fails with "element wasn't found" on an input that appears via a click-triggered
// re-render of an ALREADY-mounted parent (the rename/add-profile fields here), even though the same
// element is genuinely present, visible, focused and at real on-screen coordinates by every other
// check (`isExisting`, `isDisplayed`, a real bounding rect, `document.elementFromPoint` finding it) —
// confirmed by direct diagnosis, not assumed. Every other input this suite types into exists from its
// component's first paint; these are the first ones created by a later conditional render inside a
// screen that was already mounted. Setting the value directly (the same technique jsdom unit tests
// already use) works reliably; `browser.keys()` for Enter is unaffected since it targets whatever
// currently has focus at the session level, not a specific element lookup.
async function typeIntoFreshInput(browser, selector, value) {
  await browser.execute(
    (sel, val) => {
      const el = document.querySelector(sel);
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setValue.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    value,
  );
}

// 1. Fresh install: no registry at all, no selector.
{
  const app = await launchApp();
  try {
    assert.ok(await app.browser.$(".brand-word").isExisting(), "a fresh install opens straight into the app");
  } finally {
    await app.close();
  }
}

// 2. One profile registered: the selector still shows (a registry file existing is what matters,
// not how many entries it has).
{
  const dbDir = await seedProfiles([{ name: "Default" }]);
  const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
  try {
    const options = await app.browser.$$("[data-profile-option]");
    assert.equal(options.length, 1);
    assert.match(await options[0].getText(), /Default/);
  } finally {
    await app.close();
  }
}

// 3. Many profiles: still a card grid, no drop-down — a deliberate Task 10 simplification (cards
// wrap instead of switching representation at a threshold).
{
  const dbDir = await seedProfiles([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }, { name: "F" }]);
  const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
  try {
    assert.ok(!(await app.browser.$("select").isExisting()), "no drop-down at any profile count");
    const optionTexts = [];
    for (const option of await app.browser.$$("[data-profile-option]")) {
      optionTexts.push((await option.getText()).trim());
    }
    assert.deepEqual(optionTexts.sort(), ["A", "B", "C", "D", "E", "F"]);
  } finally {
    await app.close();
  }
}

// 4. The last-used profile is pre-selected (React's `autoFocus` calls `.focus()` imperatively — it
// never renders an `autofocus` DOM attribute, so `document.activeElement` is the only real signal).
{
  const dbDir = await seedProfiles([{ name: "Alex" }, { name: "Blair" }], { lastUsed: "Blair" });
  const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
  try {
    const activeText = await app.browser.execute(() => document.activeElement?.textContent ?? null);
    assert.match(activeText ?? "", /Blair/, "the last-used profile's button should start focused");
  } finally {
    await app.close();
  }
}

// 5. An empty registry (every profile deleted, none left) offers the create-unprotected escape
// rather than silently inventing a Default.
{
  const dbDir = await seedProfiles([]);
  const app = await launchApp({ dbDir, ready: "[data-empty-registry]" });
  try {
    assert.ok(await app.browser.$("[data-empty-registry]").isExisting());
    const nameInput = await app.browser.$("#empty-registry-name");
    await nameInput.setValue("Fresh Start");
    await (await app.browser.$("[data-create-profile]")).click();
    await app.browser.$(".brand-word").waitForExist({ timeout: 10000, timeoutMsg: "creating a profile from the empty-registry escape should open the app" });
  } finally {
    await app.close();
  }
}

// 6. Renaming a profile directly from the selector, without ever opening it.
{
  const dbDir = await seedProfiles([{ name: "Alex" }, { name: "Blair" }]);
  const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
  try {
    const { browser } = app;
    let renameBtn;
    for (const card of await browser.$$("[data-profile-card]")) {
      if ((await card.getText()).includes("Alex")) {
        renameBtn = await card.$("button=Rename");
        break;
      }
    }
    assert.ok(renameBtn, "expected a Rename button on Alex's card");
    await renameBtn.click();
    await browser.$(".profile-card-editing input").waitForExist({ timeout: 5000 });
    await typeIntoFreshInput(browser, ".profile-card-editing input", "Alexandra");
    await browser.keys("Enter");
    await browser.waitUntil(async () => {
      const options = await browser.$$("[data-profile-option]");
      for (const o of options) if ((await o.getText()).includes("Alexandra")) return true;
      return false;
    }, { timeout: 5000, timeoutMsg: "expected the card to show the new name without leaving the selector" });
    assert.ok(await browser.$("[data-profile-selector]").isExisting(), "renaming should not navigate away from the selector");
  } finally {
    await app.close();
  }
}

// 7. Deleting a profile directly from the selector needs a second click to confirm.
{
  const dbDir = await seedProfiles([{ name: "Alex" }, { name: "Blair" }]);
  const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
  try {
    const { browser } = app;
    async function deleteBtnForBlair() {
      for (const card of await browser.$$("[data-profile-card]")) {
        if ((await card.getText()).includes("Blair")) return card.$("button=Delete");
      }
      return null;
    }
    await (await deleteBtnForBlair()).click();
    assert.equal((await browser.$$("[data-profile-option]")).length, 2, "one click alone must not delete anything");
    await (await deleteBtnForBlair()).click();
    await browser.waitUntil(async () => (await browser.$$("[data-profile-option]")).length === 1, {
      timeout: 5000,
      timeoutMsg: "expected Blair's card to be gone after the confirming click",
    });
  } finally {
    await app.close();
  }
}

// 8. Adding a brand-new profile from the selector's "+" tile opens it directly, the same as the
// empty-registry escape.
{
  const dbDir = await seedProfiles([{ name: "Alex" }]);
  const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
  try {
    const { browser } = app;
    await (await browser.$("[data-add-profile]")).click();
    await browser.$(".profile-card-new-form input").waitForExist({ timeout: 5000 });
    await typeIntoFreshInput(browser, ".profile-card-new-form input", "Casey");
    await browser.keys("Enter");
    await browser.$(".brand-word").waitForExist({ timeout: 10000, timeoutMsg: "adding a profile from the selector should open it" });
  } finally {
    await app.close();
  }
}

console.log("FEATURE 101 E2E TEST PASSED");
