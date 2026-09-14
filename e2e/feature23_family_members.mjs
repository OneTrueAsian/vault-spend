// E2E smoke test for family member attribution: creates a family member
// through the management dialog, assigns it to a transaction from the
// Ledger and to an account from Reports, confirms the Ledger's member
// filter dropdown actually filters, and confirms Reports' "Spending by
// Member" and "Net Worth by Member" sections pick both up.
//
// Run with: node e2e/feature23_family_members.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "2026-08-05", "Grocery Run", "-50.00", "Groceries", f"{checking_id}|2026-08-05|grocery run|-50.00"),
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

  // Assign the seeded transaction to Alex from the Ledger row.
  const memberSelect = await app.browser.$(".member-col select");
  await memberSelect.waitForExist({ timeout: 10000 });
  await memberSelect.selectByVisibleText("Alex");

  await app.browser.waitUntil(async () => (await memberSelect.getValue()) !== "", {
    timeout: 10000,
    timeoutMsg: "expected the ledger row's member select to hold Alex's id after assignment",
  });
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

  const accountMemberSelect = await app.browser.$(".member-select");
  await accountMemberSelect.waitForExist({ timeout: 10000 });
  await accountMemberSelect.selectByVisibleText("Alex");
  await app.browser.waitUntil(async () => (await accountMemberSelect.getValue()) !== "", {
    timeout: 10000,
    timeoutMsg: "expected the Checking account's member select to hold Alex's id after assignment",
  });
  console.log("Checking account assigned to Alex");

  const reportsNav = await app.browser.$("button*=Reports");
  await reportsNav.click();

  const spendingStat = await app.browser.$("button*=Members with spending");
  await spendingStat.waitForExist({ timeout: 10000 });
  await spendingStat.click();

  const panel = await app.browser.$(".stat-detail-panel");
  await panel.waitForExist({ timeout: 5000 });
  const panelText = await panel.getText();
  console.log("reports spending-by-member panel:", panelText);
  if (!panelText.includes("Alex") || !panelText.includes("50.00")) {
    throw new Error(`expected the panel to show Alex with $50.00, got:\n${panelText}`);
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
