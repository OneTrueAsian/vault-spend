// UAT-139: a VALID large illustration (refusals of out-of-range entries are covered in feature93). Worth $50,000,000.00, $250,000.00 a month, 12% a year
// (1% a month, so the oracle is exact), 480 months. The oracle is an independent BigInt iteration of balance = balance * 101/100 + contribution,
// kept as N/100^k and rounded half-up to cents; it does not use the app's closed-form or floating-point code.
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { monthFromNow, openDetails, saveAndSettle, setField, text, waitForAccumulation } from "./lib/accumulation.mjs";

const MONTHS = 480;
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('QA Big Fund', 'investment', '0.00')")
fund = cur.lastrowid
cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?,?,?,?,?,?,?)", (fund, "BIG", "Big Fund", "10000", "5000.00", "40000000.00", "US Stock"))
`);
const expectedCents = (() => {
  let numerator = 50_000_000_00n; // cents, over 100^0
  let scale = 1n;
  for (let k = 1; k <= MONTHS; k++) {
    scale *= 100n;
    numerator = numerator * 101n + 250_000_00n * scale;
  }
  return (numerator * 2n + scale) / (2n * scale);
})();
const format = cents => `$${(cents / 100n).toLocaleString("en-US")}.${String(cents % 100n).padStart(2, "0")}`;
const fail = message => { throw new Error(message); };

const app = await launchApp({ dbDir });
const browser = app.browser;
try {
  await browser.setWindowSize(1440, 1600);
  const id = await openDetails(browser, "QA Big Fund");
  await waitForAccumulation(browser, id);
  for (const [selector, value] of [["[data-acc-monthly]", "250000"], ["[data-acc-return]", "12"], ["[data-acc-withdraw-month]", monthFromNow(MONTHS)]]) await setField(browser, selector, value);
  await saveAndSettle(browser);
  const worth = await text(browser, "[data-acc-worth]");
  if (worth !== "$50,000,000.00") fail(`worth now is 10,000 x 5,000.00: ${worth}`);
  const projected = await text(browser, "[data-acc-projected]");
  if (projected !== format(expectedCents)) fail(`projected ${projected}; independent oracle ${format(expectedCents)}`);
  if (!new RegExp(`${MONTHS} months`).test(await text(browser, "[data-acc-projected-note]"))) fail("the projected tile should say it covers 480 months");
  if (await browser.$("[data-acc-error]").isExisting()) fail("a valid large illustration shows no error");
  const overflow = await browser.execute(() => { const t = document.querySelector("[data-acc-projected]"); const card = t.closest(".stat"); const r = t.getBoundingClientRect(), c = card.getBoundingClientRect(); return r.right - c.right; });
  if (overflow > 1) fail(`the projected figure runs ${overflow}px past its tile`);
  console.log(`FEATURE 332 PASSED: valid large projection ${projected} equals the independent exact oracle and fits its tile.`);
} finally { await app.close(); }
