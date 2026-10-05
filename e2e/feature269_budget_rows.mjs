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
import { budgetRowMenu, readBudgetRow, waitForBudgetRow } from "./lib/budgetRows.mjs";

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

try {
  await openBudget();

  // ---- 1. One summary strip, so the categories start near the top -------------------------------
  const layout = await browser.execute(() => {
    const title = document.querySelector(".view-title").getBoundingClientRect().top;
    const firstRow = document.querySelector(".cat-row").getBoundingClientRect().top;
    const groups = document.querySelectorAll("[data-budget-group]").length;
    const heads = [...document.querySelectorAll(".cat-list-head")].map((h) =>
      [...h.children].map((c) => c.textContent.trim()).filter(Boolean).join(" "),
    );
    // Right edges of every row's Spent and Left figures.
    const rights = [...document.querySelectorAll(".cat-row")].flatMap((r) =>
      [...r.querySelectorAll(".cat-amt")].slice(1).map((c, i) => ({ col: i, right: Math.round(c.getBoundingClientRect().right * 10) / 10 })),
    );
    return {
      gap: firstRow - title,
      summaries: document.querySelectorAll("[data-budget-summary]").length,
      tiles: document.querySelectorAll(".group-cards, .group-card").length,
      groups,
      heads,
      rights,
    };
  });
  console.log(`first category row sits ${layout.gap.toFixed(0)}px below the title; headings: ${JSON.stringify(layout.heads)}`);
  await browser.saveScreenshot(path.join(shotsDir, "budget-top-1440.png"));
  assert.ok(layout.gap < 420, `the first category row should start less than 420px below the title, got ${layout.gap}px`);
  assert.equal(layout.summaries, 1, "exactly one summary strip");
  assert.equal(layout.tiles, 0, "no group tiles");
  assert.equal(layout.heads.length, layout.groups, "one column-heading row per group");
  for (const head of layout.heads) assert.match(head, /^Category Budget (Spent Left|Received Difference) Settings$/, `unexpected column headings: ${head}`);
  for (const col of [0, 1]) {
    const edges = layout.rights.filter((r) => r.col === col).map((r) => r.right);
    const spread = Math.max(...edges) - Math.min(...edges);
    assert.ok(spread <= 1, `column ${col} amounts should line up on the right within 1px, spread ${spread}px`);
  }
  const wide = await noSidewaysScroll();
  assert.ok(wide.main <= 1 && wide.lists <= 1, `nothing should scroll sideways at 1440px: ${JSON.stringify(wide)}`);

  // ---- 2. Typing a budget and pressing Tab saves it ------------------------------------------------
  const field = "input[aria-label='Budget for Groceries']";
  assert.equal(Number((await readBudgetRow(browser, "Groceries")).budget), 800, "Groceries starts at its seeded $800");
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
  assert.ok(!(await readBudgetRow(browser, "Groceries")).text.includes("Rolls over"), "Groceries doesn't roll over yet");
  await chooseRowAction(browser, budgetRowMenu(browser, "Groceries"), "Roll over unspent");
  await waitForBudgetRow(browser, "Groceries", (r) => r.text.includes("Rolls over"), { timeoutMsg: 'turning on "Roll over unspent" should show "Rolls over"' });

  // ---- 4. Hide amounts: no field leaks the figure, and the masked amount is still editable ----------
  await (await browser.$("[data-privacy-toggle]")).click();
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.getAttribute("data-privacy"))) === "on", { timeout: 5000 });
  const hidden = await waitForBudgetRow(browser, "Groceries", (r) => !r.hasInput && r.budget === "••••", {
    timeoutMsg: "with amounts hidden, the budget cell should show •••• and no field",
  });
  assert.equal(hidden.spent, "••••", "the Spent figure is masked too");
  assert.equal(await browser.execute(() => document.querySelectorAll(".cat-amt input").length), 0, "no budget field anywhere while amounts are hidden");
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
      const scroll = await noSidewaysScroll();
      assert.ok(scroll.main <= 1 && scroll.lists <= 1, `${label} ${mode}: nothing should scroll sideways: ${JSON.stringify(scroll)}`);
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
  const narrow = await noSidewaysScroll();
  assert.ok(narrow.main <= 1, `.main should not scroll sideways at 800px: ${JSON.stringify(narrow)}`);
  assert.ok(narrow.lists <= 1, `no budget list should scroll sideways at 800px: ${JSON.stringify(narrow)}`);
  const narrowLabel = await browser.execute(() => getComputedStyle(document.querySelector(".cat-row .cat-amt[data-label]"), "::before").content);
  assert.equal(narrowLabel, '"Budget "', "each stacked amount says which column it is");
  // Each row's ⋯ stays on the line with its amounts rather than wrapping onto a line of its own.
  const strayMenus = await browser.execute(() =>
    [...document.querySelectorAll(".cat-row")]
      .filter((r) => {
        const left = [...r.querySelectorAll(".cat-amt")].at(-1).getBoundingClientRect();
        const menu = r.querySelector("[data-row-menu]").getBoundingClientRect();
        return Math.abs((left.top + left.bottom) / 2 - (menu.top + menu.bottom) / 2) > 8;
      })
      .map((r) => r.querySelector(".category-link").textContent),
  );
  assert.deepEqual(strayMenus, [], `at 800px each row's ⋯ should sit on its amounts' line: ${JSON.stringify(strayMenus)}`);
  await browser.saveScreenshot(path.join(shotsDir, "budget-narrow-800.png"));
  console.log(`screenshots: ${shotsDir}`);

  console.log("FEATURE 269 E2E TEST PASSED");
} finally {
  await app.close();
}
