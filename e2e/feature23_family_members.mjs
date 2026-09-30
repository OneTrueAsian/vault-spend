// E2E smoke test for family member attribution: creates a family member
// through the management dialog, assigns it to a transaction from the
// Ledger and to an account from Reports, confirms the Ledger's member
// filter dropdown actually filters, and confirms Reports' "Spending by
// Member" and "Net Worth by Member" sections pick both up.
//
// Run with: node e2e/feature23_family_members.mjs

import { launchApp, reclaimWindowFocus, chooseMenuOption } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
recent = (datetime.date.today() - datetime.timedelta(days=3)).isoformat()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, recent, "Grocery Run", "-50.00", "Groceries", f"{checking_id}|{recent}|grocery run|-50.00"),
)
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  // Create a family member through the management dialog — it lives
  // behind the toolbar's "More" menu now (Phase 3 decluttering).
  const moreMenuToggle = await app.browser.$(".more-menu button");
  await moreMenuToggle.waitForExist({ timeout: 10000 });
  await moreMenuToggle.click();
  const manageButton = await app.browser.$("button*=Manage family members");
  await manageButton.waitForExist({ timeout: 10000 });
  await manageButton.click();

  const modalPanel = await app.browser.$(".modal-panel");
  await modalPanel.waitForExist({ timeout: 5000 });
  const nameInput = await modalPanel.$(".category-create-form input");
  await nameInput.setValue("Alex");
  const addButton = await modalPanel.$("button=Add");
  await addButton.click();

  const memberRow = await modalPanel.$("//span[contains(@class,'category-manage-name')][text()='Alex']");
  await memberRow.waitForExist({ timeout: 5000 });
  console.log("family member created: Alex");

  const doneButton = await modalPanel.$("button=Done");
  await doneButton.click();

  // Assign the seeded transaction to Alex from the Ledger row. The row's
  // account/member/category editors are a RowFieldDropdown popover now,
  // not a native <select> — and at this window's default width (800px,
  // the app's own launch default) the ledger is in its narrow layout, so
  // Member sits behind the row's "Details" toggle rather than its own
  // column.
  const groceryRow = await app.browser.$("//tr[td[contains(.,'Grocery Run')]]");
  const detailsToggle = await groceryRow.$("button=Details");
  await detailsToggle.waitForExist({ timeout: 10000 });
  await detailsToggle.click();
  const detailsPanel = await app.browser.$(".ledger-details-row");
  await detailsPanel.waitForExist({ timeout: 5000 });
  // The popover is dismissed by outside-click/blur by design; under
  // parallel load another spec's window can steal OS focus at any point
  // between opening it and the click landing, closing it before the
  // assignment takes (see e2e/README's "Another spec's window takes OS
  // focus" and feature112_inbox_bulk_review.mjs's own retry loop for the
  // identical class of race on a sibling popover) — retry the whole
  // open-click-verify sequence, not just the open, since the menu can
  // close at any step under heavy load.
  let assigned = false;
  for (let attempt = 0; attempt < 4 && !assigned; attempt++) {
    await reclaimWindowFocus(app.browser);
    const memberTrigger = await (await app.browser.$(".ledger-details-row")).$("[aria-label*='Family member for']");
    await memberTrigger.click();
    const alexOption = await app.browser.$("//button[@role='menuitemradio'][.//span[normalize-space()='Alex']]");
    if (!(await alexOption.isExisting())) continue;
    await alexOption.click().catch(() => {});
    assigned = await app.browser
      .waitUntil(async () => (await (await app.browser.$(".ledger-details-row")).getText()).includes("Alex"), { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!assigned) throw new Error("expected the ledger row's member editor to hold Alex after assignment, even after retrying the popover interaction");
  console.log("transaction assigned to Alex");

  // The member filter dropdown should now offer Alex, and unchecking her
  // should hide the transaction.
  const filterToggle = await app.browser.$("button*=All members");
  await filterToggle.waitForExist({ timeout: 5000 });
  await filterToggle.click();

  const alexCheckbox = await app.browser.$(
    "//label[contains(@class,'account-filter-option')][contains(.,'Alex')]/input[@type='checkbox']",
  );
  await alexCheckbox.waitForExist({ timeout: 5000 });
  await alexCheckbox.click();

  const ledgerPage = await app.browser.$(".page");
  await app.browser.waitUntil(async () => !(await ledgerPage.getText()).includes("Grocery Run"), {
    timeout: 10000,
    timeoutMsg: "expected Grocery Run to disappear once Alex is unchecked in the member filter",
  });
  console.log("member filter hides Alex's transaction once unchecked");

  // Re-check Alex so the transaction is visible again for the rest of the run.
  await alexCheckbox.click();
  await app.browser.waitUntil(async () => (await ledgerPage.getText()).includes("Grocery Run"), {
    timeout: 10000,
    timeoutMsg: "expected Grocery Run to reappear once Alex is re-checked",
  });

  // Accounts: assign the Checking account to Alex too, then confirm both
  // breakdowns reflect it (spending-by-member still lives on Reports).
  const accountsNav = await app.browser.$("button*=Accounts");
  await accountsNav.click();

  // Member assignment lives in the account's Edit dialog now (it used to be
  // an always-visible dropdown on every card).
  const editButton = await app.browser.$("//div[contains(@class,'account-card')]//button[normalize-space()='Edit']");
  await editButton.waitForExist({ timeout: 10000 });
  await editButton.click();
  const editDialog = await app.browser.$("[role='dialog']");
  await editDialog.waitForExist({ timeout: 10000 });
  const accountMemberSelect = await editDialog.$("//label[contains(.,'Family member')]//button[contains(@class,'menu-select-toggle')]");
  await accountMemberSelect.waitForExist({ timeout: 10000 });
  await chooseMenuOption(accountMemberSelect, { label: "Alex" });
  await (await editDialog.$("button=Save changes")).click();
  await app.browser.waitUntil(async () => (await (await app.browser.$(".account-card")).getText()).includes("Alex"), {
    timeout: 10000,
    timeoutMsg: "expected the Checking account card to show Alex after assignment",
  });
  console.log("Checking account assigned to Alex");

  const reportsNav = await app.browser.$("button*=Reports");
  await reportsNav.click();

  const membersTable = await app.browser.$("[data-report-members]");
  await membersTable.waitForExist({ timeout: 10000 });
  await app.browser.waitUntil(async () => (await membersTable.getText()).includes("Alex"), {
    timeout: 10000,
    timeoutMsg: "expected the by-member table to list Alex",
  });
  const panelText = await membersTable.getText();
  console.log("reports spending-by-member table:", panelText.replace(/\s+/g, " "));
  if (!panelText.includes("Alex") || !panelText.includes("50.00")) {
    throw new Error(`expected the table to show Alex with $50.00, got:\n${panelText}`);
  }

  // The heading now sits inside its own .card-head row (alongside a "Pin
  // to Dashboard" button), one level deeper than it used to — go up to the
  // div that also contains the table, not just the card-head row itself.
  const netWorthSection = await app.browser.$("//div[div/h2[contains(.,'Net Worth by Member')]]");
  await netWorthSection.waitForExist({ timeout: 5000 });
  const netWorthText = await netWorthSection.getText();
  console.log("net worth by member section:", netWorthText);
  if (!netWorthText.includes("Alex")) {
    throw new Error(`expected the Net Worth by Member section to list Alex, got:\n${netWorthText}`);
  }

  console.log("FEATURE 23 E2E TEST PASSED");
} finally {
  await app.close();
}
