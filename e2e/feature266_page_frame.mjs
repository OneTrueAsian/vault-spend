// The top of every page belongs to the page (UI review suggestion 3, 1.3.0). The big top bar is
// gone: Hide amounts and Light / Dark / System sit at the foot of the sidebar, and each page's own
// buttons sit on the right of its title row.
//
// - No `.topbar` element exists.
// - `.sidebar-foot` shows Hide amounts and the Light / Dark / System group, and they work.
// - On Transactions, the title row's actions hold "Import transactions…" and "Add transaction…".
// - On a scrolled Dashboard nothing tall is pinned over the top of the page (the old cover-up).
// - In all three styles, at the default window size, 1280x800 and 1440x1000, Hide amounts and
//   Light / Dark / System are fully inside the window without scrolling the sidebar (the foot stays
//   put below the part that scrolls, so no tab passes under it; the top bar used to keep them on
//   screen). In Light and Dark they fit the sidebar, no text is cut off, and the current theme reads.
// - Transactions doesn't scroll sideways at 800, 1280 or 1440px.
// - In a narrow window (icon-only sidebar, below 1000px) the one-button theme switch stands in for
//   the three-way group and Hide amounts shows an eye, struck through while amounts are hidden; both
//   fit and work.
//
// Styles and modes are switched through the app's own controls (Settings > Appearance and the
// sidebar's Light / Dark buttons), so the page and the app's state never disagree.
//
// Run with: node e2e/run-all.mjs --spec=266

import os from "node:os";
import path from "node:path";
import { chooseStyle, launchApp, reclaimWindowFocus, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '2500')")
acct = cur.lastrowid
for i in range(40):
    day = (today - datetime.timedelta(days=i)).isoformat()
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)", (acct, day, 'Store ' + str(i), '-' + str(10 + i) + '.00', 'Groceries', 'f266-' + str(i)))
`);

const app = await launchApp({ dbDir });
const { browser } = app;

async function nav(label) {
  await browser.execute((text) => [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === text).click(), label);
}

/** Clicks Light / Dark / System in the sidebar. */
async function chooseMode(label) {
  await (await browser.$(`//div[contains(@class,'sidebar-controls')]//div[@role='group']/button[normalize-space()='${label}']`)).click();
}

/** Hide amounts and the theme group: fully inside the window and the sidebar, sidebar not scrolled. */
const pinnedOnScreen = () =>
  browser.execute(() => {
    const sidebar = document.querySelector(".sidebar");
    const box = sidebar.getBoundingClientRect();
    const parts = {};
    for (const [name, sel] of [["privacy", ".sidebar-foot [data-privacy-toggle]"], ["theme", ".sidebar-foot .theme-toggle"]]) {
      const r = document.querySelector(sel).getBoundingClientRect();
      parts[name] = {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        inWindow: r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
        inSidebar: r.top >= box.top && r.bottom <= box.bottom && r.left >= box.left && r.right <= box.right,
      };
    }
    // Only the part above the foot scrolls (.sidebar-scroll), so no navigation ever passes under the
    // foot and it needs no cover of its own: the scrolling part ends where the foot begins.
    const scroller = document.querySelector(".sidebar-scroll");
    const footTop = document.querySelector(".sidebar-foot").getBoundingClientRect().top;
    const clear = !!scroller && scroller.getBoundingClientRect().bottom <= footTop + 0.5 && !document.querySelector(".sidebar-scroll .sidebar-foot");
    return { scrollTop: sidebar.scrollTop, window: [innerWidth, innerHeight], clear, parts };
  });
const isPinned = (m) => m.scrollTop === 0 && m.clear && Object.values(m.parts).every((p) => p.inWindow && p.inSidebar);

/** The controls fit the sidebar, nothing is cut off, and the current theme's text differs from its background. */
const sidebarFit = () =>
  browser.execute(() => {
    const sidebar = document.querySelector(".sidebar").getBoundingClientRect();
    const buttons = [...document.querySelectorAll(".sidebar-controls button")].filter((b) => b.offsetParent);
    const outside = [document.querySelector(".sidebar-controls .theme-toggle"), ...buttons]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < sidebar.left || r.right > sidebar.right;
      })
      .map((el) => el.textContent.trim() || el.className);
    const clipped = buttons.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim());
    const active = getComputedStyle(document.querySelector(".sidebar-controls .theme-toggle-active"));
    return { palette: document.documentElement.dataset.palette, theme: document.documentElement.dataset.theme, outside, clipped, activeColor: active.color, activeBg: active.backgroundColor };
  });

try {
  await browser.setWindowSize(1440, 1000);

  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.querySelectorAll(".topbar").length === 0 && !!document.querySelector(".sidebar")), {
    timeoutMsg: "there should be no top bar",
  });
  console.log("No top bar — OK");

  await waitUntilOrDiagnose(
    browser,
    async () => (await (await browser.$(".sidebar-foot [data-privacy-toggle]")).isDisplayed()) && (await (await browser.$(".sidebar-foot .theme-toggle")).isDisplayed()),
    { timeoutMsg: "Hide amounts and Light / Dark / System should show at the foot of the sidebar" },
  );
  console.log("Hide amounts and Light / Dark / System in the sidebar foot — OK");

  await nav("Transactions");
  await waitUntilOrDiagnose(
    browser,
    () =>
      browser.execute(() => {
        const labels = [...document.querySelectorAll(".page-top .page-actions button")].map((b) => b.textContent.trim());
        return labels.includes("Import transactions…") && labels.includes("Add transaction…");
      }),
    {
      timeoutMsg: "Transactions' title row should hold Import transactions… and Add transaction…",
      extra: () => browser.execute(() => [...document.querySelectorAll(".page-top button")].map((b) => b.textContent.trim())),
    },
  );
  console.log("Transactions: Import transactions… and Add transaction… beside the title — OK");

  // Page width: the title row's actions wrap rather than push the page sideways.
  for (const [width, height] of [
    [800, 900],
    [1280, 900],
    [1440, 1000],
  ]) {
    await browser.setWindowSize(width, height);
    await waitUntilOrDiagnose(
      browser,
      () =>
        browser.execute(() => {
          const main = document.querySelector(".main");
          return !!document.querySelector(".page-top .page-actions .import-controls") && main.scrollWidth <= main.clientWidth;
        }),
      {
        timeoutMsg: `Transactions should not scroll sideways at ${width}px`,
        extra: () => browser.execute(() => ({ scroll: document.querySelector(".main").scrollWidth, client: document.querySelector(".main").clientWidth })),
      },
    );
  }
  console.log("Transactions: no sideways scroll at 800, 1280 and 1440px — OK");

  // Hide amounts still works from its new place.
  await (await browser.$(".sidebar-foot [data-privacy-toggle]")).click();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.documentElement.getAttribute("data-privacy") === "on"), {
    timeoutMsg: "Hide amounts in the sidebar should hide amounts",
  });
  await (await browser.$(".sidebar-foot [data-privacy-toggle]")).click();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.documentElement.getAttribute("data-privacy") !== "on"), {
    timeoutMsg: "Show amounts in the sidebar should show amounts again",
  });
  console.log("Hide amounts toggles from the sidebar — OK");

  // Dashboard, scrolled: nothing tall stays pinned over the top of the page.
  await nav("Dashboard");
  const coverUps = () =>
    browser.execute(() => {
      const main = document.querySelector(".main");
      main.scrollTop = 400;
      const top = main.getBoundingClientRect().top;
      const pinned = [...main.querySelectorAll("*")]
        .filter((el) => /^(sticky|fixed)$/.test(getComputedStyle(el).position))
        .map((el) => ({ el: `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`, rect: el.getBoundingClientRect() }))
        .filter(({ rect }) => rect.height > 60 && rect.top <= top + 4 && rect.bottom > top)
        .map(({ el, rect }) => `${el} (${Math.round(rect.height)}px tall)`);
      return { scrolled: main.scrollTop, dashboard: !!document.querySelector(".stat-hero"), pinned };
    });
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const m = await coverUps();
      return m.dashboard && m.scrolled > 0 && m.pinned.length === 0;
    },
    { timeoutMsg: "the scrolled Dashboard should have nothing tall pinned over the top of the page", extra: coverUps },
  );
  console.log("Dashboard scrolled: nothing pinned over the page — OK");

  // Dark from the sidebar.
  await reclaimWindowFocus(browser);
  await chooseMode("Dark");
  const darkState = () =>
    browser.execute(() => ({
      theme: document.documentElement.dataset.theme,
      active: [...document.querySelectorAll(".sidebar-foot .theme-toggle button.theme-toggle-active")].map((b) => b.textContent),
    }));
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const s = await darkState();
      return s.theme === "dark" && s.active.length === 1 && s.active[0] === "Dark";
    },
    { timeoutMsg: "clicking Dark in the sidebar should switch to dark and mark Dark as the current choice", extra: darkState },
  );
  console.log("Dark from the sidebar switches the theme — OK");

  // Every style: pinned on screen at three window sizes; in Light and Dark the controls fit and read.
  for (const [label, palette] of [
    ["Default", "transparent"],
    ["Futuristic", "futuristic"],
    ["Retro", "retro"],
  ]) {
    await browser.setWindowSize(1440, 1000);
    await chooseStyle(browser, label, palette);
    for (const [width, height] of [
      [1200, 780],
      [1280, 800],
      [1440, 1000],
    ]) {
      await browser.setWindowSize(width, height);
      await waitUntilOrDiagnose(browser, async () => isPinned(await pinnedOnScreen()), {
        timeoutMsg: `${label} at ${width}x${height}: Hide amounts and Light / Dark / System should be fully on screen without scrolling the sidebar`,
        extra: pinnedOnScreen,
      });
    }
    console.log(`${label}: sidebar controls on screen at 1200x780, 1280x800 and 1440x1000 — OK`);

    for (const [mode, theme] of [
      ["Light", "light"],
      ["Dark", "dark"],
    ]) {
      await chooseMode(mode);
      await waitUntilOrDiagnose(
        browser,
        async () => {
          const f = await sidebarFit();
          return f.palette === palette && f.theme === theme && f.outside.length === 0 && f.clipped.length === 0 && f.activeColor !== f.activeBg;
        },
        { timeoutMsg: `${label}/${mode}: the sidebar controls should sit inside the sidebar, uncut, with the current theme readable`, extra: sidebarFit },
      );
      await browser.saveScreenshot(path.join(os.tmpdir(), `vault-266-sidebar-${palette}-${theme}.png`));
      console.log(`${label}/${mode}: sidebar controls fit and read — OK`);
    }
  }

  // A narrow window (icon-only sidebar), from a known state (Default, Light): the one-button switch
  // and the eye.
  await chooseStyle(browser, "Default", "transparent");
  await chooseMode("Light");
  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.documentElement.dataset.theme === "light"), {
    timeoutMsg: "Light should apply before the narrow-window checks",
  });
  await browser.setWindowSize(900, 700);
  const narrow = () =>
    browser.execute(() => {
      const sidebar = document.querySelector(".sidebar").getBoundingClientRect();
      const shown = (sel) => {
        const el = document.querySelector(sel);
        return !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
      };
      const misfits = [".sidebar-foot [data-privacy-toggle]", ".sidebar-foot [data-theme-cycle]"].filter((sel) => {
        const el = document.querySelector(sel);
        const r = el.getBoundingClientRect();
        return r.left < sidebar.left || r.right > sidebar.right || r.bottom > innerHeight || el.scrollWidth > el.clientWidth + 1;
      });
      return { innerWidth, cycle: shown(".sidebar-foot [data-theme-cycle]"), group: shown(".sidebar-foot .theme-toggle"), privacy: shown(".sidebar-foot [data-privacy-toggle]"), misfits };
    });
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const n = await narrow();
      return n.cycle && !n.group && n.privacy && n.misfits.length === 0;
    },
    { timeoutMsg: "in a narrow window Hide amounts and the one-button theme switch should show and fit on screen", extra: narrow },
  );

  const eye = () =>
    browser.execute(() => ({
      privacy: document.documentElement.getAttribute("data-privacy"),
      strike: getComputedStyle(document.querySelector(".sidebar-foot [data-privacy-toggle]"), "::before").textDecorationLine,
    }));
  await waitUntilOrDiagnose(browser, async () => !(await eye()).strike.includes("line-through"), {
    timeoutMsg: "while amounts show, the eye is not struck through",
    extra: eye,
  });
  await (await browser.$(".sidebar-foot [data-privacy-toggle]")).click();
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const e = await eye();
      return e.privacy === "on" && e.strike.includes("line-through");
    },
    { timeoutMsg: "the eye in the narrow rail should hide amounts and show itself struck through", extra: eye },
  );
  await (await browser.$(".sidebar-foot [data-privacy-toggle]")).click();
  await waitUntilOrDiagnose(
    browser,
    async () => {
      const e = await eye();
      return e.privacy !== "on" && !e.strike.includes("line-through");
    },
    { timeoutMsg: "the eye in the narrow rail should show amounts again", extra: eye },
  );

  // Light -> Dark: the switch moves to the next theme in its order.
  await (await browser.$(".sidebar-foot [data-theme-cycle]")).click();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.documentElement.dataset.theme === "dark"), {
    timeoutMsg: "the one-button theme switch should go from Light to Dark",
    extra: () => browser.execute(() => document.querySelector("[data-theme-cycle]").getAttribute("aria-label")),
  });
  await browser.saveScreenshot(path.join(os.tmpdir(), "vault-266-sidebar-narrow.png"));
  console.log("Narrow window: the eye and the one-button theme switch show, fit and work — OK");

  console.log("FEATURE 266 E2E TEST PASSED");
} finally {
  await app.close();
}
