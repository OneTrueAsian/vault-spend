// E2E smoke test for tags: seeds one transaction, adds a tag via the real
// Ledger UI, confirms the pill renders and the Ledger's tag filter picks it
// up, then checks Reports shows it under "Spending by Tag".
//
// Run with: node e2e/feature5_tags.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "2026-08-05", "Target", "-100.00", "Groceries", f"{checking_id}|2026-08-05|target|-100.00"),
)
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  const tagInput = await app.browser.$(".tag-input");
  await tagInput.waitForExist({ timeout: 10000 });
  await tagInput.setValue("vacation");
  await app.browser.keys("Enter");

  const pill = await app.browser.$(".tag-pill");
  await pill.waitForExist({ timeout: 10000 });
  console.log("tag pill text:", await pill.getText());

  // The tag filter now lives behind the "More filters" popover (see
  // MoreFiltersPopover.tsx) rather than always being visible in the
  // toolbar — open it before its <option> exists in the DOM.
  const moreFiltersToggle = await app.browser.$("button*=More filters");
  await moreFiltersToggle.waitForExist({ timeout: 5000 });
  await moreFiltersToggle.click();

  const filterOption = await app.browser.$("option=vacation");
  await filterOption.waitForExist({ timeout: 5000 });
  console.log("filter option found");

  const reportsNav = await app.browser.$("button*=Reports");
  await reportsNav.click();

  const tagsStat = await app.browser.$("button*=Tags in use");
  await tagsStat.waitForExist({ timeout: 10000 });
  await tagsStat.click();

  const panel = await app.browser.$(".stat-detail-panel");
  await panel.waitForExist({ timeout: 5000 });
  const panelText = await panel.getText();
  console.log("reports tag panel:", panelText);
  if (!panelText.includes("vacation")) throw new Error(`expected panel to mention "vacation", got "${panelText}"`);

  console.log("FEATURE 5 E2E TEST PASSED");
} finally {
  await app.close();
}
