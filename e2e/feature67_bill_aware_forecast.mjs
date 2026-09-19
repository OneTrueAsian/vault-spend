// E2E test for Phase 1 item 5 — bill-aware forecast + "Safe to spend".
//   - Dashboard: a "Safe to spend" card = cash minus the recurring bills due
//     before the next paycheck, counting down to that paycheck; an optional
//     buffer comes off the top.
//   - Cash Flow > Forecast: puts each recurring bill/paycheck on its due date,
//     calls out the lowest balance, and lists what's coming up.
//
// Run with: node e2e/feature67_bill_aware_forecast.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
def in_days(n): return (today + datetime.timedelta(days=n)).isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '3000.00')")
acct = cur.lastrowid

def recurring(merchant, amount, cadence, days_out):
    cur.execute(
        "INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id) VALUES (?, NULL, ?, ?, ?, ?)",
        (merchant, amount, cadence, in_days(days_out), acct),
    )

# Two bills before payday (day 9), one after.
recurring("Geico Auto", "-175.00", "monthly", 2)
recurring("Netflix", "-15.49", "monthly", 4)
recurring("Payroll Deposit", "2000.00", "biweekly", 9)
recurring("Union Realty", "-1850.00", "monthly", 10)
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

  // ---- Dashboard: Safe to spend
  await nav("Dashboard");
  const card = await browser.$(".safe-to-spend-card");
  await card.waitForExist({ timeout: 15000 });
  await browser.waitUntil(async () => (await card.getAttribute("data-safe-to-spend")) === "positive", { timeout: 15000, timeoutMsg: "expected a positive safe-to-spend figure" });
  const text = await card.getText();
  console.log("safe to spend:", text.replace(/\n/g, " | "));
  // 3000 - 175 - 15.49 = 2809.51, counting down to Payroll Deposit in 9 days.
  for (const expected of ["$2,809.51", "Payroll Deposit", "(9 days)", "2 bills"]) {
    if (!text.includes(expected)) throw new Error(`expected the card to mention "${expected}", got:\n${text}`);
  }
  if (text.includes("1,850")) throw new Error("the rent due AFTER payday must not be subtracted");

  // A buffer comes off the top.
  await (await card.$("input[aria-label='Buffer to keep']")).setValue("500");
  await browser.waitUntil(async () => (await card.getText()).includes("$2,309.51"), { timeout: 10000, timeoutMsg: "a $500 buffer should leave $2,309.51" });

  // ---- Cash Flow > Forecast
  await nav("Cash Flow");
  await (await browser.$("button=Forecast")).click();
  const lowest = await browser.$("[data-forecast-lowest]");
  await lowest.waitForExist({ timeout: 15000 });
  const lowestText = await lowest.getText();
  console.log("lowest:", lowestText);
  // Balance bottoms out just before payday: 3000 - 175 - 15.49.
  if (!lowestText.includes("$2,809.51")) throw new Error(`expected the low point to be $2,809.51, got: ${lowestText}`);

  const upcoming = await browser.$(".forecast-events");
  await upcoming.waitForExist({ timeout: 10000 });
  const upcomingText = await upcoming.getText();
  for (const expected of ["Geico Auto", "Netflix", "Payroll Deposit", "Union Realty"]) {
    if (!upcomingText.includes(expected)) throw new Error(`expected "${expected}" in Coming up, got:\n${upcomingText}`);
  }
  const chart = await browser.$("polyline");
  await chart.waitForExist({ timeout: 10000 });

  console.log("FEATURE 67 E2E TEST PASSED");
} finally {
  await app.close();
}
