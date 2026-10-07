// E2E smoke test for tags: seeds one transaction, adds a tag via the real
// Ledger UI, confirms the pill renders and the Ledger's tag filter picks it
// up, then checks Reports shows it in its "Spending by tag" table.
//
// Run with: node e2e/feature5_tags.mjs

import { chooseRowAction, launchApp, menuOptionLabels, withFocusRetry } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
recent = (datetime.date.today() - datetime.timedelta(days=3)).isoformat()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, recent, "Target", "-100.00", "Groceries", f"{checking_id}|{recent}|target|-100.00"),
)
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  // "Add tag…" in the row's ⋯ menu opens the tag field (focused); Enter adds the tag.
  const rowMenu = await app.browser.$("tr[data-payment-row] [data-row-menu]");
  await rowMenu.waitForExist({ timeout: 10000 });
  const pill = await app.browser.$(".tag-pill");
  await withFocusRetry(app.browser, async () => {
    if (await pill.isExisting()) return; // an earlier attempt already added it
    await chooseRowAction(app.browser, "tr[data-payment-row] [data-row-menu]", "Add tag…");
    const tagInput = await app.browser.$(".tag-input");
    await tagInput.waitForExist({ timeout: 5000 });
    await tagInput.setValue("vacation");
    await app.browser.keys("Enter");
    await pill.waitForExist({ timeout: 10000 });
  });

  console.log("tag pill text:", await pill.getText());

  // The tag filter now lives behind the "More filters" popover (see
  // MoreFiltersPopover.tsx) rather than always being visible in the
  // toolbar — open it before its <option> exists in the DOM.
  const moreFiltersToggle = await app.browser.$("button*=More filters");
  await moreFiltersToggle.waitForExist({ timeout: 5000 });
  await moreFiltersToggle.click();

  const tagFilter = await app.browser.$("//label[.//span[text()='Tag']]//button[contains(@class,'menu-select-toggle')]");
  await tagFilter.waitForExist({ timeout: 5000 });
  const tagLabels = await menuOptionLabels(tagFilter);
  if (!tagLabels.includes("vacation")) throw new Error(`expected "vacation" among the tag filter's options, got: ${tagLabels.join(", ")}`);
  console.log("filter option found");

  const reportsNav = await app.browser.$("button*=Reports");
  await reportsNav.click();

  const tagsTable = await app.browser.$("[data-report-tags]");
  await tagsTable.waitForExist({ timeout: 10000 });
  await app.browser.waitUntil(async () => (await tagsTable.getText()).includes("vacation"), {
    timeout: 10000,
    timeoutMsg: "expected the by-tag table to list vacation",
  });
  const tagsText = await tagsTable.getText();
  console.log("reports tag table:", tagsText.replace(/\s+/g, " "));
  if (!tagsText.includes("$100.00")) throw new Error(`expected the vacation row to show $100.00, got "${tagsText}"`);

  console.log("FEATURE 5 E2E TEST PASSED");
} finally {
  await app.close();
}
