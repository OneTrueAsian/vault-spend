// E2E test: the global "Rollover unspent" switch in Settings.
//
//   - on by default: today's behaviour — each Budget category has its own
//     "Roll over unspent" box and a category that opted in shows what rolled in;
//   - off: no unspent budget is carried into the month (rows read the plain
//     budget), the per-category boxes and rolled-in notes are hidden, and the
//     Budget page says why — while every stored choice and earlier month is
//     untouched, so last month still reads what it always did;
//   - the choice survives closing and reopening the app;
//   - back on: the carry returns and each category's own tick is as it was.
//
// Run with: node e2e/feature86_rollover_setting.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()

def month_start(back):
    total = today.year * 12 + today.month - 1 - back
    y, m = divmod(total, 12)
    return datetime.date(y, m + 1, 1)

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid

def spend(back, day, desc, amount, category):
    d = (month_start(back) + datetime.timedelta(days=day)).isoformat()
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, "-" + amount, category, "user", f"{acct}|{d}|{desc.lower()}|-{amount}"))

# Groceries budgeted $400 both months with rollover on; last month spent $300 ($100 left), this month $120 so far.
for back in (1, 0):
    period = month_start(back).strftime("%Y-%m")
    cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", (period,))
    cur.execute("INSERT OR REPLACE INTO budgets (category, period, monthly_amount, budget_group, rollover_enabled) VALUES ('Groceries', ?, '400.00', 'flexible', 1)", (period,))
spend(1, 8, "Grocers Last Month", "300.00", "Groceries")
spend(0, 0, "Grocers This Month", "120.00", "Groceries")
`);

async function withApp(fn) {
  const app = await launchApp({ dbDir });
  try {
    await app.browser.setWindowSize(1440, 1100);
    await fn(app.browser);
  } finally {
    await app.close?.();
  }
}
async function nav(browser, label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) {
      await b.click();
      await browser.pause(600);
      return;
    }
  }
  throw new Error(`no nav button "${label}"`);
}
const rolloverToggle = (browser) =>
  browser.execute(() => {
    const row = [...document.querySelectorAll(".feature-toggle-row")].find((r) => r.querySelector(".feature-toggle-label")?.textContent.trim() === "Rollover unspent");
    return row ? { checked: row.querySelector("input").checked } : null;
  });
async function setRolloverSetting(browser, on) {
  await nav(browser, "Settings");
  const state = await rolloverToggle(browser);
  if (!state) throw new Error('Settings should have a "Rollover unspent" switch under Feature toggles');
  if (state.checked !== on) {
    await browser.execute(() => {
      const row = [...document.querySelectorAll(".feature-toggle-row")].find((r) => r.querySelector(".feature-toggle-label")?.textContent.trim() === "Rollover unspent");
      row.querySelector("input").click();
    });
    await browser.waitUntil(async () => (await rolloverToggle(browser)).checked === on, { timeout: 10000, timeoutMsg: `the switch should read ${on ? "on" : "off"}` });
    await browser.pause(500);
  }
}
const groceriesRow = (browser) =>
  browser.$("//div[contains(@class,'cat-row')][.//span[contains(@class,'category-link')][normalize-space()='Groceries']]");
async function rowText(browser) {
  const row = await groceriesRow(browser);
  await row.waitForExist({ timeout: 10000, timeoutMsg: "no Groceries budget row" });
  return (await row.getText()).replace(/\s+/g, " ");
}
const boxCount = (browser) =>
  browser.execute(() => [...document.querySelectorAll(".cat-row label")].filter((l) => l.textContent.includes("Roll over unspent")).length);
const pageSub = (browser) => browser.execute(() => document.querySelector(".budget-view .view-sub")?.textContent ?? "");

// ---- 1. default: on, exactly as before -----------------------------------
await withApp(async (browser) => {
  await nav(browser, "Settings");
  const state = await rolloverToggle(browser);
  if (!state || !state.checked) throw new Error("the switch should start on for an existing profile");
  await nav(browser, "Budget");
  const text = await rowText(browser);
  console.log("default, this month:", text);
  if (!text.includes("+ $100.00 rolled in") || !text.includes("$380.00 left")) throw new Error(`default behaviour should carry $100 in: ${text}`);
  if ((await boxCount(browser)) < 1) throw new Error("the per-category boxes should show while the feature is on");
  if (/off in Settings/i.test(await pageSub(browser))) throw new Error("no 'off' note while it's on");

  // ---- 2. switch it off -------------------------------------------------------
  await setRolloverSetting(browser, false);
  await nav(browser, "Budget");
  await browser.waitUntil(async () => !(await rowText(browser)).includes("rolled in"), { timeout: 10000, timeoutMsg: "no carry once the feature is off" });
  const off = await rowText(browser);
  console.log("off, this month:", off);
  if (!off.includes("$280.00 left")) throw new Error(`off: $400 - $120 = $280.00 left, got: ${off}`);
  if (!off.includes("$400.00 budget")) throw new Error(`the planned budget is unchanged: ${off}`);
  if ((await boxCount(browser)) !== 0) throw new Error("the per-category 'Roll over unspent' boxes should be hidden while the feature is off");
  if (!/rollover.*off in Settings/i.test(await pageSub(browser))) throw new Error(`the Budget page should say rollover is off in Settings, got: "${await pageSub(browser)}"`);

  // An earlier month is untouched: still $300 spent of $400.
  await (await browser.$("button[aria-label='Previous month']")).click();
  await browser.waitUntil(async () => (await rowText(browser)).includes("$100.00 left"), { timeout: 10000, timeoutMsg: "last month should still read $100.00 left" });
  await (await browser.$("button[aria-label='Next month']")).click();
});

// ---- 3. it persists across a restart -------------------------------------
await withApp(async (browser) => {
  await nav(browser, "Settings");
  const state = await rolloverToggle(browser);
  if (!state || state.checked) throw new Error("the switch should still be off after reopening the app");
  await nav(browser, "Budget");
  const text = await rowText(browser);
  if (text.includes("rolled in") || !text.includes("$280.00 left")) throw new Error(`still off after a restart: ${text}`);
  if ((await boxCount(browser)) !== 0) throw new Error("boxes stay hidden after a restart");

  // ---- 4. back on: the carry returns and the category's own choice is intact --
  await setRolloverSetting(browser, true);
  await nav(browser, "Budget");
  await browser.waitUntil(async () => (await rowText(browser)).includes("+ $100.00 rolled in"), { timeout: 10000, timeoutMsg: "turning it back on restores the carry" });
  const back = await rowText(browser);
  if (!back.includes("$380.00 left")) throw new Error(`back on: $380.00 left, got: ${back}`);
  const ticked = await browser.execute(() => {
    const label = [...document.querySelectorAll(".cat-row label")].find((l) => l.textContent.includes("Roll over unspent"));
    return label ? label.querySelector("input").checked : null;
  });
  if (ticked !== true) throw new Error("Groceries' own 'Roll over unspent' tick was remembered through the off period");
});

console.log("FEATURE 86 E2E TEST PASSED");
