// VS-31 step 2 (R): Reports' tabs, and Save as PDF containing every section from a fresh page load.
// Fixture: six months of income and spending with seven categories (one with a very long name), two household members (one
// with a very long name), tags, and a 12-month-old year boundary kept out of the default range.
//   1. From a fresh load only the first tab has been opened; Save as PDF writes a real PDF and every section's own text is in it.
//   2. Each tab, at 1440px and 720px, light and dark: nothing clipped, cut off, split mid-word, spilling out of its card or
//      scrolling the page sideways (the table, the heatmap and the flow chart scroll inside their own frames on purpose).
//   3. Three styles, the keyboard, Hide amounts, an empty profile.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle, dismissStatusMessages, reclaimWindowFocus, withFocusRetry, waitUntilOrDiagnose, stubSaveDialog } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";
import { openReportsTab } from "./lib/reportsTabs.mjs";
import { pdfPages } from "./lib/pdfText.mjs";

const LONG_MEMBER = "Alexandria Montgomery-Wellington";
const LONG_CATEGORY = "Kids' after-school activities and sports camps";
const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
def day(back, d):
    index = today.year * 12 + today.month - 1 - back
    y, m = divmod(index, 12)
    return datetime.date(y, m + 1, min(d, 28) if back else min(d, max(today.day, 1))).isoformat()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('R Checking','checking','9000.00')")
acct = cur.lastrowid
cur.execute("INSERT INTO family_members(name) VALUES(?)", ("${LONG_MEMBER}",))
alex = cur.lastrowid
cur.execute("INSERT INTO family_members(name) VALUES('Sam')")
sam = cur.lastrowid
cur.execute("UPDATE accounts SET member_id=? WHERE id=?", (alex, acct))
n = 0
def add(back, d, description, amount, category, member=None, tag=None):
    global n
    n += 1
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,member_id,fingerprint) VALUES(?,?,?,?,?,'user',?,?)", (acct, day(back, d), description, amount, category, member, f"r-{n}"))
    if tag:
        cur.execute("INSERT INTO transaction_tags(transaction_id,tag) VALUES(?,?)", (cur.lastrowid, tag))
for back in range(0, 6):
    add(back, 1, 'R Pay', '4200.00', 'Salary')
    add(back, 1, 'R Rent', '-1650.00', 'Rent')
    add(back, 3, 'R Grocer', '-380.00', 'Groceries', member=alex)
    add(back, 4, 'R Dinner', '-140.00', 'Dining Out', member=sam, tag='Holiday trip' if back == 1 else None)
    add(back, 5, 'R Power', '-135.00', 'Utilities')
    add(back, 6, 'R Camp', '-120.00', "${LONG_CATEGORY}", member=sam)
add(3, 9, 'R Garage', '-1240.00', 'Car upkeep')
add(2, 9, 'R Cinema', '-60.00', 'Entertainment')
`);

const shots = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature410-");
fs.mkdirSync(shots, { recursive: true });
const app = await launchApp({ dbDir });
const b = app.browser;
const TABS = ["income", "categories", "daily", "people", "savings", "years", "comparisons"];
const squash = (text) => text.replace(/\s+/g, "");

// Real geometry for the panel that is showing: no page-level sideways scroll, nothing clipped or cut off, no word split
// across lines, no text outside its card. The table, the heatmap and the flow chart scroll inside their own frame on purpose
// (a frame must itself stay inside its card); the flow chart's own "…" labels are a design decision (feature89 checks them).
const layoutIssues = (id) => b.execute((tabId) => {
  const issues = [];
  const main = document.querySelector(".main");
  if (main.scrollWidth > main.clientWidth + 1) issues.push({ kind: "main scrolls sideways", scrollWidth: main.scrollWidth, clientWidth: main.clientWidth });
  if (document.documentElement.scrollWidth > innerWidth + 1) issues.push({ kind: "page scrolls sideways" });
  const panel = document.getElementById(`reports-panel-${tabId}`);
  const mainBox = main.getBoundingClientRect();
  const frame = (el) => el.closest(".table-scroll, .report-table-scroll, [role='region'][tabindex]");
  const textRect = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
  const splitWords = (el) => {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const m of node.textContent.matchAll(/[^\s-]+/g)) {
        const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
        if (new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1) out.push(m[0]);
      }
    }
    return out;
  };
  // The tab strip: every tab name whole and fully inside its button, the strip inside the page.
  const strip = document.querySelector('[role="tablist"][aria-label="Report sections"]');
  if (strip.getBoundingClientRect().right > mainBox.right + 0.5) issues.push({ kind: "tab strip wider than the page" });
  for (const tab of strip.querySelectorAll('[role="tab"]')) {
    if (tab.scrollWidth > tab.clientWidth + 1) issues.push({ kind: "tab name clipped", text: tab.textContent });
    const words = splitWords(tab);
    if (words.length) issues.push({ kind: "tab name split across lines", text: tab.textContent, words });
    const r = tab.getBoundingClientRect();
    if (r.right > mainBox.right + 0.5 || r.left < mainBox.left - 0.5) issues.push({ kind: "tab outside the page", text: tab.textContent });
  }
  // Above-the-tabs controls (range picker, buttons, summary strip).
  const controls = document.querySelector("[data-reports-controls]");
  // Comparisons is its own page with its own layout spec (feature147); here only the tab strip and the page edge are checked for it.
  const scopes = tabId === "comparisons" ? [] : [...(controls && !controls.hidden ? [controls] : []), panel];
  for (const scope of scopes) {
    for (const el of scope.querySelectorAll("*")) {
      if (el.closest("svg")) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own.length) continue;
      if (el.closest(".sr-only")) continue;
      const box = (el.closest(".card, .stat, .view-toggle, .page-actions") ?? scope).getBoundingClientRect();
      const r = textRect(el);
      const owner = frame(el);
      const label = (el.textContent ?? "").trim().slice(0, 40);
      if (!owner && r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5)) issues.push({ kind: "text outside its card", text: label });
      if (!owner && r.width > 0 && r.right > mainBox.right + 0.5) issues.push({ kind: "text outside the page", text: label });
      const cs = getComputedStyle(el);
      if (!owner && cs.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1) issues.push({ kind: "text clipped", text: label, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      if (!owner && cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth) issues.push({ kind: "text cut with an ellipsis", text: label });
      if (!owner) { const words = splitWords(el); if (words.length) issues.push({ kind: "word split across lines", text: label, words }); }
    }
  }
  // A scroll frame must itself stay inside its card.
  for (const f of panel.querySelectorAll(".table-scroll, .report-table-scroll")) {
    const card = f.closest(".card");
    if (card && f.getBoundingClientRect().right > card.getBoundingClientRect().right + 0.5) issues.push({ kind: "scroll frame wider than its card" });
  }
  // Flow chart labels: fully inside the drawing (the shortened "…" labels are intended).
  const svg = panel.querySelector("[data-report-sankey] svg");
  if (svg) {
    const box = svg.getBoundingClientRect();
    for (const t of svg.querySelectorAll("text")) {
      const r = t.getBoundingClientRect();
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5) issues.push({ kind: "flow chart label cut off", text: t.textContent.replace(/\s+/g, " ").trim() });
    }
  }
  return issues;
}, id);

const waitLoaded = (id) => waitUntilOrDiagnose(b, () => b.execute((tabId) => { const p = document.getElementById(`reports-panel-${tabId}`); return !!p && !p.hidden && !/Loading…/.test(p.textContent) && !!document.querySelector("[data-report-summary]"); }, id), { timeout: 15000, timeoutMsg: `${id} loaded` });
const setTheme = async (theme) => {
  await b.execute((t) => [...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find((el) => el.textContent.trim().toLowerCase() === t).click(), theme);
  await waitUntilOrDiagnose(b, () => b.execute((t) => document.documentElement.dataset.theme === t, theme), { timeoutMsg: `apply ${theme}` });
};

try {
  await b.setWindowSize(1440, 1000);
  await (await b.$('.nav-item[aria-label="Reports"]')).click();
  await b.$("[data-reports-hub]").waitForExist({ timeout: 15000 });
  await waitLoaded("income");

  // ---- 1. Save as PDF from a fresh load: only the first tab has ever been opened.
  assert.equal(await b.execute(() => document.querySelectorAll("[data-report-heatmap], [data-report-years], [data-report-members], [data-report-savings], [data-report-table]").length), 0, "the other tabs' sections are not on the page yet");
  const pdf = path.join(shots, "report-saved-fresh-load.pdf");
  fs.rmSync(pdf, { force: true });
  await stubSaveDialog(b, [pdf]);
  await (await b.$(".page-actions")).$("button=Save as PDF").click();
  let last = -1;
  await waitUntilOrDiagnose(b, async () => { if (!fs.existsSync(pdf)) return false; const size = fs.statSync(pdf).size; const settled = size > 0 && size === last; last = size; return settled; }, { timeout: 60000, timeoutMsg: "the PDF was written" });
  const pages = pdfPages(fs.readFileSync(pdf));
  const text = squash(pages.join("\n"));
  // Each section's own text (not the tab names, which are not printed).
  const sections = {
    "Income → spending (flow chart)": ["Income→spending", "Leftover"],
    "Categories by month": ["Wherethemoneywent,bycategoryandmonth", "Total"],
    "Daily spending": ["Dailyspending", "Hoveroveraday,orpressTab"],
    "Tags and people": ["Spendingbymember", "Spendingbytag", "Holidaytrip", "NetWorthbyMember", "Sam"],
    "Savings rate": ["Savingsratetrend", "(Income−expenses)÷income"],
    "Year by year": ["Yearbyyear"],
  };
  for (const [name, needles] of Object.entries(sections)) for (const needle of needles) assert.ok(text.includes(squash(needle)), `the PDF holds ${name}: "${needle}" (page text: ${text.slice(0, 300)})`);
  assert.ok(text.includes("$25,200.00"), "the flow chart's income figure ($4,200 x 6) is in the PDF");
  assert.equal(text.includes("PintoDashboard"), false, "the Pin to Dashboard button is not printed");
  assert.equal(text.includes("Whereincomewent"), false, "the tab names are not printed");
  console.log(`saved PDF holds every section from a fresh load (${path.basename(pdf)}, ${fs.statSync(pdf).size} bytes)`);
  await waitUntilOrDiagnose(b, () => b.execute(() => document.querySelectorAll(".reports-print-all").length === 0), { timeout: 5000, timeoutMsg: "the print-only copy of the sections is gone after saving" });
  assert.equal(await b.execute(() => document.querySelectorAll("[data-report-heatmap]").length), 0, "saving did not leave other tabs mounted");
  await dismissStatusMessages(b);

  // A twelve-month range makes the category table's widest print (thirteen figure columns): saved again, every section still in it.
  const rangeBefore = await (await b.$("[data-reports-hub]")).getAttribute("data-report-range");
  await (await b.$("[data-range-preset='last_12']")).click();
  await waitUntilOrDiagnose(b, () => b.execute((before) => document.querySelector("[data-reports-hub]").getAttribute("data-report-range") !== before && !!document.querySelector("[data-report-summary]") && document.querySelectorAll("[data-report-sankey] .sr-only tbody tr").length > 0, rangeBefore), { timeout: 15000, timeoutMsg: "twelve months loaded" });
  const pdf12 = path.join(shots, "report-saved-12-months.pdf");
  fs.rmSync(pdf12, { force: true });
  await stubSaveDialog(b, [pdf12]);
  await (await b.$(".page-actions")).$("button=Save as PDF").click();
  let last12 = -1;
  await waitUntilOrDiagnose(b, async () => { if (!fs.existsSync(pdf12)) return false; const size = fs.statSync(pdf12).size; const settled = size > 0 && size === last12; last12 = size; return settled; }, { timeout: 60000, timeoutMsg: "the twelve-month PDF was written" });
  const text12 = squash(pdfPages(fs.readFileSync(pdf12)).join("\n"));
  // The table's small print comes out as separate glyph runs, so its figures are checked by eye (evidence folder), not by text.
  assert.ok(text12.includes("Wherethemoneywent,bycategoryandmonth") && text12.includes("$9,350.00") && text12.includes("Yearbyyear"), "the twelve-month PDF holds every section");
  await (await b.$("[data-range-preset='last_6']")).click();
  await dismissStatusMessages(b);

  // ---- 2. Tabs from the keyboard: arrows move and wrap, Home and End jump, the panel follows.
  const focusedTab = () => b.execute(() => ({ id: document.activeElement?.id, shown: [...document.querySelectorAll('[role="tabpanel"][id^="reports-panel-"]')].filter((p) => !p.hidden).map((p) => p.id) }));
  for (const [key, id] of [["ArrowLeft", "comparisons"], ["ArrowRight", "income"], ["End", "comparisons"], ["Home", "income"], ["ArrowRight", "categories"], ["ArrowRight", "daily"]]) {
    await withFocusRetry(b, async () => {
      await reclaimWindowFocus(b);
      await b.execute(() => document.querySelector('[role="tablist"][aria-label="Report sections"] [aria-selected="true"]').focus());
      await b.keys(key);
      await waitUntilOrDiagnose(b, async () => { const f = await focusedTab(); return f.id === `reports-tab-${id}` && f.shown.length === 1 && f.shown[0] === `reports-panel-${id}`; }, { timeout: 3000, timeoutMsg: `${key} selects ${id}`, extra: focusedTab });
    });
  }
  // The range picker, summary and buttons stay with the report tabs and step aside for Comparisons.
  await openReportsTab(b, "comparisons");
  assert.equal(await (await b.$("[data-reports-controls]")).isDisplayed(), false, "the report's controls are hidden on Comparisons");
  await openReportsTab(b, "income");
  assert.equal(await (await b.$("[data-reports-controls]")).isDisplayed(), true);

  // ---- 3. Layout and screenshots: every tab, 1440 and 720, light and dark.
  for (const theme of ["light", "dark"]) {
    await b.setWindowSize(1440, 1000);
    await setTheme(theme);
    await dismissStatusMessages(b);
    for (const width of [1440, 720]) {
      await b.setWindowSize(width, width === 720 ? 900 : 1000);
      for (const id of TABS) {
        await openReportsTab(b, id);
        await waitLoaded(id);
        await b.executeAsync((done) => document.fonts.ready.then(() => done()));
        if (id === "daily") await waitUntilOrDiagnose(b, () => b.execute(() => !!document.querySelector("[data-heatmap-day]")), { timeout: 10000, timeoutMsg: "heatmap drawn" });
        await waitUntilOrDiagnose(b, async () => (await layoutIssues(id)).length === 0, { timeout: 5000, timeoutMsg: `${id} ${theme} ${width}px layout`, extra: () => layoutIssues(id) });
        await b.execute(() => document.querySelector(".main").scrollTo(0, 0));
        await b.saveScreenshot(path.join(shots, `reports-${id}-${theme}-${width}.png`));
      }
    }
  }

  // ---- 4. The other two styles: every tab's layout (screenshots of the first tab and the busiest ones).
  for (const [style, palette] of [["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await b.setWindowSize(1440, 1000);
    await chooseStyle(b, style, palette); // leaves the app on Settings
    await (await b.$('.nav-item[aria-label="Reports"]')).click();
    await b.$("[data-reports-hub]").waitForExist({ timeout: 15000 });
    for (const theme of ["light", "dark"]) {
      await setTheme(theme);
      for (const width of [1440, 720]) {
        await b.setWindowSize(width, width === 720 ? 900 : 1000);
        for (const id of TABS) {
          await openReportsTab(b, id);
          await waitLoaded(id);
          await waitUntilOrDiagnose(b, async () => (await layoutIssues(id)).length === 0, { timeout: 5000, timeoutMsg: `${style} ${id} ${theme} ${width}px layout`, extra: () => layoutIssues(id) });
          if (["income", "people"].includes(id)) { await b.execute(() => document.querySelector(".main").scrollTo(0, 0)); await b.saveScreenshot(path.join(shots, `reports-${palette}-${id}-${theme}-${width}.png`)); }
        }
      }
    }
  }
  await chooseStyle(b, "Default", "transparent");
  await (await b.$('.nav-item[aria-label="Reports"]')).click();
  await b.$("[data-reports-hub]").waitForExist({ timeout: 15000 });
  await setTheme("light");
  await b.setWindowSize(1440, 1000);

  // ---- 5. Hide amounts: every figure on the report masked, wherever the tab.
  await (await b.$("[data-privacy-toggle]")).click();
  for (const id of ["income", "categories", "daily", "people", "years"]) {
    await openReportsTab(b, id);
    await waitUntilOrDiagnose(b, () => b.execute((tabId) => { const p = document.getElementById(`reports-panel-${tabId}`); return !/\$\s?[\d,]+/.test(p.textContent); }, id), { timeout: 5000, timeoutMsg: `${id}: figures are masked` });
  }
  await waitUntilOrDiagnose(b, () => b.execute(() => !/\$\s?[\d,]+/.test(document.querySelector("[data-report-summary]").textContent)), { timeout: 5000, timeoutMsg: "summary masked" });
  await openReportsTab(b, "income");
  await b.saveScreenshot(path.join(shots, "reports-hidden-amounts.png"));
  await (await b.$("[data-privacy-toggle]")).click();

  console.log(`screenshots: ${shots}`);
  console.log("FEATURE 410 PASSED: Save as PDF from a fresh load holds every section; every Reports tab lays out cleanly at 1440 and 720, light and dark, in three styles; tabs work from the keyboard; Hide amounts masks every tab.");
} finally { await app.close(); }

// ---- 6. An empty profile: every tab says so in words.
const emptyDir = await seedFixture("pass");
const emptyApp = await launchApp({ dbDir: emptyDir });
try {
  const e = emptyApp.browser;
  await e.setWindowSize(1440, 1000);
  await (await e.$('.nav-item[aria-label="Reports"]')).click();
  await e.$("[data-reports-hub]").waitForExist({ timeout: 15000 });
  const expectText = { income: "No income or spending in this range.", categories: "No spending in this range.", daily: "No spending in this range.", people: "No tags used in this range", savings: "No transactions yet, so there is no savings rate to show.", years: "$0.00" };
  for (const [id, words] of Object.entries(expectText)) {
    await openReportsTab(e, id);
    await waitUntilOrDiagnose(e, () => e.execute((tabId, w) => document.getElementById(`reports-panel-${tabId}`).textContent.includes(w), id, words), { timeout: 10000, timeoutMsg: `${id} says "${words}"` });
  }
  console.log("empty profile: every tab says so in words");
} finally { await emptyApp.close(); }
