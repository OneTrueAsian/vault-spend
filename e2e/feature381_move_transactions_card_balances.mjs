// Moving a credit-card transaction when the card's saved balance cannot be read, and the person confirms an amount
// owed that is more than the limit, or a credit left by overpaying. Both are real situations, so both are accepted,
// committed and still there after the app restarts.
//   $1,000 limit, owed $1,500  -> available credit -$500.00
//   $1,000 limit, owed -$50    -> available credit $1,050.00
//
// Run with: node e2e/feature381_move_transactions_card_balances.mjs

import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { LAST_MONTH_END, OLD_DAY, PERIOD, chooseMoveDestination, dialogText, makeInvoke, openTransactions, seedMoveFixture, sel, sqlRows, tickRow } from "./lib/moveTransactions.mjs";

const cases = [
  { name: "over the limit", owed: "1500.00", available: "-500.00", raw: "-500.00" },
  { name: "a credit from overpaying", owed: "-50.00", available: "1050.00", raw: "1050.00" },
];

for (const { name, owed, available, raw } of cases) {
  // The card's saved balance (800 available, 200 owed) was carried forward by an earlier version: its contents are unknown.
  const dbDir = await seedMoveFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance, hidden) VALUES ('Card', 'credit', '1000.00', 0)")
card = cur.lastrowid
acct["Card"] = card
add("Card", "${OLD_DAY}", "Card Purchase", "-100.00")
add("Card", "${OLD_DAY}", "Card Other", "-100.00")
cur.execute("INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?, ?, ?, ?)", (card, "${PERIOD}", "${LAST_MONTH_END}", "800.00"))
`);

  const app = await launchApp({ dbDir });
  const { browser: b } = app;
  const invoke = makeInvoke(b);
  const accounts = async () => Object.fromEntries((await invoke("list_accounts")).map((a) => [a.name, a]));
  try {
    await openTransactions(b);
    const before = await accounts();
    assert.equal(before.Card.current_balance, "800.00", `${name}: 1000 limit less 200 spent`);
    const cardId = before.Card.id;
    const savingsId = before.Savings.id;

    await tickRow(b, "Card Purchase");
    await chooseMoveDestination(b, "Savings");
    await b.waitUntil(() => b.execute(() => Boolean(document.querySelector("[data-move-confirm-balances]"))), { timeout: 15000, timeoutMsg: `${name}: balances should be asked for` });
    await (await b.$(`#move-balance-${cardId}`)).setValue(owed);
    await (await b.$(`[data-move-keep="${savingsId}"]`)).click();
    await (await b.$("[data-move-review-balances]")).click();
    await b.$(sel.confirm).waitForExist({ timeout: 15000, timeoutMsg: `${name}: the final review should accept the amount owed` });
    assert.match(await dialogText(b), /Balances you confirmed/);
    await (await b.$(sel.confirm)).click();
    await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 20000 });

    await waitUntilOrDiagnose(b, async () => (await accounts()).Card.current_balance === available, { timeoutMsg: `${name}: the card should read ${available}` });
    const after = await accounts();
    assert.deepEqual([after.Card.current_balance, after.Card.starting_balance, after.Savings.current_balance], [available, "1000.00", "500.00"], `${name}: available credit, limit unchanged, Savings as confirmed`);
    assert.deepEqual(sqlRows(dbDir, `SELECT balance FROM balance_resets WHERE account_id = ${cardId} AND period LIKE 'move:%'`), [[raw]], `${name}: the saved balance underneath`);
    assert.deepEqual(sqlRows(dbDir, "SELECT mode, moved_count FROM account_move_operations"), [["confirmation", 1]]);
    assert.deepEqual(sqlRows(dbDir, "PRAGMA integrity_check"), [["ok"]]);
    assert.deepEqual(sqlRows(dbDir, "PRAGMA foreign_key_check"), []);
    console.log(`PASS ${name}: owed ${owed} shows available ${available}`);
  } finally {
    await app.close();
  }

  const again = await launchApp({ dbDir });
  try {
    const read = makeInvoke(again.browser);
    const list = Object.fromEntries((await read("list_accounts")).map((a) => [a.name, a]));
    assert.deepEqual([list.Card.current_balance, list.Card.starting_balance, list.Savings.current_balance], [available, "1000.00", "500.00"], `${name}: the same after a restart`);
    console.log(`PASS ${name}: after restart`);
  } finally {
    await again.close();
  }
}
console.log("PASS feature381");
