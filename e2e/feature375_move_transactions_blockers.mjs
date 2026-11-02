// Moving transactions: everything that must stop a move, and the changes that happen while the review is open.
// Each blocked selection also holds a plain row that would move on its own: nothing moves, not even that one, and
// the database rows are identical afterwards.
//
//   1. A row dated before the balance carried forward at the start of the month is no longer a dead end: the review
//      asks for the balances to be confirmed, offers no way to move yet, and nothing changes if it is cancelled.
//   2. A row a finished reconciliation already counted.
//   3. One side of a linked transfer.
//   4. A row that would duplicate one already in the destination.
//   5. A loan payment with a principal amount, moved to a non-loan account.
//   6. A change made while the review is open (a rename): the confirm is refused as stale, the review shows fresh
//      details with a notice, and a second confirmation then moves the rows.
//   7. The destination hidden while the review is open: refused with its reason, nothing moves.
//
// Run with: node e2e/feature375_move_transactions_blockers.mjs

import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { FIRST, OLD_DAY, TODAY, chooseMoveDestination, dialogText, makeInvoke, openTransactions, seedMoveFixture, sel, sqlRows, tickRow, waitForReview } from "./lib/moveTransactions.mjs";

const dbDir = await seedMoveFixture(`
add("Checking", "${OLD_DAY}", "Old Statement Row", "-9.99")
settled = add("Checking", "${FIRST}", "Settled Row", "-12.00")
cur.execute("INSERT INTO reconciliations (account_id, statement_date, statement_balance, finished_at) VALUES (?, ?, '988.00', ?)", (acct["Checking"], "${FIRST}", "${FIRST} 10:00:00"))
cur.execute("UPDATE transactions SET reconciliation_id = ? WHERE id = ?", (cur.lastrowid, settled))
out = add("Checking", "${FIRST}", "Move Out", "-100.00")
inn = add("Savings", "${FIRST}", "Move In", "100.00")
cur.execute("INSERT INTO transfer_links (out_transaction_id, in_transaction_id, auto, reviewed) VALUES (?, ?, 0, 1)", (out, inn))
add("Checking", "${TODAY}", "Dup Cafe", "-4.00")
add("Savings", "${TODAY}", "Dup Cafe", "-4.00")
add("Checking", "${TODAY}", "Plain One", "-1.00")
add("Checking", "${TODAY}", "Plain Two", "-2.00")
loan = add("Mortgage", "${FIRST}", "Mortgage Payment", "1500.00", "Loans")
cur.execute("UPDATE transactions SET principal_amount = '900.00' WHERE id = ?", (loan,))
`);

const app = await launchApp({ dbDir });
const { browser: b } = app;
const invoke = makeInvoke(b);
const snapshot = () => sqlRows(dbDir, "SELECT id, account_id, fingerprint, cleared, reconciliation_id, principal_amount FROM transactions ORDER BY id");
// Which account each row is in and whether it is ticked (a rename legitimately changes a fingerprint).
const ownership = () => sqlRows(dbDir, "SELECT id, account_id, cleared FROM transactions ORDER BY id");
const resets = () => sqlRows(dbDir, "SELECT account_id, period, reset_date, balance FROM balance_resets ORDER BY id");
const clearSelection = async () => { await (await b.$("button=Clear selection")).click(); };

async function expectBlocked({ description, also = "Plain One", destination = "Savings", code, mention }) {
  const before = snapshot();
  const resetsBefore = resets();
  await tickRow(b, description);
  if (also) await tickRow(b, also);
  await chooseMoveDestination(b, destination);
  await waitForReview(b);
  const title = await b.execute(() => document.querySelector("#move-blockers-title")?.textContent ?? null);
  assert.equal(title, "Nothing will be moved", `${description}: blocked (dialog says: ${(await dialogText(b)).slice(0, 400)})`);
  const blocker = await b.$(`[data-move-blocker="${code}"]`);
  assert.equal(await blocker.isExisting(), true, `${description}: the ${code} reason is shown`);
  const reason = await b.execute((code) => document.querySelector(`[data-move-blocker="${code}"]`)?.textContent ?? "", code);
  assert.match(reason, mention, `${description}: the reason is specific`);
  assert.equal(await (await b.$(sel.confirm)).getAttribute("disabled"), "true", `${description}: confirm is off`);
  assert.doesNotMatch(await dialogText(b), /Force|Merge|Delete duplicates|only the rest/i, "no way around the block is offered");
  // The plain row is listed as one that would move, and the blocked one as blocked.
  const statuses = await b.execute(() => [...document.querySelectorAll("[data-move-row]")].map((r) => `${r.textContent}|${r.dataset.status}`));
  assert.ok(statuses.some((s) => s.includes(description) && s.endsWith("|blocked")), `${description} is marked blocked: ${statuses}`);
  if (also) assert.ok(statuses.some((s) => s.includes(also) && s.endsWith("|move")), `${also} is shown as movable on its own: ${statuses}`);
  await (await b.$("button=Cancel")).click();
  await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 5000 });
  assert.deepEqual(snapshot(), before, `${description}: no transaction row changed`);
  assert.deepEqual(resets(), resetsBefore, `${description}: no balance checkpoint changed`);
  await clearSelection();
}

async function expectNeedsConfirmation({ description, also = "Plain One", destination = "Savings" }) {
  const before = snapshot();
  const resetsBefore = resets();
  await tickRow(b, description);
  if (also) await tickRow(b, also);
  await chooseMoveDestination(b, destination);
  await b.waitUntil(() => b.execute(() => Boolean(document.querySelector("[data-move-confirm-balances]"))), { timeout: 15000, timeoutMsg: "the review should ask for balances" });
  const text = await dialogText(b);
  assert.match(text, new RegExp(`Confirm balances to move these to ${destination}`));
  assert.match(text, /The balances you confirm will apply from today/);
  assert.equal(await b.$("#move-blockers-title").isExisting(), false, "a saved balance is no longer a blocker");
  assert.equal(await b.$(sel.confirm).isExisting(), false, "there is no Move button until the balances are confirmed");
  assert.equal(await (await b.$("[data-move-review-balances]")).getAttribute("disabled"), "true", "Review the move waits for every balance");
  await (await b.$("button=Cancel")).click();
  await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 5000 });
  assert.deepEqual(snapshot(), before, `${description}: no transaction row changed`);
  assert.deepEqual(resets(), resetsBefore, `${description}: no saved balance changed`);
  await clearSelection();
}

try {
  await openTransactions(b);
  await expectNeedsConfirmation({ description: "Old Statement Row" });
  await expectBlocked({ description: "Settled Row", code: "settled", mention: /already counted when you reconciled Checking/ });
  await expectBlocked({ description: "Move Out", code: "linked_transfer", mention: /linked transfer/ });
  await expectBlocked({ description: "Dup Cafe", also: "Plain One", code: "duplicate_in_destination", mention: /already in Savings|same as/ });
  await expectBlocked({ description: "Mortgage Payment", also: null, destination: "Checking", code: "principal_override", mention: /principal amount/ });
  console.log("PASS blockers");

  // ---- 6. Something changes while the review is open -------------------------------------------------------
  const ids = Object.fromEntries((await invoke("list_transactions")).map((t) => [t.description, t.id]));
  await tickRow(b, "Plain One");
  await tickRow(b, "Plain Two");
  await chooseMoveDestination(b, "Savings");
  await waitForReview(b);
  const before = ownership();
  await invoke("update_transaction_description", { id: ids["Plain One"], description: "Plain One renamed" });
  await (await b.$(sel.confirm)).click();
  await b.$(sel.notice).waitForExist({ timeout: 10000, timeoutMsg: "a stale confirmation should say details changed" });
  assert.match(await b.execute(() => document.querySelector("[data-move-notice]")?.textContent ?? ""), /Something changed while you were reviewing/);
  assert.deepEqual(ownership(), before, "the stale confirmation moved nothing");
  assert.match(await dialogText(b), /Plain One renamed/, "the fresh details show the change");
  await (await b.$(sel.confirm)).click();
  await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 15000 });
  await waitUntilOrDiagnose(b, async () => (await invoke("list_transactions")).filter((t) => t.description.startsWith("Plain") && t.account_name === "Savings").length === 2, { timeoutMsg: "the second, reviewed confirmation moves both rows" });

  // ---- 7. The destination is hidden while the review is open ------------------------------------------------
  await tickRow(b, "Plain One renamed");
  await chooseMoveDestination(b, "Checking");
  await waitForReview(b);
  const beforeHide = ownership();
  await invoke("set_account_hidden", { id: (await invoke("list_accounts")).find((a) => a.name === "Checking").id, hidden: true });
  await (await b.$(sel.confirm)).click();
  await waitUntilOrDiagnose(b, async () => (await b.$("[data-move-error]").isExisting()), { timeoutMsg: "a destination hidden mid-review should be refused with its reason" });
  assert.match(await b.execute(() => document.querySelector("[data-move-error]")?.textContent ?? ""), /hidden/);
  assert.deepEqual(ownership(), beforeHide, "nothing moved into the hidden account");
  await (await b.$("button=Close")).click();
  console.log("PASS feature375");
} finally {
  await app.close();
}
assert.deepEqual(sqlRows(dbDir, "PRAGMA integrity_check"), [["ok"]]);
assert.deepEqual(sqlRows(dbDir, "PRAGMA foreign_key_check"), []);
assert.deepEqual(sqlRows(dbDir, "SELECT COUNT(*) FROM transfer_links"), [[1]], "the transfer link is intact");
