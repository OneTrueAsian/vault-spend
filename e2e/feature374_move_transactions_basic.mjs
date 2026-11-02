// Moving transactions to another account, the ordinary correction, through the real screens:
//   1. Choose rows, pick a destination: the review opens and nothing has moved (read back through the app's own
//      commands). Cancel leaves everything as it was.
//   2. Confirm: the same transaction ids, amounts, dates, categories, notes, tags, splits and members are in the
//      destination; a ticked row is unticked; the balances are exactly the hand-worked figures; the selection is
//      cleared; the success message names the counts; the list follows.
//   3. The row's own Account menu opens the same review for one transaction.
//   4. The hidden account is not offered, and when every selected row is already in an account that account is
//      not offered either.
//   5. After the app closes, the database file itself shows the same facts and passes SQLite's integrity and
//      foreign-key checks.
//
// Expected balances are worked out here from the fixture, not read from the app's preview.
//
// Run with: node e2e/feature374_move_transactions_basic.mjs

import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { nav } from "./lib/accumulation.mjs";
import { FIRST, LAST_MONTH_END, TODAY, chooseMoveDestination, dialogText, makeInvoke, openTransactions, pageText, seedMoveFixture, sel, sqlRows, tickRow, waitForReview } from "./lib/moveTransactions.mjs";

const dbDir = await seedMoveFixture(`
cafe = add("Checking", "${TODAY}", "Corner Cafe", "-4.25", "Dining Out")
fuel = add("Checking", "${FIRST}", "Fuel Stop", "-30.00", "Transportation", cleared=1)
add("Checking", "${FIRST}", "Payroll", "1200.00", "Income")
add("Savings", "${FIRST}", "Interest", "0.40", "Income")
add("Visa", "${TODAY}", "Hardware Store", "-125.50", "Home")
cur.execute("UPDATE transactions SET notes = 'birthday lunch' WHERE id = ?", (cafe,))
cur.execute("INSERT INTO transaction_tags (transaction_id, tag) VALUES (?, 'treat')", (cafe,))
cur.execute("INSERT INTO transaction_splits (transaction_id, category, amount, note) VALUES (?, 'Dining Out', '-3.00', NULL), (?, 'Tips', '-1.25', 'tip')", (cafe, cafe))
cur.execute("INSERT INTO family_members (name) VALUES ('Ann')")
cur.execute("UPDATE transactions SET member_id = ? WHERE id = ?", (cur.lastrowid, cafe))
`);

const app = await launchApp({ dbDir });
const { browser: b } = app;
const invoke = makeInvoke(b);
const rows = async () => await invoke("list_transactions");
const byDescription = async (d) => (await rows()).find((t) => t.description === d);
const balance = async (name) => (await invoke("list_accounts")).find((a) => a.name === name).current_balance;
const columns = "id, date, description, amount, category, category_source, confidence, notes, member_id";

try {
  await openTransactions(b);

  // Independent expectations, from the fixture: checking 1000 - 4.25 - 30 + 1200; savings 500 + 0.40; visa limit 2000 - 125.50.
  assert.equal(await balance("Checking"), "2165.75");
  assert.equal(await balance("Savings"), "500.40");
  assert.equal(await balance("Visa"), "1874.50");

  const before = sqlRows(dbDir, `SELECT ${columns} FROM transactions WHERE description IN ('Corner Cafe', 'Fuel Stop') ORDER BY id`);
  const splitsBefore = sqlRows(dbDir, "SELECT id, transaction_id, category, amount, note FROM transaction_splits ORDER BY id");
  const ids = { cafe: (await byDescription("Corner Cafe")).id, fuel: (await byDescription("Fuel Stop")).id };

  // ---- 1. The review opens; nothing has moved; Cancel changes nothing --------------------------------------
  await tickRow(b, "Corner Cafe");
  await tickRow(b, "Fuel Stop");
  const trigger = await b.$(sel.moveTrigger);
  assert.equal(await trigger.getAttribute("disabled"), null, "Move to account is offered when other accounts exist");
  await chooseMoveDestination(b, "Savings");
  await waitForReview(b);
  const text = await dialogText(b);
  assert.match(text, /Move 2 transactions to Savings\?/);
  assert.match(text, /2 transactions from Checking \(2\)/);
  assert.match(text, /not a bank transfer/);
  assert.match(text, /Categories, tags, notes, splits and who each transaction is for stay with the transactions/);
  assert.match(text, /1 transaction you ticked for reconciling will be unticked/, "the ticked row is warned about");
  assert.match(text, /Balance \$2,165\.75 → \$2,200\.00/, "checking gets the two rows back");
  assert.match(text, /Balance \$500\.40 → \$466\.15/, "savings gives up 4.25 + 30.00");
  assert.equal((await byDescription("Corner Cafe")).account_name, "Checking", "choosing a destination moved nothing");
  assert.equal((await byDescription("Fuel Stop")).account_name, "Checking");
  const cancel = await b.$("button=Cancel");
  await cancel.click();
  await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 5000 });
  assert.equal((await byDescription("Corner Cafe")).account_name, "Checking", "Cancel changed nothing");
  assert.equal(await balance("Savings"), "500.40");
  assert.equal(await b.$(sel.bar).isExisting(), true, "the selection is still there after Cancel");

  // ---- 2. Confirm ------------------------------------------------------------------------------------------
  await chooseMoveDestination(b, "Savings");
  await waitForReview(b);
  await (await b.$(sel.confirm)).click();
  await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 15000 });
  await waitUntilOrDiagnose(b, async () => (await pageText(b)).includes("Moved 2 transactions to Savings."), { timeoutMsg: "the success message should name the count" });
  assert.equal((await byDescription("Corner Cafe")).account_name, "Savings");
  assert.equal((await byDescription("Fuel Stop")).account_name, "Savings");
  assert.equal(await balance("Checking"), "2200.00", "1000 + 1200");
  assert.equal(await balance("Savings"), "466.15", "500 + 0.40 - 4.25 - 30.00");
  assert.equal(await b.$(sel.bar).isExisting(), false, "the selection is cleared after the move");
  const after = sqlRows(dbDir, `SELECT ${columns} FROM transactions WHERE description IN ('Corner Cafe', 'Fuel Stop') ORDER BY id`);
  assert.deepEqual(after, before, "ids, dates, amounts, categories, provenance, notes and members are unchanged");
  assert.deepEqual(sqlRows(dbDir, "SELECT id, transaction_id, category, amount, note FROM transaction_splits ORDER BY id"), splitsBefore, "splits are unchanged");
  assert.deepEqual(sqlRows(dbDir, `SELECT tag FROM transaction_tags WHERE transaction_id = ${ids.cafe}`), [["treat"]], "tags stay");
  assert.deepEqual(sqlRows(dbDir, `SELECT cleared, account_id FROM transactions WHERE id = ${ids.fuel}`).map(([c]) => c), [0], "the tick was cleared");
  assert.deepEqual(sqlRows(dbDir, `SELECT fingerprint FROM transactions WHERE id = ${ids.cafe}`)[0][0].split("|").slice(1), [TODAY, "corner cafe", "-4.25"]);
  assert.match(sqlRows(dbDir, `SELECT fingerprint FROM transactions WHERE id = ${ids.cafe}`)[0][0], /^\d+\|/);

  // The other screens follow without a reload: the Accounts page shows the new balances.
  await nav(b, "Accounts");
  await waitUntilOrDiagnose(b, async () => {
    const text = await pageText(b);
    return text.includes("$2,200.00") && text.includes("$466.15");
  }, { timeoutMsg: "the Accounts page should show checking at $2,200.00 and savings at $466.15 right after the move" });
  await openTransactions(b);

  // ---- 3. The row's own Account menu uses the same review ---------------------------------------------------
  const rowMenu = await b.$(`button[aria-label^='Account for "Hardware Store"']`);
  await rowMenu.waitForExist({ timeout: 10000 });
  await rowMenu.click();
  const checkingItem = await b.$("//button[@role='menuitemradio'][normalize-space(.)='Checking']");
  await checkingItem.waitForClickable({ timeout: 5000 });
  await checkingItem.click();
  await b.$(sel.dialog).waitForExist({ timeout: 10000 });
  await waitForReview(b);
  assert.match(await dialogText(b), /Move 1 transaction to Checking\?/, "one row opens the same review");
  assert.equal((await byDescription("Hardware Store")).account_name, "Visa", "nothing moves until it is confirmed");
  await (await b.$(sel.confirm)).click();
  await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 15000 });
  await waitUntilOrDiagnose(b, async () => (await byDescription("Hardware Store")).account_name === "Checking", { timeoutMsg: "the single row should move after confirming" });
  assert.equal(await balance("Visa"), "2000.00", "the card owes nothing again");
  assert.equal(await balance("Checking"), "2074.50", "2200 - 125.50");

  // ---- 4. Who is offered ----------------------------------------------------------------------------------
  await tickRow(b, "Interest");
  await (await b.$(sel.moveTrigger)).click();
  const offered = await b.execute(() => [...document.querySelectorAll("[role=menuitemradio]")].map((e) => e.textContent.trim()));
  assert.ok(!offered.some((o) => o.startsWith("Old Account")), `a hidden account is not offered: ${offered}`);
  assert.ok(!offered.some((o) => o.startsWith("Savings (")), "the account every selected row is already in is not offered");
  assert.ok(offered.some((o) => o.startsWith("Checking (")), `visible accounts are: ${offered}`);
  await b.keys("Escape");
  console.log("PASS feature374 core flows");
} finally {
  await app.close();
}

// ---- 5. The file itself, after the app has closed ---------------------------------------------------------
assert.deepEqual(sqlRows(dbDir, "PRAGMA integrity_check"), [["ok"]]);
assert.deepEqual(sqlRows(dbDir, "PRAGMA foreign_key_check"), []);
assert.deepEqual(sqlRows(dbDir, "SELECT COUNT(*) FROM transactions"), [[5]], "nothing was created or deleted");
assert.deepEqual(sqlRows(dbDir, "SELECT balance, reset_date FROM balance_resets WHERE account_id = 1"), [["1000.00", LAST_MONTH_END]], "the carry-forward was never edited");
console.log("PASS feature374");
