// E2E coverage for the profile selector (Phase C, Task 9): a fresh install with no registry never
// shows it; a real registry does, as a plain list up to three profiles and a drop-down at four or
// more; the last-used profile is pre-selected; an empty registry (every profile deleted) offers the
// create-a-profile escape instead of inventing a Default.
//
// Run with: node e2e/feature101_profile_selector.mjs

import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { seedProfiles } from "./lib/protection.mjs";

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

// 3. Four profiles: a drop-down, not a list.
{
  const dbDir = await seedProfiles([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }]);
  const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
  try {
    assert.ok(await app.browser.$("#profile-selector-dropdown").isExisting());
    assert.equal((await app.browser.$$("[data-profile-option]")).length, 0, "no per-option buttons in dropdown mode");
    // One command at a time on this session — issuing several `getText()` calls at once via
    // Promise.all against the same WebDriver session (rather than one after another) reliably
    // closes the connection under this harness (wry's WebDriver automation), a real pitfall found
    // while writing this spec, not specific to this one assertion.
    const optionTexts = [];
    for (const option of await app.browser.$$("#profile-selector-dropdown option")) {
      optionTexts.push(await option.getText());
    }
    assert.deepEqual(optionTexts.sort(), ["A", "B", "C", "D"]);
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

console.log("FEATURE 101 E2E TEST PASSED");
