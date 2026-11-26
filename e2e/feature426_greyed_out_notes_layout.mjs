// VS-68: every greyed-out button says what it is waiting for. Boxes that are always on screen (Settings' second backup folder,
// New profile) stay quiet until they are used; forms that open on demand (Add recurring, a new goal) say it straight away.
// In every style the note sits on its own line under the buttons, inside its form, and reads as a sentence.
// Run with: node e2e/feature426_greyed_out_notes_layout.mjs [--keep-screens]
import assert from "node:assert/strict";
import path from "node:path";
import { launchApp, chooseStyle, openSettingsGroup, dismissStatusMessages } from "./harness.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

/** Where a note sits: visible, inside its container, below the button it explains, and how many lines it takes. */
function noteLayout(b, noteSelector, containerSelector, buttonText) {
  return b.execute((noteSel, boxSel, label) => {
    const note = document.querySelector(noteSel);
    if (!note) return null;
    const box = note.closest(boxSel);
    const button = [...box.querySelectorAll("button")].find((el) => el.textContent.trim() === label);
    const n = note.getBoundingClientRect(), c = box.getBoundingClientRect(), btn = button.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(note);
    const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
    return {
      visible: n.width > 0 && n.height > 0,
      inside: n.left >= c.left - 1 && n.right <= c.right + 1,
      below: n.top >= btn.bottom - 1,
      lines,
      buttonDisabled: button.disabled,
    };
  }, noteSelector, containerSelector, buttonText);
}

const app = await launchApp();
const b = app.browser;
const shots = makeTempDir("vaultspend-vs68-shots-");
const shot = async (name, noteSelector) => {
  await dismissStatusMessages(b);
  await b.execute((sel) => document.querySelector(sel)?.scrollIntoView({ block: "center" }), noteSelector);
  await b.executeAsync((done) => document.fonts.ready.then(() => requestAnimationFrame(() => done(true))));
  await b.saveScreenshot(path.join(shots, `${name}.png`));
};
const nav = async (label) => (await b.$(`.nav-item[aria-label="${label}"]`)).click();
const check = async (what, layout) => {
  assert.ok(layout, `${what}: the note is shown`);
  assert.ok(layout.visible && layout.inside && layout.below && layout.lines <= 2 && layout.buttonDisabled,
    `${what}: the note sits on its own line under the greyed-out button, inside the form: ${JSON.stringify(layout)}`);
};

try {
  await b.setWindowSize(1280, 900);
  for (const [style, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await chooseStyle(b, style, palette);

    // Settings › Data › Second copy: quiet until the box is used.
    await openSettingsGroup(b, "data");
    const folder = await b.$("input[aria-label='Second backup folder']");
    await folder.waitForExist({ timeout: 10000 });
    assert.equal(await b.$("[data-backup-copy-missing]").isExisting(), false, `${style}: an untouched second-copy card shows no note`);
    await folder.click();
    await b.$("[data-backup-copy-missing]").waitForExist({ timeout: 5000 });
    await check(`${style} second copy`, await noteLayout(b, "[data-backup-copy-missing]", "form", "Start copying"));
    await shot(`${palette}-second-copy`, "[data-backup-copy-missing]");

    // Settings › Profiles & security › New profile: the same.
    await openSettingsGroup(b, "profiles");
    const profileName = await b.$(".profile-create-form input:not([type=checkbox])");
    await profileName.waitForExist({ timeout: 10000 });
    assert.equal(await b.$("[data-new-profile-missing]").isExisting(), false, `${style}: an untouched New profile box shows no note`);
    await profileName.click();
    await b.$("[data-new-profile-missing]").waitForExist({ timeout: 5000 });
    await check(`${style} new profile`, await noteLayout(b, "[data-new-profile-missing]", "form", "New profile"));
    await shot(`${palette}-new-profile`, "[data-new-profile-missing]");

    // Recurring › Add recurring: says what is missing straight away.
    await nav("Recurring");
    await (await b.$("button=Add recurring")).click();
    await b.$("[data-recurring-add-missing]").waitForExist({ timeout: 5000 });
    assert.equal(await b.execute(() => document.querySelector("[data-recurring-add-missing]").textContent), "Enter a name.");
    await check(`${style} add recurring`, await noteLayout(b, "[data-recurring-add-missing]", "form", "Save"));
    await shot(`${palette}-add-recurring`, "[data-recurring-add-missing]");
    await (await b.$("//form[contains(@class,'bucket-new-form')]//button[normalize-space()='Cancel']")).click();

    // Goals › Create a goal: the same.
    await nav("Goals");
    await (await b.$("button=Create a goal")).click();
    await b.$("[data-goal-name-missing]").waitForExist({ timeout: 5000 });
    await check(`${style} new goal`, await noteLayout(b, "[data-goal-name-missing]", "form", "Create"));
    await shot(`${palette}-new-goal`, "[data-goal-name-missing]");
    await (await b.$("//form[contains(@class,'bucket-new-form')]//button[normalize-space()='Cancel']")).click();
  }
  console.log(`FEATURE 426 PASSED: greyed-out buttons say what is missing, on their own line inside the form, in Default, Futuristic and Retro. Screenshots: ${shots}`);
} finally { await app.close(); }
