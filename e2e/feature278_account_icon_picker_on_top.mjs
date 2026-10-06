// E2E test: an account's icon picker sits on top of the account rows below it (Task 16 review).
// Each account row is its own stacking layer, so a picker opened on any row but the last was drawn
// under the next row, and a click where a swatch should be landed on that row's "open Details"
// overlay instead. Opens the picker on the first of three accounts, checks every swatch is the
// element under its own centre, then picks one and checks it saved without opening Details.
//
// Run with: node e2e/feature278_account_icon_picker_on_top.mjs

import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (id,name,account_type,starting_balance) VALUES (301,'First Checking','checking','100'),(302,'Second Savings','savings','200'),(303,'Third Savings','savings','300')")
`);
const app = await launchApp({ dbDir });
try {
  const { browser } = app;
  await browser.setWindowSize(1440, 1000);
  await (await browser.$('button.nav-item[data-tab="accounts"]')).click();
  const first = await browser.$('.account-card[data-account-id="301"]');
  await first.waitForExist({ timeout: 10000, timeoutMsg: "the first account row should show" });
  await (await first.$(".type-badge")).click();
  await (await first.$(".icon-picker-popover")).waitForDisplayed({ timeout: 5000, timeoutMsg: "the icon picker should open" });

  // Every swatch must be the element a click at its centre reaches (not the next row's overlay).
  let covered = null;
  await waitUntilOrDiagnose(
    browser,
    async () => {
      covered = await browser.execute(() =>
        [...document.querySelectorAll('.account-card[data-account-id="301"] .icon-picker-swatch')]
          .filter((s) => {
            const r = s.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !s.contains(hit);
          })
          .map((s) => s.getAttribute("title")),
      );
      return covered.length === 0;
    },
    { timeoutMsg: "every swatch should be on top (not covered by the next account row)", extra: async () => ({ covered }) },
  );

  const swatchTitles = await browser.execute(() =>
    [...document.querySelectorAll('.account-card[data-account-id="301"] .icon-picker-swatch')].map((s) => s.getAttribute("title")),
  );
  // The last swatch sits lowest in the picker, so it is the one most deeply under the rows below.
  const target = swatchTitles[swatchTitles.length - 1];
  await (await first.$(`.icon-picker-swatch[title="${target}"]`)).click();

  await waitUntilOrDiagnose(browser, async () => !(await (await first.$(".icon-picker-popover")).isExisting()), {
    timeoutMsg: "picking a swatch should close the picker",
  });
  assert.equal(await (await browser.$("[data-account-detail]")).isExisting(), false, "picking an icon must not open an account's Details");

  // Reopen until the saved choice shows as the active swatch.
  await waitUntilOrDiagnose(
    browser,
    async () => {
      await (await first.$(".type-badge")).click();
      const active = await (await first.$(".icon-picker-swatch-active")).getAttribute("title").catch(() => null);
      if (active === target) return true;
      await (await first.$(".type-badge")).click();
      return false;
    },
    { timeoutMsg: `expected "${target}" to be saved as the first account's icon` },
  );
  console.log("FEATURE 278 E2E TEST PASSED");
} finally {
  await app.close();
}
