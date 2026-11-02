// QA remediation (2026-10-27): four owner-required fixes in the real compiled app.
//
//   1. QA-FUNC-004: a goal is renamed from its Edit form. The new name is saved (and its target,
//      contributions and linked account stay), a name another goal already has is refused with the form
//      left open, and Cancel changes nothing.
//   2. QA-FUNC-006: in Transactions the member filter isolates the named member. With one family member,
//      unticking and re-ticking them shows only their rows, not the unassigned ones; "Select all" brings
//      everything back.
//   3. QA-FUNC-007: Household "Spending by person" shows an Unassigned line next to the named person.
//   4. QA-FUNC-005 / QA-UX-004: a compact OFX file (every tag on one line) imports its transactions through
//      the real file chooser, and a file with nothing readable says so instead of showing an empty table.
//
// The native file picker is answered by stubFilePicker (harness.mjs), as in feature162/164/315.
//
// Run with: node e2e/run-all.mjs --spec=316

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dismissStatusMessages, launchApp, stubFilePicker, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { startImportInto } from "./lib/importAccount.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
day = today.replace(day=1).isoformat()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
acct = cur.lastrowid
cur.execute("INSERT INTO family_members (name) VALUES ('Alex')")
alex = cur.lastrowid
def tx(description, amount, member):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint, member_id) VALUES (?, ?, ?, ?, 'Groceries', ?, ?)",
                (acct, day, description, amount, f'{acct}|{day}|{description.lower()}|{amount}', member))
tx('QQ ALEX LUNCH', '-30.00', alex)
tx('QQ SHOP ONE', '-12.25', None)
tx('QQ SHOP TWO', '-7.75', None)
cur.execute("INSERT INTO buckets (name, target_amount) VALUES ('Roof', '2000.00')")
roof = cur.lastrowid
cur.execute("INSERT INTO bucket_contributions (bucket_id, date, amount, note) VALUES (?, ?, '500.00', 'first')", (roof, day))
cur.execute("INSERT INTO buckets (name, target_amount) VALUES ('Holiday', '800.00')")
`);

const dir = makeTempDir("vaultspend-e2e-ofx-");
const compact = path.join(dir, "compact.ofx");
fs.writeFileSync(
  compact,
  "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>" +
    "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260105<TRNAMT>-42.50<FITID>1<NAME>QQOFX GREEN LEAF<MEMO>POS Purchase</STMTTRN>" +
    "<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260106120000<TRNAMT>3000.00<FITID>2<NAME>QQOFX PAYROLL</STMTTRN>" +
    "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
);
const empty = path.join(dir, "empty.ofx");
fs.writeFileSync(empty, "<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>");

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
async function nav(label) {
  for (const b of await browser.$$("nav button")) if ((await b.getText()).trim() === label) return b.click();
  throw new Error(`no nav button ${label}`);
}
/** Waits for the review's Import button, answering the "which way do the amounts go" question if it comes first. */
async function reachReview(timeoutMsg) {
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const keep = await browser.$("button=Keep as-is");
      if (await keep.isDisplayed().catch(() => false)) await keep.click();
      return browser.execute(() => !!document.querySelector("button[data-import-confirm]"));
    },
    { timeout: 20000, timeoutMsg },
  );
}
const pageText = () => browser.execute(() => document.body.innerText);
const goalCard = (name) => browser.$(`//div[contains(@class,'bucket-card')][.//h2[contains(.,'${name}')]]`);
async function pressCardButton(card, label) {
  await (await card.$(`.//button[normalize-space()='${label}']`)).click();
}

try {
  await browser.setWindowSize(1280, 900);

  // 1. Goal rename
  await nav("Goals");
  const roofCard = await goalCard("Roof");
  await roofCard.waitForExist({ timeout: 15000 });
  await pressCardButton(roofCard, "Edit");
  const nameField = await browser.$('.bucket-new-form input[aria-label="Goal name"]');
  await nameField.waitForDisplayed({ timeout: 5000 });
  assert.equal(await nameField.getValue(), "Roof", "the Edit form starts with the current name");

  await nameField.setValue("Holiday");
  await (await browser.$("//form[contains(@class,'bucket-new-form')]//button[normalize-space()='Save']")).click();
  await waitUntilOrDiagnose(browser, async () => (await pageText()).includes("already have a goal called"), {
    timeout: 8000,
    timeoutMsg: "a name another goal has should be refused with a message",
  });
  assert.ok(await browser.$('.bucket-new-form input[aria-label="Goal name"]').isExisting(), "a refused rename leaves the form open");
  assert.equal(await (await browser.$('.bucket-new-form input[aria-label="Goal name"]')).getValue(), "Holiday", "what was typed is kept");
  assert.deepEqual((await invoke("list_buckets")).map((b) => b.name).sort(), ["Holiday", "Roof"], "nothing was renamed");

  await (await browser.$('.bucket-new-form input[aria-label="Goal name"]')).setValue("Roof repair");
  await (await browser.$("//form[contains(@class,'bucket-new-form')]//button[normalize-space()='Save']")).click();
  await waitUntilOrDiagnose(browser, async () => !(await browser.$(".bucket-new-form").isExisting()), { timeout: 8000, timeoutMsg: "a good rename closes the form" });
  const buckets = await invoke("list_buckets");
  const renamed = buckets.find((b) => b.name === "Roof repair");
  assert.ok(renamed, "the goal now has its new name");
  assert.equal(renamed.target_amount, "2000.00");
  assert.equal(renamed.saved_amount, "500.00", "contribution history is kept");
  assert.ok((await pageText()).includes("Roof repair"));

  const repairCard = await goalCard("Roof repair");
  await pressCardButton(repairCard, "Edit");
  await (await browser.$('.bucket-new-form input[aria-label="Goal name"]')).setValue("Never saved");
  await (await browser.$("//form[contains(@class,'bucket-new-form')]//button[normalize-space()='Cancel']")).click();
  assert.deepEqual((await invoke("list_buckets")).map((b) => b.name).sort(), ["Holiday", "Roof repair"], "Cancel changes nothing");

  // 2. Member filter
  await nav("Transactions");
  await browser.$(".ledger-table-scroll").waitForExist({ timeout: 15000 });
  const memberToggle = () => browser.$("//button[contains(@class,'account-filter-toggle')][contains(.,'members') or contains(.,'Alex') or contains(.,'member')]");
  const ledgerText = () => browser.$(".ledger-table-scroll").getText();
  await waitUntilOrDiagnose(browser, async () => (await ledgerText()).includes("QQ SHOP ONE"), { timeout: 8000, timeoutMsg: "all three rows show before filtering" });
  assert.match(await ledgerText(), /QQ ALEX LUNCH/);
  assert.match(await memberToggle().getText(), /All members/);

  await (await memberToggle()).click();
  const alexBox = await browser.$("//label[contains(@class,'account-filter-option')][normalize-space()='Alex']//input");
  await alexBox.click(); // unticks
  await waitUntilOrDiagnose(browser, async () => /No members/.test(await memberToggle().getText()), { timeout: 5000, timeoutMsg: "unticking the only member reads No members" });
  await alexBox.click(); // ticks Alex alone
  await waitUntilOrDiagnose(browser, async () => !(await ledgerText()).includes("QQ SHOP ONE"), { timeout: 8000, timeoutMsg: "choosing the only member must hide unassigned rows" });
  const isolated = await ledgerText();
  assert.match(isolated, /QQ ALEX LUNCH/);
  assert.doesNotMatch(isolated, /QQ SHOP (ONE|TWO)/);
  assert.match(await memberToggle().getText(), /Alex/);

  await (await browser.$("button=Select all")).click();
  await waitUntilOrDiagnose(browser, async () => (await ledgerText()).includes("QQ SHOP TWO"), { timeout: 8000, timeoutMsg: "Select all shows everything again" });
  assert.match(await memberToggle().getText(), /All members/);
  await browser.keys("Escape");

  // 3. Household unassigned spending
  await nav("Household");
  await browser.$("//h2[contains(.,'Spending by person')]").waitForExist({ timeout: 15000 });
  const spending = await browser.$("//div[contains(@class,'card')][.//h2[contains(.,'Spending by person')]]").getText();
  assert.match(spending, /Alex\s*\$30\.00/);
  assert.match(spending, /Unassigned\s*\$20\.00/, "12.25 + 7.75 of unassigned spending");

  // 4. Compact OFX through the real chooser, and an unreadable file
  await nav("Transactions");
  await stubFilePicker(browser, [compact, empty]);
  await startImportInto(browser, "Checking");
  await reachReview("the compact OFX opens a review");
  // The amounts-direction question can still be fading out beside the review; wait for the review's own text.
  await waitUntilOrDiagnose(browser, () => browser.execute(() => /Import 2 transactions/.test(document.body.innerText)), {
    timeout: 8000,
    timeoutMsg: "both compact records are read (the review title says Import 2 transactions)",
  });
  const review = await browser.execute(() => [...document.querySelectorAll("[role='dialog']")].map((d) => d.innerText).join(" "));
  assert.match(review, /Import 2 transactions/, "both compact records are read");
  assert.match(review, /QQOFX GREEN LEAF/);
  assert.match(review, /QQOFX PAYROLL/);
  assert.doesNotMatch(review, /No transactions were found/);
  const confirmButton = await browser.$("button[data-import-confirm]");
  if (!(await confirmButton.isEnabled())) {
    // Rows without a category ask for one first; leave the rest uncategorized, as a person would.
    const leave = await browser.$("button=Leave the rest uncategorized");
    if (await leave.isExisting()) await leave.click();
  }
  await browser.waitUntil(() => confirmButton.isEnabled(), { timeout: 8000, timeoutMsg: "Import should be ready" });
  await confirmButton.click();
  await waitUntilOrDiagnose(
    browser,
    async () => (await invoke("list_transactions")).filter((t) => t.description.startsWith("QQOFX")).length === 2,
    { timeout: 15000, timeoutMsg: "both OFX transactions were imported" },
  );
  const imported = (await invoke("list_transactions")).filter((t) => t.description.startsWith("QQOFX"));
  assert.deepEqual(imported.map((t) => t.amount).sort(), ["-42.50", "3000.00"]);

  // An uncategorized row opens the Review inbox after the import; close it the way a person would.
  await waitUntilOrDiagnose(
    browser,
    async () => {
      if (await browser.$(".modal-overlay").isExisting()) await browser.keys("Escape");
      return !(await browser.$(".modal-overlay").isExisting());
    },
    { timeout: 10000, timeoutMsg: "the first import's dialogs close" },
  );
  await dismissStatusMessages(browser);
  await startImportInto(browser, "Checking");
  await reachReview("the empty OFX opens a review");
  const dialogText = () => browser.execute(() => [...document.querySelectorAll("[role='dialog']")].map((d) => d.innerText).join(" "));
  await waitUntilOrDiagnose(browser, async () => /No transactions were found in this file/.test(await dialogText()), {
    timeout: 8000,
    timeoutMsg: "an OFX with no records says nothing was found",
  });
  assert.equal(await browser.$("[role='dialog'] table").isExisting(), false, "no empty table");
  assert.equal(await (await browser.$("button[data-import-confirm]")).isEnabled(), false, "nothing to import");
  await (await browser.$("button=Cancel")).click();

  console.log("FEATURE 316 E2E TEST PASSED");
} finally {
  await app.close();
}
