// Info tips on the comparison setup (Reports > Comparisons > Your details), in the real app: every field
// says what to enter. Checks the tips are there, that one opens on hover, on keyboard focus (and closes on
// Escape) and stays open after a click until you click elsewhere, and that an open tip sits inside the
// window. Screenshots of an open tip in every palette and mode go to SHOTS_DIR for a person to look at.
//
// Run with: node e2e/run-all.mjs --spec=151
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, withFocusRetry } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { baseSetup, openComparisonDetails, setupSnippet } from "./lib/comparisons.mjs";

const SHOTS_DIR = process.env.COMPARISONS_SHOTS_DIR ?? path.join(os.tmpdir(), "vaultspend-info-tip-shots");
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const today = new Date();
const TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

const dbDir = await seedFixture(`
cur.execute("INSERT INTO family_members (name) VALUES ('Partner')")
for name, kind, start in [('Checking', 'checking', '5000.00'), ('401k', 'investment', '20000.00'), ('Visa', 'credit', '1000.00'), ('Mortgage', 'loan', '200000.00')]:
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES (?, ?, ?)", (name, kind, start))
${setupSnippet(baseSetup(TODAY))}
`);

const app = await launchApp({ dbDir });
const { browser } = app;
const tipButton = (label) => browser.$(`[data-cmp-settings] [data-info-tip="${label}"]`);
const tipState = (label) =>
  browser.execute((label) => {
    const button = document.querySelector(`[data-cmp-settings] [data-info-tip="${label}"]`);
    const tip = document.getElementById(button.getAttribute("aria-describedby"));
    const r = tip.getBoundingClientRect();
    return {
      open: tip.dataset.open === "true",
      shown: getComputedStyle(tip).display !== "none" && r.width > 0 && r.height > 0,
      text: tip.textContent,
      inside: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
    };
  }, label);

try {
  await browser.setWindowSize(1440, 1000);
  await openComparisonDetails(browser);

  const labels = await browser.execute(() => [...document.querySelectorAll("[data-cmp-settings] [data-info-tip]")].map((b) => b.dataset.infoTip));
  for (const label of ["Age used for the household", "Enter income as", "Household income per year", "Annual spending", "Savings", "Investments", "Debt type", "Confirm your balances", "Debt: your own total"]) {
    assert.ok(labels.includes(label), `expected an info tip for "${label}", found: ${labels.join(", ")}`);
  }

  // Hover.
  const spending = await tipButton("Annual spending");
  await spending.scrollIntoView({ block: "center" });
  await withFocusRetry(browser, async () => {
    await spending.moveTo();
    await browser.waitUntil(async () => (await tipState("Annual spending")).shown, { timeout: 3000, timeoutMsg: "hovering should show the Annual spending tip" });
  });
  const hovered = await tipState("Annual spending");
  assert.match(hovered.text, /spends in a year/);
  assert.ok(hovered.inside, "an open tip should sit inside the window");
  await browser.action("pointer").move({ x: 2, y: 2 }).perform();
  await browser.waitUntil(async () => !(await tipState("Annual spending")).open, { timeout: 3000, timeoutMsg: "moving away should close the tip" });

  // Keyboard: focus opens it, Escape closes it and leaves the settings panel open.
  await withFocusRetry(browser, async () => {
    await browser.execute(() => document.querySelector('[data-cmp-settings] [data-info-tip="Age used for the household"]').focus());
    await browser.waitUntil(async () => (await tipState("Age used for the household")).shown, { timeout: 3000, timeoutMsg: "keyboard focus should show the Age used for the household tip" });
    await browser.keys("Escape");
    await browser.waitUntil(async () => !(await tipState("Age used for the household")).open, { timeout: 3000, timeoutMsg: "Escape should close the tip" });
  });
  assert.ok(await (await browser.$("[data-cmp-details-body] [data-cmp-settings]")).isDisplayed(), "Escape on a tip must not close the settings");

  // Click keeps it open until a click elsewhere.
  const savings = await tipButton("Savings");
  await savings.scrollIntoView({ block: "center" });
  await withFocusRetry(browser, async () => {
    if ((await tipState("Savings")).open) await savings.click(); // a retry starts from closed
    await savings.click();
    await browser.action("pointer").move({ x: 2, y: 2 }).perform();
    await browser.waitUntil(async () => (await tipState("Savings")).shown, { timeout: 3000, timeoutMsg: "a clicked tip should stay open after the pointer leaves" });
  });
  await (await browser.$("[data-cmp-settings] h3")).click();
  await browser.waitUntil(async () => !(await tipState("Savings")).open, { timeout: 3000, timeoutMsg: "clicking elsewhere should close a clicked-open tip" });

  // Every appearance: an open tip, for a person to look at.
  const income = await tipButton("Household income per year");
  await income.scrollIntoView({ block: "center" });
  for (const palette of ["transparent", "futuristic", "retro"]) {
    for (const mode of ["light", "dark"]) {
      await browser.execute(
        (p, m) => {
          document.documentElement.dataset.palette = p;
          document.documentElement.dataset.theme = m;
        },
        palette,
        mode,
      );
      // Switching style moves the layout under the still pointer, and the browser can then report a
      // hover on the button, opening the tip without pinning it. A click on that tip pins it rather
      // than closing it, so start every appearance from a closed tip with the pointer elsewhere.
      await browser.action("pointer").move({ x: 2, y: 2 }).perform();
      await browser.waitUntil(async () => !(await tipState("Household income per year")).open, {
        timeout: 3000,
        timeoutMsg: `the tip should be closed before opening it in ${palette} ${mode}`,
      });
      await withFocusRetry(browser, async () => {
        if (!(await tipState("Household income per year")).open) await income.click();
        await browser.waitUntil(async () => (await tipState("Household income per year")).shown, { timeout: 3000, timeoutMsg: `the tip should open in ${palette} ${mode}` });
      });
      assert.ok((await tipState("Household income per year")).inside, `the open tip should sit inside the window in ${palette} ${mode}`);
      await browser.saveScreenshot(path.join(SHOTS_DIR, `info-tip-${palette}-${mode}.png`));
      // Another window taking focus can close the tip on its own, so click only while it is still open
      // (a click on a closed tip would open it again), and retry if focus went away mid-step.
      await withFocusRetry(browser, async () => {
        if ((await tipState("Household income per year")).open) await income.click();
        await browser.waitUntil(async () => !(await tipState("Household income per year")).open, { timeout: 3000, timeoutMsg: `clicking the open tip should close it in ${palette} ${mode}` });
      });
    }
  }
  console.log(`[feature151] screenshots saved under ${SHOTS_DIR}`);
  console.log("FEATURE 151 E2E TEST PASSED");
} finally {
  await app.close();
}
