// VS-45: the Cash Flow forecast reaches 6 and 12 months. Everyday spending is carried for the first 90 days only; after
// that only Recurring bills and paychecks move the line, and the note under the chart says so.
// History as in feature331: -100 (20 days ago) and -200 (10 days ago) = -15.00 a day; cash 1000 - 300 = 700.
// One yearly bill of 1,000.00 is due in 200 days. Day 90: 700 - 1350 = -650.00, then flat until the bill: -1,650.00.
// 6 months ends before day 200, so its lowest is -650.00 on day 90; 12 months reaches the bill.
// Run with: node e2e/feature427_forecast_twelve_months.mjs [--keep-screens]
import assert from "node:assert/strict";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose, chooseStyle, dismissStatusMessages } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
import datetime
today=datetime.date.today()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Checking','checking','1000.00')")
acct=cur.lastrowid
for days_ago,amount in [(20,'-100.00'),(10,'-200.00')]:
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,'Groceries','user',?)",(acct,(today-datetime.timedelta(days=days_ago)).isoformat(),f'QA Everyday {days_ago}',amount,f'everyday{days_ago}'))
cur.execute("INSERT INTO recurring(merchant,category,amount,cadence,anchor_date,account_id) VALUES('QA Yearly Insurance',NULL,'-1000.00','annual',?,?)",((today+datetime.timedelta(days=200)).isoformat(),acct))
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const shots = makeTempDir("vaultspend-vs45-shots-");
const display = offset => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  const text = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.getFullYear() === new Date().getFullYear() ? text : `${text}, ${d.getFullYear()}`;
};
const read = () => b.execute(() => {
  const card = document.querySelector("[data-forecast-lowest]")?.closest(".card");
  // The x-axis date labels the chart drew, with their boxes, to check they are few enough not to collide.
  const labels = [...(card?.querySelectorAll("svg text") ?? [])].filter(t => /^[A-Z][a-z]{2} \d{1,2}$/.test(t.textContent.trim()))
    .map(t => { const r = t.getBoundingClientRect(); return { text: t.textContent.trim(), left: r.left, right: r.right }; });
  return {
    buttons: [...(card?.querySelectorAll(".tab-btn") ?? [])].map(x => x.textContent.trim()),
    lowest: document.querySelector("[data-forecast-lowest]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    hint: card?.querySelector(".chart-hint")?.textContent ?? "",
    labels,
    cardOverflows: card ? card.scrollWidth > card.clientWidth + 1 : null,
  };
});
const clickTab = label => b.execute(l => [...document.querySelectorAll(".tab-btn")].find(x => x.textContent.trim() === l).click(), label);
const waitLowest = async (lowest, what) => {
  try { await waitUntilOrDiagnose(b, async () => (await read()).lowest === lowest, { timeout: 10000, timeoutMsg: `${what}: ${lowest}` }); }
  catch (error) { error.message += " ACTUAL " + JSON.stringify(await read()); throw error; }
};
const NOTE = "After 90 days, only your Recurring bills and paychecks move the line, because everyday spending can't be guessed that far ahead.";

try {
  await b.setWindowSize(1280, 900);
  for (const [style, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await chooseStyle(b, style, palette);
    await (await b.$('.nav-item[aria-label="Cash Flow"]')).click();
    await (await b.$("#cashflow-tab-forecast")).waitForDisplayed({ timeout: 10000 });
    await (await b.$("#cashflow-tab-forecast")).click();
    await (await b.$("[data-forecast-lowest]")).waitForExist({ timeout: 10000 });
    assert.deepEqual((await read()).buttons, ["30 days", "60 days", "90 days", "6 months", "12 months"], `${style}: the forecast lengths`);

    await clickTab("90 days");
    await waitLowest(`Lowest balance: -$650.00 on ${display(90)}`, `${style} 90 days`);
    assert.ok(!(await read()).hint.includes("After 90 days"), `${style}: a 90-day forecast has no note about later days`);

    await clickTab("6 months");
    await waitLowest(`Lowest balance: -$650.00 on ${display(90)}`, `${style} 6 months: flat after day 90, bill not reached yet`);
    assert.ok((await read()).hint.includes(NOTE), `${style}: the 6-month note`);

    await clickTab("12 months");
    await waitLowest(`Lowest balance: -$1,650.00 on ${display(200)}`, `${style} 12 months: the yearly bill lands on its date`);
    const twelve = await read();
    assert.ok(twelve.hint.includes(NOTE), `${style}: the 12-month note`);
    assert.ok(twelve.labels.length >= 4 && twelve.labels.length <= 9, `${style}: a handful of date labels: ${JSON.stringify(twelve.labels)}`);
    for (let i = 1; i < twelve.labels.length; i++) {
      assert.ok(twelve.labels[i].left >= twelve.labels[i - 1].right, `${style}: date labels do not overlap: ${JSON.stringify(twelve.labels)}`);
    }
    assert.equal(twelve.cardOverflows, false, `${style}: the forecast card does not scroll sideways`);
    await dismissStatusMessages(b);
    await b.execute(() => document.querySelector("[data-forecast-lowest]")?.closest(".card")?.scrollIntoView({ block: "start" }));
    await b.executeAsync(done => document.fonts.ready.then(() => requestAnimationFrame(() => done(true))));
    await b.saveScreenshot(path.join(shots, `${palette}-forecast-12-months.png`));
    await clickTab("30 days");
  }
  console.log(`FEATURE 427 PASSED: 6- and 12-month forecasts carry everyday spending for 90 days only, land a yearly bill on its date and say so, in Default, Futuristic and Retro. Screenshots: ${shots}`);
} finally { await app.close(); }
