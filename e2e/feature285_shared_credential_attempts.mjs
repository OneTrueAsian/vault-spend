import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";
import { invoke } from "./lib/change-password.mjs";

const app = await launchApp();
const b = app.browser;
const password = "shared policy correct password";
try {
  await b.$("button*=Settings").click();
  await enableProtectionThroughUI(b, password);
  await b.waitUntil(async () => (await b.$('.page').getText()).includes('Password protection: On'), { timeout: 10000 });
  const generation = (await invoke(b, 'get_current_generation')).ok;
  const profiles = (await invoke(b, 'list_profiles')).ok;
  const id = profiles.find(profile => profile.is_password_protected).id;
  for (const [command, args] of [
    ['verify_current_password', { password: 'wrong', expectedGeneration: generation }],
    ['begin_regenerate_recovery', { currentPassword: 'wrong', expectedGeneration: generation }],
    ['verify_recovery_code', { id, code: 'malformed recovery' }],
    ['remove_protection', { currentPassword: 'wrong', expectedGeneration: generation }],
  ]) assert.match((await invoke(b, command, args)).error, /didn't work/, command);
  assert.match((await invoke(b, 'verify_current_password', { password, expectedGeneration: generation })).error, /Try again/, 'a correct password cannot skip cooldown');
  assert.match((await invoke(b, 'begin_recovery', { id, code: 'malformed', newPassword: password, expectedGeneration: generation })).error, /Try again/, 'begin recovery cannot bypass the shared policy');
  await b.pause(2200);
  assert.equal((await invoke(b, 'verify_current_password', { password, expectedGeneration: generation })).error, undefined);
  assert.match((await invoke(b, 'verify_current_password', { password: 'wrong', expectedGeneration: generation })).error, /didn't work/, 'success resets failures');
  assert.match((await invoke(b, 'verify_current_password', { password, expectedGeneration: generation + 1 })).error, /changed/, 'stale generations cannot authorize sensitive operations');
  console.log("FEATURE 285 E2E TEST PASSED");
} finally { await app.close(); }
