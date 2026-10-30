// Moving transactions in a password-protected profile: the review belongs to the session it was opened in.
//   1. A review is open on a protected profile when the profile locks: the review and every transaction it showed
//      leave the page, and the preview and move commands refuse with PROFILE_LOCKED.
//   2. After unlocking, no review comes back, nothing has moved, and a move sent with the old session's identity is
//      refused as STALE_PROFILE (the same numbers can name different rows in another session or profile).
//   3. A fresh review in the new session moves the rows, and the protected profile shows them in the destination.
//
// Run with: node e2e/feature378_move_transactions_protected_session.mjs

import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { enableProtectionThroughUI, waitForProtectionSetupCompletion } from "./lib/protection.mjs";
import { FIRST, TODAY, chooseMoveDestination, dialogText, makeInvoke, openTransactions, pageText, seedMoveFixture, sel, tickRow, waitForReview } from "./lib/moveTransactions.mjs";

const PASSWORD = "correct horse battery staple";
const dbDir = await seedMoveFixture(`
add("Checking", "${TODAY}", "Corner Cafe", "-4.25", "Dining Out")
add("Checking", "${FIRST}", "Fuel Stop", "-30.00", "Transportation")
`);

const app = await launchApp({ dbDir });
const { browser: b } = app;
const raw = makeInvoke(b);
/** Like makeInvoke, but returns the refusal instead of throwing, so its code can be checked. */
const attempt = async (command, args = {}) => {
  const r = await b.executeAsync((command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then((ok) => done({ ok }), (e) => done({ error: typeof e === "string" ? e : JSON.stringify(e) })), command, args);
  return r;
};

try {
  await (await b.$("button*=Settings")).click();
  await enableProtectionThroughUI(b, PASSWORD);
  await waitForProtectionSetupCompletion(b);
  await openTransactions(b);

  const rows = await raw("list_transactions");
  const ids = rows.filter((t) => t.description === "Corner Cafe" || t.description === "Fuel Stop").map((t) => t.id).sort((x, y) => x - y);
  const savings = (await raw("list_accounts")).find((a) => a.name === "Savings").id;

  await tickRow(b, "Corner Cafe");
  await tickRow(b, "Fuel Stop");
  await chooseMoveDestination(b, "Savings");
  await waitForReview(b);
  assert.match(await dialogText(b), /Move 2 transactions to Savings\?/);
  const context = await raw("get_transaction_context");
  const preview = await raw("preview_transaction_account_move", { ids, destinationAccountId: savings });
  assert.equal(preview.preview.canCommit, true);

  // ---- 1. Lock with the review open -------------------------------------------------------------------------
  await raw("lock_current_profile", { expectedGeneration: await raw("get_current_generation") });
  await b.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  assert.equal(await b.$(sel.dialog).isExisting(), false, "the review is gone from the locked page");
  const locked = await pageText(b);
  for (const secret of ["Corner Cafe", "Fuel Stop", "Move 2 transactions"]) assert.ok(!locked.includes(secret), `the locked page must not keep "${secret}"`);
  for (const command of ["preview_transaction_account_move", "move_transactions_to_account"]) {
    const refused = await attempt(command, { ids, destinationAccountId: savings, expectedPreviewToken: preview.preview.token, operationId: "e2e-locked-refusal" });
    assert.ok(refused.error?.startsWith("PROFILE_LOCKED"), `${command} must fail closed while locked: ${JSON.stringify(refused)}`);
  }

  // ---- 2. Unlock: no review returns; the old session cannot move anything -----------------------------------
  await (await b.$("#password-form-field")).setValue(PASSWORD);
  await (await b.$("button[type='submit']")).click();
  await b.$(".brand-word").waitForExist({ timeout: 15000 });
  assert.equal(await b.$(sel.dialog).isExisting(), false, "no review comes back after unlocking");
  const fresh = await raw("get_transaction_context");
  assert.notEqual(fresh.sessionRevision, context.sessionRevision, "unlocking starts a new session");
  const stale = await attempt("move_transactions_to_account", {
    ids, destinationAccountId: savings, expectedPreviewToken: preview.preview.token, operationId: "e2e-stale-refusal", expectedGeneration: context.generation, expectedSessionRevision: context.sessionRevision,
  });
  assert.ok(stale.error?.startsWith("STALE_PROFILE"), `a move from the old session must be refused: ${JSON.stringify(stale)}`);
  const staleRead = await attempt("preview_transaction_account_move", { ids, destinationAccountId: savings, expectedGeneration: context.generation, expectedSessionRevision: context.sessionRevision });
  assert.ok(staleRead.error?.startsWith("STALE_PROFILE"), `a preview from the old session must be refused: ${JSON.stringify(staleRead)}`);
  assert.deepEqual((await raw("list_transactions")).filter((t) => ids.includes(t.id)).map((t) => t.account_name), ["Checking", "Checking"], "nothing moved");

  // ---- 3. A fresh review in the new session moves them -------------------------------------------------------
  await openTransactions(b);
  await tickRow(b, "Corner Cafe");
  await tickRow(b, "Fuel Stop");
  await chooseMoveDestination(b, "Savings");
  await waitForReview(b);
  await (await b.$(sel.confirm)).click();
  await b.$(sel.dialog).waitForExist({ reverse: true, timeout: 15000 });
  await waitUntilOrDiagnose(b, async () => (await raw("list_transactions")).filter((t) => ids.includes(t.id)).every((t) => t.account_name === "Savings"), { timeoutMsg: "the protected profile should show both rows in Savings" });
  console.log("PASS feature378");
} finally {
  await app.close();
}
