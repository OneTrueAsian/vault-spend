// UAT-037 / UAT-038: how a statement line pairs with an app transaction (docs/STATEMENT-RECONCILE.md "Matching"): the amount must match exactly; a date within 3 days
// pairs automatically; 4-10 days, or a tie between two different candidates, is only a possible match the person confirms. Driven through the real upload.
// App (checking, 1000.00): Coffee Shop -50 on day 5; Pharmacy -20 on day 10; Bookstore -15 on day 10; Fuel A and Fuel B, both -40 on day 20.
// Statement: Coffee Shop day 5 (same day), Pharmacy day 13 (+3, automatic), Bookstore day 16 (+6, possible), Fuel Stop day 20 (tie between Fuel A and B).
// Edges: Edge Four app day 2 / statement day 6 (4 days: possible), Edge Ten app day 4 / statement day 14 (10 days: possible), Edge Eleven app day 1 / statement day 12 (11 days: no candidate).
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { checkingStatement } from "./lib/statementPdf.mjs";
import { differenceState, finishReview, openAccountPage, setStatementDates, uploadStatement, waitForNotice, waitForReview, writeStatement } from "./lib/statementUi.mjs";

const start = dateInMonth(-2, 1), end = dateInMonth(-2, 28);
const day = d => dateInMonth(-2, d);
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '1000.00')")
acct = cur.lastrowid
for d, desc, amt in (("${day(5)}", "Coffee Shop", "-50.00"), ("${day(10)}", "Pharmacy", "-20.00"), ("${day(10)}", "Bookstore", "-15.00"), ("${day(20)}", "Fuel A", "-40.00"), ("${day(20)}", "Fuel B", "-40.00"), ("${day(2)}", "Edge Four", "-11.00"), ("${day(4)}", "Edge Ten", "-12.00"), ("${day(1)}", "Edge Eleven", "-13.00")):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, amt, None, None, f"{acct}|{d}|{desc.lower()}|{amt}"))
`);
const statement = checkingStatement({ start, end, opening: 1000, rows: [
  { date: day(5), description: "Coffee Shop", amount: -50 },
  { date: day(13), description: "Pharmacy", amount: -20 },
  { date: day(16), description: "Bookstore", amount: -15 },
  { date: day(20), description: "Fuel Stop", amount: -40 },
  { date: day(6), description: "Edge Four", amount: -11 },
  { date: day(14), description: "Edge Ten", amount: -12 },
  { date: day(12), description: "Edge Eleven", amount: -13 },
] });
const file = writeStatement("variants.pdf", statement.pdf);
const app = await launchApp({ dbDir });
const { browser } = app;
// Each row as the review shows it: how it starts (data-choice), the "Same as" candidates offered, and whether it names an automatic match.
const rows = () => browser.execute(() => Object.fromEntries([...document.querySelectorAll("tr[data-statement-row]")].map(tr => [tr.children[1].childNodes[0].textContent.trim(), {
  choice: tr.getAttribute("data-choice"),
  sameAs: [...tr.querySelectorAll("[data-same-as]")].map(b => b.textContent.trim()),
  auto: tr.querySelector("[data-row-choices]").textContent.includes("Matches"),
  autoText: tr.querySelector("[data-row-choices]").textContent.trim(),
}])));
try {
  await browser.setWindowSize(1440, 1400);
  await openAccountPage(browser, "Everyday Checking");
  await setStatementDates(browser, start, end);
  await uploadStatement(browser, file);
  await waitForReview(browser);
  let r = await rows();
  assert.equal(Object.keys(r).length, 7, JSON.stringify(r));
  assert.deepEqual([r["Coffee Shop"].choice, r["Coffee Shop"].auto], ["match", true], "same day, same amount: matched automatically " + JSON.stringify(r["Coffee Shop"]));
  assert.deepEqual([r["Pharmacy"].choice, r["Pharmacy"].auto], ["match", true], "3 days apart is still automatic " + JSON.stringify(r["Pharmacy"]));
  assert.ok(r["Pharmacy"].autoText.includes("Pharmacy"), r["Pharmacy"].autoText);
  assert.notEqual(r["Bookstore"].choice, "match", "6 days apart is only a possible match, not automatic " + JSON.stringify(r["Bookstore"]));
  assert.equal(r["Bookstore"].auto, false);
  assert.equal(r["Bookstore"].sameAs.length, 1, JSON.stringify(r["Bookstore"]));
  assert.ok(r["Bookstore"].sameAs[0].includes("Bookstore"));
  assert.notEqual(r["Fuel Stop"].choice, "match", "a tie between two candidates is never guessed " + JSON.stringify(r["Fuel Stop"]));
  assert.equal(r["Fuel Stop"].sameAs.length, 2, "both tied candidates are offered: " + JSON.stringify(r["Fuel Stop"]));
  assert.ok(r["Fuel Stop"].sameAs.some(t => t.includes("Fuel A")) && r["Fuel Stop"].sameAs.some(t => t.includes("Fuel B")));
  for (const [name, days] of [["Edge Four", 4], ["Edge Ten", 10]]) {
    assert.notEqual(r[name].choice, "match", `${days} days apart is only a possible match ` + JSON.stringify(r[name]));
    assert.equal(r[name].sameAs.length, 1, `${days} days apart is offered as a possible match: ` + JSON.stringify(r[name]));
  }
  assert.equal(r["Edge Eleven"].sameAs.length, 0, "11 days apart is not offered as a match: " + JSON.stringify(r["Edge Eleven"]));
  assert.notEqual(r["Edge Eleven"].choice, "match");
  // Finish waits for the person: two lines are still undecided.
  const finish = await browser.$("[data-statement-finish]");
  assert.equal(await finish.getAttribute("disabled") !== null, true, "Finish is not available while a possible match is undecided: " + JSON.stringify(await differenceState(browser)));
  // Confirm each one.
  await (await browser.$('//tr[@data-statement-row][contains(normalize-space(.), "Bookstore")]//button[@data-same-as]')).click();
  await (await browser.$('//tr[@data-statement-row][contains(normalize-space(.), "Fuel Stop")]//button[@data-same-as][contains(normalize-space(.), "Fuel A")]')).click();
  for (const name of ["Edge Four", "Edge Ten"]) await (await browser.$(`//tr[@data-statement-row][contains(normalize-space(.), "${name}")]//button[@data-same-as]`)).click();
  await waitUntilOrDiagnose(browser, async () => (await differenceState(browser)).balanced, { timeout: 10000, timeoutMsg: "the difference reaches $0.00 once all are confirmed", extra: () => differenceState(browser) });
  r = await rows();
  assert.equal(r["Bookstore"].choice, "match");
  assert.equal(r["Fuel Stop"].choice, "match");
  const notOn = await (await browser.$("[data-not-on-statement]")).getText();
  assert.ok(notOn.includes("Fuel B") && !notOn.includes("Fuel A"), "the unchosen twin is listed as not on the statement: " + notOn);
  await finishReview(browser);
  const done = await waitForNotice(browser, "Reconciled Everyday Checking");
  assert.ok(done.includes("Added"), "the 11-days-apart line had no match and was added: " + done);
  console.log("FEATURE 340 PASSED: statement lines pair automatically within 3 days and stay possible at 6 days and on a tie, and finishing waits for the person.");
} finally { await app.close(); }
