// E2E smoke test for the Ledger's sortable column headers and grouped
// multi-select account filter: seeds transactions across two accounts,
// deliberately out of chronological order, and confirms clicking a column
// header actually re-sorts the rows (not just relying on insertion order),
// then confirms unchecking an account in the filter dropdown hides that
// account's transactions.
//
// Run with: node e2e/feature20_ledger_sort_and_filter.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Credit Card', 'credit', '0.00')")
credit_id = cur.lastrowid
# Inserted deliberately out of date order — the backend returns rows by
# insertion order, so a passing sort test here proves real sorting, not a
# lucky coincidence of insertion order.
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "2026-08-10", "Zebra Store", "-20.00", None, f"{checking_id}|2026-08-10|zebra store|-20.00"),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "2026-08-05", "Apple Store", "-50.00", None, f"{checking_id}|2026-08-05|apple store|-50.00"),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (credit_id, "2026-08-15", "Coffee Shop", "-5.00", None, f"{credit_id}|2026-08-15|coffee shop|-5.00"),
)
zebra_id = cur.lastrowid - 2  # the first-inserted row above (Zebra Store)
cur.execute("INSERT INTO transaction_tags (transaction_id, tag) VALUES (?, ?)", (zebra_id, "urgent"))
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  const dateHeader = await app.browser.$("//th[contains(@class,'sortable-col')][contains(.,'Date')]");
  await dateHeader.waitForExist({ timeout: 10000 });

  // Default sort is by date, descending — the most recent transaction
  // (Coffee Shop, 08-15) should lead.
  const firstDescriptionCell = "(//table[contains(@class,'ledger')])[1]/tbody/tr[1]/td[3]";
  await app.browser.waitUntil(
    async () => (await app.browser.$(firstDescriptionCell).getText()).includes("Coffee Shop"),
    { timeout: 10000, timeoutMsg: "expected Coffee Shop (most recent date) to lead under the default desc-by-date sort" },
  );

  // Click Date once to flip to ascending — the oldest transaction (Apple
  // Store, 08-05) should now lead.
  await dateHeader.click();
  await app.browser.waitUntil(
    async () => (await app.browser.$(firstDescriptionCell).getText()).includes("Apple Store"),
    { timeout: 10000, timeoutMsg: "expected Apple Store (oldest date) to lead after flipping to ascending" },
  );

  // Switch to sorting by Amount — clicking a different column defaults to
  // ascending, so the most negative amount (Apple Store, -50.00) leads.
  const amountHeader = await app.browser.$("//th[contains(@class,'sortable-col')][contains(.,'Amount')]");
  await amountHeader.click();
  await app.browser.waitUntil(
    async () => (await app.browser.$(firstDescriptionCell).getText()).includes("Apple Store"),
    { timeout: 10000, timeoutMsg: "expected Apple Store (-50.00, smallest amount) to lead under ascending amount sort" },
  );

  // Flip Amount to descending — the largest (least negative) amount,
  // Coffee Shop at -5.00, should lead.
  await amountHeader.click();
  await app.browser.waitUntil(
    async () => (await app.browser.$(firstDescriptionCell).getText()).includes("Coffee Shop"),
    { timeout: 10000, timeoutMsg: "expected Coffee Shop (-5.00, largest amount) to lead under descending amount sort" },
  );

  console.log("sort behavior verified");

  // Account filter: open the dropdown, confirm both accounts show grouped
  // under their type headers, then uncheck Credit Card.
  const filterToggle = await app.browser.$("button*=All accounts");
  await filterToggle.waitForExist({ timeout: 5000 });
  await filterToggle.click();

  const creditGroupLabel = await app.browser.$("//label[contains(@class,'account-filter-group-label')][text()='Credit Cards']");
  await creditGroupLabel.waitForExist({ timeout: 5000 });

  const creditCheckbox = await app.browser.$(
    "//label[contains(@class,'account-filter-option')][contains(.,'Credit Card')]/input[@type='checkbox']",
  );
  await creditCheckbox.click();

  const ledgerPage = await app.browser.$(".page");
  await app.browser.waitUntil(
    async () => !(await ledgerPage.getText()).includes("Coffee Shop"),
    { timeout: 10000, timeoutMsg: "expected Coffee Shop (Credit Card) to disappear once that account is unchecked" },
  );
  const filteredText = await ledgerPage.getText();
  console.log("ledger after unchecking Credit Card:", filteredText);
  if (!filteredText.includes("Zebra Store") || !filteredText.includes("Apple Store")) {
    throw new Error(`expected Checking's transactions to remain visible, got:\n${filteredText}`);
  }

  const toggleLabelText = await filterToggle.getText();
  console.log("filter toggle label:", toggleLabelText);
  if (!toggleLabelText.includes("Checking")) {
    throw new Error(`expected the toggle to show the single remaining account's name, got:\n${toggleLabelText}`);
  }

  // "More filters" popover: the date-range/tag filters that used to sit
  // directly in the toolbar now collapse behind this toggle. Confirm it
  // still narrows the Ledger the same way, just relocated.
  const moreFiltersToggle = await app.browser.$("button*=More filters");
  await moreFiltersToggle.waitForExist({ timeout: 5000 });
  await moreFiltersToggle.click();

  const tagSelect = await app.browser.$("//label[.//span[text()='Tag']]/select");
  await tagSelect.waitForExist({ timeout: 5000 });
  await tagSelect.selectByVisibleText("urgent");
  await app.browser.waitUntil(async () => (await tagSelect.getValue()) === "urgent", {
    timeout: 5000,
    timeoutMsg: "expected the Tag select in More filters to hold 'urgent' after selecting it",
  });

  await app.browser.waitUntil(
    async () => !(await ledgerPage.getText()).includes("Apple Store"),
    { timeout: 10000, timeoutMsg: "expected Apple Store (untagged) to disappear once filtering by the 'urgent' tag" },
  );
  const tagFilteredText = await ledgerPage.getText();
  console.log("ledger after filtering by 'urgent' tag via More filters:", tagFilteredText);
  if (!tagFilteredText.includes("Zebra Store")) {
    throw new Error(`expected Zebra Store (tagged 'urgent') to remain visible, got:\n${tagFilteredText}`);
  }

  const toggleLabelAfterTag = await moreFiltersToggle.getText();
  if (!toggleLabelAfterTag.includes("1 filter active")) {
    throw new Error(`expected the More filters toggle to reflect one active filter, got "${toggleLabelAfterTag}"`);
  }
  console.log("More filters popover correctly narrowed the Ledger by tag");

  console.log("FEATURE 20 E2E TEST PASSED");
} finally {
  await app.close();
}
