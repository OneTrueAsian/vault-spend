// Moving a transaction that is older than a saved balance the app cannot read the contents of (a balance carried
// forward by an earlier version): the review asks for each account's balance after the move.
//   1. The balances Vault Spend shows are only a reference: nothing is confirmed until one is typed or kept.
//   2. One balance is typed, the other kept as shown; the final review says which was which; one Move applies both.
//   3. The transaction keeps its id and moves; the old saved balance keeps its value; a new one is saved that applies
//      from today and cancels today's own activity; both balances read exactly what was confirmed, now and after
//      the app restarts; the move is recorded in the profile.
//
// Run with: node e2e/feature379_move_transactions_confirmed_balances.mjs

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { OLD_DAY, TODAY, chooseMoveDestination, dialogText, makeInvoke, openTransactions, seedMoveFixture, sel, sqlRows, tickRow } from "./lib/moveTransactions.mjs";
import { isoDaysFromNow } from "./lib/dates.mjs";

const SHOTS = process.env.HISTORICAL_EVIDENCE_DIR ?? path.join(tmpdir(), "vaultspend-move-screenshots");
mkdirSync(SHOTS, { recursive: true });

// Checking: opening 1000, the saved balance (dated last month end) is 1000 and counted nothing we can read. The
// row dated OLD_DAY is older than it; the row dated today is after it. Today's own row stays where it is.
const dbDir = await seedMoveFixture(`
add("Checking", "${OLD_DAY}", "Statement Row", "-40.00")
add("Checking", "${TODAY}", "Today Row", "-10.00")
`);

const app = await launchApp({ dbDir });
const { browser: b } = app;
const invoke = makeInvoke(b);
const balances = async () => Object.fromEntries((await invoke("list_accounts")).map((a) => [a.name, a.current_balance]));

try {
  await openTransactions(b);
  const before = await balances();
  assert.equal(before.Checking, "990.00", "1000 saved balance less today's 10; the old row is not in it");
  assert.equal(before.Savings, "500.00");
  const rowId = sqlRows(dbDir, "SELECT id FROM transactions WHERE description = 'Statement Row'")[0][0];
  const savedBefore = sqlRows(dbDir, "SELECT id, account_id, period, reset_date, balance FROM balance_resets ORDER BY id");

  // ---- 1. The review asks, and what is shown is only a reference --------------------------------------------
  await tickRow(b, "Statement Row");
  await chooseMoveDestination(b, "Savings");
  await b.waitUntil(() => b.execute(() => Boolean(document.querySelector("[data-move-confirm-balances]"))), { timeout: 15000, timeoutMsg: "balances should be asked for" });
  const asked = await dialogText(b);
  assert.match(asked, /Confirm balances to move these to Savings/);
  assert.match(asked, /Shown now: \$990\.00 \(for reference only/);
  assert.match(asked, /Shown now: \$500\.00 \(for reference only/);
  assert.match(asked, /does not record which transactions it counted/);
  const accountsNow = await invoke("list_accounts");
  const checkingId = accountsNow.find((a) => a.name === "Checking").id;
  const savingsId = accountsNow.find((a) => a.name === "Savings").id;
  assert.equal(await (await b.$(`#move-balance-${checkingId}`)).getValue(), "", "no balance is preselected");
  assert.equal(await (await b.$("[data-move-review-balances]")).getAttribute("disabled"), "true");
  await b.saveScreenshot(path.join(SHOTS, "confirm-balances-input.png"));

  // Enlarged layout, using the same CSS zoom probe as the existing Settings acceptance specs.
  // This checks 200% layout and actionable buttons; it is not an OS screen-reader test.
  await b.execute(() => { document.documentElement.style.zoom = "2"; });
  const enlarged = await b.execute(() => {
    const panel = document.querySelector("[data-move-dialog]");
    const rect = panel.getBoundingClientRect();
    const buttons = [...panel.querySelectorAll(".modal-actions button")].map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
    return { panel: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }, width: innerWidth, height: innerHeight, buttons };
  });
  assert.ok(enlarged.panel.left >= -1 && enlarged.panel.right <= enlarged.width + 1, `200% layout stays inside the width: ${JSON.stringify(enlarged)}`);
  for (const button of enlarged.buttons) assert.ok(button.top >= 0 && button.bottom <= enlarged.height + 1 && button.left >= 0 && button.right <= enlarged.width + 1, `200% actions remain visible: ${JSON.stringify(enlarged)}`);
  await b.saveScreenshot(path.join(SHOTS, "confirm-balances-200-percent.png"));
  await b.execute(() => { document.documentElement.style.zoom = "1"; });

  // ---- 2. One typed, one kept -------------------------------------------------------------------------------
  await (await b.$(`#move-balance-${checkingId}`)).setValue("1030.00"); // 990 + the 40 that leaves
  assert.equal(await (await b.$("[data-move-review-balances]")).getAttribute("disabled"), "true", "still waiting for the other account");
  await (await b.$(`[data-move-keep="${savingsId}"]`)).click();
  assert.equal(await (await b.$("[data-move-review-balances]")).getAttribute("disabled"), null);
  await (await b.$(`#move-balance-${checkingId}`)).setValue("invalid");
  const actionBefore = await b.$("[data-move-review-balances]").getLocation();
  await (await b.$("[data-move-review-balances]")).click();
  await b.waitUntil(async () => (await b.$(`[data-move-balance-error="${checkingId}"]`).getText()).includes("digits"), { timeout: 10000, timeoutMsg: "one click should validate the entered balances" });
  const actionAfter = await b.$("[data-move-review-balances]").getLocation();
  assert.ok(Math.abs(actionBefore.y - actionAfter.y) <= 1, "the error does not shift the footer action");
  await (await b.$(`#move-balance-${checkingId}`)).setValue("1030.00");
  await (await b.$("[data-move-review-balances]")).click();
  await b.$(sel.confirm).waitForExist({ timeout: 15000, timeoutMsg: "the final review should offer Move" });
  const final = await dialogText(b);
  assert.match(final, /Balances you confirmed/);
  assert.match(final, /Balance after the move: \$1,030\.00 \(entered by you\)/);
  assert.match(final, /Balance after the move: \$500\.00 \(kept as shown\)/);
  assert.match(final, /apply from today/);
  assert.equal(sqlRows(dbDir, `SELECT account_id FROM transactions WHERE id = ${rowId}`)[0][0], checkingId, "nothing moved yet");
  await b.saveScreenshot(path.join(SHOTS, "confirm-balances-final-review.png"));
  await (await b.$(sel.confirm)).click();
  await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 20000 });

  // ---- 3. What was saved ------------------------------------------------------------------------------------
  await waitUntilOrDiagnose(b, async () => (await balances()).Checking === "1030.00", { timeoutMsg: "Checking should read the confirmed balance" });
  const after = await balances();
  assert.deepEqual([after.Checking, after.Savings], ["1030.00", "500.00"]);
  assert.equal(sqlRows(dbDir, `SELECT account_id FROM transactions WHERE id = ${rowId}`)[0][0], savingsId, "same transaction id, new account");
  const saved = sqlRows(dbDir, "SELECT id, account_id, period, reset_date, balance FROM balance_resets ORDER BY id");
  assert.deepEqual(saved.slice(0, savedBefore.length), savedBefore, "the old saved balances keep every value");
  const anchors = sqlRows(dbDir, "SELECT account_id, period, reset_date, effective_from, balance FROM balance_resets WHERE period LIKE 'move:%' ORDER BY account_id");
  assert.equal(anchors.length, 2);
  const yesterday = isoDaysFromNow(-1);
  const todaysOwnActivity = { [checkingId]: -10, [savingsId]: 0 }; // the 'Today Row' stays in Checking
  const confirmed = { [checkingId]: 1030, [savingsId]: 500 };
  for (const [accountId, period, cutoff, effective, balance] of anchors) {
    assert.match(period, /^move:[0-9a-f-]{8,}:\d+$/);
    assert.equal(cutoff, yesterday, "cut off yesterday");
    assert.equal(effective, TODAY, "effective today");
    assert.equal(Number(balance), confirmed[accountId] - todaysOwnActivity[accountId], `account ${accountId}: confirmed amount less today's own activity`);
  }
  assert.deepEqual(sqlRows(dbDir, "SELECT mode, moved_count, effective_date FROM account_move_operations"), [["confirmation", 1, TODAY]]);
  assert.deepEqual(sqlRows(dbDir, "PRAGMA integrity_check"), [["ok"]]);
  assert.deepEqual(sqlRows(dbDir, "PRAGMA foreign_key_check"), []);
  await (await b.$("[data-account-move-history]")).click();
  await b.$("[data-move-history-record]").waitForExist({ timeout: 10000 });
  await (await b.$("[data-move-history-record] summary")).click();
  const history = await b.$("[role='dialog']").getText();
  assert.match(history, /Current balances confirmed by you/);
  assert.match(history, /Balance \$990\.00 → \$1,030\.00/);
  assert.match(history, /did not reconstruct past balances/);
  await b.saveScreenshot(path.join(SHOTS, "confirmed-move-history.png"));
  await (await b.$("button=Close")).click();
  console.log("PASS confirmed balances");
} finally {
  await app.close();
}

// The same numbers after the app is closed and opened again.
const again = await launchApp({ dbDir });
try {
  const read = makeInvoke(again.browser);
  const list = Object.fromEntries((await read("list_accounts")).map((a) => [a.name, a.current_balance]));
  assert.deepEqual([list.Checking, list.Savings], ["1030.00", "500.00"], "the confirmed balances survive a restart");
  console.log("PASS feature379");
} finally {
  await again.close();
}
