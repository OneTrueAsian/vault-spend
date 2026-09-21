// E2E test for Phase 4 item 19 (investment accumulation + projection), part 1:
// what an investment account's Details page shows.
//
//   - "Cash invested" is money in minus money out on the account itself, with
//     the in and out shown separately, and a month-by-month table lists every
//     month (a missed month reads $0.00) so the total can be audited;
//   - "Worth now" is the same figure the Accounts tab shows, and Growth is worth
//     minus net invested (red when negative);
//   - the chart draws cash invested from the first deposit but the Worth line
//     only from the first recorded value — nothing is made up for earlier
//     months — and says so; a legend names both lines and hovering reads them;
//   - an account with no deposits says so and points to Transactions; an
//     account with deposits but no withdraw date prompts for one;
//   - a checking account's Details page has no projection section and still
//     reconciles.
//
// Run with: node e2e/feature92_accumulation_details.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { money, monthFromNow, nav, openDetails, parseMoney, text, waitForAccumulation } from "./lib/accumulation.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()

def month_start(back):
    total = today.year * 12 + today.month - 1 - back
    y, m = divmod(total, 12)
    return datetime.date(y, m + 1, 1)

def acct(name, typ, start="0.00"):
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES (?,?,?)", (name, typ, start))
    return cur.lastrowid

counter = [0]
def tx(account_id, when, description, amount):
    counter[0] += 1
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (account_id, when.isoformat(), description, amount, "Transfer", "user", f"f92-{counter[0]}"))

checking = acct("Everyday Checking", "checking", "1000.00")
roth = acct("Joey Roth IRA", "investment")
down = acct("Down 529", "investment")
empty = acct("Empty 529", "investment")

tx(checking, today - datetime.timedelta(days=2), "Coffee", "-4.50")

# Roth: $500 on the 1st of 8 of the last 9 months (nothing 4 months ago), one $200 withdrawal.
for back in (8, 7, 6, 5, 3, 2, 1, 0):
    tx(roth, month_start(back), f"Roth deposit {back}", "500.00")
tx(roth, month_start(2).replace(day=2), "Roth withdrawal", "-200.00")
# Down 529: $600 in, worth less than that.
for back in (2, 1):
    tx(down, month_start(back), f"Down deposit {back}", "300.00")

cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?,?,?,?,?,?,?)",
            (roth, "VTI", "Total Market", "10", "500.00", "4000.00", "US Stock"))
cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?,?,?,?,?,?,?)",
            (down, "VXUS", "International", "1", "400.00", "600.00", "Intl Stock"))

# Real recorded values for the last three days only.
for days_ago, value in ((3, "4800.00"), (2, "4900.00"), (1, "4950.00")):
    cur.execute("INSERT INTO account_value_snapshots (account_id, date, value) VALUES (?,?,?)",
                (roth, (today - datetime.timedelta(days=days_ago)).isoformat(), value))
`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const labelOf = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;

const app = await launchApp({ dbDir });
const { browser } = app;
const fail = (message) => {
  throw new Error(message);
};

try {
  await browser.setWindowSize(1440, 1400);

  // The Accounts tab's own figure for the Roth, to compare "Worth now" with.
  await nav(browser, "Accounts");
  const accountsTabWorth = await browser.waitUntil(
    async () => {
      const t = await browser.execute(() => {
        const card = [...document.querySelectorAll(".account-card")].find((c) => c.querySelector(".account-name-cell")?.textContent.trim() === "Joey Roth IRA");
        return card?.querySelector(".bal")?.textContent.trim() ?? null;
      });
      return t || false;
    },
    { timeout: 15000, timeoutMsg: "the Accounts tab should show the Roth's balance" },
  );

  // ---- 19.1 / 19.2: the Roth's numbers ----------------------------------------
  const rothId = await openDetails(browser, "Joey Roth IRA");
  await waitForAccumulation(browser, rothId);

  const invested = await text(browser, "[data-acc-invested]");
  const inTotal = await text(browser, "[data-acc-in]");
  const outTotal = await text(browser, "[data-acc-out]");
  const worth = await text(browser, "[data-acc-worth]");
  const growth = await text(browser, "[data-acc-growth]");
  console.log("Roth:", { invested, inTotal, outTotal, worth, growth, accountsTabWorth });
  if (inTotal !== money(4000)) fail(`money in should be ${money(4000)} (eight $500 deposits), got ${inTotal}`);
  if (outTotal !== money(200)) fail(`money out should be ${money(200)}, got ${outTotal}`);
  if (invested !== money(3800)) fail(`cash invested (net) should be ${money(3800)}, got ${invested}`);
  if (worth !== money(5000) || worth !== accountsTabWorth) fail(`worth now should be ${money(5000)} and match the Accounts tab (${accountsTabWorth}), got ${worth}`);
  if (growth !== `+${money(1200)}`) fail(`growth should be +${money(1200)}, got ${growth}`);
  if ((await (await browser.$("[data-acc-growth]")).getAttribute("data-acc-growth-negative")) !== "false") fail("a positive growth must not be flagged negative");

  // The month-by-month table lists every month from the first deposit, a missed month as $0.00.
  const rows = await browser.execute(() =>
    [...document.querySelectorAll("[data-acc-month-row]")].map((r) => ({
      month: r.getAttribute("data-acc-month-row"),
      moneyIn: r.querySelector("[data-acc-month-in]").textContent.trim(),
      moneyOut: r.querySelector("[data-acc-month-out]").textContent.trim(),
    })),
  );
  if (rows.length !== 9) fail(`nine months (8 months ago through this one) should be listed, got ${rows.length}: ${rows.map((r) => r.month).join(", ")}`);
  if (rows[0].month !== monthFromNow(0) || rows[8].month !== monthFromNow(-8)) fail(`rows should run newest to oldest, got ${rows[0].month} .. ${rows[8].month}`);
  const missed = rows.find((r) => r.month === monthFromNow(-4));
  if (!missed || missed.moneyIn !== money(0)) fail(`the month with no deposit should read ${money(0)}, got ${JSON.stringify(missed)}`);
  const withdrawal = rows.find((r) => r.month === monthFromNow(-2));
  if (withdrawal.moneyIn !== money(500) || withdrawal.moneyOut !== money(200)) fail(`two months ago should show ${money(500)} in and ${money(200)} out, got ${JSON.stringify(withdrawal)}`);
  const sumIn = rows.reduce((s, r) => s + parseMoney(r.moneyIn), 0);
  const sumOut = rows.reduce((s, r) => s + parseMoney(r.moneyOut), 0);
  if (sumIn !== 4000 || sumOut !== 200) fail(`the table should add up to the tiles (4000 in / 200 out), got ${sumIn} / ${sumOut}`);

  // ---- 19.3 (default) / 19.9 (no withdraw date): defaults and prompt -------------
  // Window: the last six COMPLETE months = 5 x $500 + one missed month = 2500 / 6.
  const monthly = await (await browser.$("[data-acc-monthly]")).getValue();
  if (monthly !== "416.67") fail(`the monthly amount should default to the 6-month average 416.67, got ${monthly}`);
  if (!/average/i.test(await text(browser, "[data-acc-monthly-note]"))) fail("the monthly amount should say it is the average");
  if ((await text(browser, "[data-acc-projected]")) !== "—") fail("with no withdraw date there is no projected number");
  await browser.$("[data-acc-no-date]").waitForExist({ timeout: 5000, timeoutMsg: "an account with deposits but no withdraw date should prompt for one" });
  if (await browser.$("polyline[data-series='projected']").isExisting()) fail("no projection line without a withdraw date");

  // ---- 19.6: the chart -------------------------------------------------------------
  const worthLine = await browser.$("polyline[data-series='worth']");
  await worthLine.waitForExist({ timeout: 15000, timeoutMsg: "the Worth line should be drawn (three recorded days plus today)" });
  await browser.waitUntil(async () => (await (await browser.$("polyline[data-series='worth']")).getAttribute("data-points")) === "4", {
    timeout: 15000,
    timeoutMsg: "the Worth line should have exactly the 3 recorded days plus today's point — nothing invented for earlier months",
  });
  const investedLine = await browser.$("polyline[data-series='invested']");
  const investedFirst = await investedLine.getAttribute("data-first-x-label");
  const worthFirst = await (await browser.$("polyline[data-series='worth']")).getAttribute("data-first-x-label");
  console.log("chart starts:", { invested: investedFirst, worth: worthFirst });
  if (investedFirst !== labelOf(monthFromNow(-8))) fail(`cash invested should start at the first deposit (${labelOf(monthFromNow(-8))}), got ${investedFirst}`);
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const firstSnapshotLabel = `${MONTHS[threeDaysAgo.getMonth()]} ${threeDaysAgo.getDate()}`;
  const note = await text(browser, "[data-acc-value-note]");
  if (!note.includes(firstSnapshotLabel) || !/nothing is estimated/i.test(note)) fail(`the note should name the first recorded day (${firstSnapshotLabel}) and say nothing is estimated, got: ${note}`);
  const legend = await browser.execute(() => [...document.querySelectorAll("[data-series-legend] .chart-legend-item")].map((n) => n.textContent.trim()));
  if (legend.join("|") !== "Cash invested|Worth") fail(`the legend should name both lines, got ${legend.join("|")}`);

  // Hovering reads every line at that point.
  const overlay = await browser.$("[data-acc-chart] svg > rect");
  await overlay.scrollIntoView({ block: "center" });
  await overlay.moveTo({ xOffset: 120, yOffset: 0 });
  await browser.waitUntil(async () => (await browser.$$("[data-acc-chart] .chart-tooltip-text")).length >= 1, { timeout: 5000, timeoutMsg: "hovering the chart should show a tooltip" });
  const tip = await browser.execute(() => [...document.querySelectorAll("[data-acc-chart] .chart-tooltip-text")].map((n) => n.textContent).join(" | "));
  console.log("tooltip:", tip);
  if (!/Cash invested: \$/.test(tip)) fail(`the tooltip should read the cash invested line, got: ${tip}`);

  // ...and so does the keyboard: the chart takes focus, the arrow keys step through the same points, and the
  // values at the current point are announced (the live region) as well as drawn.
  // Move the mouse off the chart first, so only the keyboard can bring the tooltip back.
  await browser.action("pointer").move({ x: 2, y: 2 }).perform();
  await browser.waitUntil(async () => (await browser.$$("[data-acc-chart] .chart-tooltip-text")).length === 0, { timeout: 5000, timeoutMsg: "the tooltip should go when the mouse leaves the chart" });  await browser.execute(() => document.querySelector("[data-acc-chart] [data-series-chart]").focus());
  await browser.keys("Home");
  await browser.waitUntil(async () => (await browser.$$("[data-acc-chart] .chart-tooltip-text")).length >= 1, { timeout: 5000, timeoutMsg: "Home on the focused chart should show the tooltip for its first point" });
  const firstTitle = await text(browser, "[data-acc-chart] .chart-tooltip-title");
  await browser.keys("ArrowRight");
  await browser.waitUntil(async () => (await text(browser, "[data-acc-chart] .chart-tooltip-title")) !== firstTitle, { timeout: 5000, timeoutMsg: "ArrowRight should move the tooltip to the next point" });
  const announced = await browser.execute(() => document.querySelector("[data-acc-chart] [data-chart-live]")?.textContent ?? "");
  if (!/Cash invested \$/.test(announced)) fail(`the values at the current point should be announced, got: "${announced}"`);
  await browser.keys("Escape");
  await browser.waitUntil(async () => (await browser.$$("[data-acc-chart] .chart-tooltip-text")).length === 0, { timeout: 5000, timeoutMsg: "Escape should put the tooltip away" });
  // ---- a money-out lowers the net; growth goes red when negative ------------------------
  await nav(browser, "Accounts");
  const downId = await openDetails(browser, "Down 529");
  await waitForAccumulation(browser, downId);
  if ((await text(browser, "[data-acc-invested]")) !== money(600)) fail("Down 529 invested should be $600.00");
  if ((await text(browser, "[data-acc-worth]")) !== money(400)) fail("Down 529 worth should be $400.00");
  if ((await text(browser, "[data-acc-growth]")) !== `-${money(200)}`) fail(`Down 529 growth should read -$200.00, got ${await text(browser, "[data-acc-growth]")}`);
  const growthEl = await browser.$("[data-acc-growth]");
  if ((await growthEl.getAttribute("data-acc-growth-negative")) !== "true" || !(await growthEl.getAttribute("class")).includes("report-over-budget")) fail("negative growth should be flagged and drawn in the over-budget red");

  // ---- 19.9: no deposits ------------------------------------------------------------------------
  await nav(browser, "Accounts");
  const emptyId = await openDetails(browser, "Empty 529");
  await waitForAccumulation(browser, emptyId);
  await browser.$("[data-acc-no-deposits]").waitForExist({ timeout: 5000, timeoutMsg: "an account with no deposits should say so" });
  if ((await text(browser, "[data-acc-invested]")) !== money(0)) fail("no deposits means $0.00 invested");
  if (!/Transactions/.test(await text(browser, "[data-acc-no-deposits]"))) fail("the empty state should point to the Transactions tab");
  // Nothing to plot, so no chart: not an empty grid with made-up axis labels ("undefined -1", "Jan 0").
  if ((await browser.$$("[data-acc-chart] svg")).length !== 0) fail("an account with nothing to plot should not draw a chart");
  const emptyPageText = await text(browser, ".main");
  if (/undefined|NaN/.test(emptyPageText)) fail(`the empty state should not show placeholder text, got:\n${emptyPageText}`);
  await (await browser.$("[data-acc-no-deposits] button")).click();
  await browser.waitUntil(async () => (await text(browser, ".view-title")) === "Transactions", { timeout: 10000, timeoutMsg: "Open Transactions should go to the Transactions tab" });

  // ---- 19.12: a checking account is unchanged --------------------------------------------------------
  await nav(browser, "Accounts");
  const checkingId = await openDetails(browser, "Everyday Checking");
  await browser.$("[data-reconcile-card]").waitForExist({ timeout: 10000 });
  if (await browser.$(`[data-accumulation]`).isExisting()) fail("a checking account must not get the accumulation section");
  await (await browser.$("[data-statement-balance]")).setValue("995.50");
  await (await browser.$("[data-reconcile-start]")).click();
  await browser.$("[data-reconcile-summary]").waitForExist({ timeout: 10000, timeoutMsg: "reconciliation should still start on a checking account" });
  console.log("checking account", checkingId, "still reconciles");

  console.log("FEATURE 92 E2E TEST PASSED");
} finally {
  await app.close();
}
