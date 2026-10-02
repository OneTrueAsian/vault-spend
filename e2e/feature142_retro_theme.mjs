// E2E test for the Retro appearance style (Settings ▸ Appearance): selecting it sets
// `data-palette="retro"`, it survives a reload, it leaves the Light/Dark/System preference alone, and
// its rendered controls follow the classic scheme — gray raised buttons, white sunken fields, navy
// selection, square corners, opaque menus — in light and in the dark adaptation.
//
// Computed styles are checked rather than CSS token names, so a rule that loses a specificity fight
// (the base accent-filled button, a pill radius) fails here even though the token is defined.
//
// Run with: node e2e/feature142_retro_theme.mjs

import { launchApp } from "./harness.mjs";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

async function selectTheme(app, label) {
  await app.browser.execute((text) => {
    const row = Array.from(document.querySelectorAll('[role="radiogroup"][aria-label="Theme"] .feature-toggle-row')).find(
      (r) => r.querySelector(".feature-toggle-label")?.textContent === text,
    );
    if (!row) throw new Error(`no theme option labelled "${text}"`);
    row.querySelector("input").click();
  }, label);
}

async function setMode(app, theme) {
  await app.browser.execute((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await app.browser.pause(250); // `.nav-item` and buttons transition their colors
}

// Reads a few computed styles for the first element matching each selector, normalised to rgb strings.
async function styles(app, selector, props) {
  return app.browser.execute(
    (selector, props) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const css = getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, css[p]]));
    },
    selector,
    props,
  );
}

const app = await launchApp();
try {
  await (await app.browser.$("button*=Settings")).click();
  const appearanceHeading = await app.browser.$("//span[contains(@class,'reports-section-title')][text()='Appearance']");
  await appearanceHeading.waitForExist({ timeout: 10000 });

  const labels = await app.browser.execute(() =>
    Array.from(document.querySelectorAll('[role="radiogroup"][aria-label="Theme"] .feature-toggle-label')).map((el) => el.textContent),
  );
  assert.deepEqual(labels, ["Default", "Futuristic", "Retro"]);

  // Pin the mode to light, then pick the style: the mode must not move.
  await setMode(app, "light");
  await selectTheme(app, "Retro");
  assert.equal(await app.browser.execute(() => document.documentElement.getAttribute("data-palette")), "retro");
  assert.equal(await app.browser.execute(() => document.documentElement.getAttribute("data-theme")), "light", "choosing a style must not change Light/Dark/System");
  assert.ok(await app.browser.execute(() => !!document.querySelector(".topbar .theme-toggle")), "the Light/Dark/System toggle must stay in the header");
  console.log("Retro: data-palette set, mode untouched, toggle present — OK");

  // It is saved: a reload brings the style back (and Default stays the default for everyone else).
  assert.equal(await app.browser.execute(() => localStorage.getItem("meadow-theme-style")), "retro");
  await app.browser.refresh();
  await app.browser.waitUntil(() => app.browser.execute(() => document.documentElement.getAttribute("data-palette") === "retro"), {
    timeout: 10000,
    timeoutMsg: "the saved Retro style should be applied after a reload",
  });
  console.log("Retro: style survives a reload — OK");

  // Back on Settings after the reload, for the screenshots and the nav checks below.
  await (await app.browser.$("button*=Settings")).click();
  await appearanceHeading.waitForExist({ timeout: 10000 });

  for (const mode of ["light", "dark"]) {
    await setMode(app, mode);
    const dark = mode === "dark";
    const label = `retro/${mode}`;

    // Type: a local system sans, nothing downloaded.
    const body = await styles(app, "body", ["fontFamily"]);
    assert.match(body.fontFamily, /Tahoma/, `${label}: body font is ${body.fontFamily}`);

    // A plain button is a gray raised face, not the base accent fill, with a square corner.
    const button = await styles(app, ".page button:not([class])", ["backgroundColor", "borderRadius", "boxShadow"]);
    assert.ok(button, `${label}: expected a plain button on the Settings page`);
    assert.equal(button.backgroundColor, dark ? "rgb(48, 48, 48)" : "rgb(192, 192, 192)", `${label}: button face`);
    assert.equal(button.borderRadius, "0px", `${label}: button corner`);
    assert.notEqual(button.boxShadow, "none", `${label}: button should have raised edges`);

    // Cards are square and raised; the active nav item is the navy selection with light text.
    const card = await styles(app, ".card", ["borderRadius", "boxShadow"]);
    assert.equal(card.borderRadius, "0px", `${label}: card corner`);
    assert.notEqual(card.boxShadow, "none", `${label}: card should have raised edges`);
    const nav = await styles(app, ".nav-item.nav-item-active", ["backgroundColor", "color", "borderRadius"]);
    assert.equal(nav.backgroundColor, dark ? "rgb(48, 78, 165)" : "rgb(0, 0, 128)", `${label}: active nav selection`);
    assert.equal(nav.color, "rgb(255, 255, 255)", `${label}: active nav text`);
    assert.equal(nav.borderRadius, "0px", `${label}: nav corner`);

    // Text fields are sunken, with a window-colored interior.
    const field = await styles(app, "input[type='text'], input[type='password'], input[type='number'], input[type='search'], .text-input", ["backgroundColor", "boxShadow", "borderRadius"]);
    if (field) {
      assert.equal(field.backgroundColor, dark ? "rgb(18, 18, 18)" : "rgb(255, 255, 255)", `${label}: field interior`);
      assert.notEqual(field.boxShadow, "none", `${label}: field should have sunken edges`);
      assert.equal(field.borderRadius, "0px", `${label}: field corner`);
    }

    // Floating menus are opaque (Retro has no glass) and have no blur behind them.
    await (await app.browser.$(".profile-switcher-toggle")).click();
    await app.browser.$(".profile-switcher-panel").waitForDisplayed();
    const menu = await app.browser.execute(() => {
      const css = getComputedStyle(document.querySelector(".profile-switcher-panel"));
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = css.backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      return { alpha: ctx.getImageData(0, 0, 1, 1).data[3], blur: css.backdropFilter || css.webkitBackdropFilter || "none", radius: css.borderRadius };
    });
    await app.browser.saveScreenshot(path.join(os.tmpdir(), `vault-retro-menu-${mode}.png`));
    assert.equal(menu.alpha, 255, `${label}: profile menu must hide the navigation under it`);
    assert.equal(menu.blur, "none", `${label}: profile menu must not blur`);
    assert.equal(menu.radius, "0px", `${label}: profile menu corner`);
    await (await app.browser.$(".profile-switcher-toggle")).click();

    // Keyboard focus stays visible and is not the selection color alone: Tab to a control and read its outline.
    await app.browser.execute(() => document.querySelector(".page button, .page input")?.focus());
    await app.browser.keys(["Tab"]);
    const focus = await app.browser.execute(() => {
      const el = document.activeElement;
      const css = el ? getComputedStyle(el) : null;
      return el && css ? { outlineStyle: css.outlineStyle, outlineWidth: css.outlineWidth } : null;
    });
    assert.ok(focus && focus.outlineStyle !== "none" && focus.outlineWidth !== "0px", `${label}: the focused control needs a visible outline (${JSON.stringify(focus)})`);

    await app.browser.saveScreenshot(path.join(os.tmpdir(), `vault-retro-settings-${mode}.png`));
    console.log(`${label}: font, raised buttons, sunken fields, navy selection, opaque menu, focus ring — OK`);
  }

  // Switching away restores the Default look (internal id "transparent").
  await selectTheme(app, "Default");
  assert.equal(await app.browser.execute(() => document.documentElement.getAttribute("data-palette")), "transparent");
  console.log("Default: data-palette back to transparent after Retro — OK");

  console.log("FEATURE 142 E2E TEST PASSED");
} finally {
  await app.close();
}
