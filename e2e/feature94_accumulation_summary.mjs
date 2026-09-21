// E2E test for Phase 4 item 19 (investment accumulation + projection), part 3:
// the Investments tab's "Accumulation & projection" summary.
//
//   - one row per investment account: cash invested, worth now, growth, the
//     monthly amount in use, and the projected number with its date (or "No date
//     set" when there isn't one);
//   - a total row that adds the rows up (the projected total adds each account's
//     number at its own withdraw date, only for accounts that have one);
//   - a combined chart of every account's projected balance;
//   - a row opens that account's Details page, and Back returns to Investments;
//   - the existing "Goal projection" what-if card is untouched.
//
// Run with: node e2e/feature94_accumulation_summary.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { SUMMARY_EXPECTED as X, SUMMARY_FIXTURE_PY } from "./lib/accumulation-fixture.mjs";
import { futureValue, money, nav, parseMoney, text, waitForAccumulation } from "./lib/accumulation.mjs";

const dbDir = await seedFixture(SUMMARY_FIXTURE_PY);
const app = await launchApp({ dbDir });
const { browser } = app;
const fail = (message) => {
  throw new Error(message);
};

try {
  await browser.setWindowSize(1440, 2000);
  await nav(browser, "Investments");
  await browser.$("[data-acc-summary]").waitForExist({ timeout: 20000, timeoutMsg: "the Investments tab should have an Accumulation & projection card" });

  // ---- 19.11: one row per investment account ------------------------------------------
  await browser.waitUntil(async () => (await browser.$$("[data-acc-summary-row]")).length === X.rows, {
    timeout: 15000,
    timeoutMsg: `the summary should have ${X.rows} rows (one per investment account)`,
  });
  const rows = await browser.execute(() =>
    Object.fromEntries(
      [...document.querySelectorAll("[data-acc-summary-row]")].map((r) => [
        r.getAttribute("data-acc-summary-row"),
        {
          invested: r.querySelector("[data-acc-row-invested]").textContent.trim(),
          worth: r.querySelector("[data-acc-row-worth]").textContent.trim(),
          growth: r.querySelector("[data-acc-row-growth]").textContent.trim(),
          monthly: r.querySelector("[data-acc-row-monthly]").textContent.trim(),
          projected: r.querySelector("[data-acc-row-projected]").innerText.trim().replace(/\s+/g, " "),
        },
      ]),
    ),
  );
  console.log(JSON.stringify(rows, null, 2));

  for (const name of Object.keys(X.invested)) {
    const row = rows[name] ?? fail(`no summary row for ${name}`);
    if (row.invested !== money(X.invested[name])) fail(`${name}: invested should be ${money(X.invested[name])}, got ${row.invested}`);
    if (row.worth !== money(X.worth[name])) fail(`${name}: worth should be ${money(X.worth[name])}, got ${row.worth}`);
    const growth = X.worth[name] - X.invested[name];
    if (parseMoney(row.growth) !== growth) fail(`${name}: growth should be ${money(growth)}, got ${row.growth}`);
  }
  // The monthly amount in use: the average (Roth, Alex), the saved amount (Sam), nothing to average (Brokerage).
  if (rows["Joey Roth IRA"].monthly !== money(X.monthly["Joey Roth IRA"])) fail(`Roth monthly should be the ${money(450)} average, got ${rows["Joey Roth IRA"].monthly}`);
  if (rows["Sam's 529"].monthly !== money(X.monthly["Sam's 529"])) fail(`Sam's saved monthly should read ${money(300)}, got ${rows["Sam's 529"].monthly}`);
  if (rows["Alex's 529"].monthly !== money(X.monthly["Alex's 529"])) fail(`Alex's monthly should be the ${money(225)} average, got ${rows["Alex's 529"].monthly}`);
  if (rows["Fidelity Brokerage"].monthly !== "—") fail(`an account with nothing to average shows a dash, got ${rows["Fidelity Brokerage"].monthly}`);

  // Projected numbers (balance on the withdraw month, before any withdrawal) and their dates.
  const rothProjected = futureValue(X.worth["Joey Roth IRA"], 450, 7, 36);
  const samProjected = futureValue(X.worth["Sam's 529"], 300, 6, 60);
  if (!rows["Joey Roth IRA"].projected.startsWith(money(rothProjected))) fail(`Roth should project ${money(rothProjected)} at 36 months, got ${rows["Joey Roth IRA"].projected}`);
  if (!rows["Sam's 529"].projected.startsWith(money(samProjected))) fail(`Sam's should project ${money(samProjected)} at 60 months, got ${rows["Sam's 529"].projected}`);
  if (!/[A-Z][a-z]{2} \d{4}$/.test(rows["Joey Roth IRA"].projected)) fail(`the projected cell should end with the withdraw month, got ${rows["Joey Roth IRA"].projected}`);
  for (const name of ["Alex's 529", "Fidelity Brokerage"]) {
    if (rows[name].projected !== "No date set") fail(`${name} has no withdraw date, so it should say "No date set", got ${rows[name].projected}`);
  }

  // ---- the total row adds up ------------------------------------------------------------------
  const total = {
    invested: await text(browser, "[data-acc-total-invested]"),
    worth: await text(browser, "[data-acc-total-worth]"),
    growth: await text(browser, "[data-acc-total-growth]"),
    monthly: await text(browser, "[data-acc-total-monthly]"),
    projected: await text(browser, "[data-acc-total-projected]"),
  };
  console.log("total:", total);
  if (total.invested !== money(X.totalInvested)) fail(`total invested should be ${money(X.totalInvested)}, got ${total.invested}`);
  if (total.worth !== money(X.totalWorth)) fail(`total worth should be ${money(X.totalWorth)}, got ${total.worth}`);
  if (parseMoney(total.growth) !== X.totalWorth - X.totalInvested) fail(`total growth should be ${money(X.totalWorth - X.totalInvested)}, got ${total.growth}`);
  if (total.monthly !== money(X.totalMonthly)) fail(`total monthly should be ${money(X.totalMonthly)}, got ${total.monthly}`);
  if (total.projected !== money(rothProjected + samProjected)) fail(`the projected total adds the two accounts that have a date: ${money(rothProjected + samProjected)}, got ${total.projected}`);
  if (!/2 accounts|no usable withdraw date/.test(await text(browser, "[data-acc-total-note]"))) fail("the note under the table should say two accounts have no withdraw date");
  // The total's own cell says what the figure is (each account's number at its OWN date, not one date's value)
  // and how many accounts it leaves out, so it isn't read as the portfolio's value on one day.
  const caption = await text(browser, "[data-acc-total-caption]").catch(() => "");
  if (!/own date/.test(caption) || !/2 left out/.test(caption)) fail(`the total's Projected cell should say "each at its own date" and "2 left out", got "${caption}"`);  // The rows really do add up to the total (invested and worth, to the cent).
  const sum = (key) => Object.values(rows).reduce((s, r) => s + parseMoney(r[key]), 0);
  if (sum("invested") !== X.totalInvested || sum("worth") !== X.totalWorth) fail("the rows should add up to the total row");

  // ---- the combined chart ------------------------------------------------------------------------
  const combined = await browser.$("[data-acc-combined-chart] polyline[data-series='combined']");
  await combined.waitForExist({ timeout: 5000, timeoutMsg: "the combined projection chart should draw a line" });
  const points = Number(await combined.getAttribute("data-points"));
  // Yearly from now to the latest withdraw month (60 months) plus the drawdown years of Sam's plan (3 years: +24 months).
  if (points < 6) fail(`the combined chart should have a point a year for several years, got ${points} points`);

  // ---- a row opens Details and Back returns ---------------------------------------------------------------
  await (await browser.$("[data-acc-summary-row='Sam\\'s 529']")).click();
  await browser.$("[data-account-detail]").waitForExist({ timeout: 10000, timeoutMsg: "clicking a row should open that account's Details page" });
  const detailId = await (await browser.$("[data-account-detail]")).getAttribute("data-account-detail");
  await waitForAccumulation(browser, detailId);
  if ((await text(browser, ".view-title")) !== "Sam's 529") fail(`Details should be for Sam's 529, got ${await text(browser, ".view-title")}`);
  if ((await text(browser, "[data-account-back]")) !== "← Investments") fail(`Back should say where it goes, got ${await text(browser, "[data-account-back]")}`);
  // Sam's saved plan is shown: 3 yearly withdrawals.
  await browser.waitUntil(async () => (await browser.$$("[data-acc-drawdown-row]")).length === 3, { timeout: 10000, timeoutMsg: "Sam's plan spreads over 3 years, so 3 withdrawals should be listed" });
  await (await browser.$("[data-account-back]")).click();
  await browser.$("[data-acc-summary]").waitForExist({ timeout: 10000, timeoutMsg: "Back should return to the Investments tab" });
  if (!/Investments/.test(await text(browser, ".view-title"))) fail("we should be back on the Investments tab");

  // The Details button does the same.
  await (await browser.$("[data-acc-summary-row='Joey Roth IRA'] [data-acc-open]")).click();
  await browser.$("[data-accumulation]").waitForExist({ timeout: 10000 });
  await (await browser.$("[data-account-back]")).click();
  await browser.$("[data-acc-summary]").waitForExist({ timeout: 10000 });
  // The keyboard has its own way in: the account's name is a real button, so Tab reaches it and Enter opens
  // the account (a row click is only the mouse's shortcut to the same place).
  await browser.execute(() => document.querySelector("[data-acc-summary-row='Joey Roth IRA'] [data-acc-open]").focus());
  const focused = await browser.execute(() => document.activeElement?.getAttribute("data-acc-open") !== null && document.activeElement?.tagName === "BUTTON");
  if (!focused) fail("the account name should be a focusable button");
  await browser.keys("Enter");
  await browser.$("[data-accumulation]").waitForExist({ timeout: 10000, timeoutMsg: "Enter on the focused account name should open that account" });
  if ((await text(browser, ".view-title")) !== "Joey Roth IRA") fail(`Enter should open Joey Roth IRA, got ${await text(browser, ".view-title")}`);
  await (await browser.$("[data-account-back]")).click();
  await browser.$("[data-acc-summary]").waitForExist({ timeout: 10000 });

  // ---- 19.15: the Goal projection what-if card is unchanged ----------------------------------------------
  const goal = await browser.execute(() => {
    const stat = [...document.querySelectorAll(".stat")].find((s) => s.querySelector(".stat-label")?.textContent.trim() === "Projected in 20 years");
    return stat ? stat.querySelector(".stat-value").textContent.trim() : null;
  });
  const want = money(futureValue(X.totalWorth, 0, 7, 240));
  if (goal !== want) fail(`the Goal projection card should still read ${want} for the whole portfolio at 7% over 20 years, got ${goal}`);
  if (!(await browser.$("[data-projection-save-as-goal]").isExisting())) fail("the Goal projection card should still offer Save as goal…");

  console.log("FEATURE 94 E2E TEST PASSED");
} finally {
  await app.close();
}
