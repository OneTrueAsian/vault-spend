// VS-71: a backup failure shows its plain words, and the technical cause is one click away under Details, redacted
// (the home folder, which names the Windows user, reads %USERPROFILE%), with Copy details for support.
// The failure is real: the second backup folder chosen in Settings holds a folder named like the app's write test,
// so writing the test file fails ("Access is denied"). Checked in Default, Futuristic and Retro.
// Run with: node e2e/feature429_failure_details.mjs [--keep-screens]
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose, chooseStyle, openSettingsGroup, dismissStatusMessages } from "./harness.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const NOT_WRITABLE = "Vault Spend can't save files in that folder. Choose a folder you can write to.";
const folder = makeTempDir("vaultspend-vs71-folder-");
fs.mkdirSync(path.join(folder, ".vaultspend-write-test"));
assert.ok(folder.toLowerCase().startsWith(os.homedir().toLowerCase()), `the test folder is under the home folder, so redaction is exercised: ${folder}`);

const app = await launchApp();
const b = app.browser;
const shots = makeTempDir("vaultspend-vs71-shots-");
const toast = () => b.execute(() => {
  const p = [...document.querySelectorAll(".toast-stack .status-error")].at(-1);
  if (!p) return null;
  const r = p.getBoundingClientRect();
  const detail = p.querySelector("[data-status-detail]");
  const d = detail?.getBoundingClientRect();
  return {
    text: p.querySelector(".status-text")?.firstChild?.textContent ?? null,
    buttons: [...p.querySelectorAll("button")].map((x) => x.textContent),
    expanded: p.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded") ?? null,
    detail: detail?.textContent ?? null,
    detailInside: d ? d.left >= r.left - 1 && d.right <= r.right + 1 && d.bottom <= r.bottom + 1 : null,
    inWindow: r.left >= 0 && r.right <= window.innerWidth + 1,
  };
});
const click = (label) => b.execute((l) => [...document.querySelector(".toast-stack .status-error").querySelectorAll("button")].find((x) => x.textContent === l).click(), label);

try {
  await b.setWindowSize(1280, 900);
  for (const [style, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await chooseStyle(b, style, palette);
    await dismissStatusMessages(b);
    await openSettingsGroup(b, "data");
    const box = await b.$("input[aria-label='Second backup folder']");
    await box.waitForExist({ timeout: 10000 });
    await box.setValue(folder);
    await b.execute(() => [...document.querySelectorAll("button")].find((x) => x.textContent === "Start copying").click());
    try {
      await waitUntilOrDiagnose(b, async () => (await toast())?.text === NOT_WRITABLE, { timeout: 10000, timeoutMsg: `${style}: the plain words appear` });
    } catch (error) { error.message += " ACTUAL " + JSON.stringify(await toast()); throw error; }
    const closed = await toast();
    assert.deepEqual(closed.buttons, ["Details", "×"], `${style}: Details beside the dismiss button`);
    assert.equal(closed.expanded, "false");
    assert.equal(closed.detail, null, `${style}: the cause stays hidden until asked for`);
    // The Second copy card repeats the result beside its button: the plain words only, never the cause.
    const inCard = await b.execute(() => document.querySelector(".settings-feedback-error")?.textContent ?? null);
    assert.equal(inCard, NOT_WRITABLE, `${style}: the card repeats only the plain words`);

    await click("Details");
    const open = await toast();
    assert.equal(open.expanded, "true");
    assert.match(open.detail, /^couldn't write to %USERPROFILE%.*\(os error 5\)$/, `${style}: the cause, redacted: ${open.detail}`);
    assert.ok(!open.detail.toLowerCase().includes(os.homedir().toLowerCase()), `${style}: no home folder in the detail`);
    assert.ok(!open.detail.includes(os.userInfo().username), `${style}: no user name in the detail`);
    assert.ok(open.detailInside && open.inWindow, `${style}: the detail stays inside its message: ${JSON.stringify(open)}`);
    await click("Copy details");
    await waitUntilOrDiagnose(b, async () => (await toast()).buttons.some((x) => x === "Copied" || x === "Couldn't copy"), { timeout: 5000, timeoutMsg: `${style}: Copy details says what happened` });

    await b.executeAsync((done) => document.fonts.ready.then(() => requestAnimationFrame(() => done(true))));
    await b.saveScreenshot(path.join(shots, `${palette}-failure-details.png`));
    await dismissStatusMessages(b);
  }
  console.log(`FEATURE 429 PASSED: a backup failure shows plain words with its redacted cause behind Details and Copy details, in Default, Futuristic and Retro. Screenshots: ${shots}`);
} finally {
  await app.close();
  fs.rmSync(folder, { recursive: true, force: true });
}
