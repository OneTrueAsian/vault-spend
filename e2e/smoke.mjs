// Sanity check for the E2E harness itself: launches the real compiled app
// (against a throwaway database, never the user's real one), confirms the
// window loads and the sidebar nav is present, then exits.
// Run with: node e2e/smoke.mjs

import { launchApp } from "./harness.mjs";

const app = await launchApp();
try {
  const brand = await app.browser.$(".brand-word");
  const brandText = await brand.getText();

  const navButtons = await app.browser.$$("nav button");

  if (brandText !== "Vault Spend") throw new Error(`expected brand "Vault Spend", got "${brandText}"`);
  if (navButtons.length < 1) throw new Error("expected at least one nav button");

  console.log("SMOKE TEST PASSED —", navButtons.length, "nav buttons found, brand:", brandText);
} finally {
  await app.close();
}
