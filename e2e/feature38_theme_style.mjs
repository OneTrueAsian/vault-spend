// E2E test for Settings ▸ Appearance's theme picker (Slate/Futuristic/
// Transparent): selecting a non-Slate style sets the `data-palette`
// attribute the CSS keys off of; switching back to Slate clears it. All
// three styles follow the header's Light/Dark/System toggle now — none of
// them hides it — so this also confirms the toggle lives in the header
// (`.topbar`), not the sidebar, following its relocation out of
// `.sidebar-foot`. Also covers a regression where `.nav-item:hover` (a
// class + pseudo-class, specificity 0,2,0) outranked a plain
// `.nav-item-active` (one class, 0,1,0), so hovering the already-active
// nav item fell back to the hover background/text color on all three
// themes — fixed by matching the DOM's actual compound class
// (`.nav-item.nav-item-active`, 0,2,0) so it ties and, via later source
// order, wins.
//
// Run with: node e2e/feature38_theme_style.mjs

import { launchApp } from "./harness.mjs";

// WebdriverIO's `tag*=text` reverse-text shorthand is unreliable outside a
// bare tag selector (see explore.mjs's header comment for the descendant-
// combinator case) — finding the row by its own text content in the page
// itself sidesteps that entirely.
async function selectTheme(app, label) {
  await app.browser.execute((text) => {
    const row = Array.from(document.querySelectorAll(".feature-toggle-row")).find((r) => r.textContent.includes(text));
    if (!row) throw new Error(`no .feature-toggle-row containing "${text}"`);
    row.querySelector("input").click();
  }, label);
}

async function activeNavBackground(app) {
  return app.browser.execute(() => {
    const el = document.querySelector(".nav-item-active");
    return el ? getComputedStyle(el).backgroundColor : null;
  });
}

// Hovering the currently-active nav item (Settings, throughout this test)
// must not change its background away from the active styling — see the
// header comment above.
async function assertActiveNavIgnoresHover(app, themeLabel) {
  // `.nav-item` transitions `background`/`color` over 120ms; without this,
  // a "before" snapshot taken right after a theme switch can land
  // mid-transition and mismatch a fully-settled "during" snapshot even
  // though nothing about hover actually changed anything.
  await app.browser.pause(200);
  const before = await activeNavBackground(app);
  const activeEl = await app.browser.$(".nav-item-active");
  await activeEl.moveTo();
  await app.browser.pause(150);
  const during = await activeNavBackground(app);
  // Reset the pointer away from the sidebar so it doesn't linger over the
  // next theme's active item for the following assertion/screenshot.
  await app.browser.execute(() => document.querySelector(".reports-section-title")?.scrollIntoView());
  if (before !== during) {
    throw new Error(`${themeLabel}: hovering the active nav item changed its background from "${before}" to "${during}"`);
  }
  console.log(`${themeLabel}: active nav item ignores hover — OK`);
}

const app = await launchApp();
try {
  const settingsNav = await app.browser.$("button*=Settings");
  await settingsNav.click();

  const appearanceHeading = await app.browser.$("//span[contains(@class,'reports-section-title')][text()='Appearance']");
  await appearanceHeading.waitForExist({ timeout: 10000 });

  // Exactly three theme options remain (Slate, Futuristic, Transparent) —
  // catches a leftover Aurora/Midnight Emerald row surviving the removal,
  // or a missing/duplicated Transparent row.
  const optionCount = await app.browser.execute(
    () => document.querySelectorAll('[role="radiogroup"][aria-label="Theme"] .feature-toggle-row').length,
  );
  if (optionCount !== 3) throw new Error(`expected exactly 3 theme options, found ${optionCount}`);

  // Slate (the default, internal id "classic"): the header toggle is
  // present inside .topbar (not the sidebar), and no palette is set.
  let palette = await app.browser.execute(() => document.documentElement.getAttribute("data-palette"));
  if (palette !== null) throw new Error(`expected no data-palette on Slate, got "${palette}"`);
  let toggleInHeader = await app.browser.execute(() => !!document.querySelector(".topbar .theme-toggle"));
  if (!toggleInHeader) throw new Error("expected the Light/Dark/System toggle inside .topbar on Slate");
  let toggleInSidebar = await app.browser.execute(() => !!document.querySelector(".sidebar-foot .theme-toggle"));
  if (toggleInSidebar) throw new Error("expected the toggle to no longer live in .sidebar-foot");
  console.log("Slate: data-palette clear, toggle lives in the header — OK");
  await assertActiveNavIgnoresHover(app, "Slate");

  await selectTheme(app, "Futuristic");
  palette = await app.browser.execute(() => document.documentElement.getAttribute("data-palette"));
  if (palette !== "futuristic") throw new Error(`expected data-palette="futuristic", got "${palette}"`);
  toggleInHeader = await app.browser.execute(() => !!document.querySelector(".topbar .theme-toggle"));
  if (!toggleInHeader) throw new Error("expected the Light/Dark/System toggle to still exist on Futuristic");
  const note = await app.browser.$(".sidebar-theme-note");
  if (await note.isExisting()) throw new Error("expected no always-dark note to exist at all anymore");
  console.log("Futuristic: data-palette set, toggle still present — OK");
  await assertActiveNavIgnoresHover(app, "Futuristic");

  await selectTheme(app, "Slate");
  palette = await app.browser.execute(() => document.documentElement.getAttribute("data-palette"));
  if (palette !== null) throw new Error(`expected data-palette to be cleared back to Slate, got "${palette}"`);
  toggleInHeader = await app.browser.execute(() => !!document.querySelector(".topbar .theme-toggle"));
  if (!toggleInHeader) throw new Error("expected the toggle to come back on Slate");
  console.log("Slate: data-palette cleared, toggle restored — OK");

  await selectTheme(app, "Transparent");
  palette = await app.browser.execute(() => document.documentElement.getAttribute("data-palette"));
  if (palette !== "transparent") throw new Error(`expected data-palette="transparent", got "${palette}"`);
  toggleInHeader = await app.browser.execute(() => !!document.querySelector(".topbar .theme-toggle"));
  if (!toggleInHeader) throw new Error("expected the Light/Dark/System toggle to still exist on Transparent");
  console.log("Transparent: data-palette set, toggle still present — OK");
  await assertActiveNavIgnoresHover(app, "Transparent");

  // Regression: Transparent's pill-button rule used a bare `button` type
  // selector, whose specificity (0,1,1) outranked the plain classes
  // (0,1,0) that `.stat`/`.stat-hero` tiles rely on for their own radius —
  // they render as a real <button> for expand/collapse, not because
  // they're meant to look like one. On the Dashboard's near-square
  // (194×164) hero cards, a 999px radius made the whole tile a circle.
  const dashboardNav = await app.browser.$("button*=Dashboard");
  await dashboardNav.click();
  const statHero = await app.browser.$(".stat-hero");
  await statHero.waitForExist({ timeout: 10000 });
  const statHeroRadius = await app.browser.execute(() => getComputedStyle(document.querySelector(".stat-hero")).borderRadius);
  if (statHeroRadius === "999px") {
    throw new Error(`Transparent: .stat-hero border-radius was pill-shaped (${statHeroRadius}) instead of its own card radius`);
  }
  console.log(`Transparent: .stat-hero keeps its own radius (${statHeroRadius}), not the pill rule — OK`);

  // Regression: the sticky `.topbar` sits over previously-scrolled content
  // *within the same scroll container* (`.main` never resets scroll
  // position on tab switches — true for every theme, just invisible
  // elsewhere because their topbar is fully opaque). A first attempt at
  // Transparent's glass topbar used `background: transparent` (Apple's
  // "Clear" variant needs its own dimming layer), then a lightly
  // translucent `--surface-2` (two stacked translucent layers still don't
  // add up to opaque) — both let scrolled-under content show through
  // half-legible and overlapping the topbar's own title. Scrolling the
  // Dashboard, then switching tabs without resetting scroll, reproduces
  // the exact scenario.
  await app.browser.execute(() => document.querySelector(".stat-hero")?.scrollIntoView({ block: "center" }));
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();
  await app.browser.pause(200);
  const topbarBg = await app.browser.execute(() => getComputedStyle(document.querySelector(".topbar")).backgroundColor);
  const alphaMatch = topbarBg.match(/rgba?\([^)]*,\s*([\d.]+)\)/);
  const topbarAlpha = alphaMatch ? Number(alphaMatch[1]) : 1; // rgb(...) with no 4th value means fully opaque
  if (topbarAlpha < 0.75) {
    throw new Error(`Transparent: .topbar background (${topbarBg}) is too translucent to mask scrolled-under content`);
  }
  console.log(`Transparent: .topbar background (${topbarBg}) opaque enough to mask scrolled content — OK`);

  await settingsNav.click();
  await appearanceHeading.waitForExist({ timeout: 10000 });

  await selectTheme(app, "Slate");
  palette = await app.browser.execute(() => document.documentElement.getAttribute("data-palette"));
  if (palette !== null) throw new Error(`expected data-palette to be cleared back to Slate after Transparent, got "${palette}"`);
  console.log("Slate: data-palette cleared after Transparent — OK");

  console.log("FEATURE 38 E2E TEST PASSED");
} finally {
  await app.close();
}
