// E2E smoke test for editing an existing recurring item (previously only
// deletable): seeds one recurring bill, clicks Edit, changes its merchant,
// amount, and cadence, saves, and confirms the row reflects the new values
// — through the real `update_recurring` command, not just local state.
//
// Run with: node e2e/feature18_recurring_edit.mjs

import assert from "node:assert/strict";
import { launchApp, chooseMenuOption, waitUntilOrDiagnose, withFocusRetry } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { invoke } from "./lib/change-password.mjs";
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
  const amountInput = await app.browser.$(`${editingTable}//input[contains(@class,"amount-edit-input")]`);
  const cadenceSelect = await app.browser.$(`${editingTable}/td[3]//button[contains(@class,'menu-select-toggle')]`);

  // Typed keys go to whichever window has OS focus, so a window that lost focus drops them silently (see "Another spec's window takes OS
  // focus" in e2e/README.md). Reclaim focus first, retry the entry only if the window really lost focus, and check what the boxes hold
  // before saving: a lost entry then fails here with the values, not as a missing name after Save.
  await withFocusRetry(app.browser, async () => {
    await merchantInput.click();
    await app.browser.keys(["Control", "a"]);
    await app.browser.keys("Netflix (Premium)");

    await amountInput.click();
    await app.browser.keys(["Control", "a"]);
    await app.browser.keys("-22.99");

    await chooseMenuOption(cadenceSelect, { value: "annual" });

    const entered = {
      merchant: await merchantInput.getValue(),
      amount: await amountInput.getValue(),
      cadence: await cadenceSelect.getAttribute("data-value"),
    };
    assert.deepEqual(entered, { merchant: "Netflix (Premium)", amount: "-22.99", cadence: "annual" }, "the edit boxes should hold the new values before Save");
  });

  const saveBtn = await app.browser.$("button=Save");
  await saveBtn.click();

  const savedRecords = async () => (await invoke(app.browser, "list_recurring")).ok ?? [];
  await waitUntilOrDiagnose(
    app.browser,
    async () => {
      const page = await app.browser.$(".page");
      const text = await page.getText();
      return text.includes("Netflix (Premium)");
    },
    { timeout: 10000, timeoutMsg: "expected the edited merchant name to appear after saving", extra: async () => ({ saved: await savedRecords(), status: await app.browser.execute(() => document.querySelector("[role=status], [role=alert]")?.textContent ?? null) }) },
  );

  // The real backend holds the edit, not just the page: name, amount and cadence saved, the old amount gone.
  const records = await savedRecords();
  assert.equal(records.length, 1, "the one recurring item is edited in place, not duplicated");
  assert.deepEqual({ merchant: records[0].merchant, amount: records[0].amount, cadence: records[0].cadence }, { merchant: "Netflix (Premium)", amount: "-22.99", cadence: "annual" }, "the backend record holds the edit");

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
