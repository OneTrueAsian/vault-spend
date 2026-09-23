// E2E coverage for creating a brand-new, already-protected profile (Phase C, Task 9), including a
// real process-kill after the encrypted file is written but before it's registered.
//
// Feature117 covers the normal profile-selector UI. This spec keeps using the backend directly so
// it can stop the process at the exact pre-registration failpoint and verify crash recovery.
//
// Run with: node e2e/feature104_create_protected_profile.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { killAtFailpoint } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";

async function invoke(browser, command, args = {}) {
  const result = await browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then((value) => done({ ok: value }), (e) => done({ error: String(e) }));
  }, command, args);
  return result;
}

// Fires the command without waiting for it to resolve — the point of `killAtFailpoint`'s `action`
// is only to START the operation the failpoint blocks inside; an `invoke()` that awaits the promise
// (as `invoke` above does) would itself hang forever waiting for a response that will never come.
async function fireAndForget(browser, command, args) {
  await browser.execute((command, args) => {
    window.__TAURI_INTERNALS__.invoke(command, args);
  }, command, args);
}

process.env.VAULTSPEND_FAILPOINT = "before_register";
let app;
try {
  app = await launchApp();
} finally {
  delete process.env.VAULTSPEND_FAILPOINT;
}
const { browser, testDbDir } = app;
const pidResult = await invoke(browser, "debug_process_id");
assert.ok(!pidResult.error, `debug_process_id should be available in a debug build, got ${JSON.stringify(pidResult)}`);
const pid = pidResult.ok;

const generation = (await invoke(browser, "get_current_generation")).ok;
const challenge = (await invoke(browser, "begin_protection_setup", { password: PASSWORD, expectedGeneration: generation })).ok;
const groups = challenge.recovery_display.split("-");
const answers = [groups[challenge.challenge_group_indices[0]], groups[challenge.challenge_group_indices[1]]];

await killAtFailpoint(testDbDir, "before_register", pid, () =>
  fireAndForget(browser, "commit_protection_setup", { token: challenge.token, answers, targetProfileId: null, newProfileName: "Sam" }),
);
await app.close();

assert.ok(!fs.existsSync(path.join(testDbDir, "profiles.json")), "a kill before registration must never create a registry entry");
const profilesDir = path.join(testDbDir, "profiles");
if (fs.existsSync(profilesDir)) {
  const orphans = fs.readdirSync(profilesDir).flatMap((id) => {
    const dbFile = path.join(profilesDir, id, "vaultspend.db");
    return fs.existsSync(dbFile) ? [dbFile] : [];
  });
  assert.equal(orphans.length, 1, `expected exactly one orphaned, never-registered encrypted file, found ${JSON.stringify(orphans)}`);
}

const relaunched = await launchApp({ dbDir: testDbDir });
try {
  assert.ok(await relaunched.browser.$(".brand-word").isExisting(), "the original (never touched) profile should open normally");
  assert.ok(!(await relaunched.browser.$("[data-profile-selector]").isExisting()), "no registry was ever created, so there is nothing to select between");
} finally {
  await relaunched.close();
}

console.log("FEATURE 104 E2E TEST PASSED");
