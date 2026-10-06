// The Dashboard layout is loaded from the profile's own storage after the app mounts (Phase E,
// Task 8). If that read is slow and the person edits the layout first, the late answer must not
// overwrite what they just did: their edit has to stay on screen and stay saved. The slow read is
// made deterministic by holding only the RESPONSE of the app's layout read (the backend still
// answers from what was stored when it was asked) until the edit is saved, installed on the profile
// selector before the app mounts. (A fixed 2.5 s hold once let the answer arrive first when opening
// the profile and making the edit took longer than that on a loaded machine.)
//
// Run with: node e2e/run-all.mjs --spec=132

import assert from "node:assert/strict";
import { chooseMenuOption, dismissFirstLaunchDialogs, launchApp } from "./harness.mjs";
import { seedProfiles } from "./lib/protection.mjs";

/** A command called straight from the page. It gives up after 10 s with a message naming the command,
 * rather than waiting out the driver's script limit: once, under a full parallel run, this spec sat
 * silent until the runner killed it at 60 s, after its second launch. */
async function invoke(browser, command, args = {}) {
  const result = await browser.executeAsync((command, args, done) => {
    const timer = setTimeout(() => done({ timedOut: true }), 10000);
    window.__TAURI_INTERNALS__.invoke(command, args).then(
      (value) => (clearTimeout(timer), done({ value })),
      (e) => (clearTimeout(timer), done({ error: String(e) })),
    );
  }, command, args);
  if (result.timedOut) throw new Error(`${command} got no answer within 10 s`);
  if (result.error !== undefined) throw new Error(`${command} failed: ${result.error}`);
  return result.value;
}

const dbDir = await seedProfiles([{ name: "Alex" }, { name: "Blair" }]);

async function openFirstProfile(browser) {
  await (await browser.$("[data-profile-option]")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 15000 });
}

// Nothing is stored until the first edit is saved, so an unset layout reads as an empty list. The
// extra `e2eProbe` argument (the command ignores it) lets the held-read wrapper below tell this
// spec's own reads from the app's.
const persistedLayout = async (browser) =>
  JSON.parse((await invoke(browser, "get_profile_ui_state", { key: "dashboard_layout", e2eProbe: true })) ?? "[]");

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
    await browser.execute(() => {
      const realFetch = window.fetch.bind(window);
      // Counted when asked and when handed to the app: "in flight" is asked but not yet delivered. (Counting
      // only once the backend had answered missed a read whose answer was itself slow under a loaded machine.)
      window.__layoutReadsAsked = 0;
      window.__layoutReadsDelivered = 0;
      // The app's layout answers wait here until the spec releases them, after the edit is saved.
      const held = [];
      window.__layoutReadsReleased = false;
      window.__releaseLayoutReads = () => {
        window.__layoutReadsReleased = true;
        held.splice(0).forEach((release) => release());
      };
      window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        let body = init?.body;
        if (body && typeof body !== "string") body = new TextDecoder().decode(body);
        const isLayoutRead =
          String(url).includes("get_profile_ui_state") && typeof body === "string" && body.includes('"dashboard_layout"') && !body.includes('"e2eProbe"');
        if (isLayoutRead) window.__layoutReadsAsked += 1;
        const response = await realFetch(input, init);
        if (isLayoutRead) {
          if (!window.__layoutReadsReleased) await new Promise((release) => held.push(release));
          window.__layoutReadsDelivered += 1;
        }
        return response;
      };
    });

    await openFirstProfile(browser);
    await chooseMenuOption(await browser.$(".layout-select-toggle"), { label: "Customize…" });
    await browser.waitUntil(async () => (await browser.$$(".dashboard-widget-controls")).length > 4, {
      timeout: 5000,
      timeoutMsg: "expected the default layout's widgets in Customize mode",
    });
    widgetCountBefore = (await browser.$$(".dashboard-widget-controls")).length;
    await (await browser.$('[data-widget-id="runway"] button[aria-label="Remove widget"]')).click(); // as in feature39

    const reads = await browser.execute(() => ({ asked: window.__layoutReadsAsked, delivered: window.__layoutReadsDelivered }));
    assert.ok(reads.asked >= 1 && reads.delivered === 0, `the slow layout read should be in flight (else this proves nothing): ${JSON.stringify(reads)}`);
    await browser.waitUntil(async () => !(await persistedLayout(browser)).includes("runway"), { timeout: 5000, timeoutMsg: "the edit should be saved" });
    editedLayout = await persistedLayout(browser);

    // Now let the slow (and stale) answer arrive, and give the page time to react to it.
    await browser.execute(() => window.__releaseLayoutReads());
    await browser.waitUntil(async () => browser.execute(() => window.__layoutReadsDelivered === window.__layoutReadsAsked), {
      timeout: 5000,
      timeoutMsg: "the held layout read should reach the app once released",
    });
    await browser.pause(1500);
    assert.equal(await browser.execute(() => document.querySelector(".layout-select-toggle").dataset.value), "custom", "the late load must not flip the layout back to Default");
    assert.equal((await browser.$$(".dashboard-widget-controls")).length, widgetCountBefore - 1, "the edited widget must stay removed on screen");
    assert.deepEqual(await persistedLayout(browser), editedLayout, "and the saved layout must be the edited one");
  } finally {
    await app.close();
  }
}

console.log("[feature132] the late layout read left the edit in place");

// The normal path still works: a fresh start reads the saved layout back.
{
  const app = await launchApp({ dbDir, ready: "[data-profile-selector]" });
  try {
    const { browser } = app;
    await openFirstProfile(browser);
    console.log("[feature132] second start: profile open");
    await browser.waitUntil(async () => (await browser.execute(() => document.querySelector(".layout-select-toggle")?.dataset.value)) === "custom", {
      timeout: 10000,
      timeoutMsg: "a normal start should read the saved layout back (the Layout dropdown shows Custom)",
    });
    assert.deepEqual(await persistedLayout(browser), editedLayout, "and nothing should have rewritten it");
    console.log("[feature132] second start: saved layout read back");
    await dismissFirstLaunchDialogs(browser);
    await chooseMenuOption(await browser.$(".layout-select-toggle"), { label: "Customize…" });
    let shown;
    await browser.waitUntil(async () => (shown = (await browser.$$(".dashboard-widget-controls")).length) === widgetCountBefore - 1, {
      timeout: 5000,
      timeoutMsg: () => `the saved layout has one widget fewer than the default (${widgetCountBefore - 1}), showed ${shown}`,
    });
  } finally {
    await app.close();
  }
}

console.log("FEATURE 132 E2E TEST PASSED");
