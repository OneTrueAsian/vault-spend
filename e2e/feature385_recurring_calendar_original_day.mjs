// The Recurring Calendar keeps an item's original day after a short month: a monthly bill first due
// on the 31st is back on the 31st in March after sitting on the 28th in February, and a yearly
// 29 February item returns to the 29th in the next leap year (found in the 1.3.2 UAT, R9-2).
//
// Run with: node e2e/run-all.mjs --spec=385

import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

// Anchors are built from today's year so the fixture does not age: the 31st of January last year, and
// 29 February of the most recent leap year before today.
const year = new Date().getFullYear();
let leapYear = year - 1;
while (new Date(leapYear, 1, 29).getMonth() !== 1) leapYear--;
const monthlyAnchor = `${year - 1}-01-31`;
const yearlyAnchor = `${leapYear}-02-29`;

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Joint Checking', 'checking', '1000.00')")
acct = cur.lastrowid
cur.execute("INSERT INTO recurring (merchant, amount, cadence, anchor_date, account_id) VALUES ('Month End Bill', '-31.00', 'monthly', '${monthlyAnchor}', ?)", (acct,))
cur.execute("INSERT INTO recurring (merchant, amount, cadence, anchor_date, account_id) VALUES ('Leap Day Fee', '-29.00', 'annual', '${yearlyAnchor}', ?)", (acct,))
`);

const app = await launchApp({ dbDir });
const { browser } = app;

/** Each item's day of the month in the month the calendar is showing. */
const daysShown = () =>
  browser.execute(() => {
    const days = {};
    for (const item of document.querySelectorAll(".cal-item")) {
      const day = item.closest(".cal-day")?.querySelector(".cal-day-num")?.textContent;
      days[item.querySelector(".cal-item-merchant").textContent.trim()] = Number(day);
    }
    return days;
  });

try {
  for (const b of await browser.$$("nav button")) if ((await b.getText()).trim() === "Recurring") await b.click();
  for (const b of await browser.$$(".view-toggle button")) if ((await b.getText()).trim() === "Calendar") await b.click();
  await (await browser.$(".cal-grid")).waitForExist({ timeout: 15000 });

  // Page forward one month at a time for just over four years, so a leap February is always included.
  const now = new Date();
  let sawShortMonth = false;
  let sawLeapDay = false;
  for (let i = 0; i < 52; i++) {
    const shown = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const label = shown.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    await waitUntilOrDiagnose(browser, async () => (await (await browser.$(".month-label")).getText()) === label, { timeoutMsg: `the calendar should show ${label}` });
    const daysInMonth = new Date(shown.getFullYear(), shown.getMonth() + 1, 0).getDate();
    const days = await daysShown();
    assert.equal(days["Month End Bill"], Math.min(31, daysInMonth), `${label}: the monthly bill first due on the 31st`);
    if (shown.getMonth() === 1) {
      assert.equal(days["Leap Day Fee"], Math.min(29, daysInMonth), `${label}: the yearly 29 February item`);
      if (daysInMonth === 29) sawLeapDay = true;
    } else {
      assert.equal(days["Leap Day Fee"], undefined, `${label}: the yearly item should not appear`);
    }
    if (daysInMonth < 31 && shown.getMonth() !== 1) sawShortMonth = true;
    await (await browser.$('button[aria-label="Next month"]')).click();
  }
  assert.ok(sawShortMonth && sawLeapDay, "the walk should cross a 30-day month and a leap February");
  console.log("FEATURE 385 E2E TEST PASSED");
} finally {
  await app.close();
}
