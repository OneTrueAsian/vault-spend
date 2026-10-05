// E2E test: a simpler Budget page (UI review s2), on the tidy two-person household data.
//
// - The month's totals are one strip, so at 1440x1000 the first category row starts less than
//   420px below the page title (the review measured about 700px of totals above it).
// - Each group has one column-heading row; the amounts line up on the right.
// - Typing 250 into Groceries' budget field and pressing Tab saves it: it's still 250.00 after
//   the window reloads.
// - "Roll over unspent" in Groceries' ⋯ menu shows the row's "Rolls over" marker.
// - With Hide amounts on, the budget cell shows •••• and there is no field to leak the figure;
//   clicking the masked amount still opens the field (Review Focus 4).
// - At 800x900 nothing scrolls sideways.
// - Screenshots in Default, Futuristic and Retro, Light and Dark, for a look by eye.
//
// Run with: node e2e/feature269_budget_rows.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseRowAction, chooseStyle, launchApp, waitForDataLoaded, waitUntilOrDiagnose, withFocusRetry } from "./harness.mjs";
import { seedHouseholdDatabase } from "./household-demo.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { budgetRowMenu, budgetRowMenuItems, strayDivider, waitForBudgetRow } from "./lib/budgetRows.mjs";

const dbDir = freshTestDbDir();
await seedHouseholdDatabase(dbDir);
const shotsDir = process.env.VS_SCREENS_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-feature269-"));
fs.mkdirSync(shotsDir, { recursive: true });

const app = await launchApp({ dbDir, windowSize: { width: 1440, height: 1000 } });
const { browser } = app;

async function openBudget() {
  await (await browser.$(".nav-item[data-tab=budget]")).click();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.querySelectorAll(".cat-row").length >= 10), {
    timeout: 20000,
    timeoutMsg: "expected the Budget page to fill with the household's categories",
  });
}

const noSidewaysScroll = () =>
  browser.execute(() => {
    const main = document.querySelector(".main");
    const lists = [...document.querySelectorAll(".cat-list")].map((l) => l.scrollWidth - l.clientWidth);
    return { main: main.scrollWidth - main.clientWidth, lists: Math.max(0, ...lists) };
  });

/** Reads `read()` until `ok(value)` holds, and returns that value. A timeout's message carries what
 * the window looked like and the last value read (never a judgement on one read). */
async function settled(read, ok, timeoutMsg, timeout = 10000) {
  let last;
  await waitUntilOrDiagnose(browser, async () => Boolean(ok((last = await read()))), { timeout, timeoutMsg, extra: async () => last });
  return last;
}

const HEADINGS = /^Category Budget (Spent Left|Received Difference) Settings$/;

try {
  await openBudget();

  // ---- 1. One summary strip, so the categories start near the top -------------------------------
  const readLayout = () =>
    browser.execute(() => {
      const title = document.querySelector(".view-title").getBoundingClientRect().top;
      const firstRow = document.querySelector(".cat-row").getBoundingClientRect().top;
      const heads = [...document.querySelectorAll(".cat-list-head")].map((h) =>
        [...h.children].map((c) => c.textContent.trim()).filter(Boolean).join(" "),
      );
      // How far apart the right edges of each amount column (Spent, Left) are across all rows.
      const spreads = [1, 2].map((col) => {
        const rights = [...document.querySelectorAll(".cat-row")].map((r) => r.querySelectorAll(".cat-amt")[col].getBoundingClientRect().right);
        return Math.max(...rights) - Math.min(...rights);
      });
      const main = document.querySelector(".main");
      return {
        gap: firstRow - title,
        summaries: document.querySelectorAll("[data-budget-summary]").length,
        tiles: document.querySelectorAll(".group-cards, .group-card").length,
        groups: document.querySelectorAll("[data-budget-group]").length,
        heads,
        spreads,
        sideways: Math.max(main.scrollWidth - main.clientWidth, ...[...document.querySelectorAll(".cat-list")].map((l) => l.scrollWidth - l.clientWidth)),
        balanceNote: document.querySelector("[data-budget-summary-note]")?.textContent ?? "",
      };
    });
  const layout = await settled(
    readLayout,
    (l) =>
      l.gap < 420 &&
      l.summaries === 1 &&
      l.tiles === 0 &&
      l.heads.length === l.groups &&
      l.heads.every((h) => HEADINGS.test(h)) &&
      l.spreads.every((d) => d <= 1) &&
      l.sideways <= 1 &&
      l.balanceNote.includes("Not an account balance"),
    "at 1440x1000: one summary strip (saying it's not an account balance), no group tiles, one heading row per group, the first category row less than 420px below the title, amounts lined up on the right and nothing scrolling sideways",
  );
  console.log(`first category row sits ${layout.gap.toFixed(0)}px below the title; headings: ${JSON.stringify(layout.heads)}`);
  await browser.saveScreenshot(path.join(shotsDir, "budget-top-1440.png"));

  // No row's menu starts, ends or doubles a divider: Groceries has its two settings, Income has none.
  for (const category of ["Groceries", "Income"]) {
    const items = await budgetRowMenuItems(browser, category, { withDividers: true });
    assert.equal(strayDivider(items), null, `${category}'s ⋯ menu ${strayDivider(items)}: ${JSON.stringify(items)}`);
  }

  // ---- 2. Typing a budget and pressing Tab saves it ------------------------------------------------
  const field = "input[aria-label='Budget for Groceries']";
  await waitForBudgetRow(browser, "Groceries", (r) => Number(r.budget) === 800, { timeoutMsg: "Groceries starts at its seeded $800" });
  await withFocusRetry(browser, async () => {
    await (await browser.$(field)).click();
    await browser.keys(["Control", "a"]);
    await browser.keys(["2", "5", "0"]);
    await browser.waitUntil(async () => (await (await browser.$(field)).getValue()) === "250", {
      timeout: 3000,
      timeoutMsg: "typing 250 should replace the field's amount",
    });
    await browser.keys("Tab");
  });
  await waitForBudgetRow(browser, "Groceries", (r) => r.budget === "250.00", { timeoutMsg: "Tab should save Groceries' new budget of 250.00" });
  await browser.refresh();
  await browser.$(".brand-word").waitForExist({ timeout: 20000 });
  await waitForDataLoaded(browser);
  await openBudget();
  const saved = await waitForBudgetRow(browser, "Groceries", (r) => r.budget === "250.00", { timeoutMsg: "the new budget should still be 250.00 after a reload" });
  console.log(`after reload, Groceries reads ${JSON.stringify(saved)}`);

  // ---- 3. Roll over unspent from the ⋯ menu shows the marker ---------------------------------------
  await waitForBudgetRow(browser, "Groceries", (r) => !r.text.includes("Rolls over"), { timeoutMsg: "Groceries doesn't roll over yet" });
  await chooseRowAction(browser, budgetRowMenu(browser, "Groceries"), "Roll over unspent");
  await waitForBudgetRow(browser, "Groceries", (r) => r.text.includes("Rolls over"), { timeoutMsg: 'turning on "Roll over unspent" should show "Rolls over"' });

  // ---- 4. Hide amounts: no field leaks the figure, and the masked amount is still editable ----------
  await (await browser.$("[data-privacy-toggle]")).click();
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.getAttribute("data-privacy"))) === "on", { timeout: 5000 });
  await waitForBudgetRow(browser, "Groceries", (r) => !r.hasInput && r.budget === "••••" && r.spent === "••••", {
    timeoutMsg: "with amounts hidden, the budget cell should show •••• and no field, and Spent is masked too",
  });
  await settled(() => browser.execute(() => document.querySelectorAll(".cat-amt input").length), (n) => n === 0, "no budget field anywhere while amounts are hidden");
  await browser.saveScreenshot(path.join(shotsDir, "budget-amounts-hidden.png"));
  await withFocusRetry(browser, async () => {
    await (await browser.$(`//div[contains(@class,'cat-row')][.//span[normalize-space()='Groceries']]//button[contains(@class,'amount-editable')]`)).click();
    await (await browser.$(field)).waitForExist({ timeout: 3000, timeoutMsg: "clicking the masked amount should open the field" });
  });
  await browser.keys("Escape");
  await waitForBudgetRow(browser, "Groceries", (r) => !r.hasInput, { timeoutMsg: "Escape should close the field again" });
  await (await browser.$("[data-privacy-toggle]")).click();
  await waitForBudgetRow(browser, "Groceries", (r) => r.hasInput && r.budget === "250.00", { timeoutMsg: "showing amounts brings the field back" });

  // ---- 5. Every style, light and dark, for a look by eye ------------------------------------------
  for (const [label, palette] of [
    ["Default", "transparent"],
    ["Futuristic", "futuristic"],
    ["Retro", "retro"],
  ]) {
    await chooseStyle(browser, label, palette);
    for (const mode of ["light", "dark"]) {
      await browser.execute((m) => {
        const group = document.querySelector('.theme-toggle[aria-label="Theme"]');
        [...group.querySelectorAll("button")].find((b) => b.textContent.trim().toLowerCase() === m).click();
      }, mode);
      await waitUntilOrDiagnose(browser, () => browser.execute((m) => document.documentElement.dataset.theme === m, mode), {
        timeoutMsg: `the ${mode} theme should apply`,
      });
      await openBudget();
      await settled(noSidewaysScroll, (sc) => sc.main <= 1 && sc.lists <= 1, `${label} ${mode}: nothing should scroll sideways`);
      await browser.saveScreenshot(path.join(shotsDir, `budget-${palette}-${mode}.png`));
    }
  }
  await chooseStyle(browser, "Default", "transparent");

  // ---- 6. Narrow: nothing scrolls sideways at 800x900 ----------------------------------------------
  await browser.setWindowSize(800, 900);
  await openBudget();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => getComputedStyle(document.querySelector(".cat-list-head")).display === "none"), {
    timeoutMsg: "the narrow layout should stack the rows (column headings hidden, each amount labelled)",
  });
  const readNarrow = () =>
    browser.execute(() => {
      const main = document.querySelector(".main");
      return {
        main: main.scrollWidth - main.clientWidth,
        lists: Math.max(0, ...[...document.querySelectorAll(".cat-list")].map((l) => l.scrollWidth - l.clientWidth)),
        // What the first amount says in front of itself (its column, from data-label).
        label: getComputedStyle(document.querySelector(".cat-row .cat-amt[data-label]"), "::before").content,
        // Rows whose ⋯ wrapped off the line with their amounts.
        strayMenus: [...document.querySelectorAll(".cat-row")]
          .filter((r) => {
            const left = [...r.querySelectorAll(".cat-amt")].at(-1).getBoundingClientRect();
            const menu = r.querySelector("[data-row-menu]").getBoundingClientRect();
            return Math.abs((left.top + left.bottom) / 2 - (menu.top + menu.bottom) / 2) > 8;
          })
          .map((r) => r.querySelector(".category-link").textContent),
      };
    });
  await settled(
    readNarrow,
    (n) => n.main <= 1 && n.lists <= 1 && n.label === '"Budget "' && n.strayMenus.length === 0,
    "at 800x900: nothing scrolls sideways, each stacked amount says which column it is, and each row's ⋯ sits on its amounts' line",
  );
  await browser.saveScreenshot(path.join(shotsDir, "budget-narrow-800.png"));
  console.log(`screenshots: ${shotsDir}`);

  console.log("FEATURE 269 E2E TEST PASSED");
} finally {
  await app.close();
}
