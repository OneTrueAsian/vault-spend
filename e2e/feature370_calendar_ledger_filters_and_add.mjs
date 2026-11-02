// The app-drawn date calendar in the places people use it most, driven through its visible controls:
//   1. The Transactions row editor: opening the calendar or choosing a day never saves; Enter saves exactly once
//      (and not again as the editor closes); leaving the field saves exactly once; Escape closes only an open
//      calendar, and a second Escape cancels without saving; an unfinished date is refused, never saved as the old one.
//   2. More filters: Escape closes the calendar first and the panel later, choosing a day keeps the panel open
//      and filters the list, and Clear all clears the dates.
//   3. Add transaction: the Date label focuses the box, an unfinished date stops the save, and a day chosen in the
//      calendar is the day that is saved.
// Saves are counted by a trigger the fixture installs on the disposable database (one row per write to a
// transaction's date); stored values are read back through list_transactions.
//
// Run with: node e2e/feature370_calendar_ledger_filters_and_add.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { isoDaysFromNow } from "./lib/dates.mjs";
import { enterTransactionAmount } from "./lib/transactionAmount.mjs";
import { readDateValue, waitForDateValue } from "./lib/dateFields.mjs";
import { openCalendar, pickCalendarDay, typeDate } from "./lib/dateFieldInput.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '1000.00')")
acct = cur.lastrowid
cur.execute("CREATE TABLE date_saves (id INTEGER, date TEXT)")
cur.execute("CREATE TRIGGER count_date_saves AFTER UPDATE OF date ON transactions BEGIN INSERT INTO date_saves VALUES (NEW.id, NEW.date); END")
import datetime
today = datetime.date.today()
for days, desc in ((0, "Corner Bakery"), (20, "Fuel Stop"), (45, "Hardware Store")):
    d = (today - datetime.timedelta(days=days)).isoformat()
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, "-10.00", "Groceries", "user", f"{acct}|{d}|{desc.lower()}"))
`);
const shotsDir = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature370-");
fs.mkdirSync(shotsDir, { recursive: true });

const app = await launchApp({ dbDir, windowSize: { width: 1440, height: 1000 } });
const { browser: b } = app;

const invoke = async (command, args = {}) => {
  const r = await b.executeAsync((command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then((ok) => done({ ok }), (e) => done({ error: String(e) })), command, args);
  if (r.error) throw new Error(`${command}: ${r.error}`);
  return r.ok;
};
const storedDate = async (description) => (await invoke("list_transactions")).find((t) => t.description === description)?.date ?? null;
const dbPath = path.join(dbDir, "vaultspend.db");
const saves = () =>
  Number(execFileSync("python", ["-c", `import sqlite3; print(sqlite3.connect(r"${dbPath}").execute("SELECT COUNT(*) FROM date_saves").fetchone()[0])`]).toString().trim());
const calendarOpen = () => b.$(".calendar-popover").isExisting();
const editorOpen = () => b.$("table.ledger td.date-col input.row-edit-input").isExisting();
const rowDateCell = (description) =>
  b.execute((desc) => [...document.querySelectorAll("table.ledger tbody tr[data-payment-row]")].find((r) => r.textContent.includes(desc))?.querySelector("td.date-col .date-cell") ?? null, description);
const EDITOR = "table.ledger td.date-col input.row-edit-input";
const shot = (name) => b.saveScreenshot(path.join(shotsDir, `${name}.png`));

async function openEditor(description) {
  const cell = await rowDateCell(description);
  assert.ok(cell, `${description} should have a date to click`);
  await (await b.$(cell)).click();
  await b.$(EDITOR).waitForExist({ timeout: 8000, timeoutMsg: "clicking a row's date should open the date field" });
}
const settle = async (ms = 500) => b.pause(ms);

try {
  await (await b.$(".nav-item[data-tab=ledger]")).click();
  await waitUntilOrDiagnose(b, () => b.execute(() => document.querySelectorAll("table.ledger tbody tr[data-payment-row]").length >= 3), { timeout: 20000, timeoutMsg: "the three transactions should be listed" });

  // ---- 1. the row editor --------------------------------------------------------------------
  const original = await storedDate("Fuel Stop");
  await openEditor("Fuel Stop");
  assert.equal(await readDateValue(b, EDITOR), original, "the editor starts on the row's date");
  await openCalendar(b, EDITOR);
  await settle();
  assert.equal(saves(), 0, "opening the calendar saves nothing");
  const shown = await b.execute(() => document.querySelector(".calendar-popover [data-date]")?.getAttribute("data-date") ?? null);
  assert.ok(shown, "the calendar shows days");
  await shot("ledger-editor-calendar");
  // Choose the first selectable day in the page that is showing, by clicking it.
  const choice = await b.execute(() => [...document.querySelectorAll(".calendar-popover [data-date]:not(:disabled):not(.is-outside)")].map((e) => e.getAttribute("data-date")).find((d) => d !== document.querySelector(".calendar-popover .is-selected")?.getAttribute("data-date")));
  await pickCalendarDay(b, choice);
  assert.equal(await calendarOpen(), false, "choosing a day closes the calendar");
  assert.equal(await editorOpen(), true, "choosing a day does not close the editor");
  await settle();
  assert.equal(saves(), 0, "choosing a day saves nothing yet");
  assert.equal(await storedDate("Fuel Stop"), original, "the stored date is unchanged until Enter");
  assert.equal(await readDateValue(b, EDITOR), choice, "the box holds the chosen day");
  await b.keys("Enter");
  await waitUntilOrDiagnose(b, async () => (await storedDate("Fuel Stop")) === choice, { timeoutMsg: `Enter should save ${choice}` });
  await settle(800);
  assert.equal(saves(), 1, "Enter saves exactly once, and not again as the editor closes");
  assert.equal(await editorOpen(), false, "the editor closes after saving");

  // Typed, then leaving the field saves exactly once.
  const typed = isoDaysFromNow(-9);
  await openEditor("Fuel Stop");
  await typeDate(b, EDITOR, typed);
  await waitForDateValue(b, EDITOR, typed, "the typed date");
  await (await b.$("h1")).click();
  await waitUntilOrDiagnose(b, async () => (await storedDate("Fuel Stop")) === typed, { timeoutMsg: "leaving the field with a date should save it" });
  await settle(800);
  assert.equal(saves(), 2, "leaving the field saves exactly once");

  // Escape: first closes only an open calendar, the second cancels the edit without saving.
  await openEditor("Fuel Stop");
  await typeDate(b, EDITOR, isoDaysFromNow(-3));
  await openCalendar(b, EDITOR);
  await b.keys("Escape");
  await waitUntilOrDiagnose(b, async () => !(await calendarOpen()), { timeoutMsg: "Escape should close the calendar" });
  assert.equal(await editorOpen(), true, "the first Escape leaves the editor open");
  await b.keys("Escape");
  await waitUntilOrDiagnose(b, async () => !(await editorOpen()), { timeoutMsg: "the second Escape should cancel the edit" });
  await settle(800);
  assert.equal(await storedDate("Fuel Stop"), typed, "cancelling saves nothing");
  assert.equal(saves(), 2, "no save happened while cancelling");

  // An unfinished date is refused, never saved as the old one.
  await openEditor("Fuel Stop");
  await typeDate(b, EDITOR, "01/0");
  await b.keys("Enter");
  await settle();
  assert.equal(await editorOpen(), true, "Enter on an unfinished date keeps the editor open");
  assert.equal(await b.$(".date-col .date-field-problem").isExisting(), true, "the unfinished date is explained");
  await shot("ledger-editor-invalid");
  assert.equal(saves(), 2, "nothing was saved for the unfinished date");
  await b.keys("Escape");
  await waitUntilOrDiagnose(b, async () => !(await editorOpen()), { timeoutMsg: "Escape should cancel the editor holding an unfinished date" });
  assert.equal(await storedDate("Fuel Stop"), typed, "the stored date never changed");

  // ---- 2. More filters ------------------------------------------------------------------------
  await (await b.$("button*=More filters")).click();
  await b.$('input[aria-label="From date"]').waitForExist({ timeout: 5000 });
  await openCalendar(b, 'input[aria-label="From date"]');
  await b.keys("Escape");
  await waitUntilOrDiagnose(b, async () => !(await calendarOpen()), { timeoutMsg: "Escape should close the calendar inside More filters" });
  assert.equal(await b.$(".more-filters-panel").isExisting(), true, "the first Escape leaves More filters open");
  await openCalendar(b, 'input[aria-label="From date"]');
  const fromPicked = await b.execute(() => [...document.querySelectorAll(".calendar-popover [data-date]:not(:disabled):not(.is-outside)")][0]?.getAttribute("data-date") ?? null);
  await pickCalendarDay(b, fromPicked);
  assert.equal(await b.$(".more-filters-panel").isExisting(), true, "choosing a day keeps More filters open");
  await waitForDateValue(b, 'input[aria-label="From date"]', fromPicked, "the From date");
  await waitUntilOrDiagnose(b, async () => (await b.$(".account-filter-toggle*=filter").getText()).includes("1 filter active"), { timeoutMsg: "the From date counts as an active filter" });
  await shot("more-filters-with-date");
  await (await b.$("button=Clear all")).click();
  await waitForDateValue(b, 'input[aria-label="From date"]', "", "the From date after Clear all");
  await b.keys("Escape");
  await waitUntilOrDiagnose(b, async () => !(await b.$(".more-filters-panel").isExisting()), { timeoutMsg: "a later Escape should close More filters" });

  // ---- 3. Add transaction ---------------------------------------------------------------------
  await (await b.$("button*=Add transaction")).click();
  const panel = await b.$(".modal-panel");
  await panel.waitForExist({ timeout: 8000 });
  const DATE = '.modal-panel input[aria-label="Date"]';
  await (await panel.$("label=Date")).click();
  assert.equal(await b.execute(() => document.activeElement?.getAttribute("aria-label")), "Date", "clicking the Date label puts the cursor in the date box");
  await typeDate(b, DATE, "10/");
  await (await panel.$("input[placeholder='e.g. \"Coffee shop\"']")).setValue("Calendar Check");
  await enterTransactionAmount(b, panel, "-9.99");
  await (await panel.$("button=Add transaction")).click();
  await settle(800);
  assert.equal(await b.$(".modal-panel").isExisting(), true, "Add transaction stays open while the date is unfinished");
  assert.equal(await storedDate("Calendar Check"), null, "nothing is saved with an unfinished date");
  await openCalendar(b, DATE);
  const dayChoice = await b.execute(() => [...document.querySelectorAll(".calendar-popover [data-date]:not(:disabled):not(.is-outside)")].map((e) => e.getAttribute("data-date"))[3]);
  await pickCalendarDay(b, dayChoice);
  await waitForDateValue(b, DATE, dayChoice, "the day chosen in the calendar");
  await shot("add-transaction-chosen-day");
  await (await panel.$("button=Add transaction")).click();
  await waitUntilOrDiagnose(b, async () => !(await b.$(".modal-panel").isExisting()), { timeoutMsg: "Add transaction should close once the date is a date" });
  assert.equal(await storedDate("Calendar Check"), dayChoice, "the day chosen in the calendar is the day saved");
  console.log(`PASS feature370 (screenshots in ${shotsDir})`);
} finally {
  await app.close();
}
