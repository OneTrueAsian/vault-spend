// E2E test for the refreshed Futuristic style (Neon Ledger): Settings ▸ Appearance's accent choice,
// Neon intensity and Reduce motion, in the compiled app.
//
// - The accent (Ion Cyan, Rebel Pink, Ultraviolet) recolors the theme's accent; light mode uses the
//   darker ink version of the same accent.
// - Neon intensity scales only glows: at 0 the active nav item has no glow, and text keeps its color.
// - The choices survive a reload and are on the page as soon as the app shows.
// - Open menus follow the rounded guide (7px trigger and options, opaque 10px panel), and Escape closes
//   a menu and puts focus back on its trigger.
// - Chart bars and meter fills light up like the mockup: bars paint with their gradient and glow in their
//   own color, meter fills carry a halo of their fill color, and the glows go at intensity 0.
// - Reduce motion works in every style; Default and Retro do not pick up Futuristic's colors.
// - "Reset Futuristic options" restores Ion Cyan, 70 and normal motion, and leaves Safe to spend alone.
//
// Run with: node e2e/feature153_futuristic_refresh.mjs

import { launchApp, waitUntilOrDiagnose, withFocusRetry } from "./harness.mjs";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

async function openSettings(browser) {
  await browser.execute(() => [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === "Settings").click());
  await (await browser.$("[data-reduce-motion]")).waitForExist({ timeout: 10000 });
}

async function selectStyle(browser, label) {
  await browser.execute((text) => {
    const row = [...document.querySelectorAll('[role="radiogroup"][aria-label="Style"] .style-preview-tile')].find(
      (r) => r.querySelector(".style-preview-name")?.textContent === text,
    );
    row.querySelector("input").click();
  }, label);
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.dataset.palette)) !== undefined);
}

async function setMode(browser, mode) {
  await browser.execute((m) => [...document.querySelectorAll(".theme-toggle button")].find((b) => b.textContent === m).click(), mode);
  await browser.pause(250); // colors transition
}

async function pickAccent(browser, label) {
  await browser.execute((text) => {
    const choice = [...document.querySelectorAll('[aria-label="Accent color"] label')].find((l) => l.textContent.includes(text));
    choice.querySelector("input").click();
  }, label);
}

async function setIntensity(browser, value) {
  await browser.execute((v) => {
    const slider = document.querySelector('input[type=range][aria-label="Neon intensity"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(slider, String(v));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

const look = (browser) =>
  browser.execute(() => {
    const root = document.documentElement;
    const css = getComputedStyle(root);
    const nav = document.querySelector(".nav-item-active");
    return {
      palette: root.dataset.palette,
      accentAttr: root.dataset.accent ?? null,
      motion: root.dataset.motion ?? null,
      glow: root.style.getPropertyValue("--neon-glow"),
      neon: css.getPropertyValue("--neon").trim(),
      accent: css.getPropertyValue("--accent").trim(),
      navShadow: getComputedStyle(nav).boxShadow,
      navIcon: getComputedStyle(nav.querySelector(".ico") ?? nav).color,
      titleColor: getComputedStyle(document.querySelector(".view-title")).color,
      navTransition: getComputedStyle(nav).transitionDuration,
    };
  });

// The first income/expense bar on Cash Flow, and a meter fill put on the page to measure (an empty
// profile has no budget to draw one), colored inline the way the app colors category fills.
async function barsLook(browser) {
  await browser.execute(() => [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === "Cash Flow").click());
  await (await browser.$(".chart-bar")).waitForExist({ timeout: 10000 });
  const out = await browser.execute(() => {
    const bar = getComputedStyle(document.querySelector(".chart-bar"));
    const track = document.createElement("div");
    track.className = "progress-track";
    track.innerHTML = '<div class="progress-fill" style="width: 50%; background: rgb(255, 0, 0)"></div>';
    document.querySelector(".main").appendChild(track);
    const halo = getComputedStyle(track.firstChild, "::after");
    const result = { barFill: bar.fill, barFilter: bar.filter, haloBg: halo.backgroundColor, haloFilter: halo.filter, trackOverflow: getComputedStyle(track).overflow };
    track.remove();
    return result;
  });
  await openSettings(browser);
  return out;
}

const shot = (browser, name) => browser.saveScreenshot(path.join(os.tmpdir(), `vault-futuristic-${name}.png`));

const app = await launchApp();
try {
  const { browser } = app;
  await browser.setWindowSize(1280, 900);
  await openSettings(browser);

  // Nothing saved yet: Default, and the Futuristic options are not offered.
  assert.equal((await look(browser)).palette, "transparent");
  assert.equal(await browser.$("[data-futuristic-options]").isExisting(), false, "Futuristic options only show for Futuristic");

  await selectStyle(browser, "Futuristic");
  await setMode(browser, "Dark");
  await (await browser.$("[data-futuristic-options]")).waitForExist({ timeout: 5000 });
  let now = await look(browser);
  assert.equal(now.palette, "futuristic");
  assert.equal(now.accentAttr, "cyan", "Ion Cyan is the default accent");
  assert.equal(now.accent, "#00e5ff");
  assert.equal(now.glow, "0.7", "Neon intensity defaults to 70");
  await shot(browser, "settings-dark-cyan");

  // Lit chart bars and glowing meters.
  const lit = await barsLook(browser);
  assert.match(lit.barFill, /^url\("?#bar-/, `bars paint with their gradient (${lit.barFill})`);
  assert.match(lit.barFilter, /^drop-shadow\(rgb\(140, 245, 168\) 0px 0px [1-9]/, `the income bar glows in its own green (${lit.barFilter})`);
  assert.equal(lit.haloBg, "rgb(255, 0, 0)", "a meter's halo takes its fill's own color");
  assert.match(lit.haloFilter, /^blur\([1-9]/, `the halo is blurred (${lit.haloFilter})`);
  assert.equal(lit.trackOverflow, "visible", "the halo can spill past the track");

  // Rebel Pink in dark, and its ink version in light.
  await pickAccent(browser, "Rebel Pink");
  await browser.waitUntil(async () => (await look(browser)).accent === "#ff4bac", { timeout: 3000, timeoutMsg: "Rebel Pink did not apply" });
  now = await look(browser);
  assert.equal(now.navIcon, "rgb(255, 75, 172)", "the active nav icon takes the chosen accent");
  await setMode(browser, "Light");
  now = await look(browser);
  assert.equal(now.accent, "#ad1f62", "light mode uses the darker ink version of the accent");
  assert.equal(now.neon, "#ff4bac", "the bright accent stays for the dark rail");
  await shot(browser, "settings-light-pink");
  await setMode(browser, "Dark");

  // Neon intensity scales glows only.
  const at70 = await look(browser);
  assert.match(at70.navShadow, /rgba?\([^)]*\) 0px 0px (1[0-9]|[2-9])/, `the active nav item glows at 70 (${at70.navShadow})`);
  await setIntensity(browser, 0);
  await browser.waitUntil(async () => (await look(browser)).glow === "0", { timeout: 3000, timeoutMsg: "intensity 0 did not apply" });
  const at0 = await look(browser);
  assert.doesNotMatch(at0.navShadow, /0px 0px [1-9]/, `no glow at intensity 0 (${at0.navShadow})`);
  assert.equal(at0.titleColor, at70.titleColor, "text keeps its color at every intensity");
  assert.equal(await browser.execute(() => document.querySelector(".neon-intensity-value").textContent), "0%");
  await shot(browser, "settings-dark-pink-0");
  const unlit = await barsLook(browser);
  assert.match(unlit.barFilter, /0px 0px 0px\)$/, `no bar glow at intensity 0 (${unlit.barFilter})`);
  assert.equal(unlit.haloFilter, "blur(0px)", "no meter halo at intensity 0");

  // Survives a reload, and is on the page as soon as the app shows.
  await browser.refresh();
  await (await browser.$(".brand-word")).waitForExist({ timeout: 20000 });
  // the sidebar shows before the view (loaded on demand), and look() reads both
  await browser.waitUntil(() => browser.execute(() => Boolean(document.querySelector(".nav-item-active") && document.querySelector(".view-title"))), {
    timeout: 10000,
    timeoutMsg: "the view never showed after the reload",
  });
  now = await look(browser);
  assert.deepEqual(
    { palette: now.palette, accent: now.accentAttr, glow: now.glow },
    { palette: "futuristic", accent: "pink", glow: "0" },
    "the choices are applied after a reload",
  );
  await openSettings(browser);
  assert.equal(await browser.execute(() => document.querySelector('input[type=range][aria-label="Neon intensity"]').value), "0");
  assert.equal(
    await browser.execute(() => [...document.querySelectorAll('[aria-label="Accent color"] input')].findIndex((i) => i.checked)),
    1,
    "Rebel Pink is still checked",
  );

  // Open menus follow the rounded guide; Escape closes and returns focus to the trigger.
  await browser.execute(() => [...document.querySelectorAll(".nav-item")].find((b) => b.textContent.trim() === "Transactions").click());
  const trigger = await browser.$(".menu-select-toggle");
  await trigger.waitForExist({ timeout: 10000 });
  // Another spec's window taking focus while the menu is open closes it on blur, without handing
  // focus back to the trigger, so Escape then has nothing to close. Retry the whole step when (and
  // only when) the window really lost focus during it.
  let menu;
  await withFocusRetry(browser, async () => {
    await trigger.click();
    await waitUntilOrDiagnose(browser, async () => browser.execute(() => !!document.querySelector(".menu-select-panel")), {
      timeoutMsg: "the category menu did not open",
    });
    menu = await browser.execute(() => {
      const panel = document.querySelector(".menu-select-panel");
      const option = panel.querySelector(".account-destination-option");
      const css = getComputedStyle(panel);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = css.backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      return {
        panelRadius: css.borderTopLeftRadius,
        panelAlpha: ctx.getImageData(0, 0, 1, 1).data[3],
        optionRadius: getComputedStyle(option).borderTopLeftRadius,
        triggerRadius: getComputedStyle(document.querySelector(".menu-select-toggle")).borderTopLeftRadius,
      };
    });
    await shot(browser, "menu-open");
    await browser.keys("Escape");
    await browser.waitUntil(async () => browser.execute(() => !document.querySelector(".menu-select-panel:popover-open")), {
      timeout: 3000,
      timeoutMsg: "Escape did not close the menu",
    });
    await browser.waitUntil(async () => browser.execute(() => document.activeElement === document.querySelector(".menu-select-toggle")), {
      timeout: 3000,
      timeoutMsg: "focus returns to the menu's trigger",
    });
  });
  assert.deepEqual(menu, { panelRadius: "10px", panelAlpha: 255, optionRadius: "7px", triggerRadius: "7px" }, "menu geometry");

  // Reduce motion, in Futuristic and in the other styles.
  await openSettings(browser);
  const normalTransition = (await look(browser)).navTransition;
  assert.notEqual(normalTransition, "0s");
  await browser.execute(() => document.querySelector("[data-reduce-motion]").click());
  await browser.waitUntil(async () => (await look(browser)).motion === "reduced", { timeout: 3000 });
  for (const style of ["Futuristic", "Default", "Retro"]) {
    await selectStyle(browser, style);
    await browser.pause(150);
    const t = (await look(browser)).navTransition.split(",").map((d) => parseFloat(d));
    assert.ok(t.every((d) => d < 0.001), `${style}: Reduce motion stops transitions (${t})`);
  }

  // Default and Retro do not pick up Futuristic's colors, though the choices stay saved.
  for (const style of ["Default", "Retro"]) {
    await selectStyle(browser, style);
    now = await look(browser);
    assert.equal(now.neon, "", `${style}: no Futuristic accent token`);
    assert.notEqual(now.accent, "#ff4bac", `${style}: keeps its own accent`);
    assert.equal(now.accentAttr, "pink", "the accent choice stays saved");
  }

  // Reset restores the Futuristic defaults and leaves Safe to spend as it was.
  await selectStyle(browser, "Futuristic");
  const safeToSpend = () =>
    browser.execute(() =>
      [...document.querySelectorAll(".feature-toggle-row")].find((r) => r.querySelector(".feature-toggle-label")?.textContent === "Safe to spend")
        .querySelector("input").checked,
    );
  const safeBefore = await safeToSpend();
  await browser.execute(() => [...document.querySelectorAll("[data-futuristic-options] button")].find((b) => /Reset/.test(b.textContent)).click());
  await browser.waitUntil(async () => (await look(browser)).accentAttr === "cyan", { timeout: 3000, timeoutMsg: "Reset did not restore Ion Cyan" });
  now = await look(browser);
  assert.equal(now.glow, "0.7");
  assert.equal(now.motion, null, "Reset restores normal motion");
  assert.equal(await safeToSpend(), safeBefore, "Reset leaves Safe to spend alone");
  assert.deepEqual(
    await browser.execute(() => [localStorage.getItem("meadow-futuristic-accent"), localStorage.getItem("meadow-futuristic-intensity"), localStorage.getItem("meadow-reduce-motion")]),
    ["cyan", "70", null],
  );

  console.log("FEATURE 153 E2E TEST PASSED");
} finally {
  await app.close();
}
