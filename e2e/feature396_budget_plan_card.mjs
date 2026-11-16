// VS-31 step 2 (B): the Budget page's "Spending against the plan" card (it replaces the summary strip).
// Native geometry at 1440, 1180 and 720px in three styles, light and dark: no page-level sideways scroll, no
// clipped or cut-off text, no word split across lines, no text over a bar, every bar and its over-plan part inside
// its track, and the card's income line and money-left note inside the card.
// Fixture, this month (spent in brackets):
//   income: Paycheck planned 5200 (4000 came in)
//   fixed: Rent 1650 (1650), Utilities 140 (135)
//   flexible: Groceries 400 (420, over), Dining Out 150 (90), Car upkeep 100 (1240: 1,240% of its plan),
//     Kids activities and sports camps 120 (60), Entertainment 60 (60)
//   non-monthly: Home maintenance and repairs 200 (0), Gifts 80 (25), Health 90 (45), Subscriptions 30 (30)
// Eleven spending categories, so eight show as bars and three are counted in "3 more categories".
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle, dismissStatusMessages, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
period = today.strftime("%Y-%m")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('B Checking', 'checking', '9000.00')")
acct = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", (period,))
for category, amount, group in [
    ("Paycheck", "5200.00", "income"),
    ("Rent", "1650.00", "fixed"), ("Utilities", "140.00", "fixed"),
    ("Groceries", "400.00", "flexible"), ("Dining Out", "150.00", "flexible"), ("Car upkeep", "100.00", "flexible"),
    ("Kids activities and sports camps", "120.00", "flexible"), ("Entertainment", "60.00", "flexible"),
    ("Home maintenance and repairs", "200.00", "nonmonthly"), ("Gifts", "80.00", "nonmonthly"), ("Health", "90.00", "nonmonthly"), ("Subscriptions", "30.00", "nonmonthly"),
]:
    cur.execute("INSERT OR REPLACE INTO budgets (category, period, monthly_amount, budget_group) VALUES (?, ?, ?, ?)", (category, period, amount, group))
n = 0
for description, amount, category in [
    ("B Pay", "4000.00", "Paycheck"), ("B Landlord", "-1650.00", "Rent"), ("B Power", "-135.00", "Utilities"),
    ("B Grocer", "-420.00", "Groceries"), ("B Dinner", "-90.00", "Dining Out"), ("B Garage", "-1240.00", "Car upkeep"),
    ("B Camp", "-60.00", "Kids activities and sports camps"), ("B Cinema", "-60.00", "Entertainment"),
    ("B Gift shop", "-25.00", "Gifts"), ("B Clinic", "-45.00", "Health"), ("B Stream", "-30.00", "Subscriptions"),
]:
    n += 1
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,'user',?)", (acct, today.replace(day=1).isoformat(), description, amount, category, f"b-{n}"))
`);

const shots = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature396-");
fs.mkdirSync(shots, { recursive: true });
const app = await launchApp({ dbDir });
const b = app.browser;

const readCard = () => b.execute(() => {
  const card = document.querySelector("[data-budget-summary]");
  if (!card) return null;
  return {
    title: card.querySelector(".reports-section-title")?.textContent,
    total: card.querySelector("[data-plan-total]")?.textContent ?? null,
    sub: card.querySelector(".budget-plan-sub")?.textContent,
    rows: [...card.querySelectorAll(".category-bars tr")].map(tr => tr.textContent.replace(/\s+/g, " ").trim()),
    more: card.querySelector("[data-plan-more]")?.textContent ?? null,
    income: card.querySelector("[data-budget-income-line]")?.textContent.replace(/\s+/g, " ").trim() ?? null,
    allocation: card.querySelector("[data-allocation]")?.getAttribute("data-allocation") ?? null,
    plannedNet: card.querySelector("[data-planned-net]")?.textContent ?? null,
    actualNet: card.querySelector("[data-actual-net]")?.textContent ?? null,
    note: card.querySelector("[data-budget-summary-note]")?.textContent.replace(/\s+/g, " ").trim() ?? null,
    text: card.innerText,
  };
});

// Real geometry. Reports every problem as data, so a failure says what and where.
const layoutIssues = () => b.execute(() => {
  const issues = [];
  const main = document.querySelector(".main");
  if (main.scrollWidth > main.clientWidth + 1) issues.push({ kind: "main scrolls sideways", scrollWidth: main.scrollWidth, clientWidth: main.clientWidth });
  if (document.documentElement.scrollWidth > innerWidth + 1) issues.push({ kind: "page scrolls sideways" });
  const overlap = (a, c) => a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5;
  const textRect = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
  const splitWords = el => {
    const out = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest(".sr-only")) continue;
      for (const m of node.textContent.matchAll(/\S+/g)) {
        const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
        if (new Set([...r.getClientRects()].map(x => Math.round(x.top))).size > 1 && !/-$/.test(m[0])) out.push(m[0]);
      }
    }
    return out;
  };
  const visible = el => { const s = getComputedStyle(el); return s.display !== "none" && s.visibility !== "hidden" && !el.closest(".sr-only") && el.getClientRects().length > 0; };
  const card = document.querySelector("[data-budget-summary]");
  if (!card) return [{ kind: "card missing" }];
  const box = card.getBoundingClientRect();
  for (const el of card.querySelectorAll("*")) {
    if (!visible(el) || el.closest("svg")) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && getComputedStyle(el).display !== "inline") issues.push({ kind: "content wider than its box", el: el.className || el.tagName, text: el.textContent.slice(0, 40), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    if (el.children.length === 0 && el.textContent.trim()) {
      const r = textRect(el);
      if (r.right > box.right + 0.5 || r.left < box.left - 0.5) issues.push({ kind: "text outside the card", text: el.textContent.slice(0, 40) });
      const words = splitWords(el);
      if (words.length) issues.push({ kind: "word split across lines", text: el.textContent.slice(0, 60), words });
    }
  }
  for (const tr of card.querySelectorAll(".category-bars tr")) {
    const name = textRect(tr.querySelector(".category-bars-name"));
    const amountText = textRect(tr.querySelector(".category-bars-amount"));
    const noteEl = tr.querySelector(".category-bars-note");
    const note = noteEl ? textRect(noteEl) : null;
    const track = tr.querySelector(".category-bars-track").getBoundingClientRect();
    const label = tr.querySelector(".category-bars-name").textContent;
    if (overlap(name, track)) issues.push({ kind: "name over its bar", label });
    if (overlap(amountText, track)) issues.push({ kind: "amount over its bar", label });
    if (note && overlap(note, track)) issues.push({ kind: "note over its bar", label });
    if (overlap(name, amountText)) issues.push({ kind: "name over its amount", label });
    if (note && overlap(note, amountText)) issues.push({ kind: "note over its amount", label });
    if (track.width < 40) issues.push({ kind: "bar too narrow to read", label, width: track.width });
    for (const part of tr.querySelectorAll(".category-bars-fill, .category-bars-plan, .category-bars-over")) {
      const p = part.getBoundingClientRect();
      if (p.right > track.right + 1 || p.left < track.left - 1) issues.push({ kind: "bar outside its track", label, part: part.className });
    }
  }
  const foot = card.querySelector(".budget-plan-foot");
  if (foot && foot.getBoundingClientRect().bottom > box.bottom + 0.5) issues.push({ kind: "income line outside the card" });
  return issues;
});

const scrollTo = selector => b.execute(sel => document.querySelector(sel).scrollIntoView({ block: "start" }), selector);
const nav = label => b.execute(l => [...document.querySelectorAll("nav button, .nav-item")].find(el => (el.getAttribute("aria-label") ?? el.textContent).trim() === l).click(), label);

try {
  await b.setWindowSize(1440, 1000);
  await nav("Budget");
  await waitUntilOrDiagnose(b, async () => (await readCard())?.rows.length === 8, { timeout: 15000, timeoutMsg: "the plan card shows eight bars", extra: readCard });

  // ---- Figures: every figure the old strip showed is still on the page.
  const c = await readCard();
  assert.equal(c.title, "Spending against the plan");
  // Planned 3,020.00 in all; spent 3,755.00, so 735.00 over.
  const planned = 1650 + 140 + 400 + 150 + 100 + 120 + 60 + 200 + 80 + 90 + 30;
  const spent = 1650 + 135 + 420 + 90 + 1240 + 60 + 60 + 25 + 45 + 30;
  const money = n => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  assert.ok(c.total.includes(`${money(spent)} of ${money(planned)} planned`) && c.total.includes(`${money(spent - planned)} over`), c.total);
  assert.match(c.rows[0], /Car upkeep.*\$1,240\.00 of \$100\.00.*\$1,140\.00 over/, "the biggest overspend is on top");
  assert.match(c.rows[1], /Groceries.*\$420\.00 of \$400\.00.*\$20\.00 over/);
  assert.ok(c.more.startsWith("3 more categories:"), c.more);
  assert.ok(c.income.startsWith("Income so far is $4,000.00 of $5,200.00 planned."), c.income);
  assert.equal(c.allocation, "unallocated");
  assert.ok(c.income.includes(`${money(5200 - planned)} of your planned income isn't given a job yet.`), c.income);
  assert.equal(c.plannedNet, money(5200 - planned));
  assert.ok(c.actualNet && c.note.includes("Not an account balance"), c.note);
  console.log("plan card:", c.total, "|", c.rows.join(" | "), "|", c.more, "|", c.income);

  // ---- Clicking a category opens its transactions.
  await b.execute(() => [...document.querySelectorAll("[data-budget-summary] .category-bars-select")].find(el => el.textContent.includes("Groceries")).click());
  await (await b.$("[role='dialog']")).waitForExist({ timeout: 10000 });
  await b.execute(() => [...document.querySelectorAll("[role='dialog'] button")].find(x => /^(close|cancel)$/i.test(x.textContent.trim()))?.click());
  await waitUntilOrDiagnose(b, async () => (await b.$$("[role='dialog']")).length === 0, { timeout: 5000, timeoutMsg: "the category dialog closes" });

  // ---- Month navigation: last month has no budget, so the card says so in words.
  await b.execute(() => document.querySelector("button[aria-label='Previous month']").click());
  await waitUntilOrDiagnose(b, async () => ((await readCard())?.text ?? "").includes("Nothing is planned for spending in"), { timeout: 10000, timeoutMsg: "an empty month says so in words", extra: readCard });
  const empty = await readCard();
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.total, null);
  await b.execute(() => document.querySelector("button[aria-label='Next month']").click());
  await waitUntilOrDiagnose(b, async () => (await readCard())?.rows.length === 8, { timeout: 10000, timeoutMsg: "back on this month" });

  // ---- Layout and screenshots: three styles, light and dark, 1440 / 1180 / 720.
  for (const [style, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await b.setWindowSize(1440, 1000);
    await chooseStyle(b, style, palette);
    for (const theme of ["light", "dark"]) {
      await b.setWindowSize(1440, 1000);
      await b.execute(t => [...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find(el => el.textContent.trim().toLowerCase() === t).click(), theme);
      await waitUntilOrDiagnose(b, () => b.execute(t => document.documentElement.dataset.theme === t, theme), { timeoutMsg: `apply ${theme}` });
      await nav("Budget");
      await waitUntilOrDiagnose(b, async () => (await readCard())?.rows.length === 8, { timeout: 10000, timeoutMsg: `${style} ${theme}: plan card loaded` });
      await dismissStatusMessages(b);
      await b.executeAsync(done => document.fonts.ready.then(() => done()));
      for (const width of [1440, 1180, 720]) {
        await b.setWindowSize(width, width === 720 ? 900 : 1000);
        await waitUntilOrDiagnose(b, async () => (await layoutIssues()).length === 0, { timeout: 5000, timeoutMsg: `${style} ${theme} ${width}px layout`, extra: layoutIssues });
        if (width === 1180) continue;
        await b.execute(() => document.querySelector(".main").scrollTo(0, 0));
        await b.saveScreenshot(path.join(shots, `budget-plan-${palette}-${theme}-${width}.png`));
        await scrollTo(".budget-plan-foot");
        await b.saveScreenshot(path.join(shots, `budget-plan-foot-${palette}-${theme}-${width}.png`));
      }
    }
  }

  // ---- Hide amounts: every figure on the card masked, with none in an attribute.
  await b.setWindowSize(1440, 1000);
  await b.execute(() => document.querySelector(".main").scrollTo(0, 0));
  await (await b.$("[data-privacy-toggle]")).click();
  await waitUntilOrDiagnose(b, () => b.execute(() => !/\$\s?[\d,]+/.test(document.querySelector("[data-budget-summary]").textContent)), { timeout: 5000, timeoutMsg: "the plan card's figures are masked" });
  assert.equal(await b.execute(() => [...document.querySelectorAll("[data-budget-summary], [data-budget-summary] *")].some(el => el.getAttributeNames().some(a => /\$\s?\d/.test(el.getAttribute(a) ?? "")))), false, "no amount in any attribute");
  await b.saveScreenshot(path.join(shots, "budget-plan-hidden-amounts.png"));
  await (await b.$("[data-privacy-toggle]")).click();

  console.log(`screenshots: ${shots}`);
  console.log("FEATURE 396 PASSED: Spending against the plan keeps every figure of the old strip, orders overspending first, holds a category at 1,240% of its plan inside the card, says so when a month has no budget, lays out without clipping, overlap or split words in three styles, light and dark, at 1440, 1180 and 720, and hides amounts.");
} finally { await app.close(); }
