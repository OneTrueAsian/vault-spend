// Phase F release guidance in the compiled app: the Help tab's global search finds the password
// protection, recovery, automatic-lock, old-password-restore, plaintext-copy and Windows-session
// guidance (and filters unrelated cards out), and the "Hide amounts" FAQ no longer claims the
// data file is unencrypted. Assertions target the specific guidance, not every paragraph.
//
// Run with: node e2e/run-all.mjs --spec=128

import { launchApp, reclaimWindowFocus } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture("");
const app = await launchApp({ dbDir });

async function clearSearch(browser, input) {
  // Other specs' windows launching in parallel take OS foreground, which would send the select-all
  // keystrokes to the wrong window (see reclaimWindowFocus in harness.mjs).
  await reclaimWindowFocus(browser);
  await input.click();
  await browser.keys(["Control", "a"]);
  await browser.keys("Backspace");
}

try {
  const { browser } = app;
  await (await browser.$("button*=Help")).click();
  const searchInput = await browser.$(".help-search");
  await searchInput.waitForExist({ timeout: 10000 });
  const helpPage = await browser.$(".help-view");

  async function searchFor(query, isSatisfied, why) {
    await clearSearch(browser, searchInput);
    await searchInput.setValue(query);
    await browser.waitUntil(async () => isSatisfied(await helpPage.getText()), { timeout: 10000, timeoutMsg: `${query}: ${why}` });
    console.log(`found guidance for "${query}"`);
  }
  const unrelatedGone = (text) => !text.includes("Getting started") && !text.includes("Is my data private?");

  await searchFor(
    "automatic lock",
    (text) => text.includes("15 minutes") && text.includes("10-second warning") && text.includes("Stay unlocked") && text.includes("macOS") && unrelatedGone(text),
    "automatic-lock guidance should be searchable, with its defaults and warning",
  );

  await searchFor(
    "recovery key",
    (text) => text.includes("lose my recovery key") && text.includes("removed from the profile list") && unrelatedGone(text),
    "forgotten-password and lost-recovery-key guidance should be searchable",
  );

  await searchFor(
    "old password",
    (text) => text.includes("Can I restore an old backup after changing my password?") && text.includes("older password") && unrelatedGone(text),
    "old-password restore guidance should be searchable",
  );

  await searchFor(
    "plaintext copies",
    (text) => text.includes("Delete plaintext copies now") && text.includes("CSV") && text.includes("second backup folder") && unrelatedGone(text),
    "the guidance about copies that stay unencrypted should be searchable",
  );

  await searchFor(
    "Windows session",
    (text) => text.includes("Windows locks or sleeps") && text.includes("macOS") && unrelatedGone(text),
    "the Windows session lock trigger should be searchable, and say macOS has none",
  );

  await searchFor(
    "hide amounts",
    (text) =>
      text.includes("Hide amounts changes only what is shown on screen. Use password protection to encrypt a profile's stored data.") &&
      !text.includes("isn't encrypted"),
    "the Hide amounts FAQ should no longer say the data file isn't encrypted",
  );

  console.log("FEATURE 128 E2E TEST PASSED");
} finally {
  await app.close();
}
