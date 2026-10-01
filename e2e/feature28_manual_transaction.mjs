// E2E test for manually adding a single transaction (Ledger tab's "Add
// transaction…") — the one way to get a transaction into the ledger
// without a file import. Covers both the explicit-category path and
// leaving Category on "Auto-categorize" (which runs the same
// categorize_uncategorized pass an import row gets — with no matching
// rule for a made-up description, it should land on Uncategorized rather
// than erroring or crashing).
//
// Run with: node e2e/feature28_manual_transaction.mjs

import { launchApp, chooseMenuOption, menuSelectValue, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);

const app = await launchApp({ dbDir });
try {
  // The app's own default launch size (800px, tauri.conf.json) sits below
  // the ledger's narrow-layout breakpoint, where Account/Member/Category
  // move behind a per-row "Details" toggle — this test isn't about that
  // layout, so give it room for the normal wide columns instead.
  await app.browser.setWindowSize(1280, 900);
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
  const selects = await dialogPanel.$$(".menu-select-toggle");
  let categoryField = null;
  for (const sel of selects) {
    const text = await sel.getText();
    if (text.includes("Auto-categorize")) {
      categoryField = sel;
      break;
    }
  }
  if (!categoryField) throw new Error("expected to find the Category select in the Add transaction dialog");
  await chooseMenuOption(categoryField, { label: "Dining Out" });
  await app.browser.waitUntil(async () => (await menuSelectValue(categoryField)) === "Dining Out", {
    timeout: 5000,
    timeoutMsg: "expected the Category select to hold Dining Out after selecting it",
  });

  // The optional Note field in the creation dialog itself — set alongside
  // the rest of the atomic creation, not edited afterward.
  const notesInput = await dialogPanel.$("textarea");
  await notesInput.setValue("Split with Jordan");

  const submitBtn = await dialogPanel.$("button=Add transaction");
  await submitBtn.click();
  // Saving runs the categorizer and reloads the ledger before the dialog closes, which took over 5 s once
  // under a full parallel run; if it is really stuck, the diagnosis shows the dialog and any status text.
  await waitUntilOrDiagnose(app.browser, async () => !(await dialog.isExisting()), {
    timeout: 15000,
    timeoutMsg: "the Add transaction dialog should close once the transaction is saved",
  });

  const ledgerPage = await app.browser.$(".page");
  await app.browser.waitUntil(
    async () => (await ledgerPage.getText()).includes("Local Coffee Shop"),
    { timeout: 10000, timeoutMsg: "expected the manually-added transaction to appear in the Ledger" },
  );

  // Scope the category check to this specific row's own category editor
  // (not just "Dining Out" appearing anywhere on the page — the toolbar's
  // category filter always lists every category regardless of what any
  // row is actually set to, so a page-wide text search would pass even if
  // the row itself came back Uncategorized). The row's account/member/
  // category editors are RowFieldDropdown triggers, not native <select>s;
  // each carries its own aria-label naming the field.
  const coffeeRow = await app.browser.$("//tr[td[contains(.,'Local Coffee Shop')]]");
  const coffeeRowCategoryTrigger = await coffeeRow.$("[aria-label*='Category for']");
  await app.browser.waitUntil(async () => (await coffeeRowCategoryTrigger.getText()).includes("Dining Out"), {
    timeout: 10000,
    timeoutMsg: 'expected the explicitly-picked category "Dining Out" to be set on this row',
  });
  console.log("first transaction correctly categorized as Dining Out");

  // The note typed into the creation dialog should have been saved
  // atomically with the rest of the transaction, and shows as a preview
  // button on the row (not the raw "+ Add note" prompt for a note-less row).
  const coffeeNoteButton = await coffeeRow.$("button*=Split with Jordan");
  if (!(await coffeeNoteButton.isExisting())) {
    throw new Error('expected the note typed while creating the transaction ("Split with Jordan") to appear as a preview on its row');
  }
  console.log("note typed during manual creation was saved and previews on the row");

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

  // Same precise per-row check: the row's own category editor reading
  // "Uncategorized" means nothing matched during categorize_uncategorized,
  // as expected for this made-up description — not just the word
  // "Uncategorized" appearing anywhere on the page (the toolbar's category
  // filter always lists it as an option regardless of any row's value).
  const zzyzxRow = await app.browser.$("//tr[td[contains(.,'Zzyzx Test Merchant')]]");
  const zzyzxRowCategoryTrigger = await zzyzxRow.$("[aria-label*='Category for']");
  const zzyzxCategoryText = await zzyzxRowCategoryTrigger.getText();
  if (!zzyzxCategoryText.includes("Uncategorized")) {
    throw new Error(`expected the auto-categorize path to leave an unmatched transaction Uncategorized, got category "${zzyzxCategoryText}"`);
  }
  console.log("second transaction correctly left Uncategorized via the auto-categorize path");

  console.log("FEATURE 28 E2E TEST PASSED");
} finally {
  await app.close();
}
