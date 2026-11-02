// UAT-035 (choose the account section of a multi-account statement), UAT-041 (a card statement whose signs are reversed offers "Flip them"),
// UAT-040 (a loan payment takes its principal part from the statement). docs/STATEMENT-RECONCILE.md "Matching", "The shared balance rule".
// Fictional statements: the credit-union and mortgage shapes the built-in layouts read (core/src/statement/fixture_pdf.rs), built with e2e/lib/statementPdf.mjs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { buildPdf, checkingStatement } from "./lib/statementPdf.mjs";
import { differenceState, finishReview, openAccountPage, setStatementDates, uploadStatement, waitForBalanced, waitForNotice, waitForReview, writeStatement } from "./lib/statementUi.mjs";

const cardStart = dateInMonth(-2, 1), cardEnd = dateInMonth(-2, 28);
const day = d => dateInMonth(-2, d);
const mon = d => new Date(day(d) + "T00:00:00").toLocaleDateString("en-US", { month: "short" });
const md = d => `${mon(d)} ${String(d).padStart(2, "0")}`; // "Aug 06", the credit-union shape
const mdy = d => day(d).slice(5, 7) + "/" + day(d).slice(8, 10) + "/" + day(d).slice(0, 4);
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('QA Member Checking', 'checking', '155.05')")
a = cur.lastrowid
for d, desc, amt in (("${day(6)}", "Corner Cafe", "-10.84"), ("${day(7)}", "Payroll", "65.00"), ("${day(13)}", "Music Service", "-0.99"), ("${day(21)}", "Payroll", "65.00"), ("${day(24)}", "Wing Place", "-29.98")):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)", (a, d, desc, amt, None, None, f"{a}|{d}|{desc.lower()}|{amt}"))
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('QA Card', 'credit', '0.00')")
c = cur.lastrowid
for d, desc, amt in (("${day(6)}", "Grocer", "30.00"), ("${day(12)}", "Gas Stop", "45.00"), ("${day(18)}", "Cafe", "12.00")):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)", (c, d, desc, amt, None, None, f"{c}|{d}|{desc.lower()}|{amt}"))
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('QA Home Loan', 'loan', '0.00')")
l = cur.lastrowid
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)", (l, "${day(10)}", "Payment", "2405.94", None, None, f"{l}|${day(10)}|payment|2405.94"))
`);
// A statement for two accounts (the credit-union shape): the savings part has no rows, the checking part has five.
const credit = buildPdf([[
  `Statement Period ${mdy(1)} - ${mdy(28)}`,
  "MEMBER SAVINGS Share Account ID 00",
  `${md(1)} Beginning Balance $6.44`,
  `${md(28)} Ending Balance $6.44`,
  "EVERYDAY CHECKING Share Account ID 01",
  "Total Deposits $130.00",
  "Total Withdrawals $41.81",
  "Trans Eff Date Transaction Withdrawal Deposit Balance",
  `${md(1)} Beginning Balance $155.05`,
  `${md(6)} ${md(6)} Withdrawal Debit Card Debit Card`,
  "2400000000000001 CORNER CAFE",
  `MI ${mdy(6)}`,
  "($10.84) $144.21",
  `${md(7)} ${md(7)} Deposit ACH EXAMPLE EMPLOYER TYPE: PAYROLL`,
  "$65.00 $209.21",
  `${md(13)} ${md(13)} Withdrawal Bill Payment MUSIC SERVICE`,
  "($0.99) $208.22",
  `${md(21)} ${md(21)} Deposit ACH EXAMPLE EMPLOYER TYPE: PAYROLL`,
  "$65.00 $273.22",
  `${md(24)} ${md(24)} Withdrawal Debit Card Debit Card`,
  "2400000000000002 WING PLACE",
  "($29.98) $243.24",
  `${md(28)} Ending Balance $243.24`,
]]);
// A card statement as cards print it (charges positive, balance owed rising from 0 to 87.00). The card's transactions in the app were entered with the opposite sign
// (charges positive; the app's own sign for a charge is negative), so every line looks reversed against the app.
const reversed = checkingStatement({ start: cardStart, end: cardEnd, opening: 0, rows: [{ date: day(6), description: "Grocer", amount: 30 }, { date: day(12), description: "Gas Stop", amount: 45 }, { date: day(18), description: "Cafe", amount: 12 }] });
// A home loan in the credit-union shape (the built-in layout that reads a "Loan Account ID" section with a principal column): the payment's total is
// first, its principal part second, then interest, escrow and the running principal.
const mortgage = buildPdf([[
  `Statement Period ${mdy(1)} - ${mdy(28)}`,
  "HOME LOAN Loan Account ID 05",
  `${md(1)} Beginning Balance $317,195.46`,
  `${md(10)} ${md(10)} Payment ($2,405.94) ($355.17) $1,453.81 $596.96 $316,840.29`,
  `${md(28)} Ending Balance $316,840.29`,
]]);
const files = { credit: writeStatement("two-accounts.pdf", credit), card: writeStatement("reversed-card.pdf", reversed.pdf), loan: writeStatement("mortgage.pdf", mortgage) };
const app = await launchApp({ dbDir });
const { browser } = app;
// The Accounts tab keeps showing the open account; its back link returns to the list.
const backToList = async () => { await (await browser.$("//button[normalize-space()='← All accounts']")).click(); };
const text = sel => browser.$(sel).then(e => e.getText());
// Every review row in order (two lines can share a description).
const rowChoices = () => browser.execute(() => [...document.querySelectorAll("tr[data-statement-row]")].map(tr => ({ line: tr.children[1].childNodes[0].textContent.trim(), choice: tr.getAttribute("data-choice"), note: tr.querySelector("[data-pays-down]")?.textContent.trim() ?? null })));
try {
  await browser.setWindowSize(1440, 1400);

  // --- UAT-035: choose the part of a multi-account statement that belongs to this account ---------------------------------
  await openAccountPage(browser, "QA Member Checking");
  await setStatementDates(browser, day(1), day(28));
  await uploadStatement(browser, files.credit);
  const chooser = await browser.$("[data-statement-section]");
  await chooser.waitForExist({ timeout: 20000, timeoutMsg: "a statement for several accounts asks which part is this account's" });
  const options = await browser.execute(() => [...document.querySelectorAll("[data-statement-section]")].map(b => b.textContent.trim().replace(/\s+/g, " ")));
  assert.equal(options.length, 2, JSON.stringify(options));
  assert.ok(options[0].includes("MEMBER SAVINGS") && options[0].includes("0 transactions"), options[0]);
  assert.ok(options[1].includes("EVERYDAY CHECKING") && options[1].includes("5 transactions"), options[1]);
  await (await browser.$('[data-statement-section="1"]')).click();
  await waitForReview(browser);
  const review = await browser.execute(() => document.querySelector("[data-statement-review]").textContent);
  assert.ok(review.includes("EVERYDAY CHECKING"), "the review is for the chosen part: " + review.slice(0, 200));
  assert.ok(!review.includes("MEMBER SAVINGS"), "the savings part is not mixed in");
  const parts = await rowChoices();
  assert.equal(parts.length, 5, JSON.stringify(parts));
  assert.ok(parts.every(p => p.choice === "match"), "all five lines are in the app and start matched: " + JSON.stringify(parts));
  await waitForBalanced(browser);
  await finishReview(browser);
  await waitForNotice(browser, "Reconciled QA Member Checking");

  await backToList();

  // --- UAT-041: reversed signs on a card statement -------------------------------------------------------------------------------
  await openAccountPage(browser, "QA Card");
  await setStatementDates(browser, cardStart, cardEnd);
  await uploadStatement(browser, files.card);
  await waitForReview(browser);
  const flip = await browser.$("[data-flip]");
  await flip.waitForExist({ timeout: 10000, timeoutMsg: "reversed signs offer Flip them" });
  assert.ok((await text("[data-suggest-flip]")).includes("look reversed"), await text("[data-suggest-flip]"));
  const before = await rowChoices();
  assert.equal(before.length, 3);
  assert.ok(before.every(p => p.choice !== "match"), "before flipping nothing matches: " + JSON.stringify(before));
  await flip.click();
  await browser.$("[data-flipped]").waitForExist({ timeout: 10000, timeoutMsg: "the screen says the amounts are flipped" });
  await waitUntilOrDiagnose(browser, async () => (await rowChoices()).every(p => p.choice === "match"), { timeout: 10000, timeoutMsg: "after flipping all three lines match", extra: () => rowChoices() });
  await (await browser.$("[data-unflip]")).click();
  await waitUntilOrDiagnose(browser, async () => (await browser.$$("[data-suggest-flip]")).length === 1, { timeout: 10000, timeoutMsg: "Undo brings the suggestion back" });
  // Flipping only re-signs the lines so they can pair; the card's own transactions here carry the wrong sign, so the balances still disagree and Finish stays unavailable.
  await (await browser.$("[data-flip]")).click();
  await waitUntilOrDiagnose(browser, async () => (await rowChoices()).every(p => p.choice === "match"), { timeout: 10000, timeoutMsg: "flipping again matches all three lines", extra: () => rowChoices() });
  assert.equal((await differenceState(browser)).balanced, false, "wrong-signed card transactions do not balance after a flip: " + JSON.stringify(await differenceState(browser)));
  assert.notEqual(await (await browser.$("[data-statement-finish]")).getAttribute("disabled"), null, "Finish stays unavailable while the difference is not $0.00");
  await browser.keys("Escape");
  await waitUntilOrDiagnose(browser, async () => !(await (await browser.$("[data-statement-review]")).isExisting()), { timeout: 10000, timeoutMsg: "the review closes without finishing" });

  await backToList();

  // --- UAT-040: a loan payment's principal part ---------------------------------------------------------------------------------
  await openAccountPage(browser, "QA Home Loan");
  await setStatementDates(browser, day(1), day(28));
  await uploadStatement(browser, files.loan);
  await waitForReview(browser);
  // The app holds a loan payment as a positive amount; this layout prints money out in brackets, so the reading looks reversed and offers Flip them.
  await browser.$("[data-flip]").waitForExist({ timeout: 10000, timeoutMsg: "the loan statement offers Flip them" });
  assert.notEqual((await rowChoices())[0].choice, "match", "before flipping the payment does not match");
  await (await browser.$("[data-flip]")).click();
  await waitUntilOrDiagnose(browser, async () => (await rowChoices())[0]?.choice === "match", { timeout: 10000, timeoutMsg: "after flipping the payment matches", extra: () => rowChoices() });
  const loan = await rowChoices();
  const payment = loan.find(p => p.line === "Payment");
  assert.equal(payment?.choice, "match", JSON.stringify(loan));
  assert.equal(payment.note, "$355.17 of this is the part that pays down what you owe.", "the payment shows its principal part, not the whole 2,405.94: " + JSON.stringify(loan));
  // Only the principal part counts toward the loan: 317,195.46 - 355.17 = 316,840.29, not 317,195.46 - 2,405.94. The difference reaches $0.00 and the review finishes.
  await waitForBalanced(browser);
  await finishReview(browser);
  await waitForNotice(browser, "Reconciled QA Home Loan");
  console.log("FEATURE 341 PASSED: section choice, reversed-sign Flip them and a loan payment's principal part work through the real upload.");
} finally { await app.close(); }
// The payment's principal part is stored on the transaction and the loan's reconciliation is recorded (read back from the disposable profile).
const stored = JSON.parse(execFileSync("python", ["-c", `import sqlite3,json;c=sqlite3.connect(r"${path.join(dbDir, "vaultspend.db")}");print(json.dumps(c.execute("select amount, principal_amount, reconciliation_id is not null from transactions where description='Payment' and account_id=(select id from accounts where name='QA Home Loan')").fetchall()))`]).toString());
assert.deepEqual(stored.map(([amount, principal, settled]) => [Number(amount), Math.abs(Number(principal)), settled]), [[2405.94, 355.17, 1]], "the stored payment keeps its principal part and is settled by the reconciliation: " + JSON.stringify(stored));
console.log("FEATURE 341 stored principal read back: " + JSON.stringify(stored));
