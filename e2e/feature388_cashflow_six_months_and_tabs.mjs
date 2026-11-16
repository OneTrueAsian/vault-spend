// VS-31 step 2 (CF): Cash Flow's "Six months at a glance" card above the page tabs, and the tabs themselves.
// Fixture, months relative to today (back 5 is the oldest):
//   back 5: income 3000; Rent 1650, Groceries 400, Kids activities and sports camps 120
//   back 4: only a 25.00 grocery refund on checking (no spending; the refund counts as money in)
//   back 3: income 3000; Rent 1650, Car upkeep 1240, Dining Out 200, Utilities 135, Entertainment 60, Subscriptions 30
//   back 2: income 3000; Rent 1650, Groceries 380, and a split purchase of 100.00 = Groceries 80 + Transfer 20
//   back 1: income 3200; Rent 1650, Groceries 420, Dining Out 90
//   back 0: Rent 1650, one uncategorized 15.00
// Eight categories in all, so the smallest fold into "Everything else". Month by month counts the split's parent
// (100.00); the six-month card counts its lines and leaves the Transfer line out (80.00). That is the one recorded
// difference between the two (see plan-cf.md); every other month's total must equal Month by month's expenses.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle, dismissStatusMessages, reclaimWindowFocus, withFocusRetry, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
def day(back, d):
    index = today.year * 12 + today.month - 1 - back
    y, m = divmod(index, 12)
    return datetime.date(y, m + 1, min(d, today.day) if back == 0 else d).isoformat()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('CF Checking','checking','9000.00')")
acct = cur.lastrowid
n = 0
def add(back, d, description, amount, category):
    global n
    n += 1
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,'user',?)", (acct, day(back, d), description, amount, category, f"cf-{n}"))
    return cur.lastrowid
for back, pay in [(5, '3000.00'), (3, '3000.00'), (2, '3000.00'), (1, '3200.00')]:
    add(back, 2, 'CF Pay', pay, 'Salary')
for back in [5, 3, 2, 1, 0]:
    add(back, 1, 'CF Rent', '-1650.00', 'Rent')
add(5, 9, 'CF Grocer', '-400.00', 'Groceries')
add(5, 10, 'CF Camp', '-120.00', 'Kids activities and sports camps')
add(4, 9, 'CF Grocer refund', '25.00', 'Groceries')
add(3, 9, 'CF Garage', '-1240.00', 'Car upkeep')
add(3, 10, 'CF Dinner', '-200.00', 'Dining Out')
add(3, 11, 'CF Power', '-135.00', 'Utilities')
add(3, 12, 'CF Cinema', '-60.00', 'Entertainment')
add(3, 13, 'CF Stream', '-30.00', 'Subscriptions')
add(2, 9, 'CF Grocer', '-380.00', 'Groceries')
split = add(2, 10, 'CF Split shop', '-100.00', 'Groceries')
cur.execute("INSERT INTO transaction_splits(transaction_id,category,amount) VALUES(?,?,?)", (split, 'Groceries', '-80.00'))
cur.execute("INSERT INTO transaction_splits(transaction_id,category,amount) VALUES(?,?,?)", (split, 'Transfer', '-20.00'))
add(1, 9, 'CF Grocer', '-420.00', 'Groceries')
add(1, 10, 'CF Dinner', '-90.00', 'Dining Out')
add(0, 1, 'CF Mystery', '-15.00', None)
`);

const shots = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature388-");
fs.mkdirSync(shots, { recursive: true });
const short = back => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() - back, 1).toLocaleDateString("en-US", { month: "short" }); };
const app = await launchApp({ dbDir });
const b = app.browser;

// Every figure the card shows, read as people (and screen readers) get it.
const readCard = () => b.execute(() => {
  const card = document.querySelector("[data-cashflow-six-months]");
  if (!card) return null;
  const rows = [...card.querySelectorAll(".sr-only tbody tr")].map(tr => [...tr.children].map(td => td.textContent));
  return {
    labels: [...card.querySelectorAll(".stacked-rows-label")].map(e => e.textContent),
    totals: [...card.querySelectorAll(".stacked-rows-total")].map(e => e.textContent),
    ticks: card.querySelectorAll(".stacked-rows-tick").length,
    legend: [...card.querySelectorAll(".stacked-rows-legend li")].map(e => e.textContent),
    rows,
    text: card.innerText,
  };
});
// Month by month's own hidden table: [month label, Income|Expenses, amount].
const readMonthByMonth = () => b.execute(() => [...document.querySelectorAll("#cashflow-panel-by-month .sr-only table tbody tr")].map(tr => [...tr.children].map(td => td.textContent)));

// Real geometry: no page-level sideways scroll, no word split across lines, no text over a bar, everything inside the card.
const layoutIssues = () => b.execute(() => {
  const issues = [];
  const main = document.querySelector(".main");
  if (main.scrollWidth > main.clientWidth + 1) issues.push({ kind: "main scrolls sideways", scrollWidth: main.scrollWidth, clientWidth: main.clientWidth });
  if (document.documentElement.scrollWidth > innerWidth + 1) issues.push({ kind: "page scrolls sideways" });
  const card = document.querySelector("[data-cashflow-six-months]");
  const box = card.getBoundingClientRect();
  const overlap = (a, c) => a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5;
  const textRect = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
  const splitWords = el => {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const m of node.textContent.matchAll(/\S+/g)) {
        const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
        if (new Set([...r.getClientRects()].map(x => Math.round(x.top))).size > 1) out.push(m[0]);
      }
    }
    return out;
  };
  for (const row of card.querySelectorAll(".stacked-rows-row")) {
    const label = textRect(row.querySelector(".stacked-rows-label"));
    const total = textRect(row.querySelector(".stacked-rows-total"));
    const track = row.querySelector(".stacked-rows-track").getBoundingClientRect();
    const name = row.querySelector(".stacked-rows-label").textContent;
    if (overlap(label, track)) issues.push({ kind: "month name over its bar", name });
    if (overlap(total, track)) issues.push({ kind: "total over its bar", name });
    if (total.right > box.right + 0.5 || label.left < box.left - 0.5) issues.push({ kind: "text outside the card", name });
    if (track.width < 40) issues.push({ kind: "bar too narrow to read", name, width: track.width });
    for (const seg of row.querySelectorAll(".stacked-rows-seg, .stacked-rows-tick")) {
      const s = seg.getBoundingClientRect();
      if (s.right > track.right + 3.5 || s.left < track.left - 1.5) issues.push({ kind: "segment or tick outside its bar", name });
    }
  }
  for (const el of [...card.querySelectorAll(".stacked-rows-label, .stacked-rows-total, .stacked-rows-legend li, .reports-section-title, .cashflow-six-months-sub"), ...document.querySelectorAll('[role="tablist"][aria-label="Cash Flow sections"] [role="tab"]')]) {
    const words = splitWords(el);
    if (words.length) issues.push({ kind: "word split across lines", text: el.textContent, words });
  }
  for (const li of card.querySelectorAll(".stacked-rows-legend li")) {
    const r = li.getBoundingClientRect();
    if (r.right > box.right + 0.5) issues.push({ kind: "legend outside the card", text: li.textContent });
  }
  const tabs = document.querySelector('[role="tablist"][aria-label="Cash Flow sections"]').getBoundingClientRect();
  if (tabs.right > main.getBoundingClientRect().right + 0.5) issues.push({ kind: "tab strip wider than the page" });
  return issues;
});

try {
  await b.setWindowSize(1440, 1000);
  await (await b.$('.nav-item[aria-label="Cash Flow"]')).click();
  await waitUntilOrDiagnose(b, async () => (await readCard())?.labels.length === 6, { timeout: 15000, timeoutMsg: "the six-month card shows a row for each of the six months" });

  // ---- Figures
  const card = await readCard();
  assert.deepEqual(card.labels, [5, 4, 3, 2, 1, 0].map(short), "one row per month, oldest first");
  assert.ok(card.text.includes(`Each row is a month's spending; the tick is what came in. ${new Date().toLocaleDateString("en-US", { month: "long" })} isn't over yet.`), card.text);
  assert.deepEqual(card.totals, ["$2,170.00", "$0.00", "$3,315.00", "$2,110.00", "$2,160.00", "$1,665.00"], "each month's spending; a refund-only month shows $0.00");
  assert.equal(card.ticks, 5, "a tick for each month where money came in (four paydays and the refund month)");
  assert.deepEqual(card.legend, ["Rent", "Groceries", "Car upkeep", "Dining Out", "Utilities", "Everything else", "What came in"], "past the largest five, categories fold into Everything else");
  const total = back => card.rows.find(([row, cat]) => row === short(back) && cat === "Total")?.[2];
  const came = back => card.rows.find(([row, cat]) => row === short(back) && cat === "What came in")?.[2] ?? "$0.00";

  // ---- The same months in Month by month (six-month window) must agree.
  await (await b.$("#cashflow-tab-by-month")).click();
  await (await b.$("#cashflow-panel-by-month")).$("button=6 months").click();
  await waitUntilOrDiagnose(b, async () => (await readMonthByMonth()).length === 12, { timeout: 10000, timeoutMsg: "Month by month lists six months" });
  const flow = await readMonthByMonth();
  const mbm = (back, series) => flow.find(([label, s]) => label.startsWith(short(back)) && s === series)?.[2];
  for (const back of [5, 4, 3, 1, 0]) {
    assert.equal(total(back), mbm(back, "Expenses"), `month ${short(back)}: six-month total equals Month by month's expenses`);
  }
  for (const back of [5, 4, 3, 2, 1, 0]) {
    assert.equal(came(back), mbm(back, "Income"), `month ${short(back)}: the tick equals Month by month's income`);
  }
  // The recorded difference: a split's Transfer line is not spending in the card, but its parent counts in Month by month.
  assert.equal(mbm(2, "Expenses"), "$2,130.00");
  assert.equal(total(2), "$2,110.00");
  console.log(`six-month totals match Month by month for 5 of 6 months; split month ${short(2)}: card ${total(2)} vs Month by month ${mbm(2, "Expenses")} (Transfer split line)`);

  // ---- Tabs from the keyboard: arrows move and wrap, Home and End jump, and the panel follows.
  await (await b.$("#cashflow-tab-forecast")).click();
  const focusedTab = () => b.execute(() => ({ id: document.activeElement?.id, shown: [...document.querySelectorAll('[role="tabpanel"][id^="cashflow-panel-"]')].filter(p => !p.hidden).map(p => p.id) }));
  for (const [key, id] of [["ArrowLeft", "debt"], ["ArrowRight", "forecast"], ["End", "debt"], ["Home", "forecast"], ["ArrowRight", "by-month"], ["ArrowRight", "one-month"], ["ArrowRight", "last-year"]]) {
    await withFocusRetry(b, async () => {
      await reclaimWindowFocus(b);
      await b.execute(() => document.querySelector('[role="tablist"][aria-label="Cash Flow sections"] [aria-selected="true"]').focus());
      await b.keys(key);
      await waitUntilOrDiagnose(b, async () => { const f = await focusedTab(); return f.id === `cashflow-tab-${id}` && f.shown.length === 1 && f.shown[0] === `cashflow-panel-${id}`; }, { timeout: 3000, timeoutMsg: `${key} selects ${id}`, extra: focusedTab });
    });
  }
  await waitUntilOrDiagnose(b, async () => (await b.execute(() => document.querySelector("#cashflow-panel-last-year").innerText)).includes("Last year"), { timeout: 10000, timeoutMsg: "opening Compared with last year loads last year's figures" });
  await (await b.$("#cashflow-tab-forecast")).click();

  // ---- Layout and screenshots: three styles, light and dark, 1440 and 720.
  for (const [style, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await b.setWindowSize(1440, 1000);
    await chooseStyle(b, style, palette);
    for (const theme of ["light", "dark"]) {
      await b.setWindowSize(1440, 1000);
      await b.execute(t => [...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find(el => el.textContent.trim().toLowerCase() === t).click(), theme);
      await waitUntilOrDiagnose(b, () => b.execute(t => document.documentElement.dataset.theme === t, theme), { timeoutMsg: `apply ${theme}` });
      await (await b.$('.nav-item[aria-label="Cash Flow"]')).click();
      await waitUntilOrDiagnose(b, async () => (await readCard())?.labels.length === 6, { timeout: 10000, timeoutMsg: `${style} ${theme}: six-month card loaded` });
      await dismissStatusMessages(b);
      await b.executeAsync(done => document.fonts.ready.then(() => done()));
      for (const width of [1440, 720]) {
        await b.setWindowSize(width, width === 720 ? 900 : 1000);
        await waitUntilOrDiagnose(b, async () => (await layoutIssues()).length === 0, { timeout: 5000, timeoutMsg: `${style} ${theme} ${width}px layout`, extra: layoutIssues });
        await b.execute(() => document.querySelector(".main").scrollTo(0, 0));
        await b.saveScreenshot(path.join(shots, `cashflow-${palette}-${theme}-${width}.png`));
        if (palette !== "transparent") continue;
        // Every other tab, in the default style: it opens, fits the window and is captured.
        for (const id of ["by-month", "one-month", "last-year", "debt"]) {
          await (await b.$(`#cashflow-tab-${id}`)).click();
          await (await b.$(`#cashflow-panel-${id}`)).waitForDisplayed({ timeout: 5000 });
          await waitUntilOrDiagnose(b, () => b.execute(() => !document.querySelector('[role="tabpanel"]:not([hidden]) .empty-state')?.textContent.includes("Loading")), { timeout: 10000, timeoutMsg: `${id} finished loading` });
          await waitUntilOrDiagnose(b, () => b.execute(() => document.querySelector(".main").scrollWidth <= document.querySelector(".main").clientWidth + 1), { timeout: 5000, timeoutMsg: `${id} fits ${width}px without sideways scrolling` });
          await b.execute(() => document.querySelector('[role="tablist"][aria-label="Cash Flow sections"]').scrollIntoView({ block: "start" }));
          await b.saveScreenshot(path.join(shots, `cashflow-tab-${id}-${theme}-${width}.png`));
        }
        await (await b.$("#cashflow-tab-forecast")).click();
      }
    }
  }

  // ---- Hide amounts: every figure on the card masked.
  await b.setWindowSize(1440, 1000);
  await (await b.$("[data-privacy-toggle]")).click();
  await waitUntilOrDiagnose(b, () => b.execute(() => !/\$\s?[\d,]+/.test(document.querySelector("[data-cashflow-six-months]").textContent)), { timeout: 5000, timeoutMsg: "six-month figures are masked" });
  await b.saveScreenshot(path.join(shots, "cashflow-hidden-amounts.png"));
  await (await b.$("[data-privacy-toggle]")).click();

  console.log(`screenshots: ${shots}`);
  console.log("FEATURE 388 PASSED: six months at a glance matches Month by month (split Transfer line recorded), folds past five categories, keeps a refund-only month, lays out cleanly in three styles, light and dark, at 1440 and 720, hides amounts; Cash Flow tabs work from the keyboard.");
} finally { await app.close(); }
