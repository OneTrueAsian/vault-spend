// Moving many transactions at once.
//   1. 240 rows are found with the search box, selected with the select-all box (they span five pages of the list)
//      and moved with one confirmation. Every selected row moves, not only the 50 shown; the review pages its
//      table, and the balances are the hand-worked figures.
//   2. A batch of 5,000 rows moved straight through the native commands (the screen caps a selection at 250): the
//      preview and the move are each one call, every row arrives, the balances are exact, and the duration is
//      printed for the verification report.
//
// Run with: node e2e/feature376_move_transactions_bulk.mjs

import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { FIRST, chooseMoveDestination, dialogText, makeInvoke, openTransactions, pageText, seedMoveFixture, sel, sqlRows, waitForReview } from "./lib/moveTransactions.mjs";

const dbDir = await seedMoveFixture(`
for n in range(240):
    add("Checking", "${FIRST}", f"Bulk {n:03d}", "-1.00")
for n in range(5000):
    add("Visa", "${FIRST}", f"Batch {n:04d}", "-0.50")
add("Savings", "${FIRST}", "Interest", "0.40", "Income")
`);

const app = await launchApp({ dbDir });
const { browser: b } = app;
const invoke = makeInvoke(b);
const balance = async (name) => (await invoke("list_accounts")).find((a) => a.name === name).current_balance;

try {
  await openTransactions(b);
  // Independent: checking 1000 - 240; savings 500 + 0.40; visa limit 2000 - 5000 * 0.50.
  assert.equal(await balance("Checking"), "760.00");
  assert.equal(await balance("Savings"), "500.40");
  assert.equal(await balance("Visa"), "-500.00");

  // ---- 1. Select every matching row across pages ------------------------------------------------------------
  const search = await b.$("input[placeholder*='Search']");
  await search.setValue("Bulk");
  await waitUntilOrDiagnose(b, async () => (await b.$$("table.ledger tbody tr[data-payment-row]")).length > 0 && (await pageText(b)).includes("Bulk 000"), { timeoutMsg: "the matching rows should list" });
  await (await b.$("table.ledger thead input[type='checkbox']")).click();
  await waitUntilOrDiagnose(b, async () => (await b.$(sel.bar).getText()).includes("240 selected"), { timeoutMsg: "all 240 matching rows, not just the page shown, should be selected" });
  await chooseMoveDestination(b, "Savings");
  await waitForReview(b);
  const text = await dialogText(b);
  assert.match(text, /Move 240 transactions to Savings\?/);
  assert.match(text, /240 transactions from Checking \(240\)/);
  assert.match(text, /-\$240\.00/, "the signed total is shown");
  assert.match(text, /Balance \$760\.00 → \$1,000\.00/);
  assert.match(text, /Balance \$500\.40 → \$260\.40/);
  const shownRows = await b.execute(() => document.querySelectorAll("[data-move-row]").length);
  assert.equal(shownRows, 10, "the review's table shows a page of rows, not all 240 at once");
  assert.match(text, /Show 10 more rows \(230 left\)/, "and says how many are left instead of truncating");
  assert.equal((await invoke("list_transactions")).filter((t) => t.description.startsWith("Bulk") && t.account_name === "Savings").length, 0, "nothing has moved yet");
  await (await b.$(sel.confirm)).click();
  await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 30000 });
  await waitUntilOrDiagnose(b, async () => (await pageText(b)).includes("Moved 240 transactions to Savings."), { timeout: 20000, timeoutMsg: "the move should report 240" });
  assert.deepEqual(sqlRows(dbDir, "SELECT COUNT(*) FROM transactions WHERE description LIKE 'Bulk%' AND account_id = (SELECT id FROM accounts WHERE name = 'Savings')"), [[240]]);
  assert.equal(await balance("Checking"), "1000.00");
  assert.equal(await balance("Savings"), "260.40");
  assert.equal(await (await b.$("input[placeholder*='Search']")).getValue(), "Bulk", "the search the person had stays");
  console.log("PASS bulk through the screen");

  // ---- 2. 5,000 rows through the native commands -------------------------------------------------------------
  const ids = sqlRows(dbDir, "SELECT id FROM transactions WHERE description LIKE 'Batch%' ORDER BY id").map(([id]) => id);
  assert.equal(ids.length, 5000);
  const checking = (await invoke("list_accounts")).find((a) => a.name === "Checking").id;
  const t0 = Date.now();
  const preview = await invoke("preview_transaction_account_move", { ids, destinationAccountId: checking });
  const previewMs = Date.now() - t0;
  assert.equal(preview.preview.effectiveCount, 5000);
  assert.equal(preview.preview.canCommit, true);
  assert.equal(preview.preview.total, "-2500.00");
  const visaEffect = preview.preview.effects.find((e) => e.accountName === "Visa");
  assert.deepEqual([visaEffect.current, visaEffect.projected], ["2500.00", "0.00"], "the card owed 2,500.00 and owes nothing after");
  const t1 = Date.now();
  const operationId = "e2e-bulk-reassign-5000";
  const done = await invoke("move_transactions_to_account", { ids, destinationAccountId: checking, expectedPreviewToken: preview.preview.token, operationId });
  const moveMs = Date.now() - t1;
  assert.equal(done.status, "moved");
  assert.equal(done.movedCount, 5000);
  assert.equal(await balance("Visa"), "2000.00");
  assert.equal(await balance("Checking"), "-1500.00", "1000 - 5000 x 0.50");
  assert.deepEqual(sqlRows(dbDir, "SELECT COUNT(*) FROM transactions WHERE description LIKE 'Batch%' AND account_id = (SELECT id FROM accounts WHERE name = 'Checking')"), [[5000]]);
  // Repeating the same confirmation changes nothing.
  const committedRows = sqlRows(dbDir, "SELECT id, account_id, fingerprint, cleared FROM transactions ORDER BY id");
  const committedOperations = sqlRows(dbDir, "SELECT operation_id FROM account_move_operations ORDER BY operation_id");
  const again = await invoke("move_transactions_to_account", { ids, destinationAccountId: checking, expectedPreviewToken: preview.preview.token, operationId });
  assert.equal(again.status, "moved");
  assert.equal(again.replayed, true, "a lost reply returns the original successful result");
  assert.deepEqual(again.movedIds, done.movedIds);
  assert.deepEqual(sqlRows(dbDir, "SELECT id, account_id, fingerprint, cleared FROM transactions ORDER BY id"), committedRows);
  assert.deepEqual(sqlRows(dbDir, "SELECT operation_id FROM account_move_operations ORDER BY operation_id"), committedOperations);
  // Over the shared limit is refused outright, with nothing moved.
  const tooMany = Array.from({ length: 10001 }, (_, i) => i + 1);
  await assert.rejects(() => invoke("preview_transaction_account_move", { ids: tooMany, destinationAccountId: checking }), /up to 10000/);
  console.log(`BULK_TIMING preview of 5000 rows ${previewMs} ms, move of 5000 rows ${moveMs} ms`);
  console.log("PASS feature376");
} finally {
  await app.close();
}
assert.deepEqual(sqlRows(dbDir, "PRAGMA integrity_check"), [["ok"]]);
assert.deepEqual(sqlRows(dbDir, "PRAGMA foreign_key_check"), []);
