// E2E test for Task 4 of the Transactions usability plan — freeform notes on
// individual transactions.
//
//   - An ordinary row offers "+ Add note"; saving shows a preview on the
//     row, editing the preview reopens it prefilled, Cancel discards an
//     in-progress edit, and clearing the text back to empty removes the
//     note entirely.
//   - A note survives closing and reopening the app.
//   - A transaction that arrived via CSV import supports notes exactly like
//     a manually-created one.
//   - A linked transfer's two legs are still two separate transactions:
//     each gets its own note action, and a note on one never appears on
//     the other.
//
// Run with: node e2e/feature135_transaction_notes.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, reclaimWindowFocus } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
def days_ago(n): return (today - datetime.timedelta(days=n)).isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
checking = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Savings', 'savings', '1000.00')")
savings = cur.lastrowid

def add(account_id, date, desc, amount, n):
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, ?, ?, ?, ?, 'user', ?)",
        (account_id, date, desc, amount, "Groceries", f"fp-{n}"),
    )

add(checking, days_ago(0), "Coffee Shop", "-4.50", 1)
# Twelve days apart — never suggested, linked by hand.
add(checking, days_ago(12), "Rent Share Out", "-300.00", 2)
add(savings, days_ago(0), "Rent Share In", "300.00", 3)
`);

const csvDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-notes-import-"));
const csvPath = path.join(csvDir, "bank.csv");
fs.writeFileSync(csvPath, ["date,description,amount", `${dateInMonth(-1, 1)},Imported Widget Purchase,-25.00`, ""].join("\n"));

async function withApp(fn) {
  const app = await launchApp({ dbDir });
  try {
    await app.browser.setWindowSize(1440, 1100);
    await fn(app.browser);
  } finally {
    await app.close?.();
  }
}

async function nav(browser, label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) {
      await b.click();
      await browser.pause(300);
      return;
    }
  }
  throw new Error(`no nav button "${label}"`);
}

async function call(browser, command, args = {}) {
  return browser.executeAsync(
    (cmd, a, done) => {
      window.__TAURI_INTERNALS__.invoke(cmd, a).then(
        (value) => done({ ok: value }),
        (e) => done({ error: String(e) }),
      );
    },
    command,
    args,
  );
}
async function ok(browser, command, args) {
  const r = await call(browser, command, args);
  if (r.error !== undefined) throw new Error(`${command} failed: ${r.error}`);
  return r.ok;
}

const rowFor = (browser, description) => browser.$(`//tr[td[contains(.,'${description}')]]`);

async function noteDialogPanel(browser) {
  // WebdriverIO's `tag*=text` reverse-text shorthand only works on a bare
  // tag selector, not combined with a class — use XPath instead (same
  // approach feature28_manual_transaction.mjs uses for its own dialog title).
  const heading = await browser.$("//h2[contains(@class,'modal-title')][contains(text(),'Note for')]");
  await heading.waitForExist({ timeout: 10000, timeoutMsg: "expected the note dialog to open" });
  return browser.$(".modal-panel");
}

async function withApp1(browser) {
  await nav(browser, "Transactions");
  await (await browser.$("table.ledger")).waitForExist({ timeout: 10000 });

  // ---- 1. Add a note through the real "+ Add note" button ----------------
  const coffeeRow = await rowFor(browser, "Coffee Shop");
  const addBtn = await coffeeRow.$("button[aria-label*='Add note for']");
  await addBtn.waitForExist({ timeout: 10000, timeoutMsg: 'expected "+ Add note" on a note-less row' });
  await addBtn.click();
  let panel = await noteDialogPanel(browser);
  let textarea = await panel.$("textarea");
  await textarea.setValue("Split with Jordan");
  await (await panel.$("button=Save")).click();
  await panel.waitForExist({ timeout: 5000, reverse: true });
  await browser.waitUntil(
    async () => (await (await rowFor(browser, "Coffee Shop")).getText()).includes("Split with Jordan"),
    { timeout: 10000, timeoutMsg: "expected the saved note to preview on the row" },
  );
  console.log("add: note saved and previews on the row");

  // ---- 2. Edit through the preview button, prefilled with the old text ---
  const editBtn = await (await rowFor(browser, "Coffee Shop")).$("button[aria-label*='Edit note for']");
  await editBtn.waitForExist({ timeout: 10000 });
  await editBtn.click();
  panel = await noteDialogPanel(browser);
  textarea = await panel.$("textarea");
  await browser.waitUntil(async () => (await textarea.getValue()) === "Split with Jordan", {
    timeout: 5000,
    timeoutMsg: "expected the note dialog to reopen prefilled with the existing note",
  });
  await textarea.setValue("Split with Jordan, confirmed");
  await (await panel.$("button=Save")).click();
  await panel.waitForExist({ timeout: 5000, reverse: true });
  await browser.waitUntil(
    async () => (await (await rowFor(browser, "Coffee Shop")).getText()).includes("Split with Jordan, confirmed"),
    { timeout: 10000, timeoutMsg: "expected the edited note to replace the old preview" },
  );
  console.log("edit: note updated and previews the new text");

  // ---- 3. Cancel discards an in-progress edit -----------------------------
  const editBtn2 = await (await rowFor(browser, "Coffee Shop")).$("button[aria-label*='Edit note for']");
  await editBtn2.click();
  panel = await noteDialogPanel(browser);
  textarea = await panel.$("textarea");
  await textarea.setValue("this must never be saved");
  await (await panel.$("button=Cancel")).click();
  await panel.waitForExist({ timeout: 5000, reverse: true });
  const afterCancel = await (await rowFor(browser, "Coffee Shop")).getText();
  if (afterCancel.includes("this must never be saved")) throw new Error("Cancel must not save the typed text");
  if (!afterCancel.includes("Split with Jordan, confirmed")) throw new Error("Cancel must leave the previously-saved note untouched");
  console.log("cancel: in-progress edit discarded, prior note unchanged");

  // ---- 4. Clearing the text back to empty removes the note ---------------
  const editBtn3 = await (await rowFor(browser, "Coffee Shop")).$("button[aria-label*='Edit note for']");
  await editBtn3.click();
  panel = await noteDialogPanel(browser);
  textarea = await panel.$("textarea");
  // `.setValue("")` doesn't reliably clear a controlled React input in this
  // WebView (see feature26_help_search.mjs) — select-all + Backspace instead.
  await reclaimWindowFocus(browser);
  await textarea.click();
  await browser.keys(["Control", "a"]);
  await browser.keys("Backspace");
  await browser.waitUntil(async () => (await textarea.getValue()) === "", {
    timeout: 5000,
    timeoutMsg: "expected select-all + Backspace to clear the note textarea",
  });
  await (await panel.$("button=Save")).click();
  await panel.waitForExist({ timeout: 5000, reverse: true });
  await browser.waitUntil(
    async () => (await (await rowFor(browser, "Coffee Shop")).$("button[aria-label*='Add note for']")).isExisting(),
    { timeout: 10000, timeoutMsg: 'expected the row to fall back to "+ Add note" once the note is cleared' },
  );
  console.log("clear: note removed, row back to + Add note");

  // Leave Coffee Shop with a note again, to check it survives a restart.
  const addBtnAgain = await (await rowFor(browser, "Coffee Shop")).$("button[aria-label*='Add note for']");
  await addBtnAgain.click();
  panel = await noteDialogPanel(browser);
  await (await panel.$("textarea")).setValue("Survives a restart");
  await (await panel.$("button=Save")).click();
  await panel.waitForExist({ timeout: 5000, reverse: true });

  // ---- 5. An imported transaction supports notes just like a manual one --
  const accounts = await ok(browser, "list_accounts");
  const checkingId = accounts.find((a) => a.name === "Checking").id;
  await ok(browser, "commit_import", {
    path: csvPath,
    invertAmounts: false,
    defaultAccountId: checkingId,
    includedIndices: [0],
    accountOverrides: {},
  });
  await browser.refresh();
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await nav(browser, "Transactions");
  await browser.waitUntil(async () => (await (await browser.$("table.ledger")).getText()).includes("Imported Widget Purchase"), {
    timeout: 10000,
    timeoutMsg: "expected the imported transaction to appear in the Ledger",
  });
  const importedAddBtn = await (await rowFor(browser, "Imported Widget Purchase")).$("button[aria-label*='Add note for']");
  await importedAddBtn.waitForExist({ timeout: 10000, timeoutMsg: "an imported transaction should offer Add note like any other row" });
  await importedAddBtn.click();
  panel = await noteDialogPanel(browser);
  await (await panel.$("textarea")).setValue("Reimbursable");
  await (await panel.$("button=Save")).click();
  await panel.waitForExist({ timeout: 5000, reverse: true });
  await browser.waitUntil(
    async () => (await (await rowFor(browser, "Imported Widget Purchase")).getText()).includes("Reimbursable"),
    { timeout: 10000, timeoutMsg: "expected the note on the imported transaction to save and preview" },
  );
  console.log("imported transaction: note added and previews, same as a manual one");

  // ---- 6. A linked transfer's two legs each get their own note action ----
  for (const desc of ["Rent Share Out", "Rent Share In"]) {
    const box = await browser.$(`//tr[td[contains(.,'${desc}')]]//input[@type='checkbox']`);
    await box.waitForExist({ timeout: 10000 });
    await box.click();
  }
  const linkBtn = await browser.$("button=Link as transfer");
  await linkBtn.waitForExist({ timeout: 10000 });
  await linkBtn.click();
  const transferRow = await browser.$("tr.ledger-row-transfer");
  await transferRow.waitForExist({ timeout: 10000, timeoutMsg: "expected the pair to merge into one transfer row" });

  const outAdd = await transferRow.$("button[aria-label*='(outgoing leg)']");
  await outAdd.waitForExist({ timeout: 10000, timeoutMsg: "expected a note action for the outgoing leg" });
  await outAdd.click();
  panel = await noteDialogPanel(browser);
  await (await panel.$("textarea")).setValue("Outgoing leg note");
  await (await panel.$("button=Save")).click();
  await panel.waitForExist({ timeout: 5000, reverse: true });

  const inAdd = await (await browser.$("tr.ledger-row-transfer")).$("button[aria-label*='(incoming leg)']");
  await inAdd.waitForExist({ timeout: 10000, timeoutMsg: "expected a note action for the incoming leg" });
  await inAdd.click();
  panel = await noteDialogPanel(browser);
  await (await panel.$("textarea")).setValue("Incoming leg note");
  await (await panel.$("button=Save")).click();
  await panel.waitForExist({ timeout: 5000, reverse: true });

  await browser.waitUntil(
    async () => {
      const text = await (await browser.$("tr.ledger-row-transfer")).getText();
      return text.includes("Outgoing leg note") && text.includes("Incoming leg note");
    },
    { timeout: 10000, timeoutMsg: "expected both legs' notes to show on the merged transfer row" },
  );
  const mergedText = await (await browser.$("tr.ledger-row-transfer")).getText();
  if (mergedText.split("Outgoing leg note").length - 1 !== 1) throw new Error("the outgoing leg's note must not be duplicated onto the incoming leg");
  if (mergedText.split("Incoming leg note").length - 1 !== 1) throw new Error("the incoming leg's note must not be duplicated onto the outgoing leg");
  console.log("linked transfer: each leg keeps its own note, neither copied onto the other");
}

async function withApp2(browser) {
  // ---- 7. Everything above survives closing and reopening the app --------
  await nav(browser, "Transactions");
  await (await browser.$("table.ledger")).waitForExist({ timeout: 10000 });
  await browser.waitUntil(
    async () => (await (await rowFor(browser, "Coffee Shop")).getText()).includes("Survives a restart"),
    { timeout: 10000, timeoutMsg: "the manual transaction's note should survive a restart" },
  );
  await browser.waitUntil(
    async () => (await (await rowFor(browser, "Imported Widget Purchase")).getText()).includes("Reimbursable"),
    { timeout: 10000, timeoutMsg: "the imported transaction's note should survive a restart" },
  );
  await browser.waitUntil(
    async () => {
      const text = await (await browser.$("tr.ledger-row-transfer")).getText();
      return text.includes("Outgoing leg note") && text.includes("Incoming leg note");
    },
    { timeout: 10000, timeoutMsg: "both transfer legs' notes should survive a restart" },
  );
  console.log("restart: manual, imported, and both transfer-leg notes all persisted");
}

await withApp(withApp1);
await withApp(withApp2);

console.log("FEATURE 135 E2E TEST PASSED");
