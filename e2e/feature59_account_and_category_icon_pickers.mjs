// E2E test for the account and category icon pickers: picking an explicit
// icon swatch when creating (or later editing) an account or category
// overrides the type-/keyword-guessed default (accountIcons.tsx /
// categoryIcons.tsx) and round-trips through the database. Mirrors
// feature54_goal_icon_picker.mjs's pattern for the same feature, now
// extended to accounts and categories, using the full-color icon set the
// user hand-picked (src/icons/flatIcons.ts) rather than the bundled
// monochrome Noun Project set.
//
// Verifies persistence by reopening the picker and checking which swatch
// is marked active, rather than inspecting the rendered <img src> —
// several of the bundled SVGs are small enough that Vite inlines them as
// base64 data URIs instead of emitting a `/assets/<name>-<hash>.svg` file,
// so a filename substring check would be fragile.
//
// Run with: node e2e/feature59_account_and_category_icon_pickers.mjs

import { launchApp } from "./harness.mjs";

async function activeSwatchTitle(scopeEl) {
  const el = await scopeEl.$(".icon-picker-swatch-active");
  if (!(await el.isExisting())) return null;
  return el.getAttribute("title");
}

// Picking a swatch closes its popover immediately (optimistic local
// state), but the set_account_icon/set_category_icon + refresh() round
// trip that actually persists the choice is async — reopening the picker
// right after the popover closes can still observe the pre-change value
// for a moment. Poll by reopening (via `openToggle`, scoped to whichever
// element toggles this row/card's picker) until the expected swatch shows
// up active, instead of trusting a single read.
async function waitForPersistedIcon(scopeEl, openToggle, expectedTitle) {
  await app.browser.waitUntil(
    async () => {
      await openToggle.click();
      const active = await activeSwatchTitle(scopeEl);
      if (active === expectedTitle) return true;
      await openToggle.click(); // close again before the next attempt
      return false;
    },
    { timeout: 5000, timeoutMsg: `expected "${expectedTitle}" to become the active swatch after changing it` },
  );
}

const app = await launchApp();
try {
  // --- Account: pick an explicit icon at creation time ---
  const accountsNav = await app.browser.$("button*=Accounts");
  await accountsNav.click();

  const addAccountBtn = await app.browser.$("button*=Add account");
  await addAccountBtn.waitForExist({ timeout: 10000 });
  await addAccountBtn.click();

  const nameInput = await app.browser.$('input[placeholder=\'e.g. "Everyday Checking"\']');
  await nameInput.waitForExist({ timeout: 5000 });
  await nameInput.setValue("Test Checking Account");

  // Leaving the type as the default "Checking" but explicitly picking the
  // "investment" swatch is unambiguously provable against the type-guessed
  // default (which would be the checking icon).
  let swatches = await app.browser.$$(".icon-picker-swatch");
  let swatchTitles = [];
  for (const s of swatches) swatchTitles.push(await s.getAttribute("title"));
  let investmentIndex = swatchTitles.indexOf("investment");
  if (investmentIndex === -1) throw new Error(`expected an "investment" icon swatch, got titles: ${swatchTitles.join(", ")}`);
  await swatches[investmentIndex].click();

  const activeSwatch = await app.browser.$(".icon-picker-swatch-active");
  const activeTitle = await activeSwatch.getAttribute("title");
  if (activeTitle !== "investment") throw new Error(`expected the investment swatch to be marked active, got "${activeTitle}"`);

  const createAccountBtn = await app.browser.$("button=Create account");
  await createAccountBtn.click();

  const accountCard = await app.browser.$(
    "//div[contains(@class,'account-card')][.//div[contains(@class,'account-name-cell')][contains(.,'Test Checking Account')]]",
  );
  await accountCard.waitForExist({ timeout: 10000 });

  // Reopen the picker and confirm "investment" round-tripped through
  // create_account + list_accounts as the active choice.
  let badgeButton = await accountCard.$(".type-badge");
  await badgeButton.click();
  let title = await activeSwatchTitle(accountCard);
  if (title !== "investment") throw new Error(`expected "investment" to be the active swatch after creation, got "${title}"`);
  console.log("new account's active icon after creation:", title);

  // --- Account: change an existing account's icon via the badge toggle ---
  swatches = await accountCard.$$(".icon-picker-swatch");
  swatchTitles = [];
  for (const s of swatches) swatchTitles.push(await s.getAttribute("title"));
  const loanIndex = swatchTitles.indexOf("loan");
  if (loanIndex === -1) throw new Error(`expected a "loan" icon swatch, got titles: ${swatchTitles.join(", ")}`);
  await swatches[loanIndex].click();

  await app.browser.waitUntil(
    async () => (await activeSwatchTitle(accountCard)) === null,
    { timeout: 5000, timeoutMsg: "expected the picker popover to close after picking a swatch" },
  );

  // Reopen once more to confirm the change actually persisted (not just a
  // local, unsaved UI toggle).
  badgeButton = await accountCard.$(".type-badge");
  await waitForPersistedIcon(accountCard, badgeButton, "loan");
  console.log("account's active icon after changing it: loan");

  // --- Category: pick an explicit icon while creating it ---
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  const moreActionsBtn = await app.browser.$('button[title="More actions"]');
  await moreActionsBtn.waitForExist({ timeout: 10000 });
  await moreActionsBtn.click();

  const manageCategoriesBtn = await app.browser.$("button*=Manage categories");
  await manageCategoriesBtn.waitForExist({ timeout: 5000 });
  await manageCategoriesBtn.click();

  const newCategoryInput = await app.browser.$('input[placeholder=\'New category, e.g. "Pet Care"\']');
  await newCategoryInput.waitForExist({ timeout: 5000 });
  await newCategoryInput.setValue("Widget Utilities");

  swatches = await app.browser.$$(".icon-picker-swatch");
  swatchTitles = [];
  for (const s of swatches) swatchTitles.push(await s.getAttribute("title"));
  const utilitiesIndex = swatchTitles.indexOf("utilities");
  if (utilitiesIndex === -1) throw new Error(`expected a "utilities" icon swatch, got titles: ${swatchTitles.join(", ")}`);
  await swatches[utilitiesIndex].click();

  const addCategoryBtn = await app.browser.$("button=Add");
  await addCategoryBtn.click();

  const categoryRow = await app.browser.$(
    "//li[contains(@class,'category-manage-row')][.//span[contains(@class,'category-manage-name')][contains(.,'Widget Utilities')]]",
  );
  await categoryRow.waitForExist({ timeout: 10000 });

  // Reopen the row's picker and confirm "utilities" round-tripped through
  // create_category + list_categories_with_icons as the active choice.
  let rowSwatchButton = await categoryRow.$(".icon-picker-swatch");
  await rowSwatchButton.click();
  title = await activeSwatchTitle(categoryRow);
  if (title !== "utilities") throw new Error(`expected "utilities" to be the active swatch after creation, got "${title}"`);
  console.log("new category's active icon after creation:", title);

  // --- Category: change an existing category's icon via the row swatch ---
  swatches = await categoryRow.$$(".icon-picker-swatch");
  swatchTitles = [];
  for (const s of swatches) swatchTitles.push(await s.getAttribute("title"));
  const housingIndex = swatchTitles.indexOf("housing");
  if (housingIndex === -1) throw new Error(`expected a "housing" icon swatch, got titles: ${swatchTitles.join(", ")}`);
  await swatches[housingIndex].click();

  await app.browser.waitUntil(
    async () => (await activeSwatchTitle(categoryRow)) === null,
    { timeout: 5000, timeoutMsg: "expected the picker popover to close after picking a swatch" },
  );

  rowSwatchButton = await categoryRow.$(".icon-picker-swatch");
  await waitForPersistedIcon(categoryRow, rowSwatchButton, "housing");
  console.log("category's active icon after changing it: housing");

  console.log("FEATURE 59 E2E TEST PASSED");
} finally {
  await app.close();
}
