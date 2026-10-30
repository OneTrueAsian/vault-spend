// Moving a transaction older than a saved balance that the app recorded itself (the first-launch carry-forward
// remembers which transactions it counted): the saved balances are corrected from that record, with no questions.
//   1. The review says how many saved balances will be corrected and asks for no balance.
//   2. One Move corrects both accounts' saved balances; the old values stay in the version history.
//   3. Today's balances are the hand-worked figures, before and after a restart.
//
// Run with: node e2e/feature380_move_transactions_recorded_balances.mjs

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { OLD_DAY, TODAY, chooseMoveDestination, dialogText, makeInvoke, openTransactions, seedMoveFixture, sel, sqlRows, tickRow, waitForReview } from "./lib/moveTransactions.mjs";

const SHOTS = process.env.HISTORICAL_EVIDENCE_DIR ?? path.join(tmpdir(), "vaultspend-move-screenshots");
mkdirSync(SHOTS, { recursive: true });

// No carry-forward is seeded: the app records one at launch, counting the old row (and not today's).
const dbDir = await seedMoveFixture(
  `
add("Checking", "${OLD_DAY}", "Statement Row", "-40.00")
add("Checking", "${TODAY}", "Today Row", "-10.00")
`,
  { legacyCarryForward: false },
);

const app = await launchApp({ dbDir });
const { browser: b } = app;
const invoke = makeInvoke(b);
const balances = async () => Object.fromEntries((await invoke("list_accounts")).map((a) => [a.name, a.current_balance]));

try {
  await openTransactions(b);
  // Hand worked: Checking opening 1000, less the old 40 = 960 recorded yesterday; today's 10 on top = 950.
  const before = await balances();
  assert.equal(before.Checking, "950.00");
  assert.equal(before.Savings, "500.00");
  const rowId = sqlRows(dbDir, "SELECT id FROM transactions WHERE description = 'Statement Row'")[0][0];
  const recorded = sqlRows(dbDir, "SELECT balance FROM balance_resets WHERE account_id = (SELECT id FROM accounts WHERE name = 'Checking')");
  assert.deepEqual(recorded, [["960.00"]], "the app recorded the carry-forward");
  const trusted = sqlRows(dbDir, "SELECT COUNT(*) FROM balance_reset_versions WHERE integrity = 'trusted'")[0][0];
  assert.ok(trusted >= 2, "recorded saved balances say what they counted");

  await tickRow(b, "Statement Row");
  await chooseMoveDestination(b, "Savings");
  await waitForReview(b);
  const text = await dialogText(b);
  assert.match(text, /Move 1 transaction to Savings\?/);
  assert.match(text, /2 saved balances will be corrected from what each one recorded/);
  assert.equal(await b.$("[data-move-confirm-balances]").isExisting(), false, "no balance is asked for");
  assert.match(text, /Balance \$950\.00 → \$990\.00/);
  assert.match(text, /Balance \$500\.00 → \$460\.00/);
  await b.saveScreenshot(path.join(SHOTS, "recorded-balances-review.png"));
  await (await b.$(sel.confirm)).click();
  await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 20000 });

  await waitUntilOrDiagnose(b, async () => (await balances()).Checking === "990.00", { timeoutMsg: "Checking should read 990" });
  const after = await balances();
  assert.deepEqual([after.Checking, after.Savings], ["990.00", "460.00"], "1000 - 10 and 500 - 40");
  const checkingId = (await invoke("list_accounts")).find((a) => a.name === "Checking").id;
  assert.deepEqual(sqlRows(dbDir, `SELECT balance FROM balance_resets WHERE account_id = ${checkingId}`), [["1000.00"]], "the saved balance is corrected");
  assert.deepEqual(sqlRows(dbDir, `SELECT balance FROM balance_reset_versions WHERE account_id = ${checkingId} ORDER BY id`), [["960.00"], ["1000.00"]], "the old value stays in the history");
  assert.deepEqual(sqlRows(dbDir, "SELECT mode, moved_count FROM account_move_operations"), [["automatic", 1]]);
  assert.equal(sqlRows(dbDir, `SELECT account_id FROM transactions WHERE id = ${rowId}`)[0][0], (await invoke("list_accounts")).find((a) => a.name === "Savings").id);
  assert.deepEqual(sqlRows(dbDir, "PRAGMA integrity_check"), [["ok"]]);
  assert.deepEqual(sqlRows(dbDir, "PRAGMA foreign_key_check"), []);
  console.log("PASS recorded balances");
} finally {
  await app.close();
}

const again = await launchApp({ dbDir });
try {
  const read = makeInvoke(again.browser);
  const list = Object.fromEntries((await read("list_accounts")).map((a) => [a.name, a.current_balance]));
  assert.deepEqual([list.Checking, list.Savings], ["990.00", "460.00"], "the corrected balances survive a restart");
  console.log("PASS feature380");
} finally {
  await again.close();
}
