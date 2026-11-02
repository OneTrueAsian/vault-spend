// UAT-068 (separate money-out / money-in columns), UAT-069 (blank and repeated headings, plain-language validation) and UAT-079 (files the importer cannot fully read:
// rows with a bad date or amount, a file with nothing readable, an empty file, a Latin-1 file, an Excel UTF-8 byte-order-mark file, Unicode QIF field codes and a large file).
// Driven through the real Import transactions gesture with the stubbed file picker, as feature315. Descriptions start QQXZ so the checks read only this spec's rows.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chooseMenuOption, launchApp, menuOptionLabels, stubFilePicker, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { startImportInto } from "./lib/importAccount.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);
const dir = makeTempDir("vaultspend-e2e-csv-bad-");
const d = n => dateInMonth(-1, n);
const write = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };
const split = write("split.csv", [`When,What,Out,In,Ref`, `${d(3)},QQXZ SPLIT CAFE,12.50,,r1`, `${d(4)},QQXZ SPLIT PAYROLL,,900.00,r2`, ""].join("\n"));
const repeated = write("repeated.csv", [`,Memo,,Memo,Amt`, `${d(5)},QQXZ WRONG ONE,x,QQXZ REPEATED SHOP,-5.00`, ""].join("\n"));
const mixed = write("mixed.csv", ["date,description,amount", `${d(6)},QQXZ GOOD ONE,-1.00`, `not-a-date,QQXZ BAD DATE,-2.00`, `${d(7)},QQXZ BAD AMOUNT,twelve`, `${d(8)},QQXZ GOOD TWO,-3.00`, ""].join("\n"));
const qifDate = iso => { const [year, month, day] = iso.split("-"); return `${month}/${day}/${year}`; };
const unicodeQif = write("unicode.qif", `!Type:Bank\nD${qifDate(d(6))}\néUnknown field\nT-7.00\nPQQXZ QIF FIRST\n^\n日本語\n^\nD${qifDate(d(8))}\nT-8.00\nPQQXZ QIF SECOND\n^\n`);
const unreadable = write("unreadable.csv", ["date,description,amount", `not-a-date,QQXZ NOPE A,-2.00`, `${d(9)},QQXZ NOPE B,abc`, ""].join("\n"));
const empty = write("empty.csv", "");
const latin = path.join(dir, "latin1.csv");
fs.writeFileSync(latin, Buffer.concat([Buffer.from(`date,description,amount\n${d(10)},QQXZ CAF`), Buffer.from([0xe9]), Buffer.from(` LATIN,-4.00\n`)]));
const ragged = write("ragged.csv", ["date,description,amount", `${d(10)},QQXZ RAGGED`, ""].join("\n"));
const bom = path.join(dir, "bom.csv");
fs.writeFileSync(bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`date,description,amount\n${d(11)},QQXZ BOM SHOP,-6.00\n`)]));
const largeRows = 2000;
const large = write("large.csv", ["date,description,amount", ...Array.from({ length: largeRows }, (_, i) => `${d(12)},QQXZ LARGE ${String(i).padStart(4, "0")},-${(i % 90) + 1}.00`), ""].join("\n"));

const app = await launchApp({ dbDir });
const { browser } = app;
async function invoke(command, args = {}) {
  const result = await browser.executeAsync((command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then((ok) => done({ ok }), (e) => done({ error: String(e) })), command, args);
  if (result.error) throw new Error(`${command} failed: ${result.error}`);
  return result.ok;
}
const qqxz = async () => (await invoke("list_transactions")).filter((t) => t.description.startsWith("QQXZ"));
const windowOpen = () => browser.execute(() => !!document.querySelector("[data-column-mapping]"));
const field = (name) => browser.$(`button[data-column-field="${name}"]`);
const continueButton = () => browser.$("button[data-column-continue]");
const problem = async () => (await (await browser.$("[data-column-problem]")).getText()).trim();
const reviewRows = () => browser.execute(() => [...document.querySelectorAll("[role='dialog'] table.dup-review-table tbody tr")].map((tr) => tr.innerText));
const summary = () => browser.execute(() => document.querySelector("[role='dialog'] .dup-review-summary")?.innerText ?? null);
const dialogText = () => browser.execute(() => document.querySelector("[role='dialog']")?.innerText ?? "");
async function startWith(file) {
  console.log("STEP " + path.basename(file));
  await browser.execute((f) => window.__pickedFiles.unshift(f), file);
  await startImportInto(browser, "Checking");
}
async function reachReview() {
  await waitUntilOrDiagnose(browser, async () => {
    const keep = await browser.$("button=Keep as-is");
    if (await keep.isDisplayed().catch(() => false)) await keep.click();
    return browser.execute(() => !!document.querySelector("button[data-import-confirm]") || !!document.querySelector("[role='dialog'] .dup-review-summary"));
  }, { timeout: 30000, timeoutMsg: "the review (or its nothing-to-import notice) should open", extra: dialogText });
}
async function closeReview() {
  const confirm = await browser.$("button[data-import-confirm]");
  if (await confirm.isExisting()) {
    const cancel = await browser.$("button=Cancel");
    if (await cancel.isExisting()) await cancel.click();
    else await browser.keys("Escape");
  } else await browser.keys("Escape");
  await waitUntilOrDiagnose(browser, async () => !(await browser.execute(() => !!document.querySelector("[role='dialog'] .dup-review-summary, button[data-import-confirm]"))), { timeout: 10000, timeoutMsg: "the review closes without importing", extra: dialogText });
}
async function confirmImport() {
  const leaveRest = await browser.$("button=Leave the rest uncategorized");
  if (await leaveRest.isExisting()) await leaveRest.click();
  const confirm = await browser.$("button[data-import-confirm]");
  await confirm.waitForEnabled({ timeout: 10000 });
  await confirm.click();
  await waitUntilOrDiagnose(browser, async () => !(await browser.execute(() => !!document.querySelector("button[data-import-confirm]"))), { timeout: 60000, timeoutMsg: "the review closes once imported" });
  const close = await browser.$("[data-inbox-close]");
  if (await close.isExisting()) await close.click();
}
try {
  await browser.setWindowSize(1440, 900);
  for (const b of await browser.$$("nav button")) if ((await b.getText()).trim() === "Transactions") { await b.click(); break; }
  await (await browser.$("table.ledger")).waitForExist({ timeout: 15000 });
  await stubFilePicker(browser, []);

  // --- UAT-068: money out and money in in separate columns, in a different order from the usual -----------------------------------
  await startWith(split);
  await waitUntilOrDiagnose(browser, windowOpen, { timeoutMsg: "unknown headers open Match your columns" });
  await chooseMenuOption(await field("date"), { label: "When" });
  await chooseMenuOption(await field("description"), { label: "What" });
  await (await browser.$("[data-column-split]")).click();
  assert.equal(await (await field("amount")).isExisting(), false, "the single amount question is replaced");
  assert.equal(await (await continueButton()).isEnabled(), false);
  assert.equal(await problem(), "Pick the column that has the money out.");
  await chooseMenuOption(await field("debit"), { label: "Out" });
  assert.equal(await problem(), "Pick the column that has the money in.");
  await chooseMenuOption(await field("credit"), { label: "In" });
  await (await continueButton()).waitForEnabled({ timeout: 5000, timeoutMsg: "Continue turns on once both money columns are picked" });
  await (await continueButton()).click();
  await reachReview();
  const splitRows = await reviewRows();
  assert.equal(splitRows.length, 2, JSON.stringify(splitRows));
  assert.ok(splitRows.find((r) => r.includes("QQXZ SPLIT CAFE")).includes("12.50"));
  assert.ok(splitRows.find((r) => r.includes("QQXZ SPLIT PAYROLL")).includes("900.00"));
  await confirmImport();
  const byDesc = Object.fromEntries((await qqxz()).map((t) => [t.description, Number(t.amount)]));
  assert.equal(byDesc["QQXZ SPLIT CAFE"], -12.5, "money out is stored negative");
  assert.equal(byDesc["QQXZ SPLIT PAYROLL"], 900, "money in is stored positive");

  // --- UAT-069: blank and repeated headings are told apart; each mistake is explained and blocks Continue ------------------------------
  await startWith(repeated);
  await waitUntilOrDiagnose(browser, windowOpen, { timeoutMsg: "a file with blank and repeated headings opens Match your columns" });
  const labels = await menuOptionLabels(await field("date"));
  assert.deepEqual(labels, ["Column 1", "Memo (column 2)", "Column 3", "Memo (column 4)", "Amt"], "blank headings are numbered and repeated ones say which column");
  await chooseMenuOption(await field("date"), { label: "Column 1" });
  await chooseMenuOption(await field("description"), { label: "Column 1" });
  await chooseMenuOption(await field("amount"), { label: "Amt" });
  assert.equal(await (await continueButton()).isEnabled(), false);
  assert.equal(await problem(), "Pick a different column for each question.", "the same column twice is explained");
  await chooseMenuOption(await field("description"), { label: "Memo (column 4)" });
  await (await continueButton()).waitForEnabled({ timeout: 5000 });
  await (await continueButton()).click();
  await reachReview();
  const rep = await reviewRows();
  assert.equal(rep.length, 1, JSON.stringify(rep));
  assert.ok(rep[0].includes("QQXZ REPEATED SHOP") && !rep[0].includes("WRONG ONE"), "the chosen repeated column is the one read: " + rep[0]);
  await confirmImport();

  // --- UAT-079: files the importer cannot fully read -----------------------------------------------------------------------------------
  // Some rows bad: the good ones can be imported, the bad ones are counted in plain words and never imported.
  await startWith(mixed);
  await reachReview();
  assert.equal((await reviewRows()).length, 2, "only the two readable rows are offered");
  assert.ok((await summary()).includes("2 rows couldn't be read"), await summary());
  await confirmImport();
  const names = (await qqxz()).map((t) => t.description);
  assert.ok(names.includes("QQXZ GOOD ONE") && names.includes("QQXZ GOOD TWO"));
  assert.ok(!names.includes("QQXZ BAD DATE") && !names.includes("QQXZ BAD AMOUNT"), "bad rows were not imported");

  // Unknown QIF field codes can be Unicode: ignore them safely and report an invalid record normally.
  await startWith(unicodeQif);
  await reachReview();
  assert.equal((await reviewRows()).length, 2, "valid QIF records on both sides of an invalid record are offered");
  assert.ok((await summary()).includes("1 row couldn't be read"), await summary());
  await confirmImport();
  const qifAmounts = Object.fromEntries((await qqxz()).filter(t => t.description.startsWith("QQXZ QIF")).map(t => [t.description, Number(t.amount)]));
  assert.deepEqual(qifAmounts, { "QQXZ QIF FIRST": -7, "QQXZ QIF SECOND": -8 });

  // Nothing readable: a plain notice, nothing to import.
  const before = (await qqxz()).length;
  await startWith(unreadable);
  await reachReview();
  assert.ok((await summary()).includes("No transactions could be read from this file. 2 rows couldn't be read."), await summary());
  const nothing = await browser.$("button[data-import-confirm]");
  assert.ok(!(await nothing.isExisting()) || !(await nothing.isEnabled()), "there is nothing to import");
  await closeReview();
  assert.equal((await qqxz()).length, before);

  // An empty file.
  await startWith(empty);
  await (await browser.$("button=Keep as-is")).click();
  await reachReview();
  assert.ok((await summary()).includes("No transactions were found in this file."), await summary());
  assert.equal(await (await browser.$("button[data-import-confirm]")).isEnabled(), false, "there is nothing to import");
  await closeReview();

  // A file saved by Excel as "CSV UTF-8" (byte-order-mark) reads like any other.
  await startWith(bom);
  await reachReview();
  assert.ok((await reviewRows())[0].includes("QQXZ BOM SHOP"), "a byte-order-mark file reads normally");
  await confirmImport();

  // Files the reader cannot decode or whose rows differ in width: a plain message that says what to do, never the library's own wording.
  const technical = /panic|stream did not|invalid (data|utf)|CSV (parse )?error|record [0-9]|byte|0x[0-9a-f]+|\.rs:/i;
  const refusal = async (file) => {
    // The previous refusal's message stays up for a while; wait for it to go so this file's own message is the one read.
    await waitUntilOrDiagnose(browser, async () => (await browser.execute(() => document.querySelectorAll(".status .status-text").length)) === 0, { timeout: 30000, timeoutMsg: "earlier messages have cleared" });
    await startWith(file);
    const trail = [];
    for (let i = 0; i < 10; i++) {
      const keep = await browser.$("button=Keep as-is");
      if (await keep.isDisplayed().catch(() => false)) await keep.click();
      trail.push(await browser.execute(() => [...document.querySelectorAll(".status .status-text, [role='alert'], [role='dialog']")].map((n) => n.textContent.trim().slice(0, 300))));
      await browser.pause(400);
    }
    if (await browser.execute(() => !!document.querySelector("[role='dialog']"))) await closeReview();
    const all = [...new Set(trail.flat())];
    console.log("REFUSAL " + path.basename(file) + ": " + JSON.stringify(all));
    return all.filter((t) => t.includes("so it can't be read"));
  };
  const latinMessages = await refusal(latin);
  assert.equal(latinMessages.length > 0, true, "a Latin-1 file is refused with a message");
  assert.ok(latinMessages[0].includes("CSV UTF-8") && !technical.test(latinMessages[0]), "plain advice to save as CSV UTF-8: " + latinMessages[0]);
  const raggedMessages = await refusal(ragged);
  assert.equal(raggedMessages.length > 0, true, "a ragged file is refused with a message");
  assert.ok(raggedMessages[0].includes("different number of columns") && !technical.test(raggedMessages[0]), "plain advice about row width: " + raggedMessages[0]);
  assert.equal((await qqxz()).some((t) => t.description.includes("LATIN") || t.description.includes("RAGGED")), false, "neither refused file imported anything");

  // A large file imports in full.
  await startWith(large);
  await reachReview();
  assert.equal((await reviewRows()).length, largeRows, "every row of a large file is offered");
  await confirmImport();
  assert.equal((await qqxz()).filter((t) => t.description.startsWith("QQXZ LARGE")).length, largeRows, "every row of a large file is imported");
  console.log("FEATURE 345 PASSED: split money columns, repeated and blank headings, bad rows, Unicode QIF fields, empty/unreadable/BOM/Latin-1 files and a 2,000-row file behave as described.");
} finally {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
