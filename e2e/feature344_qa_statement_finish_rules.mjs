// UAT-043: an investment statement whose holdings can't be checked finishes only after "Finish without checking holdings" is ticked, and then leaves share counts alone.
// UAT-048: finishing a statement is all or nothing. A change made elsewhere while the review is open refuses the finish and records nothing; reading the statement again
// finishes it, and the reconciliation record, the added row and the matched rows are read back from the disposable profile.
// docs/STATEMENT-RECONCILE.md "Investments" and "The review session". Statements are fictional (e2e/lib/statementPdf.mjs).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { checkingStatement, unknownBrokerageStatement } from "./lib/statementPdf.mjs";
import { finishReview, openAccountPage, setStatementDates, uploadStatement, waitForBalanced, waitForNotice, waitForReview, writeStatement } from "./lib/statementUi.mjs";

const start = dateInMonth(-2, 1), end = dateInMonth(-2, 28);
const day = d => dateInMonth(-2, d);
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Harborview Brokerage', 'investment', '0.00')")
b = cur.lastrowid
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)", (b, "${day(2)}", "Deposit from bank", "1000.00", None, None, f"{b}|${day(2)}|deposit from bank|1000.00"))
cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?, 'QQQZ', 'NASDAQ TRACKER FUND', 10, 300.25, 3000.00, 'US Stocks')", (b,))
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '1000.00')")
a = cur.lastrowid
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)", (a, "${day(5)}", "Coffee Shop", "-50.00", None, None, f"{a}|${day(5)}|coffee shop|-50.00"))
`);
const dbFile = path.join(dbDir, "vaultspend.db");
const py = code => JSON.parse(execFileSync("python", ["-c", `import sqlite3,json\nc=sqlite3.connect(r"${dbFile}",timeout=20)\n${code}`]).toString());
const ledger = name => py(`print(json.dumps(c.execute("select description, amount, reconciliation_id is not null from transactions where account_id=(select id from accounts where name='${name}') order by id").fetchall()))`);
const recs = name => py(`print(json.dumps(c.execute("select statement_date, statement_balance from reconciliations where account_id=(select id from accounts where name='${name}')").fetchall()))`);
const layouts = () => py(`print(json.dumps(c.execute("select count(*) from statement_layouts").fetchall()))`)[0][0];

const holdings = [{ symbol: "QQQZ", name: "NASDAQ TRACKER FUND", quantity: 10.5, price: 300.25 }, { symbol: "VTIZ", name: "TOTAL MARKET FUND", quantity: 4, price: 250.1 }];
const brokerage = unknownBrokerageStatement({ start, end, beginningCash: 500, holdings, rows: [
  { date: day(2), description: "Deposit from bank", amount: 1000 },
  { date: day(9), description: "Bought QQQZ 1.0000 at $300.10", amount: -300.1 },
  { date: day(20), description: "Dividend VTIZ", amount: 12.5 },
] });
const checking = checkingStatement({ start, end, opening: 1000, rows: [{ date: day(5), description: "Coffee Shop", amount: -50 }, { date: day(12), description: "Payroll", amount: 200 }] });
const files = { brokerage: writeStatement("harborview.pdf", brokerage.pdf), checking: writeStatement("checking.pdf", checking.pdf) };
const app = await launchApp({ dbDir });
const { browser } = app;
const backToList = async () => { await (await browser.$("//button[normalize-space()='← All accounts']")).click(); };
const reason = async () => (await (await browser.$("[data-finish-reason]")).getText().catch(() => "")).trim();
const finishDisabled = async () => (await (await browser.$("[data-statement-finish]")).getAttribute("disabled")) !== null;
try {
  await browser.setWindowSize(1440, 1400);

  // --- UAT-043: the holdings can't be read; Finish waits for the explicit choice and then leaves share counts alone ------------------------
  await openAccountPage(browser, "Harborview Brokerage");
  await setStatementDates(browser, start, end);
  await uploadStatement(browser, files.brokerage);
  await waitForReview(browser);
  const box = await browser.$("[data-holdings]");
  await box.waitForExist({ timeout: 10000, timeoutMsg: "the holdings section shows" });
  assert.ok((await box.getText()).includes("couldn't read your holdings"), await box.getText());
  assert.equal(await finishDisabled(), true, "Finish is unavailable until the holdings choice is made");
  assert.ok((await reason()).includes("Finish without checking holdings"), "the reason names the choice: " + (await reason()));
  await (await browser.$("[data-finish-without-holdings]")).click();
  await waitUntilOrDiagnose(browser, async () => !(await finishDisabled()), { timeout: 10000, timeoutMsg: "ticking the box makes Finish available", extra: reason });
  await finishReview(browser);
  await waitForNotice(browser, "Reconciled Harborview Brokerage");
  const held = py(`print(json.dumps(c.execute("select symbol, shares from holdings where account_id=(select id from accounts where name='Harborview Brokerage')").fetchall()))`);
  assert.deepEqual(held.map(([s, n]) => [s, Number(n)]), [["QQQZ", 10]], "share counts were not touched: " + JSON.stringify(held));
  assert.equal((await recs("Harborview Brokerage")).length, 1, "one reconciliation was recorded");
  assert.equal(ledger("Harborview Brokerage").length, 3, "the purchase and dividend were added to the deposit: " + JSON.stringify(ledger("Harborview Brokerage")));
  await backToList();

  // --- UAT-048: all or nothing ---------------------------------------------------------------------------------------------------------
  await openAccountPage(browser, "Everyday Checking");
  await setStatementDates(browser, start, end);
  await uploadStatement(browser, files.checking);
  await waitForReview(browser);
  await waitForBalanced(browser);
  // Something else changes this account while the review is open.
  py(`c.execute("insert into transactions (account_id, date, description, amount, fingerprint) values ((select id from accounts where name='Everyday Checking'), '${day(15)}', 'Late Entry', '-5.00', 'late-entry')");c.commit();print('[]')`);
  const before = ledger("Everyday Checking");
  assert.equal(before.length, 2);
  await (await browser.$("[data-statement-finish]")).click();
  let page = "";
  await waitUntilOrDiagnose(browser, async () => (page = await browser.execute(() => document.body.innerText)).includes("Please read the statement again"), { timeout: 10000, timeoutMsg: "a finish after a change elsewhere asks to read the statement again", extra: () => page.slice(0, 300) });
  assert.deepEqual(ledger("Everyday Checking"), before, "nothing was added or settled");
  assert.deepEqual(await recs("Everyday Checking"), [], "no reconciliation was recorded");
  assert.equal(layouts(), 0, "no layout was remembered");
  if (await (await browser.$("[data-statement-review]")).isExisting()) {
    await browser.keys("Escape");
    await waitUntilOrDiagnose(browser, async () => !(await (await browser.$("[data-statement-review]")).isExisting()), { timeout: 10000, timeoutMsg: "the review closes" });
  }
  // Reading the statement again finishes it, and everything is recorded together.
  await uploadStatement(browser, files.checking);
  await waitForReview(browser);
  await waitForBalanced(browser);
  await finishReview(browser);
  await waitForNotice(browser, "Reconciled Everyday Checking");
  const after = ledger("Everyday Checking");
  assert.deepEqual(after.map(([d, a, s]) => [d, Number(a), s]), [["Coffee Shop", -50, 1], ["Late Entry", -5, 0], ["Payroll", 200, 1]], "the matched and added rows are settled, the unrelated one is not: " + JSON.stringify(after));
  const rec = await recs("Everyday Checking");
  assert.equal(rec.length, 1);
  assert.equal(rec[0][0], end, "the record carries the statement date");
  assert.equal(Number(rec[0][1]), 1150, "and the statement's ending balance: " + JSON.stringify(rec));
  console.log("FEATURE 344 PASSED: holdings bypass is explicit and leaves share counts alone; a finish after a change elsewhere records nothing, and the second read records the reconciliation with its rows.");
} finally { await app.close(); }
