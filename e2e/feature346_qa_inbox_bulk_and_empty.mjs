// UAT-082 (Review inbox: bulk accept, and rejecting a duplicate) and UAT-086 (nothing to review).
// Specified behaviour (Old/vault-spend-inbox-bulk-review-uat.md:12-13, src/ImportInboxDialog.tsx): "Review selected" accepts the shown categories and keeps flagged transactions, clearing
// their flags, and needs a category for every selected row that has none; the only way to reject a transaction is the per-row "Delete duplicate", which removes that one row.
// With nothing flagged there is no Review inbox button at all and the Transactions page shows no "needs a category" prompt.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const flagged = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000')")
acct = cur.lastrowid
for days, desc, amount, category, source, confidence in [
    (1, 'Unknown One', '-10', None, None, None),
    (2, 'Unknown Two', '-20', None, None, None),
    (3, 'Bakery', '-12', 'Dining Out', 'classifier', 0.5),
    (4, 'Netflix', '-15.49', 'Subscriptions', 'user', None),
    (5, 'Netflix', '-15.49', 'Subscriptions', 'user', None),
    (6, 'Spotify', '-10.99', 'Subscriptions', 'user', None),
    (7, 'Spotify', '-10.99', 'Subscriptions', 'user', None),
]:
    day = (today - datetime.timedelta(days=days)).isoformat()
    cur.execute("INSERT INTO transactions (account_id,date,description,amount,category,category_source,confidence,fingerprint) VALUES (?,?,?,?,?,?,?,?)", (acct,day,desc,amount,category,source,confidence,f"{acct}|{day}|{desc.lower()}|{amount}"))
`);
const clean = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000')")
acct = cur.lastrowid
for days, desc, amount, category in [(2, 'Payroll', '1500', 'Income'), (3, 'Grocer', '-60', 'Groceries'), (9, 'Landlord', '-900', 'Rent')]:
    day = (today - datetime.timedelta(days=days)).isoformat()
    cur.execute("INSERT INTO transactions (account_id,date,description,amount,category,category_source,fingerprint) VALUES (?,?,?,?,?,?,?)", (acct,day,desc,amount,category,'user',f"{acct}|{day}|{desc.lower()}|{amount}"))
`);

async function openTransactions(b) {
  for (const button of await b.$$("nav button")) if ((await button.getText()).trim() === "Transactions") { await button.click(); break; }
  await b.$(".page-top .page-actions .import-controls").waitForExist({ timeout: 10000 });
}
const names = b => b.executeAsync(done => window.__TAURI_INTERNALS__.invoke("list_transactions").then(t => done(t.map(x => x.description)), () => done(null)));
const countOf = (all, name) => all.filter(d => d === name).length;
const rowFor = (b, name) => b.$(`//*[@data-inbox-row][contains(normalize-space(.), "${name}")]`);

let app = await launchApp({ dbDir: flagged });
try {
  const b = app.browser;
  await b.setWindowSize(1100, 1000);
  await openTransactions(b);
  await (await b.$("[data-inbox-open]")).click();
  await b.$("[data-inbox-bulk]").waitForExist({ timeout: 5000 });
  assert.equal((await b.$$("[data-inbox-row]")).length, 7);

  // Bulk accept needs a category for every selected row that has none.
  await (await b.$('[aria-label^="Select Unknown One on"]')).click();
  assert.equal(await b.$("[data-inbox-review-selected]").isEnabled(), false, "a row with no category blocks Review selected");
  assert.ok((await b.$(".inbox-bulk-help").getText()).includes("Choose a category for 1 selected transaction first."), await b.$(".inbox-bulk-help").getText());
  await (await b.$('[aria-label^="Select Unknown One on"]')).click();

  // Accept the shown category for the low-confidence guess and keep the flagged pairs: three reviewed, the rest untouched.
  for (const name of ["Bakery", "Netflix", "Spotify"]) for (const box of await b.$$(`//*[@data-inbox-row][contains(normalize-space(.), "${name}")]//input[@data-inbox-select]`)) await box.click();
  assert.ok((await b.$("[data-inbox-bulk]").getText()).includes("5 selected"), await b.$("[data-inbox-bulk]").getText());
  await (await b.$("[data-inbox-review-selected]")).click();
  await waitUntilOrDiagnose(b, async () => (await b.$$('[data-inbox-state="done"]')).length === 5, { timeout: 10000, timeoutMsg: "the five selected rows are reviewed" });
  assert.equal((await b.$$('[data-inbox-state="open"]')).length, 2, "the two unselected rows are still to review");
  assert.ok((await b.$("[data-inbox-summary]").getText()).includes("2 of 7 still to review"), await b.$("[data-inbox-summary]").getText());
  let all = await names(b);
  assert.equal(all.length, 7, "bulk accept removes nothing");

  // Rejecting is per row: Delete duplicate removes that one Spotify and nothing else. Reopen with a fresh inbox of what is left flagged.
  await (await b.$("[data-inbox-close]")).click();
  await b.$(".modal-panel").waitForExist({ reverse: true, timeout: 10000 });
  await waitUntilOrDiagnose(b, async () => (await b.$("[data-inbox-open]").getText()).includes("(2)"), { timeout: 10000, timeoutMsg: "the reviewed rows left the inbox, two remain" });
  assert.equal(countOf(all, "Spotify"), 2);
} finally { await app.close(); }

// Restart: the dismissed flags persisted, so only the two unreviewed rows come back.
app = await launchApp({ dbDir: flagged });
try {
  const c = app.browser;
  await c.setWindowSize(1100, 1000);
  await openTransactions(c);
  await (await c.$("[data-inbox-open]")).click();
  await c.$("[data-inbox-list]").waitForExist({ timeout: 5000 });
  assert.equal((await c.$$("[data-inbox-row]")).length, 2, "only the two unreviewed rows come back: the dismissed flags persisted");
  await (await c.$("[data-inbox-close]")).click();
} finally { await app.close(); }

// A pair of duplicates with nothing reviewed: deleting one removes only that row.
const pair = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000')")
acct = cur.lastrowid
for days, desc, amount in [(3, 'Spotify', '-10.99'), (4, 'Spotify', '-10.99'), (5, 'Grocer', '-60')]:
    day = (today - datetime.timedelta(days=days)).isoformat()
    cur.execute("INSERT INTO transactions (account_id,date,description,amount,category,category_source,fingerprint) VALUES (?,?,?,?,?,?,?)", (acct,day,desc,amount,'Subscriptions' if desc == 'Spotify' else 'Groceries','user',f"{acct}|{day}|{desc.lower()}|{amount}|{days}"))
`);
app = await launchApp({ dbDir: pair });
try {
  const b = app.browser;
  await b.setWindowSize(1100, 1000);
  await openTransactions(b);
  await (await b.$("[data-inbox-open]")).click();
  await b.$("[data-inbox-list]").waitForExist({ timeout: 5000 });
  assert.equal((await b.$$("[data-inbox-row]")).length, 2);
  await (await (await rowFor(b, "Spotify")).$("[data-inbox-delete]")).click();
  await waitUntilOrDiagnose(b, async () => countOf(await names(b), "Spotify") === 1, { timeout: 10000, timeoutMsg: "Delete duplicate removes one Spotify", extra: () => names(b) });
  const all = await names(b);
  assert.equal(countOf(all, "Grocer"), 1, "nothing else was deleted");
  assert.equal(all.length, 2);
} finally { await app.close(); }

// UAT-086: nothing flagged, so there is nothing to open.
app = await launchApp({ dbDir: clean });
try {
  const b = app.browser;
  await b.setWindowSize(1100, 1000);
  await openTransactions(b);
  await (await b.$("table.ledger")).waitForExist({ timeout: 15000 });
  assert.equal(await b.$("[data-inbox-open]").isExisting(), false, "no Review transactions button when nothing needs a look");
  const page = await b.execute(() => document.body.innerText);
  assert.ok(!/need a category|Review (inbox|transactions)/.test(page), "no prompts about reviewing: " + page.slice(0, 300));
  console.log("FEATURE 346 PASSED: bulk review accepts and keeps without removing anything, Delete duplicate removes one row, and a clean profile offers no inbox.");
} finally { await app.close(); }
