// The top of every page belongs to the page (UI review suggestion 3, 1.3.0). The big top bar is
// gone: Hide amounts and Light / Dark / System sit at the foot of the sidebar, and each page's own
// buttons sit on the right of its title row.
//
// - No `.topbar` element exists.
// - `.sidebar-foot` shows Hide amounts and the Light / Dark / System group, and they work.
// - On Transactions, the title row's actions hold "Import transactions…" and "Add transaction…".
// - On a scrolled Dashboard nothing tall is pinned over the top of the page (the old cover-up).
// - The controls fit the sidebar in all three styles, Light and Dark, and Transactions doesn't
//   scroll sideways at 800, 1280 or 1440px. In the narrowest window the one-button theme switch
//   stands in for the three-way group and Hide amounts shows an eye; both fit the rail and work.
//
// Run with: node e2e/run-all.mjs --spec=166

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { launchApp, reclaimWindowFocus, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '2500')")
acct = cur.lastrowid
for i in range(40):
    day = (today - datetime.timedelta(days=i)).isoformat()
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)", (acct, day, 'Store ' + str(i), '-' + str(10 + i) + '.00', 'Groceries', 'f166-' + str(i)))
`);

const app = await launchApp({ dbDir });
const { browser } = app;

async function nav(label) {
  await browser.execute((text) => [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === text).click(), label);
}

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
  await waitUntilOrDiagnose(
    browser,
    () =>
      browser.execute(() => {
        const main = document.querySelector(".main");
        main.scrollTop = 400;
        return !!document.querySelector(".stat-hero") && main.scrollTop > 0;
      }),
    {
      timeoutMsg: "the Dashboard should scroll so the pinned-header check means something",
      extra: () => browser.execute(() => ({ scrollHeight: document.querySelector(".main").scrollHeight, clientHeight: document.querySelector(".main").clientHeight })),
    },
  );
  const coverUps = await browser.execute(() => {
    const main = document.querySelector(".main");
    const top = main.getBoundingClientRect().top;
    return [...main.querySelectorAll("*")]
      .filter((el) => /^(sticky|fixed)$/.test(getComputedStyle(el).position))
      .map((el) => ({ el: `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.height > 60 && rect.top <= top + 4 && rect.bottom > top)
      .map(({ el, rect }) => `${el} (${Math.round(rect.height)}px tall)`);
  });
  assert.deepEqual(coverUps, [], "nothing tall should be pinned over the top of the scrolled Dashboard");
  console.log("Dashboard scrolled: nothing pinned over the page — OK");

  // Light / Dark / System from the sidebar.
  await reclaimWindowFocus(browser);
  await browser.execute(() => [...document.querySelectorAll(".sidebar-foot .theme-toggle button")].find((b) => b.textContent === "Dark").click());
  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.documentElement.dataset.theme === "dark"), {
    timeoutMsg: "clicking Dark in the sidebar should switch to dark",
  });
  assert.ok(
    await browser.execute(() => [...document.querySelectorAll(".sidebar-foot .theme-toggle button")].find((b) => b.textContent === "Dark").classList.contains("theme-toggle-active")),
    "Dark is marked as the current choice",
  );
  console.log("Dark from the sidebar switches the theme — OK");

  // Every style and mode: the controls fit the sidebar and the chosen theme is readable.
  for (const palette of ["transparent", "futuristic", "retro"]) {
    for (const theme of ["light", "dark"]) {
      await browser.execute((p, t) => {
        document.documentElement.dataset.palette = p;
        document.documentElement.dataset.theme = t;
      }, palette, theme);
      await browser.pause(250); // colors transition
      const fit = await browser.execute(() => {
        const sidebar = document.querySelector(".sidebar").getBoundingClientRect();
        const parts = [".sidebar-controls [data-privacy-toggle]", ".sidebar-controls .theme-toggle", ...[...document.querySelectorAll(".sidebar-controls .theme-toggle button")].map((_, i) => `.sidebar-controls .theme-toggle button:nth-child(${i + 1})`)];
        const outside = parts.filter((sel) => {
          const r = document.querySelector(sel).getBoundingClientRect();
          return r.left < sidebar.left || r.right > sidebar.right;
        });
        const clipped = [...document.querySelectorAll(".sidebar-controls button")].filter((b) => b.offsetParent && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim());
        const active = getComputedStyle(document.querySelector(".sidebar-controls .theme-toggle-active"));
        return { outside, clipped, activeColor: active.color, activeBg: active.backgroundColor };
      });
      await browser.saveScreenshot(path.join(os.tmpdir(), `vault-166-sidebar-${palette}-${theme}.png`));
      assert.deepEqual(fit.outside, [], `${palette}/${theme}: the sidebar controls must sit inside the sidebar`);
      assert.deepEqual(fit.clipped, [], `${palette}/${theme}: no sidebar control's text may be cut off`);
      assert.notEqual(fit.activeColor, fit.activeBg, `${palette}/${theme}: the current theme's text must differ from its background`);
      console.log(`${palette}/${theme}: sidebar controls fit and read — OK`);
    }
  }

  // The narrowest window: the one-button theme switch stands in for the three-way group.
  await browser.setWindowSize(740, 700);
  await waitUntilOrDiagnose(
    browser,
    async () =>
      (await (await browser.$(".sidebar-foot [data-theme-cycle]")).isDisplayed()) &&
      !(await (await browser.$(".sidebar-foot .theme-toggle")).isDisplayed()) &&
      (await (await browser.$(".sidebar-foot [data-privacy-toggle]")).isDisplayed()),
    {
      timeoutMsg: "in the narrowest window Hide amounts and the one-button theme switch should still show",
      extra: () => browser.execute(() => innerWidth),
    },
  );
  const narrowFit = await browser.execute(() => {
    const sidebar = document.querySelector(".sidebar").getBoundingClientRect();
    return [".sidebar-foot [data-privacy-toggle]", ".sidebar-foot [data-theme-cycle]"].filter((sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      return r.left < sidebar.left || r.right > sidebar.right || el.scrollWidth > el.clientWidth + 1;
    });
  });
  assert.deepEqual(narrowFit, [], "in the narrowest window Hide amounts and the theme switch must fit the rail");
  await browser.execute(() => document.querySelector(".sidebar-foot [data-privacy-toggle]").click());
  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.documentElement.getAttribute("data-privacy") === "on"), {
    timeoutMsg: "Hide amounts in the narrow rail should hide amounts",
  });
  await browser.execute(() => document.querySelector(".sidebar-foot [data-privacy-toggle]").click());
  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.documentElement.getAttribute("data-privacy") !== "on"), {
    timeoutMsg: "the eye in the narrow rail should show amounts again",
  });
  const before = await browser.execute(() => document.documentElement.dataset.theme ?? "system");
  await browser.execute(() => document.querySelector(".sidebar-foot [data-theme-cycle]").click());
  await waitUntilOrDiagnose(browser, () => browser.execute((b) => (document.documentElement.dataset.theme ?? "system") !== b, before), {
    timeoutMsg: "the one-button theme switch should move to the next theme",
  });
  await browser.saveScreenshot(path.join(os.tmpdir(), "vault-166-sidebar-narrow.png"));
  console.log("Narrow window: Hide amounts and the one-button theme switch show and work — OK");

  console.log("FEATURE 166 E2E TEST PASSED");
} finally {
  await app.close();
}
