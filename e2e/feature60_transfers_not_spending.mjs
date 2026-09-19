// E2E test for Phase 1 item 1a: money moved between the household's own
// accounts (category "Transfer") was already excluded from income/expense
// totals, but still leaked into every other spend-shaped view — the
// Dashboard's "Spending by category" donut, Cash Flow's Top categories/Top
// merchants, and Recurring's "Suggested" list (a monthly savings transfer
// looked exactly like a bill).
//
// Run with: node e2e/feature60_transfers_not_spending.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Savings', 'savings', '0.00')")
savings_id = cur.lastrowid

def add(account_id, date, desc, amount, category, n):
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, ?, ?, ?, ?, 'user', ?)",
        (account_id, date.isoformat(), desc, amount, category, f"fp-{n}"),
    )

add(checking_id, today, "Green Leaf Grocers", "-80.00", "Groceries", 0)
add(checking_id, today, "Transfer to Savings", "-500.00", "Transfer", 1)
add(savings_id, today, "Transfer from Checking", "500.00", "Transfer", 2)

# Four monthly transfers on the same day of the month, same amount — enough
# of a pattern that Recurring would suggest it if it didn't know better.
first = today.replace(day=1)
for i in range(1, 5):
    month_start = first
    for _ in range(i):
        month_start = (month_start - datetime.timedelta(days=1)).replace(day=1)
    add(checking_id, month_start.replace(day=2), "Auto Savings Move", "-250.00", "Transfer", 10 + i)
`);

const app = await launchApp({ dbDir });
try {
  const dashboardNav = await app.browser.$("button*=Dashboard");
  await dashboardNav.click();

  const donutCard = await app.browser.$("//span[contains(.,'Spending by category')]/ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' card ')][1]");
  await donutCard.waitForExist({ timeout: 10000 });
  const donutText = await donutCard.getText();
  console.log("dashboard spending card:", donutText.replace(/\n/g, " | "));
  if (!donutText.includes("Groceries")) {
    throw new Error(`expected the real Groceries spend in the donut, got:\n${donutText}`);
  }
  if (donutText.includes("Transfer")) {
    throw new Error(`a Transfer must not appear as a spending category, got:\n${donutText}`);
  }

  const cashFlowNav = await app.browser.$("button*=Cash Flow");
  await cashFlowNav.click();
  const merchantsCard = await app.browser.$("//span[contains(.,'Top merchants')]/ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' card ')][1]");
  await merchantsCard.waitForExist({ timeout: 10000 });
  const merchantsText = await merchantsCard.getText();
  console.log("cash flow top merchants:", merchantsText.replace(/\n/g, " | "));
  if (!merchantsText.includes("Green Leaf Grocers")) {
    throw new Error(`expected the real merchant in Top merchants, got:\n${merchantsText}`);
  }
  if (merchantsText.includes("Transfer to Savings")) {
    throw new Error(`a transfer must not rank as a merchant, got:\n${merchantsText}`);
  }
  const categoriesCard = await app.browser.$("//span[contains(.,'Top categories')]/ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' card ')][1]");
  const categoriesText = await categoriesCard.getText();
  if (categoriesText.includes("Transfer")) {
    throw new Error(`a Transfer must not appear in Top categories, got:\n${categoriesText}`);
  }

  const recurringNav = await app.browser.$("button*=Recurring");
  await recurringNav.click();
  const pageText = await (await app.browser.$(".main")).getText();
  if (pageText.includes("Auto Savings Move")) {
    throw new Error(`a repeating transfer must not be suggested as a recurring bill, got:\n${pageText}`);
  }

  console.log("FEATURE 60 E2E TEST PASSED");
} finally {
  await app.close();
}
