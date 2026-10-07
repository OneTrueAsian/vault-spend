// E2E smoke test for manual asset tracking ("Property and valuables"):
// creates a real estate asset from the Accounts tab, confirms it's listed
// with its value folded into the Total Assets / Net Worth stats, edits its
// value, then deletes it and confirms the stats settle back down.
//
// Run with: node e2e/feature11_assets.mjs

import { launchApp, pickFromMenu } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);

const app = await launchApp({ dbDir });
try {
  const accountsNav = await app.browser.$("button*=Accounts");
  await accountsNav.click();

  const addAssetBtn = await app.browser.$("button*=Add property or valuable");
  await addAssetBtn.waitForExist({ timeout: 10000 });
  await addAssetBtn.click();

  const nameInput = await app.browser.$(`//input[@placeholder='e.g. "Home"']`);
  await nameInput.waitForExist({ timeout: 5000 });
  await nameInput.setValue("Home");
  const valueInput = await app.browser.$('input[placeholder="Current value"]');
  await valueInput.setValue("350000");
  const saveBtn = await app.browser.$("button=Save");
  await saveBtn.click();

  // Property and valuables is one group card on Accounts (UAT s7.1), a row per thing.
  const propertySection = await app.browser.$("[data-property-assets]");
  // This card exists even with nothing in it (it holds the add button), so
  // `waitForExist` proves nothing about whether the create actually landed
  // yet. Poll for the asset's own text instead, same pattern already used
  // below for the edit and delete steps.
  await app.browser.waitUntil(async () => (await propertySection.getText()).includes("Home"), {
    timeout: 10000,
    timeoutMsg: 'expected "Home" to appear in the Property and valuables card after saving',
  });
  let sectionText = await propertySection.getText();
  console.log("property section after add:", sectionText);
  if (!sectionText.includes("Home") || !sectionText.includes("$350,000.00")) {
    throw new Error(`expected Home at $350,000.00, got:\n${sectionText}`);
  }

  // Property & Valuables sits on the Accounts tab beside the Total Assets /
  // Net Worth stats (1000 checking + 350000 home = 351000 net worth).
  const netWorthStat = await app.browser.$("//span[text()='Net worth']/parent::button");
  await netWorthStat.waitForExist({ timeout: 5000 });
  let netWorthText = await netWorthStat.getText();
  console.log("net worth stat after add:", netWorthText);
  if (!netWorthText.includes("$351,000.00")) {
    throw new Error(`expected Net Worth to include the $350,000 asset, got:\n${netWorthText}`);
  }

  // Edit the value — scoped to the row containing "Home" specifically.
  const homeRow = "//div[@data-asset-id][.//div[text()='Home']]";
  const valueCellXPath = `${homeRow}//button[contains(@class,'amount-editable')]`;
  const editInputXPath = `${homeRow}//input[contains(@class,'amount-edit-input')]`;

  // The value cell swaps to an <input autoFocus ... onBlur={commit}> the
  // instant it's clicked — a real, if narrow, race: clicking that freshly-
  // mounted, already-focused input (needed because setValue()'s internal
  // clear-then-type sequence is unreliable against this controlled React
  // input in this WebView2/tauri-driver combo) can itself dispatch a
  // spurious blur first, which commits the untouched value and reverts
  // the cell back to plain text before the click actually lands or before
  // the keys typed afterward reach anything — leaving nothing at
  // editInputXPath. Re-clicking the span is a safe, idempotent recovery
  // (a no-op if it's already mid-edit), so retry the whole "open it,
  // click into it, confirm it's still there" handshake instead of
  // gambling on one attempt.
  let opened = false;
  for (let attempt = 1; attempt <= 5 && !opened; attempt++) {
    try {
      const valueCell = await app.browser.$(valueCellXPath);
      await valueCell.waitForExist({ timeout: 5000 });
      await valueCell.click();
      const editInput = await app.browser.$(editInputXPath);
      await editInput.waitForExist({ timeout: 1000 });
      await editInput.click();
      // Confirm the click itself didn't blur-and-revert it.
      if (await editInput.isExisting()) opened = true;
    } catch {
      // Element vanished mid-handshake (the race this loop exists for) —
      // fall through and retry from the top.
    }
  }
  if (!opened) throw new Error("expected the amount edit input to appear and stay open after clicking the value cell");

  await app.browser.keys(["Control", "a"]);
  await app.browser.keys("400000");
  await app.browser.keys("Enter");

  await app.browser.waitUntil(
    async () => (await propertySection.getText()).includes("$400,000.00"),
    { timeout: 10000, timeoutMsg: "expected the edited value $400,000.00 to appear" },
  );

  // Delete it from the row's ⋯ menu and confirm it's gone, with the stat back down to just cash.
  await pickFromMenu(app.browser, `${homeRow}//button[@data-row-menu]`, "//div[contains(@class,'row-menu-panel')]//button[normalize-space()='Delete…']");
  const confirmDeleteBtn = await app.browser.$(`${homeRow}//span[contains(@class,'row-delete-confirm')]//button[text()='Delete']`);
  await confirmDeleteBtn.waitForExist({ timeout: 5000 });
  await confirmDeleteBtn.click();

  await app.browser.waitUntil(
    async () => (await propertySection.getText()).includes("No property or valuables added yet"),
    { timeout: 10000, timeoutMsg: "expected the asset to be gone after delete" },
  );

  await accountsNav.click();
  await netWorthStat.waitForExist({ timeout: 5000 });
  const netWorthAfterDelete = await netWorthStat.getText();
  console.log("net worth stat after delete:", netWorthAfterDelete);
  if (!netWorthAfterDelete.includes("$1,000.00")) {
    throw new Error(`expected Net Worth back down to $1,000.00, got:\n${netWorthAfterDelete}`);
  }

  console.log("FEATURE 11 E2E TEST PASSED");
} finally {
  await app.close();
}
