// E2E test: a status message never blocks the controls under it (2026-10-02 QA, L5). A success
// message stays up for 10 seconds; clicks on its text reach whatever is underneath, while its own
// Dismiss button still works.
//
// Run with: node e2e/feature161_status_click_through.mjs

import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { seedPopulatedProfile } from "./lib/protection.mjs";

const dbDir = freshTestDbDir();
await seedPopulatedProfile(dbDir); // opening it rolls the balance forward, which shows a success message
const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  const message = await browser.$(".toast-stack .status");
  await message.waitForExist({ timeout: 10000, timeoutMsg: "expected the opening message" });

  const hits = await browser.execute(() => {
    const status = document.querySelector(".toast-stack .status");
    const text = status.querySelector(".status-text").getBoundingClientRect();
    const dismiss = status.querySelector(".status-dismiss").getBoundingClientRect();
    const underText = document.elementFromPoint(text.left + 4, text.top + text.height / 2);
    const onDismiss = document.elementFromPoint(dismiss.left + dismiss.width / 2, dismiss.top + dismiss.height / 2);
    return { textBlocks: status.contains(underText), dismissTakesClicks: Boolean(onDismiss?.closest(".status-dismiss")) };
  });
  assert.equal(hits.textBlocks, false, "a click on the message's text reaches the page underneath");
  assert.equal(hits.dismissTakesClicks, true, "the message's own Dismiss button still takes clicks");

  await (await browser.$(".toast-stack .status-dismiss")).click();
  await browser.waitUntil(async () => !(await browser.$(".toast-stack .status").isExisting()), { timeout: 3000, timeoutMsg: "Dismiss closes the message" });
  console.log("FEATURE 161 E2E TEST PASSED");
} finally {
  await app.close();
}
