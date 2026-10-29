// Settings frame: the header, search and category navigation stay put through real jumps; one content boundary;
// category navigation that fits; actions next to what they operate on.
//   1. At 1280 x 900, Settings > Data, search "mobile" and open Mobile snapshots (the reported defect) in every style:
//      only the content scrolls, the outer page does not move, the header does not move, the setting is visible.
//      The same for a Quick settings jump and for keyboard focus on a far control.
//   2. One boundary: the search box, every card, a pair of cards and the backup history end at the same right edge,
//      and the content column never exceeds 1060px (checked at 1800, 1280 and 960 wide).
//   3. Narrow: at 720 wide the categories are not clipped (tabs that fit, or the category selector); zoomed in they are
//      still reachable; the selector changes group and search still works.
//   4. Actions: Setup data's buttons sit under their description at the card's left edge; Set up a phone is directly
//      under the access status; Pair a phone is inside the phone setup section; collapsed sections reserve no space.
//
// Run with: node e2e/feature367_settings_frame_boundary.mjs

import assert from "node:assert/strict";
import { chooseStyle, launchApp, openSettingsGroup, waitUntilOrDiagnose } from "./harness.mjs";
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
    return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
  }, selector);
const outerPage = () => b.execute(() => { const m = document.querySelector(".main"); return { top: m.scrollTop, scroll: m.scrollHeight, client: m.clientHeight }; });
const contentTop = () => b.execute(() => document.querySelector(".settings-content").scrollTop);
const near = (a, c, tolerance, message) => assert.ok(Math.abs(a - c) <= tolerance, `${message}: ${a} vs ${c}`);

async function assertStationary(header, label) {
  const page = await outerPage();
  assert.equal(page.top, 0, `${label}: the outer page must not scroll (scrollTop ${page.top})`);
  assert.ok(page.scroll <= page.client + 1, `${label}: the outer page must have no extra scroll extent (${page.scroll} > ${page.client})`);
  assert.deepEqual(await rect(".settings-top"), header, `${label}: the header must not move`);
}

async function assertRevealed(selector, header, label) {
  const shown = await b.execute((sel) => {
    const el = document.querySelector(sel).getBoundingClientRect();
    const box = document.querySelector(".settings-content").getBoundingClientRect();
    const head = document.querySelector(".settings-top").getBoundingClientRect();
    return { top: el.top, bottom: el.bottom, boxTop: box.top, boxBottom: box.bottom, headBottom: head.bottom, tall: el.height > box.height };
  }, selector);
  assert.ok(shown.top >= shown.boxTop - 1 && shown.top >= shown.headBottom - 1, `${label}: the setting must start inside the content, below the header ${JSON.stringify(shown)}`);
  if (!shown.tall) assert.ok(shown.bottom <= shown.boxBottom + 1, `${label}: the setting must fit inside the content ${JSON.stringify(shown)}`);
}

async function searchAndJump(query, resultText) {
  const input = await b.$('input[aria-label="Search settings"]');
  await input.setValue(query);
  await waitUntilOrDiagnose(b, async () => b.execute(() => !!document.querySelector(".settings-result-item")), { timeoutMsg: `search "${query}" should list results` });
  await b.execute((text) => [...document.querySelectorAll(".settings-result-item")].find((r) => r.textContent.includes(text)).click(), resultText);
  await b.pause(700);
}

const failures = [];
const part = async (name, run) => { try { await run(); } catch (error) { failures.push(`${name}: ${error.message}`); console.log(`PART FAILED ${name}: ${error.message}`); } };

try {
  await b.setWindowSize(1280, 900);

  // ---- 1. the real search path, in every style (Futuristic and Retro filled the window and moved the outer page)
  await part("1 stationary header", async () => {
  for (const [label, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await chooseStyle(b, label, palette);
    await b.execute(() => { document.documentElement.dataset.theme = "light"; });
    await openSettingsGroup(b, "display");
    await openSettingsGroup(b, "data");
    await b.pause(400);
    const header = await rect(".settings-top");
    await assertStationary(header, `${label} before`);

    await searchAndJump("mobile", "Mobile snapshots");
    await assertStationary(header, `${label} search jump`);
    assert.equal(await b.execute(() => document.activeElement?.getAttribute("data-setting-card")), "mobile-snapshots", `${label}: the result should take focus`);
    await assertRevealed('[data-setting-card="mobile-snapshots"]', header, `${label} search jump`);

    // a Quick settings jump (Automatic backups is a default entry)
    await openSettingsGroup(b, "quick");
    await b.execute(() => document.querySelector('[data-quick-entry="backups"] [data-quick-go]').click());
    await b.pause(700);
    await assertStationary(header, `${label} Quick settings jump`);
    await assertRevealed('[data-setting-card="backups"]', header, `${label} Quick settings jump`);

    // keyboard focus on a control far down a long group
    await openSettingsGroup(b, "features");
    await b.pause(300);
    assert.equal(await contentTop(), 0, `${label}: a newly chosen group starts at the top`);
    await b.execute(() => { const all = document.querySelectorAll('[data-settings-panel="features"] input[type="checkbox"]'); all[all.length - 1].focus(); });
    await b.pause(500);
    await assertStationary(header, `${label} keyboard focus`);
  }
  });

  // ---- 2. one boundary
  await part("2 one boundary", async () => {
  await chooseStyle(b, "Futuristic", "futuristic");
  const boundary = async (label, expectCap) => {
    for (const group of ["quick", "display", "profiles", "data", "features", "about"]) {
      await openSettingsGroup(b, group);
      await b.pause(250);
      const m = await b.execute((group) => {
        const content = document.querySelector(".settings-content");
        const cr = content.getBoundingClientRect();
        const search = document.querySelector('input[aria-label="Search settings"]').getBoundingClientRect();
        const panel = document.querySelector(".settings-content > [data-settings-panel]:not([hidden])");
        const cards = [...panel.querySelectorAll(":scope > .card, :scope > .settings-pair")].map((c) => c.getBoundingClientRect());
        const pairs = [...panel.querySelectorAll(":scope > .settings-pair > .card")].map((c) => c.getBoundingClientRect());
        const history = document.querySelector("[data-backups]")?.getBoundingClientRect();
        const nav = document.querySelector(".settings-nav").getBoundingClientRect();
        const first = cards[0];
        return {
          searchRight: search.right,
          cardRights: cards.map((c) => c.right),
          cardLefts: cards.map((c) => c.left),
          pairRights: pairs.map((c) => c.right), pairLefts: pairs.map((c) => c.left),
          historyRight: group === "data" ? history?.right : null,
          columnWidth: cr.width,
          navRight: nav.right,
          firstLeft: first?.left,
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          page: document.querySelector(".settings-page").getBoundingClientRect().width,
        };
      }, group);
      const where = `${label} / ${group}`;
      assert.ok(m.cardRights.length > 0, `${where}: expected cards`);
      for (const r of m.cardRights) near(r, m.cardRights[0], 1, `${where}: every card ends at the same right edge`);
      for (const l of m.cardLefts) near(l, m.cardLefts[0], 1, `${where}: every card starts at the same left edge`);
      near(m.searchRight, m.cardRights[0], 1.5, `${where}: the search box ends where the cards end`);
      if (m.pairRights.length) {
        near(Math.max(...m.pairRights), m.cardRights[0], 1, `${where}: a pair of cards fills the boundary`);
        near(Math.min(...m.pairLefts), m.cardLefts[0], 1, `${where}: a pair starts at the boundary`);
      }
      if (m.historyRight != null) near(m.historyRight, m.cardRights[0], 1, `${where}: backup history ends at the shared boundary`);
      if (expectCap) assert.ok(m.columnWidth <= 1061, `${where}: the content column is capped at 1060px, got ${m.columnWidth}`);
      assert.ok(m.docOverflow <= 0, `${where}: no horizontal page scroll (${m.docOverflow})`);
      assert.ok(m.page <= 1285, `${where}: the Settings frame is capped, got ${m.page}`);
      near(m.firstLeft, m.navRight + 24, 2, `${where}: content sits against the category list`);
    }
  };
  await b.setWindowSize(1800, 900);
  await boundary("1800", true);
  // a pair of cards sits side by side on a wide window and fills the boundary the same way
  await openSettingsGroup(b, "data");
  assert.equal(await b.execute(() => { const [a, c] = [...document.querySelectorAll(".settings-pair > .card")].map((e) => e.getBoundingClientRect()); return Math.abs(a.top - c.top) < 4 && Math.round(c.left - a.right); }), 14, "a pair has the same 14px gap used between rows");
  await b.setWindowSize(1280, 900);
  await boundary("1280", true);
  await b.setWindowSize(960, 800);
  await boundary("960", false);
  });

  // ---- 3. narrow category navigation
  await part("3 narrow navigation", async () => {
  await b.setWindowSize(720, 800);
  await openSettingsGroup(b, "data").catch(() => {});
  const nav720 = await b.execute(() => {
    const strip = document.querySelector(".settings-nav");
    const select = document.querySelector("[data-settings-select]");
    const shown = (el) => !!el && getComputedStyle(el).display !== "none";
    return { stripShown: shown(strip), stripClipped: shown(strip) && strip.scrollWidth > strip.clientWidth + 1, selectShown: shown(select) };
  });
  assert.ok(!nav720.stripClipped, `720: the category tabs must not be clipped or scroll sideways ${JSON.stringify(nav720)}`);
  assert.ok(nav720.stripShown || nav720.selectShown, "720: some way to change category must show");
  assert.equal(nav720.selectShown, true, "720: the labels do not fit comfortably, so the category selector is used");
  // the selector and the search box end where the cards end
  const edges720 = await b.execute(() => {
    const right = (el) => el.getBoundingClientRect().right;
    const card = document.querySelector(".settings-content > [data-settings-panel]:not([hidden]) .card");
    return { select: right(document.querySelector("[data-settings-select]")), search: right(document.querySelector('input[aria-label="Search settings"]')), card: card ? right(card) : null };
  });
  near(edges720.select, edges720.search, 1.5, "720: the selector ends where the search box ends");
  if (edges720.card != null) near(edges720.select, edges720.card, 1.5, "720: the selector ends where the cards end");
  // every category is reachable from the selector, and the current one is shown
  await b.execute(() => document.querySelector("[data-settings-select] [data-value]").click());
  await waitUntilOrDiagnose(b, async () => b.execute(() => !!document.querySelector("[data-settings-select] [role='menuitemradio']")), { timeoutMsg: "the selector should open" });
  const options = await b.execute(() => [...document.querySelectorAll("[data-settings-select] [role='menuitemradio']")].map((o) => o.textContent.replace(/✓$/, "").trim()));
  assert.deepEqual(options, ["Quick settings", "Display", "Profiles & security", "Data", "Features", "About"], "every category is in the selector");
  const marked = await b.execute(() => document.querySelector("[data-settings-select] [aria-checked='true']")?.textContent.replace(/✓$/, "").trim());
  const showing = await b.execute(() => document.querySelector(".settings-content > [data-settings-panel]:not([hidden]) .settings-group-head")?.textContent.trim());
  assert.equal(marked, showing, "the selector marks the category that is showing");
  await b.execute(() => document.querySelector("[data-settings-select] [role='menuitemradio'][data-value='about']").click());
  await waitUntilOrDiagnose(b, async () => b.execute(() => document.querySelector('[data-settings-panel="about"]').hidden === false), { timeoutMsg: "the selector should open About" });
  // search still works from the narrow layout
  await searchAndJump("mobile", "Mobile snapshots");
  assert.equal(await b.execute(() => document.querySelector('[data-settings-panel="data"]').hidden), false, "720: a search result opens its group");
  // at every width in between, the category navigation is never clipped (tabs that fit, or the selector)
  for (const width of [760, 800, 860, 900, 1000, 1100]) {
    await b.setWindowSize(width, 800);
    await b.pause(450);
    const sweep = await b.execute(() => {
      const strip = document.querySelector(".settings-nav");
      const select = document.querySelector("[data-settings-select]");
      const shown = (el) => !!el && getComputedStyle(el).display !== "none";
      const items = [...strip.querySelectorAll(".settings-nav-item")];
      const stripBox = strip.getBoundingClientRect();
      const cut = shown(strip) && items.some((i) => { const r = i.getBoundingClientRect(); return r.right > stripBox.right + 1 || r.left < stripBox.left - 1; });
      return { stripShown: shown(strip), selectShown: shown(select), clipped: shown(strip) && strip.scrollWidth > strip.clientWidth + 1, cut };
    });
    assert.ok(sweep.stripShown || sweep.selectShown, `${width}: a way to change category must show ${JSON.stringify(sweep)}`);
    assert.ok(!sweep.clipped && !sweep.cut, `${width}: the category tabs must not be clipped ${JSON.stringify(sweep)}`);
  }
  // roomier sizes keep tabs that fit
  await b.setWindowSize(960, 800);
  await b.pause(500);
  const nav960 = await b.execute(() => { const s = document.querySelector(".settings-nav"); return { shown: getComputedStyle(s).display !== "none", clipped: s.scrollWidth > s.clientWidth + 1 }; });
  assert.ok(!nav960.clipped, "960: nothing is clipped in the category list");
  assert.ok(nav960.shown || (await b.execute(() => getComputedStyle(document.querySelector("[data-settings-select]")).display !== "none")), "960: a way to change category shows");
  // enlarged text: still reachable, focus not covered
  await b.setWindowSize(1440, 900);
  await openSettingsGroup(b, "features");
  await b.execute(() => { document.documentElement.style.zoom = "2"; });
  await b.pause(500);
  const zoom = await b.execute(() => {
    const strip = document.querySelector(".settings-nav"), select = document.querySelector("[data-settings-select]");
    const shown = (el) => !!el && getComputedStyle(el).display !== "none";
    return { strip: shown(strip) && strip.scrollWidth <= strip.clientWidth + 1, select: shown(select) };
  });
  assert.ok(zoom.strip || zoom.select, `200% zoom: categories reachable ${JSON.stringify(zoom)}`);
  await b.execute(() => { document.querySelector('[data-settings-panel="features"] input[type="checkbox"]').focus(); });
  await b.pause(300);
  const zoomed = await b.execute(() => {
    const el = document.activeElement.getBoundingClientRect();
    const head = document.querySelector(".settings-top").getBoundingClientRect();
    return { top: el.top, headBottom: head.bottom, mainTop: document.querySelector(".main").scrollTop };
  });
  assert.ok(zoomed.top >= zoomed.headBottom - 1, `200% zoom: focus is not under the header ${JSON.stringify(zoomed)}`);
  await b.execute(() => { document.documentElement.style.zoom = ""; });
  });
  await b.execute(() => { document.documentElement.style.zoom = ""; });
  await b.setWindowSize(1280, 900);

  // ---- 4. actions next to what they operate on
  await part("4 actions", async () => {
  await openSettingsGroup(b, "data");
  await b.pause(300);
  const placed = await b.execute(() => {
    const r = (el) => el.getBoundingClientRect();
    const setup = document.querySelector("[data-setup-data]");
    const desc = setup.querySelector(".modal-message-secondary");
    const buttons = [...setup.querySelectorAll("button:not(.setting-star)")];
    const mobile = document.querySelector("[data-mobile-settings]");
    const status = mobile.querySelector("[role='status']");
    const setUp = [...mobile.querySelectorAll("button")].find((x) => x.textContent === "Set up a phone");
    const guide = [...mobile.querySelectorAll("details")].find((d) => d.querySelector("summary")?.textContent === "Phone setup and certificate trust");
    const pair = [...mobile.querySelectorAll("button")].find((x) => x.textContent === "Pair a phone");
    const closed = [...mobile.querySelectorAll("details:not([open])")].map((d) => r(d).height);
    return {
      setupLeft: r(buttons[0]).left, descLeft: r(desc).left, setupGap: r(buttons[0]).top - r(desc).bottom,
      secondLeft: r(buttons[1]).left, firstRight: r(buttons[0]).right,
      setUpGap: r(setUp).top - r(status.closest(".mobile-desktop-status")).bottom, setUpLeft: r(setUp).left, mobileLeft: r(mobile).left,
      pairInside: !!guide && guide.contains(pair),
      closedMax: Math.max(...closed),
    };
  });
  near(placed.setupLeft, placed.descLeft, 2, "Setup data: the buttons start at the description's left edge");
  assert.ok(placed.setupGap >= 4 && placed.setupGap <= 24, `Setup data: the buttons sit just under the description (${placed.setupGap}px)`);
  assert.ok(placed.secondLeft > placed.firstRight, "Setup data: the buttons are side by side, left to right");
  assert.ok(placed.setUpGap >= 4 && placed.setUpGap <= 20, `Set up a phone sits directly under the access status (${placed.setUpGap}px)`);
  assert.ok(placed.setUpLeft - placed.mobileLeft < 60, "Set up a phone is on the left, with the status");
  assert.equal(placed.pairInside, true, "Pair a phone is inside the phone setup section");
  assert.ok(placed.closedMax <= 48, `a collapsed section reserves only its own row (${placed.closedMax}px)`);
  });

  assert.equal(failures.length, 0, `FEATURE 367 failures:\n${failures.join("\n")}`);

  console.log("FEATURE 367 E2E TEST PASSED");
} finally {
  await app.close?.();
}
