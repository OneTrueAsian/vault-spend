// On the import review, the row count under each bank category ("2 rows") opens a list of the
// transactions that use it (2026-11-03).
//
//   1. Every list starts closed; the count is a button that says whether its list is open.
//   2. Opening one shows that category's rows (date, description, amount), one at a time, and
//      closing it hides them again. A row that is unticked is marked "Not importing". The keyboard
//      works (Enter on the focused count). Opening and closing changes no choice.
//   3. In every visual style, light and dark: the count and the list stay readable (4.5:1), the
//      count keeps no solid hover fill, the lists grow with the dialog instead of scrolling inside
//      it, and nothing runs sideways.
//
// The native file picker is answered by stubFilePicker (harness.mjs). Set VAULTSPEND_E2E_SHOTS to a
// folder to save screenshots of the open lists.
//
// Run with: node e2e/run-all.mjs --spec=387

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chooseStyle, launchApp, stubFilePicker, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { startImportInto } from "./lib/importAccount.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const SUPER = "GENERAL_MERCHANDISE / GENERAL_MERCHANDISE_SUPERSTORES";
const OTHER = "GENERAL_MERCHANDISE / GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE";
const DONATIONS = "GOVERNMENT_AND_NON_PROFIT / GOVERNMENT_AND_NON_PROFIT_DONATIONS";
const STYLES = [
  ["Default", "transparent"],
  ["Futuristic", "futuristic"],
  ["Retro", "retro"],
];
const THEMES = ["light", "dark"];

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);
const csvDir = makeTempDir("vaultspend-e2e-category-transactions-");
const csv = path.join(csvDir, "bank.csv");
fs.writeFileSync(
  csv,
  [
    "Date,Description,Amount,Category",
    `${dateInMonth(-1, 28)},QQXZ CORNER MARKET,-156.99,${SUPER}`,
    `${dateInMonth(-1, 25)},QQXZ BIG BOX,-36.82,${SUPER}`,
    `${dateInMonth(-1, 24)},QQXZ HARDWARE,-199.00,${OTHER}`,
    `${dateInMonth(-1, 27)},QQXZ HELPING HANDS,-31.92,${DONATIONS}`,
    "",
  ].join("\n"),
);

const shots = process.env.VAULTSPEND_E2E_SHOTS;
const app = await launchApp({ dbDir });
const { browser } = app;
const launchedAt = Date.now();
const trace = (step) => console.log(`[feature387 +${Date.now() - launchedAt}ms] ${step}`);

// Plain arrays: WebdriverIO's own element array has an asynchronous map().
const toggles = async () => Array.from(await browser.$$("button.import-category-rows-toggle"));
const lists = async () => Array.from(await browser.$$(".import-category-transactions"));
const reviewCheckbox = (description) =>
  browser.$(`//table[contains(@class,'dup-review-table')]//tr[.//td[normalize-space()='${description}']]//input[@type='checkbox']`);
const panelMenu = (name) => browser.$(`button[data-import-category-choice][data-import-category-name="${name}"]`);
const remainingText = async () => (await (await browser.$("#import-remaining-choices")).getText()).trim();

async function setTheme(mode) {
  await browser.execute((m) => {
    const group = document.querySelector('.theme-toggle[aria-label="Theme"]');
    [...group.querySelectorAll("button")].find((x) => x.textContent.trim().toLowerCase() === m).click();
  }, mode);
  await waitUntilOrDiagnose(browser, () => browser.execute((m) => document.documentElement.getAttribute("data-theme") === m, mode), {
    timeoutMsg: `the ${mode} theme should apply`,
  });
}

async function openReview() {
  await (await browser.$("button*=Transactions")).click();
  await startImportInto(browser, "Checking");
  const keep = await browser.$("button=Keep as-is");
  await keep.waitForDisplayed({ timeout: 10000, timeoutMsg: "the import should ask about signs first" });
  await keep.click();
  await (await browser.$("button[data-import-confirm]")).waitForDisplayed({ timeout: 10000, timeoutMsg: "the review screen should open" });
}

async function cancelReview() {
  await (await browser.$("//div[contains(@class,'dup-review-actions')]//button[normalize-space()='Cancel']")).click();
  await (await browser.$("button[data-import-confirm]")).waitForExist({ reverse: true, timeout: 5000, timeoutMsg: "Cancel should close the review" });
}

/** Text contrast of the elements named, against what is really behind them (ancestor backgrounds composited).
 * Colors are read through a canvas so any CSS color syntax (rgb, color(srgb ...), ...) is understood. */
const measureContrast = (selectors) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top, bottom) => {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a);
  };
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (el) => {
    let bg = [255, 255, 255, 1];
    const chain = [];
    for (let n = el; n; n = n.parentElement) chain.push(n);
    for (const n of chain.reverse()) bg = over(rgba(getComputedStyle(n).backgroundColor), bg);
    const fg = over(rgba(getComputedStyle(el).color), bg);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  return Object.fromEntries(Object.entries(selectors).map(([name, selector]) => [name, contrast(document.querySelector(selector))]));
};

try {
  await browser.setWindowSize(1440, 1000);
  // One import for the behavior checks, then one per style and theme.
  await stubFilePicker(browser, Array(1 + STYLES.length * THEMES.length).fill(csv));

  // ---- 1 and 2. Behavior, in the first style and theme ---------------------------------------------
  await chooseStyle(browser, STYLES[0][0], STYLES[0][1]);
  await setTheme("dark");
  await openReview();
  trace("review open");

  assert.deepEqual(
    await Promise.all((await toggles()).map((t) => t.getText())),
    ["2 rows", "1 row", "1 row"],
    "each bank category's count is a button",
  );
  assert.deepEqual(
    await Promise.all((await toggles()).map((t) => t.getAttribute("aria-expanded"))),
    ["false", "false", "false"],
    "every list starts closed",
  );
  assert.equal((await lists()).length, 0, "no list is showing yet");
  const remainingBefore = await remainingText();
  assert.equal(remainingBefore, "3 rows still need a category");

  await (await toggles())[0].click();
  await waitUntilOrDiagnose(browser, async () => (await lists()).length === 1, { timeoutMsg: "clicking the count should open its list" });
  const first = await browser.execute(() =>
    [...document.querySelectorAll(".import-category-transactions li")].map((li) => ({
      date: li.querySelector(".import-category-tx-date").textContent,
      desc: li.querySelector(".import-category-tx-desc").textContent,
      amount: li.querySelector(".import-category-tx-amount").textContent,
    })),
  );
  assert.equal(first.length, 2, "the first category has two rows");
  assert.deepEqual(
    first.map((r) => [r.desc, r.amount]),
    [
      ["QQXZ CORNER MARKET", "-$156.99"],
      ["QQXZ BIG BOX", "-$36.82"],
    ],
  );
  assert.ok(first.every((r) => /^[A-Z][a-z]{2} \d{1,2}/.test(r.date)), `dates read like the table's: ${JSON.stringify(first)}`);
  const listId = await (await browser.$(".import-category-transactions")).getAttribute("id");
  assert.equal(await (await toggles())[0].getAttribute("aria-controls"), listId, "the button points at its list");
  assert.equal(await (await toggles())[0].getAttribute("aria-expanded"), "true");
  assert.equal(await (await toggles())[1].getAttribute("aria-expanded"), "false", "the other lists stay closed");

  // An unticked row is marked, and only that row.
  await (await reviewCheckbox("QQXZ BIG BOX")).click();
  await waitUntilOrDiagnose(
    browser,
    async () => (await browser.execute(() => document.querySelectorAll("li[data-not-importing]").length)) === 1,
    { timeoutMsg: "unticking a row should mark it in the list" },
  );
  const marked = await browser.execute(() => document.querySelector("li[data-not-importing]").textContent);
  assert.match(marked, /QQXZ BIG BOX.*Not importing/);
  assert.equal(
    await browser.execute(() => [...document.querySelectorAll(".import-category-transactions li")].filter((li) => /Not importing/.test(li.textContent)).length),
    1,
    "the ticked row is not marked",
  );
  await (await reviewCheckbox("QQXZ BIG BOX")).click();

  // The keyboard works: focus the second count and press Enter.
  await browser.execute(() => document.querySelectorAll("button.import-category-rows-toggle")[1].focus());
  await browser.keys("Enter");
  await waitUntilOrDiagnose(browser, async () => (await lists()).length === 2, { timeoutMsg: "Enter on a focused count should open its list" });
  assert.equal(await (await toggles())[1].getAttribute("aria-expanded"), "true");

  // Open the third as well: all three lists, and nothing scrolls inside the panel.
  await (await toggles())[2].click();
  await waitUntilOrDiagnose(browser, async () => (await lists()).length === 3, { timeoutMsg: "the third list should open" });
  assert.equal(await (await panelMenu("GENERAL_MERCHANDISE / GENERAL_MERCHANDISE_SUPERSTORES")).getAttribute("data-value"), "skip", "opening lists changes no choice");
  assert.equal(await remainingText(), remainingBefore, "opening lists changes what still needs a category");
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await browser.saveScreenshot(path.join(shots, "feature387-open-default-dark.png"));
  }

  // Closing again hides just that list.
  await (await toggles())[0].click();
  await waitUntilOrDiagnose(browser, async () => (await lists()).length === 2, { timeoutMsg: "clicking an open count should close its list" });
  assert.equal(await (await toggles())[0].getAttribute("aria-expanded"), "false");
  await cancelReview();
  trace("behavior done");

  // ---- 3. Every style, light and dark --------------------------------------------------------------
  for (const [label, palette] of STYLES) {
    await chooseStyle(browser, label, palette);
    for (const theme of THEMES) {
      await setTheme(theme);
      await openReview();
      for (const toggle of await toggles()) await toggle.click();
      await waitUntilOrDiagnose(browser, async () => (await lists()).length === 3, { timeoutMsg: `${palette}/${theme}: all lists should open` });
      await (await reviewCheckbox("QQXZ BIG BOX")).click();
      await (await browser.$(".import-category-reconcile-head strong")).click(); // focus and pointer off the counts
      const where = `${palette}/${theme}`;

      const contrast = await browser.execute(measureContrast, {
        count: ".import-category-rows-toggle",
        date: ".import-category-tx-date",
        description: ".import-category-tx-desc",
        amount: ".import-category-tx-amount",
        notImporting: "li[data-not-importing] .import-category-tx-skipped",
        notImportingRow: "li[data-not-importing] .import-category-tx-desc",
      });
      for (const [name, ratio] of Object.entries(contrast)) assert.ok(ratio >= 4.5, `${where}: ${name} reads at ${ratio}:1, below 4.5:1`);

      // Hovering the count must not give it the app's solid button fill (blue text on blue).
      await (await toggles())[0].moveTo();
      const hover = await browser.execute(() => {
        const cs = getComputedStyle(document.querySelector(".import-category-rows-toggle"));
        return { bg: cs.backgroundColor, image: cs.backgroundImage };
      });
      assert.match(hover.bg, /^rgba\(0, 0, 0, 0\)|^transparent$/, `${where}: a hovered count keeps no fill (${JSON.stringify(hover)})`);
      assert.equal(hover.image, "none", `${where}: a hovered count keeps no gradient`);

      // The panel grows with the dialog; nothing scrolls inside it, and nothing runs sideways.
      const box = await browser.execute(() => {
        const list = document.querySelector(".import-category-list");
        const right = list.getBoundingClientRect().right;
        const beyond = [...list.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > right + 1).length;
        return { scrollH: list.scrollHeight, clientH: list.clientHeight, overflowX: getComputedStyle(list).overflowX, beyond };
      });
      assert.ok(box.scrollH <= box.clientH, `${where}: the panel scrolls inside the dialog (${JSON.stringify(box)})`);
      assert.equal(box.overflowX, "hidden", `${where}: no sideways scrolling`);
      assert.equal(box.beyond, 0, `${where}: something sticks out past the panel`);
      const wrapped = await browser.execute(() =>
        [...document.querySelectorAll(".import-category-rows-toggle")].map((t) => t.getClientRects().length),
      );
      assert.ok(wrapped.every((n) => n === 1), `${where}: a count wraps onto two lines (${JSON.stringify(wrapped)})`);
      if (shots) await browser.saveScreenshot(path.join(shots, `feature387-open-${palette}-${theme}.png`));
      await cancelReview();
      trace(`${where} ok`);
    }
  }

  console.log("FEATURE 387 E2E TEST PASSED");
} finally {
  await app.close();
  fs.rmSync(csvDir, { recursive: true, force: true });
}
