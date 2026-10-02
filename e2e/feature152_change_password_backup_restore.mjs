// A backup made before a password change still opens with the password it was made under: restoring it
// through the real password prompt rejects the current password and accepts the old one, and the
// restored profile then answers to the old password. (Split from feature113 to keep each spec inside
// the runner's per-spec time limit.)
// Run with: node e2e/run-all.mjs --spec=152

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NEW_PASSWORD, OLD_PASSWORD, createProtectedFixture, invoke, prepareChange } from "./lib/change-password.mjs";

// A backup carries the password/key from the point when it was created. Simulate an old copy that
// lived outside the primary folder while password rotation re-keyed the primary copies, put that
// pair back afterward, and restore it through the real password prompt.
{
  const { app } = await createProtectedFixture();
  try {
    await (await app.browser.$("button=Back up now")).click();
    const listed = (await invoke(app.browser, "list_backups")).ok;
    assert.ok(listed?.[0]?.filename, "expected a protected backup fixture");
    const filename = listed[0].filename;
    const livePath = (await invoke(app.browser, "get_data_file_location")).ok;
    const backupPath = path.join(path.dirname(livePath), "backups", "protected", filename);
    const archivedPath = `${backupPath}.pre-change`;
    const archivedKeyPath = `${backupPath}.key.pre-change`;
    fs.copyFileSync(backupPath, archivedPath);
    fs.copyFileSync(`${backupPath}.key`, archivedKeyPath);

    await prepareChange(app.browser, OLD_PASSWORD, NEW_PASSWORD);
    await (await app.browser.$("button=Finish")).click();
    await app.browser.$(".change-password-dialog").waitForExist({ reverse: true, timeout: 15000 });

    // Put the point-in-time pair back under the filename already displayed by Settings.
    fs.copyFileSync(archivedPath, backupPath);
    fs.copyFileSync(archivedKeyPath, `${backupPath}.key`);

    const backupsCard = await app.browser.$("[data-backups]");
    const restore = await backupsCard.$("button=Restore");
    await restore.click();
    await (await backupsCard.$("button=Restore")).click();
    const restoreDialog = await app.browser.$(".modal-panel");
    await restoreDialog.waitForExist({ timeout: 5000 });
    await app.browser.waitUntil(async () => /old password/i.test(await restoreDialog.getText()), {
      timeout: 5000,
      timeoutMsg: "expected the protected restore dialog to explain that an older password may be required",
    });
    const restorePassword = await restoreDialog.$("input[type='password']");
    await restorePassword.setValue(NEW_PASSWORD);
    await (await restoreDialog.$("button=Restore")).click();
    await app.browser.waitUntil(async () => (await restoreDialog.getText()).includes("didn't work for this backup"), {
      timeout: 10000,
      timeoutMsg: "expected the current password to be rejected for the historical backup",
    });
    await restorePassword.setValue(OLD_PASSWORD);
    await (await restoreDialog.$("button=Restore")).click();
    await restoreDialog.waitForExist({ reverse: true, timeout: 15000 });

    const generation = (await invoke(app.browser, "get_current_generation")).ok;
    const oldCheck = await invoke(app.browser, "verify_current_password", { password: OLD_PASSWORD, expectedGeneration: generation });
    assert.equal(oldCheck.error, undefined, "restoring the historical backup should restore its old password");
    const newCheck = await invoke(app.browser, "verify_current_password", { password: NEW_PASSWORD, expectedGeneration: generation });
    assert.match(newCheck.error, /didn't work/);
  } finally {
    await app.close();
  }
}

console.log("FEATURE 152 E2E TEST PASSED");
