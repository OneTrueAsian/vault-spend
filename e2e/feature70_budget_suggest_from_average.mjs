// E2E test for Phase 2 item 7b:
//   - Budget -> "Suggest from 3-month average" previews what each category
//     would be budgeted at if the month repeated the last three months;
//   - categories with no budget line yet start ticked, ones that already have
//     a line start unticked and show their current figure;
//   - applying sets exactly the ticked rows for the viewed month;
//   - a month with no earlier spending says so instead of listing anything.
//
// Run with: node e2e/feature70_budget_suggest_from_average.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()

def month_start(back):
    y, m = today.year, today.month - back
    while m <= 0:
        m += 12
        y -= 1
    return datetime.date(y, m, 1)

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid

def spend(back, day, desc, amount, category):
    d = (month_start(back) + datetime.timedelta(days=day)).isoformat()
    fp = f"{acct}|{d}|{desc.lower()}|-{amount}"
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, "-" + amount, category, "user", fp))

# Groceries 300 / 450 / 600 -> average 450. Dining Out 100 each month. Rent 1500 each month.
for back, groceries in ((3, "300.00"), (2, "450.00"), (1, "600.00")):
    spend(back, 8, f"Grocers {back}", groceries, "Groceries")
    spend(back, 10, f"Cafe {back}", "100.00", "Dining Out")
    spend(back, 1, f"Landlord {back}", "1500.00", "Rent")

# The current month already budgets Rent.
this_period = today.strftime("%Y-%m")
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", (this_period,))
cur.execute("INSERT OR REPLACE INTO budgets (category, period, monthly_amount, budget_group) VALUES ('Rent', ?, '1500.00', 'fixed')", (this_period,))
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
async function openSuggestions() {
  const button = await browser.$("//button[contains(normalize-space(.), 'Suggest from 3-month average')]");
  await button.waitForClickable({ timeout: 10000 });
  await button.click();
}
async function rowInfo(category) {
  const row = await browser.$(`label[data-suggest-row='${category}']`);
  await row.waitForExist({ timeout: 10000, timeoutMsg: `no suggestion row for ${category}` });
  // The dialog animates in: its text reads as empty for the first frames.
  await browser.waitUntil(async () => (await row.getText()).trim() !== "", { timeout: 5000, timeoutMsg: `suggestion row for ${category} never showed text` });
  return { checked: await (await row.$("input")).isSelected(), text: await row.getText() };
}
async function closeDialog() {
  const cancel = await browser.$("//div[@role='dialog']//button[contains(., 'Not now') or contains(., 'Close')]");
  await cancel.click();
  await browser.waitUntil(async () => !(await browser.$("div[role='dialog']").isExisting()), { timeout: 5000 });
}

try {
  await browser.setWindowSize(1440, 1000);
  await nav("Budget");
  await browser.$("//h1[normalize-space()='Budget']").waitForExist({ timeout: 10000 });

  await openSuggestions();
  const groceries = await rowInfo("Groceries");
  const dining = await rowInfo("Dining Out");
  const rent = await rowInfo("Rent");
  console.log("rows:", JSON.stringify({ groceries, dining, rent }));
  if (!groceries.checked || !dining.checked) throw new Error("categories with no budget yet should start ticked");
  if (rent.checked) throw new Error("a category that already has a budget line should start unticked");
  if (!groceries.text.includes("$450.00")) throw new Error(`Groceries should suggest $450.00, got: ${groceries.text}`);
  if (!dining.text.includes("$100.00")) throw new Error(`Dining Out should suggest $100.00, got: ${dining.text}`);
  if (!rent.text.includes("now $1,500.00")) throw new Error(`Rent should show its current budget, got: ${rent.text}`);

  // Untick Dining Out, then apply: only Groceries is added.
  await (await browser.$("label[data-suggest-row='Dining Out'] input")).click();
  const apply = await browser.$("//div[@role='dialog']//button[starts-with(normalize-space(.), 'Apply')]");
  const applyText = (await apply.getText()).trim();
  if (applyText !== "Apply 1 budget") throw new Error(`expected "Apply 1 budget", got "${applyText}"`);
  await apply.click();

  await browser.waitUntil(
    async () =>
      browser.execute(() =>
        [...document.querySelectorAll(".cat-row")].some(
          (r) => r.querySelector(".category-link")?.textContent.trim() === "Groceries" && r.textContent.includes("$450.00"),
        ),
      ),
    { timeout: 10000, timeoutMsg: "Groceries should appear as a $450.00 budget line" },
  );
  const hasDining = await browser.execute(() =>
    [...document.querySelectorAll(".cat-row")].some((r) => r.querySelector(".category-link")?.textContent.trim() === "Dining Out"),
  );
  if (hasDining) throw new Error("Dining Out was unticked, so it must not have been budgeted");

  // Re-open: Groceries now has a line (unticked, "now $450.00"); Dining Out is still on offer.
  await openSuggestions();
  const groceries2 = await rowInfo("Groceries");
  const dining2 = await rowInfo("Dining Out");
  if (groceries2.checked || !groceries2.text.includes("now $450.00")) {
    throw new Error(`Groceries should now show its budget and start unticked, got: ${JSON.stringify(groceries2)}`);
  }
  if (!dining2.checked) throw new Error("Dining Out should still start ticked");
  await closeDialog();

  // Four months back there is no earlier spending to average.
  const prev = await browser.$("button[aria-label='Previous month']");
  for (let i = 0; i < 4; i++) await prev.click();
  await browser.pause(600);
  await openSuggestions();
  const empty = await browser.$("[data-suggest-empty='no-history']");
  await empty.waitForExist({ timeout: 10000, timeoutMsg: "a month with no earlier spending should say so" });
  const rowsShown = await browser.$$("label[data-suggest-row]");
  if (rowsShown.length !== 0) throw new Error("no suggestion rows should be listed when there is no history");

  console.log("FEATURE 70 E2E TEST PASSED");
} finally {
  await app.close();
}
