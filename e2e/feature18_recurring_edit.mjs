// E2E smoke test for editing an existing recurring item (previously only
// deletable): seeds one recurring bill, clicks Edit, changes its merchant,
// amount, and cadence, saves, and confirms the row reflects the new values
// — through the real `update_recurring` command, not just local state.
//
// Run with: node e2e/feature18_recurring_edit.mjs

import { launchApp, chooseMenuOption } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";

const dbDir = await seedFixture(`
cur.execute(
    "INSERT INTO recurring (merchant, category, amount, cadence, anchor_date) VALUES ('Netflix', NULL, '-15.49', 'monthly', '${dateInMonth(-2, 4)}')"
)
`);

const app = await launchApp({ dbDir });
try {
  const recurringNav = await app.browser.$("button*=Recurring");
  await recurringNav.click();

  const editBtn = await app.browser.$("button=Edit");
  await editBtn.waitForExist({ timeout: 10000 });
  await editBtn.click();

  // The row should now show inline edit inputs, pre-filled with the
  // existing values — scoped by table structure (first td = merchant,
  // third td = cadence, an Account column now sits between them) rather
  // than the input's `value` attribute, since a controlled React input's
  // DOM attribute isn't reliably queryable after mount.
  const editingTable = "//table[.//th[text()='Merchant']]/tbody/tr";
  const merchantInput = await app.browser.$(`${editingTable}/td[1]/input`);
  await merchantInput.waitForExist({ timeout: 5000 });
  await merchantInput.click();
  await app.browser.keys(["Control", "a"]);
  await app.browser.keys("Netflix (Premium)");

  const amountInput = await app.browser.$(`${editingTable}//input[contains(@class,"amount-edit-input")]`);
  await amountInput.click();
  await app.browser.keys(["Control", "a"]);
  await app.browser.keys("-22.99");

  const cadenceSelect = await app.browser.$(`${editingTable}/td[3]//button[contains(@class,'menu-select-toggle')]`);
  await chooseMenuOption(cadenceSelect, { value: "annual" });

  const saveBtn = await app.browser.$("button=Save");
  await saveBtn.click();

  await app.browser.waitUntil(
    async () => {
      const page = await app.browser.$(".page");
      const text = await page.getText();
      return text.includes("Netflix (Premium)");
    },
    { timeout: 10000, timeoutMsg: "expected the edited merchant name to appear after saving" },
  );

  const pageText = await (await app.browser.$(".page")).getText();
  console.log("recurring page after edit:", pageText);
  if (!pageText.includes("Netflix (Premium)")) throw new Error(`expected renamed merchant, got:\n${pageText}`);
  if (!pageText.includes("-$22.99")) throw new Error(`expected updated amount, got:\n${pageText}`);
  if (!pageText.includes("Yearly")) throw new Error(`expected updated cadence "Yearly", got:\n${pageText}`);
  if (pageText.includes("$15.49")) throw new Error(`old amount should no longer appear, got:\n${pageText}`);

  console.log("FEATURE 18 E2E TEST PASSED");
} finally {
  await app.close();
}
