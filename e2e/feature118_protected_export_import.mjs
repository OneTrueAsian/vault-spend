// Protected `.vaultspend` package round trip through the compiled app. Native save/folder pickers
// cannot be driven by WebDriver, so this invokes the same backend commands with paths inside the
// isolated test directory; Modal.test.tsx covers the source chooser and package-password UI.
// Run with: node e2e/run-all.mjs --spec=118

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { enableProtectionThroughUI, seedPopulatedProfile } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";

async function invoke(browser, command, args = {}) {
  return browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (error) => done({ error: String(error) }));
  }, command, args);
}

const testDbDir = freshTestDbDir();
await seedPopulatedProfile(testDbDir);
const app = await launchApp({ dbDir: testDbDir });

try {
  const { browser } = app;
  await (await browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(browser, PASSWORD);
  await browser.$("button=Change password…").waitForExist({ timeout: 15000 });

  const packagePath = path.join(testDbDir, "portable-profile.vaultspend");
  const exported = await invoke(browser, "export_database", { destination: packagePath });
  assert.equal(exported.error, undefined);
  assert.ok(fs.statSync(packagePath).isDirectory());
  assert.ok(fs.existsSync(path.join(packagePath, "manifest.json")));
  assert.ok(fs.existsSync(path.join(packagePath, "vaultspend.db")));
  assert.ok(fs.existsSync(path.join(packagePath, "vaultspend.db.key")));
  const manifest = JSON.parse(fs.readFileSync(path.join(packagePath, "manifest.json"), "utf8"));
  assert.equal(manifest.format, 1);
  assert.equal(manifest.protection_format, 1);
  assert.match(manifest.database_sha256, /^[a-f0-9]{64}$/);

  const expectedGeneration = (await invoke(browser, "get_current_generation")).ok;
  const imported = await invoke(browser, "add_existing_profile", {
    name: "Imported protected profile",
    dbPath: packagePath,
    password: PASSWORD,
    expectedGeneration,
  });
  assert.equal(imported.error, undefined);
  assert.equal(imported.ok, "Imported protected profile");

  const profiles = (await invoke(browser, "list_profiles")).ok;
  const importedProfile = profiles.find((profile) => profile.name === "Imported protected profile");
  assert.equal(importedProfile?.is_active, true);
  assert.equal(importedProfile?.is_password_protected, true);
  const transactions = (await invoke(browser, "list_transactions")).ok;
  assert.ok(transactions.some((row) => row.description === "Market Basket"), "imported data should survive the package round trip");

  const importedGeneration = (await invoke(browser, "get_current_generation")).ok;
  assert.equal((await invoke(browser, "verify_current_password", { password: PASSWORD, expectedGeneration: importedGeneration })).error, undefined);
  assert.match(
    (await invoke(browser, "verify_current_password", { password: "wrong password", expectedGeneration: importedGeneration })).error,
    /didn't work/,
  );
} finally {
  await app.close();
}

console.log("FEATURE 118 E2E TEST PASSED");
