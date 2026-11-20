// VS-31 step 2 (H): Household's "Spending by person" stacked chart, and Budget by person without the Income row.
// Fixture (this month): Alex (a long name with a hyphen) earned 3000 and spent Rent 1650 + Car repair 400 (a one-off, 20%+ of spending) + Groceries 250;
// Sam spent Groceries 90 + Dining Out 45 and earned nothing; 60 of Gas has no person (Shared); the fourth member has one unbroken 39-letter name and nothing yet.
// Budgets: Groceries 400 (flexible), Rent 1650 (fixed), Salary 3000 (income): Budget by person must not list Salary.
// Checks: the chart's rows, totals and one-off note; real geometry at 1440px and 720px, light and dark, in all three styles
// (nothing clipped, cut off, split mid-word, over a bar, outside its card, or scrolling the page sideways); Hide amounts; no people.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle, dismissStatusMessages, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const LONG = "Alexandria Montgomery-Wellington";
const UNBROKEN = "Maximilianalexanderwolfgangschmidtbauer";
const BANK_STYLE = "POS DEBIT 0412 H MARKET SUPERCENTER #1234 SPRINGFIELD IL USA";
const BANK_UNBROKEN = "AMZNMKTPLACEAMZNCOMBILLWA1234567890";
const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
def day(d):
    return datetime.date(today.year, today.month, min(d, today.day)).isoformat()
def last(d):
    index = today.year * 12 + today.month - 2
    y, m = divmod(index, 12)
    return datetime.date(y, m + 1, d).isoformat()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('H Checking','checking','5000.00')")
acct = cur.lastrowid
ids = {}
for name in ("${LONG}", "Sam", "${UNBROKEN}"):
    cur.execute("INSERT INTO family_members(name) VALUES(?)", (name,))
    ids[name] = cur.lastrowid
n = 0
def add(day_iso, description, amount, category, member):
    global n
    n += 1
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,member_id,fingerprint) VALUES(?,?,?,?,?,'user',?,?)", (acct, day_iso, description, amount, category, member, f"h-{n}"))
alex = ids["${LONG}"]; sam = ids["Sam"]
add(day(1), 'H Pay', '3000.00', 'Salary', alex)
add(day(1), 'H Rent', '-1650.00', 'Rent', alex)
add(last(1), 'H Rent', '-1650.00', 'Rent', alex)
add(day(2), 'H Car repair', '-400.00', 'Car upkeep', alex)
add(day(3), 'H Grocer', '-250.00', 'Groceries', alex)
add(day(3), '${BANK_STYLE}', '-90.00', 'Groceries', sam)
add(day(4), 'H Dinner', '-45.00', 'Dining Out', sam)
add(day(4), '${BANK_UNBROKEN}', '-60.00', 'Gas', None)
period = today.strftime('%Y-%m')
for category, amount, group in [('Groceries', '400.00', 'flexible'), ('Rent', '1650.00', 'fixed'), ('Salary', '3000.00', 'income')]:
    cur.execute("INSERT INTO budgets(category,period,monthly_amount,budget_group) VALUES(?,?,?,?)", (category, period, amount, group))
`);

const shots = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature411-");
fs.mkdirSync(shots, { recursive: true });
const app = await launchApp({ dbDir });
const b = app.browser;

const readChart = () => b.execute(() => {
  const card = [...document.querySelectorAll(".card")].find((c) => c.querySelector("h2")?.textContent === "Spending by person");
  if (!card) return null;
  return {
    sub: card.querySelector(".modal-message-secondary")?.textContent,
    rows: [...card.querySelectorAll(".stacked-rows-row")].map((r) => [r.querySelector(".stacked-rows-label").textContent, r.querySelector(".stacked-rows-total").textContent, r.querySelectorAll(".stacked-rows-tick").length]),
    legend: [...card.querySelectorAll(".stacked-rows-legend li")].map((e) => e.textContent),
    notes: [...card.querySelectorAll("[data-spending-note]")].map((e) => e.textContent),
    hidden: [...card.querySelectorAll(".sr-only tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent)),
    text: card.innerText,
  };
});

// Real geometry for the chart card and the page: nothing clipped or cut off, no word split across lines (a break after a hyphen is
// normal wrapping), no text over a bar or outside the card, no page-level sideways scroll.
const layoutIssues = () => b.execute(() => {
  const issues = [];
  const main = document.querySelector(".main");
  if (main.scrollWidth > main.clientWidth + 1) issues.push({ kind: "main scrolls sideways", scrollWidth: main.scrollWidth, clientWidth: main.clientWidth });
  if (document.documentElement.scrollWidth > innerWidth + 1) issues.push({ kind: "page scrolls sideways" });
  const card = [...document.querySelectorAll(".card")].find((c) => c.querySelector("h2")?.textContent === "Spending by person");
  const box = card.getBoundingClientRect();
  const overlap = (a, c) => a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5;
  const textRect = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
  const splitWords = (el) => {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const m of node.textContent.matchAll(/[^\s-]+/g)) {
        // A name or reference with no break in it (39 letters) cannot fit a line; it may only wrap anywhere, never be cut off.
        if (m[0].length >= 25) continue;
        const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
        if (new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1) out.push(m[0]);
      }
    }
    return out;
  };
  for (const row of card.querySelectorAll(".stacked-rows-row")) {
    const labelEl = row.querySelector(".stacked-rows-label");
    const totalEl = row.querySelector(".stacked-rows-total");
    const label = textRect(labelEl);
    const total = textRect(totalEl);
    const track = row.querySelector(".stacked-rows-track").getBoundingClientRect();
    const name = labelEl.textContent;
    if (overlap(label, track)) issues.push({ kind: "name over its bar", name });
    if (overlap(total, track)) issues.push({ kind: "total over its bar", name });
    if (overlap(label, total)) issues.push({ kind: "name over its total", name });
    if (total.right > box.right + 0.5 || label.left < box.left - 0.5) issues.push({ kind: "text outside the card", name });
    if (track.width < 40) issues.push({ kind: "bar too narrow to read", name, width: track.width });
    for (const el of [labelEl, totalEl]) {
      if (el.scrollWidth > el.clientWidth + 1) issues.push({ kind: "text clipped", name, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
    for (const seg of row.querySelectorAll(".stacked-rows-seg, .stacked-rows-tick")) {
      const s = seg.getBoundingClientRect();
      if (s.right > track.right + 3.5 || s.left < track.left - 1.5) issues.push({ kind: "segment or tick outside its bar", name });
    }
  }
  for (const el of card.querySelectorAll(".stacked-rows-label, .stacked-rows-total, .stacked-rows-legend li, .reports-section-title, .modal-message-secondary, [data-spending-note]")) {
    const words = splitWords(el);
    if (words.length) issues.push({ kind: "word split across lines", text: el.textContent.slice(0, 40), words });
    const r = textRect(el);
    if (r.right > box.right + 0.5 || r.left < box.left - 0.5) issues.push({ kind: "text outside the card", text: el.textContent.slice(0, 40) });
  }
  for (const li of card.querySelectorAll(".stacked-rows-legend li")) {
    if (li.getBoundingClientRect().right > box.right + 0.5) issues.push({ kind: "legend outside the card", text: li.textContent });
  }
  // VS-57: in "<month> by person" a long unbroken name stays in its own cell, never over that row's amounts.
  for (const tr of document.querySelectorAll("[data-month-by-person] tbody tr")) {
    const name = textRect(tr.cells[0]);
    for (const cell of [...tr.cells].slice(1)) {
      if (overlap(name, textRect(cell))) issues.push({ kind: "name over an amount in the month table", name: tr.cells[0].textContent.slice(0, 40) });
    }
    // Only the unbroken 39-letter name may break mid-word; "Montgomery-Wellington" wraps at its hyphen.
    const words = splitWords(tr.cells[0]);
    if (words.length) issues.push({ kind: "word split across lines in the month table", words });
  }
  // VS-61: "Budget by person" scrolled all the way sideways still shows every category name (the column stays put).
  const budgetScroll = document.querySelector("[data-budget-by-person] .household-table-scroll");
  if (budgetScroll && budgetScroll.scrollWidth > budgetScroll.clientWidth + 1) {
    budgetScroll.scrollLeft = budgetScroll.scrollWidth;
    const area = budgetScroll.getBoundingClientRect();
    for (const tr of budgetScroll.querySelectorAll("tbody tr")) {
      const label = textRect(tr.cells[0].querySelector(".cell-with-icon") ?? tr.cells[0]);
      if (label.left < area.left - 0.5 || label.right > area.right + 0.5) issues.push({ kind: "category name scrolled out of Budget by person", category: tr.cells[0].textContent.trim() });
    }
    budgetScroll.scrollLeft = 0;
  }
  return issues;
});

try {
  await b.setWindowSize(1440, 1000);
  await (await b.$('.nav-item[aria-label="Household"]')).click();
  await waitUntilOrDiagnose(b, async () => (await readChart())?.rows.length === 4, { timeout: 15000, timeoutMsg: "the chart shows a row per person plus Shared" });
  await dismissStatusMessages(b);

  // ---- Figures
  const chart = await readChart();
  assert.match(chart.sub, /, by category\. The tick is what each person earned\.$/);
  assert.deepEqual(chart.rows, [[LONG, "$2,300.00", 1], [UNBROKEN, "$0.00", 0], ["Sam", "$135.00", 0], ["Shared", "$60.00", 0]], "one row per person (roster order, by name) then Shared; the tick is only on the person who earned");
  assert.ok(!chart.text.includes("Unassigned"), "the chart says Shared, never Unassigned");
  assert.ok(chart.hidden.some((r) => r[0] === LONG && r[1] === "Rent" && r[2] === "$1,650.00"), JSON.stringify(chart.hidden));
  assert.ok(chart.hidden.some((r) => r[0] === LONG && r[1] === "What they earned" && r[2] === "$3,000.00"));
  assert.deepEqual(chart.legend.slice(0, 3), ["Rent", "Car upkeep", "Groceries"], "colors go by size rank in this chart");
  // Car repair 400 of 2300 is 17%: under a fifth, so no note for Alex; Sam's biggest (Market 90 of 135) and Shared's Fuel are.
  // Rent comes round every month, so it is not a one-off.
  assert.deepEqual(chart.notes, [`Sam's biggest one-off cost: ${BANK_STYLE}, $90.00`, `Shared's biggest one-off cost: ${BANK_UNBROKEN}, $60.00`]);
  // Budget by person lists spending categories only.
  await waitUntilOrDiagnose(b, () => b.execute(() => document.querySelectorAll("[data-budget-by-person] tbody tr").length > 0), { timeout: 15000, timeoutMsg: "the Budget by person card loads" });
  const budgetRows = await b.execute(() => [...document.querySelectorAll("[data-budget-by-person] tbody tr")].map((tr) => tr.cells[0].textContent.trim()));
  assert.deepEqual(budgetRows, ["Groceries", "Rent"], "no Income row in Budget by person");
  // Every figure on the rest of the page is still there.
  const page = await b.execute(() => document.querySelector(".household-view").innerText);
  for (const needle of ["by person", "Net worth by person", "Budget by person,", "Add person", "Rename", "Remove"]) assert.ok(page.includes(needle), `the page still has "${needle}"`);

  // ---- Layout and screenshots: 1440 and 720, light and dark; then the other two styles.
  const setTheme = async (theme) => {
    await b.execute((t) => [...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find((el) => el.textContent.trim().toLowerCase() === t).click(), theme);
    await waitUntilOrDiagnose(b, () => b.execute((t) => document.documentElement.dataset.theme === t, theme), { timeoutMsg: `apply ${theme}` });
  };
  for (const [style, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await b.setWindowSize(1440, 1000);
    await chooseStyle(b, style, palette);
    for (const theme of ["light", "dark"]) {
      await setTheme(theme);
      await (await b.$('.nav-item[aria-label="Household"]')).click();
      await waitUntilOrDiagnose(b, async () => (await readChart())?.rows.length === 4, { timeout: 10000, timeoutMsg: `${style} ${theme}: chart loaded` });
      await dismissStatusMessages(b);
      await b.executeAsync((done) => document.fonts.ready.then(() => done()));
      for (const width of [1440, 720]) {
        await b.setWindowSize(width, width === 720 ? 900 : 1000);
        await waitUntilOrDiagnose(b, async () => (await layoutIssues()).length === 0, { timeout: 5000, timeoutMsg: `${style} ${theme} ${width}px layout`, extra: layoutIssues });
        await b.execute(() => document.querySelector(".main").scrollTo(0, 0));
        await b.saveScreenshot(path.join(shots, `household-chart-${palette}-${theme}-${width}.png`));
        if (palette === "transparent") {
          await b.$("[data-budget-by-person]").scrollIntoView({ block: "start" });
          await b.saveScreenshot(path.join(shots, `household-budget-${palette}-${theme}-${width}.png`));
        }
      }
    }
  }
  await chooseStyle(b, "Default", "transparent"); // leaves the app on Settings
  await setTheme("light");
  await (await b.$('.nav-item[aria-label="Household"]')).click();
  await waitUntilOrDiagnose(b, async () => (await readChart())?.rows.length === 4, { timeout: 10000, timeoutMsg: "chart loaded again" });
  await b.setWindowSize(1440, 1000);

  // ---- Hide amounts: every figure in the chart masked.
  await (await b.$("[data-privacy-toggle]")).click();
  await waitUntilOrDiagnose(b, () => b.execute(() => !/\$\s?[\d,]+/.test(document.querySelector(".household-view").textContent)), { timeout: 5000, timeoutMsg: "Household figures are masked" });
  await b.execute(() => document.querySelector(".main").scrollTo(0, 0));
  await b.saveScreenshot(path.join(shots, "household-chart-hidden-amounts.png"));
  await (await b.$("[data-privacy-toggle]")).click();
  console.log(`screenshots: ${shots}`);
} finally { await app.close(); }

// ---- No people at all: Shared only (with spending), then an empty month.
const soloDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('H Solo','checking','100.00')")
acct = cur.lastrowid
cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,'user',?)", (acct, today.replace(day=1).isoformat(), 'Solo Shop', '-25.00', 'Groceries', 'solo-1'))
`);
const solo = await launchApp({ dbDir: soloDir });
try {
  const s = solo.browser;
  await s.setWindowSize(1440, 1000);
  await (await s.$('.nav-item[aria-label="Household"]')).click();
  await waitUntilOrDiagnose(s, () => s.execute(() => [...document.querySelectorAll(".stacked-rows-label")].map((e) => e.textContent).join() === "Shared"), { timeout: 15000, timeoutMsg: "with no people the chart is just Shared" });
  for (const width of [1440, 720]) {
    await s.setWindowSize(width, 900);
    const overflow = await s.execute(() => document.querySelector(".main").scrollWidth - document.querySelector(".main").clientWidth);
    assert.ok(overflow <= 1, `no sideways scroll with no people at ${width}px`);
    await s.execute(() => document.querySelector(".main").scrollTo(0, 0));
    await s.saveScreenshot(path.join(shots, `household-chart-no-people-${width}.png`));
  }
  await (await s.$("button[aria-label='Previous month']")).click();
  await waitUntilOrDiagnose(s, () => s.execute(() => [...document.querySelectorAll(".card")].some((c) => c.querySelector("h2")?.textContent === "Spending by person" && c.textContent.includes("No spending this month."))), { timeout: 10000, timeoutMsg: "an empty month says so in words" });
  console.log("FEATURE 411 PASSED: Spending by person chart (rows, totals, tick, one-off notes, Shared), Budget by person without Income, layout at 1440 and 720 in three styles light and dark, Hide amounts, no people.");
} finally { await solo.close(); }
