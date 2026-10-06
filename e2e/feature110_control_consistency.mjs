// The real WebView must paint text, select and date controls with the same theme.
import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { seedDemoDatabase } from "./lib/demo-seed.mjs";

const dbDir = freshTestDbDir();
await seedDemoDatabase(dbDir);
const app = await launchApp({ dbDir });
const b = app.browser;
async function nav(name) {
  for (const button of await b.$$("nav button")) {
    if ((await button.getText()).trim() === name) { await button.click(); break; }
  }
  await b.waitUntil(async () => await b.execute((name) => document.querySelector(".view-title")?.textContent === name, name), { timeout: 10000 });
}
// Each style has one control corner radius: Default 8px, Futuristic 7px.
const CONTROL_RADIUS = { transparent: "8px", futuristic: "7px" };
async function check(selector, theme, palette) {
  const result = await b.execute((selector) => {
    const fields = [...document.querySelectorAll(selector)];
    const ref = document.createElement("input");
    ref.className = "text-input";
    document.body.append(ref);
    const expected = getComputedStyle(ref);
    // Placeholders use --text-muted (SharedControls.css).
    const mutedProbe = document.createElement("span");
    mutedProbe.style.color = "var(--text-muted)";
    document.body.append(mutedProbe);
    const muted = getComputedStyle(mutedProbe).color;
    mutedProbe.remove();
    const results = fields.map((el) => {
      const s = getComputedStyle(el);
      // A date field (DateField) at rest hides its input's own text under the date written out over it, so
      // the colour people read is that text's.
      const resting = el.closest(".date-field:not(.date-field-editing)");
      // An empty one shows a hint ("Any date") in the colour of any field's placeholder.
      const color = resting ? getComputedStyle(resting.querySelector(".date-field-text")).color : s.color;
      const expectedColor = resting?.classList.contains("date-field-empty") ? muted : expected.color;
      return { name: el.getAttribute("aria-label") || el.type, radius: s.borderRadius, color,
        hiddenInputText: resting ? s.color : null,
        background: s.backgroundColor, scheme: s.colorScheme, expectedColor, expectedBackground: expected.backgroundColor };
    });
    ref.remove();
    return results;
  }, selector);
  assert.ok(result.length, `no controls found: ${selector}`);
  for (const field of result) {
    assert.equal(field.radius, CONTROL_RADIUS[palette], `${palette}/${theme}: ${field.name} border radius`);
    assert.equal(field.color, field.expectedColor, `${field.name} text color`);
    if (field.hiddenInputText !== null) assert.equal(field.hiddenInputText, "rgba(0, 0, 0, 0)", `${field.name}: the input's own text is hidden under the written-out date`);
    assert.equal(field.background, field.expectedBackground, `${field.name} background`);
    assert.equal(field.scheme, theme, `${field.name} native picker theme`);
  }
}
try {
  await b.setWindowSize(1280, 900);
  for (const palette of ["transparent", "futuristic"]) {
    for (const theme of ["light", "dark"]) {
      await b.execute((palette, theme) => {
        document.documentElement.dataset.palette = palette;
        document.documentElement.dataset.theme = theme;
      }, palette, theme);
      await nav("Transactions");
      await (await b.$("button*=More filters")).click();
      await check(".account-filter-panel input[type='date'], .account-filter-panel .menu-select-toggle, .ledger-filters input[type='search']", theme, palette);
      await b.keys("Escape");
      assert.equal(await b.$(".account-filter-panel").isExisting(), false);
      await (await b.$("button*=Add transaction")).click();
      await b.$(".modal-panel input[type='date']").waitForExist({ timeout: 5000 });
      await check(".modal-field input:not([type='checkbox']), .modal-field .menu-select-toggle", theme, palette);
      await b.keys("Escape");
      await nav("Goals");
      await (await b.$(".bucket-contribute button")).click();
      await check(".bucket-contribute-panel input", theme, palette);
      await b.keys("Escape");
      await nav("Settings");
      await check("[data-rules-category-filter]", theme, palette);
    }
  }
  const protectionCheckbox = await b.execute(() => {
    const input = document.querySelector("[data-protect-new-profile]");
    const label = input.closest("label");
    const box = input.getBoundingClientRect();
    const labelBox = label.getBoundingClientRect();
    return {
      height: box.height,
      centerDelta: Math.abs((box.top + box.height / 2) - (labelBox.top + labelBox.height / 2)),
    };
  });
  assert.ok(protectionCheckbox.height <= 20, `Settings protection checkbox should keep native checkbox sizing: ${JSON.stringify(protectionCheckbox)}`);
  assert.ok(protectionCheckbox.centerDelta <= 2, `Settings protection checkbox should align with its label: ${JSON.stringify(protectionCheckbox)}`);
  await b.setWindowSize(800, 700);
  await nav("Transactions");
  await (await b.$("button*=More filters")).click();
  const rect = await b.execute(() => {
    const r = document.querySelector(".account-filter-panel").getBoundingClientRect();
    return { left: r.left, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight };
  });
  assert.ok(rect.left >= 0 && rect.right <= rect.width && rect.bottom <= rect.height, `filter dropdown must stay visible: ${JSON.stringify(rect)}`);
} finally { await app.close(); }
console.log("FEATURE 110 E2E TEST PASSED");
