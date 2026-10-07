// E2E test: the Dashboard in a clearer order (UI review s6), on the tidy two-person household data
// with no saved layout (what a new profile sees).
//
// - "Ask the Vault" is still the big card directly under the title row, and its question field is
//   at least half the page wide (owner decision: it is not shrunk into the title row).
// - The page's actions (+ Add transaction, + Add account, Set budget, Update goals) are in the
//   title row.
// - The four money tiles together fill at least 95% of their row.
// - The To do card comes before Safe to spend and before Runway (this data has all three).
// - The Runway card says "Goal: 6 months" under its ring, and the ring names itself for screen
//   readers.
// - The Layout menu reads "Layout: …", and Customize… in it turns on customizing. While customizing,
//   a visible Done button beside "+ Add widget…" turns it off again (so does "Done customizing").
// - At 800px wide nothing scrolls sideways.
// - Screenshots in Default, Futuristic and Retro, Light and Dark, for a look by eye.
//
// Run with: node e2e/run-all.mjs --spec=270

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseMenuOption, chooseStyle, launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedHouseholdDatabase } from "./household-demo.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = freshTestDbDir();
await seedHouseholdDatabase(dbDir);
const shotsDir = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature270-");
fs.mkdirSync(shotsDir, { recursive: true });

const app = await launchApp({ dbDir });
const { browser } = app;

/** Reads `read()` until `ok(value)` holds, and returns that value. A timeout's message carries what
 * the window looked like and the last value read (never a judgement on one read). */
async function settled(read, ok, timeoutMsg, timeout = 15000) {
  let last;
  await waitUntilOrDiagnose(browser, async () => Boolean(ok((last = await read()))), { timeout, timeoutMsg, extra: async () => last });
  return last;
}

async function openDashboard() {
  await (await browser.$(".nav-item[data-tab=dashboard]")).click();
  await settled(
    () => browser.execute(() => document.querySelectorAll(".dashboard-stat-row .stat-hero").length),
    (n) => n === 4,
    "expected the Dashboard's four money tiles",
  );
}

const readDashboard = () =>
  browser.execute(() => {
    const rect = (el) => (el ? el.getBoundingClientRect() : null);
    const page = document.querySelector(".page");
    const pageTop = document.querySelector(".page-top");
    const qa = pageTop?.nextElementSibling;
    const qaInput = qa?.querySelector("form input");
    const inputRect = rect(qaInput);
    const row = document.querySelector(".dashboard-stat-row");
    const tiles = [...(row?.querySelectorAll(".stat-hero") ?? [])].map(rect);
    const rowRect = rect(row);
    const tilesSpan = tiles.length ? Math.max(...tiles.map((t) => t.right)) - Math.min(...tiles.map((t) => t.left)) : 0;
    const todo = [...document.querySelectorAll(".card")].find((c) => c.querySelector(".card-head .reports-section-title")?.textContent === "To do") ?? null;
    const safe = document.querySelector(".safe-to-spend-card");
    const runway = document.querySelector(".runway-card");
    const before = (a, b) => !a || !b || Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const trigger = document.querySelector(".layout-select-toggle");
    return {
      qaIsAskTheVault: Boolean(qa?.classList.contains("ledger-qa-card") && qa.textContent.includes("Ask the Vault")),
      qaInputShown: Boolean(qaInput && inputRect.width > 0 && inputRect.height > 0 && getComputedStyle(qaInput).visibility !== "hidden"),
      qaShare: page && inputRect ? inputRect.width / page.getBoundingClientRect().width : 0,
      actions: [...(pageTop?.querySelectorAll(".page-actions button") ?? [])].map((b) => b.textContent.trim()),
      quickActionsRow: Boolean(document.querySelector(".quick-actions")),
      tileShare: rowRect && rowRect.width ? tilesSpan / rowRect.width : 0,
      tileTops: [...new Set(tiles.map((t) => Math.round(t.top)))].length,
      hasTodo: Boolean(todo),
      hasSafe: Boolean(safe),
      hasRunway: Boolean(runway),
      todoBeforeSafe: before(todo, safe),
      todoBeforeRunway: before(todo, runway),
      runwayText: runway?.innerText.replace(/\s+/g, " ") ?? null,
      ringLabel: runway?.querySelector("svg[role='img']")?.getAttribute("aria-label") ?? null,
      layoutText: trigger?.innerText.trim() ?? null,
      sideways: document.querySelector(".main").scrollWidth - document.querySelector(".main").clientWidth,
    };
  });

try {
  await openDashboard();

  const d = await settled(
    readDashboard,
    (v) => v.qaIsAskTheVault && v.qaInputShown && v.hasTodo && v.hasSafe && v.hasRunway && v.layoutText?.startsWith("Layout:"),
    "expected Ask the Vault under the title, the To do, Safe to spend and Runway cards, and the Layout menu",
  );
  console.log("dashboard:", JSON.stringify(d));

  // Ask the Vault keeps its size and place (owner rule).
  assert.ok(d.qaShare >= 0.5, `Ask the Vault's question field should be at least half the page wide, was ${(d.qaShare * 100).toFixed(1)}%`);

  // The page's actions moved into the title row.
  assert.deepEqual(d.actions, ["+ Add transaction", "+ Add account", "Set budget", "Update goals"]);
  assert.equal(d.quickActionsRow, false, "the separate Quick actions row should be gone");

  // The tiles fill their row.
  assert.ok(d.tileShare >= 0.95, `the four money tiles should fill at least 95% of their row, filled ${(d.tileShare * 100).toFixed(1)}%`);
  assert.equal(d.tileTops, 1, "at 1280 wide the four tiles sit on one line");

  // To do first, then Safe to spend and Runway.
  // All three must be on screen, or the order checks below would pass without comparing anything.
  assert.ok(d.hasTodo && d.hasSafe && d.hasRunway, `the household data should show To do, Safe to spend and Runway: ${JSON.stringify({ todo: d.hasTodo, safe: d.hasSafe, runway: d.hasRunway })}`);
  assert.ok(d.todoBeforeSafe, "the To do card should come before Safe to spend");
  assert.ok(d.todoBeforeRunway, "the To do card should come before Runway");

  // The ring says what it measures against.
  assert.ok(d.runwayText.includes("Goal: 6 months"), `the Runway card should say "Goal: 6 months": ${d.runwayText}`);
  assert.match(d.ringLabel ?? "", /^\d+\.\d months of a 6-month goal$/, "the ring names itself for screen readers");

  await browser.saveScreenshot(path.join(shotsDir, "dashboard-1280.png"));

  // Customize… is in the Layout menu now (feature39/56/132 cover what it does).
  const trigger = await browser.$(".layout-select-toggle");
  await chooseMenuOption(trigger, { label: "Customize…" });
  await settled(() => browser.execute(() => document.querySelectorAll(".dashboard-widget-controls").length), (n) => n > 4, "Customize… should show the widget controls");
  await chooseMenuOption(trigger, { label: "Done customizing" });
  await settled(() => browser.execute(() => document.querySelectorAll(".dashboard-widget-controls").length), (n) => n === 0, "Done customizing should hide them again");
  // While customizing, a visible Done button sits beside "+ Add widget…"; it isn't there otherwise.
  const toolbarButtons = () => browser.execute(() => [...document.querySelectorAll(".dashboard-toolbar > button")].map((b) => b.textContent.trim()));
  await settled(toolbarButtons, (labels) => !labels.includes("Done") && !labels.includes("Customize"), "no Done or Customize button outside Customize mode");
  await chooseMenuOption(trigger, { label: "Customize…" });
  const inCustomize = await settled(toolbarButtons, (labels) => labels.includes("Done"), "Customize mode should show a Done button");
  assert.deepEqual(inCustomize.slice(-2), ["+ Add widget…", "Done"], `Done should sit right after + Add widget…: ${JSON.stringify(inCustomize)}`);
  await (await browser.$(".dashboard-toolbar > button[data-customize-done]")).click();
  await settled(() => browser.execute(() => document.querySelectorAll(".dashboard-widget-controls").length), (n) => n === 0, "the Done button should end customizing");
  await settled(toolbarButtons, (labels) => !labels.includes("Done"), "the Done button goes away once customizing ends");

  // Every style, light and dark, for a look by eye; nothing scrolls sideways in any of them.
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
      await openDashboard();
      await settled(readDashboard, (v) => v.sideways <= 1 && v.tileShare >= 0.95, `${label} ${mode}: tiles fill their row and nothing scrolls sideways`);
      await browser.saveScreenshot(path.join(shotsDir, `dashboard-${palette}-${mode}.png`));
      await browser.execute(() => document.querySelector(".runway-card")?.scrollIntoView({ block: "center" }));
      await browser.saveScreenshot(path.join(shotsDir, `dashboard-${palette}-${mode}-runway.png`));
      await browser.execute(() => document.querySelector(".main")?.scrollTo(0, 0));
    }
  }
  await chooseStyle(browser, "Default", "transparent");

  // Narrow: the title row's actions wrap rather than push the page sideways, and Ask the Vault keeps
  // its share of the page.
  await browser.setWindowSize(800, 900);
  await openDashboard();
  const narrow = await settled(readDashboard, (v) => v.sideways <= 1 && v.qaShare >= 0.5 && v.tileShare >= 0.95, "at 800 wide: nothing scrolls sideways, Ask the Vault and the tiles keep their width");
  console.log("narrow:", JSON.stringify({ sideways: narrow.sideways, qaShare: narrow.qaShare, tileShare: narrow.tileShare, tileLines: narrow.tileTops }));
  await browser.saveScreenshot(path.join(shotsDir, "dashboard-800.png"));
  console.log(`screenshots: ${shotsDir}`);

  console.log("FEATURE 270 E2E TEST PASSED");
} finally {
  await app.close();
}
