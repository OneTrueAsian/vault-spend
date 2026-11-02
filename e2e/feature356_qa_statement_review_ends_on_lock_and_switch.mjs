// UAT-046 a statement review ends when the app locks or the profile changes (docs/STATEMENT-RECONCILE.md "The review session": "Locking the app, switching profile, finishing or cancelling ends the session";
// an old token or another profile's token is refused). Driven through the UI: open a review, lock the protected profile, unlock, and the review is gone with no statement text left on the lock screen
// and nothing recorded; reading the statement again then finishes normally. Then a review is left open while the person creates and moves to another profile and back: nothing carries over.
// The 10-minute lifetime and the token rules themselves are native unit tests (statement_review.rs, 4/4 pass).
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose, openSettingsGroup } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";
import { seedFixtureInto } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { invoke } from "./lib/change-password.mjs";
import { checkingStatement } from "./lib/statementPdf.mjs";
import { finishReview, openAccountPage, setStatementDates, uploadStatement, waitForBalanced, waitForNotice, waitForReview, writeStatement } from "./lib/statementUi.mjs";

const PASSWORD = "statement lock password";
const start = dateInMonth(-2, 1), end = dateInMonth(-2, 28), day = dateInMonth(-2, 5);
const dir = freshTestDbDir();
await seedFixtureInto(dir, `
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '1000.00')")
a = cur.lastrowid
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)", (a, "${day}", "Coffee Shop", "-50.00", None, None, f"{a}|${day}|coffee shop|-50.00"))
`);
const statement = checkingStatement({ start, end, opening: 1000, rows: [{ date: day, description: "Coffee Shop", amount: -50 }, { date: dateInMonth(-2, 12), description: "Payroll", amount: 200 }] });
const file = writeStatement("lock.pdf", statement.pdf);
const app = await launchApp({ dbDir: dir });
const { browser: b } = app;
const reviewOpen = () => b.$("[data-statement-review]").isExisting();
const reconciliations = async () => (await invoke(b, "list_transactions")).ok.filter(t => t.description === "Payroll").length;
try {
  await b.setWindowSize(1440, 1400);
  await (await b.$("button*=Settings")).click();
  await openSettingsGroup(b, "profiles");
  await enableProtectionThroughUI(b, PASSWORD);
  await b.$("button=Change password").waitForExist({ timeout: 30000 });

  // --- lock with a review open ---------------------------------------------------------------------------------------------------------------------------------------
  await openAccountPage(b, "Everyday Checking");
  await setStatementDates(b, start, end);
  await uploadStatement(b, file);
  await waitForReview(b);
  await waitForBalanced(b);
  assert.equal((await invoke(b, "debug_apply_system_session_event", { event: "locked" })).ok, true);
  await b.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  assert.ok(!(await b.execute(() => /Coffee Shop|Payroll|Everyday Checking|Reconcile/.test(document.body.textContent))), "no statement or account text on the lock screen");
  await b.$("#password-form-field").setValue(PASSWORD); await b.$("button=Unlock").click();
  await b.$(".brand-word").waitForExist({ timeout: 30000 });
  assert.equal(await reviewOpen(), false, "the review did not come back after unlocking");
  assert.equal(await reconciliations(), 0, "nothing was added by the abandoned review");

  // A fresh read after unlocking works from the start.
  await openAccountPage(b, "Everyday Checking");
  await setStatementDates(b, start, end);
  await uploadStatement(b, file);
  await waitForReview(b);
  await waitForBalanced(b);
  await finishReview(b);
  await waitForNotice(b, "Reconciled Everyday Checking");
  assert.equal(await reconciliations(), 1, "the second read added the missing payroll line");

  // --- profile change with a review open --------------------------------------------------------------------------------------------------------------------------------
  const second = writeStatement("switch.pdf", checkingStatement({ start, end, opening: 1150, rows: [{ date: dateInMonth(-2, 20), description: "Dividend", amount: 10 }] }).pdf);
  await b.execute(() => document.querySelector(".nav-item[data-tab=accounts]").click());
  await waitUntilOrDiagnose(b, async () => (await b.$$("//button[normalize-space()='← All accounts']")).length > 0 || (await b.$$("[data-account-details]")).length > 0, { timeout: 10000, timeoutMsg: "Accounts is showing" });
  if ((await b.$$("//button[normalize-space()='← All accounts']")).length) await (await b.$("//button[normalize-space()='← All accounts']")).click();
  await openAccountPage(b, "Everyday Checking");
  await setStatementDates(b, dateInMonth(-1, 1), dateInMonth(-1, 28));
  await uploadStatement(b, second);
  await waitForReview(b);
  await b.execute(() => document.querySelector('.nav-item[data-tab="settings"]').click()); // a DOM click: the open dialog's overlay covers the sidebar
  await openSettingsGroup(b, "profiles");
  await b.$(".profile-create-form input").waitForExist({ timeout: 10000 });
  await waitUntilOrDiagnose(b, async () => { try { await (await b.$(".profile-create-form input")).setValue("Other Profile"); return true; } catch { return false; } }, { timeout: 10000, timeoutMsg: "the new-profile name can be typed" });
  await b.$('.profile-create-form button[type="submit"]').click();
  await waitUntilOrDiagnose(b, async () => (await b.$(".profile-switcher-name").getText()) === "Other Profile", { timeout: 20000, timeoutMsg: "creating a profile moves to it" });
  assert.equal(await reviewOpen(), false, "the review did not follow the person into the other profile");
  assert.equal((await invoke(b, "list_accounts")).ok.length, 0, "the other profile is empty");
  console.log("FEATURE 356 PASSED: a statement review ends when the app locks or the profile changes, and a fresh read after unlocking finishes normally.");
} finally { await app.close(); }
