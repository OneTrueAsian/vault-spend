// E2E test for StockData.org as a fourth live-price provider
// (src-tauri/src/stockdata.rs, and the fourth match arm in
// src-tauri/src/live_price_provider.rs's `LivePriceProvider`).
//
// StockData.org has a confirmed daily cap (100 requests/day, like Alpha
// Vantage and Twelve Data), so it should get the same styled used/limit
// banner they do, not Finnhub's plain no-cap line. Same "purely local
// persistence, no real network call" scope as feature25/32/33 — this never
// calls `refresh_live_prices` or hits a real provider API, so it doesn't
// exercise the batching (3-symbols-per-request) behavior itself — that's
// covered by stockdata.rs's own unit tests instead.
//
// Run with: node e2e/feature35_stockdata_provider.mjs

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

  await chooseMenuOption(providerSelect, { label: "StockData.org" });
  await app.browser.waitUntil(async () => (await menuSelectValue(providerSelect)) === "stockdata_org", {
    timeout: 10000,
    timeoutMsg: "expected the provider picker to switch to stockdata_org",
  });

  const beforeSaveText = await livePricesCard.getText();
  if (!beforeSaveText.includes("100 requests/day") || !beforeSaveText.includes("3 symbols")) {
    throw new Error(`expected StockData.org's batching blurb once picked, got:\n${beforeSaveText}`);
  }

  const apiKeyInput = await livePricesCard.$("input[type='password']");
  await apiKeyInput.setValue("demo-stockdata-key");
  const saveButton = await livePricesCard.$("button*=Save");
  await saveButton.click();

  await app.browser.waitUntil(async () => (await livePricesCard.getText()).includes("Refresh now"), {
    timeout: 10000,
    timeoutMsg: "expected the card to switch to the enabled state after saving a StockData.org key",
  });
  const enabledText = await livePricesCard.getText();
  console.log("live prices card after enabling with StockData.org:", enabledText);
  if (!enabledText.includes("using your StockData.org API key")) {
    throw new Error(`expected the enabled-state explainer to mention StockData.org, got:\n${enabledText}`);
  }
  // StockData.org has a confirmed daily cap, so — like Twelve Data — it
  // should show the same styled used/limit banner Alpha Vantage does, not
  // Finnhub's plain no-cap line.
  if (!enabledText.includes("0 of 100 requests used today")) {
    throw new Error(`expected the Alpha-Vantage-style "0 of 100 requests used today." banner, got:\n${enabledText}`);
  }
  if (enabledText.includes("no daily cap to track")) {
    throw new Error(`did not expect Finnhub's no-daily-cap copy for StockData.org, got:\n${enabledText}`);
  }

  const refreshBtn = await livePricesCard.$("button*=Refresh now");
  if (!(await refreshBtn.isEnabled())) {
    throw new Error("expected Refresh now to be enabled at 0/100");
  }
  console.log("StockData.org enabled state shows the Alpha-Vantage-style daily-limit banner at 0/100");

  const disableButton = await livePricesCard.$("button*=Disable");
  await disableButton.click();

  await app.browser.waitUntil(async () => (await livePricesCard.getText()).includes("Off by default"), {
    timeout: 10000,
    timeoutMsg: "expected the card to return to the disabled/manual-only state after disabling",
  });

  const rememberedProvider = await menuSelectValue(await livePricesCard.$(".menu-select-toggle"));
  if (rememberedProvider !== "stockdata_org") {
    throw new Error(`expected the provider picker to remember StockData.org after disabling, got: ${rememberedProvider}`);
  }
  console.log("disabling remembered StockData.org as the picker's selection");

  console.log("FEATURE 35 E2E TEST PASSED");
} finally {
  await app.close();
}
