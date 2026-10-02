// Reports > Comparisons, personal income, in the real compiled app:
//   - there is no household / one person choice anywhere in Your details;
//   - with income entered for each person, the Income card's Explore view lists each household member's own
//     pay against the median for people their age (Census PINC-01), with the right age group;
//   - with one household total, it suggests entering income per person instead;
//   - the lines survive a restart.
//
// Run with: node e2e/feature149_comparisons_personal_income.mjs
import assert from "node:assert/strict";
import { chooseMenuOption, launchApp } from "./harness.mjs";
import {
  adjusted,
  metric,
  openComparisonDetails,
  openReportsTab,
  saveSettings,
  seedComparisonHousehold,
  setInput,
  waitForCards,
  whole,
} from "./lib/comparisons.mjs";

const dbDir = await seedComparisonHousehold(); // Me (42) and Partner (67), one household total of $100,000

async function openIncomeDetails(browser) {
  await (await (await metric(browser, "income")).$(".cmp-explore")).click();
  await browser.$("[data-cmp-details='income']").waitForDisplayed({ timeout: 15000 });
}
async function closeDetails(browser) {
  await (await browser.$(".modal-panel .modal-secondary")).click();
  await browser.$("[data-cmp-details='income']").waitForExist({ reverse: true, timeout: 15000 });
}

let app = await launchApp({ dbDir });
try {
  let { browser } = app;
  await browser.setWindowSize(1440, 1600);
  await openReportsTab(browser, "comparisons");
  await waitForCards(browser, { count: 5 });

  // One household total: a hint, no personal lines.
  await openIncomeDetails(browser);
  assert.ok(await (await browser.$("[data-cmp-personal-hint]")).isExisting(), "a household total suggests entering income per person");
  assert.equal((await browser.$$("[data-cmp-personal]")).length, 0);
  await closeDetails(browser);

  // No mode control anywhere.
  await openComparisonDetails(browser);
  assert.equal((await browser.$$("button[aria-label^='Comparison mode']")).length, 0, "no household / one person choice");
  assert.ok(!(await (await browser.$("[data-cmp-settings]")).getText()).includes("One person"));

  // Income per person.
  await chooseMenuOption(await browser.$("button[aria-label^='Household income method']"), { value: "by_person" });
  await setInput(browser, "input[aria-label='Me: income per year']", "78000");
  await setInput(browser, "[data-cmp-amount='Me: income per year'] input[placeholder^='Where this came from']", "Pay stub");
  await setInput(browser, "input[aria-label='Partner: income per year']", "40000");
  await setInput(browser, "[data-cmp-amount='Partner: income per year'] input[placeholder^='Where this came from']", "Pension letter");
  await saveSettings(browser);

  const check = async () => {
    await openIncomeDetails(browser);
    const me = await browser.$("[data-cmp-personal='owner']");
    await me.waitForExist({ timeout: 20000, timeoutMsg: "Me should get a personal income line" });
    const meText = await me.getText();
    assert.ok(meText.includes("ages 40–44"), `Me (42) is compared with ages 40–44, got: ${meText}`);
    assert.ok(meText.includes(`${whole(78000)} vs ${whole(adjusted("cps_pinc01_money_income_median:40-44").adjusted)}`), meText);
    const partner = await (await browser.$("[data-cmp-personal='member:1']")).getText();
    assert.ok(partner.includes("ages 65–69"), `Partner (67) is compared with ages 65–69, got: ${partner}`);
    assert.ok(partner.includes(`${whole(40000)} vs ${whole(adjusted("cps_pinc01_money_income_median:65-69").adjusted)}`), partner);
    assert.equal((await browser.$$("[data-cmp-personal-hint]")).length, 0);
    await closeDetails(browser);
  };
  await check();

  // Still there after a restart.
  await app.close();
  app = await launchApp({ dbDir });
  browser = app.browser;
  await browser.setWindowSize(1440, 1600);
  await openReportsTab(browser, "comparisons");
  await waitForCards(browser, { count: 5 });
  await check();

  console.log("FEATURE 149 E2E TEST PASSED");
} finally {
  await app.close();
}
