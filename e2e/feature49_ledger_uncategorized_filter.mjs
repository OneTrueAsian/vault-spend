// E2E test for the Ledger's "needs a category" line (once a stat tile) and its category
// filter dropdown: previously the dropdown only listed real, named
// categories plus "All categories" — there was no way to isolate the
// transactions the "Needs a category" stat counts, and the stat itself
// was a plain, non-interactive <div>. Covers both the new "Uncategorized"
// dropdown option and the stat now acting as a toggle shortcut for it.
//
// Also regression-covers a real production mismatch: `get_stats` used to
// count "needs a category" by `category_source IS NULL`, not by whether
// `category` itself was set — so a transaction imported with a category
// already attached (no recorded source) inflated the stat's count while
// never actually showing up under the "Uncategorized" filter, which
// correctly checks `category`. Seeds one such row (real category, null
// source) alongside a genuinely uncategorized one to confirm the stat and
// filter now agree.
//
// Run with: node e2e/feature49_ledger_uncategorized_filter.mjs

import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Dining Out')")
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, '${dateInMonth(-1, 5)}', 'Pizza Night', -33.09, 'Dining Out', 'user', 'fp1')",
    (checking_id,),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, '${dateInMonth(-1, 6)}', 'Speedway 47096', -35.39, NULL, NULL, 'fp2')",
    (checking_id,),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, '${dateInMonth(-1, 1)}', 'Mortgage Import', -1200.00, 'Mortgage', NULL, 'fp3')",
    (checking_id,),
)
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  // The one line above the table that replaced the four count tiles.
  const needsLine = await app.browser.$("[data-needs-category]");
  await needsLine.waitForExist({ timeout: 10000 });
  await waitUntilOrDiagnose(app.browser, async () => (await needsLine.getText()).includes("1 transaction needs a category"), {
    timeoutMsg: "expected the needs-a-category line to count 1 (Mortgage Import has a real category and must not inflate it)",
    extra: async () => ({ line: await needsLine.getText() }),
  });
  const needsButton = await needsLine.$("button");
  console.log('"Needs a category" correctly ignores a category-present/source-null row');

  const categoryTrigger = await app.browser.$(".ledger-filters .category-filter-toggle");
  const ledgerPage = await app.browser.$(".page");

  async function chooseCategoryFilter(label) {
    await categoryTrigger.click();
    const menu = await app.browser.$(".ledger-filters .category-filter-panel");
    await menu.waitForExist({ timeout: 5000 });
    const option = await menu.$(`.//button[.//span[normalize-space()='${label}']]`);
    await option.click();
  }

  // Selecting "Uncategorized" from the menu should show only Speedway
  // 47096 (the NULL-category row) — not Pizza Night, and not Mortgage
  // Import (it has a real category, just no recorded source).
  await chooseCategoryFilter("Uncategorized");
  await app.browser.waitUntil(
    async () => {
      const text = await ledgerPage.getText();
      return text.includes("Speedway 47096") && !text.includes("Pizza Night") && !text.includes("Mortgage Import");
    },
    { timeout: 5000, timeoutMsg: 'expected the "Uncategorized" filter to show only the genuinely uncategorized transaction' },
  );
  console.log('menu "Uncategorized" option correctly isolates the one uncategorized transaction');

  // Back to "All categories" — all three rows should reappear.
  await chooseCategoryFilter("All categories");
  await app.browser.waitUntil(
    async () => {
      const text = await ledgerPage.getText();
      return text.includes("Speedway 47096") && text.includes("Pizza Night") && text.includes("Mortgage Import");
    },
    { timeout: 5000, timeoutMsg: "expected clearing the category filter to show all three transactions again" },
  );

  // Its Review button applies the same filter as a shortcut.
  await needsButton.click();
  await app.browser.waitUntil(async () => (await categoryTrigger.getText()).includes("Uncategorized"), {
    timeout: 5000,
    timeoutMsg: 'expected clicking Review on the needs-a-category line to set the category filter to Uncategorized',
  });
  await app.browser.waitUntil(
    async () => {
      const text = await ledgerPage.getText();
      return text.includes("Speedway 47096") && !text.includes("Pizza Night");
    },
    { timeout: 5000, timeoutMsg: "expected the Review-driven filter to show only the uncategorized transaction" },
  );
  console.log('Review on the needs-a-category line correctly filters the ledger');

  // Show all (the same button) toggles back to "all".
  await waitUntilOrDiagnose(app.browser, async () => (await needsButton.getText()) === "Show all", {
    timeoutMsg: "expected the line's button to read Show all while the filter is on",
  });
  await needsButton.click();
  await app.browser.waitUntil(async () => (await categoryTrigger.getText()).includes("All categories"), {
    timeout: 5000,
    timeoutMsg: "expected Show all to clear the filter back to all categories",
  });

  console.log("FEATURE 49 E2E TEST PASSED");
} finally {
  await app.close();
}
