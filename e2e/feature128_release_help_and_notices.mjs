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
    (text) =>
      text.includes("15 minutes") &&
      text.includes("10-second warning") &&
      text.includes("Stay unlocked") &&
      text.includes("macOS") &&
      text.includes("Settings → Password protection → Automatic locking") &&
      unrelatedGone(text),
    "automatic-lock guidance should be searchable, with its defaults and warning",
  );

  await searchFor(
    "recovery key",
    (text) =>
      text.includes("lose my recovery key") && text.includes("Forgot your password?") && text.includes("removed from the profile list") && unrelatedGone(text),
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

  // The third-party notices: findable by component name, opened from the keyboard, complete and
  // readable inside a narrow window, and available without any network request.
  await searchFor(
    "sqlcipher",
    (text) => text.includes("Read third-party notices") && unrelatedGone(text),
    "the third-party notices should be searchable by component name",
  );
  await searchFor(
    "openssl",
    (text) => text.includes("Read third-party notices") && unrelatedGone(text),
    "the third-party notices should be searchable by OpenSSL too",
  );
  await browser.setWindowSize(390, 900);
  // Everything the page has fetched, minus the app's own IPC (Tauri sends every command as a fetch to
  // ipc.localhost, and a background command landing in this window once counted as a "load").
  const loadedResources = () =>
    browser.execute(() => performance.getEntriesByType("resource").map((r) => r.name).filter((name) => !name.startsWith("http://ipc.localhost/")));
  const resourcesBefore = await loadedResources();
  const summary = await browser.$(".third-party-notices summary");
  await summary.scrollIntoView();
  await reclaimWindowFocus(browser);
  if (await browser.$(".third-party-notices pre").isDisplayed()) throw new Error("the notices should start collapsed");
  await browser.execute(() => document.querySelector(".third-party-notices summary").focus());
  await browser.keys("Enter");
  await browser.waitUntil(async () => (await browser.$(".third-party-notices pre").isDisplayed()), {
    timeout: 5000,
    timeoutMsg: "pressing Enter on the summary should open the notices",
  });
  const notices = await browser.$(".third-party-notices pre").getText();
  for (const expected of [
    "SQLCipher 4.5.7",
    "Zetetic LLC",
    "Redistributions in binary form must reproduce the above copyright",
    "OpenSSL 3.6.3",
    "Apache License",
    "Version 2.0, January 2004",
    "END OF TERMS AND CONDITIONS",
  ]) {
    if (!notices.includes(expected)) throw new Error(`the notices should contain "${expected}"`);
  }
  const fit = await browser.execute(() => {
    const pre = document.querySelector(".third-party-notices pre");
    return { preScroll: pre.scrollWidth, preClient: pre.clientWidth, docScroll: document.documentElement.scrollWidth, docClient: document.documentElement.clientWidth };
  });
  if (fit.preScroll > fit.preClient + 1) throw new Error(`the notices must wrap instead of scrolling sideways: ${JSON.stringify(fit)}`);
  if (fit.docScroll > fit.docClient + 1) throw new Error(`opening the notices must not make the page scroll sideways: ${JSON.stringify(fit)}`);
  const loadedSince = (await loadedResources()).slice(resourcesBefore.length);
  if (loadedSince.length) throw new Error(`opening the notices must not load anything, but loaded: ${loadedSince.join(", ")}`);

  // Settings marks password protection as new — for a profile that has not turned it on too.
  await browser.setWindowSize(1300, 1000);
  await (await browser.$("button*=Settings")).click();
  const badge = await browser.$(".protection-new-badge");
  await badge.waitForExist({ timeout: 10000, timeoutMsg: "Settings should mark password protection as new" });
  if ((await badge.getText()).trim() !== "New") throw new Error("the label should read New");
  // Help sends people to "Settings → Password protection": that heading must be the one the badge sits in.
  const cardTitle = await badge.parentElement().getText();
  if (!cardTitle.startsWith("Password protection")) throw new Error(`Help names the "Password protection" heading, but Settings shows "${cardTitle}"`);
  if (await badge.parentElement().$("button").isExisting()) throw new Error("the New label must not be interactive");

  console.log("FEATURE 128 E2E TEST PASSED");
} finally {
  await app.close();
}
