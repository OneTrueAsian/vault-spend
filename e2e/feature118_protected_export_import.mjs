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

  // A protected profile removed from the list ("forgot the password? remove it" or a plain Delete)
  // leaves exactly this shape on disk: an encrypted `.db` with its `.key` beside it, no manifest.
  // The lock screen's own wording says re-adding it with the right password should work. Get there
  // through `export_database` (the SQLite online-backup API, already safe against the live
  // connection — the same thing `packagePath` above used) rather than a raw filesystem copy of the
  // still-open live file, then pull the package's own `.db`/`.key` — by now finished, static files,
  // safe to copy plainly — out to a bare path with no manifest beside them.
  const secondPackagePath = path.join(testDbDir, "portable-profile-2.vaultspend");
  assert.equal((await invoke(browser, "export_database", { destination: secondPackagePath })).error, undefined);
  const recoveredCopyPath = path.join(testDbDir, "recovered-copy.db");
  fs.copyFileSync(path.join(secondPackagePath, "vaultspend.db"), recoveredCopyPath);
  fs.copyFileSync(path.join(secondPackagePath, "vaultspend.db.key"), `${recoveredCopyPath}.key`);

  const wrongPasswordAttempt = await invoke(browser, "add_existing_profile", {
    name: "Should not register",
    dbPath: recoveredCopyPath,
    password: "not the right password",
    expectedGeneration: await invoke(browser, "get_current_generation").then((r) => r.ok),
  });
  assert.match(wrongPasswordAttempt.error, /didn't work/, "a wrong password must not register anything");
  assert.ok(
    (await invoke(browser, "list_profiles")).ok.every((p) => p.name !== "Should not register"),
    "the failed attempt must not have registered a profile",
  );

  const recovered = await invoke(browser, "add_existing_profile", {
    name: "Recovered profile",
    dbPath: recoveredCopyPath,
    password: PASSWORD,
    expectedGeneration: await invoke(browser, "get_current_generation").then((r) => r.ok),
  });
  assert.equal(recovered.error, undefined, `re-adding a removed protected profile with its real password should work: ${recovered.error}`);
  assert.equal(recovered.ok, "Recovered profile");
  const recoveredProfile = (await invoke(browser, "list_profiles")).ok.find((p) => p.name === "Recovered profile");
  assert.equal(recoveredProfile?.is_active, true);
  assert.equal(recoveredProfile?.is_password_protected, true);
  assert.ok(
    (await invoke(browser, "list_transactions")).ok.some((row) => row.description === "Market Basket"),
    "the recovered profile's data should be intact",
  );
} finally {
  await app.close();
}

console.log("FEATURE 118 E2E TEST PASSED");
