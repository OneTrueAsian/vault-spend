// The Transactions tab shows matching rows a step at a time ("Show 50 more"), and Select all picks
// every matching row in batches of at most 250 transactions (owner, 2026-10-04).
//
//   1. 600 rows: "Showing 50 of 600 transactions"; Show 50 more adds 50 rows.
//   2. Select all selects 250 (more than are shown) and says how to do the rest.
//   3. After a bulk category change, Select all picks the next 250, then the last 100, with no note.
//   4. Ticking rows one by one stops at 250.
//
// Run with: node e2e/run-all.mjs --spec=163

import assert from "node:assert/strict";
import { chooseMenuOption, launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '50000.00')")
a = cur.lastrowid
for i in range(600):
    date = (today - datetime.timedelta(days=1 + i % 60)).isoformat()
    desc = f"QQXZ ROW {i:03d}"
    amount = f"-{1 + i}.00"
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, NULL, ?)",
        (a, date, desc, amount, f"{a}|{date}|{desc.lower()}|{amount}"),
    )
`);

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
const renderedRows = () => browser.execute(() => document.querySelectorAll("table.ledger tbody tr[data-payment-row]").length);
const shownLabel = async () => (await (await browser.$("[data-ledger-shown]")).getText()).trim();
const selectedCount = async () => {
  const el = await browser.$(".bulk-actions-count");
  return (await el.isExisting()) ? (await el.getText()).trim() : "";
};
const note = async () => {
  const el = await browser.$("[data-select-all-note]");
  return (await el.isExisting()) ? (await el.getText()).trim() : null;
};
const selectAll = async () => (await browser.$('[aria-label="Select all matching transactions"]')).click();
const categorized = async () => (await invoke("list_transactions")).filter((t) => t.category === "Groceries").length;

async function setCategoryForSelection() {
  const before = await categorized();
  await chooseMenuOption(await browser.$('button[aria-label^="Set category to"]'), { value: "Groceries" });
  await waitUntilOrDiagnose(browser, async () => (await selectedCount()) === "", { timeoutMsg: "the change should clear the selection" });
  return (await categorized()) - before;
}

try {
  await browser.setWindowSize(1440, 1000);
  await (await browser.$("button*=Transactions")).click();

  // ---- 1. Load more -----------------------------------------------------------------------------
  await waitUntilOrDiagnose(browser, async () => (await shownLabel()) === "Showing 50 of 600 transactions", {
    timeoutMsg: "the ledger should start with 50 of 600",
  });
  assert.equal(await renderedRows(), 50);
  const more = await browser.$("[data-ledger-show-more]");
  assert.equal((await more.getText()).trim(), "Show 50 more");
  await more.click();
  await waitUntilOrDiagnose(browser, async () => (await renderedRows()) === 100, { timeoutMsg: "Show 50 more should add 50 rows" });
  assert.equal(await shownLabel(), "Showing 100 of 600 transactions");

  // ---- 2. Select all stops at 250 ---------------------------------------------------------------
  await selectAll();
  await waitUntilOrDiagnose(browser, async () => (await selectedCount()) === "250 selected", { timeoutMsg: "Select all should select 250" });
  assert.equal(
    await note(),
    "Selected 250 of the 600 matching transactions. A change can apply to at most 250 at a time: apply your change, then press Select all again for the next 250.",
  );
  // Unticking without a change, then Select all again, picks the same first 250.
  await selectAll();
  await waitUntilOrDiagnose(browser, async () => (await selectedCount()) === "", { timeoutMsg: "unticking should clear the selection" });
  assert.equal(await note(), null, "the note goes with the selection");
  await selectAll();
  await waitUntilOrDiagnose(browser, async () => (await selectedCount()) === "250 selected", { timeoutMsg: "Select all again" });

  // ---- 3. Batches ---------------------------------------------------------------------------------
  assert.equal(await setCategoryForSelection(), 250, "the change applies to the 250 selected");
  await selectAll();
  await waitUntilOrDiagnose(browser, async () => (await selectedCount()) === "250 selected", { timeoutMsg: "the second batch should be 250" });
  assert.match(await note(), /for the next 100\.$/);
  assert.equal(await setCategoryForSelection(), 250, "the second batch is 250 new rows, not the first ones again");
  await selectAll();
  await waitUntilOrDiagnose(browser, async () => (await selectedCount()) === "100 selected", { timeoutMsg: "the last batch should be 100" });
  assert.equal(await note(), null, "no note once every remaining row is selected");
  assert.equal(await setCategoryForSelection(), 100);
  assert.equal(await categorized(), 600, "every row was changed exactly once across the three batches");

  // ---- 4. Ticking rows one by one stops at 250 ----------------------------------------------------
  // 249 ticked through the page's own handler for speed, then the 250th and 251st by real clicks.
  await (await browser.$("[data-ledger-show-more]")).click();
  await (await browser.$("[data-ledger-show-more]")).click();
  await (await browser.$("[data-ledger-show-more]")).click();
  await (await browser.$("[data-ledger-show-more]")).click();
  await waitUntilOrDiagnose(browser, async () => (await renderedRows()) >= 251, { timeoutMsg: "enough rows should show" });
  await browser.execute(() => {
    const boxes = [...document.querySelectorAll("table.ledger tbody tr[data-payment-row] td.select-col input[type=checkbox]")];
    for (const box of boxes.slice(0, 250)) box.click();
  });
  await waitUntilOrDiagnose(browser, async () => (await selectedCount()) === "250 selected", { timeoutMsg: "250 rows ticked one by one" });
  const box251 = await browser.$("(//table[contains(@class,'ledger')]//tbody//tr[@data-payment-row]//td[contains(@class,'select-col')]//input[@type='checkbox'])[251]");
  await box251.click();
  await waitUntilOrDiagnose(browser, async () => (await browser.execute(() => document.body.innerText)).includes("A change can apply to at most 250 transactions at a time."), {
    timeoutMsg: "the 251st tick should be refused with a message",
  });
  assert.equal(await selectedCount(), "250 selected");

  console.log("FEATURE 163 E2E TEST PASSED");
} finally {
  await app.close();
}
