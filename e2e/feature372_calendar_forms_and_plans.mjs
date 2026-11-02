// The app-drawn date and month fields in the forms that save through their own buttons, driven through
// their visible controls:
//   1. Recurring: editing a bill's next due date - an unfinished date disables Save instead of saving the old one;
//      a finished date saves.
//   2. Goals: a new goal's optional target date can be chosen, cleared from the calendar, and saved.
//   3. An account's page: an unfinished statement date disables both upload buttons.
//   4. Accumulation: an unfinished withdraw month refuses to save the plan; a chosen month and Clear work.
//
// Run with: node e2e/feature372_calendar_forms_and_plans.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { SUMMARY_FIXTURE_PY } from "./lib/accumulation-fixture.mjs";
import { nav, openDetails, waitForAccumulation } from "./lib/accumulation.mjs";
import { isoDaysFromNow } from "./lib/dates.mjs";
import { readDateValue, waitForDateValue } from "./lib/dateFields.mjs";
import { openCalendar, pickCalendarDay, typeDate } from "./lib/dateFieldInput.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const DUE = isoDaysFromNow(9);
const dbDir = await seedFixture(`${SUMMARY_FIXTURE_PY}
cur.execute("INSERT INTO recurring (merchant, category, amount, cadence, anchor_date) VALUES ('Streaming Plan', NULL, '-15.49', 'monthly', ?)", ("${DUE}",))
`);
const shotsDir = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature372-");
fs.mkdirSync(shotsDir, { recursive: true });

const app = await launchApp({ dbDir, windowSize: { width: 1440, height: 1400 } });
const { browser: b } = app;
const invoke = async (command, args = {}) => {
  const r = await b.executeAsync((command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then((ok) => done({ ok }), (e) => done({ error: String(e) })), command, args);
  if (r.error) throw new Error(`${command}: ${r.error}`);
  return r.ok;
};
const CLEAR = '//div[contains(@class,"calendar-popover")]//button[normalize-space()="Clear"]';
const disabled = async (selector) => (await (await b.$(selector)).getAttribute("disabled")) !== null;
const shot = (name) => b.saveScreenshot(path.join(shotsDir, `${name}.png`));
const choosableDays = () => b.execute(() => [...document.querySelectorAll(".calendar-popover [data-date]:not(:disabled):not(.is-outside)")].map((e) => e.getAttribute("data-date")));

try {
  // ---- 1. Recurring: the row editor's Save ---------------------------------------------------
  await (await b.$(".nav-item[data-tab=recurring]")).click();
  await waitUntilOrDiagnose(b, () => b.execute(() => [...document.querySelectorAll("button")].some((x) => x.textContent.trim() === "Edit")), { timeoutMsg: "the bill should have an Edit button" });
  await (await b.$("button=Edit")).click();
  const NEXT = 'input.row-edit-input[aria-label="Next due date"]';
  await b.$(NEXT).waitForExist({ timeout: 8000 });
  assert.equal(await readDateValue(b, NEXT), DUE, "the editor starts on the bill's date");
  const save = '//tr[.//input[@aria-label="Next due date"]]//button[normalize-space()="Save"]';
  await typeDate(b, NEXT, "01/0");
  await waitUntilOrDiagnose(b, async () => (await b.$(save).getAttribute("disabled")) !== null, { timeoutMsg: "an unfinished due date should disable Save" });
  await shot("recurring-unfinished-date");
  const later = isoDaysFromNow(20);
  await typeDate(b, NEXT, later);
  await waitUntilOrDiagnose(b, async () => (await b.$(save).getAttribute("disabled")) === null, { timeoutMsg: "a finished due date should enable Save" });
  await (await b.$(save)).click();
  await waitUntilOrDiagnose(b, async () => (await invoke("list_recurring")).some((r) => r.merchant === "Streaming Plan" && r.anchor_date === later), { timeoutMsg: `Save should store ${later}` });

  // ---- 2. Goals: an optional target date ----------------------------------------------------
  await (await b.$(".nav-item[data-tab=buckets]")).click();
  await (await b.$("button=Create a goal")).click();
  await (await b.$(".bucket-new-form input[placeholder*='Emergency']")).setValue("Roof fund");
  const TARGET = 'input[aria-label="Target date (optional)"]';
  await b.$(TARGET).waitForExist({ timeout: 8000 });
  assert.equal(await readDateValue(b, TARGET), "", "a new goal's target date starts empty");
  await openCalendar(b, TARGET);
  const day = (await choosableDays())[10];
  await pickCalendarDay(b, day);
  await waitForDateValue(b, TARGET, day, "the chosen target date");
  await openCalendar(b, TARGET);
  await (await b.$(CLEAR)).click();
  await waitForDateValue(b, TARGET, "", "the target date after Clear");
  assert.equal(await b.$(".calendar-popover").isExisting(), false, "Clear closes the calendar");
  // Keyboard only: Alt+Down opens the calendar on today, arrows and Page Down move, Enter chooses, focus returns to the box.
  await (await b.$(TARGET)).click();
  await b.keys(["Alt", "ArrowDown"]);
  await b.$(".calendar-popover").waitForExist({ timeout: 5000, timeoutMsg: "Alt+Down should open the calendar" });
  assert.equal(await b.execute(() => document.activeElement?.getAttribute("data-date")), isoDaysFromNow(0), "the calendar opens with focus on today");
  await b.keys("ArrowRight");
  await b.keys("ArrowRight");
  await b.keys("PageDown");
  const moved = await b.execute(() => document.activeElement?.getAttribute("data-date"));
  const twoDays = new Date(`${isoDaysFromNow(2)}T12:00:00`);
  const wantDay = new Date(twoDays.getFullYear(), twoDays.getMonth() + 1, Math.min(twoDays.getDate(), new Date(twoDays.getFullYear(), twoDays.getMonth() + 2, 0).getDate()), 12);
  const wanted = `${wantDay.getFullYear()}-${String(wantDay.getMonth() + 1).padStart(2, "0")}-${String(wantDay.getDate()).padStart(2, "0")}`;
  assert.equal(moved, wanted, "two days on and a month on, by keyboard");
  assert.equal(await readDateValue(b, TARGET), "", "moving about the calendar chooses nothing");
  await b.keys("Enter");
  await waitForDateValue(b, TARGET, wanted, "the day chosen with Enter");
  assert.equal(await b.$(".calendar-popover").isExisting(), false, "choosing with Enter closes the calendar");
  assert.equal(await b.execute(() => document.activeElement?.getAttribute("aria-label")), "Target date (optional)", "focus returns to the box");
  const target = isoDaysFromNow(200);
  await typeDate(b, TARGET, target);
  await waitForDateValue(b, TARGET, target, "the typed target date");
  await shot("goal-target-date");
  await (await b.$(".bucket-new-form button[type=submit]")).click();
  await waitUntilOrDiagnose(b, async () => (await invoke("list_buckets")).some((x) => x.name === "Roof fund" && x.target_date === target), { timeoutMsg: "the goal should be saved with the typed target date" });

  // ---- 3. An account's page: the statement dates ----------------------------------------------
  const accountId = await openDetails(b, "Joey Roth IRA");
  await typeDate(b, "[data-statement-period-start]", isoDaysFromNow(-60));
  await typeDate(b, "[data-statement-date]", isoDaysFromNow(-1));
  await waitUntilOrDiagnose(b, async () => !(await disabled("[data-upload-statement]")), { timeoutMsg: "two finished dates should enable uploading" });
  await typeDate(b, "[data-statement-date]", "08/2");
  await waitUntilOrDiagnose(b, async () => (await disabled("[data-upload-statement]")) && (await disabled("[data-upload-download]")) && (await disabled("[data-reconcile-start]")), {
    timeoutMsg: "an unfinished statement end date should disable both uploads and Start reconciling",
  });
  await shot("account-statement-unfinished");
  await typeDate(b, "[data-statement-date]", isoDaysFromNow(-1));
  await waitUntilOrDiagnose(b, async () => !(await disabled("[data-upload-statement]")), { timeoutMsg: "finishing the date should enable uploading again" });

  // ---- 4. Accumulation: the withdraw month ------------------------------------------------------
  await waitForAccumulation(b, accountId);
  const MONTH = 'input[aria-label="Withdraw month"]';
  await (await b.$(MONTH)).scrollIntoView({ block: "center" });
  const savedMonth = async () => (await invoke("investment_accumulation", { accountId: Number(accountId) })).plan.withdraw_month;
  const before = await savedMonth();
  await typeDate(b, MONTH, "13/20");
  // One direct click on Save from the unfinished box, with no other click first: leaving the box must not move
  // Save between the press and the release, so this single click reaches it.
  await (await b.$("[data-acc-save]")).click();
  await waitUntilOrDiagnose(b, () => b.execute(() => document.body.textContent.includes("Finish or correct the withdraw month before saving.")), {
    timeoutMsg: "one direct click on Save with an unfinished month should say why it didn't save",
    extra: () => b.execute(() => ({ box: document.querySelector('input[aria-label="Withdraw month"]')?.value, errs: [...document.querySelectorAll("[role=alert], .statement-error, .field-error")].map((e) => e.textContent) })),
  });
  await waitUntilOrDiagnose(b, async () => (await b.$("[data-acc-settings] .date-field-problem").isExisting()), { timeoutMsg: "the unfinished month should also be explained under its own box" });
  assert.equal(await savedMonth(), before, "nothing was saved: not the unfinished text and not the previous month again");
  await shot("accumulation-unfinished-month");
  await openCalendar(b, MONTH);
  const picked = await b.execute(() => document.querySelector(".calendar-popover .calendar-month:not(:disabled)")?.getAttribute("data-month") ?? null);
  assert.ok(picked, "the month calendar offers a month");
  await (await b.$(`.calendar-popover [data-month="${picked}"]`)).click();
  const [py, pm] = picked.split("-");
  await waitForDateValue(b, MONTH, `${py}-${pm.padStart(2, "0")}`, "the month chosen in the calendar");
  await openCalendar(b, MONTH);
  await (await b.$(CLEAR)).click();
  await waitForDateValue(b, MONTH, "", "the withdraw month after Clear");
  await nav(b, "Accounts");
  console.log(`PASS feature372 (screenshots in ${shotsDir})`);
} finally {
  await app.close();
}
