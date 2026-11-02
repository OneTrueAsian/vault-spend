// UAT-119: Cash Flow "Compare to last year" bars. Last month (relative to today): income 800, expense 880 -> net -80. The same month a year earlier: income 500, expense 200 -> net 300.
// BarChart draws net cash flow per pair; the tooltip names "This year" and "Last year" with the nets. Bars are hover-only (charts.tsx hit rect has no keyboard handler): not asserted as focusable.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose, withFocusRetry } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today=datetime.date.today()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Checking','checking','5000.00')")
account=cur.lastrowid
def month(back):
    index=today.year*12+today.month-1-back
    y,m=divmod(index,12)
    return y,m+1
def add(back,day,description,amount,category):
    y,m=month(back)
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,'user',?)",(account,datetime.date(y,m,day).isoformat(),description,amount,category,description))
add(1,10,'QA Pay now','800.00','Salary')
add(1,12,'QA Spend now','-880.00','Groceries')
add(13,10,'QA Pay then','500.00','Salary')
add(13,12,'QA Spend then','-200.00','Groceries')
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const short = back => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() - back, 1).toLocaleDateString("en-US", { month: "short" }); };
const hover = title => b.execute(titleText => {
  const c = [...document.querySelectorAll(".card")].find(x => [...x.querySelectorAll(".reports-section-title")].some(h => h.textContent === titleText));
  return c.querySelectorAll('svg rect[fill="transparent"]').length;
}, title);
const tooltips = async title => {
  const count = await hover(title);
  const out = {};
  for (let i = 0; i < count; i++) {
    const hit = (await b.$$(`//div[contains(@class,"card")][.//span[text()="${title}"]]//*[local-name()="svg"]//*[local-name()="rect"][@fill="transparent"]`))[i];
    // mouseenter stops firing when another window takes OS focus, so retry only when focus was really lost.
    await withFocusRetry(b, async () => {
      await hit.moveTo();
      await waitUntilOrDiagnose(b, async () => await b.execute(t => !![...document.querySelectorAll(".card")].find(x => [...x.querySelectorAll(".reports-section-title")].some(h => h.textContent === t)).querySelector(".chart-tooltip-title"), title), { timeout: 5000, timeoutMsg: `tooltip for group ${i}` });
    });
    const { heading, lines } = await b.execute(t => {
      const c = [...document.querySelectorAll(".card")].find(x => [...x.querySelectorAll(".reports-section-title")].some(h => h.textContent === t));
      return { heading: c.querySelector(".chart-tooltip-title")?.textContent ?? null, lines: [...c.querySelectorAll(".chart-tooltip-text")].map(x => x.textContent) };
    }, title);
    out[heading ?? `#${i}`] = lines;
  }
  return out;
};
try {
  await b.setWindowSize(1280, 900);
  await (await b.$('.nav-item[aria-label="Cash Flow"]')).click();
  await (await b.$("//label[contains(.,'Compare to last year')]/input")).waitForDisplayed({ timeout: 10000 });
  await (await b.$("//label[contains(.,'Compare to last year')]/input")).click();
  await waitUntilOrDiagnose(b, async () => (await b.execute(() => document.body.innerText)).includes("Net cash flow — this year vs. last year"), { timeout: 10000, timeoutMsg: "the comparison chart replaces Income vs. expenses" });
  // The legend appears once the year-over-year figures arrive, a moment after the heading.
  await waitUntilOrDiagnose(b, async () => { const t = await b.execute(() => document.body.innerText); return t.includes("This year") && t.includes("Last year"); }, { timeout: 10000, timeoutMsg: "legend names both years" });
  const text = await b.execute(() => document.body.innerText);
  const bars = await tooltips("Net cash flow — this year vs. last year");
  const pair = Object.entries(bars).find(([k]) => k.startsWith(short(1)))?.[1];
  assert.deepEqual(pair, ["This year: -$80", "Last year: $300"], JSON.stringify(bars));
  console.log("FEATURE 334 PASSED: Compare to last year pairs the same month's net cash flow (-80 now, 300 a year earlier) from independent transactions.");
} finally { await app.close(); }
