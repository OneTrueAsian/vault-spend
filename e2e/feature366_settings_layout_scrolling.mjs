// Settings keeps its title row, search box and list of groups in place, and only the content beside the list scrolls.
//   One scrollbar (the content's), the page itself never scrolls; wide margins of 24 to 32px; a list about 200px wide;
//   description lines stay short (the shared content boundary is checked in feature367); a newly chosen group starts at the top; a focused control scrolls into view and is not
//   covered; the list stays reachable with large text; a very narrow area swaps the list for a category selector.
//
// Run with: node e2e/feature366_settings_layout_scrolling.mjs

import assert from "node:assert/strict";
import { launchApp, openSettingsGroup, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);
const app = await launchApp({ dbDir });
const { browser: b } = app;

const rect = (selector) =>
  b.execute((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  }, selector);
const scrollState = (selector) => b.execute((sel) => ({ top: document.querySelector(sel).scrollTop, scroll: document.querySelector(sel).scrollHeight, client: document.querySelector(sel).clientHeight }), selector);

try {
  await b.setWindowSize(1440, 760);
  await openSettingsGroup(b, "features");
  await waitUntilOrDiagnose(b, async () => (await scrollState(".settings-content")).scroll > 0, { timeoutMsg: "the Features content should be on screen" });

  // ---- the page does not scroll; the content does
  const main = await scrollState(".main");
  assert.ok(main.scroll <= main.client + 1, `the app's page area must not scroll on Settings (${main.scroll} > ${main.client})`);
  const content = await scrollState(".settings-content");
  assert.ok(content.scroll > content.client + 50, `Features should be taller than the window so its content scrolls (${content.scroll} vs ${content.client})`);

  // ---- width: margins of 24 to 32px, a list of about 200px, content using the rest
  const padding = await b.execute(() => parseFloat(getComputedStyle(document.querySelector(".page-settings")).paddingLeft));
  assert.ok(padding >= 24 && padding <= 32, `margin should be 24 to 32px, got ${padding}`);
  const nav = await rect(".settings-nav");
  const body = await rect(".settings-body");
  assert.ok(nav.width >= 190 && nav.width <= 210, `the list should be about 200px wide, got ${nav.width}`);
  const contentBox = await rect(".settings-content");
  assert.ok(contentBox.width >= body.width - nav.width - 24 - 20, `the content should take the room beside the list, got ${contentBox.width}px of ${body.width}px`);
  assert.ok(contentBox.right <= body.right + 1, "the content stays inside the page");

  // ---- description lines stay short in a wide card
  const lineWidth = await b.execute(() => Math.max(...[...document.querySelectorAll('[data-settings-panel="features"] .modal-message-secondary')].map((p) => p.getBoundingClientRect().width)));
  assert.ok(lineWidth < 820, `descriptions should wrap at a readable width, widest is ${lineWidth}px`);

  // ---- scrolling the content leaves the title row, search and list where they are
  const before = { title: await rect(".settings-top h1"), search: await rect('input[aria-label="Search settings"]'), nav: await rect(".settings-nav") };
  await b.execute(() => { document.querySelector(".settings-content").scrollTop = 400; });
  await b.pause(300);
  assert.equal((await scrollState(".settings-content")).top > 0, true, "the content scrolled");
  const after = { title: await rect(".settings-top h1"), search: await rect('input[aria-label="Search settings"]'), nav: await rect(".settings-nav") };
  assert.deepEqual(after, before, "the title row, search box and list must not move while the content scrolls");

  // ---- a newly chosen group starts at the top
  await openSettingsGroup(b, "data");
  await waitUntilOrDiagnose(b, async () => (await scrollState(".settings-content")).top === 0, { timeoutMsg: "a newly chosen group should start at the top" });

  // ---- a focused control far down is scrolled into view and is not under the fixed parts
  await openSettingsGroup(b, "features");
  await b.execute(() => { document.querySelector(".settings-content").scrollTop = 0; });
  await b.execute(() => document.querySelector('[data-setting="safe-to-spend"] input').focus());
  await b.pause(300);
  const focused = await b.execute(() => {
    const el = document.querySelector('[data-setting="safe-to-spend"] input').getBoundingClientRect();
    const box = document.querySelector(".settings-content").getBoundingClientRect();
    const head = document.querySelector(".settings-top").getBoundingClientRect();
    return { top: el.top, bottom: el.bottom, boxTop: box.top, boxBottom: box.bottom, headBottom: head.bottom };
  });
  assert.ok(focused.top >= focused.boxTop - 1 && focused.bottom <= focused.boxBottom + 1, `the focused control should be inside the scrolling content ${JSON.stringify(focused)}`);
  assert.ok(focused.top >= focused.headBottom, "the fixed title row must not cover the focused control");

  // ---- the list is still reachable: a very short area scrolls the whole page instead (large text, 200% zoom)
  await b.execute(() => { document.documentElement.style.zoom = "2"; });
  await b.pause(500);
  const zoomed = await b.execute(() => {
    const main = document.querySelector(".main");
    const nav = document.querySelector(".settings-nav");
    const select = document.querySelector("[data-settings-select]");
    const visible = (el) => !!el && getComputedStyle(el).display !== "none";
    return { mainScrolls: main.scrollHeight > main.clientHeight, navShown: visible(nav), selectShown: visible(select), width: window.innerWidth / 2 };
  });
  assert.ok(zoomed.navShown || zoomed.selectShown, `at 200% some way to change group must show: ${JSON.stringify(zoomed)}`);
  if (zoomed.width * 2 <= 1440 && zoomed.selectShown) {
    // a very narrow area: the selector replaces the list and moves between groups
    await b.execute(() => document.querySelector("[data-settings-select] [data-value]").click());
    await waitUntilOrDiagnose(b, async () => b.execute(() => !!document.querySelector("[data-settings-select] [role='menuitemradio'][data-value='data']")), { timeoutMsg: "the selector should open its menu" });
    await b.execute(() => document.querySelector("[data-settings-select] [role='menuitemradio'][data-value='data']").click());
    await waitUntilOrDiagnose(b, async () => b.execute(() => document.querySelector('[data-settings-panel="data"]').hidden === false), { timeoutMsg: "the selector should open the Data group" });
  }
  await b.execute(() => { document.documentElement.style.zoom = ""; });

  console.log("FEATURE 366 E2E TEST PASSED");
} finally {
  await app.close?.();
}
