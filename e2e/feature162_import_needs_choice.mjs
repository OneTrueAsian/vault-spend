// The import review screen settles every row before anything is saved, and remembers the
// person's choice for a file's own category (2026-10-04).
//
//   1. A file with an unfamiliar category and a row the app can't place: Import stays off and says
//      how many rows still need a choice; mapping the file category settles its rows, and picking
//      a category settles the other. The pick is learned, the mapping remembered.
//   2. The next file: the remembered mapping is filled in and says so, the learned merchant needs
//      no choice, and "Leave the rest uncategorized" settles only the checked rows (an unchecked
//      row never holds Import up, and checking it again asks about it).
//   3. A refused import (the file changed, or a picked category was deleted) reads the file again and
//      keeps every choice that still applies; switching a
//      remembered file category to "Let the app guess" and importing forgets it.
//
// The native file picker is answered by wrapping window.fetch, as feature150 does: a
// `plugin:dialog|open` request gets the path of a CSV this spec wrote. Everything else is the
// real app. Set VAULTSPEND_E2E_SHOTS to a folder to save screenshots of the review screen.
//
// Run with: node e2e/run-all.mjs --spec=162

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseMenuOption, launchApp, menuOptionLabels, menuSelectValue, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);

const csvDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-e2e-needs-choice-"));
const writeCsv = (name, rows) => {
  const file = path.join(csvDir, name);
  fs.writeFileSync(file, ["Date,Description,Amount,Category", ...rows, ""].join("\n"));
  return file;
};
const first = writeCsv("first.csv", [
  `${dateInMonth(-1, 3)},QQXZ HOMEGOODS,-45.00,Merchandise`,
  `${dateInMonth(-1, 4)},QQXZ UNKNOWABLE,-9.99,`,
  `${dateInMonth(-1, 5)},QQXZ MARKET,-20.00,groceries`,
]);
const second = writeCsv("second.csv", [
  `${dateInMonth(-1, 10)},QQXZ HOMEGOODS 2,-15.00,MERCHANDISE`,
  `${dateInMonth(-1, 11)},QQXZ UNKNOWABLE,-8.00,`,
  `${dateInMonth(-1, 12)},QQXZ ODD ONE,-1.00,`,
  `${dateInMonth(-1, 13)},QQXZ ODD TWO,-2.00,`,
]);
const thirdRows = [`${dateInMonth(-1, 20)},QQXZ HOMEGOODS 3,-5.00,Merchandise`];
const third = writeCsv("third.csv", thirdRows);

const shots = process.env.VAULTSPEND_E2E_SHOTS;
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
const categoryOf = async (description, amount) =>
  (await invoke("list_transactions")).find((t) => t.description === description && (!amount || t.amount === amount))?.category ?? null;

const importButton = () => browser.$("button[data-import-confirm]");
const remainingText = async () => (await (await browser.$("#import-remaining-choices")).getText()).trim();
const needsChoiceRows = async () =>
  browser.execute(() => [...document.querySelectorAll("[data-import-choice-row]")].map((li) => Number(li.getAttribute("data-import-choice-row"))));
const rowMenu = (index) => browser.$(`button[data-import-row-choice][data-import-row-index="${index}"]`);
const panelMenu = (name) => browser.$(`button[data-import-category-choice][data-import-category-name="${name}"]`);
const reviewCheckbox = (description) => browser.$(`//table[contains(@class,'dup-review-table')]//tr[.//td[normalize-space()='${description}']]//input[@type='checkbox']`);

async function startImport() {
  await (await browser.$("button=Import transactions…")).click();
  const keep = await browser.$("button=Keep as-is");
  await keep.waitForDisplayed({ timeout: 10000, timeoutMsg: "the import should ask about signs first" });
  await keep.click();
  await (await importButton()).waitForDisplayed({ timeout: 10000, timeoutMsg: "the review screen should open" });
}

/** After an import: the review inbox opens on the new rows only when one of them needs a look
 * (uncategorized, unsure, ...). The status and the inbox are set together once the list refreshes. */
async function closeInboxIfOpen() {
  await waitUntilOrDiagnose(browser, async () => (await browser.execute(() => document.body.innerText)).includes("Imported "), {
    timeoutMsg: "the import should report what it saved",
  });
  const close = await browser.$("[data-inbox-close]");
  if (!(await close.isExisting())) return;
  await close.click();
  await close.waitForExist({ reverse: true, timeout: 5000 });
}

async function shoot(name) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await browser.saveScreenshot(path.join(shots, `feature162-${name}.png`));
}

try {
  await browser.setWindowSize(1440, 1000);
  await (await browser.$("button*=Transactions")).click();
  await browser.execute((files) => {
    const original = window.fetch;
    window.__pickedFiles = files;
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input.url;
      if (decodeURIComponent(String(url)).endsWith("plugin:dialog|open")) {
        const picked = window.__pickedFiles.shift();
        return Promise.resolve(new Response(JSON.stringify(picked), { status: 200, headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }));
      }
      return original.apply(window, arguments);
    };
  }, [first, second, third, third]);

  // ---- 1. Unfamiliar category + unplaceable row ------------------------------------------------
  await startImport();
  assert.deepEqual(await needsChoiceRows(), [0, 1], "the Merchandise row and the unknown merchant need a choice");
  assert.equal(await (await importButton()).isEnabled(), false, "Import waits for them");
  assert.equal(await remainingText(), "2 rows still need a category");
  assert.equal(await menuSelectValue(await rowMenu(1)), "", "nothing is preselected");
  await shoot("review-1440");
  await browser.setWindowSize(720, 900);
  await shoot("review-720");
  await browser.setWindowSize(1440, 1000);

  await chooseMenuOption(await panelMenu("Merchandise"), { value: "map:Shopping" });
  await waitUntilOrDiagnose(browser, async () => JSON.stringify(await needsChoiceRows()) === "[1]", {
    timeoutMsg: "mapping Merchandise should settle its row",
  });
  assert.equal(await remainingText(), "1 row still needs a category");
  await chooseMenuOption(await rowMenu(1), { value: "cat:Dining Out" });
  await (await importButton()).waitForEnabled({ timeout: 5000, timeoutMsg: "Import should turn on once every row has a choice" });
  assert.equal(await remainingText(), "");
  await (await importButton()).click();
  await waitUntilOrDiagnose(browser, async () => (await categoryOf("QQXZ UNKNOWABLE")) === "Dining Out", {
    timeoutMsg: "the picked category should be saved",
  });
  assert.equal(await categoryOf("QQXZ HOMEGOODS"), "Shopping");
  assert.equal(await categoryOf("QQXZ MARKET"), "Groceries");
  await closeInboxIfOpen();

  // ---- 2. The next file -------------------------------------------------------------------------
  await startImport();
  assert.equal(await menuSelectValue(await panelMenu("MERCHANDISE")), "map:Shopping", "the mapping is remembered under any casing");
  assert.match(await (await browser.$("[data-import-category-reconcile]")).getText(), /Your choice from last time/);
  assert.deepEqual(await needsChoiceRows(), [2, 3], "the learned merchant needs no choice; the two new ones do");

  await (await reviewCheckbox("QQXZ ODD TWO")).click();
  await waitUntilOrDiagnose(browser, async () => JSON.stringify(await needsChoiceRows()) === "[2]", {
    timeoutMsg: "an unchecked row should leave the list",
  });
  await (await browser.$("button=Leave the rest uncategorized")).click();
  await (await importButton()).waitForEnabled({ timeout: 5000, timeoutMsg: "Leave the rest should settle the checked row" });
  await (await reviewCheckbox("QQXZ ODD TWO")).click();
  await waitUntilOrDiagnose(browser, async () => JSON.stringify(await needsChoiceRows()) === "[2,3]", {
    timeoutMsg: "checking the row again should ask about it",
  });
  assert.equal(await (await importButton()).isEnabled(), false);
  assert.equal(await remainingText(), "1 row still needs a category");
  assert.equal(
    await (await browser.$('[data-import-choice-row="2"]')).getAttribute("data-choice-state"),
    "uncategorized",
    "the earlier choice is kept",
  );
  await (await browser.$("button=Leave the rest uncategorized")).click();
  await (await importButton()).waitForEnabled({ timeout: 5000 });
  await (await importButton()).click();
  await waitUntilOrDiagnose(browser, async () => (await categoryOf("QQXZ HOMEGOODS 2")) === "Shopping", {
    timeoutMsg: "the remembered mapping should be applied",
  });
  assert.equal(await categoryOf("QQXZ UNKNOWABLE", "-8.00"), "Dining Out", "the learned merchant is filed automatically");
  assert.equal(await categoryOf("QQXZ ODD ONE"), null);
  assert.equal(await categoryOf("QQXZ ODD TWO"), null, "a row left uncategorized stays that way");
  await closeInboxIfOpen();

  // ---- 3. A failed import keeps the choices; letting the app guess forgets the mapping ----------
  await startImport();
  await chooseMenuOption(await panelMenu("Merchandise"), { value: "skip" });
  await waitUntilOrDiagnose(browser, async () => JSON.stringify(await needsChoiceRows()) === "[0]", {
    timeoutMsg: "letting the app guess should ask about the row it can't place",
  });
  await chooseMenuOption(await rowMenu(0), { value: "cat:Shopping" });
  fs.writeFileSync(third, ["Date,Description,Amount,Category", ...thirdRows, `${dateInMonth(-1, 21)},QQXZ EXTRA,-1.00,`, ""].join("\n"));
  await (await importButton()).click();
  await waitUntilOrDiagnose(
    browser,
    async () => (await browser.execute(() => document.body.innerText)).includes("This file changed. Review it again before importing. The review has been updated from the changed file."),
    { timeoutMsg: "the refusal should be shown, with the review read again" },
  );
  assert.equal(await (await importButton()).isDisplayed(), true, "the review stays open");
  assert.equal(await menuSelectValue(await panelMenu("Merchandise")), "skip", "the file category choice is kept");
  assert.deepEqual(await needsChoiceRows(), [0, 1], "the changed file's rows are shown, its new row included");
  assert.equal(
    await (await browser.$('[data-import-choice-row="0"]')).getAttribute("data-choice-state"),
    "unresolved",
    "row picks start over, since the file's rows may be different rows now",
  );
  const kept = await invoke("preview_import", { path: third, invertAmounts: false, accountId: (await invoke("list_accounts"))[0].id });
  assert.equal(kept.unmatched_categories.find((u) => u.name === "Merchandise")?.remembered_category, "Shopping", "a failed import changes no memory");
  await (await browser.$("//div[contains(@class,'dup-review-actions')]//button[normalize-space()='Cancel']")).click();

  // A category deleted elsewhere while the review is open: the import is refused and names it, the
  // review is read again, and only the pick of the deleted category asks again.
  await startImport();
  await chooseMenuOption(await panelMenu("Merchandise"), { value: "skip" });
  await waitUntilOrDiagnose(browser, async () => JSON.stringify(await needsChoiceRows()) === "[0,1]", { timeoutMsg: "both rows should need a choice" });
  await chooseMenuOption(await rowMenu(0), { value: "cat:Entertainment" });
  await chooseMenuOption(await rowMenu(1), { value: "__leave__" });
  await invoke("delete_category", { name: "Entertainment" });
  await (await importButton()).waitForEnabled({ timeout: 5000 });
  await (await importButton()).click();
  await waitUntilOrDiagnose(browser, async () => (await browser.execute(() => document.body.innerText)).includes("The review has been updated. Check it and import again."), {
    timeoutMsg: "the refusal should say the review was updated",
  });
  assert.match(await browser.execute(() => document.body.innerText), /Entertainment/, "the refusal names the missing category");
  assert.equal(await (await browser.$('[data-import-choice-row="0"]')).getAttribute("data-choice-state"), "unresolved", "the pick of the deleted category asks again");
  assert.equal(await (await browser.$('[data-import-choice-row="1"]')).getAttribute("data-choice-state"), "uncategorized", "other picks are kept");
  assert.ok(!(await menuOptionLabels(await rowMenu(0))).includes("Entertainment"), "the deleted category is no longer offered");
  await (await browser.$("button=Leave the rest uncategorized")).click();
  await (await importButton()).waitForEnabled({ timeout: 5000 });
  await (await importButton()).click();
  await waitUntilOrDiagnose(browser, async () => (await invoke("list_transactions")).some((t) => t.description === "QQXZ HOMEGOODS 3"), {
    timeoutMsg: "the third file should be imported",
  });
  assert.equal(await categoryOf("QQXZ HOMEGOODS 3"), null);
  const after = await invoke("preview_import", { path: third, invertAmounts: false, accountId: (await invoke("list_accounts"))[0].id });
  assert.equal(after.unmatched_categories.find((u) => u.name === "Merchandise")?.remembered_category ?? null, null, "letting the app guess forgets the mapping");

  console.log("FEATURE 162 E2E TEST PASSED");
} finally {
  await app.close();
  fs.rmSync(csvDir, { recursive: true, force: true });
}
