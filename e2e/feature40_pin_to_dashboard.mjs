// E2E test for "Pin to Dashboard": clicking it on Investments' Allocation
// section adds that widget to the Dashboard's layout and flips the button
// to a static "Pinned ✓" (not a second, duplicate pin), and the widget
// actually shows up on the Dashboard itself.
//
// Run with: node e2e/feature40_pin_to_dashboard.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

async function invoke(browser, command, args = {}) {
  return browser.executeAsync((command, args, done) => {
    window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ error: String(e) }));
  }, command, args);
}

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Brokerage', 'investment', '0')")
brokerage_id = cur.lastrowid
cur.execute(
    "INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?, 'VTI', 'Vanguard Total Stock', 10, 250.00, 2000.00, 'US Stocks')",
    (brokerage_id,),
)
`);

const app = await launchApp({ dbDir });
try {
  const investmentsNav = await app.browser.$("button*=Investments");
  await investmentsNav.click();

  const cardHead = await app.browser.$("//div[contains(@class,'card-head')][span[text()='Allocation']]");
  await cardHead.waitForExist({ timeout: 10000 });
  const button = await cardHead.$("button=Pin to Dashboard");
  await button.waitForExist({ timeout: 5000 });
  await button.click();

  const pinnedLabel = await cardHead.$(".pin-widget-pinned");
  await pinnedLabel.waitForExist({ timeout: 5000 });
  const pinnedText = await pinnedLabel.getText();
  if (!pinnedText.includes("Pinned")) throw new Error(`expected the button to flip to "Pinned", got "${pinnedText}"`);
  console.log("Allocation's Pin to Dashboard button flipped to:", pinnedText);

  // The persisted layout now lands via a backend round trip (get_current_generation, then
  // set_profile_ui_state) instead of a synchronous localStorage write — poll rather than reading once
  // immediately after the click resolves.
  let layout;
  await app.browser.waitUntil(
    async () => {
      layout = JSON.parse(await invoke(app.browser, "get_profile_ui_state", { key: "dashboard_layout" }));
      return layout.includes("allocation");
    },
    { timeout: 5000, timeoutMsg: () => `expected "allocation" in the persisted layout, got ${JSON.stringify(layout)}` },
  );

  const dashboardNav = await app.browser.$("button*=Dashboard");
  await dashboardNav.click();

  const allocationWidget = await app.browser.$("//span[contains(@class,'reports-section-title')][text()='Allocation']");
  await allocationWidget.waitForExist({ timeout: 10000 });
  console.log("Allocation widget appears on the Dashboard after pinning");

  console.log("FEATURE 40 E2E TEST PASSED");
} finally {
  await app.close();
}
