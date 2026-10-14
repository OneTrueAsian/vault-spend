// E2E test for a bank the app has never seen:
//   - a picture-only PDF is refused with a plain message;
//   - a statement from an unknown bank can't be read on its own, so the review offers three ways forward;
//   - clicking one example of each thing teaches the app, and the reading then adds up;
//   - finishing remembers the bank, and the next month's statement is read without any teaching.
//
// Run with: node e2e/feature301_statement_teach.mjs

import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { buildPdf, money, unknownBankStatement } from "./lib/statementPdf.mjs";
import {
  finishReview,
  openAccountPage,
  setStatementDates,
  uploadStatement,
  waitForBalanced,
  waitForNotice,
  waitForReview,
  writeStatement,
} from "./lib/statementUi.mjs";

const aStart = dateInMonth(-2, 1);
const aEnd = dateInMonth(-2, 28);
const bStart = dateInMonth(-1, 1);
const bEnd = dateInMonth(-1, 28);
const dayFirst = (iso) => iso.split("-").reverse().join("/");

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Riverbend Checking', 'checking', '0.00')")
`);

const monthA = unknownBankStatement({
  start: aStart,
  end: aEnd,
  opening: 1250,
  rows: [
    { date: dateInMonth(-2, 3), description: "Supermarket purchase", amount: -54.2 },
    { date: dateInMonth(-2, 5), description: "Salary EXAMPLE EMPLOYER", amount: 2000 },
    { date: dateInMonth(-2, 12), description: "Electricity bill", amount: -120.35 },
  ],
});
const monthB = unknownBankStatement({
  start: bStart,
  end: bEnd,
  opening: monthA.closing,
  rows: [
    { date: dateInMonth(-1, 4), description: "Pharmacy", amount: -18.45 },
    { date: dateInMonth(-1, 20), description: "Transfer received", amount: 75 },
  ],
});
const fileA = writeStatement("riverbend-a.pdf", monthA.pdf);
const fileB = writeStatement("riverbend-b.pdf", monthB.pdf);
const picture = writeStatement("picture-only.pdf", buildPdf([[]]));

const app = await launchApp({ dbDir });
const { browser } = app;

/** Clicks the first word on the teaching screen whose text is exactly `text`. */
async function clickWord(text) {
  const word = await browser.$(`//button[contains(@class,"statement-teach-word") and normalize-space()="${text}"]`);
  await word.waitForExist({ timeout: 10000, timeoutMsg: `the statement text should offer "${text}" to click` });
  await word.click();
}
async function prompt() {
  return (await (await browser.$("[data-teach-prompt]")).getText()).trim();
}
async function waitForPrompt(expected) {
  let seen = "";
  await waitUntilOrDiagnose(browser, async () => (seen = await prompt()) === expected, { timeoutMsg: `the teaching prompt should read "${expected}"`, extra: () => seen });
}
async function shot(name) {
  if (process.env.VAULTSPEND_E2E_SHOTS) await browser.saveScreenshot(`${process.env.VAULTSPEND_E2E_SHOTS}/feature301-${name}.png`);
}

try {
  await browser.setWindowSize(1440, 1400);
  await openAccountPage(browser, "Riverbend Checking");

  // --- a picture of a statement can't be read ---------------------------------------------------------------
  await setStatementDates(browser, aStart, aEnd);
  await uploadStatement(browser, picture);
  const errorBox = await browser.$("[data-statement-error]");
  await errorBox.waitForExist({ timeout: 20000, timeoutMsg: "a picture-only PDF should be refused with a message" });
  if (!(await errorBox.getText()).includes("picture of the statement")) throw new Error(`the message should say the PDF is a picture: ${await errorBox.getText()}`);

  // --- an unknown bank: the app asks for help -----------------------------------------------------------------
  await uploadStatement(browser, fileA);
  await waitForReview(browser);
  const help = await browser.$("[data-needs-help]");
  await waitUntilOrDiagnose(browser, async () => help.isExisting(), {
    timeoutMsg: "an unknown bank's statement should ask for help",
    extra: async () => await (await browser.$("[data-statement-review]")).getText(),
  });
  if (!(await help.getText()).includes("Some of this statement couldn't be read.")) throw new Error(`unexpected help text: ${await help.getText()}`);
  for (const selector of ["[data-teach]", "[data-use-download]", "[data-reconcile-by-hand]"]) {
    if (!(await (await browser.$(selector)).isExisting())) throw new Error(`the help banner should offer ${selector}`);
  }
  await shot("needs-help");

  // --- teach it with one click each ------------------------------------------------------------------------------
  await (await browser.$("[data-teach]")).click();
  await browser.$("[data-statement-teach]").waitForExist({ timeout: 10000, timeoutMsg: "the teaching screen should open" });
  await waitForPrompt("Click the date of one transaction.");
  await clickWord(dayFirst(dateInMonth(-2, 3)));
  await waitForPrompt("Click that transaction's amount.");
  await clickWord("54.20");
  await waitForPrompt("Click the starting balance.");
  await clickWord("1,250.00");
  await waitForPrompt("Click the ending balance.");
  await clickWord(money(monthA.closing));
  await waitForPrompt("That's everything. Check your examples.");
  await shot("teaching");
  await (await browser.$("[data-teach-submit]")).click();

  // --- the reading now adds up -------------------------------------------------------------------------------------
  await waitUntilOrDiagnose(browser, async () => !(await (await browser.$("[data-statement-teach]")).isExisting()), {
    timeout: 20000,
    timeoutMsg: "the teaching screen should close once the examples were checked",
  });
  await waitForReview(browser);
  if (await (await browser.$("[data-needs-help]")).isExisting()) throw new Error("after teaching, the reading should add up and the help banner should be gone");
  const rows = await browser.$$("[data-statement-row]");
  if (rows.length !== 3) throw new Error(`three statement lines should be read, found ${rows.length}`);
  for (const row of rows) {
    if ((await row.getAttribute("data-choice")) !== "add") throw new Error("with no transactions in the app, every line should start as Add");
  }
  const start = await browser.$("[data-statement-review-start]");
  if ((await start.getValue()) !== "1250.00") throw new Error(`the starting balance should be prefilled from the statement, got ${await start.getValue()}`);
  await waitForBalanced(browser);
  const remember = await browser.$("[data-remember]");
  await remember.waitForExist({ timeout: 5000, timeoutMsg: "a newly taught statement should offer to be remembered" });
  if (!(await remember.getText()).includes("Riverbend Mutual Bank")) throw new Error(`the remember section should offer the bank's name: ${await remember.getText()}`);
  if (!(await (await browser.$("[data-remember-phrase]")).isSelected())) throw new Error("the first phrase should start ticked");
  await shot("taught-review");
  await finishReview(browser);
  const done = await waitForNotice(browser, "Reconciled Riverbend Checking");
  if (!done.includes("Added 3 transactions.")) throw new Error(`the message should say three transactions were added: ${done}`);

  // --- next month: recognised, no teaching ------------------------------------------------------------------------------
  await setStatementDates(browser, bStart, bEnd);
  await uploadStatement(browser, fileB);
  await waitForReview(browser);
  const heading = await (await browser.$("[data-statement-review] .statement-heading")).getText();
  if (!heading.includes("Read using:")) throw new Error(`the taught statement should be recognized next time, but the heading reads: ${heading}`);
  if (await (await browser.$("[data-needs-help]")).isExisting()) throw new Error("a remembered bank must not ask for help again");
  if (await (await browser.$("[data-statement-review-start]")).isExisting()) throw new Error("the second statement picks up from the first");
  await waitForBalanced(browser);
  await finishReview(browser);
  await waitForNotice(browser, "Reconciled Riverbend Checking");

  console.log("FEATURE 301 E2E TEST PASSED");
} finally {
  await app.close();
}
