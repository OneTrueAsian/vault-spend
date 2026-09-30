// E2E test for Finnhub as a second, alternative live-price provider
// alongside Alpha Vantage (core/src/store.rs's `provider` column,
// src-tauri/src/finnhub.rs, src-tauri/src/live_price_provider.rs,
// commands.rs's `set_live_price_settings`/`get_live_price_settings`).
// Confirms: the provider picker defaults to Alpha Vantage, switching it
// to Finnhub and saving a key produces Finnhub-specific copy with no
// daily-limit warning styling (Finnhub's real limit is per-minute, not
// per-day — see the plan's Context section), "Refresh now" is never
// disabled for Finnhub (no local cap to hit), and disabling remembers the
// previously-active provider rather than resetting to Alpha Vantage. Same
// "purely local persistence, no real network call" scope as
// feature25_live_prices.mjs — this never calls `refresh_live_prices` or
// hits a real provider API.
//
// Run with: node e2e/feature32_finnhub_provider.mjs

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
  const initialProvider = await menuSelectValue(providerSelect);
  if (initialProvider !== "alpha_vantage") {
    throw new Error(`expected the provider picker to default to alpha_vantage, got: ${initialProvider}`);
  }
  console.log("provider picker defaults to Alpha Vantage");

  await chooseMenuOption(providerSelect, { label: "Finnhub" });
  await app.browser.waitUntil(async () => (await menuSelectValue(providerSelect)) === "finnhub", {
    timeout: 10000,
    timeoutMsg: "expected the provider picker to switch to finnhub",
  });

  const beforeSaveText = await livePricesCard.getText();
  if (!beforeSaveText.includes("Finnhub's free tier allows 60 requests/minute")) {
    throw new Error(`expected Finnhub's blurb once picked, got:\n${beforeSaveText}`);
  }

  const apiKeyInput = await livePricesCard.$("input[type='password']");
  await apiKeyInput.setValue("demo-finnhub-key");
  const saveButton = await livePricesCard.$("button*=Save");
  await saveButton.click();

  await app.browser.waitUntil(async () => (await livePricesCard.getText()).includes("Refresh now"), {
    timeout: 10000,
    timeoutMsg: "expected the card to switch to the enabled state after saving a Finnhub key",
  });
  const enabledText = await livePricesCard.getText();
  console.log("live prices card after enabling with Finnhub:", enabledText);
  if (!enabledText.includes("using your Finnhub API key")) {
    throw new Error(`expected the enabled-state explainer to mention Finnhub, got:\n${enabledText}`);
  }
  if (!enabledText.includes("there's no daily cap to track")) {
    throw new Error(`expected the no-daily-cap line for Finnhub, got:\n${enabledText}`);
  }
  if (enabledText.includes("Daily limit reached") || enabledText.includes("getting close to the daily limit")) {
    throw new Error(`did not expect any Alpha-Vantage-style daily-limit copy for Finnhub, got:\n${enabledText}`);
  }

  const refreshBtn = await livePricesCard.$("button*=Refresh now");
  if (!(await refreshBtn.isEnabled())) {
    throw new Error("expected Refresh now to stay enabled for Finnhub — there's no local daily cap to hit");
  }
  console.log("Finnhub enabled state shows Finnhub-specific copy, Refresh now stays enabled");

  const disableButton = await livePricesCard.$("button*=Disable");
  await disableButton.click();

  await app.browser.waitUntil(async () => (await livePricesCard.getText()).includes("Off by default"), {
    timeout: 10000,
    timeoutMsg: "expected the card to return to the disabled/manual-only state after disabling",
  });

  const rememberedProvider = await menuSelectValue(await livePricesCard.$(".menu-select-toggle"));
  if (rememberedProvider !== "finnhub") {
    throw new Error(`expected the provider picker to remember Finnhub after disabling, got: ${rememberedProvider}`);
  }
  console.log("disabling remembered Finnhub as the picker's selection");

  console.log("FEATURE 32 E2E TEST PASSED");
} finally {
  await app.close();
}
