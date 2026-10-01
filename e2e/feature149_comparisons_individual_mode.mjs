// Reports > Comparisons in Individual mode, in the real compiled app:
//   - switching to Individual mode in the "Your details" panel shows the permanent person selector and no
//     mode switch on the page;
//   - an age range that spans two published cohorts asks which age group to use and shows no guessed
//     comparison until one is chosen; the other domains have no individual benchmark and say so;
//   - the choice is remembered across a restart.
// (Split from feature145 to keep each spec inside the runner's per-spec time limit.)
//
// Run with: node e2e/feature149_comparisons_individual_mode.mjs
import assert from "node:assert/strict";
import { chooseMenuOption, launchApp } from "./harness.mjs";
import {
  cardText,
  expectComparison,
  metric,
  openComparisonDetails,
  openReportsTab,
  saveSettings,
  seedComparisonHousehold,
  setInput,
  waitForCards,
} from "./lib/comparisons.mjs";

const dbDir = await seedComparisonHousehold();

let app = await launchApp({ dbDir });
try {
  let { browser } = app;
  await browser.setWindowSize(1440, 1600);
  await openReportsTab(browser, "comparisons");
  await waitForCards(browser, { count: 5 });

  await openComparisonDetails(browser);
  await chooseMenuOption(await browser.$("button[aria-label^='Comparison mode']"), { value: "individual" });
  await chooseMenuOption(await browser.$("button[aria-label^='Person compared']"), { value: "owner" });
  await chooseMenuOption(await browser.$("button[aria-label^='Age of Me: how to enter it']"), { value: "band" });
  await setInput(browser, "input[aria-label='Age of Me: youngest age in the range']", "40");
  await setInput(browser, "input[aria-label='Age of Me: oldest age in the range (leave empty for no upper limit)']", "49");
  await setInput(browser, "input[aria-label='Me: income per year']", "70000");
  await setInput(browser, "[data-cmp-amount='Me: income per year'] input[placeholder^='Where this came from']", "Pay stub");
  await saveSettings(browser);

  // The cards on this page refresh as soon as the form is saved: no trip away and back.
  await browser.$("[data-cmp-person-bar]").waitForExist({ timeout: 20000, timeoutMsg: "individual mode shows the person selector at the top" });
  assert.ok((await (await browser.$("[data-cmp-person-bar]")).getText()).includes("Me"));
  assert.equal((await browser.$$("[data-cmp-mode-switch]")).length, 0, "no mode switch on the page");
  const income = await metric(browser, "income");
  await browser.waitUntil(async () => (await income.getText()).includes("Choose the age group"), { timeout: 20000, timeoutMsg: `an age range spanning two cohorts needs a choice: ${await income.getText()}` });
  assert.equal((await income.$$("[data-cmp-difference]")).length, 0, "no guessed comparison while a choice is pending");

  // Choosing the group makes the comparison.
  const picker = await income.$("button[aria-label$='age group']");
  await chooseMenuOption(picker, { value: "cps_pinc01_money_income_median:45-49" });
  await expectComparison(browser, "income", "cps_pinc01_money_income_median:45-49", 70000, "45–49");

  for (const id of ["spending", "investments", "savings", "debt"]) {
    const t = await cardText(browser, id);
    assert.ok(t.includes("No matching benchmark"), `${id} is an explicit unavailable card in individual mode, got: ${t}`);
  }

  // The choice is remembered: a restart does not ask again.
  await app.close();
  app = await launchApp({ dbDir });
  browser = app.browser;
  await browser.setWindowSize(1440, 1600);
  await openReportsTab(browser, "comparisons");
  await expectComparison(browser, "income", "cps_pinc01_money_income_median:45-49", 70000, "45–49");
  assert.ok(!(await cardText(browser, "income")).includes("Choose the age group"));

  console.log("FEATURE 149 E2E TEST PASSED");
} finally {
  await app.close();
}
