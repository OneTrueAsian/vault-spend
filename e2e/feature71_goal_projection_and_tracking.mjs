// E2E test for Phase 2 items 8a and 8b:
//   - each goal card projects when the recent pace finishes it, says what it
//     would take to make its target date, and carries an On track / Behind badge;
//   - "+ Add" opens the contribution inputs on demand (they used to sit on
//     every card all the time);
//   - a goal linked to an account can follow that account's balance instead
//     of manual contributions, and can be switched back.
//
// Run with: node e2e/feature71_goal_projection_and_tracking.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime, calendar
today = datetime.date.today()

def add_months(d, n):
    y, m = d.year, d.month + n
    while m > 12:
        m -= 12
        y += 1
    return datetime.date(y, m, min(d.day, calendar.monthrange(y, m)[1]))

def ago(days):
    return (today - datetime.timedelta(days=days)).isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('High-Yield Savings', 'savings', '1000.00')")
savings = cur.lastrowid
for days, label in ((15, "Deposit A"), (50, "Deposit B")):
    d = ago(days)
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, fingerprint) VALUES (?,?,?,?,?)",
                (savings, d, label, "300.00", f"{savings}|{d}|{label.lower()}|300.00"))

def goal(name, target, deadline, account=None, tracks=0):
    cur.execute("INSERT INTO buckets (name, target_amount, target_date, account_id, tracks_account) VALUES (?,?,?,?,?)",
                (name, target, deadline, account, tracks))
    return cur.lastrowid

def contribute(bucket, days, amount):
    cur.execute("INSERT INTO bucket_contributions (bucket_id, date, amount) VALUES (?,?,?)", (bucket, ago(days), amount))

# $600 saved at $200/month toward $2,000 by a date a year out: on track, needs ~$117/mo.
trip = goal("Trip Fund", "2000.00", add_months(today, 12).isoformat())
contribute(trip, 10, "300.00")
contribute(trip, 40, "300.00")

# $300 saved at $100/month toward $1,500 in two months: behind, needs $600/mo.
laptop = goal("New Laptop", "1500.00", add_months(today, 2).isoformat())
contribute(laptop, 20, "300.00")

# Follows the savings account: $1,600 balance, $200/month pace, no deadline.
goal("Emergency Fund", "5000.00", None, savings, 1)

# No target at all: nothing to project.
goal("Someday", None, None)
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
const card = (name) => browser.$(`//div[contains(@class,'bucket-card')][.//h3[contains(normalize-space(.), '${name}')]]`);

try {
  await browser.setWindowSize(1440, 1100);
  await nav("Goals");
  await (await card("Trip Fund")).waitForExist({ timeout: 10000 });

  // --- 8a: projections -------------------------------------------------
  const trip = await card("Trip Fund");
  const tripPlan = await trip.$("[data-goal-status]");
  const tripText = await tripPlan.getText();
  console.log("Trip Fund plan:", tripPlan && (await tripPlan.getAttribute("data-goal-status")), "-", tripText);
  if ((await tripPlan.getAttribute("data-goal-status")) !== "on_track") throw new Error(`Trip Fund should be on track: ${tripText}`);
  if (!tripText.includes("On track") || !tripText.includes("At your recent pace:") || !tripText.includes("$117/mo")) {
    throw new Error(`Trip Fund plan text is off: ${tripText}`);
  }

  const laptop = await card("New Laptop");
  const laptopPlan = await laptop.$("[data-goal-status]");
  const laptopText = await laptopPlan.getText();
  console.log("New Laptop plan:", laptopText);
  if ((await laptopPlan.getAttribute("data-goal-status")) !== "behind" || !laptopText.includes("Behind") || !laptopText.includes("$600/mo")) {
    throw new Error(`New Laptop should be behind and need $600/mo: ${laptopText}`);
  }

  const someday = await card("Someday");
  if (await someday.$("[data-goal-status]").isExisting()) throw new Error("a goal with no target has nothing to project");

  // --- 8b: a goal that follows an account ------------------------------
  const emergency = await card("Emergency Fund");
  const emergencySaved = await (await emergency.$(".bucket-saved")).getText();
  console.log("Emergency Fund saved:", emergencySaved);
  if (!emergencySaved.includes("$1,600.00")) throw new Error(`Emergency Fund should show the $1,600.00 balance, got: ${emergencySaved}`);
  const emergencyText = await emergency.getText();
  if (!emergencyText.includes("Follows the High-Yield Savings balance")) throw new Error(`should say it follows the account: ${emergencyText}`);
  if ((await emergency.$("//button[normalize-space()='+ Add']").isExisting())) throw new Error("a goal that follows an account has no manual + Add");
  if ((await (await emergency.$("[data-goal-status]")).getAttribute("data-goal-status")) !== "no_deadline") {
    throw new Error("Emergency Fund has a pace but no deadline");
  }

  // --- 8a: compact contribute ------------------------------------------
  if (await trip.$("input[aria-label='Contribution amount']").isExisting()) throw new Error("the amount input should be hidden until + Add is clicked");
  await (await trip.$("//button[normalize-space()='+ Add']")).click();
  const amount = await trip.$("input[aria-label='Contribution amount']");
  await amount.waitForDisplayed({ timeout: 5000 });
  await amount.setValue("100");
  await (await trip.$(".bucket-contribute-panel button[type='submit']")).click();
  await browser.waitUntil(async () => (await (await (await card("Trip Fund")).$(".bucket-saved")).getText()).includes("$700.00"), {
    timeout: 10000,
    timeoutMsg: "Trip Fund should read $700.00 after adding $100",
  });
  if (await (await card("Trip Fund")).$("input[aria-label='Contribution amount']").isExisting()) {
    throw new Error("the popover should close after adding");
  }

  // --- 8b: switch tracking off in Edit ---------------------------------
  await (await (await card("Emergency Fund")).$("//button[normalize-space()='Edit']")).click();
  const toggle = await browser.$(".bucket-track-toggle input");
  await toggle.waitForExist({ timeout: 5000 });
  if (!(await toggle.isSelected())) throw new Error("the tracking box should start ticked for a tracking goal");
  await toggle.click();
  await (await browser.$("//form[contains(@class,'bucket-new-form')]//button[normalize-space()='Save']")).click();
  await browser.waitUntil(
    async () => {
      const c = await card("Emergency Fund");
      return (await (await c.$(".bucket-saved")).getText()).includes("$0.00") && (await c.$("//button[normalize-space()='+ Add']").isExisting());
    },
    { timeout: 10000, timeoutMsg: "with tracking off the goal should fall back to its (empty) contributions and offer + Add" },
  );

  console.log("FEATURE 71 E2E TEST PASSED");
} finally {
  await app.close();
}
