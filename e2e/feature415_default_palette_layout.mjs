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
// Missing-content faults a screenshot reviewer cannot be relied on to see: an empty panel body, a chart with no data marks, and text
// that runs past its panel or is clipped without an ellipsis. Each fault names its card by data-control (negative controls) or heading.
const contentFaults = () => b.execute(() => {
  const faults = [];
  const shown = e => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const sized = e => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  for (const card of [...document.querySelectorAll('.page .card')].filter(c => shown(c) && sized(c))) {
    const heads = [...card.querySelectorAll(':scope > .card-head, :scope > h2, :scope > h3')];
    const name = card.dataset.control ?? (heads[0]?.textContent.trim() || card.className);
    const inHead = n => heads.some(h => h.contains(n));
    const texts = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let t; (t = walker.nextNode());) if (t.textContent.trim() && shown(t.parentElement)) texts.push(t);
    // Panel body: visible text, or a visible graphic, control or coloured block, outside the heading. Empty-state messages count.
    const content = texts.some(t => !inHead(t) && sized(t.parentElement)) || [...card.querySelectorAll('*')].some(e => !inHead(e) && shown(e) && sized(e)
      && (e.matches('svg,img,canvas,input,select,textarea,button') || getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)'));
    if (!content) faults.push({ card: name, kind: 'empty-panel' });
    // Charts: data marks only; gridlines (line) and axis labels (text) do not count.
    for (const svg of card.querySelectorAll('svg[role="img"]')) {
      const r = svg.getBoundingClientRect();
      if (r.width < 80 || r.height < 40 || !shown(svg)) continue;
      const marks = [...svg.querySelectorAll('rect.chart-bar,polyline,polygon,path,circle')].filter(m => {
        const s = getComputedStyle(m), mr = m.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && (mr.width > 0 || mr.height > 0) && (s.fill !== 'none' || s.stroke !== 'none');
      });
      if (!marks.length) faults.push({ card: name, kind: 'chart-no-marks' });
    }
    // Text: past the card's edge, or clipped by a non-scrolling container without an ellipsis or line clamp.
    for (const t of texts) {
      const range = document.createRange(); range.selectNodeContents(t);
      const rects = [...range.getClientRects()].filter(x => x.width > 0 && x.height > 0);
      if (!rects.length) continue;
      const box = { left: Math.min(...rects.map(x => x.left)), right: Math.max(...rects.map(x => x.right)), top: Math.min(...rects.map(x => x.top)), bottom: Math.max(...rects.map(x => x.bottom)) };
      let kind = null, truncated = false;
      for (let a = t.parentElement; a; a = a.parentElement) {
        const s = getComputedStyle(a), ar = a.getBoundingClientRect();
        if (s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none')) truncated = true;
        if (ar.width <= 2 || ar.height <= 2) break; // visually hidden text for screen readers, or a collapsed region
        const outX = box.left < ar.left - 1 || box.right > ar.right + 1, outY = box.top < ar.top - 1 || box.bottom > ar.bottom + 1;
        const clipX = outX && s.overflowX !== 'visible', clipY = outY && s.overflowY !== 'visible';
        if (clipX || clipY) {
          const scrolls = (clipX && /auto|scroll/.test(s.overflowX)) || (clipY && /auto|scroll/.test(s.overflowY));
          if (!scrolls && !truncated) kind = 'text-clipped';
          break;
        }
        if (a === card) { if (outX || outY) kind = 'text-outside'; break; }
      }
      if (kind) faults.push({ card: name, kind, text: t.textContent.trim().slice(0, 60) });
    }
  }
  return faults;
});
try {
  await chooseStyle(b, "Default", "transparent");
  for (const theme of ["light", "dark"]) for (const width of [1440, 720]) {
    await b.setWindowSize(width, 1000);
    await b.execute(t => [...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find(e => e.textContent.trim().toLowerCase() === t).click(), theme);
    for (const page of ["Dashboard", "Accounts", "Transactions", "Recurring", "Budget", "Goals", "Cash Flow", "Investments", "Household", "Reports", "Settings", "Help"]) {
      await b.$(`.nav-item[aria-label="${page}"]`).click();
      await b.$('.main h1').moveTo(); // off the sidebar, onto the page title, so no sidebar popout covers the page
      await dismissStatusMessages(b);
      await b.execute(() => document.querySelector('.main').scrollTop = 0);
      // In the narrow layout a hovered or keyboard-focused sidebar tab shows its name as a popout over the page.
      const popout = await b.execute(() => [...document.querySelectorAll('.nav-item')].map(e => e.getAttribute('aria-label'))
        .find((label, i, all) => label && getComputedStyle(document.querySelectorAll('.nav-item')[i], '::after').content === `"${label}"`) ?? null);
      assert.equal(popout, null, `${page} ${theme} ${width}: no sidebar name popout covers the page in the screenshot`);
      const g = await geometry();
      assert.equal(g.background, theme === "light" ? "rgb(230, 238, 247)" : "rgb(15, 27, 42)", "the shipped Default palette is active");
      assert.ok(g.overflow <= 1, `${page} ${theme} ${width}: no page-wide overflow`);
      for (const band of g.bands) {
        assert.ok(Math.abs(band.left) <= 1 && Math.abs(band.right) <= 1, `${page}: shaded header edges ${JSON.stringify(band)}`);
        assert.ok(band.height >= 47, `${page}: header has room for its text and controls`);
      }
      let faults = [];
      await b.waitUntil(async () => (faults = await contentFaults()).length === 0, { timeout: 5000, interval: 250 }).catch(() => {});
      assert.deepEqual(faults, [], `${page} ${theme} ${width}: every panel has content, every chart has data marks and no text leaves its panel`);
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
  // Negative controls: each injected fault must be reported against its own card, and deliberate ellipsis truncation must not be.
  await b.execute(() => {
    const cards = [...document.querySelectorAll('.page .card')].filter(c => c.checkVisibility() && c.getBoundingClientRect().width > 200 && !c.querySelector('.card'));
    const take = (kind, test = () => true) => { const c = cards.find(x => !x.dataset.control && test(x)); c.dataset.control = kind; return c; };
    const empty = take('empty', c => c.querySelector(':scope > .card-head'));
    for (const el of empty.children) if (!el.matches('.card-head')) el.style.visibility = 'hidden';
    const chartSized = s => { const r = s.getBoundingClientRect(); return r.width >= 80 && r.height >= 40; };
    for (const mark of take('chart', c => [...c.querySelectorAll('svg[role="img"]')].some(chartSized)).querySelectorAll('svg :is(rect,polyline,polygon,path,circle)')) mark.style.display = 'none';
    const long = 'This sentence is much too long for its panel and keeps going well past the right-hand border of the card. '.repeat(3);
    const add = (kind, style) => { const d = document.createElement('div'); d.setAttribute('style', style); d.textContent = long; take(kind).append(d); };
    add('outside', 'white-space:nowrap');
    add('clipped', 'white-space:nowrap;overflow:hidden;width:120px');
    add('ellipsis', 'white-space:nowrap;overflow:hidden;width:120px;text-overflow:ellipsis');
  });
  const controls = await contentFaults();
  const kindsFor = card => controls.filter(f => f.card === card).map(f => f.kind);
  assert.ok(kindsFor('empty').includes('empty-panel'), `an emptied panel is reported: ${JSON.stringify(controls)}`);
  assert.ok(kindsFor('chart').includes('chart-no-marks'), `a chart without marks is reported: ${JSON.stringify(controls)}`);
  assert.ok(kindsFor('outside').some(k => k === 'text-outside' || k === 'text-clipped'), `text past the border is reported: ${JSON.stringify(controls)}`);
  assert.ok(kindsFor('clipped').includes('text-clipped'), `text clipped without an ellipsis is reported: ${JSON.stringify(controls)}`);
  assert.deepEqual(kindsFor('ellipsis'), [], "deliberate ellipsis truncation is not reported");
  // The default palette does not recolor other appearance styles.
  await chooseStyle(b, "Retro", "retro");
  assert.notEqual((await geometry()).background, "rgb(230, 238, 247)");
  fs.writeFileSync(path.join(shots, "default-layout.json"), JSON.stringify(results, null, 2));
  console.log("FEATURE 415 PASSED: 12 sections in light/dark at 1440/720, header edges, overflow, panel content, chart marks, text inside panels and equal report sizes through Customize.");
} finally { await app.close(); }
