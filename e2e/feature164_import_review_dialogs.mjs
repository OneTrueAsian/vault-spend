// Import reviews open as pop-ups (owner, 2026-10-04).
//
//   1. Transactions: started with the page scrolled to the bottom, the review still opens in front
//      of the person, named for the rows and the account, with Import pinned in view. A click
//      outside keeps it open (and the person's choices); Escape cancels it; importing closes it and
//      says "Imported 2 transactions".
//   2. Settings → Import setup data…: the review opens over Settings. It used to render only on the
//      Reports tab, so from Settings the button seemed to do nothing.
//
// The native file picker is answered by stubFilePicker (harness.mjs), which wraps window.fetch, as feature162 does.
//
// Run with: node e2e/run-all.mjs --spec=164

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose, stubFilePicker } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
a = cur.lastrowid
for i in range(120):
    date = (today - datetime.timedelta(days=1 + i % 40)).isoformat()
    desc = f"QQXZ ROW {i:03d}"
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, 'Groceries', ?)",
        (a, date, desc, "-1.00", f"{a}|{date}|{desc.lower()}|-1.00"),
    )
`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-e2e-review-dialogs-"));
const bank = path.join(dir, "bank.csv");
fs.writeFileSync(bank, ["Date,Description,Amount", `${dateInMonth(-1, 3)},QQXZ NEW ONE,-4.00`, `${dateInMonth(-1, 4)},QQXZ NEW TWO,-5.00`, ""].join("\n"));
const setup = path.join(dir, "setup.csv");
fs.writeFileSync(setup, ["Accounts", "Name,Type,Starting Balance,Institution,Mask", "QQXZ Setup Savings,savings,250.00,,", ""].join("\r\n"));

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
const dialogTitle = () => browser.execute(() => document.querySelector("[role='dialog'] .modal-title")?.textContent ?? null);
const inViewport = (selector) =>
  browser.execute((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0;
  }, selector);
async function nav(label) {
  for (const b of await browser.$$("nav button")) if ((await b.getText()).trim() === label) return b.click();
  throw new Error(`no nav button ${label}`);
}

try {
  await browser.setWindowSize(1440, 900);
  await nav("Transactions");
  await (await browser.$("table.ledger")).waitForExist({ timeout: 15000 });
  await stubFilePicker(browser, [bank, setup]);

  // ---- 1. The transactions review, started from the bottom of a long page ----------------------
  await browser.execute(() => {
    const main = document.querySelector(".main");
    main.scrollTop = main.scrollHeight;
  });
  await (await browser.$("button=Import transactions…")).click();
  const keep = await browser.$("button=Keep as-is");
  await keep.waitForDisplayed({ timeout: 10000, timeoutMsg: "the import should ask about signs first" });
  await keep.click();
  await waitUntilOrDiagnose(browser, async () => (await dialogTitle()) === "Import 2 transactions into Checking", {
    timeoutMsg: "the review should open as a dialog named for its rows and account",
  });
  const onScreen = async () => ({ title: await inViewport("[role='dialog'] .modal-title"), confirm: await inViewport("button[data-import-confirm]") });
  await waitUntilOrDiagnose(browser, async () => {
    const o = await onScreen();
    return o.title && o.confirm;
  }, { timeoutMsg: "the dialog's title and its Import button should be on screen without scrolling", extra: onScreen });
  // WebDriver's text is the rendered text, empty while the dialog is still fading in: wait for it.
  const confirmText = () => browser.execute(() => document.querySelector("button[data-import-confirm]")?.innerText.trim() ?? null);
  await waitUntilOrDiagnose(browser, async () => (await confirmText()) === "Import 2 transactions", {
    timeoutMsg: "the dialog's Import button should read Import 2 transactions",
    extra: confirmText,
  });

  // A click on the dimmed page around it keeps the review open.
  await browser.execute(() => document.querySelector(".modal-overlay").dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await browser.pause(300);
  assert.equal(await dialogTitle(), "Import 2 transactions into Checking", "a click outside keeps the review");

  await browser.keys("Escape");
  await waitUntilOrDiagnose(browser, async () => (await dialogTitle()) === null, { timeoutMsg: "Escape should cancel the review" });
  await waitUntilOrDiagnose(browser, async () => (await browser.execute(() => document.body.textContent)).includes("Import cancelled."), {
    timeoutMsg: "cancelling should say so",
  });
  assert.equal((await invoke("list_transactions")).some((t) => t.description.startsWith("QQXZ NEW")), false, "nothing was imported");

  // Importing for real closes the review and says how many, in plain words.
  await browser.execute((file) => window.__pickedFiles.unshift(file), bank);
  await (await browser.$("button=Import transactions…")).click();
  await (await browser.$("button=Keep as-is")).waitForDisplayed({ timeout: 10000 });
  await (await browser.$("button=Keep as-is")).click();
  await (await browser.$("button[data-import-confirm]")).waitForDisplayed({ timeout: 10000 });
  const leaveRest = await browser.$("button=Leave the rest uncategorized");
  if (await leaveRest.isExisting()) await leaveRest.click();
  await (await browser.$("button[data-import-confirm]")).waitForEnabled({ timeout: 10000 });
  await (await browser.$("button[data-import-confirm]")).click();
  await waitUntilOrDiagnose(browser, async () => (await browser.execute(() => document.body.textContent)).includes("Imported 2 transactions"), {
    timeoutMsg: "the import should report \"Imported 2 transactions\"",
  });
  await waitUntilOrDiagnose(browser, async () => (await dialogTitle()) !== "Import 2 transactions into Checking", {
    timeoutMsg: "the review should close once the import is done",
    extra: dialogTitle,
  });
  const close = await browser.$("[data-inbox-close]");
  if (await close.isExisting()) await close.click();

  // ---- 2. Setup data, from Settings --------------------------------------------------------------
  await nav("Settings");
  await (await browser.$("button*=Import setup data")).click();
  await waitUntilOrDiagnose(browser, async () => (await dialogTitle()) === "Import setup data", {
    timeoutMsg: "the setup-data review should open over Settings",
  });
  const dialogText = () => browser.execute(() => document.querySelector("[role='dialog']")?.innerText ?? null);
  await waitUntilOrDiagnose(browser, async () => /QQXZ Setup Savings/.test((await dialogText()) ?? ""), {
    timeoutMsg: "the setup-data review should list QQXZ Setup Savings",
    extra: dialogText,
  });
  await (await browser.$("//div[@role='dialog']//button[normalize-space()='Import selected']")).click();
  await waitUntilOrDiagnose(browser, async () => (await invoke("list_accounts")).some((a) => a.name === "QQXZ Setup Savings"), {
    timeoutMsg: "Import selected should create the account",
  });
  await waitUntilOrDiagnose(browser, async () => (await dialogTitle()) === null, { timeoutMsg: "the review should close once imported" });

  console.log("FEATURE 164 E2E TEST PASSED");
} finally {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
