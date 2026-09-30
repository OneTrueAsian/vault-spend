// The Dashboard layout is loaded from the profile's own storage after the app mounts (Phase E,
// Task 8). If that read is slow and the person edits the layout first, the late answer must not
// overwrite what they just did: their edit has to stay on screen and stay saved. The slow read is
// made deterministic by delaying only the RESPONSE of the layout read (the backend still answers
// from what was stored when it was asked), installed on the profile selector before the app mounts.
//
// Run with: node e2e/run-all.mjs --spec=132

import assert from "node:assert/strict";
import { dismissFirstLaunchDialogs, launchApp } from "./harness.mjs";
import { seedProfiles } from "./lib/protection.mjs";

async function invoke(browser, command, args = {}) {
  return browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ error: String(e) }));
  }, command, args);
}

const dbDir = await seedProfiles([{ name: "Alex" }, { name: "Blair" }]);
const READ_DELAY_MS = 2500;

async function openFirstProfile(browser) {
  await (await browser.$("[data-profile-option]")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 15000 });
}

// Nothing is stored until the first edit is saved, so an unset layout reads as an empty list.
const persistedLayout = async (browser) => JSON.parse((await invoke(browser, "get_profile_ui_state", { key: "dashboard_layout" })) ?? "[]");

let widgetCountBefore;
let editedLayout;
{
  const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
  try {
    const { browser } = app;
    // Still on the selector: the app tree has not mounted yet, so nothing has asked for the layout.
    // Mark the welcome and What's New dialogs as seen first, so nothing covers the Dashboard when
    // the edit is made a moment after it mounts.
    await browser.executeAsync((done) => {
      window.__TAURI_INTERNALS__.invoke("plugin:app|version").then((version) => {
        localStorage.setItem("vaultspend-welcome-seen", "1");
        localStorage.setItem("vaultspend-last-seen-version", version);
        done();
      });
    });
    await browser.execute((delayMs) => {
      const realFetch = window.fetch.bind(window);
      window.__slowLayoutReads = 0;
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        let body = init?.body;
        if (body && typeof body !== "string") body = new TextDecoder().decode(body);
        const isLayoutRead = String(url).includes("get_profile_ui_state") && typeof body === "string" && body.includes('"dashboard_layout"');
        const response = await realFetch(input, init);
        if (isLayoutRead) {
          window.__slowLayoutReads += 1;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        return response;
      };
    }, READ_DELAY_MS);

    await openFirstProfile(browser);
    const customize = await (await browser.$(".dashboard-toolbar")).$("button*=Customize");
    await customize.waitForExist({ timeout: 10000 });
    await customize.click();
    const removeButtons = await browser.$$(".dashboard-widget-controls button:last-child");
    widgetCountBefore = removeButtons.length;
    assert.ok(widgetCountBefore > 4, "expected the default layout's widgets in Customize mode");
    await removeButtons[4].click(); // "runway", as in feature39

    assert.ok((await browser.execute(() => window.__slowLayoutReads)) >= 1, "the slow layout read should be in flight (else this proves nothing)");
    await browser.waitUntil(async () => !(await persistedLayout(browser)).includes("runway"), { timeout: 5000, timeoutMsg: "the edit should be saved" });
    editedLayout = await persistedLayout(browser);

    // Now let the slow (and stale) answer arrive, and give the page time to react to it.
    await browser.pause(READ_DELAY_MS + 1500);
    assert.equal(await browser.execute(() => document.querySelector(".layout-select-toggle").dataset.value), "custom", "the late load must not flip the layout back to Default");
    assert.equal((await browser.$$(".dashboard-widget-controls")).length, widgetCountBefore - 1, "the edited widget must stay removed on screen");
    assert.deepEqual(await persistedLayout(browser), editedLayout, "and the saved layout must be the edited one");
  } finally {
    await app.close();
  }
}

// The normal path still works: a fresh start reads the saved layout back.
{
  const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
  try {
    const { browser } = app;
    await openFirstProfile(browser);
    await browser.waitUntil(async () => (await browser.execute(() => document.querySelector(".layout-select-toggle")?.dataset.value)) === "custom", {
      timeout: 10000,
      timeoutMsg: "a normal start should read the saved layout back (the Layout dropdown shows Custom)",
    });
    assert.deepEqual(await persistedLayout(browser), editedLayout, "and nothing should have rewritten it");
    await dismissFirstLaunchDialogs(browser);
    await (await (await browser.$(".dashboard-toolbar")).$("button*=Customize")).click();
    await browser.pause(1500);
    const shown = (await browser.$$(".dashboard-widget-controls")).length;
    assert.equal(shown, widgetCountBefore - 1, "the saved layout has one widget fewer than the default");
  } finally {
    await app.close();
  }
}

console.log("FEATURE 132 E2E TEST PASSED");
