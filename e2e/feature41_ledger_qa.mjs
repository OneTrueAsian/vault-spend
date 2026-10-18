// E2E test for the Dashboard's "Ask the Vault" box: template-matched
// natural-language questions answered entirely from local data (no hosted
// LLM call — see src/ledgerQa.ts). The bulk of the engine's logic (period
// parsing, fuzzy matching, every intent) has its own fast unit tests in
// src/ledgerQa.test.ts — this spec exists to confirm the real UI actually
// wires the box up to it correctly (props threaded through from App.tsx,
// including buckets/recurring which the unit tests supply directly but a
// wiring mistake here wouldn't catch), not to re-verify the logic itself.
//
// Run with: node e2e/feature41_ledger_qa.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth, monthFromNow } from "./lib/dates.mjs";

// The dining-out spend is three months back; questions name its month and year ("July 2026") so the answer
// never depends on which year a bare month name resolves to.
const DINING_MONTH = new Date(`${monthFromNow(-3)}-15T12:00:00`).toLocaleString("en-US", { month: "long", year: "numeric" });

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '3000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Dining Out')")
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, '${dateInMonth(-3, 5)}', 'Sushi Place', -60.00, 'Dining Out', 'fp1')",
    (checking_id,),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, '${dateInMonth(-3, 12)}', 'Pizza Night', -35.00, 'Dining Out', 'fp2')",
    (checking_id,),
)
cur.execute("INSERT INTO buckets (name, target_amount, color) VALUES ('Vacation Fund', '2000.00', '#8A5FB0')")
vacation_id = cur.lastrowid
cur.execute("INSERT INTO bucket_contributions (bucket_id, date, amount) VALUES (?, '${dateInMonth(-2, 1)}', '500.00')", (vacation_id,))
# Keep the runway's trailing 90-day window populated independently of the
# historical Dining Out query. Three-month-old rows can legitimately age out.
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, '${dateInMonth(-1, 5)}', 'Recent runway fixture', '-30.00', 'Groceries', 'fp_recent')", (checking_id,))
# Recording evidence spans all three baseline months; zero rows never add spending.
for marker_date in ['${dateInMonth(-4, 1)}', '${dateInMonth(-2, 1)}', '${dateInMonth(0, 1)}']:
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, 'Recording boundary', '0.00', 'Groceries', ?)", (checking_id, marker_date, 'coverage_' + marker_date))
`);

async function ask(app, question, averageChoice) {
  const input = await app.browser.$(".ledger-qa-card input");
  // `.setValue()` clears the field with a WebDriver call that doesn't reliably
  // reach a controlled React input in this WebView (the second question then
  // got typed onto the end of the first). Select-all + Backspace does — the
  // same workaround feature26 uses.
  await input.click();
  await app.browser.keys(["Control", "a"]);
  await app.browser.keys("Backspace");
  await input.addValue(question);
  const qaCard = await app.browser.$(".ledger-qa-card");
  const askButton = await qaCard.$("button=Ask");
  await askButton.click();
  if (averageChoice) {
    // M2 deliberately clarifies a bare "average" instead of guessing the denominator.
    const clarify = await app.browser.$(".ledger-qa-clarify");
    await clarify.waitForExist({ timeout: 5000 });
    if (!(await clarify.getText()).includes('The word "average"')) throw new Error("expected the average-basis clarification");
    if (await app.browser.$(".ledger-qa-answer").isExisting()) throw new Error("an ambiguous average must not show a financial answer");
    await (await clarify.$(`button=${averageChoice}`)).click();
  }
  const answer = await app.browser.$(".ledger-qa-answer");
  await answer.waitForExist({ timeout: 5000 });
  return answer.getText();
}

const app = await launchApp({ dbDir });
try {
  const spendAnswer = await ask(app, `how much did I spend on dining out in ${DINING_MONTH}`);
  console.log("spend question:", spendAnswer);
  if (!spendAnswer.includes("$95.00") || !spendAnswer.includes("Dining Out")) {
    throw new Error(`expected the answer to mention Dining Out and $95.00 (60+35), got "${spendAnswer}"`);
  }

  // New in the primitive-query-engine pass — confirms `resolveSpendQuery`/
  // `runQuery` are wired through the real UI, not just unit-tested.
  const avgAnswer = await ask(app, `what's my average spend on dining out in ${DINING_MONTH}`, "Per purchase");
  console.log("average spend question:", avgAnswer);
  if (!avgAnswer.includes("$47.50") || !avgAnswer.includes("Dining Out")) {
    throw new Error(`expected the average to mention Dining Out and $47.50 ((60+35)/2), got "${avgAnswer}"`);
  }

  const runwayAnswer = await ask(app, "what's my runway if rent goes up by $200");
  console.log("runway question:", runwayAnswer);
  if (!runwayAnswer.includes("runway is") || !runwayAnswer.includes("drop to")) {
    throw new Error(`expected a before/after runway comparison, got "${runwayAnswer}"`);
  }

  // Bucket-progress needs `buckets` threaded into the QaContext from
  // App.tsx — the one prop this wiring check exists to catch a regression in.
  const bucketAnswer = await ask(app, "how much have I saved toward vacation");
  console.log("bucket question:", bucketAnswer);
  if (!bucketAnswer.includes("Vacation Fund") || !bucketAnswer.includes("$500.00")) {
    throw new Error(`expected the bucket answer to mention Vacation Fund and $500.00, got "${bucketAnswer}"`);
  }

  // Spending questions are read exactly from the profile's data by the native side (not by the older matcher).
  // A store, several stores, and a store left out.
  const storeAnswer = await ask(app, `how much did I spend at sushi place in ${DINING_MONTH}`);
  console.log("store question:", storeAnswer);
  if (!storeAnswer.includes("$60.00") || !storeAnswer.includes("Sushi Place")) {
    throw new Error(`expected the store answer to say $60.00 at Sushi Place, got "${storeAnswer}"`);
  }
  const manyAnswer = await ask(app, `how much did I spend at sushi place and pizza night in ${DINING_MONTH}`);
  console.log("several stores question:", manyAnswer);
  if (!manyAnswer.includes("$95.00") || !manyAnswer.includes("Sushi Place") || !manyAnswer.includes("Pizza Night") || !manyAnswer.includes("$35.00")) {
    throw new Error(`expected $95.00 with a line for each store, got "${manyAnswer}"`);
  }
  const leftOutAnswer = await ask(app, `dining out in ${DINING_MONTH} without pizza night`);
  console.log("left out question:", leftOutAnswer);
  if (!leftOutAnswer.includes("$60.00") || !leftOutAnswer.includes("excluding Pizza Night")) {
    throw new Error(`expected $60.00 excluding Pizza Night, got "${leftOutAnswer}"`);
  }

  // The purchases behind a total open in a dialog and close again.
  await ask(app, `how much did I spend on dining out in ${DINING_MONTH}`);
  await (await app.browser.$("button=View 2 purchases")).click();
  const dialog = await app.browser.$("[role='dialog']");
  await dialog.waitForExist({ timeout: 5000 });
  let dialogText = "";
  await app.browser.waitUntil(async () => ((dialogText = await dialog.getText()), dialogText.includes("Sushi Place") && dialogText.includes("Pizza Night")), {
    timeout: 8000,
    timeoutMsg: "the dialog should list both purchases",
  });
  if (!dialogText.includes("$60.00") || !dialogText.includes("$35.00")) throw new Error(`expected both amounts in the dialog, got "${dialogText}"`);
  await (await dialog.$("button=Close")).click();
  await app.browser.waitUntil(async () => !(await (await app.browser.$("[role='dialog']")).isExisting()), { timeout: 5000, timeoutMsg: "the dialog should close" });

  // The same purchases can be opened in the Transactions tab, filtered by the category and dates of the answer.
  await (await app.browser.$("button=View 2 purchases")).click();
  const openDialog = await app.browser.$("[role='dialog']");
  await openDialog.waitForExist({ timeout: 5000 });
  await (await openDialog.$("button=Open in Transactions")).click();
  let ledgerText = "";
  await app.browser.waitUntil(async () => ((ledgerText = await (await app.browser.$(".main")).getText()), ledgerText.includes("Sushi Place") && ledgerText.includes("Pizza Night")), {
    timeout: 8000,
    timeoutMsg: "Open in Transactions should show the two purchases in the Transactions tab",
  });
  if (!ledgerText.includes("Transactions") || ledgerText.includes("Recent runway fixture")) {
    throw new Error(`expected only the two Dining Out purchases in Transactions, got "${ledgerText}"`);
  }
  await (await app.browser.$(".nav-item[data-tab=dashboard]")).click();
  await (await app.browser.$(".ledger-qa-card input")).waitForExist({ timeout: 5000 });

  // A question with no period asks which one, and a click answers it.
  const periodInput = await app.browser.$(".ledger-qa-card input");
  await periodInput.click();
  await app.browser.keys(["Control", "a"]);
  await app.browser.keys("Backspace");
  await periodInput.addValue("how much did I spend on dining out");
  await (await (await app.browser.$(".ledger-qa-card")).$("button=Ask")).click();
  const clarify = await app.browser.$(".ledger-qa-clarify");
  await clarify.waitForExist({ timeout: 5000 });
  if (!(await clarify.getText()).includes("Which time period")) throw new Error("expected a question about the time period");
  await (await app.browser.$("button=This year so far")).click();
  await app.browser.waitUntil(async () => (await app.browser.$(".ledger-qa-answer")).isExisting(), { timeout: 5000, timeoutMsg: "choosing a period should answer" });
  const afterChoice = await (await app.browser.$(".ledger-qa-answer")).getText();
  if (!afterChoice.includes("Dining Out")) throw new Error(`expected an answer about Dining Out after choosing a period, got "${afterChoice}"`);

  const unmatchedAnswer = await ask(app, "who let the dogs out");
  console.log("unmatched question:", unmatchedAnswer);
  if (!unmatchedAnswer.includes("I don't understand") || !unmatchedAnswer.includes("Try something like")) {
    throw new Error(`expected the graceful fallback for an unmatched question, got "${unmatchedAnswer}"`);
  }
  const unmatchedClass = await (await app.browser.$(".ledger-qa-answer")).getAttribute("class");
  if (!unmatchedClass.includes("ledger-qa-answer-unmatched")) {
    throw new Error(`expected the unmatched answer to carry the unmatched styling class, got "${unmatchedClass}"`);
  }

  // M3: the real native monthly baseline is reviewed before a read-only one-time result.
  const scenarioInput = await app.browser.$(".ledger-qa-card input");
  await scenarioInput.click();
  await app.browser.keys(["Control", "a"]);
  await app.browser.keys("Backspace");
  await scenarioInput.addValue(`Cut Dining Out by $5 once on ${dateInMonth(1, 15)}`);
  await (await (await app.browser.$(".ledger-qa-card")).$("button=Ask")).click();
  await app.browser.waitUntil(async () => (await app.browser.$("[role='dialog']").getText()).includes("Check these details"), { timeout: 8000 });
  if (await app.browser.$(".scenario-total").isExisting()) throw new Error("no scenario result before confirmation");
  const review = await app.browser.$("[role='dialog']");
  const reviewText = await review.getText();
  if (!reviewText.includes("$95.00")) throw new Error(`native baseline must include the historical $95: ${reviewText}`);
  // Short-history fixtures still require an explicit choice if native coverage excludes a month.
  if (reviewText.includes("Which would you like to use?")) {
    await (await review.$("input[type='radio']")).click();
  }
  await (await review.$("button=Show what I would save")).click();
  await app.browser.$(".scenario-total").waitForExist({ timeout: 8000 });
  if (await app.browser.$(".scenario-total").getText() !== "$5.00") throw new Error("one-time saving must be exactly $5");
  await app.browser.keys("Escape");
  await app.browser.waitUntil(async () => !(await app.browser.$("[role='dialog']").isExisting()), { timeout: 5000 });
  // M4 actual Dashboard route: no injected component, native three-month baseline, explicit confirmation.
  const cutInput = await app.browser.$(".ledger-qa-card input");
  await cutInput.click(); await app.browser.keys(["Control", "a"]); await app.browser.keys("Backspace");
  await cutInput.addValue(`Save $5 monthly across Dining Out with Dining Out floor $0 and maximum cut 100% from ${dateInMonth(1, 1)} through ${dateInMonth(2, 28)}`);
  await (await app.browser.$(".ledger-qa-card")).$("button=Ask").click();
  await app.browser.waitUntil(async () => (await app.browser.$("[role='dialog']").getText()).includes("Where would you like to cut back?"), { timeout: 5000 });
  // The final month may be partial: deliberately choose inclusive daily proration if prompted.
  const partChoice = await app.browser.$('label*=Count the part month by the day');
  if (await partChoice.isExisting()) await (await partChoice.$('input')).click();
  await app.browser.$('button=Review the details').click();
  await app.browser.waitUntil(async () => (await app.browser.$("[role='dialog']").getText()).includes("Check every detail"), { timeout: 8000 });
  if (await app.browser.$('.cut-preview-results').isExisting()) throw new Error('M4 cannot calculate before final consent');
  if (!(await app.browser.$("[role='dialog']").getText()).includes('$95.00')) throw new Error('M4 must review the native95.00 evidence');
  const shortChoice = await app.browser.$('label*=Use 2 recorded months for Dining Out');
  if (await shortChoice.isExisting()) await (await shortChoice.$('input')).click();
  await app.browser.$('button=Show the preview').click();
  await app.browser.$('.cut-preview-results').waitForExist({ timeout: 8000 });
  const resultText = await app.browser.$("[role='dialog']").getText();
  if (!resultText.includes('Goal: $5.00 per month') || !resultText.includes('Shortfall: $0.00 per month') || !resultText.includes('Nothing in your data was changed')) throw new Error(resultText);
  await app.browser.$('button=Change the details').click();
  if (await app.browser.$('.cut-preview-results').isExisting()) throw new Error('Editing must retire the previous allocation');
  await app.browser.keys('Escape');
  await app.browser.waitUntil(async () => !(await app.browser.$("[role='dialog']").isExisting()), { timeout: 5000 });
  // Natural cap wording must keep its40% while requiring a separately chosen floor and final consent.
  await cutInput.setValue(`Save $5 a month from Dining Out, I can cut up to 40% from ${dateInMonth(1, 1)} through ${dateInMonth(2, 28)}`);
  await (await app.browser.$(".ledger-qa-card")).$("button=Ask").click();
  await app.browser.$('input[aria-label="Dining Out monthly floor"]').waitForExist({ timeout: 5000 });
  if (await app.browser.$('input[aria-label="Dining Out monthly floor"]').getValue() !== '') throw new Error('A missing floor must not become zero');
  if (await app.browser.$('input[aria-label="Dining Out maximum cut"]').getValue() !== '40') throw new Error('Natural cap must retain40%');
  await app.browser.$('input[aria-label="Dining Out monthly floor"]').setValue('0');
  if (await partChoice.isExisting()) await (await partChoice.$('input')).click();
  await app.browser.$('button=Review the details').click();
  await app.browser.waitUntil(async () => (await app.browser.$("[role='dialog']").getText()).includes("Check every detail"), { timeout: 8000 });
  if (await shortChoice.isExisting()) await (await shortChoice.$('input')).click();
  if (await app.browser.$('.cut-preview-results').isExisting()) throw new Error('Natural wording is not calculation consent');
  await app.browser.$('button=Show the preview').click();
  await app.browser.$('.cut-preview-results').waitForExist({ timeout: 8000 });
  if (!(await app.browser.$("[role='dialog']").getText()).includes('Goal: $5.00 per month')) throw new Error('Natural question must reach the exact result');
  console.log("FEATURE 41 E2E TEST PASSED");
} finally {
  await app.close();
}
