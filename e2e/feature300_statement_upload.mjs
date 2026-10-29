// E2E test for uploading a bank statement PDF and reconciling against it:
//   - a statement in a common shape is read without help; lines already in the app are matched, a line the
//     app doesn't have starts as Add, and an app transaction that isn't on the statement is listed as such;
//   - the figures reach $0.00 and finishing records the reconciliation and remembers the statement;
//   - the next month's statement is recognised, picks up from last time (no starting balance asked) and
//     finishes the same way;
//   - Settings lists what the app learned, and removing it works.
//
// Run with: node e2e/feature300_statement_upload.mjs

import { launchApp, waitUntilOrDiagnose, openSettingsGroup } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth, displayDate } from "./lib/dates.mjs";
import { checkingStatement } from "./lib/statementPdf.mjs";
import {
  finishReview,
  goTo,
  openAccountPage,
  setStatementDates,
  uploadStatement,
  waitForBalanced,
  waitForNotice,
  waitForReview,
  writeStatement,
} from "./lib/statementUi.mjs";

// Two months that are over: A is two months back, B one month back (days 1-28 exist in every month).
const aStart = dateInMonth(-2, 1);
const aEnd = dateInMonth(-2, 28);
const bStart = dateInMonth(-1, 1);
const bEnd = dateInMonth(-1, 28);
const coffeeDay = dateInMonth(-2, 5);
const gasDay = dateInMonth(-2, 12);
const salaryDay = dateInMonth(-2, 20);
const hardwareDay = dateInMonth(-1, 10);

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '1000.00')")
acct = cur.lastrowid
for d, desc, amt in (("${coffeeDay}", "Coffee Shop", "-50.00"), ("${gasDay}", "Gas Station", "-30.00")):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, amt, None, None, f"{acct}|{d}|{desc.lower()}|{amt}"))
`);

// Month A: one line the app has (Coffee Shop), one it doesn't (the salary). The gas stop is in the app only.
const monthA = checkingStatement({
  start: aStart,
  end: aEnd,
  opening: 1000,
  rows: [
    { date: coffeeDay, description: "Coffee Shop", amount: -50 },
    { date: salaryDay, description: "Salary Deposit", amount: 200 },
  ],
});
// Month B picks up where A ended and has one new line.
const monthB = checkingStatement({ start: bStart, end: bEnd, opening: monthA.closing, rows: [{ date: hardwareDay, description: "Hardware Store", amount: -75 }] });
const fileA = writeStatement("statement-a.pdf", monthA.pdf);
const fileB = writeStatement("statement-b.pdf", monthB.pdf);

const app = await launchApp({ dbDir });
const { browser } = app;

async function choiceOf(description) {
  const row = await browser.$(`//tr[@data-statement-row][contains(normalize-space(.), "${description}")]`);
  await row.waitForExist({ timeout: 10000, timeoutMsg: `the review should list ${description}` });
  return row.getAttribute("data-choice");
}
async function shot(name) {
  if (process.env.VAULTSPEND_E2E_SHOTS) await browser.saveScreenshot(`${process.env.VAULTSPEND_E2E_SHOTS}/feature300-${name}.png`);
}

try {
  await browser.setWindowSize(1440, 1400);
  await openAccountPage(browser, "Everyday Checking");

  // --- month A: a statement the app reads on its own ----------------------------------------------------
  await setStatementDates(browser, aStart, aEnd);
  await uploadStatement(browser, fileA);
  await waitForReview(browser);
  if (await (await browser.$("[data-needs-help]")).isExisting()) throw new Error("a statement in a common shape should be read without asking for help");
  if ((await choiceOf("Coffee Shop")) !== "match") throw new Error("the Coffee Shop line is in the app, so it should start as a match");
  if ((await choiceOf("Salary Deposit")) !== "add") throw new Error("the salary line isn't in the app, so it should start as Add");
  const notOn = await (await browser.$("[data-not-on-statement]")).getText();
  if (!notOn.includes("Gas Station")) throw new Error(`the gas stop is in the app but not on the statement, so it should be listed: ${notOn}`);
  // The account's first reconciliation also asks where the statement started: prefilled from the statement.
  const start = await browser.$("[data-statement-review-start]");
  await start.waitForExist({ timeout: 5000, timeoutMsg: "the first reconciliation asks for the starting balance" });
  if ((await start.getValue()) !== "1000.00") throw new Error(`the starting balance should be prefilled from the statement, got ${await start.getValue()}`);
  await waitForBalanced(browser);
  await shot("month-a-review");
  if (!(await (await browser.$("[data-remember-toggle]")).isSelected())) throw new Error("Remember this statement should start ticked");
  await finishReview(browser);
  const doneA = await waitForNotice(browser, "Reconciled Everyday Checking");
  if (!doneA.includes("Added 1 transaction.")) throw new Error(`the message should say one transaction was added: ${doneA}`);
  if (!doneA.includes("recognize")) throw new Error(`the message should say the app will recognize this statement next time: ${doneA}`);
  let lastSeen = "";
  await waitUntilOrDiagnose(browser, async () => (lastSeen = (await (await browser.$("[data-last-reconciled] .stat-value")).getText()).trim()) === displayDate(aEnd), {
    timeoutMsg: `Last reconciled should show ${displayDate(aEnd)}`,
    extra: () => lastSeen,
  });

  // --- month B: recognised, picks up from last time ------------------------------------------------------
  await setStatementDates(browser, bStart, bEnd);
  await uploadStatement(browser, fileB);
  await waitForReview(browser);
  const heading = await (await browser.$("[data-statement-review] .statement-heading")).getText();
  if (!heading.includes("Read using:")) throw new Error(`the learned statement should be recognized, but the heading reads: ${heading}`);
  if (await (await browser.$("[data-statement-review-start]")).isExisting()) throw new Error("the second statement picks up from the first, so it must not ask for a starting balance");
  if ((await choiceOf("Hardware Store")) !== "add") throw new Error("the hardware line isn't in the app, so it should start as Add");
  await waitForBalanced(browser);
  await shot("month-b-review");
  await finishReview(browser);
  await waitForNotice(browser, "Reconciled Everyday Checking");

  // --- Settings lists what was learned ---------------------------------------------------------------------
  await goTo(browser, "Settings");
  await openSettingsGroup(browser, "features");
  const section = await browser.$("[data-statement-layouts]");
  await section.waitForExist({ timeout: 10000, timeoutMsg: "Settings should list the statements the app knows how to read" });
  await waitUntilOrDiagnose(browser, async () => (await browser.$$("[data-statement-layouts] [data-layout]")).length === 1, {
    timeoutMsg: "Settings should list exactly the one statement the app learned",
    extra: async () => await section.getText(),
  });
  await (await browser.$("[data-statement-layouts] [data-remove-layout]")).click();
  await (await browser.$("[data-statement-layouts] [data-confirm-remove-layout]")).click();
  await waitUntilOrDiagnose(browser, async () => (await browser.$$("[data-statement-layouts] [data-layout]")).length === 0, {
    timeoutMsg: "removing it should empty the list",
    extra: async () => await section.getText(),
  });

  console.log("FEATURE 300 E2E TEST PASSED");
} finally {
  await app.close();
}
