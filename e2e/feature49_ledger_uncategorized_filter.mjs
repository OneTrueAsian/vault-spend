// E2E test for the Ledger's "Needs a category" stat and its category
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

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Dining Out')")
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, '2026-09-05', 'Pizza Night', -33.09, 'Dining Out', 'user', 'fp1')",
    (checking_id,),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, '2026-09-06', 'Speedway 47096', -35.39, NULL, NULL, 'fp2')",
    (checking_id,),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, '2026-09-01', 'Mortgage Import', -1200.00, 'Mortgage', NULL, 'fp3')",
    (checking_id,),
)
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  const uncategorizedStat = await app.browser.$("//button[contains(@class,'stat')][.//span[text()='Needs a category']]");
  await uncategorizedStat.waitForExist({ timeout: 10000 });
  const statValue = await (await uncategorizedStat.$(".stat-value")).getText();
  if (statValue !== "1") {
    throw new Error(`expected the "Needs a category" stat to read 1 (Mortgage Import has a real category and must not inflate it), got "${statValue}"`);
  }
  console.log('"Needs a category" correctly ignores a category-present/source-null row');

  const categorySelect = await app.browser.$(".ledger-filters select");
  const ledgerPage = await app.browser.$(".page");

  // Selecting "Uncategorized" from the dropdown should show only Speedway
  // 47096 (the NULL-category row) — not Pizza Night, and not Mortgage
  // Import (it has a real category, just no recorded source).
  await categorySelect.selectByVisibleText("Uncategorized");
  await app.browser.waitUntil(
    async () => {
      const text = await ledgerPage.getText();
      return text.includes("Speedway 47096") && !text.includes("Pizza Night") && !text.includes("Mortgage Import");
    },
    { timeout: 5000, timeoutMsg: 'expected the "Uncategorized" filter to show only the genuinely uncategorized transaction' },
  );
  console.log('dropdown "Uncategorized" option correctly isolates the one uncategorized transaction');

  // Back to "All categories" — all three rows should reappear.
  await categorySelect.selectByVisibleText("All categories");
  await app.browser.waitUntil(
    async () => {
      const text = await ledgerPage.getText();
      return text.includes("Speedway 47096") && text.includes("Pizza Night") && text.includes("Mortgage Import");
    },
    { timeout: 5000, timeoutMsg: "expected clearing the category filter to show all three transactions again" },
  );

  // Clicking the stat itself should apply the same filter as a shortcut.
  await uncategorizedStat.click();
  await app.browser.waitUntil(async () => (await categorySelect.getValue()) === "__uncategorized__", {
    timeout: 5000,
    timeoutMsg: 'expected clicking the "Needs a category" stat to set the category filter to Uncategorized',
  });
  await app.browser.waitUntil(
    async () => {
      const text = await ledgerPage.getText();
      return text.includes("Speedway 47096") && !text.includes("Pizza Night");
    },
    { timeout: 5000, timeoutMsg: "expected the stat-driven filter to show only the uncategorized transaction" },
  );
  console.log('clicking the "Needs a category" stat correctly filters the ledger');

  // Clicking it again toggles back to "all".
  await uncategorizedStat.click();
  await app.browser.waitUntil(async () => (await categorySelect.getValue()) === "all", {
    timeout: 5000,
    timeoutMsg: "expected clicking the stat a second time to clear the filter back to all categories",
  });

  console.log("FEATURE 49 E2E TEST PASSED");
} finally {
  await app.close();
}
