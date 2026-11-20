// Native acceptance for approved Cash Flow, Investments and Household chart details.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle, dismissStatusMessages, waitUntilOrDiagnose, reclaimWindowFocus } from "./harness.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";
import { uiEnhancementFixture } from "./lib/uiEnhancementFixture.mjs";

const shots = process.env.VS_UI_ENHANCEMENT_SHOTS ?? makeTempDir("vaultspend-chart-details-");
fs.mkdirSync(shots, { recursive: true });
const app = await launchApp({ dbDir: await uiEnhancementFixture() });
const b = app.browser;
const results = [];
const cards = [
  ["Cash Flow", "[data-cashflow-six-months]", ".stacked-rows-seg"],
  ["Investments", "[data-investments-mix]", ".segment-bar-seg"],
  ["Household", ".household-view > .card:has(.stacked-rows)", ".stacked-rows-seg"],
];
const panel = () => b.execute(() => {
  const p = document.querySelector(".chart-details");
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return { role: p.getAttribute("role"), title: p.querySelector("h3").textContent, text: p.textContent,
    fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
});
try {
  await chooseStyle(b, "Default", "transparent");
  for (const theme of ["light", "dark"]) for (const width of [1440, 720]) {
    await b.setWindowSize(width, 1000);
    await b.execute(t => [...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find(e => e.textContent.trim().toLowerCase() === t).click(), theme);
    for (const [page, scope, segment] of cards) {
      await b.$(`.nav-item[aria-label="${page}"]`).click();
      await b.$(`${scope} ${segment}`).waitForExist({ timeout: 10000 });
      await dismissStatusMessages(b);
      // Spending starts at the track's zero; income ticks use that same origin.
      // A generic centered-button rule must never float a short bar in the middle.
      const geometry = await b.execute(scope => [...document.querySelectorAll(`${scope} .chart-details-track`)].map(track => {
        const bounds = track.getBoundingClientRect();
        const style = getComputedStyle(track);
        const first = track.querySelector('.stacked-rows-seg, .segment-bar-seg');
        const tick = track.querySelector('.stacked-rows-tick');
        const zero = bounds.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
        return {
          offset: first ? first.getBoundingClientRect().left - zero : null,
          tickError: tick ? tick.getBoundingClientRect().left - (bounds.left + parseFloat(style.borderLeftWidth)
            + track.clientWidth * parseFloat(tick.style.left) / 100 + parseFloat(getComputedStyle(tick).marginLeft)) : null,
        };
      }), scope);
      assert.ok(geometry.length > 0, `${page}: chart tracks exist`);
      for (const row of geometry) {
        assert.ok(row.offset !== null && Math.abs(row.offset) <= 1, `${page}/${theme}/${width}: spending starts at zero, offset=${row.offset}`);
        if (row.tickError !== null) assert.ok(Math.abs(row.tickError) <= 1, `${page}: income tick shares the track origin`);
      }
      await b.$(scope).scrollIntoView({ block: "center" });
      await b.saveScreenshot(path.join(shots, `alignment-${page.replaceAll(" ", "-")}-${theme}-${width}.png`));
      // Household's second row omits Rent: it must not use the first legend label.
      const target = `${scope} ${page === "Household" ? ".stacked-rows-row:nth-child(2) " : ""}${segment}`;
      const expected = await b.execute((selector, scope) => {
        const el = document.querySelector(selector), card = document.querySelector(scope);
        const row = el.closest('.stacked-rows-row');
        const person = row?.querySelector('.stacked-rows-label').textContent;
        const values = [...card.querySelectorAll('.sr-only tbody tr')].map(r => [...r.cells].map(c => c.textContent));
        const label = el.closest('button').getAttribute('aria-label');
        const record = values.find(r => (!person || r[0] === person) && r[1] !== 'Total' && label.includes(r[1]));
        return { title: label.replace(/ details$/, ''), record };
      }, target, scope);
      assert.ok(expected.record, "an exact source table entry exists for the actual segment");
      await b.$(target).scrollIntoView({ block: "center" });
      await b.$(target).moveTo();
      await waitUntilOrDiagnose(b, async () => (await panel())?.title === expected.title, { timeoutMsg: "hover shows section details" });
      assert.ok((await panel()).text.includes(expected.record[2]), "hover contains the exact dollar amount");
      await b.$(target).click();
      await b.execute(() => document.querySelector('.page h1').dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
      assert.equal((await panel()).role, "dialog", "click pins details after pointer leaves");
      assert.ok((await panel()).fits, "popover stays inside the viewport");
      await b.saveScreenshot(path.join(shots, `details-${page.replaceAll(" ", "-")}-${theme}-${width}.png`));
      await reclaimWindowFocus(b);
      await b.keys("Escape");
      await waitUntilOrDiagnose(b, async () => !(await panel()), { timeoutMsg: "Escape dismisses details" });
      // Focus and the native Enter key activate the same target.
      await b.execute(s => document.querySelector(s).closest('button').focus(), target);
      await b.keys("Enter");
      assert.equal((await panel()).role, "dialog", "keyboard activation pins details");
      await b.$('.chart-details-close').click();
      assert.equal(await panel(), null);
      // An income tick and a folded group are additional data targets, not decoration.
      if (page !== "Investments") {
        await b.execute(scope => document.querySelector(`${scope} .stacked-rows-tick`).click(), scope);
        assert.match((await panel()).text, /What (came in|they earned)/);
        await b.keys("Escape");
        await b.execute(scope => [...document.querySelector(`${scope} .stacked-rows-row`).querySelectorAll('.stacked-rows-seg')].at(-1).click(), scope);
        assert.match((await panel()).text, /Section total: \$/);
        await b.keys("Escape");
      }
      await b.$('[data-privacy-toggle]').click();
      await b.execute(s => document.querySelector(s).click(), target);
      assert.doesNotMatch((await panel()).text, /\$\s?\d/, "hidden amounts stay hidden in newly opened details");
      const attrs = await b.execute(() => [...document.querySelectorAll('.chart-details, .chart-details *, .chart-details-track')].flatMap(e => [...e.attributes].map(a => a.value)));
      assert.ok(attrs.every(x => !/\$\s?\d/.test(x)), "amounts are never stored in attributes");
      await b.$('[data-privacy-toggle]').click();
      assert.equal(await panel(), null, "privacy changes dismiss pinned details");
      results.push({ page, theme, width, amount: expected.record[2] });
    }
  }
  fs.writeFileSync(path.join(shots, "chart-details.json"), JSON.stringify(results, null, 2));
  console.log("FEATURE 414 PASSED: exact chart amounts, hover, click, keyboard, grouped categories, ticks and privacy in both themes at 1440/720.");
} finally { await app.close(); }
