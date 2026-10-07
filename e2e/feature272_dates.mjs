// E2E test: one date format (UI review s5).
//
// - Lists write dates out: the Transactions table shows "Oct 4" for this year and "Oct 4, 2025" for
//   another year, never the stored "2026-10-04".
// - A date field (Add transaction) shows its date written out with the year ("Oct 4, 2026") while it
//   isn't being edited, and typing a date into the real date input underneath still saves it.
// - Fixing a row's date in the table goes through the same field and saves.
// - At rest, the written-out date starts where the input's own text would and stops before the calendar
//   button: in a labelled field (More filters), a compact row editor (Recurring) and a narrow goal form
//   at 800px, whose long hint may end in "…" but never runs under the button.
// - The date field's box matches the text fields beside it, and its written-out date sits where the
//   input's own text would, in Default, Futuristic and Retro, Light and Dark (screenshots saved).
// - Export CSV still writes the stored YYYY-MM-DD dates.
// - UAT s5.3: a date outside 1900-2100 (a slipped year such as 9643) is explained under the field and
//   Add transaction won't save it; correcting it clears the explanation.
// - UAT E.4: choosing a date in More filters adds Clear all, and the panel grows to fit instead of scrolling.
//
// Run with: node e2e/feature272_dates.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchApp, waitForDataLoaded, waitUntilOrDiagnose, withFocusRetry } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { DISPLAY_DATE, displayDate, fieldDate, isoDaysFromNow } from "./lib/dates.mjs";
import { enterTransactionAmount } from "./lib/transactionAmount.mjs";
import { readDateField, waitForDateFieldText } from "./lib/dateFields.mjs";

const TODAY = isoDaysFromNow(0);
const LAST_WEEK = isoDaysFromNow(-7);
const OLD = isoDaysFromNow(-400); // always last year or earlier
const TYPED = isoDaysFromNow(-3); // typed into Add transaction
const FIXED = isoDaysFromNow(-5); // set by fixing the row's date in the table

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '1000.00')")
acct = cur.lastrowid
for d, desc, amt in (("${TODAY}", "Corner Bakery", "-12.40"), ("${LAST_WEEK}", "Fuel Stop", "-41.00"), ("${OLD}", "Old Hardware Store", "-88.10")):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, amt, "Groceries", "user", f"{acct}|{d}|{desc.lower()}|{amt}"))
cur.execute("INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id) VALUES ('Streaming Plan', NULL, '-15.49', 'monthly', ?, ?)", ("${isoDaysFromNow(9)}", acct))
`);
const dbPath = path.join(dbDir, "vaultspend.db");
const shotsDir = process.env.VS_SCREENS_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-feature272-"));
fs.mkdirSync(shotsDir, { recursive: true });

const app = await launchApp({ dbDir, windowSize: { width: 1440, height: 1000 } });
const { browser } = app;

function storedDate(description) {
  const out = execFileSync("python", [
    "-c",
    `
import sqlite3, json
con = sqlite3.connect(r"${dbPath}")
row = con.execute("SELECT date FROM transactions WHERE description = ?", (${JSON.stringify(description)},)).fetchone()
print(json.dumps(row[0] if row else None))
`,
  ]);
  return JSON.parse(out.toString());
}

/** The date cell text of the ledger row whose description is `description` (null when not shown). */
const rowDateText = (description) =>
  browser.execute((desc) => {
    const row = [...document.querySelectorAll("table.ledger tbody tr[data-payment-row]")].find((r) => r.textContent.includes(desc));
    return row?.querySelector("td.date-col .date-cell")?.textContent.trim() ?? null;
  }, description);

async function waitForRowDate(description, expected) {
  let seen = null;
  await waitUntilOrDiagnose(browser, async () => (seen = await rowDateText(description)) === expected, {
    timeout: 15000,
    timeoutMsg: `the "${description}" row should show its date as "${expected}"`,
    extra: () => seen,
  });
}

async function openTransactions() {
  await (await browser.$(".nav-item[data-tab=ledger]")).click();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.querySelectorAll("table.ledger tbody tr[data-payment-row]").length >= 3), {
    timeout: 20000,
    timeoutMsg: "the Transactions table should list the three seeded transactions",
  });
}

async function openAddTransaction() {
  await (await browser.$("button*=Add transaction")).click();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => Boolean(document.querySelector('.modal-panel input[type="date"][aria-label="Date"]'))), {
    timeoutMsg: "Add transaction should open with a Date field",
  });
}

/** Geometry and look of the Add transaction date field next to the description field in the same dialog. */
const measureDialogFields = () =>
  browser.execute(() => {
    const date = document.querySelector('.modal-panel input[type="date"][aria-label="Date"]');
    const text = date.closest(".date-field").querySelector(".date-field-text");
    const desc = document.querySelector('.modal-panel input[placeholder=\'e.g. "Coffee shop"\']');
    const look = (el) => {
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return {
        height: Math.round(b.height * 10) / 10,
        width: Math.round(b.width * 10) / 10,
        border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
        radius: cs.borderTopLeftRadius,
        background: cs.backgroundColor,
        shadow: cs.boxShadow,
        color: cs.color,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        textLeft: b.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
      };
    };
    const t = text.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(text);
    const glyphs = range.getBoundingClientRect();
    const dateBox = date.getBoundingClientRect();
    return {
      date: look(date),
      desc: look(desc),
      text: {
        color: getComputedStyle(text).color,
        fontFamily: getComputedStyle(text).fontFamily,
        fontSize: getComputedStyle(text).fontSize,
        fontWeight: getComputedStyle(text).fontWeight,
        left: glyphs.left,
        middle: (glyphs.top + glyphs.bottom) / 2,
        inside: t.left >= dateBox.left - 0.5 && t.right <= dateBox.right + 0.5 && t.top >= dateBox.top - 0.5 && t.bottom <= dateBox.bottom + 0.5,
        visibility: getComputedStyle(text).visibility,
      },
      dateMiddle: (dateBox.top + dateBox.bottom) / 2,
    };
  });

/** Where a resting date field's written-out text sits against its input: where the input's own text
 * would start, and where its calendar button begins (the button is drawn inside the input's right
 * padding edge and is about 14px wide at these sizes, so text must end before that). */
const restingGeometry = (inputSelector) =>
  browser.execute((sel) => {
    const input = document.querySelector(sel);
    const wrapper = input?.closest(".date-field");
    if (!input || !wrapper) return null;
    const text = wrapper.querySelector(".date-field-text");
    const cs = getComputedStyle(input);
    const ts = getComputedStyle(text);
    const box = input.getBoundingClientRect();
    const t = text.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(text);
    const glyphs = range.getBoundingClientRect();
    const contentRight = box.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
    return {
      text: text.textContent,
      editing: wrapper.classList.contains("date-field-editing"),
      nativeLeft: box.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
      textLeft: glyphs.left,
      // The text box ends where its right padding starts; anything longer is cut off with "…" there.
      textRight: t.right - parseFloat(ts.paddingRight),
      buttonLeft: contentRight - 14,
      truncated: text.scrollWidth > text.clientWidth,
      width: box.width,
    };
  }, inputSelector);

function checkResting(g, where, { mayTruncate = false } = {}) {
  assert.ok(g, `${where}: no date field found`);
  assert.equal(g.editing, false, `${where}: the field should be at rest`);
  assert.ok(Math.abs(g.textLeft - g.nativeLeft) <= 1.5, `${where}: the written-out date should start where the input's text does: ${JSON.stringify(g)}`);
  assert.ok(g.textRight <= g.buttonLeft + 0.5, `${where}: the written-out date must stop before the calendar button: ${JSON.stringify(g)}`);
  if (!mayTruncate) assert.equal(g.truncated, false, `${where}: "${g.text}" should fit: ${JSON.stringify(g)}`);
  console.log(`${where}: "${g.text}" starts at ${g.textLeft.toFixed(1)} (input text ${g.nativeLeft.toFixed(1)}), ends by ${g.textRight.toFixed(1)} (button ~${g.buttonLeft.toFixed(1)})${g.truncated ? ", cut short with …" : ""}`);
}

try {
  await openTransactions();

  // ---- 1. Lists write dates out --------------------------------------------------------------
  const firstRowDate = await browser.execute(() => document.querySelector("table.ledger tbody tr[data-payment-row] td.date-col .date-cell")?.textContent.trim() ?? null);
  assert.ok(firstRowDate !== null && DISPLAY_DATE.test(firstRowDate), `the first row's date should read like "Oct 4", or "Oct 4" and a year, got "${firstRowDate}"`);
  await waitForRowDate("Corner Bakery", displayDate(TODAY));
  await waitForRowDate("Fuel Stop", displayDate(LAST_WEEK));
  await waitForRowDate("Old Hardware Store", displayDate(OLD));
  assert.match(displayDate(OLD), /, \d{4}$/, "a date from another year names its year");
  const isoOnScreen = await browser.execute(() => /\b\d{4}-\d{2}-\d{2}\b/.test(document.querySelector("table.ledger tbody").textContent));
  assert.equal(isoOnScreen, false, "no stored YYYY-MM-DD date should show in the table");
  console.log(`list dates: "${await rowDateText("Corner Bakery")}", "${await rowDateText("Old Hardware Store")}"`);

  // ---- 2. Add transaction: the date field reads "Oct 4, 2026"; typing a date still saves it -----
  await openAddTransaction();
  const dateInput = '.modal-panel input[type="date"][aria-label="Date"]';
  await waitForDateFieldText(browser, dateInput, fieldDate(TODAY), "Add transaction's Date field");
  const resting = await measureDialogFields();
  await browser.saveScreenshot(path.join(shotsDir, "272-add-transaction-resting.png"));
  assert.equal(resting.date.color, "rgba(0, 0, 0, 0)", "while it isn't being edited, the input's own mm/dd/yyyy text is hidden under the written-out date");

  // The real date input underneath takes typed digits, as a keyboard does.
  const [y, m, d] = TYPED.split("-");
  await (await browser.$(dateInput)).setValue(`${m}${d}${y}`);
  let typedValue = null;
  await waitUntilOrDiagnose(browser, async () => (typedValue = await (await browser.$(dateInput)).getValue()) === TYPED, {
    timeoutMsg: `typing ${m}/${d}/${y} into the Date field should set it to ${TYPED}`,
    extra: () => ({ typedValue, field: null }),
  });
  await (await browser.$('.modal-panel input[placeholder=\'e.g. "Coffee shop"\']')).setValue("Date Field Check");
  await enterTransactionAmount(browser, await browser.$(".modal-panel"), "-9.99");
  // Out of the date field, it reads the new date written out.
  await waitForDateFieldText(browser, dateInput, fieldDate(TYPED), "the Date field after typing a date");

  // A date far outside 1900-2100 (a slipped year, like 9643) is explained and can't be saved.
  const setDialogDate = (iso) =>
    browser.execute((iso) => {
      const input = document.querySelector('.modal-panel input[type="date"][aria-label="Date"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, iso);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, iso);
  await setDialogDate("9643-12-31");
  let problem = null;
  await waitUntilOrDiagnose(browser, async () => (problem = await browser.execute(() => document.querySelector(".modal-panel .date-field-problem")?.textContent ?? null)) === "Choose a date between 1900 and 2100.", {
    timeoutMsg: "a date in 9643 should be explained under the Date field",
    extra: () => problem,
  });
  await browser.saveScreenshot(path.join(shotsDir, "272-add-transaction-year-9643.png"));
  await (await (await browser.$(".modal-panel")).$("button=Add transaction")).click();
  await browser.pause(800);
  assert.equal(await browser.$(".modal-panel").isExisting(), true, "Add transaction stays open while the date is in 9643");
  assert.equal(storedDate("Date Field Check"), null, "nothing is saved with a date in 9643");
  assert.equal(
    await browser.execute(() => document.activeElement?.getAttribute("aria-label")),
    "Date",
    "refusing to save puts the cursor in the Date field to fix it",
  );
  // Corrected, the explanation goes and the date reads normally again.
  await setDialogDate(TYPED);
  await waitUntilOrDiagnose(browser, () => browser.execute(() => !document.querySelector(".modal-panel .date-field-problem")), {
    timeoutMsg: "correcting the date should clear the explanation",
  });
  // Out of the field again, it reads the corrected date written out.
  await (await browser.$(`.modal-panel input[placeholder='e.g. "Coffee shop"']`)).click();
  await waitForDateFieldText(browser, dateInput, fieldDate(TYPED), "the Date field after correcting the year");
  await (await (await browser.$(".modal-panel")).$("button=Add transaction")).click();
  await waitUntilOrDiagnose(browser, async () => !(await browser.$(".modal-panel").isExisting()), { timeoutMsg: "Add transaction should close after saving" });
  assert.equal(storedDate("Date Field Check"), TYPED, "the typed date is the one saved");
  await waitForRowDate("Date Field Check", displayDate(TYPED));

  // ---- 3. Fixing a row's date in the table uses the same field --------------------------------
  // Click the date, set the input underneath and press Enter in one step, so another window taking
  // focus (which blurs the field and saves it early) can't land between them.
  await browser.execute(() => {
    const row = [...document.querySelectorAll("table.ledger tbody tr[data-payment-row]")].find((r) => r.textContent.includes("Date Field Check"));
    row.querySelector("td.date-col .date-cell").click();
  });
  await waitUntilOrDiagnose(browser, () => browser.execute(() => Boolean(document.querySelector("table.ledger td.date-col .date-field input.row-edit-input"))), {
    timeoutMsg: "clicking a row's date should open the date field in its place",
  });
  const editing = await readDateField(browser, "table.ledger td.date-col input.row-edit-input");
  assert.equal(editing.value, TYPED, "the row's date field starts on the row's date");
  await browser.execute((iso) => {
    const input = document.querySelector("table.ledger td.date-col input.row-edit-input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, iso);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }, FIXED);
  await waitForRowDate("Date Field Check", displayDate(FIXED));
  let fixedStored = null;
  await waitUntilOrDiagnose(browser, async () => (fixedStored = storedDate("Date Field Check")) === FIXED, {
    timeoutMsg: `fixing the row's date should save ${FIXED}`,
    extra: () => fixedStored,
  });

  // ---- 3b. The resting text sits where the input's text would, clear of the calendar button ---------
  // A labelled field (Transactions > More filters, empty: "Any date").
  await withFocusRetry(browser, async () => {
    if (!(await browser.$('input[aria-label="From date"]').isExisting())) await (await browser.$("button*=More filters")).click();
    await waitForDateFieldText(browser, 'input[aria-label="From date"]', "Any date", "More filters' From date");
  });
  checkResting(await restingGeometry('input[aria-label="From date"]'), "More filters From date (.labeled-field)");
  // Choosing a date adds a Clear all row; the panel grows to fit it rather than scrolling inside.
  await browser.execute((iso) => {
    const input = document.querySelector('input[aria-label="From date"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, iso);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, LAST_WEEK);
  let panelFit = null;
  await waitUntilOrDiagnose(
    browser,
    async () =>
      (panelFit = await browser.execute(() => {
        const panel = document.querySelector(".more-filters-panel");
        const clear = [...(panel?.querySelectorAll("button") ?? [])].some((b) => b.textContent.trim() === "Clear all");
        return panel ? { clear, scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight } : null;
      }))?.clear === true,
    { timeoutMsg: "choosing a From date should add Clear all to More filters", extra: () => panelFit },
  );
  await browser.saveScreenshot(path.join(shotsDir, "272-more-filters-with-date.png"));
  assert.ok(panelFit.scrollHeight <= panelFit.clientHeight + 1, `More filters should show all its fields without scrolling: ${JSON.stringify(panelFit)}`);
  await browser.execute(() => [...document.querySelectorAll(".more-filters-panel button")].find((b) => b.textContent.trim() === "Clear all").click());
  await browser.keys("Escape");

  // A compact row editor at rest (Recurring > Edit on a bill: the row-edit-input date field).
  await (await browser.$(".nav-item[data-tab=recurring]")).click();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Edit")), {
    timeoutMsg: "the Recurring list should show the seeded bill with an Edit button",
  });
  await (await browser.$("button=Edit")).click();
  const rowEditDate = 'input.row-edit-input[aria-label="Next due date"]';
  await waitForDateFieldText(browser, rowEditDate, fieldDate(isoDaysFromNow(9)), "the bill's Next due date while editing the row");
  checkResting(await restingGeometry(rowEditDate), "Recurring row editor (.row-edit-input)");
  await (await browser.$("button=Cancel")).click();

  // A narrow field with a long hint: a new goal's target date at 800px may cut the hint short, but
  // never under the calendar button.
  await browser.setWindowSize(800, 600);
  await (await browser.$(".nav-item[data-tab=buckets]")).click();
  await (await browser.$("button=Create a goal")).click();
  const goalDate = 'input[aria-label="Target date (optional)"]';
  await waitForDateFieldText(browser, goalDate, "Target date (optional)", "a new goal's target date at 800px");
  checkResting(await restingGeometry(goalDate), "New goal at 800px (.bucket-new-form)", { mayTruncate: true });
  await (await browser.$("button=Cancel")).click();
  await browser.setWindowSize(1440, 1000);

  // ---- 4. The field's box matches the text fields, in every style ---------------------------------
  const failures = [];
  for (const style of ["transparent", "futuristic", "retro"]) {
    for (const theme of ["light", "dark"]) {
      await browser.execute(
        (s, t) => {
          localStorage.setItem("meadow-theme-style", s);
          localStorage.setItem("meadow-theme", t);
          localStorage.setItem("meadow-reduce-motion", "on");
          location.reload();
        },
        style,
        theme,
      );
      await waitUntilOrDiagnose(browser, () => browser.execute((s) => document.documentElement.dataset.palette === s && Boolean(document.querySelector(".nav-item")), style), {
        timeout: 20000,
        timeoutMsg: `expected the ${style} style after reloading`,
      });
      await waitForDataLoaded(browser);
      await openTransactions();
      await openAddTransaction();
      await waitForDateFieldText(browser, dateInput, fieldDate(TODAY), `${style}/${theme} Date field`);
      const f = await measureDialogFields();
      const where = `${style}/${theme}`;
      if (f.date.color !== "rgba(0, 0, 0, 0)") failures.push(`${where}: the input's own text shows (${f.date.color}) under the written-out date`);
      for (const p of ["border", "radius", "background", "shadow", "fontFamily", "fontSize"]) {
        if (f.date[p] !== f.desc[p]) failures.push(`${where}: the date field's ${p} is ${f.date[p]}, the description field's is ${f.desc[p]}`);
      }
      if (Math.abs(f.date.height - f.desc.height) > 1) failures.push(`${where}: the date field is ${f.date.height}px tall, the description field ${f.desc.height}px`);
      if (f.text.color !== f.desc.color) failures.push(`${where}: the written-out date is ${f.text.color}, field text is ${f.desc.color}`);
      if (f.text.fontFamily !== f.desc.fontFamily || f.text.fontSize !== f.desc.fontSize || f.text.fontWeight !== f.desc.fontWeight) failures.push(`${where}: the written-out date's font (${f.text.fontWeight} ${f.text.fontSize} ${f.text.fontFamily}) differs from the field text's (${f.desc.fontWeight} ${f.desc.fontSize} ${f.desc.fontFamily})`);
      if (!f.text.inside) failures.push(`${where}: the written-out date spills outside its field`);
      if (Math.abs(f.text.left - f.date.textLeft) > 1.5) failures.push(`${where}: the written-out date starts at x=${f.text.left}, the field's text at x=${f.date.textLeft}`);
      if (Math.abs(f.text.middle - f.dateMiddle) > 2) failures.push(`${where}: the written-out date isn't centred in its field (${f.text.middle} vs ${f.dateMiddle})`);
      if (f.text.visibility !== "visible") failures.push(`${where}: the written-out date is hidden while the field isn't being edited`);
      await browser.saveScreenshot(path.join(shotsDir, `272-add-transaction-${style}-${theme}.png`));
      await browser.keys("Escape");
      await waitUntilOrDiagnose(browser, async () => !(await browser.$(".modal-panel").isExisting()), { timeoutMsg: `${where}: Escape should close Add transaction` });
      console.log(`${where}: date field ${f.date.height}px, ${f.date.border}, ${f.date.radius}; text at ${f.text.left.toFixed(1)} vs ${f.date.textLeft.toFixed(1)}`);
    }
  }
  assert.deepEqual(failures, [], `the date field should look like the fields beside it:\n${failures.join("\n")}`);

  // ---- 5. Export CSV keeps the stored dates ----------------------------------------------------
  const exportPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-feature272-export-")), "transactions.csv");
  await browser.execute((answer) => {
    const original = window.fetch;
    window.fetch = function (input) {
      const url = decodeURIComponent(String(typeof input === "string" ? input : input.url));
      if (url.includes("ipc.localhost") && url.endsWith("plugin:dialog|save")) {
        return Promise.resolve(new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }));
      }
      if (!url.includes("ipc.localhost")) return original.apply(window, arguments);
      // A failed IPC fetch would switch Tauri to postMessage, past this wrapper (see stubFilePicker).
      const args = arguments;
      const attempt = (left) => original.apply(window, args).catch((e) => (left > 0 ? new Promise((r) => setTimeout(r, 150)).then(() => attempt(left - 1)) : Promise.reject(e)));
      return attempt(5);
    };
  }, exportPath);
  await openTransactions();
  const more = await browser.$(".more-menu button");
  await more.waitForExist({ timeout: 10000 });
  await more.click();
  const exportItem = await browser.$("button*=Export CSV");
  await exportItem.waitForExist({ timeout: 10000 });
  await exportItem.click();
  await waitUntilOrDiagnose(browser, async () => fs.existsSync(exportPath) && fs.readFileSync(exportPath, "utf8").includes("Date Field Check"), {
    timeout: 15000,
    timeoutMsg: `Export CSV should write ${exportPath}`,
  });
  const lines = fs.readFileSync(exportPath, "utf8").trim().split(/\r?\n/);
  assert.match(lines[0], /^Date,/, `the export starts with its Date column: ${lines[0]}`);
  const dates = lines.slice(1).map((l) => l.split(",")[0].replace(/"/g, ""));
  assert.ok(dates.length >= 4 && dates.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)), `every exported date is YYYY-MM-DD: ${dates.join(", ")}`);
  for (const iso of [TODAY, LAST_WEEK, OLD, FIXED]) assert.ok(dates.includes(iso), `the export has ${iso}: ${dates.join(", ")}`);
  console.log(`export dates: ${dates.join(", ")}`);
  console.log(`screenshots: ${shotsDir}`);

  console.log("FEATURE 272 E2E TEST PASSED");
} finally {
  await app.close();
}
