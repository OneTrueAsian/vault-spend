// E2E test for Phase 1 item 7a:
//   - a line under the Budget summary says how much of the month's budgeted
//     income no expense line has claimed yet ("unallocated"), or that the
//     expenses are budgeted past income ("over");
//   - on the CURRENT month only, each expense progress bar carries a tick
//     marking how far through the month today is.
//
// Run with: node e2e/feature62_budget_allocation_and_pace.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
this_period = today.strftime("%Y-%m")
prev_last_day = today.replace(day=1) - datetime.timedelta(days=1)
prev_period = prev_last_day.strftime("%Y-%m")

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")

def budget(period, rows):
    cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", (period,))
    for category, amount, group in rows:
        cur.execute("INSERT OR REPLACE INTO budgets (category, period, monthly_amount, budget_group) VALUES (?, ?, ?, ?)", (category, period, amount, group))

# Current month: $6,000 income, $4,000 of expenses -> $2,000 unallocated.
budget(this_period, [("Income", "6000.00", "income"), ("Rent", "3000.00", "fixed"), ("Groceries", "1000.00", "flexible")])
# Previous month: expenses past income -> over-allocated by $500.
budget(prev_period, [("Income", "3000.00", "income"), ("Rent", "3500.00", "fixed")])
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
try {
  await browser.setWindowSize(1440, 1000);
  await nav("Budget");

  const line = await browser.$("[data-allocation]");
  await line.waitForExist({ timeout: 10000 });
  const status = await line.getAttribute("data-allocation");
  const text = await line.getText();
  console.log("current month allocation:", status, "-", text);
  if (status !== "unallocated" || !text.includes("$2,000.00") || !text.includes("$6,000.00")) {
    throw new Error(`expected "$2,000.00 of your $6,000.00 ... isn't assigned", got (${status}): ${text}`);
  }

  // The pace tick: one per expense group card + one per expense row (Rent, Groceries).
  const markers = await browser.execute(() =>
    [...document.querySelectorAll(".progress-pace")].map((m) => parseFloat(m.style.left)),
  );
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const expected = (now.getDate() / daysInMonth) * 100;
  console.log("pace markers at:", markers, "expected ~", expected.toFixed(2));
  if (markers.length < 2) throw new Error(`expected pace markers on the expense bars, found ${markers.length}`);
  if (markers.some((left) => Math.abs(left - expected) > 0.5)) {
    throw new Error(`pace markers should sit at ~${expected.toFixed(2)}%, got ${JSON.stringify(markers)}`);
  }
  // No marker may sit on the Income row's bar.
  const incomeRowMarkers = await browser.execute(() => {
    const rows = [...document.querySelectorAll(".cat-row")];
    const incomeRow = rows.find((r) => r.querySelector(".category-link")?.textContent.trim() === "Income");
    return incomeRow ? incomeRow.querySelectorAll(".progress-pace").length : -1;
  });
  if (incomeRowMarkers !== 0) throw new Error(`the Income bar must not carry a pace marker (found ${incomeRowMarkers})`);

  // Previous month: a finished month has no "so far", and shows the over-allocation.
  await (await browser.$("button[aria-label='Previous month']")).click();
  await browser.waitUntil(async () => (await (await browser.$("[data-allocation]")).getAttribute("data-allocation")) === "over", {
    timeout: 10000,
    timeoutMsg: "the previous month should read as over-allocated",
  });
  const prevText = await (await browser.$("[data-allocation]")).getText();
  if (!prevText.includes("$500.00")) throw new Error(`expected the $500.00 over-allocation, got: ${prevText}`);
  const prevMarkers = await browser.execute(() => document.querySelectorAll(".progress-pace").length);
  if (prevMarkers !== 0) throw new Error(`a past month must not show a pace marker, found ${prevMarkers}`);

  console.log("FEATURE 62 E2E TEST PASSED");
} finally {
  await app.close();
}
