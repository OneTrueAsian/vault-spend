// E2E test for Phase 2 item 18 (tray icon + background bill reminders), the
// part a WebDriver session can see: Settings -> Background reminders is off by
// default, the tray switch saves to the backend (and creates/removes the real
// tray icon), and "start at sign-in" only opens up once the tray is on.
// It deliberately does NOT flip "start at sign-in" (that writes the machine's
// Run registry key) or send the test notification (a real OS toast).
//
// Run with: node e2e/feature82_background_reminders.mjs

import { launchApp } from "./harness.mjs";

const app = await launchApp();
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
async function backendSettings() {
  return browser.executeAsync((done) => {
    window.__TAURI_INTERNALS__.invoke("get_background_settings").then(done, (e) => done({ error: String(e) }));
  });
}

try {
  await browser.setWindowSize(1440, 1400);
  await nav("Settings");
  const card = await browser.$("[data-background-reminders]");
  await card.waitForExist({ timeout: 10000, timeoutMsg: "Settings should have a Background reminders section" });
  await card.scrollIntoView();

  const tray = await card.$("[data-tray-toggle]");
  const test = await card.$("[data-test-reminder]");
  if (!(await test.isExisting())) throw new Error("there should be a way to send a test reminder");
  if (await tray.isSelected()) throw new Error("background reminders start off");
  let saved = await backendSettings();
  if (saved.tray_enabled !== false) throw new Error(`the backend should agree it is off: ${JSON.stringify(saved)}`);

  const autostart = await card.$("[data-autostart-toggle]");
  const autostartShown = await autostart.isExisting();
  if (autostartShown && (await autostart.isEnabled())) throw new Error("start-at-sign-in needs the tray on first");

  // On.
  await tray.click();
  await browser.waitUntil(async () => (await backendSettings()).tray_enabled === true, { timeout: 10000, timeoutMsg: "switching the tray on should reach the backend" });
  // The app saves the switch, then reads the settings back before it redraws the box, so the backend can
  // already say "on" while the box has not caught up (a busy machine widens the gap): wait for the box.
  await browser.waitUntil(async () => (await tray.isSelected()) && (!autostartShown || (await autostart.isEnabled())), {
    timeout: 10000,
    timeoutMsg: "the box should show it's on, and start-at-sign-in should open up",
  });

  // Off again (leaves no tray icon behind).
  await tray.click();
  await browser.waitUntil(async () => (await backendSettings()).tray_enabled === false, { timeout: 10000, timeoutMsg: "switching the tray off should reach the backend" });
  await browser.waitUntil(async () => !(await tray.isSelected()), { timeout: 10000, timeoutMsg: "the box should show it's off" });

  console.log("FEATURE 82 E2E TEST PASSED");
} finally {
  await app.close();
}
