// E2E smoke test for the Help tab's global search box (HelpView.tsx): one
// search input at the top of the page filters every section at once —
// "Getting started"/"Importing transactions"/"Bulk setup-data import/
// export" show or hide as whole cards (they're single ordered
// walkthroughs), while "A tour of the tabs"/"Exporting your data"/"FAQ"
// filter at the individual-item level and disappear entirely once they
// have zero visible items. A query with no matches anywhere shows one
// page-level "no results" message instead of a wall of empty cards.
//
// Run with: node e2e/feature26_help_search.mjs

import { launchApp, reclaimWindowFocus } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture("");

const app = await launchApp({ dbDir });
try {
  const helpNav = await app.browser.$("button*=Help");
  await helpNav.click();

  const searchInput = await app.browser.$(".help-search");
  await searchInput.waitForExist({ timeout: 10000 });
  const helpPage = await app.browser.$(".help-view");

  const beforeText = await helpPage.getText();
  const expectedHeadings = [
    "Getting started",
    "A tour of the tabs",
    "Importing transactions",
    "Bulk setup-data import/export",
    "Exporting your data",
    "FAQ",
  ];
  for (const heading of expectedHeadings) {
    if (!beforeText.includes(heading)) {
      throw new Error(`expected "${heading}" visible with no search query, got:\n${beforeText}`);
    }
  }
  if (!beforeText.includes("Is my data private?") || !beforeText.includes("Dashboard")) {
    throw new Error(`expected FAQ and tab-tour content visible with no search query, got:\n${beforeText}`);
  }
  console.log("every section visible by default");

  // "backup" is tagged on exactly one tour-of-tabs bullet (Settings) and
  // exactly one FAQ entry — and nothing else — so it proves both true
  // global filtering (unrelated cards disappear entirely) and per-item
  // filtering within a card (only the matching bullet/question survives).
  await searchInput.setValue("backup");

  await app.browser.waitUntil(
    async () => {
      const text = await helpPage.getText();
      return (
        text.includes("How do automatic backups work") &&
        text.includes("A tour of the tabs") &&
        text.includes("Settings") &&
        !text.includes("Getting started") &&
        !text.includes("Dashboard") &&
        !text.includes("Is my data private?")
      );
    },
    { timeout: 10000, timeoutMsg: 'expected "backup" to narrow the whole page down to just the matching tour bullet and FAQ entry' },
  );
  console.log("global search narrowed every section correctly, at the right granularity");

  // `.setValue("")` doesn't reliably clear a controlled React input in this
  // WebView — same class of issue as the inline-rename race documented in
  // feature18_recurring_edit.mjs. Select-all + Backspace is what works.
  await reclaimWindowFocus(app.browser);
  await searchInput.click();
  await app.browser.keys(["Control", "a"]);
  await app.browser.keys("Backspace");
  await app.browser.waitUntil(
    async () => (await helpPage.getText()).includes("Getting started"),
    { timeout: 10000, timeoutMsg: "expected clearing the search to restore every section" },
  );
  console.log("clearing the search restored the full page");

  await searchInput.setValue("password protection");
  await app.browser.waitUntil(
    async () => {
      const text = await helpPage.getText();
      return text.includes("How does password protection work?") && text.includes("recovery key");
    },
    { timeout: 10000, timeoutMsg: 'expected Help search to find the password-protection and recovery guidance' },
  );
  console.log("password protection has a searchable Help topic");

  await reclaimWindowFocus(app.browser);
  await searchInput.click();
  await app.browser.keys(["Control", "a"]);
  await app.browser.keys("Backspace");

  await searchInput.setValue("mobile snapshots");
  await app.browser.waitUntil(async () => {
    const text = await helpPage.getText();
    return text.includes("How do I set up mobile snapshots on my phone?") &&
      text.includes("Can I use mobile snapshots away from my computer?") &&
      text.includes("How do I stop phone access or remove mobile snapshots?") &&
      text.includes("Ready offline") && text.includes("No desktop control can remotely erase") &&
      !text.includes("Getting started");
  }, { timeout: 10000, timeoutMsg: "mobile setup, offline and removal guidance should be searchable together" });
  await reclaimWindowFocus(app.browser);
  await searchInput.click();
  await app.browser.keys(["Control", "a"]);
  await app.browser.keys("Backspace");

  await searchInput.setValue("zzzznonexistentquery");
  await app.browser.waitUntil(
    async () => {
      const text = await helpPage.getText();
      return text.includes("No results") && !text.includes("Getting started") && !text.includes("FAQ");
    },
    { timeout: 10000, timeoutMsg: "expected a single page-level no-results message for a query with zero matches anywhere" },
  );
  console.log("a query with no matches anywhere shows one page-level no-results message");

  console.log("FEATURE 26 E2E TEST PASSED");
} finally {
  await app.close();
}
