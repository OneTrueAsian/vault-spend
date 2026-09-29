// Fresh-context code review (2026-09-29) of release-1.2.8 found a Critical bug: `relocate_data_
// file`, `restore_backup`, and the `.vaultspend` package-import branch of `add_existing_profile`
// all hot-swap the live database and bump `AppPaths::generation` (same as `startup::activate`), but
// — unlike `activate` — never call `auto_lock::arm_current_profile`. The lock timer stays armed
// with the profile/generation identity from *before* the swap, so every subsequent lock attempt
// (inactivity, tray-hide, focus-loss, Windows lock/suspend) is rejected at `transition_runtime`'s
// generation check. Net effect: relocating the data file, restoring a backup, or importing a
// `.vaultspend` package on a protected profile silently and permanently disables automatic locking
// for the rest of that session — no error is shown to the user, and the countdown banner still
// counts to zero and does nothing.
//
// This proves the user-visible symptom directly (the lock screen never appears after each swap,
// exactly as a real tray-hide would fail to lock), not just the internal generation-mismatch error,
// across all three affected call sites in a single session.
//
// Run with: node e2e/run-all.mjs --spec=133

import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { enableProtectionThroughUI, seedPopulatedProfile } from "./lib/protection.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";

const PASSWORD = "correct horse battery staple";

async function invoke(browser, command, args = {}) {
  return browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then(
      (value) => done({ ok: value }),
      (error) => done({ error: String(error) }),
    );
  }, command, args);
}

async function invokeOk(browser, command, args = {}) {
  const result = await invoke(browser, command, args);
  assert.equal(result.error, undefined, `${command} failed: ${result.error}`);
  return result.ok;
}

// After triggering a lock, either the lock screen appears (the swap correctly re-armed the timer)
// or it doesn't within the timeout (the bug this test targets). Returns which happened, instead of
// throwing, so both the RED and GREEN calling code can assert on it explicitly.
async function lockScreenAppearedAfterTrigger(browser, trigger) {
  await invoke(browser, "debug_apply_window_lock_trigger", { trigger });
  try {
    await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function unlockCurrentlyLockedProfile(browser, password) {
  const state = await invokeOk(browser, "get_startup_state");
  assert.equal(state.status, "locked", `expected the profile to be locked before unlocking, got: ${JSON.stringify(state)}`);
  const unlocked = await invoke(browser, "unlock_profile", { id: state.profile_id, password });
  assert.equal(unlocked.error, undefined, `unlock should succeed: ${unlocked.error}`);
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 5000, reverse: true });
}

const testDbDir = freshTestDbDir();
await seedPopulatedProfile(testDbDir);
const app = await launchApp({ dbDir: testDbDir });

try {
  const { browser } = app;
  await (await browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(browser, PASSWORD);
  await browser.$("button=Change password…").waitForExist({ timeout: 15000 });

  const defaults = await invokeOk(browser, "get_auto_lock_settings");
  assert.equal(defaults.lock_when_hidden, true, "fixture assumption: tray-hide locking is on by default");

  // --- relocate_data_file ---
  const relocatedDir = `${testDbDir}-relocated`;
  await invokeOk(browser, "relocate_data_file", { newDir: relocatedDir });
  assert.equal(
    await lockScreenAppearedAfterTrigger(browser, "hidden_to_tray"),
    true,
    "hiding to the tray right after relocating the data file should still lock the profile",
  );
  await unlockCurrentlyLockedProfile(browser, PASSWORD);

  // --- restore_backup ---
  // Unlocking returns to whichever tab was active before the lock screen appeared, which is not
  // guaranteed to still be Settings once the app remounts fresh.
  await (await browser.$("button*=Settings")).click();
  await browser.$("button=Back up now").waitForExist({ timeout: 10000 });
  const beforeBackups = await invokeOk(browser, "list_backups");
  await (await browser.$("button=Back up now")).click();
  await browser.waitUntil(
    async () => (await invokeOk(browser, "list_backups")).length > beforeBackups.length,
    { timeout: 15000, timeoutMsg: "Back up now should add a protected backup" },
  );
  const newestBackup = (await invokeOk(browser, "list_backups")).find((b) => !beforeBackups.some((old) => old.filename === b.filename));
  const generationBeforeRestore = await invokeOk(browser, "get_current_generation");
  await invokeOk(browser, "restore_backup", { filename: newestBackup.filename, password: PASSWORD, expectedGeneration: generationBeforeRestore });
  assert.equal(
    await lockScreenAppearedAfterTrigger(browser, "hidden_to_tray"),
    true,
    "hiding to the tray right after restoring a backup should still lock the profile",
  );
  await unlockCurrentlyLockedProfile(browser, PASSWORD);

  // --- add_existing_profile (.vaultspend package import) ---
  const packagePath = `${testDbDir}-package.vaultspend`;
  await invokeOk(browser, "export_database", { destination: packagePath });
  const generationBeforeImport = await invokeOk(browser, "get_current_generation");
  await invokeOk(browser, "add_existing_profile", {
    name: "Imported protected profile",
    dbPath: packagePath,
    password: PASSWORD,
    expectedGeneration: generationBeforeImport,
  });
  assert.equal(
    await lockScreenAppearedAfterTrigger(browser, "hidden_to_tray"),
    true,
    "hiding to the tray right after importing a .vaultspend package should lock the newly imported protected profile",
  );

  console.log("FEATURE 133 E2E TEST PASSED");
} finally {
  await app.close();
}
