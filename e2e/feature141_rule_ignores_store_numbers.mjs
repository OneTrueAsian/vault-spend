// A rule learned from one store number covers the merchant's other stores, and the rules manager's
// match count says so. Fixing a category on "SPEEDWAY 44289" teaches a rule; "Categorize uncategorized"
// then files "SPEEDWAY 51230" (a different store) under it, and Settings -> Categorization rules counts
// both rows for that rule.
//
// Run with: node e2e/run-all.mjs --spec=141

import assert from "node:assert/strict";
import { launchApp, pickFromMenu, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '3000.00')")
a = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Gas')")
cur.execute(f"""INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES
  ({a}, '${dateInMonth(-1, 1)}', 'SPEEDWAY 44289', -40.00, NULL, NULL, 'sw-1'),
  ({a}, '${dateInMonth(-1, 2)}', 'SPEEDWAY 51230', -35.00, NULL, NULL, 'sw-2')""")
`);

const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  await browser.setWindowSize(1400, 900); // wide enough that the Category column is shown, not tucked into Details
  await (await browser.$("button*=Transactions")).click();
  const row = (text) => browser.$(`//table[contains(@class,'ledger')]//tr[contains(.,'${text}')]`);

  // Teach the rule the way a person does: fix the first store's category.
  const first = await row("SPEEDWAY 44289");
  await first.waitForExist({ timeout: 10000 });
  // The row's category editor is a RowFieldDropdown, whose menu is portaled to the page body.
  await pickFromMenu(browser, async () => first.$('[aria-label^="Category for"]'), "//button[@role='menuitemradio'][.//span[normalize-space()='Gas']]");
  await waitUntilOrDiagnose(browser, async () => (await (await row("SPEEDWAY 44289")).getText()).includes("Gas"), {
    timeout: 10000,
    timeoutMsg: "fixing the first store's category should save",
  });

  await (await browser.$(".more-menu > button")).click();
  await (await browser.$("button=Categorize uncategorized")).click();
  await waitUntilOrDiagnose(browser, async () => (await (await row("SPEEDWAY 51230")).getText()).includes("Gas"), {
    timeout: 10000,
    timeoutMsg: "the rule learned from store 44289 should categorize store 51230",
  });

  await (await browser.$("button*=Settings")).click();
  const rulesRow = await browser.$("//tr[td[normalize-space()='SPEEDWAY 44289']]");
  await rulesRow.waitForExist({ timeout: 10000, timeoutMsg: "the learned rule should be listed" });
  assert.match(await rulesRow.getText(), /\b2\b/, `the rule should count both stores, row reads: ${await rulesRow.getText()}`);
  console.log("  ok: a rule learned from one store number covers another, and its count says so");
} finally {
  await app.close();
}
