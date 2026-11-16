// VS-31 step 2 (I): Investments' "What your investments are in" bar above the page tabs, and the tabs themselves.
// Fixture: one investment account with US stocks 14,427.00, International stocks 6,535.00, Bonds 4,277.00, Cash 640.00 and
// one holding with no kind (50.00, shown as Other): total 25,929.00. Nothing is written inside
// the bar (owner, UAT of step 3); the key under the bar must still show every kind in full, with its share.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle, dismissStatusMessages, reclaimWindowFocus, withFocusRetry, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Retirement Account', 'investment', '0.00')")
acct = cur.lastrowid
for symbol, name, shares, price, cost, kind in [
    ("BRDM", "Broad Market Index Fund", "10", "1442.70", "12000.00", "US stocks"),
    ("INTL", "International Index Fund", "100", "65.35", "6200.00", "International stocks"),
    ("BOND", "Total Bond Fund", "100", "42.77", "4500.00", "Bonds"),
    ("CASH", "Money Market", "640", "1.00", "640.00", "Cash"),
    ("MYST", "Unsorted Fund", "1", "50.00", "40.00", None),
]:
    cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?,?,?,?,?,?,?)", (acct, symbol, name, shares, price, cost, kind))
`);

const shots = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature389-");
fs.mkdirSync(shots, { recursive: true });
const app = await launchApp({ dbDir });
const b = app.browser;

const readMix = () => b.execute(() => {
  const card = document.querySelector("[data-investments-mix]");
  if (!card) return null;
  return {
    key: [...card.querySelectorAll("[data-investments-mix-key] li")].map((li) => li.textContent),
    inBar: [...card.querySelectorAll(".segment-bar-seg")].map((e) => e.textContent),
    total: card.querySelector(".segment-bar-total")?.textContent ?? null,
    text: card.innerText,
  };
});

// Real geometry: no sideways scroll, no word split across lines, no text over the bar, every name readable in the key.
const layoutIssues = () => b.execute(() => {
  const issues = [];
  const main = document.querySelector(".main");
  if (main.scrollWidth > main.clientWidth + 1) issues.push({ kind: "main scrolls sideways", scrollWidth: main.scrollWidth, clientWidth: main.clientWidth });
  if (document.documentElement.scrollWidth > innerWidth + 1) issues.push({ kind: "page scrolls sideways" });
  const card = document.querySelector("[data-investments-mix]");
  const box = card.getBoundingClientRect();
  const overlap = (a, c) => a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5;
  const textRect = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
  const splitWords = (el) => {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const m of node.textContent.matchAll(/\S+/g)) {
        const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
        if (new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1) out.push(m[0]);
      }
    }
    return out;
  };
  const track = card.querySelector(".segment-bar-track").getBoundingClientRect();
  const total = textRect(card.querySelector(".segment-bar-total"));
  if (overlap(total, track)) issues.push({ kind: "total over the bar" });
  if (total.right > box.right + 0.5) issues.push({ kind: "total outside the card" });
  if (track.width < 120) issues.push({ kind: "bar too narrow", width: track.width });
  for (const seg of card.querySelectorAll(".segment-bar-seg")) {
    const s = seg.getBoundingClientRect();
    if (s.right > track.right + 0.5 || s.left < track.left - 0.5) issues.push({ kind: "segment outside the bar" });
  }
  for (const li of card.querySelectorAll("[data-investments-mix-key] li")) {
    const r = li.getBoundingClientRect();
    if (r.right > box.right + 0.5 || r.left < box.left - 0.5) issues.push({ kind: "key item outside the card", text: li.textContent });
    if (li.scrollWidth > li.clientWidth + 1) issues.push({ kind: "key item cut short", text: li.textContent });
  }
  for (const el of [...card.querySelectorAll("[data-investments-mix-key] li, .reports-section-title, .segment-bar-total, .modal-message-secondary"), ...document.querySelectorAll('[role="tablist"][aria-label="Investment sections"] [role="tab"]')]) {
    const words = splitWords(el);
    if (words.length) issues.push({ kind: "word split across lines", text: el.textContent, words });
  }
  const tabs = document.querySelector('[role="tablist"][aria-label="Investment sections"]').getBoundingClientRect();
  if (tabs.right > main.getBoundingClientRect().right + 0.5) issues.push({ kind: "tab strip wider than the page" });
  return issues;
});

try {
  await b.setWindowSize(1440, 1000);
  await (await b.$('.nav-item[aria-label="Investments"]')).click();
  await waitUntilOrDiagnose(b, async () => (await readMix())?.key.length === 5, { timeout: 15000, timeoutMsg: "the mix card lists five kinds" });

  // ---- Figures
  const mix = await readMix();
  assert.ok(mix.text.includes("What your investments are in") && mix.text.includes("Every holding, grouped by kind"), mix.text);
  assert.equal(mix.total, "$25,929.00", "the total invested");
  assert.deepEqual([...mix.key].sort(), ["Bonds 16%", "Cash 2%", "International stocks 25%", "Other under 1%", "US stocks 56%"].sort(), "every kind with its share; a holding with no kind counts as Other");
  // Owner, UAT of step 3: nothing is written inside the bar; the key above names every kind.
  assert.deepEqual(mix.inBar, ["", "", "", "", ""], "no text inside the bar");
  // The bar draws the Allocation card's own figures: open Mix and targets and compare the donut's legend.
  await (await b.$("#investments-tab-mix")).click();
  const allocation = await b.execute(() => [...document.querySelectorAll("#investments-panel-mix .chart-legend-item")].map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  for (const kind of ["US stocks", "International stocks", "Bonds", "Cash", "Other"]) assert.ok(allocation.some((t) => t.startsWith(kind)), `Allocation lists ${kind}: ${JSON.stringify(allocation)}`);

  // ---- Tabs from the keyboard
  await (await b.$("#investments-tab-holdings")).click();
  const focusedTab = () => b.execute(() => ({ id: document.activeElement?.id, shown: [...document.querySelectorAll('[role="tabpanel"][id^="investments-panel-"]')].filter((p) => !p.hidden).map((p) => p.id) }));
  for (const [key, id] of [["ArrowLeft", "money-in"], ["ArrowRight", "holdings"], ["End", "money-in"], ["Home", "holdings"], ["ArrowRight", "mix"], ["ArrowRight", "growth"]]) {
    await withFocusRetry(b, async () => {
      await reclaimWindowFocus(b);
      await b.execute(() => document.querySelector('[role="tablist"][aria-label="Investment sections"] [aria-selected="true"]').focus());
      await b.keys(key);
      await waitUntilOrDiagnose(b, async () => { const f = await focusedTab(); return f.id === `investments-tab-${id}` && f.shown.length === 1 && f.shown[0] === `investments-panel-${id}`; }, { timeout: 3000, timeoutMsg: `${key} selects ${id}`, extra: focusedTab });
    });
  }

  // ---- Layout and screenshots: three styles, light and dark, 1440 and 720.
  for (const [style, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await b.setWindowSize(1440, 1000);
    await chooseStyle(b, style, palette);
    for (const theme of ["light", "dark"]) {
      await b.setWindowSize(1440, 1000);
      await b.execute((t) => [...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find((el) => el.textContent.trim().toLowerCase() === t).click(), theme);
      await waitUntilOrDiagnose(b, () => b.execute((t) => document.documentElement.dataset.theme === t, theme), { timeoutMsg: `apply ${theme}` });
      await (await b.$('.nav-item[aria-label="Investments"]')).click();
      await waitUntilOrDiagnose(b, async () => (await readMix())?.key.length === 5, { timeout: 10000, timeoutMsg: `${style} ${theme}: mix card loaded` });
      await dismissStatusMessages(b);
      await b.executeAsync((done) => document.fonts.ready.then(() => done()));
      for (const width of [1440, 720]) {
        await b.setWindowSize(width, width === 720 ? 900 : 1000);
        await waitUntilOrDiagnose(b, async () => (await layoutIssues()).length === 0, { timeout: 5000, timeoutMsg: `${style} ${theme} ${width}px layout`, extra: layoutIssues });
        await b.execute(() => document.querySelector(".main").scrollTo(0, 0));
        await b.saveScreenshot(path.join(shots, `investments-${palette}-${theme}-${width}.png`));
        if (palette !== "transparent") continue;
        for (const id of ["mix", "growth", "money-in"]) {
          await (await b.$(`#investments-tab-${id}`)).click();
          await (await b.$(`#investments-panel-${id}`)).waitForDisplayed({ timeout: 5000 });
          await waitUntilOrDiagnose(b, () => b.execute(() => document.querySelector(".main").scrollWidth <= document.querySelector(".main").clientWidth + 1), { timeout: 5000, timeoutMsg: `${id} fits ${width}px without sideways scrolling` });
          await b.execute(() => document.querySelector('[role="tablist"][aria-label="Investment sections"]').scrollIntoView({ block: "start" }));
          await b.saveScreenshot(path.join(shots, `investments-tab-${id}-${theme}-${width}.png`));
        }
        await (await b.$("#investments-tab-holdings")).click();
      }
    }
  }

  // ---- Hide amounts: every figure on the card masked.
  await b.setWindowSize(1440, 1000);
  await (await b.$("[data-privacy-toggle]")).click();
  await waitUntilOrDiagnose(b, () => b.execute(() => !/\$\s?[\d,]+/.test(document.querySelector("[data-investments-mix]").textContent)), { timeout: 5000, timeoutMsg: "mix figures are masked" });
  await b.saveScreenshot(path.join(shots, "investments-hidden-amounts.png"));
  await (await b.$("[data-privacy-toggle]")).click();

  console.log(`screenshots: ${shots}`);
  console.log("FEATURE 389 PASSED: what your investments are in shows every kind with its share and the total, lays out cleanly in three styles, light and dark, at 1440 and 720, hides amounts; Investments tabs work from the keyboard.");
} finally { await app.close(); }
