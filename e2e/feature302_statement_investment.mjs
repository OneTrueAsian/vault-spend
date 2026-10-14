// E2E test for an investment statement from a brokerage the app has never seen:
//   - the cash activity checks out, but the holdings table isn't read, so the app asks to be shown one;
//   - after one example of each column the share counts are compared: one holding differs, one is missing;
//   - finishing updates the app's share count, adds the missing holding with what was paid, and the
//     Investments tab shows both;
//   - the next month's statement is recognised and its holdings are read without any teaching.
//
// Run with: node e2e/feature302_statement_investment.mjs

import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { unknownBrokerageStatement } from "./lib/statementPdf.mjs";
import {
  finishReview,
  goTo,
  openAccountPage,
  setStatementDates,
  uploadStatement,
  waitForNotice,
  waitForReview,
  writeStatement,
} from "./lib/statementUi.mjs";

const aStart = dateInMonth(-2, 1);
const aEnd = dateInMonth(-2, 28);
const bStart = dateInMonth(-1, 1);
const bEnd = dateInMonth(-1, 28);
const depositDay = dateInMonth(-2, 2);

// The app already has the deposit and holds 10 shares of QQQZ.
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Harborview Brokerage', 'investment', '0.00')")
acct = cur.lastrowid
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
            (acct, "${depositDay}", "Deposit from bank", "1000.00", None, None, f"{acct}|${depositDay}|deposit from bank|1000.00"))
cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?, 'QQQZ', 'NASDAQ TRACKER FUND', 10, 300.25, 3000.00, 'US Stocks')", (acct,))
`);

const holdings = [
  { symbol: "QQQZ", name: "NASDAQ TRACKER FUND", quantity: 10.5, price: 300.25 },
  { symbol: "VTIZ", name: "TOTAL MARKET FUND", quantity: 4, price: 250.1 },
];
const monthA = unknownBrokerageStatement({
  start: aStart,
  end: aEnd,
  beginningCash: 500,
  holdings,
  rows: [
    { date: depositDay, description: "Deposit from bank", amount: 1000 },
    { date: dateInMonth(-2, 9), description: "Bought QQQZ 1.0000 at $300.10", amount: -300.1 },
    { date: dateInMonth(-2, 20), description: "Dividend VTIZ", amount: 12.5 },
  ],
});
const monthB = unknownBrokerageStatement({
  start: bStart,
  end: bEnd,
  beginningCash: monthA.endingCash,
  holdings,
  rows: [{ date: dateInMonth(-1, 15), description: "Dividend VTIZ", amount: 12.5 }],
});
const fileA = writeStatement("harborview-a.pdf", monthA.pdf);
const fileB = writeStatement("harborview-b.pdf", monthB.pdf);

const app = await launchApp({ dbDir });
const { browser } = app;

async function clickWord(text) {
  const word = await browser.$(`//button[contains(@class,"statement-teach-word") and normalize-space()="${text}"]`);
  await word.waitForExist({ timeout: 10000, timeoutMsg: `the statement text should offer "${text}" to click` });
  await word.click();
}
async function waitForPrompt(expected) {
  let seen = "";
  await waitUntilOrDiagnose(browser, async () => (seen = (await (await browser.$("[data-teach-prompt]")).getText()).trim()) === expected, {
    timeoutMsg: `the teaching prompt should read "${expected}"`,
    extra: () => seen,
  });
}
async function holdingStatus(symbol) {
  const row = await browser.$(`[data-holding="${symbol}"]`);
  await row.waitForExist({ timeout: 10000, timeoutMsg: `the review should list the ${symbol} holding` });
  return row.getAttribute("data-holding-status");
}
const pageText = () => browser.execute(() => document.body.innerText);
async function shot(name) {
  if (process.env.VAULTSPEND_E2E_SHOTS) await browser.saveScreenshot(`${process.env.VAULTSPEND_E2E_SHOTS}/feature302-${name}.png`);
}

try {
  await browser.setWindowSize(1440, 1400);
  await openAccountPage(browser, "Harborview Brokerage");

  // --- month A: the cash activity reads, the holdings don't ------------------------------------------------------
  await setStatementDates(browser, aStart, aEnd);
  await uploadStatement(browser, fileA);
  await waitForReview(browser);
  const holdingsBox = await browser.$("[data-holdings]");
  await holdingsBox.waitForExist({ timeout: 10000, timeoutMsg: "an investment statement should show its holdings section" });
  if (!(await holdingsBox.getText()).includes("The app couldn't read your holdings correctly.")) throw new Error(`the holdings should not have been read: ${await holdingsBox.getText()}`);
  await shot("holdings-unread");

  // --- teach the holdings table with one example of each column ----------------------------------------------------
  await (await browser.$("[data-teach-holdings]")).click();
  await browser.$("[data-statement-teach]").waitForExist({ timeout: 10000, timeoutMsg: "the teaching screen should open" });
  await waitForPrompt("Click the symbol of one holding.");
  await clickWord("QQQZ");
  await waitForPrompt("Click its number of shares.");
  await clickWord("10.5000");
  await waitForPrompt("Click its price.");
  await clickWord("$300.25");
  await waitForPrompt("Click its value.");
  await clickWord("$3,152.63");
  await waitForPrompt("Click the total value of all holdings.");
  await clickWord("$4,153.03");
  await shot("teaching-holdings");
  await (await browser.$("[data-teach-submit]")).click();
  await waitUntilOrDiagnose(browser, async () => !(await (await browser.$("[data-statement-teach]")).isExisting()), {
    timeout: 20000,
    timeoutMsg: "the teaching screen should close once the examples were checked",
  });
  await waitForReview(browser);

  // --- compare share counts ----------------------------------------------------------------------------------------------
  let qqqz = "";
  await waitUntilOrDiagnose(browser, async () => (qqqz = await holdingStatus("QQQZ")) === "different", {
    timeoutMsg: "QQQZ is 10 in the app and 10.5 on the statement, so it should read as different",
    extra: () => qqqz,
  });
  if ((await holdingStatus("VTIZ")) !== "missing_in_app") throw new Error("VTIZ is on the statement but not in the app, so it should read as missing");
  const update = await browser.$('[data-holding="QQQZ"] [data-update-holding]');
  if ((await update.getAttribute("aria-pressed")) !== "true") throw new Error("updating the share count should be the default for a holding that differs");
  if (!(await update.getText()).includes("10.5")) throw new Error(`the button should name the new share count: ${await update.getText()}`);
  await (await browser.$('[data-holding="VTIZ"] [data-add-holding]')).click();
  await (await browser.$('[data-holding="VTIZ"] [data-cost-basis]')).setValue("1000.00");
  // The deposit is already in the app; the purchase and the dividend start as Add.
  const choices = [];
  for (const row of await browser.$$("[data-statement-row]")) choices.push(await row.getAttribute("data-choice"));
  if (choices.join(",") !== "match,add,add") throw new Error(`the deposit should match and the other two lines should start as Add, got ${choices.join(",")}`);
  await shot("holdings-review");
  await finishReview(browser);
  await waitForNotice(browser, "Reconciled Harborview Brokerage");

  // --- the Investments tab shows the result -------------------------------------------------------------------------------
  await goTo(browser, "Investments");
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const text = await pageText();
      return text.includes("QQQZ") && text.includes("VTIZ") && text.includes("10.5");
    },
    { timeoutMsg: "Investments should show QQQZ with 10.5 shares and the new VTIZ holding", extra: async () => (await pageText()).slice(0, 600) },
  );

  // --- month B: recognised, holdings read without any teaching --------------------------------------------------------
  await openAccountPage(browser, "Harborview Brokerage");
  await setStatementDates(browser, bStart, bEnd);
  await uploadStatement(browser, fileB);
  await waitForReview(browser);
  const heading = await (await browser.$("[data-statement-review] .statement-heading")).getText();
  if (!heading.includes("Read using:")) throw new Error(`the taught brokerage should be recognized next time, but the heading reads: ${heading}`);
  if (await (await browser.$("[data-teach-holdings]")).isExisting()) throw new Error("a remembered brokerage must not ask for help with its holdings again");
  for (const symbol of ["QQQZ", "VTIZ"]) {
    let status = "";
    await waitUntilOrDiagnose(browser, async () => (status = await holdingStatus(symbol)) === "same", {
      timeoutMsg: `${symbol} now matches the app, so it should read as the same`,
      extra: () => status,
    });
  }
  await finishReview(browser);
  await waitForNotice(browser, "Reconciled Harborview Brokerage");

  console.log("FEATURE 302 E2E TEST PASSED");
} finally {
  await app.close();
}
