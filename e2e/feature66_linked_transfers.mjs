// E2E test for Phase 1 item 1b — linked transfers.
//   - Two equal-and-opposite transactions in different accounts a few days
//     apart are suggested ("N possible transfers — review") and can be linked
//     from a review dialog.
//   - A linked pair shows as ONE row ("A → B") in Transactions and stops
//     counting as spending/income everywhere, even under an ordinary category.
//   - Two rows too far apart to be suggested can be linked by hand
//     (tick both -> "Link as transfer"), and any pair can be unlinked.
//
// Run with: node e2e/feature66_linked_transfers.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
def days_ago(n): return (today - datetime.timedelta(days=n)).isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '5000.00')")
checking = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('High-Yield Savings', 'savings', '1000.00')")
savings = cur.lastrowid

def add(account_id, date, desc, amount, category, n):
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, ?, ?, ?, ?, 'user', ?)",
        (account_id, date, desc, amount, category, f"fp-{n}"),
    )

add(checking, days_ago(0), "Green Leaf Grocers", "-80.00", "Groceries", 1)
add(checking, days_ago(0), "Payroll Deposit", "3000.00", "Income", 2)
# Pair A: same day. Pair B: two days apart. Both under an ORDINARY category —
# only the link can make them stop counting as spending.
add(checking, days_ago(0), "Move to savings", "-500.00", "Savings Goal", 3)
add(savings, days_ago(0), "Deposit from checking", "500.00", "Savings Goal", 4)
add(checking, days_ago(2), "Sent to brother", "-75.00", "Gifts", 5)
add(savings, days_ago(0), "Brother paid me back", "75.00", "Gifts", 6)
# Pair C: ten days apart — never suggested, linked by hand.
add(checking, days_ago(12), "Rent Share", "-300.00", "Rent", 7)
add(savings, days_ago(2), "Roommate deposit", "300.00", "Rent", 8)
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  const buttons = await browser.$$("nav button");
  for (const b of buttons) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
const transferRows = () => browser.$$("tr.ledger-row-transfer");
const dataRows = () => browser.$$("table.ledger tbody tr");
async function spendingCardText() {
  await nav("Dashboard");
  const card = await browser.$("//span[contains(.,'Spending by category')]/ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' card ')][1]");
  await card.waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => (await card.getText()).includes("Groceries"), { timeout: 10000 });
  return card.getText();
}
try {
  await browser.setWindowSize(1440, 1000);

  // Before linking, the "transfers" are $575 of ordinary spending.
  const before = await spendingCardText();
  console.log("spending before:", before.replace(/\n/g, " | "));
  if (!before.includes("Savings Goal")) throw new Error(`expected the unlinked "Savings Goal" move to count as spending, got:\n${before}`);

  // Suggest + review + link.
  await nav("Transactions");
  await (await browser.$("table.ledger")).waitForExist({ timeout: 10000 });
  const chip = await browser.$("button.transfer-suggestion");
  await chip.waitForExist({ timeout: 10000 });
  const chipText = await chip.getText();
  console.log("suggestion:", chipText);
  if (!chipText.includes("2 possible transfers")) throw new Error(`expected 2 suggested transfers (A and B, not the far-apart C), got: ${chipText}`);
  await chip.click();
  const dialog = await browser.$("[role='dialog']");
  await dialog.waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => /Possible transfers/.test(await dialog.getText()), { timeout: 10000 });
  const dialogText = await dialog.getText();
  if (!dialogText.includes("Everyday Checking → High-Yield Savings")) throw new Error(`expected the pair described as A → B, got:\n${dialogText}`);
  await (await dialog.$("button*=Link 2 as transfers")).click();

  await browser.waitUntil(async () => (await transferRows()).length === 2, { timeout: 10000, timeoutMsg: "two merged transfer rows expected" });
  // 2 merged + Groceries + Payroll + Rent Share + Roommate deposit = 6 rows (not 8).
  const rowCount = (await dataRows()).length;
  if (rowCount !== 6) throw new Error(`expected 6 rows (each transfer shown once), got ${rowCount}`);
  const tableText = await (await browser.$("table.ledger")).getText();
  if (tableText.includes("Deposit from checking")) throw new Error("the incoming leg should not be its own row");
  if ((await browser.$$("button.transfer-suggestion")).length !== 0) throw new Error("no suggestion should remain once both are linked");

  // Totals: the linked moves no longer count as spending.
  const after = await spendingCardText();
  console.log("spending after:", after.replace(/\n/g, " | "));
  if (after.includes("Savings Goal") || after.includes("Gifts")) throw new Error(`linked transfers must not count as spending, got:\n${after}`);

  // Manual link for the far-apart pair.
  await nav("Transactions");
  await (await browser.$("table.ledger")).waitForExist({ timeout: 10000 });
  for (const desc of ["Rent Share", "Roommate deposit"]) {
    const box = await browser.$(`//tr[td[contains(.,'${desc}')]]//input[@type='checkbox']`);
    await box.waitForExist({ timeout: 10000 });
    await box.click();
  }
  const linkBtn = await browser.$("button=Link as transfer");
  await linkBtn.waitForExist({ timeout: 10000 });
  await linkBtn.click();
  await browser.waitUntil(async () => (await transferRows()).length === 3, { timeout: 10000, timeoutMsg: "the hand-linked pair should now be a third merged row" });

  // Unlink one.
  const rentRow = await browser.$("//tr[contains(@class,'ledger-row-transfer')][td[contains(.,'Rent Share')]]");
  await (await rentRow.$("button=Unlink")).click();
  await browser.waitUntil(async () => (await transferRows()).length === 2, { timeout: 10000, timeoutMsg: "unlinking should drop back to two merged rows" });
  const afterUnlink = await (await browser.$("table.ledger")).getText();
  if (!afterUnlink.includes("Roommate deposit")) throw new Error("after unlinking, the incoming leg should be its own row again");

  console.log("FEATURE 66 E2E TEST PASSED");
} finally {
  await app.close();
}
