// Task 8 (Phase D): CSV export warning for a password-protected profile, driven through the real
// compiled app. The warning dialog and its jsdom tests predate this spec (Phase C, `c2a06e4`); what
// nothing covered until now is the App-level routing — that each of the two data-bearing exports
// (Transactions CSV, Reports CSV) asks BEFORE the native save picker opens, only when the active
// profile is protected, and every single time. The static setup-template download reads no
// profile data, so it must keep going straight to the picker, with no warning.
//
// A native Save dialog is a real Win32 common dialog WebDriver can't drive (see feature7's note),
// so this spec intercepts the picker's IPC request in the page. The obvious seam —
// `window.__TAURI_INTERNALS__.invoke` — is unusable: Tauri defines it (and `ipc`, `postMessage`) with
// `Object.defineProperty(..., { value })`, i.e. non-writable and non-configurable, so an assignment
// silently keeps the original. Below those, though, `sendIpcMessage` (tauri's scripts/ipc-protocol.js,
// the default brownfield pattern) sends every command with a bare `fetch()` to
// `http://ipc.localhost/<encodeURIComponent(cmd)>`, and that global IS looked up at call time and IS
// writable. So `window.fetch` is wrapped: a `plugin:dialog|save` request is recorded and answered
// with the same `Tauri-Response: ok` / `application/json` / `null` reply the real handler gives when
// the user cancels the picker — no file is ever written. Every other request passes straight through.
//
// Run with: node e2e/feature119_csv_export_warning.mjs

import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { enableProtectionThroughUI, seedPopulatedProfile } from "./lib/protection.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";

const PASSWORD = "correct horse battery staple";
const WARNING_TITLE = "Export as CSV?";
const WARNING_TEXT = "CSV files are not password protected. Anyone who can open the exported file can read this data.";
const TRANSACTIONS_FILE = /^transactions-export-\d{4}-\d{2}-\d{2}\.csv$/;
const REPORTS_FILE = /^reports-export-\d{4}-\d{2}-\d{2}\.csv$/;
const SETUP_TEMPLATE_FILE = "vaultspend-setup-template.csv";

const testDbDir = freshTestDbDir();
await seedPopulatedProfile(testDbDir);

const app = await launchApp({ dbDir: testDbDir });
const { browser } = app;

async function installSaveInterceptor() {
  await browser.execute(() => {
    const original = window.fetch;
    const state = { calls: [], commands: [], original };
    window.fetch = function (input, init) {
      let command = null;
      try {
        const url = new URL(typeof input === "string" ? input : (input?.url ?? String(input)));
        if (url.hostname === "ipc.localhost") command = decodeURIComponent(url.pathname.slice(1));
      } catch {
        /* not a URL we can parse — not IPC */
      }
      if (command !== null) state.commands.push(command);
      if (command === "plugin:dialog|save") {
        let options = null;
        try {
          options = JSON.parse(init?.body)?.options ?? null;
        } catch {
          /* body wasn't JSON — leave options null and let the spec's assertions report it */
        }
        state.calls.push({ defaultPath: options?.defaultPath ?? null });
        return Promise.resolve(
          new Response("null", { status: 200, headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }),
        );
      }
      // A failed IPC fetch would switch Tauri to postMessage for good, past this wrapper, and the next
      // Export would open the real save dialog and hang the spec: retry it first (see stubFilePicker
      // in harness.mjs).
      if (command === null) return original.apply(window, arguments);
      const args = arguments;
      const attempt = (left) =>
        original.apply(window, args).catch((e) => (left > 0 ? new Promise((r) => setTimeout(r, 150)).then(() => attempt(left - 1)) : Promise.reject(e)));
      return attempt(5);
    };
    window.__saveIntercept = state;
  });
  // Pre-flight, with a harmless read-only command: prove the wrapper really sees Tauri's IPC
  // traffic. If it didn't (a different IPC transport, or the isolation pattern moving `fetch` into
  // an iframe), the first Export CSV click would open a REAL native dialog and hang the spec —
  // so find that out here, before any click that could.
  await browser.executeAsync((done) => {
    window.__TAURI_INTERNALS__.invoke("get_data_file_location").then(
      () => done(true),
      () => done(false),
    );
  });
  const seen = await browser.execute(() => window.__saveIntercept.commands);
  assert.ok(
    seen.includes("get_data_file_location"),
    `the fetch wrapper never saw a Tauri IPC call (saw: ${JSON.stringify(seen)}) — refusing to click anything that could open a native dialog`,
  );
}

async function restoreFetch() {
  await browser
    .execute(() => {
      if (window.__saveIntercept) window.fetch = window.__saveIntercept.original;
    })
    .catch(() => {});
}

async function saveCalls() {
  const calls = await browser.execute(() => window.__saveIntercept?.calls ?? null);
  assert.ok(calls, "the save-picker interceptor is gone — the page must have reloaded mid-spec");
  return calls;
}

async function warningOpen() {
  return browser.$(".modal-panel").isExisting();
}

// After a gesture that should either open the in-app warning or go straight to the picker, wait
// for whichever happens first. Waiting for EITHER means a missing warning fails on the assertion
// below with a message naming the real problem, instead of a bare "modal never appeared" timeout.
async function settleAfterExport(savesBefore) {
  await browser.waitUntil(async () => (await warningOpen()) || (await saveCalls()).length > savesBefore, {
    timeout: 10000,
    timeoutMsg: "clicking Export CSV neither opened the warning nor reached the save picker",
  });
}

async function openLedgerExport() {
  await (await browser.$("button*=Transactions")).click();
  const toggle = await browser.$(".more-menu button");
  await toggle.waitForExist({ timeout: 10000 });
  await toggle.click();
  const item = await browser.$("button*=Export CSV");
  await item.waitForExist({ timeout: 10000 });
  await item.click();
}

async function openReportsExport() {
  await (await browser.$("button*=Reports")).click();
  const button = await browser.$("button*=Export CSV");
  await button.waitForExist({ timeout: 10000 });
  await button.click();
}

// Unprotected profile: no warning, straight to the picker, once, with the expected default name.
async function assertExportGoesStraightToPicker(open, filePattern, label) {
  const before = (await saveCalls()).length;
  await open();
  await settleAfterExport(before);
  const calls = await saveCalls();
  assert.equal(calls.length, before + 1, `${label}: expected exactly one save-picker call`);
  assert.match(calls[before].defaultPath, filePattern, `${label}: unexpected default file name`);
  assert.equal(await warningOpen(), false, `${label}: a warning appeared for a profile that isn't protected`);
}

// Protected profile: the warning is up, with the exact required wording, and the picker has NOT
// been opened yet.
async function assertWarningShownBeforePicker(open, label) {
  const before = (await saveCalls()).length;
  await open();
  await settleAfterExport(before);
  assert.equal(
    (await saveCalls()).length,
    before,
    `${label}: the save picker opened before the warning was answered (or without one)`,
  );
  assert.equal(await warningOpen(), true, `${label}: expected the CSV warning to be showing`);
  // The overlay fades in over 160ms, and WebDriver's getText reports '' for text that isn't visible
  // yet — wait for the rendered text, then assert on exactly what it settled to.
  await waitForPanelText(".modal-title", WARNING_TITLE, `${label}: wrong title`);
  await waitForPanelText(".modal-message", WARNING_TEXT, `${label}: wrong wording`);
  return before;
}

async function waitForPanelText(selector, expected, failureMessage) {
  let last = "";
  await browser
    .waitUntil(
      async () => {
        last = (await (await browser.$(".modal-panel")).$(selector).getText()).trim();
        return last === expected;
      },
      { timeout: 5000 },
    )
    .catch(() => {});
  assert.equal(last, expected, failureMessage);
}

async function clickWarningButton(name) {
  const button = await (await browser.$(".modal-panel")).$(`button=${name}`);
  await button.waitForClickable({ timeout: 5000, timeoutMsg: `the warning's "${name}" button never became clickable` });
  await button.click();
}

async function cancelWarning(savesBefore, label) {
  await clickWarningButton("Cancel");
  await browser.waitUntil(async () => !(await warningOpen()), { timeout: 5000, timeoutMsg: `${label}: Cancel didn't close the warning` });
  await browser.pause(200);
  assert.equal((await saveCalls()).length, savesBefore, `${label}: Cancel still opened the save picker`);
}

async function confirmWarning(savesBefore, filePattern, label) {
  await clickWarningButton("Export anyway");
  await browser.waitUntil(async () => (await saveCalls()).length > savesBefore, {
    timeout: 5000,
    timeoutMsg: `${label}: Export anyway never reached the save picker`,
  });
  await browser.pause(200);
  const calls = await saveCalls();
  assert.equal(calls.length, savesBefore + 1, `${label}: expected exactly one save-picker call after Export anyway`);
  assert.match(calls[savesBefore].defaultPath, filePattern, `${label}: unexpected default file name`);
  assert.equal(await warningOpen(), false, `${label}: the warning stayed open after Export anyway`);
}

try {
  await installSaveInterceptor();

  // Unprotected baseline: neither export asks anything.
  await assertExportGoesStraightToPicker(openLedgerExport, TRANSACTIONS_FILE, "unprotected Transactions CSV");
  await assertExportGoesStraightToPicker(openReportsExport, REPORTS_FILE, "unprotected Reports CSV");

  // Turn protection on through the real wizard and wait until the app shows it.
  await (await browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(browser, PASSWORD);
  await browser.waitUntil(async () => (await browser.$(".page").getText()).includes("Password protection: On"), {
    timeout: 10000,
    timeoutMsg: "expected Password protection: On after finishing setup",
  });

  // Protected Transactions CSV: ask first; Cancel never reaches the picker; Export anyway does, once.
  let before = await assertWarningShownBeforePicker(openLedgerExport, "protected Transactions CSV (cancel)");
  await cancelWarning(before, "protected Transactions CSV (cancel)");
  before = await assertWarningShownBeforePicker(openLedgerExport, "protected Transactions CSV (confirm)");
  await confirmWarning(before, TRANSACTIONS_FILE, "protected Transactions CSV (confirm)");
  // §4.11: no "remember my choice" — the next export asks again even right after confirming.
  before = await assertWarningShownBeforePicker(openLedgerExport, "protected Transactions CSV (asks every time)");
  await cancelWarning(before, "protected Transactions CSV (asks every time)");

  // Protected Reports CSV: the second call site, checked on its own rather than assumed.
  before = await assertWarningShownBeforePicker(openReportsExport, "protected Reports CSV (cancel)");
  await cancelWarning(before, "protected Reports CSV (cancel)");
  before = await assertWarningShownBeforePicker(openReportsExport, "protected Reports CSV (confirm)");
  await confirmWarning(before, REPORTS_FILE, "protected Reports CSV (confirm)");
  before = await assertWarningShownBeforePicker(openReportsExport, "protected Reports CSV (asks every time)");
  await cancelWarning(before, "protected Reports CSV (asks every time)");

  // The setup template is static instructions and example rows — no profile data — so even a
  // protected profile downloads it with no warning.
  await (await browser.$("button*=Settings")).click();
  const templateButton = await browser.$("button*=Download setup template");
  await templateButton.waitForExist({ timeout: 10000 });
  before = (await saveCalls()).length;
  await templateButton.click();
  await settleAfterExport(before);
  const calls = await saveCalls();
  assert.equal(calls.length, before + 1, "setup template: expected exactly one save-picker call");
  assert.equal(calls[before].defaultPath, SETUP_TEMPLATE_FILE, "setup template: unexpected default file name");
  assert.equal(await warningOpen(), false, "setup template: a CSV warning appeared for a file that holds no profile data");

  console.log("FEATURE 119 E2E TEST PASSED");
} finally {
  await restoreFetch();
  await app.close();
}
