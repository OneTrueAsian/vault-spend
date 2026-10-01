// Reports > Comparisons navigation, first-use setup and persistence in the real compiled app:
//   - Reports keeps its sidebar entry and opens on Overview, unchanged; there is no new sidebar page;
//   - the tablist is keyboard operable and Overview keeps its date range while Comparisons is open;
//   - first use shows a setup prompt, saving it persists across a restart, and the saved age stays
//     separate from Overview's range;
//   - Household / Individual mode is NOT switchable on the cards; it lives in the "Your details" panel under them,
//     which Settings no longer carries.
//
// Run with: node e2e/feature144_comparisons_navigation.mjs
import assert from "node:assert/strict";
import { launchApp, reclaimWindowFocus } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { nav, openReportsTab, setInput, waitForCards } from "./lib/comparisons.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
`);

let app = await launchApp({ dbDir });
try {
  let { browser } = app;
  await browser.setWindowSize(1440, 1400);

  // Sidebar: Reports is still the only entry, and no Comparisons page was added.
  const labels = [];
  for (const b of await browser.$$("nav button")) labels.push((await b.getText()).trim());
  assert.ok(labels.includes("Reports"), `Reports should still be in the sidebar, got ${labels}`);
  assert.ok(!labels.some((l) => /comparison/i.test(l)), `there must be no Comparisons sidebar entry, got ${labels}`);

  // Settings no longer carries a Comparisons section: the form lives on the Comparisons tab.
  await nav(browser, "Settings");
  await browser.$("//span[contains(@class,'reports-section-title')][text()='Appearance']").waitForExist({ timeout: 15000 });
  assert.equal((await browser.$$("[data-cmp-settings]")).length, 0, "Settings must not hold the comparison form any more");

  await nav(browser, "Reports");
  await browser.$("[data-reports-hub]").waitForExist({ timeout: 15000 });
  assert.equal((await browser.$$(".page h1")).length, 1, "Reports has exactly one h1");
  assert.equal(await (await browser.$(".page h1")).getText(), "Reports");
  const overviewTab = await browser.$("[data-reports-tab='overview']");
  assert.equal(await overviewTab.getAttribute("aria-selected"), "true", "Overview is selected first");
  assert.equal(await (await browser.$("[role='tablist']")).isDisplayed(), true);
  await browser.$("[data-report-summary]").waitForExist({ timeout: 15000, timeoutMsg: "the familiar report summary is intact" });
  assert.ok((await (await browser.$("[data-reports-hub]")).getText()).includes("Export CSV"), "the report page keeps its export controls");

  // Overview's date range survives a trip to Comparisons.
  await (await browser.$("[data-range-preset='current_month']")).click();
  await browser.waitUntil(async () => (await (await browser.$("[data-range-preset='current_month']")).getAttribute("class")).includes("view-toggle-active"), { timeout: 5000 });
  const rangeBefore = await (await browser.$("[data-reports-hub]")).getAttribute("data-report-range");

  // Keyboard: the roving tab stop and arrow keys.
  await reclaimWindowFocus(browser);
  await overviewTab.click();
  await browser.keys("ArrowRight");
  await browser.waitUntil(async () => (await (await browser.$("[data-reports-tab='comparisons']")).getAttribute("aria-selected")) === "true", { timeout: 5000, timeoutMsg: "ArrowRight should select Comparisons" });
  assert.equal(await (await browser.$("[data-reports-tab='overview']")).getAttribute("tabindex"), "-1");
  assert.equal(await (await browser.$("[data-reports-tab='comparisons']")).getAttribute("tabindex"), "0");
  assert.equal(await browser.execute(() => document.activeElement?.getAttribute("data-reports-tab")), "comparisons", "focus follows the selection");
  assert.equal(await (await browser.$("[data-reports-hub]")).isDisplayed(), false, "Overview is hidden, not shown beside Comparisons");
  await browser.keys("Home");
  await browser.waitUntil(async () => (await (await browser.$("[data-reports-tab='overview']")).getAttribute("aria-selected")) === "true", { timeout: 5000 });
  await browser.keys("End");
  await browser.waitUntil(async () => (await (await browser.$("[data-reports-tab='comparisons']")).getAttribute("aria-selected")) === "true", { timeout: 5000 });

  // First use: nothing is configured, so there is a prompt and no cards, and no mode switch on the page.
  await browser.$("[data-cmp-unconfigured]").waitForExist({ timeout: 15000 });
  assert.equal((await browser.$$("[data-comparisons-page] [data-metric]")).length, 0);
  assert.equal((await browser.$$("[data-cmp-mode-switch], [data-comparisons-page] [role='switch']")).length, 0);
  assert.ok(!(await (await browser.$("[data-comparisons-page]")).getText()).includes("Comparison settings"), "no on-page settings button");
  const navActive = await browser.execute(() => document.querySelector("nav .nav-item-active")?.textContent?.trim());
  assert.equal(navActive, "Reports", "Reports stays the active sidebar item");

  // Overview kept its range while hidden.
  await (await browser.$("[data-reports-tab='overview']")).click();
  assert.equal(await (await browser.$("[data-reports-hub]")).getAttribute("data-report-range"), rangeBefore);
  assert.ok((await (await browser.$("[data-range-preset='current_month']")).getAttribute("class")).includes("view-toggle-active"));

  // Set up through the dialog: validation first, then a real save.
  await (await browser.$("[data-reports-tab='comparisons']")).click();
  await (await browser.$("[data-cmp-start-setup]")).click();
  await browser.$("[data-cmp-setup]").waitForExist({ timeout: 10000 });
  await (await browser.$("[data-cmp-setup-save]")).click();
  await browser.waitUntil(async () => (await (await browser.$("[data-cmp-setup] [role='alert']")).getText()).includes("Enter an age"), { timeout: 5000, timeoutMsg: "saving without an age should explain why not" });
  await setInput(browser, "[data-cmp-setup] [data-cmp-age]", "4x");
  await browser.waitUntil(async () => (await (await browser.$("[data-cmp-setup] .cmp-field-error")).getText()).includes("18 to 120"), { timeout: 5000 });
  await setInput(browser, "[data-cmp-setup] [data-cmp-age]", "42");
  await (await browser.$("[data-cmp-setup-save]")).click();
  await browser.$("[data-cmp-unconfigured]").waitForExist({ reverse: true, timeout: 15000 });
  await browser.$("[data-cmp-grid]").waitForExist({ timeout: 15000 });

  // Missing details hide their cards; the household has no published spending benchmark, so that card stays.
  await waitForCards(browser);
  const shown = [];
  for (const c of await browser.$$("[data-comparisons-page] [data-metric]")) shown.push(await c.getAttribute("data-metric"));
  assert.deepEqual(shown, ["spending"], `only the benchmark-gap card is visible before any details are entered, got ${shown}`);
  const note = await (await browser.$("[data-cmp-hidden-note]")).getText();
  assert.ok(note.includes("Show your details") && !note.includes("Settings"), `the page offers the details panel, got: ${note}`);

  // The panel opens by itself because cards are waiting for details; it is on this page, not in Settings.
  assert.equal(await (await browser.$("[data-cmp-details-toggle]")).getAttribute("aria-expanded"), "true", "the panel starts open when a card is waiting");
  await browser.$("[data-cmp-details-body] [data-cmp-settings]").waitForDisplayed({ timeout: 15000 });
  assert.ok((await (await browser.$("[data-cmp-settings]")).getText()).includes("Who is compared"));

  // Its stylesheet must be applied: the visually hidden labels are really hidden and the grouped fieldsets
  // are not the browser default.
  const styled = await browser.execute(() => {
    const hidden = getComputedStyle(document.querySelector(".cmp-sr-label"));
    const age = getComputedStyle(document.querySelector(".cmp-age-field"));
    return { position: hidden.position, width: hidden.width, ageBorder: age.borderTopStyle };
  });
  assert.equal(styled.position, "absolute", `the hidden labels must be visually hidden, got ${JSON.stringify(styled)}`);
  assert.equal(styled.width, "1px");
  assert.equal(styled.ageBorder, "none", "the age field group must not have the browser's default fieldset border");

  // Collapsing hides the form; the hint button brings it back.
  await (await browser.$("[data-cmp-details-toggle]")).click();
  await browser.$("[data-cmp-details-body]").waitForDisplayed({ reverse: true, timeout: 5000 });
  await (await browser.$("[data-cmp-hidden-note] button")).click();
  await browser.$("[data-cmp-details-body] [data-cmp-settings]").waitForDisplayed({ timeout: 5000 });
  await setInput(browser, "input[aria-label='Household income per year']", "85000");
  await setInput(browser, "[data-cmp-amount='Household income per year'] input[placeholder^='Where this came from']", "Tax return");
  await (await browser.$("[data-cmp-settings-save]")).click();
  await browser.waitUntil(async () => (await (await browser.$("[data-cmp-settings-message]")).getText()) === "Saved.", { timeout: 15000, timeoutMsg: "the details panel should save" });

  // No trip to another page: the income card appears on this page as soon as the form is saved.
  await browser.$("[data-comparisons-page] [data-metric='income']").waitForExist({ timeout: 20000, timeoutMsg: "the income card appears once its input exists" });
  assert.ok((await (await browser.$("[data-metric='income'] [data-cmp-local]")).getText()).includes("$85,000"));

  // Persistence: a restart keeps the setup (no first-use prompt) and Reports starts on Overview again.
  await app.close();
  app = await launchApp({ dbDir });
  browser = app.browser;
  await browser.setWindowSize(1440, 1400);
  await nav(browser, "Reports");
  await browser.$("[data-reports-hub]").waitForExist({ timeout: 15000 });
  assert.equal(await (await browser.$("[data-reports-tab='overview']")).getAttribute("aria-selected"), "true", "the tab is not remembered across restarts");
  await (await browser.$("[data-reports-tab='comparisons']")).click();
  await browser.$("[data-comparisons-page] [data-metric='income']").waitForExist({ timeout: 20000 });
  assert.equal((await browser.$$("[data-cmp-unconfigured]")).length, 0);
  assert.ok((await (await browser.$("[data-metric='income'] [data-cmp-local]")).getText()).includes("$85,000"));

  console.log("FEATURE 144 E2E TEST PASSED");
} finally {
  await app.close();
}
