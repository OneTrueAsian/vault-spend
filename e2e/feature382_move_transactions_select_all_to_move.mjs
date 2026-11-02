// Moving more than 250 transactions in one go: Select all stops at 250 for every other change, but offers to select
// every match for a move. With more than 250 selected only "Move to account" is offered, and after the move focus
// lands on the list instead of being lost to the page.
//
// Run with: node e2e/feature382_move_transactions_select_all_to_move.mjs

import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { FIRST, chooseMoveDestination, dialogText, makeInvoke, openTransactions, seedMoveFixture, sel, sqlRows, waitForReview } from "./lib/moveTransactions.mjs";

// 300 rows of -1.00 dated this month, after the saved balance: Checking opens at 1000, so 700 left; Savings 500.
const dbDir = await seedMoveFixture(`
for n in range(300):
    add("Checking", "${FIRST}", "Bulk Row %03d" % n, "-1.00")
`);

const app = await launchApp({ dbDir });
const { browser: b } = app;
const invoke = makeInvoke(b);
const balances = async () => Object.fromEntries((await invoke("list_accounts")).map((a) => [a.name, a.current_balance]));
const selectAll = `input[aria-label="Select all matching transactions"]`;

try {
  await openTransactions(b);
  const start = await balances();
  assert.deepEqual([start.Checking, start.Savings], ["700.00", "500.00"], "300 spent from 1000");
  await (await b.$(selectAll)).click();

  // Select all keeps its 250 limit for ordinary changes, and offers the larger selection for a move.
  const note = await b.$("[data-select-all-note]");
  await note.waitForExist({ timeout: 10000 });
  assert.match(await note.getText(), /Selected 250 of the 300 matching transactions/);
  assert.equal(await b.$(".bulk-actions-count").getText(), "250 selected");
  assert.ok(await b.$('button[aria-label^="Set category to"]').isExisting(), "ordinary changes are offered at 250");
  await (await b.$("[data-select-all-to-move]")).click();

  // Everything selected: only a move is possible.
  await waitUntilOrDiagnose(b, async () => (await b.$(".bulk-actions-count").getText()) === "300 selected", { timeoutMsg: "300 should be selected" });
  assert.match(await b.$("[data-select-all-note]").getText(), /Selected all 300 matching transactions\. With more than 250 selected you can only move them to another account\./);
  assert.equal(await b.$('button[aria-label^="Set category to"]').isExisting(), false);
  assert.equal(await (await b.$(".bulk-actions-bar")).getText().then((t) => t.includes("Delete selected")), false);
  assert.match(await b.$("[data-move-only-note]").getText(), /Only moving works with more than 250 selected/);

  await chooseMoveDestination(b, "Savings");
  await waitForReview(b);
  const text = await dialogText(b);
  assert.match(text, /Move 300 transactions to Savings\?/);
  assert.match(text, /Balance \$700\.00 → \$1,000\.00/);
  assert.match(text, /Balance \$500\.00 → \$200\.00/);
  await (await b.$(sel.confirm)).click();
  await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 30000 });

  await waitUntilOrDiagnose(b, async () => (await balances()).Checking === "1000.00", { timeoutMsg: "Checking should read 1000" });
  const after = await balances();
  assert.deepEqual([after.Checking, after.Savings], ["1000.00", "200.00"], "1000 and 500 - 300");
  assert.deepEqual(sqlRows(dbDir, "SELECT COUNT(*) FROM transactions WHERE description LIKE 'Bulk Row %' AND account_id = (SELECT id FROM accounts WHERE name = 'Savings')"), [[300]]);
  assert.deepEqual(sqlRows(dbDir, "SELECT mode, moved_count FROM account_move_operations"), [["automatic", 300]]);
  assert.deepEqual(sqlRows(dbDir, "PRAGMA integrity_check"), [["ok"]]);

  // Focus is not lost to the page after the selection and the dialog go away.
  await waitUntilOrDiagnose(
    b,
    async () => b.execute(() => document.activeElement?.getAttribute("aria-label") === "Select all matching transactions"),
    { timeoutMsg: "focus should land on the list's select-all box" },
  );
  console.log("PASS feature382");
} finally {
  await app.close();
}
