// E2E test for Twelve Data as a third live-price provider (core/src/store.rs's
// `provider` column already supports arbitrary strings, so no schema change
// was needed; src-tauri/src/twelve_data.rs, and the third match arm in
// src-tauri/src/live_price_provider.rs's `LivePriceProvider`).
//
// Unlike Finnhub (feature32_finnhub_provider.mjs), Twelve Data's own docs
// actually agree on a confirmed daily cap (800 requests/day), so it reuses
// the exact same daily-hard-stop UI as Alpha Vantage — this test's main job
// is confirming Twelve Data gets that styled used/limit banner, not
// Finnhub's plain no-cap line. Same "purely local persistence, no real
// network call" scope as feature25/feature32 — this never calls
// `refresh_live_prices` or hits a real provider API.
//
// Run with: node e2e/feature33_twelve_data_provider.mjs

import { launchApp, chooseMenuOption, menuSelectValue } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture("");

const app = await launchApp({ dbDir });
try {
  const settingsNav = await app.browser.$("button*=Settings");
  await settingsNav.click();

  const livePricesCard = await app.browser.$("//div[contains(@class,'card')][.//span[text()='Live stock prices']]");
  await livePricesCard.waitForExist({ timeout: 10000 });

  const providerSelect = await livePricesCard.$(".menu-select-toggle");
  await providerSelect.waitForExist({ timeout: 5000 });

  await chooseMenuOption(providerSelect, { label: "Twelve Data" });
  await app.browser.waitUntil(async () => (await menuSelectValue(providerSelect)) === "twelve_data", {
    timeout: 10000,
    timeoutMsg: "expected the provider picker to switch to twelve_data",
  });

  const beforeSaveText = await livePricesCard.getText();
  if (!beforeSaveText.includes("800 requests/day")) {
    throw new Error(`expected Twelve Data's blurb once picked, got:\n${beforeSaveText}`);
  }

  const apiKeyInput = await livePricesCard.$("input[type='password']");
  await apiKeyInput.setValue("demo-twelve-data-key");
  const saveButton = await livePricesCard.$("button*=Save");
  await saveButton.click();

  await app.browser.waitUntil(async () => (await livePricesCard.getText()).includes("Refresh now"), {
    timeout: 10000,
    timeoutMsg: "expected the card to switch to the enabled state after saving a Twelve Data key",
  });
  const enabledText = await livePricesCard.getText();
  console.log("live prices card after enabling with Twelve Data:", enabledText);
  if (!enabledText.includes("using your Twelve Data API key")) {
    throw new Error(`expected the enabled-state explainer to mention Twelve Data, got:\n${enabledText}`);
  }
  // Twelve Data has a confirmed daily cap, so — unlike Finnhub — it should
  // show the same styled used/limit banner Alpha Vantage does, not the
  // plain no-cap line.
  if (!enabledText.includes("0 of 800 requests used today")) {
    throw new Error(`expected the Alpha-Vantage-style "0 of 800 requests used today." banner, got:\n${enabledText}`);
  }
  if (enabledText.includes("no daily cap to track")) {
    throw new Error(`did not expect Finnhub's no-daily-cap copy for Twelve Data, got:\n${enabledText}`);
  }

  const refreshBtn = await livePricesCard.$("button*=Refresh now");
  if (!(await refreshBtn.isEnabled())) {
    throw new Error("expected Refresh now to be enabled at 0/800");
  }
  console.log("Twelve Data enabled state shows the Alpha-Vantage-style daily-limit banner at 0/800");

  const disableButton = await livePricesCard.$("button*=Disable");
  await disableButton.click();

  await app.browser.waitUntil(async () => (await livePricesCard.getText()).includes("Off by default"), {
    timeout: 10000,
    timeoutMsg: "expected the card to return to the disabled/manual-only state after disabling",
  });

  const rememberedProvider = await menuSelectValue(await livePricesCard.$(".menu-select-toggle"));
  if (rememberedProvider !== "twelve_data") {
    throw new Error(`expected the provider picker to remember Twelve Data after disabling, got: ${rememberedProvider}`);
  }
  console.log("disabling remembered Twelve Data as the picker's selection");

  console.log("FEATURE 33 E2E TEST PASSED");
} finally {
  await app.close();
}
