// E2E test for Phase 2 item 10 (Reports hub rebuild):
//   - one date range (presets) drives the whole page: summary tiles, a
//     category-by-month table with row/column totals, a year-by-year summary,
//     and spending by member and by tag;
//   - changing the range changes the numbers;
//   - Property & Valuables no longer lives here (it's on Accounts), and neither
//     do the setup import/export buttons (they're in Settings).
//
// Run with: node e2e/feature81_reports_hub.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()

def month_start(back):
    total = today.year * 12 + today.month - 1 - back
    y, m = divmod(total, 12)
    return datetime.date(y, m + 1, 1)

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid
cur.execute("INSERT INTO family_members (name) VALUES ('Alex')")
alex = cur.lastrowid

def tx(back, day, desc, amount, category, member=None, tag=None):
    d = (month_start(back) + datetime.timedelta(days=day)).isoformat()
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, member_id, fingerprint) VALUES (?,?,?,?,?,?,?,?)",
                (acct, d, desc, amount, category, "user", member, f"{acct}|{d}|{desc.lower()}|{amount}"))
    if tag:
        cur.execute("INSERT INTO transaction_tags (transaction_id, tag) VALUES (?, ?)", (cur.lastrowid, tag))

# Two months back, last month and this month (the 'last 6 months' preset shows all three).
for back, groceries in ((2, "-300.00"), (1, "-450.00"), (0, "-200.00")):
    tx(back, 1, "Paycheck", "3000.00", "Income")
    tx(back, 2, "Landlord", "-1200.00", "Rent")
    tx(back, 5, "Grocers", groceries, "Groceries", member=alex if back == 1 else None, tag="holiday" if back == 1 else None)
tx(1, 8, "Ferry Cafe", "-100.00", "Dining Out")
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
async function cellText(selector) {
  return (await (await browser.$(selector)).getText()).trim();
}
async function waitForTable() {
  await browser.waitUntil(async () => (await browser.$$("[data-report-category]")).length > 0, { timeout: 10000, timeoutMsg: "the category table never filled in" });
}

try {
  await browser.setWindowSize(1440, 1400);
  await nav("Reports");
  await browser.$("[data-reports-hub]").waitForExist({ timeout: 10000 });

  // Removed from Reports: property, goals overview, setup import/export.
  const pageText = await (await browser.$("[data-reports-hub]")).getText();
  for (const gone of ["Property & Valuables", "Goals overview", "Download setup template", "Import setup data"]) {
    if (pageText.includes(gone)) throw new Error(`"${gone}" should no longer be on Reports`);
  }

  // --- last 6 months (the default) -------------------------------------------------
  await waitForTable();
  // Income 3 x 3000 = 9000. Spending: rent 3600 + groceries 950 + dining 100 = 4650.
  await browser.waitUntil(async () => (await cellText("[data-summary-income]")) === "$9,000.00", { timeout: 10000, timeoutMsg: "income should total $9,000.00" });
  if ((await cellText("[data-summary-spending]")) !== "$4,650.00") throw new Error(`spending should be $4,650.00, got ${await cellText("[data-summary-spending]")}`);
  if ((await cellText("[data-summary-net]")) !== "$4,350.00") throw new Error("net should be $4,350.00");
  if ((await cellText("[data-summary-rate]")) !== "48%") throw new Error(`savings rate should be 48%, got ${await cellText("[data-summary-rate]")}`);

  // The table: categories biggest first, with totals that add up.
  const categories = await browser.execute(() => [...document.querySelectorAll("[data-report-category]")].map((r) => r.getAttribute("data-report-category")));
  console.log("categories:", categories);
  if (categories.join(",") !== "Rent,Groceries,Dining Out") throw new Error(`categories should run Rent, Groceries, Dining Out, got ${categories}`);
  const rentTotal = await (await browser.$("[data-report-category='Rent'] [data-category-total]")).getText();
  const groceriesTotal = await (await browser.$("[data-report-category='Groceries'] [data-category-total]")).getText();
  if (rentTotal !== "$3,600.00" || groceriesTotal !== "$950.00") throw new Error(`row totals off: Rent ${rentTotal}, Groceries ${groceriesTotal}`);
  if ((await cellText("[data-grand-total]")) !== "$4,650.00") throw new Error("the grand total should match the summary's spending");

  // Year by year: one row for this year (or two across New Year).
  const years = await browser.$$("[data-report-year]");
  if (years.length < 1) throw new Error("the year-by-year table should have a row");

  // By member and by tag (last month's groceries carried both).
  const member = await browser.$("[data-report-members] [data-breakdown-row='Alex']");
  await member.waitForExist({ timeout: 5000, timeoutMsg: "Alex should appear under spending by member" });
  if (!(await member.getText()).includes("$450.00")) throw new Error(`Alex spent $450.00: ${await member.getText()}`);
  const tag = await browser.$("[data-report-tags] [data-breakdown-row='holiday']");
  await tag.waitForExist({ timeout: 5000, timeoutMsg: "the holiday tag should appear under spending by tag" });
  if (!(await tag.getText()).includes("$450.00")) throw new Error(`holiday tag: $450.00: ${await tag.getText()}`);

  // --- last month only ---------------------------------------------------------------
  await (await browser.$("[data-range-preset='last_month']")).click();
  await browser.waitUntil(async () => (await cellText("[data-summary-spending]")) === "$1,750.00", {
    timeout: 10000,
    timeoutMsg: `last month's spending should be $1,750.00 (1200 rent + 450 groceries + 100 dining), got ${await cellText("[data-summary-spending]")}`,
  });
  if ((await cellText("[data-summary-income]")) !== "$3,000.00") throw new Error("last month's income is $3,000.00");
  const monthColumns = await browser.$$("[data-report-table] thead th");
  if (monthColumns.length !== 3) throw new Error(`one month should give Category + 1 month + Total = 3 columns, got ${monthColumns.length}`);

  // --- year to date is at least as wide -----------------------------------------------
  await (await browser.$("[data-range-preset='year_to_date']")).click();
  await browser.waitUntil(async () => (await browser.$("[data-reports-hub]").getAttribute("data-report-range")).includes(".."), { timeout: 5000 });
  await browser.pause(400);

  // --- the sections that moved ---------------------------------------------------------
  await nav("Accounts");
  await browser.$("button*=Add property or valuable").waitForExist({ timeout: 10000, timeoutMsg: "Property & Valuables should be on Accounts now" });
  await nav("Settings");
  await browser.$("[data-setup-data]").waitForExist({ timeout: 10000, timeoutMsg: "the setup import/export buttons should be in Settings" });

  console.log("FEATURE 81 E2E TEST PASSED");
} finally {
  await app.close();
}
