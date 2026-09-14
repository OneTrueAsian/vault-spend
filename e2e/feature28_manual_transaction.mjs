// E2E test for manually adding a single transaction (Ledger tab's "Add
// transaction…") — the one way to get a transaction into the ledger
// without a file import. Covers both the explicit-category path and
// leaving Category on "Auto-categorize" (which runs the same
// categorize_uncategorized pass an import row gets — with no matching
// rule for a made-up description, it should land on Uncategorized rather
// than erroring or crashing).
//
// Run with: node e2e/feature28_manual_transaction.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  const addTransactionBtn = await app.browser.$("button*=Add transaction");
  await addTransactionBtn.waitForExist({ timeout: 10000 });
  await addTransactionBtn.click();

  const dialog = await app.browser.$("//h2[contains(@class,'modal-title')][text()='Add transaction']");
  await dialog.waitForExist({ timeout: 10000 });
  const dialogPanel = await app.browser.$(".modal-panel");

  // First transaction: explicit category, skipping auto-categorize entirely.
  const descriptionInput = await dialogPanel.$("input[placeholder='e.g. \"Coffee shop\"']");
  await descriptionInput.setValue("Local Coffee Shop");
  const amountInput = await dialogPanel.$("input[placeholder='Negative = money out']");
  await amountInput.setValue("-4.50");
  // The Category <select>'s first option is "Auto-categorize" — find the
  // select containing that option and pick "Dining Out" (a seeded default
  // category) explicitly instead. Confirmed via `.getValue()` before
  // submitting — same pattern feature23_family_members.mjs uses for a
  // React-controlled <select>, since selecting and immediately clicking
  // Submit can race the onChange committing to state.
  const selects = await dialogPanel.$$("select");
  let categoryField = null;
  for (const sel of selects) {
    const text = await sel.getText();
    if (text.includes("Auto-categorize")) {
      categoryField = sel;
      break;
    }
  }
  if (!categoryField) throw new Error("expected to find the Category select in the Add transaction dialog");
  await categoryField.selectByVisibleText("Dining Out");
  await app.browser.waitUntil(async () => (await categoryField.getValue()) === "Dining Out", {
    timeout: 5000,
    timeoutMsg: "expected the Category select to hold Dining Out after selecting it",
  });

  const submitBtn = await dialogPanel.$("button=Add transaction");
  await submitBtn.click();
  await dialog.waitForExist({ timeout: 5000, reverse: true });

  const ledgerPage = await app.browser.$(".page");
  await app.browser.waitUntil(
    async () => (await ledgerPage.getText()).includes("Local Coffee Shop"),
    { timeout: 10000, timeoutMsg: "expected the manually-added transaction to appear in the Ledger" },
  );

  // Scope the category check to this specific row's own category <select>
  // (not just "Dining Out" appearing anywhere on the page — the toolbar's
  // category filter always lists every category regardless of what any
  // row is actually set to, so a page-wide text search would pass even if
  // the row itself came back Uncategorized). Column order in a Ledger row
  // is date/description/amount/account-select/member-select/category-select,
  // so the category <select> is the 3rd <select> in the row.
  const coffeeRow = await app.browser.$("//tr[td[contains(.,'Local Coffee Shop')]]");
  const coffeeRowSelects = await coffeeRow.$$("select");
  const coffeeRowCategorySelect = coffeeRowSelects[2];
  await app.browser.waitUntil(async () => (await coffeeRowCategorySelect.getValue()) === "Dining Out", {
    timeout: 10000,
    timeoutMsg: 'expected the explicitly-picked category "Dining Out" to be set on this row',
  });
  console.log("first transaction correctly categorized as Dining Out");

  // Second transaction: leave Category on "Auto-categorize" — nothing
  // matches this made-up description, so it should land on Uncategorized
  // without erroring.
  await addTransactionBtn.click();
  await dialog.waitForExist({ timeout: 10000 });
  const descriptionInput2 = await dialogPanel.$("input[placeholder='e.g. \"Coffee shop\"']");
  await descriptionInput2.setValue("Zzyzx Test Merchant Nine Four Two");
  const amountInput2 = await dialogPanel.$("input[placeholder='Negative = money out']");
  await amountInput2.setValue("-12.00");
  const submitBtn2 = await dialogPanel.$("button=Add transaction");
  await submitBtn2.click();
  await dialog.waitForExist({ timeout: 5000, reverse: true });

  await app.browser.waitUntil(
    async () => (await ledgerPage.getText()).includes("Zzyzx Test Merchant Nine Four Two"),
    { timeout: 10000, timeoutMsg: "expected the second manually-added transaction to appear in the Ledger" },
  );

  // Same precise per-row check: an empty category <select> value (the
  // disabled "Uncategorized" placeholder option has value="") means
  // nothing matched during categorize_uncategorized, as expected for this
  // made-up description — not just the word "Uncategorized" appearing
  // anywhere on the page (every row's select carries that placeholder
  // option regardless of its actual value).
  const zzyzxRow = await app.browser.$("//tr[td[contains(.,'Zzyzx Test Merchant')]]");
  const zzyzxRowSelects = await zzyzxRow.$$("select");
  const zzyzxRowCategorySelect = zzyzxRowSelects[2];
  const zzyzxCategoryValue = await zzyzxRowCategorySelect.getValue();
  if (zzyzxCategoryValue !== "") {
    throw new Error(`expected the auto-categorize path to leave an unmatched transaction Uncategorized, got category "${zzyzxCategoryValue}"`);
  }
  console.log("second transaction correctly left Uncategorized via the auto-categorize path");

  console.log("FEATURE 28 E2E TEST PASSED");
} finally {
  await app.close();
}
