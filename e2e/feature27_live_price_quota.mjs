// E2E test for the Alpha Vantage daily-quota tracker: seeds
// `live_price_settings.requests_used_today` directly (no real network
// calls — this proves the UI reacts correctly to a given count, not that a
// real refresh happened) at two points — "approaching" and "at the limit"
// — and confirms Settings shows the right warning tier and disables
// "Refresh now" only once the limit is actually hit. The proactive
// stop-before-25 behavior itself lives in commands.rs's `refresh_live_prices`
// (see its own Rust doc comment) and isn't re-verified here, since it needs
// a real Alpha Vantage key to exercise end-to-end.
//
// Run with: node e2e/feature27_live_price_quota.mjs

import { launchApp, openSettingsGroup } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

async function seedWithUsage(usedToday) {
  return seedFixture(`
import datetime
today = datetime.date.today().isoformat()
cur.execute(
    "INSERT INTO live_price_settings (id, api_key, requests_used_today, requests_count_date) VALUES (1, 'test-key', ?, ?)",
    (${usedToday}, today),
)
`);
}

async function checkLivePricesCard(dbDir, check) {
  const app = await launchApp({ dbDir });
  try {
    const settingsNav = await app.browser.$("button*=Settings");
    await settingsNav.click();
    await openSettingsGroup(app.browser, "features");
    const livePricesCard = await app.browser.$("//div[contains(@class,'card')][.//*[contains(@class,'reports-section-title')][text()='Live stock prices']]");
    await livePricesCard.waitForExist({ timeout: 10000 });
    await check(app, livePricesCard);
  } finally {
    await app.close();
  }
}

// Approaching the limit (21/25): a visible warning, but refreshing is
// still allowed.
await checkLivePricesCard(await seedWithUsage(21), async (app, card) => {
  const text = await card.getText();
  console.log("card text at 21/25:", text);
  if (!text.includes("21 of 25 requests used today") || !text.includes("getting close to the daily limit")) {
    throw new Error(`expected an approaching-limit warning at 21/25, got:\n${text}`);
  }
  const refreshBtn = await card.$("button*=Refresh now");
  if (!(await refreshBtn.isEnabled())) {
    throw new Error("expected Refresh now to still be enabled before the limit is actually reached");
  }
  console.log("21/25 shows the approaching-limit warning, Refresh now still enabled");
});

// At the limit (25/25): the "reached" message, and refreshing disabled —
// the button itself reflects that the backend will no longer pull data.
await checkLivePricesCard(await seedWithUsage(25), async (app, card) => {
  const text = await card.getText();
  console.log("card text at 25/25:", text);
  if (!text.includes("Daily limit reached (25/25)")) {
    throw new Error(`expected the daily-limit-reached message at 25/25, got:\n${text}`);
  }
  const refreshBtn = await card.$("button*=Refresh now");
  if (await refreshBtn.isEnabled()) {
    throw new Error("expected Refresh now to be disabled once the daily limit is reached");
  }
  console.log("25/25 shows the limit-reached message, Refresh now disabled");
});

console.log("FEATURE 27 E2E TEST PASSED");
