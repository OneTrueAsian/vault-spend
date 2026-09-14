// E2E test for the Ledger's new bulk "+ Add tag…" control (U-4 from the
// performance/UI review): selects two transactions' row checkboxes,
// applies a tag via the bulk-actions bar, and confirms both rows picked up
// the tag through the real `add_tag` command (not just a UI-only change).
//
// Run with: node e2e/feature45_bulk_tag.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
for date, desc, amount in [("2026-08-10", "Hotel Booking", "-220.00"), ("2026-08-12", "Airport Parking", "-40.00")]:
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
        (checking_id, date, desc, amount, "Shopping", f"{checking_id}|{date}|{desc.lower()}|{amount}"),
    )
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  for (const desc of ["Hotel Booking", "Airport Parking"]) {
    const rowCheckbox = await app.browser.$(`//tr[.//td[contains(.,'${desc}')]]//input[@type='checkbox']`);
    await rowCheckbox.waitForExist({ timeout: 10000 });
    await rowCheckbox.click();
  }

  const bulkBar = await app.browser.$(".bulk-actions-bar");
  await bulkBar.waitForExist({ timeout: 5000 });
  const barText = await bulkBar.getText();
  console.log("bulk actions bar:", barText);
  if (!barText.includes("2 selected")) {
    throw new Error(`expected both rows selected, got:\n${barText}`);
  }

  const tagInput = await bulkBar.$("input");
  await tagInput.setValue("vacation");
  const addTagButton = await bulkBar.$("button*=Add tag");
  await addTagButton.click();

  await app.browser.waitUntil(async () => (await app.browser.$$(".bulk-actions-bar")).length === 0, {
    timeout: 10000,
    timeoutMsg: "expected the bulk-actions bar to close (selection cleared) after tagging",
  });

  for (const desc of ["Hotel Booking", "Airport Parking"]) {
    const row = await app.browser.$(`//tr[.//td[contains(.,'${desc}')]]`);
    const rowText = await row.getText();
    console.log(`${desc} row:`, rowText);
    if (!rowText.includes("vacation")) {
      throw new Error(`expected "${desc}" to carry the bulk-applied "vacation" tag, got:\n${rowText}`);
    }
  }

  console.log("FEATURE 45 E2E TEST PASSED");
} finally {
  await app.close();
}
