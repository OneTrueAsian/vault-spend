// A CSV whose headers the importer doesn't know opens "Match your columns" (2026-10-13).
//
//   1. Headers Posted,Memo,Amt: the window opens instead of an error and Continue is off.
//   2. Picking the date, description and amount turns Continue on; the normal review then lists the
//      file's three rows with the right amounts, and importing succeeds.
//   3. A second file with the same headers goes straight to the review: the choice was remembered.
//   4. A third file with one header renamed (Memo -> Details) opens the window again, with the
//      columns that still match already filled in.
//   5. Cancel on the window imports nothing and leaves the account as it was.
//
// The native file picker is answered by stubFilePicker (harness.mjs), as in feature162/164. The
// dropdowns are the app's MenuSelect, driven with chooseMenuOption. Set VAULTSPEND_E2E_SHOTS to a
// folder to save a screenshot of the window.
//
// Run with: node e2e/run-all.mjs --spec=315

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chooseMenuOption, launchApp, menuSelectValue, stubFilePicker, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { startImportInto } from "./lib/importAccount.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);

const dir = makeTempDir("vaultspend-e2e-csv-columns-");
const write = (name, header, rows) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, [header, ...rows, ""].join("\n"));
  return file;
};
const first = write("first.csv", "Posted,Memo,Amt", [
  `${dateInMonth(-1, 3)},QQXZ ALPHA CAFE,-12.50`,
  `${dateInMonth(-1, 4)},QQXZ BRAVO MARKET,-40.00`,
  `${dateInMonth(-1, 5)},QQXZ CHARLIE PAYROLL,1500.00`,
]);
const second = write("second.csv", "Posted,Memo,Amt", [`${dateInMonth(-1, 6)},QQXZ DELTA GAS,-30.25`]);
const fifth = write("fifth.csv", "Posted,Memo,Amt", [`${dateInMonth(-1, 9)},QQXZ GOLF HARDWARE,-22.00`]);
const sixth = write("sixth.csv", "Posted,Memo,Amt,Fee", [`${dateInMonth(-1, 10)},QQXZ HOTEL SHOP,-50.00,-3.00`]);
const third = write("third.csv", "Posted,Details,Amt", [`${dateInMonth(-1, 7)},QQXZ ECHO BOOKS,-18.75`]);

const app = await launchApp({ dbDir });
const { browser } = app;

async function invoke(command, args = {}) {
  const result = await browser.executeAsync(
    (command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then((ok) => done({ ok }), (e) => done({ error: String(e) })),
    command,
    args,
  );
  if (result.error) throw new Error(`${command} failed: ${result.error}`);
  return result.ok;
}
const qqxz = async () => (await invoke("list_transactions")).filter((t) => t.description.startsWith("QQXZ"));
const windowOpen = () => browser.execute(() => !!document.querySelector("[data-column-mapping]"));
const field = (name) => browser.$(`button[data-column-field="${name}"]`);
const continueButton = () => browser.$("button[data-column-continue]");
async function shot(name) {
  if (process.env.VAULTSPEND_E2E_SHOTS) await browser.saveScreenshot(`${process.env.VAULTSPEND_E2E_SHOTS}/feature315-${name}.png`);
}
async function startImport() {
  await startImportInto(browser, "Checking");
}
async function nav(label) {
  for (const b of await browser.$$("nav button")) if ((await b.getText()).trim() === label) return b.click();
  throw new Error(`no nav button ${label}`);
}
/** Waits for the review's Import button, answering the sign question if it comes first. */
async function reachReview() {
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const keep = await browser.$("button=Keep as-is");
      if (await keep.isDisplayed().catch(() => false)) await keep.click();
      return browser.execute(() => !!document.querySelector("button[data-import-confirm]"));
    },
    { timeoutMsg: "the review should open" },
  );
}
const reviewText = () => browser.execute(() => document.querySelector("[role='dialog']")?.innerText ?? "");
/** The text of each row of the review's table, one string per row. */
const reviewRows = () => browser.execute(() => [...document.querySelectorAll("[role='dialog'] table.dup-review-table tbody tr")].map((tr) => tr.innerText));
async function confirmImport() {
  const leaveRest = await browser.$("button=Leave the rest uncategorized");
  if (await leaveRest.isExisting()) await leaveRest.click();
  const confirm = await browser.$("button[data-import-confirm]");
  await confirm.waitForEnabled({ timeout: 10000 });
  await confirm.click();
  await waitUntilOrDiagnose(browser, async () => !(await browser.execute(() => !!document.querySelector("button[data-import-confirm]"))), {
    timeoutMsg: "the review should close once imported",
  });
  const close = await browser.$("[data-inbox-close]");
  if (await close.isExisting()) await close.click();
}

try {
  await browser.setWindowSize(1440, 900);
  await nav("Transactions");
  await (await browser.$("table.ledger")).waitForExist({ timeout: 15000 });
  await stubFilePicker(browser, [first]);

  // ---- 1. Unknown headers open the window, Continue off ----------------------------------------------
  await startImport();
  await waitUntilOrDiagnose(browser, windowOpen, { timeoutMsg: "unknown headers should open Match your columns" });
  assert.equal(await (await continueButton()).isEnabled(), false, "Continue is off until the columns are picked");
  await browser.pause(400); // let the dialog finish fading in before the screenshot
  await shot("window-empty");

  // ---- 2. Pick the columns: Continue on, the review lists the three rows -------------------------------
  await chooseMenuOption(await field("date"), { label: "Posted" });
  await chooseMenuOption(await field("description"), { label: "Memo" });
  await chooseMenuOption(await field("amount"), { label: "Amt" });
  await (await continueButton()).waitForEnabled({ timeout: 5000, timeoutMsg: "Continue should turn on once date, description and amount are picked" });
  await shot("window-filled");
  await (await continueButton()).click();
  await reachReview();
  const rows = await reviewRows();
  assert.equal(rows.length, 3, `the review should list exactly the file's three rows, got: ${JSON.stringify(rows)}`);
  for (const [desc, amount] of [["QQXZ ALPHA CAFE", "12.50"], ["QQXZ BRAVO MARKET", "40.00"], ["QQXZ CHARLIE PAYROLL", "1,500.00"]]) {
    const row = rows.filter((text) => text.includes(desc));
    assert.equal(row.length, 1, `the review should list ${desc} once`);
    assert.ok(row[0].includes(amount), `${desc}'s own row should show ${amount}, but reads: ${row[0]}`);
    for (const other of ["12.50", "40.00", "1,500.00"]) {
      if (other !== amount) assert.ok(!row[0].includes(other), `${desc}'s row should not show ${other}: ${row[0]}`);
    }
  }
  await confirmImport();
  const afterFirst = await qqxz();
  assert.equal(afterFirst.length, 3, "all three rows are imported");
  const byDesc = Object.fromEntries(afterFirst.map((t) => [t.description, Number(t.amount)]));
  assert.equal(byDesc["QQXZ ALPHA CAFE"], -12.5);
  assert.equal(byDesc["QQXZ BRAVO MARKET"], -40);
  assert.equal(byDesc["QQXZ CHARLIE PAYROLL"], 1500);

  // ---- 3. Same headers again: straight to the review ---------------------------------------------------
  await browser.execute((file) => window.__pickedFiles.unshift(file), second);
  await startImport();
  await reachReview();
  assert.equal(await windowOpen(), false, "the remembered columns skip the window");
  assert.ok((await reviewText()).includes("QQXZ DELTA GAS"), "the second file's row is in the review");
  await confirmImport();
  assert.equal((await qqxz()).length, 4);

  // ---- 4. A renamed header opens the window again, other fields pre-filled -----------------------------
  await browser.execute((file) => window.__pickedFiles.unshift(file), third);
  await startImport();
  await waitUntilOrDiagnose(browser, windowOpen, { timeoutMsg: "a renamed header should open the window again" });
  assert.equal(await menuSelectValue(await field("date")), "0", "Posted is still the date");
  assert.equal(await menuSelectValue(await field("amount")), "2", "Amt is still the amount");
  assert.equal(await (await continueButton()).isEnabled(), false, "the renamed column still needs a choice");
  await chooseMenuOption(await field("description"), { label: "Details" });
  await (await continueButton()).waitForEnabled({ timeout: 5000 });

  // ---- 5. Cancel imports nothing ------------------------------------------------------------------------
  await (await browser.$("button[data-column-cancel]")).click();
  await waitUntilOrDiagnose(browser, async () => !(await windowOpen()), { timeoutMsg: "Cancel should close the window" });
  await browser.pause(500);
  assert.equal(await browser.execute(() => !!document.querySelector("button[data-import-confirm]")), false, "no review after Cancel");
  assert.equal((await qqxz()).length, 4, "Cancel imports nothing");

  // ---- 6. The cancelled file changed nothing that was remembered ---------------------------------------
  await browser.execute((file) => window.__pickedFiles.unshift(file), fifth);
  await startImport();
  await reachReview();
  assert.equal(await windowOpen(), false, "the original headers still skip the window after a cancelled import");
  const lastRows = await reviewRows();
  assert.equal(lastRows.length, 1);
  assert.ok(lastRows[0].includes("QQXZ GOLF HARDWARE") && lastRows[0].includes("22.00"), `the last file's row is in the review: ${lastRows[0]}`);
  await confirmImport();
  const final = await qqxz();
  assert.equal(final.length, 5, "the last file's row is imported");
  assert.equal(final.some((t) => t.description === "QQXZ ECHO BOOKS"), false, "the cancelled file's row never arrived");

  // ---- 7. A remembered choice can be changed from the review -----------------------------------------
  await browser.execute((file) => window.__pickedFiles.unshift(file), sixth);
  await startImport();
  await reachReview();
  assert.equal(await windowOpen(), false, "the remembered columns skip the window");
  const note = await browser.execute(() => document.querySelector("[data-import-columns-note]")?.innerText ?? "");
  assert.ok(note.includes("Using the columns you picked last time."), `the review says which columns it used: ${note}`);
  assert.ok((await reviewRows())[0].includes("50.00"), "the remembered amount column is used first");
  await browser.pause(400);
  await shot("review-columns-note");
  // Cancel on the window keeps the review as it was.
  await (await browser.$("button[data-change-columns]")).click();
  await waitUntilOrDiagnose(browser, windowOpen, { timeoutMsg: "Change columns should open the window" });
  assert.equal(await menuSelectValue(await field("amount")), "2", "the window starts from the columns in use");
  assert.equal(await menuSelectValue(await field("description")), "1");
  await (await browser.$("button[data-column-cancel]")).click();
  await waitUntilOrDiagnose(browser, async () => !(await windowOpen()), { timeoutMsg: "Cancel should close the window" });
  assert.ok((await reviewRows())[0].includes("50.00"), "cancelling the change keeps the review");
  // Picking another amount column reads the file again.
  await (await browser.$("button[data-change-columns]")).click();
  await waitUntilOrDiagnose(browser, windowOpen, { timeoutMsg: "Change columns should open the window again" });
  await chooseMenuOption(await field("amount"), { label: "Fee" });
  await (await continueButton()).click();
  await waitUntilOrDiagnose(browser, async () => (await reviewRows()).some((r) => r.includes("3.00") && !r.includes("50.00")), {
    timeoutMsg: "the review should show the new amount column",
    extra: reviewRows,
  });
  assert.ok((await reviewText()).includes("Using the columns you picked."), "a choice made now is not called 'last time'");
  assert.ok(!(await reviewText()).includes("last time"));
  await confirmImport();
  const hotel = (await qqxz()).find((t) => t.description === "QQXZ HOTEL SHOP");
  assert.equal(Number(hotel.amount), -3, "the changed column is what was imported");

  console.log("FEATURE 315 E2E TEST PASSED");
} finally {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
