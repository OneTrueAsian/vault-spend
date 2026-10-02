// A rule whose own history disagrees with it is flagged for review instead of applied silently.
//
// "SAMS CLUB" has a learned rule (Gas) but the person has filed that merchant half under Gas and half
// under Groceries, so re-categorizing a new Sam's Club row gives Gas with a 50% confidence, which the
// review inbox treats as "Unsure". "SPEEDWAY" has only ever been Gas, so its rule is applied with no
// confidence at all. Driven through the real "Categorize uncategorized" menu item.
//
// Run with: node e2e/run-all.mjs --spec=140

import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";

function history(description, category, count, startDay) {
  return Array.from({ length: count }, (_, i) => `({a}, '${dateInMonth(-2, startDay + i)}', '${description}', -20.00, '${category}', 'user', '${description}-${category}-${i}')`).join(",\n  ");
}

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '3000.00')")
a = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Gas')")
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Groceries')")
cur.execute("INSERT INTO rules (pattern, category) VALUES ('sams club', 'Gas')")
cur.execute("INSERT INTO rules (pattern, category) VALUES ('speedway', 'Gas')")
cur.execute(f"""INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES
  ${history("SAMS CLUB #1", "Gas", 4, 1)},
  ${history("SAMS CLUB #1", "Groceries", 4, 10)},
  ${history("SPEEDWAY #1", "Gas", 5, 15)},
  ({a}, '${dateInMonth(-1, 1)}', 'SAMS CLUB #9', -31.00, NULL, NULL, 'new-sams'),
  ({a}, '${dateInMonth(-1, 2)}', 'SPEEDWAY #9', -28.00, NULL, NULL, 'new-speedway')""")
`);

const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  await browser.setWindowSize(1400, 900); // wide enough that the Category column is shown, not tucked into Details
  await (await browser.$("button*=Transactions")).click();
  await (await browser.$(".more-menu > button")).click();
  await (await browser.$("button=Categorize uncategorized")).click();

  const row = (text) => browser.$(`//table[contains(@class,'ledger')]//tr[contains(.,'${text}')]`);
  await waitUntilOrDiagnose(browser, async () => (await (await row("SPEEDWAY #9")).getText()).includes("Gas"), {
    timeout: 10000,
    timeoutMsg: "the Speedway row should be categorized as Gas",
  });

  const sams = await row("SAMS CLUB #9");
  assert.ok((await sams.getText()).includes("Gas"), `the Sam's Club rule still suggests the most recent choice, got: ${await sams.getText()}`);
  const badge = await sams.$(".confidence-badge");
  assert.ok(await badge.isExisting(), "a contested rule's answer must carry a confidence, so it is visibly unsure");
  assert.equal(await badge.getText(), "50%", "4 of the 8 matching transactions were filed under Gas");

  const speedway = await row("SPEEDWAY #9");
  assert.equal(await speedway.$(".confidence-badge").isExisting(), false, "a rule whose history all agrees is applied without a confidence");
  console.log("  ok: a split merchant's rule is flagged, a one-category merchant's is not");
} finally {
  await app.close();
}
