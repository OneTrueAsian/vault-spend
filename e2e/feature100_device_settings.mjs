// E2E test for Phase B of password protection: the tray, start-at-sign-in and second backup folder are
// settings of this computer, kept in device-settings.json beside the data, not in a profile's database.
//   - the first launch after the upgrade takes the old database values over (and the automatic
//     backup at launch is mirrored to that folder);
//   - a change made here is what the next launch sees, even though the database still holds the old
//     value (the old value must never come back);
//   - clearing the second folder stays cleared.
//
// Run with: node e2e/feature100_device_settings.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-device-copy-"));
const dbDir = await seedFixture(`
cur.execute("INSERT INTO app_settings (id, tray_enabled, backup_copy_dir) VALUES (1, 1, ?) ON CONFLICT(id) DO UPDATE SET tray_enabled = 1, backup_copy_dir = excluded.backup_copy_dir", (${JSON.stringify(copyDir)},))
`);
const deviceFile = path.join(dbDir, "device-settings.json");
const readDevice = () => JSON.parse(fs.readFileSync(deviceFile, "utf8"));

async function backend(browser, command, args = {}) {
  const result = await browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (e) => done({ error: String(e) }));
  }, command, args);
  if (result.error) throw new Error(`${command} failed: ${result.error}`);
  return result.ok;
}

let app = await launchApp({ dbDir });
try {
  const { browser } = app;
  // 1. The first launch takes the old values over.
  const settings = await backend(browser, "get_background_settings");
  if (settings.tray_enabled !== true) throw new Error(`the tray was on in the old database, so it should start on: ${JSON.stringify(settings)}`);
  const copy = await backend(browser, "get_backup_copy_dir");
  if (path.resolve(copy) !== path.resolve(copyDir)) throw new Error(`the second backup folder should carry over, got ${copy}`);
  const device = readDevice();
  if (device.tray_enabled !== true || device.tray_settings_migrated !== true || device.backup_mirror_dirs.default !== copyDir) {
    throw new Error(`device-settings.json should hold the taken-over values: ${JSON.stringify(device)}`);
  }
  const mirrored = fs.readdirSync(copyDir).filter((f) => /^vaultspend-.*\.db$/.test(f));
  if (mirrored.length !== 1) throw new Error(`the automatic backup at launch should have been copied to the second folder, found ${mirrored.length} files`);

  // 2. Turning the tray off here is saved on this computer.
  await browser.setWindowSize(1440, 1400);
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === "Settings") {
      await b.click();
      break;
    }
  }
  const card = await browser.$("[data-background-reminders]");
  await card.waitForExist({ timeout: 10000 });
  await card.scrollIntoView();
  const tray = await card.$("[data-tray-toggle]");
  if (!(await tray.isSelected())) throw new Error("the tray should show as on");
  await tray.click();
  await browser.waitUntil(async () => (await backend(browser, "get_background_settings")).tray_enabled === false, {
    timeout: 10000,
    timeoutMsg: "switching the tray off should be saved",
  });
  if (readDevice().tray_enabled !== false) throw new Error("the change should be written to device-settings.json");
} finally {
  await app.close();
}

// 3. A second launch on the same folder: the database still says "tray on", this computer's file wins.
app = await launchApp({ dbDir });
try {
  const { browser } = app;
  const settings = await backend(browser, "get_background_settings");
  if (settings.tray_enabled !== false) throw new Error(`the old database value must not come back: ${JSON.stringify(settings)}`);

  // 4. Stopping the second copy is per computer and sticks.
  await backend(browser, "set_backup_copy_dir", { dir: null });
  if ((await backend(browser, "get_backup_copy_dir")) !== null) throw new Error("the second folder should be cleared");
  if (Object.keys(readDevice().backup_mirror_dirs).length !== 0) throw new Error("the cleared folder should be gone from device-settings.json");
} finally {
  await app.close();
}

// 5. And the database's old folder does not come back on the next launch.
app = await launchApp({ dbDir });
try {
  if ((await backend(app.browser, "get_backup_copy_dir")) !== null) throw new Error("a cleared second folder must stay cleared");
} finally {
  await app.close();
}

console.log("FEATURE 100 E2E TEST PASSED");
