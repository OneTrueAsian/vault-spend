// Approved Default appearance: aligned shaded surfaces, compact Dashboard and stable Customize widths.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle, dismissStatusMessages, waitUntilOrDiagnose } from "./harness.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";
import { uiEnhancementFixture } from "./lib/uiEnhancementFixture.mjs";

const shots = process.env.VS_UI_ENHANCEMENT_SHOTS ?? makeTempDir("vaultspend-default-layout-");
fs.mkdirSync(shots, { recursive: true });
const app = await launchApp({ dbDir: await uiEnhancementFixture() });
const b = app.browser, results = [];
const widths = () => b.execute(() => [...document.querySelectorAll('[data-widget-id] .card')].map(e => e.getBoundingClientRect().width));
const geometry = () => b.execute(() => {
  const main = document.querySelector('.main');
  const bands = [...document.querySelectorAll('.card > .card-head,.household-cards .card > h2,.household-view > .card:has(.stacked-rows) > h2')]
    .filter(e => e.getBoundingClientRect().height && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)')
    .map(e => { const r = e.getBoundingClientRect(), c = e.parentElement.getBoundingClientRect(); return { title: e.textContent, left: r.left - c.left - 1, right: c.right - r.right - 1, height: r.height }; });
  return { overflow: main.scrollWidth - main.clientWidth, bands, background: getComputedStyle(document.body).backgroundColor };
});
try {
  await chooseStyle(b, "Default", "transparent");
  for (const theme of ["light", "dark"]) for (const width of [1440, 720]) {
    await b.setWindowSize(width, 1000);
    await b.execute(t => [...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find(e => e.textContent.trim().toLowerCase() === t).click(), theme);
    for (const page of ["Dashboard", "Accounts", "Transactions", "Recurring", "Budget", "Goals", "Cash Flow", "Investments", "Household", "Reports", "Settings", "Help"]) {
      await b.$(`.nav-item[aria-label="${page}"]`).click();
      await dismissStatusMessages(b);
      await b.execute(() => document.querySelector('.main').scrollTop = 0);
      const g = await geometry();
      assert.equal(g.background, theme === "light" ? "rgb(230, 238, 247)" : "rgb(15, 27, 42)", "the shipped Default palette is active");
      assert.ok(g.overflow <= 1, `${page} ${theme} ${width}: no page-wide overflow`);
      for (const band of g.bands) {
        assert.ok(Math.abs(band.left) <= 1 && Math.abs(band.right) <= 1, `${page}: shaded header edges ${JSON.stringify(band)}`);
        assert.ok(band.height >= 47, `${page}: header has room for its text and controls`);
      }
      await b.saveScreenshot(path.join(shots, `layout-${page.replaceAll(" ", "-")}-${theme}-${width}.png`));
      results.push({ page, theme, width, ...g });
    }
    await b.$('.nav-item[aria-label="Dashboard"]').click();
    await waitUntilOrDiagnose(b, () => b.$('[data-widget-id="trend_spending"] .card').isExisting(), { timeoutMsg: "Dashboard report pair loads" });
    const pairs = await b.execute(() => [...document.querySelectorAll('[data-widget-id="trend_spending"] .card,[data-widget-id="budget_bills"] .card,[data-widget-id="needs_a_look"] > .card')].map(e => e.getBoundingClientRect().width));
    assert.ok(Math.max(...pairs) - Math.min(...pairs) <= 1, "report pairs use equal columns");
    const before = await widths();
    await b.$('.layout-select-toggle').click();
    await b.execute(() => [...document.querySelectorAll('[role="menuitemradio"]')].find(e => e.textContent.trim() === 'Customize').click());
    assert.ok(await b.$('.dashboard-widget-controls').isExisting());
    const editing = await widths();
    assert.equal(before.length, editing.length);
    assert.ok(before.every((w, i) => Math.abs(w - editing[i]) <= 1), "Customize preserves every report width");
    await b.$('[data-widget-id="trend_spending"]').scrollIntoView({ block: "center" });
    await b.saveScreenshot(path.join(shots, `customize-${theme}-${width}.png`));
    await b.execute(() => document.querySelector('[data-customize-done]').click());
    const after = await widths();
    assert.ok(before.every((w, i) => Math.abs(w - after[i]) <= 1), "Done preserves every report width");
  }
  // The default palette does not recolor other appearance styles.
  await chooseStyle(b, "Retro", "retro");
  assert.notEqual((await geometry()).background, "rgb(230, 238, 247)");
  fs.writeFileSync(path.join(shots, "default-layout.json"), JSON.stringify(results, null, 2));
  console.log("FEATURE 415 PASSED: 12 sections in light/dark at 1440/720, header edges, overflow and equal report sizes through Customize.");
} finally { await app.close(); }
