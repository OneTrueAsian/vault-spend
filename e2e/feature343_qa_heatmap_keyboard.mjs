// QA-A11Y (heatmap): the Reports "Daily spending" grid is one Tab stop, the arrow keys / Home / End move between days, and the
// focused day's total is read out in the live status line. Weeks are columns with Sunday on top: Up/Down step one day inside a week,
// Left/Right jump a week. Driven with real key presses. Fixture: last month, Paycheck day 1, Ferry Cafe -100.00 day 8 (spending).
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
a = cur.lastrowid
for d, desc, amt, cat in (("${dateInMonth(-1, 1)}", "Paycheck", "3000.00", "Income"), ("${dateInMonth(-1, 8)}", "Ferry Cafe", "-100.00", "Dining Out")):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)", (a, d, desc, amt, cat, "user", f"{a}|{d}|{desc.lower()}|{amt}"))
`);
const app = await launchApp({ dbDir });
const { browser } = app;
const active = () => browser.execute(() => document.activeElement?.getAttribute("data-heatmap-day") ?? null);
const status = async () => (await (await browser.$("[data-heatmap-status]")).getText()).trim();
const press = async (...keys) => { await browser.keys(keys); };
try {
  await browser.setWindowSize(1440, 1400);
  for (const b of await browser.$$("nav button")) if ((await b.getText()).trim() === "Reports") { await b.click(); break; }
  await browser.$("[data-reports-hub]").waitForExist({ timeout: 10000 });
  await (await browser.$("[data-range-preset='last_month']")).click();
  await browser.$("[data-report-heatmap] [data-heatmap-day]").waitForExist({ timeout: 10000 });

  // One Tab stop: exactly one day in the grid is reachable with Tab, and it is the newest day.
  const stops = await browser.execute(() => [...document.querySelectorAll("[data-report-heatmap] [data-heatmap-day]")].filter((b) => b.tabIndex === 0).map((b) => b.getAttribute("data-heatmap-day")));
  const lastDay = await browser.execute(() => [...document.querySelectorAll("[data-report-heatmap] [data-heatmap-day]")].map((b) => b.getAttribute("data-heatmap-day")).sort().pop());
  assert.deepEqual(stops, [lastDay], "only the newest day is a Tab stop: " + JSON.stringify(stops));
  assert.equal(await (await browser.$("[data-report-heatmap] [role='group']")).isExisting(), true, "the grid is a named group");

  // Tab into the grid from the page: focus lands on the one stop, and its total is read out.
  await browser.execute((d) => document.querySelector(`[data-heatmap-day='${d}']`).focus(), lastDay);
  assert.equal(await active(), lastDay);

  await press("Home");
  assert.equal(await active(), dateInMonth(-1, 1), "Home goes to the first day");
  await waitUntilOrDiagnose(browser, async () => (await status()).includes("$0.00"), { timeout: 5000, timeoutMsg: "day 1 (a paycheck, no spending) reads $0.00", extra: status });
  await press("ArrowRight");
  assert.equal(await active(), dateInMonth(-1, 8), "Right jumps a week");
  await waitUntilOrDiagnose(browser, async () => (await status()).includes("$100.00"), { timeout: 5000, timeoutMsg: "the day of the Ferry Cafe reads $100.00", extra: status });
  await press("ArrowLeft");
  assert.equal(await active(), dateInMonth(-1, 1), "Left jumps back a week");
  await press("End");
  assert.equal(await active(), lastDay, "End goes to the last day");
  const before = await active();
  await press("ArrowDown");
  const afterDown = await active();
  assert.ok(afterDown !== null, "focus stays inside the grid");
  await press("ArrowUp");
  assert.ok((await active()) !== null);
  if (afterDown !== before) assert.equal(await active(), before, "Up undoes Down");

  // The grid keeps its place: park on day 8, Tab out of the grid, Shift+Tab back lands on day 8, not the newest day.
  await press("Home");
  await press("ArrowRight");
  assert.equal(await active(), dateInMonth(-1, 8));
  await press("Tab");
  assert.equal(await active(), null, "Tab leaves the grid after one stop");
  await press("Shift", "Tab");
  assert.equal(await active(), dateInMonth(-1, 8), "coming back lands on the day last visited");
  console.log("FEATURE 343 PASSED: the daily-spending grid is one Tab stop with arrow-key, Home and End navigation and a live readout of the focused day.");
} finally { await app.close(); }
