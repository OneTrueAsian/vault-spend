// E2E test: a status message never blocks the controls under it (2026-10-02 QA, L5). A success
// message stays up for 10 seconds; clicks on its text reach whatever is underneath, while its own
// Dismiss button still works.
//
// Run with: node e2e/feature161_status_click_through.mjs

import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { seedPopulatedProfile } from "./lib/protection.mjs";

const dbDir = freshTestDbDir();
await seedPopulatedProfile(dbDir); // opening it rolls the balance forward, which shows a success message
const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  // Where a click on the open message lands: on its text (it must pass through) and on its Dismiss button.
  // null when no message is open.
  const measure = () =>
    browser.execute(() => {
      const status = document.querySelector(".toast-stack .status");
      if (!status) return null;
      const text = status.querySelector(".status-text").getBoundingClientRect();
      const dismiss = status.querySelector(".status-dismiss").getBoundingClientRect();
      const underText = document.elementFromPoint(text.left + 4, text.top + text.height / 2);
      const onDismiss = document.elementFromPoint(dismiss.left + dismiss.width / 2, dismiss.top + dismiss.height / 2);
      return { textBlocks: status.contains(underText), dismissTakesClicks: Boolean(onDismiss?.closest(".status-dismiss")) };
    });
  // A success message closes itself after 10 s, and under a full parallel run the launch alone can take
  // that long, so the opening message may already be gone (or go between finding and measuring it): then
  // make one the way a person would, with Settings > Back up now.
  async function backUpNow() {
    await (await browser.$(".nav-item[data-tab=settings]")).click();
    const backUp = await browser.$("button=Back up now");
    await backUp.waitForExist({ timeout: 10000, timeoutMsg: "Settings should offer Back up now" });
    await backUp.scrollIntoView({ block: "center" });
    await backUp.click();
  }
  let hits = null;
  // Only "no message within 5 s" means falling back to Back up now; any other error is a real failure.
  await waitUntilOrDiagnose(browser, async () => (hits = await measure()) !== null, { timeout: 5000 }).catch((e) => {
    if (!/waitUntil condition timed out/.test(e.message)) throw e;
  });
  if (hits === null) {
    await backUpNow();
    await waitUntilOrDiagnose(browser, async () => (hits = await measure()) !== null, {
      timeoutMsg: "expected the opening message, or Back up now's message",
    });
  }
  assert.equal(hits.textBlocks, false, "a click on the message's text reaches the page underneath");
  assert.equal(hits.dismissTakesClicks, true, "the message's own Dismiss button still takes clicks");

  // The message may have closed itself since it was measured; Dismiss needs one that is still open.
  if (!(await browser.$(".toast-stack .status-dismiss").isExisting())) await backUpNow();
  const dismiss = await browser.$(".toast-stack .status-dismiss");
  await dismiss.waitForExist({ timeout: 10000, timeoutMsg: "a message with a Dismiss button should be open" });
  await dismiss.click();
  await browser.waitUntil(async () => !(await browser.$(".toast-stack .status").isExisting()), { timeout: 3000, timeoutMsg: "Dismiss closes the message" });
  console.log("FEATURE 161 E2E TEST PASSED");
} finally {
  await app.close();
}
