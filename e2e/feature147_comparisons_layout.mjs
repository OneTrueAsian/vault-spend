// Layout of Reports > Comparisons in the real compiled app, across the four palettes in light and dark
// and window widths from roomy to narrow:
//   - the page never scrolls sideways and no card's content spills out of the card;
//   - the grid steps 3 -> 2 -> 1 columns as the window narrows;
//   - long names (a family member, accounts, a source) stay inside their cards and dialogs;
//   - the details dialog fits the window and the cards are reachable and visibly focused by keyboard;
//   - page zoom of 125% and 150% (an emulation of display scaling) keeps the same guarantees.
// Screenshots of the page in every palette are written to SHOTS_DIR for a person to look at; an
// assertion about overflow does not replace looking.
//
// Run with: node e2e/feature147_comparisons_layout.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, reclaimWindowFocus } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { baseSetup, openReportsTab, setupSnippet, waitForCards } from "./lib/comparisons.mjs";

const SHOTS_DIR = process.env.COMPARISONS_SHOTS_DIR ?? path.join(os.tmpdir(), "vaultspend-comparisons-shots");
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const today = new Date();
const TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
const LONG = "An exceptionally long name that keeps going well past what any card could comfortably hold on one line";

const setup = baseSetup(TODAY, {
  // Every card, including Spending (household spending has a published figure, so it needs a total to show).
  spending: { period: null, accountIds: [], completenessConfirmed: true, manualAnnual: { value: "87000", measuredOn: TODAY, explanation: "Estimate" }, categoryMappings: [] },
  balanceConfirmations: ["savings", "investments", "debt"].map((metric) => ({ metric, confirmedOn: TODAY })),
  investmentClasses: [
    { source: { kind: "account", id: 2 }, class: "retirement" },
    { source: { kind: "account", id: 3 }, class: "taxable" },
  ],
  debtClasses: [{ source: { kind: "account", id: 5 }, class: "mortgage" }],
});

const dbDir = await seedFixture(`
cur.execute("INSERT INTO family_members (name) VALUES (?)", ("${LONG} (family member)",))
for name, kind, start in [("${LONG} (checking)", 'checking', '123456.00'), ("${LONG} (401k)", 'investment', '1234567.00'), ("${LONG} (brokerage)", 'investment', '987654.00'), ('Visa', 'credit', '10000.00'), ("${LONG} (mortgage)", 'loan', '4321000.00')]:
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES (?, ?, ?)", (name, kind, start))
${setupSnippet(setup)}
`);

const PALETTES = [
  { name: "default", attr: "transparent" },
  { name: "futuristic", attr: "futuristic" },
  { name: "retro", attr: "retro" },
];
const MODES = ["light", "dark"];
const WIDTHS = [1440, 1280, 960, 800, 700];

async function applyLook(browser, palette, mode) {
  await browser.execute(
    (palette, mode) => {
      const root = document.documentElement;
      if (palette) root.setAttribute("data-palette", palette);
      else root.removeAttribute("data-palette");
      root.dataset.theme = mode;
    },
    palette.attr,
    mode,
  );
  await browser.pause(250); // colours transition
}

function expectedColumns(innerWidth) {
  return innerWidth > 1120 ? 3 : innerWidth > 760 ? 2 : 1;
}

async function measure(browser) {
  return browser.execute(() => {
    const page = document.querySelector("[data-comparisons-page]");
    const grid = page.querySelector("[data-cmp-grid]");
    const doc = document.scrollingElement;
    const cards = [...page.querySelectorAll("[data-metric]")].map((card) => {
      const box = card.getBoundingClientRect();
      const spill = [...card.querySelectorAll("*")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1);
      });
      // A unit word ("balance", "per year") may move to its own line but never splits mid-word.
      const unit = card.querySelector(".cmp-unit");
      const unitWordSplit = unit
        ? unit.textContent.trim().split(/\s+/).length < new Set([...unit.getClientRects()].map((r) => Math.round(r.top))).size
        : false;
      return {
        metric: card.getAttribute("data-metric"),
        unitWordSplit,
        width: box.width,
        clips: card.scrollWidth > card.clientWidth + 1,
        spilling: spill.slice(0, 3).map((e) => `${e.tagName}.${e.className}`),
      };
    });
    return {
      innerWidth: window.innerWidth,
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      cards,
    };
  });
}

function check(label, m) {
  assert.ok(m.pageOverflow <= 1, `${label}: the page scrolls sideways by ${m.pageOverflow}px`);
  assert.equal(m.columns, expectedColumns(m.innerWidth), `${label}: ${m.columns} columns at ${m.innerWidth}px`);
  assert.equal(m.cards.length, 5, `${label}: all five cards are visible (got ${m.cards.map((c) => c.metric)})`);
  for (const c of m.cards) {
    assert.ok(!c.clips, `${label}: the ${c.metric} card clips its content`);
    assert.deepEqual(c.spilling, [], `${label}: content spills out of the ${c.metric} card`);
    assert.ok(!c.unitWordSplit, `${label}: the ${c.metric} card breaks its unit word across lines`);
    assert.ok(c.width >= 220, `${label}: the ${c.metric} card is only ${c.width}px wide`);
  }
}

const app = await launchApp({ dbDir });
const shots = [];
try {
  const { browser } = app;
  await browser.setWindowSize(1440, 1700);
  await openReportsTab(browser, "comparisons");
  await waitForCards(browser, { count: 5 });
  await browser.waitUntil(async () => (await (await browser.$("[data-metric='income']")).getText()).includes("$"), { timeout: 20000 });

  // Every palette, light and dark, at every width.
  for (const palette of PALETTES) {
    for (const mode of MODES) {
      await applyLook(browser, palette, mode);
      for (const width of WIDTHS) {
        await browser.setWindowSize(width, 1700);
        await browser.pause(200);
        check(`${palette.name}/${mode}/${width}`, await measure(browser));
        if (width === 1440 || width === 800) {
          const file = path.join(SHOTS_DIR, `comparisons-${palette.name}-${mode}-${width}.png`);
          await browser.saveScreenshot(file);
          shots.push(file);
        }
      }
    }
  }

  // The details dialog fits the window at the narrowest width, in a dark palette with long names.
  await applyLook(browser, PALETTES[0], "dark");
  await browser.setWindowSize(700, 900);
  await browser.pause(200);
  await (await (await browser.$("[data-metric='savings']")).$(".cmp-explore")).click();
  const details = await browser.$("[data-cmp-details='savings']");
  await details.waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => (await details.getText()).trim() !== "", { timeout: 10000 });
  const dialog = await browser.execute(() => {
    const panel = document.querySelector(".modal-panel");
    const r = panel.getBoundingClientRect();
    const content = document.querySelector("[data-cmp-details]");
    const spill = [...content.querySelectorAll("*")].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.right > r.right + 1;
    });
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: window.innerWidth, h: window.innerHeight, spill: spill.length };
  });
  assert.ok(dialog.left >= 0 && dialog.right <= dialog.w + 1, `the dialog fits the window width: ${JSON.stringify(dialog)}`);
  assert.ok(dialog.top >= 0 && dialog.bottom <= dialog.h + 1, `the dialog fits the window height: ${JSON.stringify(dialog)}`);
  assert.equal(dialog.spill, 0, "long names stay inside the dialog");
  const shot = path.join(SHOTS_DIR, "comparisons-details-default-dark-700.png");
  await browser.saveScreenshot(shot);
  shots.push(shot);
  await (await browser.$(".modal-panel .modal-secondary")).click();
  await details.waitForExist({ reverse: true, timeout: 5000 });

  // Keyboard: every Explore button is reachable and shows a focus indicator.
  await browser.setWindowSize(1440, 1700);
  await applyLook(browser, PALETTES[0], "light");
  await reclaimWindowFocus(browser);
  await (await browser.$("[data-reports-tab='comparisons']")).click();
  await browser.execute(() => document.querySelector("[data-reports-tab='comparisons']").focus());
  const reached = new Set();
  let ring = true;
  for (let i = 0; i < 20 && reached.size < 5; i++) {
    await browser.keys("Tab");
    const info = await browser.execute(() => {
      const el = document.activeElement;
      if (!el?.classList.contains("cmp-explore")) return null;
      const css = getComputedStyle(el);
      return { metric: el.closest("[data-metric]").getAttribute("data-metric"), outline: css.outlineStyle !== "none" && parseFloat(css.outlineWidth) > 0, shadow: css.boxShadow !== "none" };
    });
    if (info) {
      reached.add(info.metric);
      if (!info.outline && !info.shadow) ring = false;
    }
  }
  assert.equal(reached.size, 5, `Tab should reach all five cards' Explore buttons, reached ${[...reached]}`);
  assert.ok(ring, "a focused Explore button shows a visible focus indicator");

  // Page zoom as a stand-in for 125% / 150% display scaling.
  for (const zoom of [1.25, 1.5]) {
    await browser.execute((z) => (document.documentElement.style.zoom = String(z)), zoom);
    await browser.pause(250);
    for (const width of [1440, 960]) {
      await browser.setWindowSize(width, 1700);
      await browser.pause(200);
      const m = await measure(browser);
      assert.ok(m.pageOverflow <= 1, `zoom ${zoom}/${width}: the page scrolls sideways by ${m.pageOverflow}px`);
      for (const c of m.cards) assert.ok(!c.clips && c.spilling.length === 0, `zoom ${zoom}/${width}: the ${c.metric} card overflows (clips: ${c.clips}, spilling: ${c.spilling.join(", ")})`);
    }
  }
  await browser.execute(() => (document.documentElement.style.zoom = ""));

  console.log(`FEATURE 147 E2E TEST PASSED (${shots.length} screenshots in ${SHOTS_DIR})`);
  for (const s of shots) console.log(`  ${s}`);
} finally {
  await app.close();
}
