// Watched-folder bank imports (VS-102), in the compiled app with its real native discovery thread.
//
//   1. Settings → Data → Folder imports: the folder is chosen through the folder picker and watching is
//      turned on; Settings search finds the card.
//   2. A new CSV export and a new .xlsx workbook export in the folder are queued without any file picking;
//      an older export (dated before the start date) is skipped and explained. Nothing reaches the ledger.
//   3. On a ledger of 160 rows, the waiting-exports notice and Folder activity sit above the table.
//   4. Review opens the workbook's transaction review directly; a row the bank shows as pending starts
//      unticked; Review later closes it and keeps it waiting.
//   5. The CSV export is imported; the workbook is dismissed; the older file's Review again opens its review
//      in one click; Review later. Only the CSV's rows are in the ledger.
//   6. At 800x600 Folder activity is still reachable.
//
// Run with: npm run e2e -- --spec=430

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose, stubFilePicker, openSettingsGroup } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";
import { minimalXlsx } from "./lib/practice-data/xlsxPractice.mjs";

const iso = (daysAgo) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Max Checking', 'checking', '5000.00')")
a = cur.lastrowid
for i in range(160):
    date = (today - datetime.timedelta(days=20 + i % 60)).isoformat()
    desc = f"QQXZ LEDGER {i:03d}"
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, 'Groceries', ?)",
        (a, date, desc, "-1.00", f"{a}|{date}|{desc.lower()}|-1.00"),
    )
`);

const folder = makeTempDir("vaultspend-e2e-folder-imports-");
const shots = process.env.VS_SCREENS_DIR || makeTempDir("vaultspend-e2e-folder-imports-shots-");
const csvName = `Bank Max Checking_${iso(3)}_to_${iso(1)}.csv`;
const bookName = `Bank Max Checking_${iso(1)}.xlsx`;
const olderName = `Bank Max Checking_${iso(30)}.csv`;
// Lowercase, reordered columns with extra bank metadata; spending is negative as written.
fs.writeFileSync(path.join(folder, csvName), `bank,date,amount,description,currency\nPractice Bank,${iso(2)},-4.25,QQXZ FOLDER CAFE,USD\nPractice Bank,${iso(1)},-30.00,QQXZ FOLDER MARKET,USD\n`);
fs.writeFileSync(
  path.join(folder, bookName),
  minimalXlsx([
    ["date", "description", "amount", "pending"],
    [{ date: iso(1) }, "QQXZ WORKBOOK SHOP", -18.75, "false"],
    [{ date: iso(1) }, "QQXZ WORKBOOK PENDING", -7.2, "true"],
  ]),
);
fs.writeFileSync(path.join(folder, olderName), `Date,Description,Amount\n${iso(30)},QQXZ OLDER EXPORT,-9.00\n`);
fs.writeFileSync(path.join(folder, "holiday notes.txt"), "not an export");
// Finished long ago as far as discovery is concerned, so the first pass reads them.
const minuteAgo = new Date(Date.now() - 60_000);
for (const name of fs.readdirSync(folder)) fs.utimesSync(path.join(folder, name), minuteAgo, minuteAgo);

let app = await launchApp({ dbDir });
let { browser } = app;

async function invoke(command, args = {}) {
  const result = await browser.executeAsync(
    (command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then((ok) => done({ ok }), (e) => done({ error: String(e) })),
    command,
    args,
  );
  if (result.error) throw new Error(`${command} failed: ${result.error}`);
  return result.ok;
}
// Dialogs fade in over 160 ms; capture once they have settled.
const shot = async (name) => {
  await browser.pause(300);
  await browser.saveScreenshot(path.join(shots, `feature430-${name}.png`));
};
const dialogTitle = () => browser.execute(() => document.querySelector("[role='dialog'] .modal-title")?.textContent ?? null);
const text = (selector) => browser.execute((s) => document.querySelector(s)?.textContent ?? null, selector);
const click = (selector) => browser.execute((s) => document.querySelector(s).click(), selector);
const ledgerDescriptions = async () => (await invoke("list_transactions")).map((t) => t.description);
async function nav(label) {
  for (const b of await browser.$$("nav button")) if ((await b.getText()).trim() === label) return b.click();
  throw new Error(`no nav button ${label}`);
}
async function waitForDialog(title, what) {
  await waitUntilOrDiagnose(browser, async () => (await dialogTitle()) === title, { timeoutMsg: what, extra: dialogTitle });
}

try {
  await browser.setWindowSize(1280, 800);
  const [account] = await invoke("list_accounts");

  // ---- 1. Settings → Data → Folder imports ----------------------------------------------------
  await stubFilePicker(browser, [folder]);
  await openSettingsGroup(browser, "data");
  await (await browser.$("[data-folder-imports-settings]")).waitForExist({ timeout: 10000 });
  const toggle = await browser.$("[data-folder-imports-toggle] input");
  assert.equal(await toggle.isSelected(), false, "folder imports start off");
  await click("[data-folder-choose]");
  await waitUntilOrDiagnose(browser, async () => (await text("[data-folder-imports-settings]"))?.includes("Watching "), {
    timeoutMsg: "choosing the folder through the picker should keep it",
  });
  await invoke("save_folder_import_mapping", {
    mapping: { id: null, account_id: account.id, stem: "Bank Max Checking_", extensions: ["csv", "xlsx"], invert_amounts: false, initial_cutoff: iso(7) },
  });
  // Settings reads the new export name when it is next shown; the toggle stays off until one exists.
  await nav("Transactions");
  await openSettingsGroup(browser, "data");
  await waitUntilOrDiagnose(browser, async () => !(await (await browser.$("[data-folder-imports-toggle] input")).getAttribute("disabled")), {
    timeoutMsg: "with a folder and an export name, watching can be turned on",
  });
  await click("[data-folder-imports-toggle] input");
  await waitUntilOrDiagnose(browser, async () => (await (await browser.$("[data-folder-imports-toggle] input")).isSelected()), {
    timeoutMsg: "the switch should turn on",
  });
  // A real bank's export name is long: the name box shows all of it.
  await click("[data-folder-add-mapping]");
  const longName = "Lake Michigan Credit Union - Household (02)";
  await (await browser.$("[data-folder-mapping='new'] [data-folder-stem]")).setValue(longName);
  const fit = await browser.execute(() => {
    const input = document.querySelector("[data-folder-mapping='new'] [data-folder-stem]");
    return { scroll: input.scrollWidth, client: input.clientWidth };
  });
  assert.ok(fit.scroll <= fit.client, `"${longName}" fits in the name box (${fit.scroll}px of text in ${fit.client}px)`);
  await click("[data-folder-remove-mapping='new']");
  await browser.execute(() => document.querySelector("[data-folder-imports-settings]").scrollIntoView({ block: "start" }));
  await shot("01-settings");

  // ---- 2 and 3. Discovery, the notice and Folder activity above a long ledger ------------------
  await nav("Transactions");
  await (await browser.$("table.ledger")).waitForExist({ timeout: 15000 });
  await invoke("scan_folder_imports_now");
  await waitUntilOrDiagnose(browser, async () => (await text("[data-folder-pending-notice]"))?.includes("2 new bank exports are waiting"), {
    timeout: 20000,
    timeoutMsg: "the two new exports should be queued without picking a file",
    extra: () => text("[data-folder-pending-notice]"),
  });
  const ledgerBefore = await ledgerDescriptions();
  assert.equal(ledgerBefore.length, 160, "queued exports are not in the ledger");
  const geometry = await browser.execute(() => {
    const top = (s) => document.querySelector(s)?.getBoundingClientRect().top ?? null;
    return { notice: top("[data-folder-pending-notice]"), button: top("[data-folder-activity-open]"), table: top("table.ledger") };
  });
  assert.ok(geometry.button !== null && geometry.button < geometry.table && geometry.button < 300, `Folder activity is above the ledger: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.notice < geometry.table, "the notice is above the ledger");
  assert.match(await text("[data-folder-activity-open]"), /Folder activity \(2\)/);
  await shot("02-ledger-notice");

  await click("[data-folder-activity-open]");
  await waitForDialog("Folder activity", "Folder activity should open from the toolbar");
  const activity = await text("[data-folder-activity-list]");
  assert.ok(activity.includes(olderName) && activity.includes("Older export — not queued"), `the older export is explained: ${activity}`);
  assert.ok(!activity.includes("holiday notes"), "other files are ignored");
  await shot("03-activity");

  // ---- 4. Review the workbook directly; Review later keeps it ----------------------------------
  const pending = await invoke("get_folder_imports");
  const book = pending.pending.find((b) => b.file_name === bookName);
  const csv = pending.pending.find((b) => b.file_name === csvName);
  assert.ok(book && csv, "both new exports are waiting");
  await click(`[data-folder-review='${book.id}']`);
  await waitForDialog("Import 2 transactions into Max Checking", "Review should open the workbook's review directly");
  assert.ok((await text("[data-folder-import-note]")).includes(bookName), "the review names its file");
  // Two rows, one of which the bank still shows as pending: only the other starts ticked.
  await waitUntilOrDiagnose(browser, async () => (await text("[data-import-confirm]"))?.trim() === "Import 1 transaction", {
    timeoutMsg: "a row the bank shows as pending starts unticked",
    extra: () => text("[data-import-confirm]"),
  });
  await shot("04-workbook-review");
  await click("[data-import-cancel]");
  await waitUntilOrDiagnose(browser, async () => (await dialogTitle()) === null, { timeoutMsg: "Review later should close the review" });
  assert.equal((await invoke("get_folder_imports")).pending.length, 2, "Review later keeps the export waiting");

  // ---- 5. Import the CSV, dismiss the workbook, Review again the older file --------------------
  await click("[data-folder-activity-open]");
  await waitForDialog("Folder activity", "Folder activity should open again");
  await click(`[data-folder-review='${csv.id}']`);
  await waitForDialog("Import 2 transactions into Max Checking", "Review should open the CSV's review directly");
  await browser.execute(() => {
    const leave = [...document.querySelectorAll("[role='dialog'] button")].find((b) => b.textContent.includes("Leave the rest uncategorized"));
    leave?.click();
  });
  await waitUntilOrDiagnose(browser, async () => browser.execute(() => !document.querySelector("[data-import-confirm]")?.disabled), {
    timeoutMsg: "Import should be available once every row is settled",
  });
  await click("[data-import-confirm]");
  await waitUntilOrDiagnose(browser, async () => (await ledgerDescriptions()).length === 162, { timeout: 15000, timeoutMsg: "the CSV's two rows should be imported" });
  // The usual post-import review of new rows may open; close it.
  if ((await dialogTitle()) !== null) await browser.keys("Escape");
  await waitUntilOrDiagnose(browser, async () => (await dialogTitle()) === null, { timeoutMsg: "no dialog should stay open after importing" });
  await waitUntilOrDiagnose(browser, async () => (await text("[data-folder-pending-notice]"))?.includes(bookName), {
    timeout: 15000,
    timeoutMsg: "one export (the workbook) should still be waiting",
    extra: () => text("[data-folder-pending-notice]"),
  });

  await click("[data-folder-activity-open]");
  await waitForDialog("Folder activity", "Folder activity should open for dismissing");
  await click(`[data-folder-dismiss='${book.id}']`);
  await waitUntilOrDiagnose(browser, async () => (await text("[data-folder-activity] [role='status']"))?.includes("Dismissed"), {
    timeoutMsg: "dismissing should say what happens next",
  });
  const olderEntry = (await invoke("list_folder_import_activity")).find((e) => e.file_name === olderName && e.outcome === "older");
  assert.ok(olderEntry?.can_review_again, "an older export can be reviewed again on purpose");
  await click(`[data-folder-review-again='${olderEntry.id}']`);
  await waitForDialog("Import 1 transaction into Max Checking", "Review again should open the older file's review in one click");
  assert.ok((await text("[data-folder-import-note]")).includes(olderName), "it is that file's review");
  await shot("05-review-again");
  await click("[data-import-cancel]");
  await waitUntilOrDiagnose(browser, async () => (await dialogTitle()) === null, { timeoutMsg: "Review later should close it" });
  const ledger = await ledgerDescriptions();
  assert.equal(ledger.length, 162);
  for (const absent of ["QQXZ WORKBOOK SHOP", "QQXZ WORKBOOK PENDING", "QQXZ OLDER EXPORT"]) assert.ok(!ledger.includes(absent), `${absent} was never approved`);
  for (const present of ["QQXZ FOLDER CAFE", "QQXZ FOLDER MARKET"]) assert.ok(ledger.includes(present), `${present} was imported`);
  assert.deepEqual(fs.readdirSync(folder).sort(), [bookName, csvName, olderName, "holiday notes.txt"].sort(), "the folder's files are untouched");

  // ---- 6. Narrow window -------------------------------------------------------------------------
  await browser.setWindowSize(800, 600);
  await waitUntilOrDiagnose(browser, async () => (await browser.$("[data-folder-activity-open]")).isDisplayed(), {
    timeoutMsg: "Folder activity stays reachable at 800x600",
  });
  const overflow = await browser.execute(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `no sideways page scroll at 800x600 (${overflow}px)`);
  // With Folder activity added the buttons no longer fit beside the title: when they wrap below it
  // they stay on the right, where they sit on a wide window.
  const edges = () =>
    browser.execute(() => {
      const top = document.querySelector(".page-top").getBoundingClientRect();
      const actions = document.querySelector(".page-top > .page-actions").getBoundingClientRect();
      const title = document.querySelector(".page-top .view-title").getBoundingClientRect();
      return { wrapped: actions.top >= title.bottom, gap: Math.round(top.right - actions.right) };
    });
  await shot("06-narrow");
  let sawWrapped = false;
  for (const width of [1280, 1200, 1100, 1000, 900, 800]) {
    await browser.setWindowSize(width, 800);
    await browser.pause(150);
    const e = await edges();
    if (!e.wrapped) continue;
    sawWrapped = true;
    assert.ok(e.gap <= 1, `at ${width}px wide the wrapped buttons stay on the right (${e.gap}px short of the right edge)`);
  }
  assert.ok(sawWrapped, "at some width the buttons wrap below the title");

  // ---- 7. Closing and reopening keeps the queue, the dismissal and the history -----------------
  await app.close();
  app = await launchApp({ dbDir });
  browser = app.browser;
  await invoke("scan_folder_imports_now");
  // Two discovery passes (5 s apart) with the same folder: nothing new may be queued.
  await browser.pause(11000);
  const reopened = await invoke("get_folder_imports");
  assert.equal(reopened.enabled, true, "watching stays on");
  assert.ok(reopened.folder, "the folder is remembered on this computer");
  assert.deepEqual(reopened.pending.map((b) => b.file_name), [olderName], "only the export saved for later is waiting; the dismissed workbook is not queued again");
  const history = await invoke("list_folder_import_activity");
  assert.ok(history.some((e) => e.file_name === bookName && e.outcome === "dismissed"), "the dismissal is still on record");
  assert.ok(history.some((e) => e.file_name === csvName && e.outcome === "imported"), "the import is still on record");
  assert.equal((await ledgerDescriptions()).length, 162, "reopening imports nothing");
  console.log("PASS feature430 folder imports");
} finally {
  await app.close();
}
