import assert from "node:assert/strict";
import { launchApp, withFocusRetry, openSettingsGroup } from "./harness.mjs";
import { enableProtectionThroughUI, PROTECTION_FINISH_MS } from "./lib/protection.mjs";
import { invoke } from "./lib/change-password.mjs";

// Opens the profile menu and clicks Lock profile through the page's own click event, waiting for each element to render first.
async function lockViaProfileMenu(b) {
  const toggle = await b.$('.profile-switcher-toggle');
  await toggle.waitForExist({ timeout: 10000, timeoutMsg: 'the profile menu button should be on the page' });
  await b.execute(el => el.click(), toggle);
  const lock = await b.$('[data-profile-switcher-lock]');
  await lock.waitForExist({ timeout: 10000, timeoutMsg: 'the profile menu should offer Lock profile' });
  await b.execute(el => el.click(), lock);
}

const app = await launchApp();
const b = app.browser;
try {
  await b.$("button*=Settings").click();
  await enableProtectionThroughUI(b, "manual confirmation password");
  await b.waitUntil(async () => (await b.$('.page').getText()).includes('Password protection: On'), { timeout: PROTECTION_FINISH_MS });
  await b.$('.profile-switcher-toggle').waitForExist({ timeout: PROTECTION_FINISH_MS });
  // Create an actual unsaved rule dialog. Invoke the actual lock button event behind it to exercise
  // the confirmation path without bypassing React or mocking the dirty-state detector.
  await openSettingsGroup(b, "features");
  await (await b.$('#categorization-rules')).$('button=Add rule').click();
  await b.$('input[placeholder*="Ferrywood"]').setValue('unsaved draft');
  for (const palette of ["transparent", "futuristic", "retro"]) for (const theme of ["light", "dark"]) {
    await b.execute((p, t) => { document.documentElement.dataset.palette = p; document.documentElement.dataset.theme = t; }, palette, theme);
    await lockViaProfileMenu(b);
    await b.$('button=Keep editing').waitForExist({ timeout: 5000 });
    const layout = await b.execute(() => {
      const panels = [...document.querySelectorAll('.modal-panel')];
      const panel = panels.at(-1), r = panel.getBoundingClientRect();
      return { count: panels.length, contained: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
        focus: panel.contains(document.activeElement), border: getComputedStyle(panel).borderTopStyle };
    });
    assert.equal(layout.count, 2); assert.equal(layout.contained, true); assert.equal(layout.focus, true); assert.equal(layout.border, 'solid');
    await withFocusRetry(b, async () => { await b.$('button=Keep editing').click(); });
    await b.$('button=Keep editing').waitForExist({ reverse: true, timeout: 5000 });
    assert.equal(await b.$('input[placeholder*="Ferrywood"]').getValue(), 'unsaved draft');
  }
  await lockViaProfileMenu(b);
  await b.$('button=Discard and lock').waitForExist({ timeout: 5000 });
  await b.$('button=Discard and lock').click();
  await b.$('[data-profile-lock-screen]').waitForExist({ timeout: 10000 });
  await b.$('#password-form-field').setValue('manual confirmation password');
  await b.$('button=Unlock').click();
  await b.$('.brand-word').waitForExist({ timeout: 10000 });
  await b.$('button*=Settings').click();
  await openSettingsGroup(b, "features");
  await (await b.$('#categorization-rules')).$('button=Add rule').click();
  await b.$('input[placeholder*="Ferrywood"]').setValue('another unsaved draft');
  await lockViaProfileMenu(b);
  await b.$('button=Discard and lock').waitForExist({ timeout: 5000 });
  // Automatic workstation locking must not wait for an open manual confirmation.
  assert.equal((await invoke(b, 'debug_apply_system_session_event', { event: 'locked' })).ok, true);
  await b.$('[data-profile-lock-screen]').waitForExist({ timeout: 10000 });
  assert.equal(await b.$('button=Discard and lock').isExisting(), false);
  console.log("FEATURE 286 E2E TEST PASSED");
} finally { await app.close(); }
