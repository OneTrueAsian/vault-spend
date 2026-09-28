// E2E coverage for turning password protection on for an existing, populated profile, including a
// real process-kill at each side of the journal's boundary (Phase C, Task 9 — the highest-risk
// single operation in the whole feature): before ANY file is written, mid-conversion (after the
// backups convert but before the registry commits), and immediately after the registry commits.
// Covers the full spectrum of "nothing done / partially done / fully done" a kill can land on; the
// two intermediate failpoints not driven here (after_export, after_config_write) are the same
// recovery code path with a different exact set of files on disk, already proven at the pure-
// function level by protection_transition.rs's own unit tests — this file's job is proving the
// WHOLE pipeline (real UI, a real kill, a real relaunch) works at all, which the three scenarios
// below already span end to end.
//
// Run with: node e2e/feature103_enable_protection.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dismissFirstLaunchDialogs, launchApp } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { enableProtectionThroughUI, killAtFailpoint, seedPopulatedProfile } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";

async function invoke(browser, command, args = {}) {
  const result = await browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (e) => done({ error: String(e) }));
  }, command, args);
  return result;
}

async function pidOf(browser) {
  const result = await invoke(browser, "debug_process_id");
  assert.ok(!result.error, `debug_process_id should be available in a debug build, got ${JSON.stringify(result)}`);
  return result.ok;
}

async function killDuringEnableProtection(failpointName) {
  const testDbDir = freshTestDbDir();
  await seedPopulatedProfile(testDbDir);
  // `launchApp` spawns tauri-driver (and, as its child, the app) with a snapshot of `process.env`
  // taken at that exact call — set BEFORE launching, or the running app never sees it at all (a
  // real bug in this plan's own first-draft worked example, found by actually running it).
  process.env.VAULTSPEND_FAILPOINT = failpointName;
  let freshApp;
  try {
    freshApp = await launchApp({ dbDir: testDbDir });
  } finally {
    delete process.env.VAULTSPEND_FAILPOINT;
  }
  const { browser } = freshApp;
  await (await browser.$("button*=Settings")).click();
  const pid = await pidOf(browser);

  await killAtFailpoint(testDbDir, failpointName, pid, () => enableProtectionThroughUI(browser, PASSWORD));
  // The app process itself is gone, but tauri-driver (launchApp's own child, still running) is
  // not — close() still needs to be called to clean it up, exactly like a normal run; it's bounded
  // against exactly this "the app it was driving is dead" case (see harness.mjs's own doc comment).
  await freshApp.close();
  return testDbDir;
}

// 1. Killed before any file is written at all: nothing changed.
{
  const testDbDir = await killDuringEnableProtection("before_journal");

  assert.ok(!fs.existsSync(path.join(testDbDir, "protection-journal.json")), "no journal should exist — the kill landed before it was written");
  assert.ok(!fs.existsSync(path.join(testDbDir, "vaultspend-protected.db")), "no encrypted file should exist yet");

  const relaunched = await launchApp({ dbDir: testDbDir });
  try {
    assert.ok(await relaunched.browser.$(".brand-word").isExisting(), "the original plaintext profile should open normally, exactly as before the attempt");
    await (await relaunched.browser.$("button*=Transactions")).click();
    const ledgerText = await (await relaunched.browser.$(".page")).getText();
    assert.match(ledgerText, /Market Basket/, "the original data must be untouched");
  } finally {
    await relaunched.close();
  }
}

// 2. Killed mid-conversion (backups converted, registry not yet committed): the journal fully
// unwinds everything it owned, leaving the plaintext original exactly as it was.
{
  const testDbDir = await killDuringEnableProtection("after_backups");

  const relaunched = await launchApp({ dbDir: testDbDir });
  try {
    assert.ok(!fs.existsSync(path.join(testDbDir, "vaultspend-protected.db")), "a kill before the registry write should leave no orphaned encrypted file");
    assert.ok(await relaunched.browser.$(".brand-word").isExisting(), "the original plaintext profile opens normally, exactly as before the attempt");
    await (await relaunched.browser.$("button*=Transactions")).click();
    const ledgerText = await (await relaunched.browser.$(".page")).getText();
    assert.match(ledgerText, /Market Basket/, "the original data must be untouched");
  } finally {
    await relaunched.close();
  }
}

// 3. Killed immediately after the registry commits: recovery is a no-op (a committed target must
// never be deleted), and the profile opens as protected on relaunch, with all its data intact.
{
  const testDbDir = await killDuringEnableProtection("after_registry_write");

  assert.ok(fs.existsSync(path.join(testDbDir, "vaultspend-protected.db")), "the committed encrypted file must survive recovery");
  const relaunched = await launchApp({ dbDir: testDbDir, ready: "[data-profile-selector]" });
  try {
    const option = await relaunched.browser.$("[data-profile-option]");
    assert.match(await option.getText(), /🔒|Password protected/i, "the relaunch should offer the now-protected profile");
    await option.click();
    await relaunched.browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000, timeoutMsg: "the committed profile should come up locked" });
    await (await relaunched.browser.$("#password-form-field")).setValue(PASSWORD);
    await (await relaunched.browser.$("button[type='submit']")).click();
    await relaunched.browser.$(".brand-word").waitForExist({ timeout: 10000, timeoutMsg: "the recovery code's password should unlock the committed profile" });
    // This launch's `ready` was the selector, not `.brand-word`, so launchApp's own first-launch
    // dialog dismissal never ran — do it now that the app is actually showing, before the next click.
    await dismissFirstLaunchDialogs(relaunched.browser);
    await (await relaunched.browser.$("button*=Transactions")).click();
    const ledgerText = await (await relaunched.browser.$(".page")).getText();
    assert.match(ledgerText, /Market Basket/, "the converted data must be intact");
  } finally {
    await relaunched.close();
  }
}

console.log("FEATURE 103 E2E TEST PASSED");
