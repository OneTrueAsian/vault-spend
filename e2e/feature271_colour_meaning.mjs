// E2E test: colours mean one thing (UI review s4) — red only for what needs you, on the tidy
// two-person household data in the current month.
//
// - Dashboard: the Debt amount is the same plain colour as the Net worth amount, its tile uses the
//   neutral tint, and only its change line is coloured.
// - Dashboard: the budget alert banner names a category instead of counting them.
// - Budget: the income heading's progress fill is not the red (`--negative`) colour, and the
//   Mortgage line (paid exactly its budget on the 1st) reads "Used in full" in a neutral badge.
// - Recurring: the four total tiles use the neutral tint.
// - Accounts: a loan's "Owed" amount is the same plain colour as a checking balance, and the
//   "What you owe" tile uses the neutral tint.
// - A pinned debt account widget uses the neutral tint and badge.
// - In Default, Futuristic and Retro, each in Light and Dark, axe finds no contrast problem in the
//   parts this changed, the neutral (income still arriving) progress fill stands out from its track
//   at 3:1 or more (WCAG 1.4.11), and the pinned debt widget's icon stands out from its badge at 3:1. A screenshot of each page in each look is saved for a look by eye.
//
// Run with: node e2e/run-all.mjs --spec=271

import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { launchApp, waitForDataLoaded, waitUntilOrDiagnose } from "./harness.mjs";
import { seedHouseholdDatabase } from "./household-demo.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";

const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const CATEGORIES = [
  "Mortgage", "Car Payment", "Student Loan", "Utilities", "Phone", "Insurance", "Subscriptions", "Groceries",
  "Dining Out", "Gas", "Shopping", "Entertainment", "Household", "Health", "Travel",
];

const shotsDir = process.env.VS_SCREENS_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "vaultspend-feature271-"));
fs.mkdirSync(shotsDir, { recursive: true });
const dbDir = freshTestDbDir();
await seedHouseholdDatabase(dbDir);
// Pin the Car Loan to the Dashboard, so its widget (neutral tint and badge) is on the page.
execFileSync("python", [
  "-c",
  `
import json, sqlite3, sys
con = sqlite3.connect(sys.argv[1])
car = con.execute("SELECT id FROM accounts WHERE name = 'Car Loan'").fetchone()[0]
layout = ["stat_net_worth", "stat_cash", "stat_debt", "stat_investments", "needs_a_look", "safe_to_spend", "runway",
          "trend_spending", "budget_bills", "recent_transactions", f"account:{car}"]
con.execute("INSERT OR REPLACE INTO profile_ui_state (key, value) VALUES ('dashboard_layout', ?)", (json.dumps(layout),))
con.commit()
`,
  path.join(dbDir, "vaultspend.db"),
]);
const app = await launchApp({ dbDir });
const { browser } = app;

/** Reads `read()` until `ok(value)` holds, and returns that value. A timeout's message carries what
 * the window looked like and the last value read (never a judgement on one read). */
async function settled(read, ok, timeoutMsg, timeout = 15000) {
  let last;
  await waitUntilOrDiagnose(browser, async () => Boolean(ok((last = await read()))), { timeout, timeoutMsg, extra: async () => last });
  return last;
}

async function openTab(id, ready, what) {
  await (await browser.$(`.nav-item[data-tab=${id}]`)).click();
  await settled(() => browser.execute(ready), Boolean, `expected ${what}`, 20000);
}

/** The computed colour a CSS colour token resolves to here, in the same `rgb(...)` form the
 * computed styles use. */
const tokenColour = (token) =>
  browser.execute((t) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${t})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, token);

/** Non-text contrast (WCAG 1.4.11) in the window: each neutral progress fill against its track, and
 * the pinned debt widget's icon against its badge. Colours are composited over their ancestors'
 * background colours down to the page's opaque background (background images are not counted). */
const measureNonText = () =>
  browser.execute(() => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return [r, g, b, a];
    };
    const over = (top, base) => [0, 1, 2].map((i) => top[i] * top[3] + base[i] * (1 - top[3])).concat(1);
    const behind = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c[3] > 0) layers.push(c);
        if (c && c[3] >= 1) break;
      }
      let colour = [255, 255, 255, 1];
      for (const layer of layers.reverse()) colour = over(layer, colour);
      return colour;
    };
    const lum = ([r, g, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };
    const fills = [...document.querySelectorAll(".progress-fill.neutral")].map((fill) => {
      const track = behind(fill.parentElement);
      const own = parse(getComputedStyle(fill).backgroundColor);
      const opacity = Number(getComputedStyle(fill).opacity);
      const shown = over([own[0], own[1], own[2], own[3] * opacity], track);
      return { where: fill.closest("[data-budget-group]")?.dataset.budgetGroup ?? "?", ratio: ratio(shown, track) };
    });
    const badge = document.querySelector('[data-widget-id^="account:"] .mini-ico');
    let icon = null;
    if (badge) {
      const bg = behind(badge);
      const glyph = badge.querySelector("img, svg");
      let fg = null;
      if (glyph?.tagName === "svg") fg = parse(getComputedStyle(glyph).color);
      else if (glyph?.classList.contains("icon-img")) fg = getComputedStyle(glyph).filter.includes("invert(1)") ? [255, 255, 255, 1] : [0, 0, 0, 1];
      icon = { badgeClass: badge.getAttribute("class"), kind: glyph?.getAttribute("class") ?? glyph?.tagName ?? null, ratio: fg ? ratio(fg, bg) : null };
    }
    return { fills, icon };
  });

try {
  // ---- 1. Dashboard: the Debt amount is plain, only its change line is coloured -----------------
  const dash = await settled(
    () =>
      browser.execute(() => {
        const debt = document.querySelector('[data-stat="debt"]');
        const net = document.querySelector('[data-widget-id="stat_net_worth"] .stat-value');
        const delta = debt?.querySelector(".stat-delta");
        return {
          debtValueColour: debt ? getComputedStyle(debt.querySelector(".stat-value")).color : null,
          debtValueClass: debt?.querySelector(".stat-value")?.getAttribute("class") ?? null,
          netValueColour: net ? getComputedStyle(net).color : null,
          tileClass: debt?.getAttribute("class") ?? null,
          deltaClass: delta?.getAttribute("class") ?? null,
          deltaColour: delta ? getComputedStyle(delta).color : null,
        };
      }),
    (d) => d.debtValueColour && d.netValueColour && d.deltaClass,
    "expected the Dashboard's Debt and Net worth tiles, with the Debt change line",
  );
  assert.equal(dash.debtValueColour, dash.netValueColour, `the Debt amount should be the Net worth amount's colour: ${JSON.stringify(dash)}`);
  assert.equal(dash.debtValueClass, "stat-value", "the Debt amount should carry no colour class");
  assert.ok(dash.tileClass.split(" ").includes("tint-neutral"), `the Debt tile should use the neutral tint: ${dash.tileClass}`);
  assert.ok(!dash.tileClass.split(" ").includes("tint-red"), `the Debt tile should not be tinted red: ${dash.tileClass}`);
  // The household's loans are paid down every month, so the change line is the good one.
  assert.ok(dash.deltaClass.split(" ").includes("up"), `a shrinking debt's change line should be the good colour: ${dash.deltaClass}`);
  assert.notEqual(dash.deltaColour, dash.debtValueColour, "the change line should be coloured, unlike the amount");
  console.log(`Debt amount ${dash.debtValueColour} = Net worth ${dash.netValueColour}; change line ${dash.deltaColour}`);

  // The pinned Car Loan widget: neutral tint and neutral badge, not red.
  const pinned = await settled(
    () =>
      browser.execute(() => {
        const tile = document.querySelector('[data-widget-id^="account:"] .stat');
        return tile
          ? { label: tile.querySelector(".stat-label")?.textContent ?? null, tile: tile.getAttribute("class"), badge: tile.querySelector(".mini-ico")?.getAttribute("class") ?? null }
          : null;
      }),
    (w) => w && w.label === "Car Loan",
    "expected the pinned Car Loan widget on the Dashboard",
  );
  assert.equal(pinned.tile, "stat stat-hero tint-neutral", `the pinned debt widget should use the neutral tint: ${JSON.stringify(pinned)}`);
  assert.equal(pinned.badge, "mini-ico neutral", `the pinned debt widget's badge should be neutral: ${JSON.stringify(pinned)}`);

  // ---- 2. Dashboard: the banner names a category ------------------------------------------------
  const banner = await settled(
    () => browser.execute(() => document.querySelector(".budget-alert-banner")?.textContent.trim() ?? ""),
    (t) => t.length > 0,
    "expected the budget alert banner (Mortgage is paid in full on the 1st)",
  );
  const named = CATEGORIES.filter((c) => banner.includes(c));
  assert.ok(named.length > 0, `the banner should name a category, got "${banner}"`);
  assert.match(banner, / (is|are|has|have) /, `the banner should be a plain sentence, got "${banner}"`);
  assert.doesNotMatch(banner, /\d+ categor/, `the banner should name categories, not count them: "${banner}"`);
  console.log(`banner: "${banner}"`);

  // ---- 3. Budget: income isn't red in the current month; Mortgage is "Used in full" -------------
  await openTab("budget", () => document.querySelectorAll(".cat-row").length >= 10, "the Budget page with the household's categories");
  const negative = await tokenColour("--negative");
  const warning = await tokenColour("--warning");
  const budget = await settled(
    () =>
      browser.execute(() => {
        const fill = document.querySelector("[data-budget-group='income'] .budget-group-track .progress-fill");
        const mortgage = [...document.querySelectorAll(".cat-row")].find((r) => r.querySelector(".category-link")?.textContent === "Mortgage");
        const badge = mortgage?.querySelector(".budget-alert-badge");
        return {
          month: document.querySelector(".month-label")?.textContent ?? null,
          fillClass: fill?.getAttribute("class") ?? null,
          fillColour: fill ? getComputedStyle(fill).backgroundColor : null,
          badgeText: badge?.textContent.trim() ?? null,
          badgeClass: badge?.getAttribute("class") ?? null,
          badgeColour: badge ? getComputedStyle(badge).color : null,
        };
      }),
    (b) => b.fillColour && b.badgeText,
    "expected the income heading's progress bar and the Mortgage row's badge",
  );
  assert.notEqual(budget.fillColour, negative, `the income heading's fill should not be red in the current month: ${JSON.stringify(budget)}`);
  assert.ok(!budget.fillClass.split(" ").includes("over"), `the income heading's fill should not be "over": ${budget.fillClass}`);
  assert.equal(budget.badgeText, "Used in full", `Mortgage (paid exactly its budget) should read "Used in full": ${JSON.stringify(budget)}`);
  assert.equal(budget.badgeClass, "budget-alert-badge budget-alert-done");
  assert.ok(budget.badgeColour !== negative && budget.badgeColour !== warning, `"Used in full" should be neutral, got ${budget.badgeColour}`);
  console.log(`${budget.month}: income fill ${budget.fillClass} (${budget.fillColour}, red is ${negative}); Mortgage "${budget.badgeText}"`);

  // ---- 4. Recurring: the totals use the neutral tint -------------------------------------------
  await openTab("recurring", () => document.querySelectorAll(".stats .stat").length === 4, "the Recurring page's four total tiles");
  const recurringTints = await browser.execute(() => [...document.querySelectorAll(".stats .stat")].map((s) => s.getAttribute("class")));
  assert.deepEqual(recurringTints, Array(4).fill("stat tint-neutral"), "the Recurring totals should use the neutral tint");

  // ---- 5. Accounts: what's owed is plain; the "What you owe" tile is neutral -----------------------
  await openTab("accounts", () => document.querySelectorAll(".account-card .bal").length >= 8, "the Accounts page's account cards");
  const accounts = await settled(
    () =>
      browser.execute(() => {
        const card = (name) => [...document.querySelectorAll(".account-card")].find((c) => c.querySelector(".account-name-cell")?.textContent === name);
        const bal = (name) => card(name)?.querySelector(".bal");
        const owe = [...document.querySelectorAll(".stat")].find((s) => s.querySelector(".stat-label")?.textContent === "What you owe");
        return {
          loanColour: bal("Car Loan") ? getComputedStyle(bal("Car Loan")).color : null,
          loanText: bal("Car Loan")?.textContent ?? null,
          checkingColour: bal("Joint Checking") ? getComputedStyle(bal("Joint Checking")).color : null,
          loanBadge: card("Car Loan")?.querySelector(".type-badge")?.getAttribute("class") ?? null,
          oweTile: owe?.getAttribute("class") ?? null,
        };
      }),
    (a) => a.loanColour && a.checkingColour && a.oweTile,
    "expected the Car Loan and Joint Checking cards and the What you owe tile",
  );
  assert.equal(accounts.loanColour, accounts.checkingColour, `a loan's amount owed should be plain: ${JSON.stringify(accounts)}`);
  assert.equal(accounts.loanBadge, "type-badge", "a loan's icon badge should be the plain one");
  assert.ok(accounts.oweTile.split(" ").includes("tint-neutral"), `"What you owe" should use the neutral tint: ${accounts.oweTile}`);

  // ---- 6. Contrast of what changed, in every style, light and dark -----------------------------
  const CHECKS = [
    { tab: "dashboard", ready: () => Boolean(document.querySelector('[data-stat="debt"] .stat-delta') && document.querySelector(".budget-alert-banner")), include: ['[data-stat="debt"]', ".budget-alert-banner", ".todo-list", '[data-widget-id^="account:"]'], hover: ".todo-row", icon: true },
    { tab: "budget", ready: () => Boolean(document.querySelector(".budget-alert-done") && document.querySelector("[data-budget-summary]")), include: [".budget-alert-done", "[data-budget-summary]", "[data-budget-group='income']"], fills: true },
    { tab: "recurring", ready: () => document.querySelectorAll(".stats .stat").length === 4, include: [".stats"] },
    { tab: "accounts", ready: () => document.querySelectorAll(".account-card .bal").length >= 8, include: [".stats", ".account-card"] },
  ];
  const failures = [];
  for (const style of ["transparent", "futuristic", "retro"]) {
    for (const theme of ["light", "dark"]) {
      await browser.execute(
        (s, t) => {
          localStorage.setItem("meadow-theme-style", s);
          localStorage.setItem("meadow-theme", t);
          localStorage.setItem("meadow-reduce-motion", "on");
          location.reload();
        },
        style,
        theme,
      );
      await settled(
        () => browser.execute(() => ({ palette: document.documentElement.dataset.palette, nav: Boolean(document.querySelector(".nav-item")) })),
        (s) => s.nav && s.palette === style,
        `expected the ${style} style after reloading`,
        20000,
      );
      await waitForDataLoaded(browser);
      await browser.execute(AXE);
      for (const check of CHECKS) {
        await openTab(check.tab, check.ready, `the ${check.tab} page's changed parts in ${style}/${theme}`);
        // A hovered To do row once took the generic button hover (dark text on the accent blue).
        if (check.hover) await (await browser.$(check.hover)).moveTo();
        const nodes = await browser.executeAsync(
          (include, done) =>
            window.axe
              .run({ include: include.map((s) => [s]) }, { runOnly: ["color-contrast"] })
              .then((r) =>
                done(
                  r.violations.flatMap((v) =>
                    v.nodes.map((n) => `${n.target.join(" ")} — ${n.any[0]?.data?.fgColor} on ${n.any[0]?.data?.bgColor} at ${n.any[0]?.data?.contrastRatio}:1`),
                  ),
                ),
              )
              .catch((e) => done([`axe failed: ${String(e)}`])),
          check.include,
        );
        for (const n of nodes) failures.push(`${style}/${theme} ${check.tab}: ${n}`);
        if (check.fills || check.icon) {
          const m = await measureNonText();
          if (check.fills) {
            if (m.fills.length === 0) failures.push(`${style}/${theme} budget: no neutral progress fill to measure`);
            for (const f of m.fills) if (f.ratio < 3) failures.push(`${style}/${theme} budget: neutral fill (${f.where}) is ${f.ratio}:1 against its track`);
            console.log(`${style}/${theme} neutral fills: ${m.fills.map((f) => `${f.where} ${f.ratio}:1`).join(", ")}`);
          }
          if (check.icon) {
            if (!m.icon) failures.push(`${style}/${theme} dashboard: no pinned debt widget badge`);
            else if (m.icon.ratio !== null && m.icon.ratio < 3) failures.push(`${style}/${theme} dashboard: debt widget icon is ${m.icon.ratio}:1 on its badge`);
            console.log(`${style}/${theme} debt widget icon (${m.icon?.kind}): ${m.icon?.ratio != null ? `${m.icon.ratio}:1` : "a full-colour icon, not measured"}`);
          }
        }
        await browser.saveScreenshot(path.join(shotsDir, `271-${check.tab}-${style}-${theme}.png`));
      }
      console.log(`${style}/${theme}: contrast checked`);
    }
  }
  assert.deepEqual(failures, [], `contrast problems:\n${failures.join("\n")}`);

  console.log(`screenshots in ${shotsDir}`);
  console.log("FEATURE 271 E2E TEST PASSED");
} finally {
  await app.close();
}
