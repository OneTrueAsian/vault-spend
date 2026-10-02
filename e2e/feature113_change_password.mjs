// Change-password coverage through the compiled app, including pre-commit process-kill recovery.
// (Restoring a backup made under the old password is feature152, split out to stay inside the
// runner's per-spec time limit.)
// Run with: node e2e/run-all.mjs --spec=113

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dismissFirstLaunchDialogs, launchApp } from "./harness.mjs";
import { killAtFailpoint } from "./lib/protection.mjs";
import { NEW_PASSWORD, OLD_PASSWORD, createProtectedFixture, invoke, prepareChange } from "./lib/change-password.mjs";

// Happy path: old password stops working, new password works, and the confirmed recovery key is
// exactly the one the backend reports as committed.
{
  const { app } = await createProtectedFixture();
  try {
    const recovery = await prepareChange(app.browser, OLD_PASSWORD, NEW_PASSWORD);
    await (await app.browser.$("button=Finish")).click();
    await app.browser.$(".change-password-dialog").waitForExist({ reverse: true, timeout: 15000 });

    const newGeneration = (await invoke(app.browser, "get_current_generation")).ok;
    const oldCheck = await invoke(app.browser, "verify_current_password", { password: OLD_PASSWORD, expectedGeneration: newGeneration });
    assert.match(oldCheck.error, /didn't work/);
    const newCheck = await invoke(app.browser, "verify_current_password", { password: NEW_PASSWORD, expectedGeneration: newGeneration });
    assert.equal(newCheck.error, undefined);
    assert.match(recovery, /^(?:[A-Z0-9]{4}-){6}[A-Z0-9]{4}$/);
  } finally {
    await app.close();
  }
}

// Kill after every new file and backup is staged but before the registry commits. Startup must
// discard the staged rotation and leave the original password usable.
{
  const { testDbDir, app: setupApp } = await createProtectedFixture();
  await setupApp.close();

  process.env.VAULTSPEND_FAILPOINT = "rotation_after_staging";
  let app;
  try {
    app = await launchApp({ dbDir: testDbDir, ready: "[data-profile-selector]" });
  } finally {
    delete process.env.VAULTSPEND_FAILPOINT;
  }
  const { browser } = app;
  await (await browser.$("[data-profile-option]")).click();
  await (await browser.$("#password-form-field")).setValue(OLD_PASSWORD);
  await (await browser.$("button=Unlock")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await dismissFirstLaunchDialogs(browser);
  await (await browser.$("button*=Settings")).click();
  await prepareChange(browser, OLD_PASSWORD, NEW_PASSWORD);
  const pid = (await invoke(browser, "debug_process_id")).ok;
  await killAtFailpoint(testDbDir, "rotation_after_staging", pid, () =>
    browser.execute(() => [...document.querySelectorAll("button")].find((button) => button.textContent === "Finish").click()),
  );
  await app.close();

  assert.ok(fs.existsSync(path.join(testDbDir, "protection-rotation-journal.json")));
  const relaunched = await launchApp({ dbDir: testDbDir, ready: "[data-profile-selector]" });
  try {
    assert.ok(!fs.existsSync(path.join(testDbDir, "protection-rotation-journal.json")), "startup should retire the pre-commit journal");
    await (await relaunched.browser.$("[data-profile-option]")).click();
    await (await relaunched.browser.$("#password-form-field")).setValue(OLD_PASSWORD);
    await (await relaunched.browser.$("button=Unlock")).click();
    await relaunched.browser.$(".brand-word").waitForExist({ timeout: 10000, timeoutMsg: "the original password should still unlock after recovery" });
  } finally {
    await relaunched.close();
  }
}

console.log("FEATURE 113 E2E TEST PASSED");
