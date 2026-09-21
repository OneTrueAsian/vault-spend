// E2E test for Phase 4 item 19 (investment accumulation + projection), part 2:
// the projection settings and the projection itself.
//
//   - the monthly amount defaults to the last-6-complete-months average and says
//     so; a saved amount sticks (also after quitting and reopening) and
//     "Reset to average" brings the default back;
//   - a bad entry (return over 100, a non-number or negative amount, a past
//     withdraw month, years outside 1-50) shows a message and saves NOTHING;
//   - withdraw month + return give a projected number: at 0% it is worth now +
//     monthly x months left, and it matches the compound-growth formula at a real
//     return; changing the return moves the projection but not invested / worth;
//   - "spread over N years" lists N yearly withdrawals (balance / years left,
//     the rest growing) ending at $0; blank N lists none;
//   - "today's dollars" shrinks only the projected figures, at the inflation %
//     shown, which is editable and saved.
//
// Run with: node e2e/feature93_accumulation_plan.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { futureValue, money, monthFromNow, nav, openDetails, saveAndSettle, setField, text, value, waitForAccumulation } from "./lib/accumulation.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()

def month_start(back):
    total = today.year * 12 + today.month - 1 - back
    y, m = divmod(total, 12)
    return datetime.date(y, m + 1, 1)

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Joey Roth IRA', 'investment', '0.00')")
roth = cur.lastrowid
# $400 on the 1st of each of the last six complete months -> the default average is exactly 400.00.
for back in range(6, 0, -1):
    d = month_start(back).isoformat()
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (roth, d, f"Roth deposit {back}", "400.00", "Transfer", "user", f"f93-{back}"))
# Worth exactly $10,000.
cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?,?,?,?,?,?,?)",
            (roth, "VTI", "Total Market", "20", "500.00", "8000.00", "US Stock"))
`);

const fail = (message) => {
  throw new Error(message);
};
const START = 10000;
const MONTHS_AHEAD = 24;

async function withApp(fn) {
  const app = await launchApp({ dbDir });
  try {
    await app.browser.setWindowSize(1440, 1600);
    await fn(app.browser);
  } finally {
    await app.close();
  }
}

/** Fills the settings form (only the fields given) and presses Save. */
async function fillAndSave(browser, fields) {
  const selectors = { monthly: "[data-acc-monthly]", returnPct: "[data-acc-return]", month: "[data-acc-withdraw-month]", years: "[data-acc-withdraw-years]", inflation: "[data-acc-inflation]" };
  for (const [key, v] of Object.entries(fields)) await setField(browser, selectors[key], v);
  await saveAndSettle(browser);
}
const projected = (browser) => text(browser, "[data-acc-projected]");
const snapshot = async (browser) => ({ invested: await text(browser, "[data-acc-invested]"), worth: await text(browser, "[data-acc-worth]") });
const formValues = async (browser) => ({
  monthly: await value(browser, "[data-acc-monthly]"),
  returnPct: await value(browser, "[data-acc-return]"),
  month: await value(browser, "[data-acc-withdraw-month]"),
  years: await value(browser, "[data-acc-withdraw-years]"),
  inflation: await value(browser, "[data-acc-inflation]"),
});

// ============================== session 1 ==============================
await withApp(async (browser) => {
  const id = await openDetails(browser, "Joey Roth IRA");
  await waitForAccumulation(browser, id);

  // ---- 19.3: the default, and who it came from ---------------------------------
  const untouched = await formValues(browser);
  console.log("defaults:", untouched);
  if (untouched.monthly !== "400.00" || untouched.returnPct !== "7" || untouched.month !== "" || untouched.years !== "" || untouched.inflation !== "3") {
    fail(`a fresh account should show the 400.00 average, 7% return, no date or years, 3% inflation; got ${JSON.stringify(untouched)}`);
  }
  if (!/Default: your average/.test(await text(browser, "[data-acc-monthly-note]"))) fail("the note should say the amount is the default average");
  if (await browser.$("[data-acc-reset-average]").isExisting()) fail("nothing is saved yet, so there is nothing to reset");
  const before = await snapshot(browser);
  if (before.invested !== money(2400) || before.worth !== money(START)) fail(`expected ${money(2400)} invested and ${money(START)} worth, got ${JSON.stringify(before)}`);

  // ---- 19.10: refused entries save nothing ----------------------------------------
  const bad = [
    ["a return over 100", { returnPct: "150" }, /between 0 and 100/],
    ["a negative return", { returnPct: "-2" }, /between 0 and 100/],
    ["a monthly amount that isn't a number", { monthly: "abc" }, /monthly amount/i],
    ["a negative monthly amount", { monthly: "-5" }, /monthly amount/i],
    ["a withdraw month in the past", { month: monthFromNow(-1) }, /in the past/i],
    ["zero years", { years: "0" }, /1 to 50/],
    ["fifty-one years", { years: "51" }, /1 to 50/],
    ["an inflation over 100", { inflation: "150" }, /inflation/i],
    // The page compares numbers in double precision, the backend exactly, so this passes the page's own
    // check and is refused by the backend on the SECOND write (the shared inflation setting). The plan
    // change sent with it (return 5) must not be left saved behind an error.
    ["an inflation the page can't tell from 100 (with a return change alongside)", { returnPct: "5", inflation: "100.0000000000000000001" }, /inflation/i],  ];
  for (const [label, fields, pattern] of bad) {
    // Start every case from the good, untouched form.
    await setField(browser, "[data-acc-monthly]", "400.00");
    await setField(browser, "[data-acc-return]", "7");
    await setField(browser, "[data-acc-withdraw-month]", "");
    await setField(browser, "[data-acc-withdraw-years]", "");
    await setField(browser, "[data-acc-inflation]", "3");
    await fillAndSave(browser, fields);
    const message = await text(browser, "[data-acc-error]").catch(() => fail(`${label}: no error message appeared`));
    if (!pattern.test(message)) fail(`${label}: expected a message matching ${pattern}, got "${message}"`);
    if ((await projected(browser)) !== "—") fail(`${label}: nothing should have been saved, but a projection appeared`);
  }
  // Reopen the page: the form must come back exactly as it was.
  await nav(browser, "Accounts");
  await openDetails(browser, "Joey Roth IRA");
  await waitForAccumulation(browser, id);
  const afterBad = await formValues(browser);
  if (JSON.stringify(afterBad) !== JSON.stringify(untouched)) fail(`refused saves changed something: ${JSON.stringify(afterBad)} vs ${JSON.stringify(untouched)}`);

  // ---- 19.4: a withdraw month + 0% return -> worth now + monthly x months ------------------
  await fillAndSave(browser, { monthly: "450", returnPct: "0", month: monthFromNow(MONTHS_AHEAD) });
  const flat = await projected(browser);
  if (flat !== money(START + 450 * MONTHS_AHEAD)) fail(`at 0% the projection should be ${money(START + 450 * MONTHS_AHEAD)} (10,000 + 450 x 24), got ${flat}`);
  if (!new RegExp(`${MONTHS_AHEAD} months`).test(await text(browser, "[data-acc-projected-note]"))) fail("the projected tile should say how many months it covers");
  if (!/You saved/.test(await text(browser, "[data-acc-monthly-note]"))) fail("after saving, the note should say the amount is the saved one");
  await browser.$("[data-acc-reset-average]").waitForExist({ timeout: 5000, timeoutMsg: "a saved amount should offer Reset to average" });
  await browser.$("polyline[data-series='projected']").waitForExist({ timeout: 5000, timeoutMsg: "a projection should draw its dashed line" });

  // ---- 19.5: a different return moves the projection, not invested / worth -----------------
  await fillAndSave(browser, { returnPct: "7" });
  const at7 = await projected(browser);
  if (at7 !== money(futureValue(START, 450, 7, MONTHS_AHEAD))) fail(`7% should project ${money(futureValue(START, 450, 7, MONTHS_AHEAD))}, got ${at7}`);
  const line7 = await (await browser.$("polyline[data-series='projected']")).getAttribute("points");
  await fillAndSave(browser, { returnPct: "5" });
  const at5 = await projected(browser);
  if (at5 !== money(futureValue(START, 450, 5, MONTHS_AHEAD))) fail(`5% should project ${money(futureValue(START, 450, 5, MONTHS_AHEAD))}, got ${at5}`);
  const line5 = await (await browser.$("polyline[data-series='projected']")).getAttribute("points");
  if (line5 === line7) fail("the dashed line should change when the return changes");
  const after = await snapshot(browser);
  if (JSON.stringify(after) !== JSON.stringify(before)) fail(`changing the return must not move invested / worth: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

  // ---- 19.7: spreading the withdrawals -------------------------------------------------
  await fillAndSave(browser, { returnPct: "0", years: "4" });
  let drawdown = await browser.execute(() =>
    [...document.querySelectorAll("[data-acc-drawdown-row]")].map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent.trim())),
  );
  const total = START + 450 * MONTHS_AHEAD;
  if (drawdown.length !== 4) fail(`four years should list four withdrawals, got ${drawdown.length}`);
  drawdown.forEach((row, i) => {
    if (row[2] !== money(total / 4)) fail(`year ${i + 1} should take ${money(total / 4)} (balance / years left at 0%), got ${row[2]}`);
    if (row[3] !== money(total - (total / 4) * (i + 1))) fail(`year ${i + 1} should leave ${money(total - (total / 4) * (i + 1))}, got ${row[3]}`);
  });
  if (drawdown[3][3] !== money(0)) fail("the last year must leave $0.00");
  // With growth: the rest keeps compounding between withdrawals.
  await fillAndSave(browser, { returnPct: "6", years: "3" });
  drawdown = await browser.execute(() =>
    [...document.querySelectorAll("[data-acc-drawdown-row]")].map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent.trim())),
  );
  const grow = 1.005 ** 12;
  const b0 = futureValue(START, 450, 6, MONTHS_AHEAD);
  const w1 = b0 / 3;
  const b1 = (b0 - w1) * grow;
  const w2 = b1 / 2;
  const b2 = (b1 - w2) * grow;
  const expected = [w1, w2, b2];
  if (drawdown.length !== 3) fail(`three years should list three withdrawals, got ${drawdown.length}`);
  drawdown.forEach((row, i) => {
    if (row[2] !== money(expected[i])) fail(`with 6% growth year ${i + 1} should take ${money(expected[i])}, got ${row[2]}`);
  });
  if (drawdown[2][3] !== money(0)) fail("the last year must leave $0.00");
  // Blank years: no list, projection ends at the withdraw month.
  await fillAndSave(browser, { years: "" });
  if (await browser.$("[data-acc-drawdown]").isExisting()) fail("with no 'spread over' years there is no withdrawals list");

  // ---- 19.8: today's dollars ---------------------------------------------------------------
  await fillAndSave(browser, { returnPct: "0" });
  const nominal = await projected(browser);
  const toggle = await browser.$("[data-acc-todays-dollars]");
  if (await toggle.isSelected()) await toggle.click(); // start from off
  await toggle.click();
  const real3 = money((START + 450 * MONTHS_AHEAD) / 1.03 ** (MONTHS_AHEAD / 12));
  await browser.waitUntil(async () => (await projected(browser)) === real3, { timeout: 5000, timeoutMsg: `today's dollars at 3% should show ${real3} (was ${nominal})` });
  if (!/today's dollars at 3%/.test(await text(browser, "[data-acc-projected-note]"))) fail("the projected tile should be labelled as today's dollars at 3%/yr");
  const deflated = await snapshot(browser);
  if (JSON.stringify(deflated) !== JSON.stringify(before)) fail(`today's dollars must not touch invested / worth: ${JSON.stringify(deflated)}`);
  await fillAndSave(browser, { inflation: "5" });
  const real5 = money((START + 450 * MONTHS_AHEAD) / 1.05 ** (MONTHS_AHEAD / 12));
  if ((await projected(browser)) !== real5) fail(`at 5% inflation the projection should read ${real5}, got ${await projected(browser)}`);
  if (!/at 5%/.test(await text(browser, "[data-acc-projected-note]"))) fail("the label should follow the edited inflation");
  // The switch is per viewer (browser storage): it survives a page reload.
  await browser.url("http://tauri.localhost/index.html");
  await browser.$(".brand-word").waitForExist({ timeout: 15000 });
  await openDetails(browser, "Joey Roth IRA");
  await waitForAccumulation(browser, id);
  if (!(await (await browser.$("[data-acc-todays-dollars]")).isSelected())) fail("the today's-dollars switch should still be on after a reload");
  await (await browser.$("[data-acc-todays-dollars]")).click(); // back to off for the restart check below
});

// ============================== session 2: quit and reopen ==============================
await withApp(async (browser) => {
  const id = await openDetails(browser, "Joey Roth IRA");
  await waitForAccumulation(browser, id);
  const kept = await formValues(browser);
  console.log("after restart:", kept);
  const expected = { monthly: "450.00", returnPct: "0", month: monthFromNow(MONTHS_AHEAD), years: "", inflation: "5" };
  // The saved amount is stored as typed ("450"); accept either rendering.
  if (Number(kept.monthly) !== 450) fail(`the saved monthly amount should survive a restart, got ${kept.monthly}`);
  for (const key of ["returnPct", "month", "years", "inflation"]) {
    if (kept[key] !== expected[key]) fail(`${key} should survive a restart: expected ${expected[key]}, got ${kept[key]}`);
  }
  // Same projected number (nominal unless this profile also kept the switch).
  const on = await (await browser.$("[data-acc-todays-dollars]")).isSelected();
  const want = on ? money((START + 450 * MONTHS_AHEAD) / 1.05 ** (MONTHS_AHEAD / 12)) : money(START + 450 * MONTHS_AHEAD);
  if ((await projected(browser)) !== want) fail(`the projection should be the same after a restart (${want}), got ${await projected(browser)}`);

  // ---- 19.3: Reset to average --------------------------------------------------------
  await (await browser.$("[data-acc-reset-average]")).click();
  await browser.waitUntil(async () => (await value(browser, "[data-acc-monthly]")) === "400.00", { timeout: 5000, timeoutMsg: "Reset to average should bring back 400.00" });
  if (await browser.$("[data-acc-reset-average]").isExisting()) fail("once reset there is nothing left to reset");
  if (!/Default: your average/.test(await text(browser, "[data-acc-monthly-note]"))) fail("after a reset the note should say it is the default average again");
});

// ============================== session 3: the reset stuck ==============================
await withApp(async (browser) => {
  const id = await openDetails(browser, "Joey Roth IRA");
  await waitForAccumulation(browser, id);
  if ((await value(browser, "[data-acc-monthly]")) !== "400.00") fail("the reset should survive a restart");
  if (await browser.$("[data-acc-reset-average]").isExisting()) fail("no saved amount after a restart either");
  // ...and the rest of the plan is still there.
  if ((await value(browser, "[data-acc-withdraw-month]")) !== monthFromNow(MONTHS_AHEAD)) fail("the withdraw month should still be saved");
});

console.log("FEATURE 93 E2E TEST PASSED");
