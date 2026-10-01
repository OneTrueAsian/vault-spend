// Reports > Comparisons numbers in the real compiled app, checked against figures recomputed here from
// the published workbooks:
//   - household income, savings, investments and debt are compared with the cohort for the reference
//     person's age, with the CPI-adjusted reference, the dollar and percent difference, and details that
//     reconcile to the accounts counted;
//   - the household spending benchmark does not exist, so that card stays visible as unavailable;
//   - changing the reference person or crossing a cohort boundary changes exactly which reference is used;
//   (Individual mode is covered by feature149.)
//   (A zero balance, a typed total and its staleness are covered by feature148.)
//
// Run with: node e2e/feature145_comparisons_metrics.mjs
import assert from "node:assert/strict";
import { chooseMenuOption, launchApp } from "./harness.mjs";
import {
  PUBLISHED,
  expectComparison,
  metric,
  saveSettings,
  seedComparisonHousehold,
  adjusted,
  cardText,
  invoke,
  openComparisonDetails,
  openReportsTab,
  record,
  setInput,
  waitForCards,
  whole,
} from "./lib/comparisons.mjs";

const today = new Date();
const TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

// Anchor the package to numbers read by hand from the Census workbooks before trusting it for the checks below.
for (const [id, value] of Object.entries(PUBLISHED)) assert.equal(Number(record(id).value), value, `${id} must match the published workbook`);

const dbDir = await seedComparisonHousehold();

/** A modal's text is empty during its fade-in, so wait for it rather than reading it once. */
async function detailsText(browser, id) {
  const el = await browser.$(`[data-cmp-details='${id}']`);
  await el.waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => (await el.getText()).trim() !== "", { timeout: 10000, timeoutMsg: `${id} details never showed text` });
  return el.getText();
}

let app = await launchApp({ dbDir });
try {
  let { browser } = app;
  await browser.setWindowSize(1440, 1600);
  await openReportsTab(browser, "comparisons");
  await waitForCards(browser, { count: 5 });

  // ---- Household, reference person 42 -------------------------------------------------------------
  await expectComparison(browser, "income", "cps_hinc02_money_income_median:40-44", 100000, "40–44");
  await expectComparison(browser, "savings", "sipp_financial_institution_assets_median:35-44", 8000, "35–44");
  await expectComparison(browser, "investments", "sipp_retirement_accounts_median:35-44", 80000, "35–44");
  await expectComparison(browser, "debt", "sipp_total_debt_median:35-44", 150000, "35–44");

  // Order matches the design, and the unsupported household domain is visible, not hidden or invented.
  const order = [];
  for (const c of await browser.$$("[data-comparisons-page] [data-metric]")) order.push(await c.getAttribute("data-metric"));
  assert.deepEqual(order, ["spending", "investments", "income", "savings", "debt"]);
  const spending = await cardText(browser, "spending");
  assert.ok(spending.includes("No matching benchmark"), `spending is an explicit benchmark gap, got: ${spending}`);
  assert.equal((await (await metric(browser, "spending")).$$("[data-cmp-difference]")).length, 0, "no invented spending comparison");

  // Holders-only populations are labelled; the all-households income figure is not.
  assert.ok((await (await metric(browser, "savings")).$("[data-cmp-holders-only]").isExisting()), "savings reference is holders-only");
  assert.equal(await (await metric(browser, "income")).$("[data-cmp-holders-only]").isExisting(), false);

  // Details reconcile to what was counted.
  await (await (await metric(browser, "savings")).$(".cmp-explore")).click();
  const sd = await detailsText(browser, "savings");
  assert.ok(sd.includes("Checking") && sd.includes("$8,000"), `savings details should list Checking at $8,000: ${sd}`);
  for (const left of ["401k", "Brokerage", "Visa", "Home loan"]) assert.ok(sd.includes(left), `${left} should be listed as left out`);
  assert.ok(sd.includes("This kind of account does not count here"));
  const sourceNote = sd.includes("U.S. Census Bureau, SIPP 2025");
  assert.ok(sourceNote, "the source is named");
  await (await browser.$(".modal-panel .modal-secondary")).click();

  await (await (await metric(browser, "debt")).$(".cmp-explore")).click();
  const dd = await detailsText(browser, "debt");
  const home = adjusted("sipp_home_debt_median:35-44");
  assert.ok(dd.includes(`${whole(150000)} vs ${whole(home.adjusted)}`), `the mortgage is compared with the home-debt figure: ${dd}`);
  assert.ok(dd.includes("Mortgage / home loans"), "debt is broken down by type");
  await (await browser.$(".modal-panel .modal-secondary")).click();

  // The page re-reads after the ledger changes: set Checking to 9,500 behind the page, then re-enter it.
  const accounts = await invoke(browser, "list_accounts");
  const checkingId = accounts.ok.find((a) => a.name === "Checking").id;
  assert.equal((await invoke(browser, "set_account_balance_override", { id: checkingId, balance: "9500" })).error, undefined);
  await (await browser.$("[data-reports-tab='overview']")).click();
  await (await browser.$("[data-reports-tab='comparisons']")).click();
  await expectComparison(browser, "savings", "sipp_financial_institution_assets_median:35-44", 9500, "35–44");

  // ---- Reference person and cohort boundary (Your details) ---------------------------------------------
  await openComparisonDetails(browser);
  await browser.$("[data-cmp-settings]").waitForExist({ timeout: 15000 });
  await chooseMenuOption(await browser.$("button[aria-label^='Household reference person']"), { value: "member:1" });
  await saveSettings(browser);
  await expectComparison(browser, "income", "cps_hinc02_money_income_median:65-69", 100000, "65–69");

  await openComparisonDetails(browser);
  await chooseMenuOption(await browser.$("button[aria-label^='Household reference person']"), { value: "owner" });
  await setInput(browser, "input[aria-label='Age of Me: age']", "44");
  await saveSettings(browser);
  await expectComparison(browser, "income", "cps_hinc02_money_income_median:40-44", 100000, "40–44");

  await openComparisonDetails(browser);
  await setInput(browser, "input[aria-label='Age of Me: age']", "45");
  await saveSettings(browser);
  await expectComparison(browser, "income", "cps_hinc02_money_income_median:45-49", 100000, "45–49");

  console.log("FEATURE 145 E2E TEST PASSED");
} finally {
  await app.close();
}
