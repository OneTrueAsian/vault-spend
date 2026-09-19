// E2E test for Phase 2 item 9 (month-end review):
//   - Budget -> "Month-end review" opens a four-step review of the month being
//     viewed: how it went (against the month before), what went over budget,
//     what is still uncategorized, and which goals need feeding;
//   - "Categorize them now" lands on Transactions filtered to that month's
//     uncategorized rows;
//   - "Finish review" is remembered.
// (The Dashboard's "Review <month>" offer only shows in the first two weeks
// of a month, so its date logic is covered by vitest, not here.)
//
// Run with: node e2e/feature75_month_end_review.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime, calendar
today = datetime.date.today()

def month_start(back):
    total = today.year * 12 + today.month - 1 - back
    y, m = divmod(total, 12)
    return datetime.date(y, m + 1, 1)

def add_months(d, n):
    total = d.year * 12 + d.month - 1 + n
    y, m = divmod(total, 12)
    m += 1
    return datetime.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid

def tx(back, day, desc, amount, category):
    d = (month_start(back) + datetime.timedelta(days=day)).isoformat()
    fp = f"{acct}|{d}|{desc.lower()}|{amount}"
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, amount, category, "user" if category else None, fp))

# Two months back: income 2800, spending 1500.
tx(2, 4, "Paycheck", "2800.00", "Income")
tx(2, 5, "Landlord", "-1200.00", "Rent")
tx(2, 9, "Kroger", "-300.00", "Groceries")

# Last month: income 3000, spending 1975 (1200 + 450 + 260 + 40 + 25); two rows uncategorized.
tx(1, 4, "Paycheck", "3000.00", "Income")
tx(1, 5, "Landlord", "-1200.00", "Rent")
tx(1, 9, "Kroger", "-450.00", "Groceries")
tx(1, 12, "Ferry Cafe", "-260.00", "Dining Out")
tx(1, 14, "Mystery Vendor", "-40.00", None)
tx(1, 16, "PayPal", "-25.00", None)

period = month_start(1).strftime("%Y-%m")
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", (period,))
for category, amount, group in (("Income", "3000.00", "income"), ("Rent", "1200.00", "fixed"), ("Groceries", "400.00", "flexible"), ("Dining Out", "100.00", "flexible")):
    cur.execute("INSERT OR REPLACE INTO budgets (category, period, monthly_amount, budget_group) VALUES (?, ?, ?, ?)", (category, period, amount, group))

# One goal that is behind: $200 of $2,000 by a date three months out, nothing saved lately.
cur.execute("INSERT INTO buckets (name, target_amount, target_date) VALUES ('Trip Fund', '2000.00', ?)", (add_months(today, 3).isoformat(),))
trip = cur.lastrowid
cur.execute("INSERT INTO bucket_contributions (bucket_id, date, amount) VALUES (?,?,?)", (trip, (today - datetime.timedelta(days=200)).isoformat(), "200.00"))
`);

const now = new Date();
const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const lastName = last.toLocaleDateString("en-US", { month: "long" });

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
async function stepText(step) {
  const body = await browser.$(`[data-review-step='${step}']`);
  await body.waitForExist({ timeout: 10000, timeoutMsg: `review step ${step} never appeared` });
  await browser.waitUntil(async () => (await body.getText()).trim() !== "", { timeout: 5000 });
  return body.getText();
}
async function next() {
  await (await browser.$("[data-review-next]")).click();
}
async function openReview() {
  await (await browser.$("//button[normalize-space()='Month-end review']")).click();
  await browser.$(`//div[@role='dialog']//h2[normalize-space()='${lastName} review']`).waitForExist({ timeout: 10000, timeoutMsg: `the ${lastName} review should open` });
}

try {
  await browser.setWindowSize(1440, 1200);
  await nav("Budget");
  await (await browser.$("button[aria-label='Previous month']")).click();
  await browser.pause(500);
  await openReview();

  // --- 1. how it went ------------------------------------------------------
  const summary = await stepText("summary");
  console.log("summary:", summary.replace(/\s+/g, " "));
  for (const expected of ["$3,000.00", "up $200.00 from the month before", "$1,975.00", "up $475.00 from the month before", "$1,025.00", "34% of income"]) {
    if (!summary.includes(expected)) throw new Error(`the summary should say "${expected}":\n${summary}`);
  }

  // --- 2. over budget --------------------------------------------------------
  await next();
  const over = await stepText("over_budget");
  console.log("over budget:", over.replace(/\s+/g, " "));
  if (!over.includes("2 categories spent more than budgeted")) throw new Error(`expected two over-budget categories:\n${over}`);
  if (!(await browser.$("[data-review-over='Dining Out']").isExisting()) || !(await browser.$("[data-review-over='Groceries']").isExisting())) {
    throw new Error("Dining Out and Groceries should both be listed");
  }
  if (await browser.$("[data-review-over='Rent']").isExisting()) throw new Error("Rent was on budget, so it must not be listed");
  if (!over.includes("$160.00 over") || !over.includes("$50.00 over")) throw new Error(`the overages should be spelled out:\n${over}`);

  // --- 3. uncategorized -------------------------------------------------------
  await next();
  const uncategorized = await stepText("uncategorized");
  if (!uncategorized.includes("2 transactions") || !uncategorized.includes("$65.00")) throw new Error(`expected 2 uncategorized totalling $65.00:\n${uncategorized}`);
  await (await browser.$("[data-review-categorize]")).click();

  // Landed on Transactions, filtered to last month's uncategorized rows.
  await browser.$("//h1[normalize-space()='Transactions']").waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => (await browser.$(".ledger").getText()).includes("Mystery Vendor"), { timeout: 10000, timeoutMsg: "Mystery Vendor should be listed" });
  const ledger = await browser.$(".ledger").getText();
  if (!ledger.includes("PayPal")) throw new Error(`PayPal should be listed:\n${ledger}`);
  if (ledger.includes("Kroger") || ledger.includes("Landlord")) throw new Error(`only the uncategorized rows should be listed:\n${ledger}`);

  // --- 4. goals + finish ------------------------------------------------------
  await nav("Budget");
  await browser.pause(500);
  await openReview();
  await next();
  await next();
  await next();
  const goals = await stepText("goals");
  console.log("goals:", goals.replace(/\s+/g, " "));
  if (!(await browser.$("[data-review-goal='Trip Fund']").isExisting())) throw new Error(`Trip Fund should be listed as needing a boost:\n${goals}`);
  if (!goals.includes("needs $600/mo")) throw new Error(`Trip Fund needs $600/mo ($1,800 over 3 months):\n${goals}`);

  await (await browser.$("[data-review-finish]")).click();
  await browser.waitUntil(async () => !(await browser.$("div[role='dialog']").isExisting()), { timeout: 10000, timeoutMsg: "Finish should close the review" });
  await browser.waitUntil(async () => new RegExp(`${lastName} review finished`).test(await (await browser.$(".status")).getText()), {
    timeout: 10000,
    timeoutMsg: "a confirmation should say the review is finished",
  });

  // Remembered: reopening says so.
  await openReview();
  const again = await stepText("summary");
  if (!again.includes("You finished this review before")) throw new Error(`a finished review should say so:\n${again}`);

  console.log("FEATURE 75 E2E TEST PASSED");
} finally {
  await app.close();
}
