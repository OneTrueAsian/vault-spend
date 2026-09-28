// Phase E Task 7: the housekeeping that used to run from the page (monthly rollover, automatic
// sinking-fund contributions, today's portfolio point) now runs in the backend as a profile opens or
// unlocks, and the live-price refresh timer belongs to the mounted app, so it stops at a lock and
// comes back after an unlock. Proves, against the compiled app: a locked profile refuses the
// housekeeping hand-off; restoring a backup and moving the data file also run the month's
// housekeeping on the data that becomes live; unlocking runs the month's contribution exactly once and
// the page shows its one-time note; unlocking again neither repeats the contribution nor the note;
// and the live-price interval is gone while locked and running again after unlocking, with no
// refresh sent meanwhile.
//
// Run with: node e2e/feature126_unlock_maintenance.mjs
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";
const REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;

const app = await launchApp();
try {
  const { browser } = app;
  async function invoke(command, args = {}) {
    return browser.executeAsync((command, args, done) => {
      window.__TAURI_INTERNALS__.invoke(command, args).then(
        (value) => done({ value }),
        (error) => done({ error: String(error) }),
      );
    }, command, args);
  }
  async function invokeOk(command, args = {}) {
    const result = await invoke(command, args);
    assert.equal(result.error, undefined, `${command}: ${result.error}`);
    return result.value;
  }
  const probe = () => browser.execute(() => ({
    timers: window.__vsProbe.timers.size,
    calls: [...window.__vsProbe.calls],
    notes: [...window.__vsProbe.notes],
  }));
  const savedAmountOf = async (name) => Number((await invokeOk("list_buckets")).find((b) => b.name === name).saved_amount);
  const savedAmount = () => savedAmountOf("Roof");
  const newGoal = (name, sinkingAmount) =>
    invokeOk("create_bucket", { name, targetAmount: null, targetDate: null, accountId: null, sinkingAmount, color: null, iconKey: null });

  // Swapping in a restored backup or a moved data file is another way a profile's data becomes live,
  // and the page that used to run the housekeeping when it remounted is no longer the one to do it. A
  // goal created from outside the page isn't contributed to until the profile next opens, so the
  // backup below holds it at zero; the contribution must land as part of the restore / the move.
  await newGoal("Garage", "25.00");
  const backup = await invokeOk("create_backup_now");
  assert.equal(await savedAmountOf("Garage"), 0, "creating the goal from outside the page must not contribute by itself");
  await invokeOk("restore_backup", { filename: backup.filename, password: null, expectedGeneration: await invokeOk("get_current_generation") });
  assert.equal(await savedAmountOf("Garage"), 25, "restoring a backup runs this month's contribution on the restored data");
  const afterRestore = await invokeOk("take_maintenance_summary");
  assert.deepEqual(afterRestore.contributions.map((c) => c.bucket_name), ["Garage"], "and keeps the one-time note for the page");
  assert.deepEqual((await invokeOk("take_maintenance_summary")).contributions, [], "which is handed over only once");

  await newGoal("Fence", "10.00");
  assert.equal(await savedAmountOf("Fence"), 0);
  await invokeOk("relocate_data_file", { newDir: path.join(os.tmpdir(), `vaultspend-feature126-${process.pid}-${Date.now()}`) });
  assert.equal(await savedAmountOf("Fence"), 10, "moving the data file runs this month's contribution on the moved data");
  assert.deepEqual((await invokeOk("take_maintenance_summary")).contributions.map((c) => c.bucket_name), ["Fence"]);

  await (await browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(browser, PASSWORD);
  await browser.waitUntil(async () => (await browser.$(".page").getText()).includes("Password protection: On"), {
    timeout: 10000,
    timeoutMsg: "expected Password protection: On after finishing setup",
  });

  // Watch what the page does: which repeating timers it holds, which commands it sends, and every
  // status note it shows. All of it survives the app tree being torn down and rebuilt, because the
  // window itself is never reloaded.
  await browser.execute((interval) => {
    const probe = { timers: new Set(), calls: [], notes: [] };
    window.__vsProbe = probe;
    const setTimer = window.setInterval.bind(window);
    const clearTimer = window.clearInterval.bind(window);
    window.setInterval = (fn, ms, ...rest) => {
      const id = setTimer(fn, ms, ...rest);
      if (ms === interval) probe.timers.add(id);
      return id;
    };
    window.clearInterval = (id) => {
      probe.timers.delete(id);
      return clearTimer(id);
    };
    const send = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.startsWith("http://ipc.localhost/")) probe.calls.push(decodeURIComponent(new URL(url).pathname.slice(1)));
      return send(input, init);
    };
    new MutationObserver(() => {
      for (const el of document.querySelectorAll(".status-text")) {
        const text = el.textContent;
        if (text && probe.notes[probe.notes.length - 1] !== text) probe.notes.push(text);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, REFRESH_INTERVAL_MS);

  // Turning live prices on starts the app's refresh timer and refreshes once (no holdings, so no
  // network request goes anywhere).
  const card = await browser.$("//div[contains(@class,'card')][.//span[text()='Live stock prices']]");
  await card.waitForExist({ timeout: 10000 });
  await (await card.$("input[type='password']")).setValue("demo-test-key");
  await (await card.$("button*=Save")).click();
  await browser.waitUntil(async () => (await probe()).timers === 1, { timeout: 10000, timeoutMsg: "expected the live-price timer to start once enabled" });
  await browser.waitUntil(async () => (await probe()).calls.includes("refresh_live_prices"), {
    timeout: 10000,
    timeoutMsg: "expected an immediate live-price refresh once enabled",
  });

  // A goal that adds a fixed amount every month. Nothing applies it until the profile next opens.
  await invokeOk("create_bucket", { name: "Roof", targetAmount: null, targetDate: null, accountId: null, sinkingAmount: "50.00", color: null, iconKey: null });
  assert.equal(await savedAmount(), 0, "creating the goal from outside the page must not contribute by itself");

  async function lockThroughTheApp() {
    await (await browser.$(".profile-switcher-toggle")).click();
    await (await browser.$("[data-profile-switcher-lock]")).click();
    await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  }
  async function unlockThroughTheApp() {
    await (await browser.$("#password-form-field")).setValue(PASSWORD);
    await (await browser.$("button[type='submit']")).click();
    await browser.$(".brand-word").waitForExist({ timeout: 15000 });
  }

  await lockThroughTheApp();
  assert.equal((await probe()).timers, 0, "the live-price timer must be cleared when the app tree unmounts at a lock");
  const refused = await invoke("take_maintenance_summary");
  assert.ok(refused.error?.startsWith("PROFILE_LOCKED"), `a locked profile must refuse the housekeeping hand-off, got ${JSON.stringify(refused)}`);
  await browser.execute(() => {
    window.__vsProbe.calls.length = 0;
    window.__vsProbe.notes.length = 0;
  });
  await browser.pause(1500);
  assert.ok(!(await probe()).calls.includes("refresh_live_prices"), "no live-price refresh may be sent while locked");

  await unlockThroughTheApp();
  await browser.waitUntil(async () => (await probe()).notes.some((n) => n.includes("automatic contribution for 1 bucket(s): Roof")), {
    timeout: 10000,
    timeoutMsg: `expected the one-time contribution note after unlocking, saw ${JSON.stringify(await probe())}`,
  });
  assert.equal(await savedAmount(), 50, "unlocking runs this month's contribution once");
  await browser.waitUntil(async () => (await probe()).timers === 1, { timeout: 10000, timeoutMsg: "expected the live-price timer back after unlocking" });
  await browser.waitUntil(async () => (await probe()).calls.includes("refresh_live_prices"), {
    timeout: 10000,
    timeoutMsg: "expected the live-price refresh to run again after unlocking",
  });
  assert.equal((await probe()).calls.filter((c) => c === "take_maintenance_summary").length, 1, "the page reads the housekeeping result exactly once per open");

  // The second time this month there is nothing to do and nothing to say.
  await lockThroughTheApp();
  assert.equal((await probe()).timers, 0);
  await browser.execute(() => {
    window.__vsProbe.notes.length = 0;
  });
  await unlockThroughTheApp();
  await browser.waitUntil(async () => (await probe()).timers === 1, { timeout: 10000, timeoutMsg: "expected the live-price timer back after the second unlock" });
  await browser.pause(1500);
  assert.equal(await savedAmount(), 50, "a second unlock in the same month must not contribute again");
  const notes = (await probe()).notes;
  assert.ok(!notes.some((n) => /automatic contribution|Rolled forward/.test(n)), `a repeat unlock must not repeat the one-time notes, saw ${JSON.stringify(notes)}`);
} finally {
  await app.close();
}
console.log("FEATURE 126 E2E TEST PASSED");
