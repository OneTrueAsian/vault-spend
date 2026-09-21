// E2E test: three fields that used to render as unstyled browser inputs now
// carry the app's standard entry-field styling, in light and dark:
//   - Dashboard -> Safe to spend -> "Keep a buffer of $"
//   - Investments -> Goal projection -> Save as goal… -> the goal name
//   - Settings -> Data -> Backups -> the second backup folder
// The yardstick is the Transactions search box (`.ledger-filters input`): same
// font, size, padding, border, radius, background and text colour — read from
// the real page in each theme, not hard-coded.
//
// Run with: node e2e/feature88_text_inputs_match.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
def in_days(n): return (today + datetime.timedelta(days=n)).isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '3000.00')")
acct = cur.lastrowid
cur.execute("INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id) VALUES ('Geico Auto', NULL, '-175.00', 'monthly', ?, ?)", (in_days(2), acct))
cur.execute("INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id) VALUES ('Payroll Deposit', NULL, '2000.00', 'biweekly', ?, ?)", (in_days(9), acct))
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Brokerage', 'investment', '0.00')")
broker = cur.lastrowid
cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?, 'VTI', 'Vanguard Total Stock Market', '10', '250.00', '2000.00', 'US Stocks')", (broker,))
`);

const app = await launchApp({ dbDir });
const { browser } = app;

async function goTo(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) {
      await b.click();
      await browser.pause(700);
      return;
    }
  }
  throw new Error(`no nav button "${label}"`);
}
async function setTheme(label) {
  for (const b of await browser.$$(".topbar button")) {
    if ((await b.getText()).trim() === label) {
      await b.click();
      await browser.pause(400);
      return;
    }
  }
  throw new Error(`no ${label} theme button in the header`);
}
const PROPS = [
  "fontFamily", "fontSize", "fontWeight", "color", "backgroundColor",
  "borderTopWidth", "borderTopStyle", "borderTopColor", "borderRadius",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
];
const styleOf = (selector) =>
  browser.execute(
    (sel, props) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, cs[p]]));
    },
    selector,
    PROPS,
  );
/** The focus ring an input shows once focused (browser default in this app, for the standard field too).
 * null when this window isn't the one holding operating-system focus — with several app windows open
 * side by side (the parallel runner) it can lose it at any moment, and an unfocused window paints no ring. */
const focusRing = (selector) =>
  browser.execute((sel) => {
    const el = document.querySelector(sel);
    el.focus();
    if (!document.hasFocus()) return null;
    const cs = getComputedStyle(el);
    return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`;
  }, selector);
async function assertSameRing(label, selector, referenceRing, theme) {
  const ring = await focusRing(selector);
  if (ring !== null && referenceRing !== null && ring !== referenceRing) {
    throw new Error(`${theme}: the ${label}'s focus ring (${ring}) differs from the standard field's (${referenceRing})`);
  }
}
function assertSame(label, actual, reference, theme) {
  if (!actual) throw new Error(`${theme}: ${label} not found`);
  const diffs = PROPS.filter((p) => actual[p] !== reference[p]).map((p) => `${p}: ${actual[p]} (standard: ${reference[p]})`);
  if (diffs.length) throw new Error(`${theme}: ${label} doesn't match the standard entry field:\n  ${diffs.join("\n  ")}`);
}

try {
  await browser.setWindowSize(1440, 1200);
  await browser.pause(1000);

  for (const theme of ["Light", "Dark"]) {
    await setTheme(theme);

    // The yardstick: the Transactions search box.
    await goTo("Transactions");
    const reference = await styleOf(".ledger-filters input[type='search']");
    const referenceRing = await focusRing(".ledger-filters input[type='search']");
    if (!reference) throw new Error("no Transactions search box to compare against");
    if (reference.borderTopStyle !== "solid" || reference.borderRadius === "0px") throw new Error(`the yardstick itself looks unstyled: ${JSON.stringify(reference)}`);

    await goTo("Dashboard");
    await (await browser.$(".safe-buffer input")).waitForExist({ timeout: 15000 });
    assertSame("Safe to spend buffer input", await styleOf(".safe-buffer input"), { ...reference }, theme);
    await assertSameRing("Safe to spend input", ".safe-buffer input", referenceRing, theme);

    await goTo("Investments");
    const saveAsGoal = await browser.$("[data-projection-save-as-goal]");
    await saveAsGoal.waitForExist({ timeout: 15000 });
    await saveAsGoal.scrollIntoView({ block: "center" });
    await saveAsGoal.click();
    await (await browser.$("[data-projection-goal-name]")).waitForExist({ timeout: 5000 });
    assertSame("Goal projection name input", await styleOf("[data-projection-goal-name]"), reference, theme);
    await assertSameRing("goal name input", "[data-projection-goal-name]", referenceRing, theme);
    await (await browser.$("//button[normalize-space()='Cancel']")).click();

    await goTo("Settings");
    const copyInput = await browser.$("[data-backup-copy] input[aria-label='Second backup folder']");
    await copyInput.waitForExist({ timeout: 10000 });
    await copyInput.scrollIntoView({ block: "center" });
    assertSame("Second backup folder input", await styleOf("[data-backup-copy] input[aria-label='Second backup folder']"), reference, theme);
    await assertSameRing("second backup input", "[data-backup-copy] input[aria-label='Second backup folder']", referenceRing, theme);

    // The Ctrl+K palette's search box uses the same standard field.
    await browser.execute(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await browser.keys(["Control", "k"]);
    await (await browser.$("[data-palette-input]")).waitForExist({ timeout: 5000 });
    await browser.pause(400);
    const paletteStyle = await styleOf("[data-palette-input]");
    // (Its text is deliberately a size larger than the standard field, so font size is not compared.)
    for (const p of ["borderTopStyle", "borderTopColor", "borderRadius", "backgroundColor", "color"]) {
      if (paletteStyle[p] !== reference[p]) throw new Error(`${theme}: the palette's search box ${p} is ${paletteStyle[p]}, the standard field's is ${reference[p]}`);
    }
    await browser.keys("Escape");
    await browser.pause(300);

    console.log(`${theme}: the three inputs match the standard entry field — OK`);
  }

  console.log("FEATURE 88 E2E TEST PASSED");
} finally {
  await app.close?.();
}
