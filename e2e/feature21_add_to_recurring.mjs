// E2E smoke test for turning a selected Ledger transaction directly into a
// recurring item: selects a transaction's row checkbox, picks a cadence
// from the bulk-actions bar's "Add to Recurring…" picker, and confirms a
// matching item (merchant, amount, cadence, linked account) appears on the
// Recurring tab — through the real `bulk_create_recurring_from_transactions`
// command, not just a frontend-only change.
//
// Run with: node e2e/feature21_add_to_recurring.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "2026-08-10", "Streamline Video", "-15.99", "Entertainment", f"{checking_id}|2026-08-10|streamline video|-15.99"),
)
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  const rowCheckbox = await app.browser.$(
    "//tr[.//td[contains(.,'Streamline Video')]]//input[@type='checkbox']",
  );
  await rowCheckbox.waitForExist({ timeout: 10000 });
  await rowCheckbox.click();

  const bulkBar = await app.browser.$(".bulk-actions-bar");
  await bulkBar.waitForExist({ timeout: 5000 });
  const barText = await bulkBar.getText();
  console.log("bulk actions bar:", barText);
  if (!barText.includes("Add to Recurring")) {
    throw new Error(`expected an "Add to Recurring…" control, got:\n${barText}`);
  }

  const recurringSelect = await app.browser.$(
    "//div[contains(@class,'bulk-actions-bar')]//option[text()='Add to Recurring…']/parent::select",
  );
  await recurringSelect.selectByAttribute("value", "annual");

  await app.browser.waitUntil(
    async () => (await app.browser.$(".status").getText()).toLowerCase().includes("added 1"),
    { timeout: 10000, timeoutMsg: "expected a confirmation status message after adding to Recurring" },
  );
  console.log("status:", await (await app.browser.$(".status")).getText());

  const recurringNav = await app.browser.$("button*=Recurring");
  await recurringNav.click();

  const recurringRow = await app.browser.$("//tr[.//div[text()='Streamline Video']]");
  await recurringRow.waitForExist({ timeout: 10000 });
  const rowText = await recurringRow.getText();
  console.log("new recurring row:", rowText);
  if (!rowText.includes("Checking")) throw new Error(`expected the linked account "Checking", got:\n${rowText}`);
  if (!/annual/i.test(rowText)) throw new Error(`expected cadence "annual", got:\n${rowText}`);
  if (!rowText.includes("15.99")) throw new Error(`expected amount 15.99, got:\n${rowText}`);

  console.log("FEATURE 21 E2E TEST PASSED");
} finally {
  await app.close();
}
