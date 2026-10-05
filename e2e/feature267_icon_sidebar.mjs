// Icon-only sidebar below 1000px (UI review suggestion 13, 1.3.0).
//
// - At the default window size (1280x800) the sidebar shows its names, and "Show names" is not there.
// - At 900px the tabs shrink to icons. Each keeps its name (aria-label, and its text visually hidden,
//   not removed), and the name appears beside the icon on keyboard focus and on hover.
// - "Show names" lays the full sidebar over the page; choosing a tab, Escape, a click outside it, or
//   widening the window past 1000px closes it again.
// - The one-button theme switch stands in for Light / Dark / System, and works.
// - In all three styles the icons and the name beside them are drawn (screenshots for review).
// - The profile menu opens beside the icon-only rail, whole, rather than cut off inside it.
// - At the smallest window height (520px), in the icon-only and the full sidebar, every tab can be
//   reached by scrolling the sidebar (keyboard focus brings it fully into view, clear of the
//   controls at the foot), and at the end of the scroll the controls do not cover Help.
//
// Run with: node e2e/run-all.mjs --spec=267

import os from "node:os";
import path from "node:path";
import { DEFAULT_WINDOW_SIZE, launchApp, waitUntilOrDiagnose, withFocusRetry } from "./harness.mjs";

const app = await launchApp();
const { browser } = app;

const sidebarState = () =>
  browser.execute(() => {
    const sidebar = document.querySelector(".sidebar");
    const budget = document.querySelector(".nav-item[data-tab=budget]");
    const expand = document.querySelector("[data-sidebar-expand]");
    return {
      window: [innerWidth, innerHeight],
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
      budgetWidth: Math.round(budget.getBoundingClientRect().width),
      budgetLabel: budget.getAttribute("aria-label"),
      textPosition: getComputedStyle(budget.querySelector(".nav-text")).position,
      expandShown: !!expand && getComputedStyle(expand).display !== "none",
      expanded: document.querySelector(".app-shell").classList.contains("sidebar-expanded"),
      ariaExpanded: expand?.getAttribute("aria-expanded"),
      active: document.querySelector(".nav-item.nav-item-active")?.dataset.tab,
    };
  });

const iconOnly = (s) => s.budgetWidth < 80 && s.textPosition === "absolute" && s.expandShown && !s.expanded;

async function waitForIconOnly(why) {
  await waitUntilOrDiagnose(browser, async () => iconOnly(await sidebarState()), { timeoutMsg: why, extra: sidebarState });
}

/** Picks a style on Settings > Appearance, the way a person does. */
async function chooseStyle(label, palette) {
  await (await browser.$(".nav-item[data-tab=settings]")).click();
  await waitUntilOrDiagnose(
    browser,
    () =>
      browser.execute(
        (text) =>
          [...document.querySelectorAll('[role="radiogroup"][aria-label="Theme"] .feature-toggle-row')].some(
            (r) => r.querySelector(".feature-toggle-label")?.textContent === text,
          ),
        label,
      ),
    { timeoutMsg: `Settings > Appearance should offer ${label}` },
  );
  await browser.execute((text) => {
    const row = [...document.querySelectorAll('[role="radiogroup"][aria-label="Theme"] .feature-toggle-row')].find(
      (r) => r.querySelector(".feature-toggle-label")?.textContent === text,
    );
    row.querySelector("input").click();
  }, label);
  await waitUntilOrDiagnose(browser, () => browser.execute((p) => document.documentElement.dataset.palette === p, palette), {
    timeoutMsg: `choosing ${label} should apply it`,
  });
}

/** Keyboard focus onto the Budget tab (Tab from the tab before it), then its name beside the icon. */
async function focusBudgetAndReadName() {
  return withFocusRetry(browser, async () => {
    await browser.execute(() => {
      const tabs = [...document.querySelectorAll(".sidebar .nav-item")];
      tabs[tabs.findIndex((b) => b.dataset.tab === "budget") - 1].focus();
    });
    await browser.keys("Tab");
    const read = () =>
      browser.execute(() => {
        const budget = document.querySelector(".nav-item[data-tab=budget]");
        return {
          focused: document.activeElement === budget,
          focusVisible: budget.matches(":focus-visible"),
          name: getComputedStyle(budget, "::after").content,
        };
      });
    await waitUntilOrDiagnose(browser, async () => (await read()).name === '"Budget"', {
      timeout: 4000,
      timeoutMsg: "keyboard focus on the Budget icon should show its name beside it",
      extra: read,
    });
  });
}

/** Every tab reachable by keyboard focus, fully in view and not covered by the controls at the foot,
 * and Help clear of them at the end of the scroll. Only `.sidebar-scroll` scrolls. */
const reachability = () =>
  browser.execute(() => {
    const scroller = document.querySelector(".sidebar-scroll");
    const foot = document.querySelector(".sidebar-foot");
    const blocked = [];
    const tabs = [...scroller.querySelectorAll(".nav-item")];
    for (const tab of tabs) {
      tab.focus();
      const r = tab.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      const footTop = foot.getBoundingClientRect().top;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (r.top < view.top - 0.5 || r.bottom > Math.min(view.bottom, footTop) + 0.5 || !tab.contains(hit)) {
        blocked.push({ tab: tab.dataset.tab, top: Math.round(r.top), bottom: Math.round(r.bottom), viewBottom: Math.round(view.bottom), footTop: Math.round(footTop), hit: hit && String(hit.className) });
      }
    }
    tabs.at(-1).blur();
    scroller.scrollTop = scroller.scrollHeight;
    const help = document.querySelector(".nav-item[data-tab=help]").getBoundingClientRect();
    const footTop = foot.getBoundingClientRect().top;
    const result = {
      window: [innerWidth, innerHeight],
      tabs: tabs.length,
      scrolls: scroller.scrollHeight > scroller.clientHeight,
      blocked,
      helpBottom: Math.round(help.bottom),
      footTop: Math.round(footTop),
      footInWindow: foot.getBoundingClientRect().bottom <= innerHeight + 0.5,
    };
    scroller.scrollTop = 0;
    return result;
  });

/** Smallest window height: every tab reachable, none under the pinned controls, in the icon-only
 * sidebar (1000 and 800 wide) and the full one (1280 wide). */
async function checkSmallHeights(label) {
  for (const [width, height] of [
    [1000, 520],
    [800, 520],
    [1280, 520],
  ]) {
    await browser.setWindowSize(width, height);
    await waitUntilOrDiagnose(
      browser,
      async () => {
        const r = await reachability();
        return r.window[1] <= 520 && r.tabs === 12 && r.scrolls && r.blocked.length === 0 && r.helpBottom <= r.footTop && r.footInWindow;
      },
      { timeoutMsg: `${label} at ${width}x${height}: every tab should be reachable and clear of the pinned controls`, extra: reachability },
    );
  }
  await browser.setWindowSize(900, 800);
  console.log(`${label}: at 1000x520, 800x520 and 1280x520 every tab is reachable and Help clear of the pinned controls — OK`);
}

try {
  // Default window: names showing.
  const atLaunch = await sidebarState();
  if (atLaunch.window[0] <= 1000) {
    throw new Error(`launchApp should open the window at ${DEFAULT_WINDOW_SIZE.width}x${DEFAULT_WINDOW_SIZE.height} (wider than 1000px); got ${JSON.stringify(atLaunch)}`);
  }
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const s = await sidebarState();
      return s.sidebarWidth > 200 && s.textPosition !== "absolute" && !s.expandShown;
    },
    { timeoutMsg: "at 1280x800 the sidebar should show its names and no Show names button", extra: sidebarState },
  );
  console.log("Default window size: full sidebar with names — OK");

  // Icon-only at 900px; names kept.
  await browser.setWindowSize(900, 800);
  await waitForIconOnly("at 900px the sidebar should shrink to icons, keeping each name visually hidden");
  const narrow = await sidebarState();
  if (narrow.budgetLabel !== "Budget") throw new Error(`the Budget icon should be named Budget: ${JSON.stringify(narrow)}`);
  const missingNames = await browser.execute(() =>
    [...document.querySelectorAll(".sidebar .nav-item")].filter((b) => !b.getAttribute("aria-label") || b.getAttribute("aria-label") !== b.textContent.trim()).map((b) => b.dataset.tab),
  );
  if (missingNames.length) throw new Error(`every tab should keep its name: ${missingNames.join(", ")}`);
  // The text selectors specs use still find a tab by its name.
  await (await browser.$("button*=Settings")).click();
  await waitUntilOrDiagnose(browser, async () => (await sidebarState()).active === "settings", {
    timeoutMsg: "button*=Settings should still find and open Settings with the names hidden",
    extra: sidebarState,
  });
  console.log("900px: icons only, each tab keeps its name — OK");

  await focusBudgetAndReadName();
  console.log("Keyboard focus shows the tab's name beside the icon — OK");

  await withFocusRetry(browser, async () => {
    await (await browser.$(".nav-item[data-tab=accounts]")).moveTo();
    const hoverName = () => browser.execute(() => getComputedStyle(document.querySelector(".nav-item[data-tab=accounts]"), "::after").content);
    await waitUntilOrDiagnose(browser, async () => (await hoverName()) === '"Accounts"', {
      timeout: 4000,
      timeoutMsg: "hovering the Accounts icon should show its name beside it",
      extra: hoverName,
    });
  });
  console.log("Hover shows the tab's name — OK");

  // The profile menu, beside the rail and whole.
  await (await browser.$(".profile-switcher-toggle")).click();
  const profileMenu = () =>
    browser.execute(() => {
      const panel = document.querySelector(".profile-switcher-panel");
      if (!panel) return { open: false };
      const r = panel.getBoundingClientRect();
      const rail = document.querySelector(".sidebar").getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20));
      return {
        open: true,
        left: Math.round(r.left),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        window: [innerWidth, innerHeight],
        hit: hit && `${hit.tagName}.${String(hit.className)}`,
        railRight: Math.round(rail.right),
        width: Math.round(r.width),
        inWindow: r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
        onTop: panel.contains(hit),
        cut: panel.scrollWidth > panel.clientWidth + 1,
      };
    });
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const m = await profileMenu();
      return m.open && m.left >= m.railRight && m.width >= 150 && m.inWindow && m.onTop && !m.cut;
    },
    { timeoutMsg: "the profile menu should open beside the icon-only rail, whole and on top", extra: profileMenu },
  );
  await browser.saveScreenshot(path.join(os.tmpdir(), "vault-267-profile-menu.png"));
  await (await browser.$(".profile-switcher-toggle")).click();
  await waitUntilOrDiagnose(browser, async () => !(await profileMenu()).open, { timeoutMsg: "the profile menu should close again" });
  console.log("The profile menu opens beside the rail — OK");

  // Show names, then choose a tab: it closes and the tab opens.
  await (await browser.$("[data-sidebar-expand]")).click();
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const s = await sidebarState();
      return s.expanded && s.sidebarWidth >= 200 && s.textPosition !== "absolute" && s.ariaExpanded === "true";
    },
    { timeoutMsg: "Show names should lay the full sidebar, with names, over the page", extra: sidebarState },
  );
  const shifted = await browser.execute(() => {
    const main = document.querySelector(".main").getBoundingClientRect();
    const sidebar = document.querySelector(".sidebar").getBoundingClientRect();
    return { mainLeft: Math.round(main.left), sidebarRight: Math.round(sidebar.right) };
  });
  if (shifted.mainLeft >= shifted.sidebarRight) throw new Error(`the names should lie over the page, not push it aside: ${JSON.stringify(shifted)}`);
  await browser.saveScreenshot(path.join(os.tmpdir(), "vault-267-expanded.png"));
  await (await browser.$(".nav-item[data-tab=budget]")).click();
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const s = await sidebarState();
      return iconOnly(s) && s.active === "budget" && s.ariaExpanded === "false";
    },
    { timeoutMsg: "choosing Budget should close the names and open Budget", extra: sidebarState },
  );
  console.log("Show names opens the full sidebar; choosing a tab closes it and opens the tab — OK");

  // Escape and a click outside close it too.
  await (await browser.$("[data-sidebar-expand]")).click();
  await waitUntilOrDiagnose(browser, async () => (await sidebarState()).expanded, { timeoutMsg: "Show names should open again", extra: sidebarState });
  await withFocusRetry(browser, async () => {
    await browser.keys("Escape");
    await waitForIconOnly("Escape should close the names");
  });
  await (await browser.$("[data-sidebar-expand]")).click();
  await waitUntilOrDiagnose(browser, async () => (await sidebarState()).expanded, { timeoutMsg: "Show names should open again", extra: sidebarState });
  // The window's bottom-right corner: page margin, far from the sidebar and from any control.
  const [vw, vh] = await browser.execute(() => [innerWidth, innerHeight]);
  await browser
    .action("pointer")
    .move({ x: vw - 6, y: vh - 6 })
    .down()
    .up()
    .perform();
  await waitForIconOnly("a click on the page should close the names");
  console.log("Escape and a click outside close the names — OK");

  // Widening past 1000px ends Show names; narrowing again starts from icons.
  await (await browser.$("[data-sidebar-expand]")).click();
  await waitUntilOrDiagnose(browser, async () => (await sidebarState()).expanded, { timeoutMsg: "Show names should open again", extra: sidebarState });
  await browser.setWindowSize(1280, 800);
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const s = await sidebarState();
      return !s.expanded && !s.expandShown && s.sidebarWidth > 200;
    },
    { timeoutMsg: "widening the window should leave the full sidebar, not the overlay", extra: sidebarState },
  );
  await browser.setWindowSize(900, 800);
  await waitForIconOnly("narrowing again should start from icons");
  console.log("Widening the window ends Show names — OK");

  // The one-button theme switch.
  const theme = () => browser.execute(() => document.documentElement.dataset.theme);
  const cycle = await browser.$(".sidebar-foot [data-theme-cycle]");
  await cycle.waitForDisplayed({ timeoutMsg: "the one-button theme switch should show in the icon-only sidebar" });
  const groupShown = await (await browser.$(".sidebar-foot .theme-toggle")).isDisplayed();
  if (groupShown) throw new Error("Light / Dark / System should step aside for the one-button switch");
  const before = await theme();
  await cycle.click();
  await waitUntilOrDiagnose(browser, async () => (await theme()) !== before, {
    timeoutMsg: `the one-button theme switch should change the theme from ${before}`,
    extra: () => browser.execute(() => document.querySelector("[data-theme-cycle]").getAttribute("aria-label")),
  });
  console.log("The one-button theme switch works — OK");

  // Each style, Light and Dark: the icon-only sidebar and a name beside an icon (screenshots).
  for (const [label, palette] of [
    ["Futuristic", "futuristic"],
    ["Retro", "retro"],
    ["Default", "transparent"],
  ]) {
    await chooseStyle(label, palette);
    for (const mode of ["light", "dark"]) {
      while ((await theme()) !== mode) {
        const was = await theme();
        await (await browser.$(".sidebar-foot [data-theme-cycle]")).click();
        await waitUntilOrDiagnose(browser, async () => (await theme()) !== was, { timeoutMsg: `the theme switch should move on from ${was}` });
      }
      await waitForIconOnly(`${label}/${mode}: the sidebar should be icons only`);
      await focusBudgetAndReadName();
      await browser.saveScreenshot(path.join(os.tmpdir(), `vault-267-${palette}-${mode}.png`));
    }
    await checkSmallHeights(label);
    console.log(`${label}: icons and the name beside them in Light and Dark (screenshots saved) — OK`);
  }

  // Back to the default size: names, and no Show names button.
  await browser.setWindowSize(DEFAULT_WINDOW_SIZE.width, DEFAULT_WINDOW_SIZE.height);
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const s = await sidebarState();
      return s.sidebarWidth > 200 && s.textPosition !== "absolute" && !s.expandShown && !(await (await browser.$("[data-sidebar-expand]")).isDisplayed());
    },
    { timeoutMsg: "at 1280x800 the full sidebar should show its names and no Show names button", extra: sidebarState },
  );
  console.log("1280x800: full sidebar, no Show names button — OK");

  console.log("FEATURE 267 E2E TEST PASSED");
} finally {
  await app.close();
}
