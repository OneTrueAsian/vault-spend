// Reports > Comparisons: a zero balance is never compared with people who hold the item, and a typed total
// replaces the tracked one, is flagged when it is out of date, and keeps the tracked total visible.
// (Split from feature145 to keep each spec inside the runner's per-spec time limit.)
//
// Run with: node e2e/feature148_comparisons_totals_and_staleness.mjs
import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { baseSetup, cardText, openReportsTab, person, setupSnippet, waitForCards } from "./lib/comparisons.mjs";

const today = new Date();
const TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

/** A modal's text is empty during its fade-in, so wait for it rather than reading it once. */
async function detailsText(browser, id) {
  const el = await browser.$(`[data-cmp-details='${id}']`);
  await el.waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => (await el.getText()).trim() !== "", { timeout: 10000, timeoutMsg: `${id} details never showed text` });
  return el.getText();
}

let app;
try {
  const setup2 = baseSetup(TODAY, {
    people: [{ person: person(0), age: { age: { kind: "exact", age: 30 }, confirmedOn: TODAY }, inHousehold: true }],
    balanceConfirmations: [{ metric: "debt", confirmedOn: TODAY }],
    manualOverrides: [{ metric: "savings", amount: { value: "25000", measuredOn: "2024-01-01", explanation: "Statement from the credit union" } }], // fixed date: only has to be long ago (stale)
  });
  const dbDir2 = await seedFixture(`
for name, kind, start in [('Checking', 'checking', '100.00'), ('Visa', 'credit', '5000.00')]:
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES (?, ?, ?)", (name, kind, start))
${setupSnippet(setup2)}
`);
  app = await launchApp({ dbDir: dbDir2 });
  const { browser } = app;
  await browser.setWindowSize(1440, 1600);
  await openReportsTab(browser, "comparisons");
  await waitForCards(browser);

  const debt = await browser.$("[data-comparisons-page] [data-metric='debt']");
  await debt.waitForExist({ timeout: 20000 });
  const debtText = await debt.getText();
  assert.ok(debtText.includes("Not comparable / outside benchmark population"), `zero debt is not compared with people who owe: ${debtText}`);
  assert.equal((await debt.$$("[data-cmp-difference]")).length, 0);

  const savings = await browser.$("[data-comparisons-page] [data-metric='savings']");
  await savings.waitForExist({ timeout: 20000 });
  const savingsText = await savings.getText();
  assert.ok(savingsText.includes("$25,000"), `the typed total is used: ${savingsText}`);
  assert.ok(savingsText.includes("Entered by you") && savingsText.includes("may be out of date"), `a stale typed total is flagged but still used: ${savingsText}`);
  await (await savings.$(".cmp-explore")).click();
  const typedDetails = await detailsText(browser, "savings");
  assert.ok(typedDetails.includes("Your accounts in Vault Spend add up to $100"), "the tracked total stays visible beside the typed one");
  // The measuredOn above, written out the way every date reads on screen.
  assert.ok(typedDetails.includes("Entered on Jan 1, 2024: Statement from the credit union"), `the typed total names its date and source: ${typedDetails}`);

  console.log("FEATURE 148 E2E TEST PASSED");
} finally {
  await app?.close();
}
