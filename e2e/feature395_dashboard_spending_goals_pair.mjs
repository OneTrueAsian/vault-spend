// VS-31 step 2 (D): the Dashboard's "Spending in <month> so far" card, the "Savings goals" card, and Recent
// transactions beside it. Native geometry at 1440, 1180 and 720px in three styles, light and dark: no page-level
// sideways scroll, no clipped or cut-off text, no word split across lines, no text over a bar, and every bar inside
// its track. Fixture, relative to today (this month's charges all fall on day 1 so "the same days" is well defined):
//   this month: Car upkeep 1240 (D Brake repair, the biggest one-off), Rent 1100, Groceries 420, Dining Out 210,
//     Utilities 135, Kids activities and sports camps 120, Entertainment 60, Health 45, Subscriptions 30, Gifts 25,
//     a 300 Transfer (not spending), an uncategorized 15 and a 40 refund (neither is a row)
//   last month, same days: Rent 1100, Groceries 500, Dining Out 150, Car upkeep 100, Utilities 135
// Ten categories, so seven rows show and three fold into "Everything else (3)".
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle, dismissStatusMessages, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
def day(back, d):
    index = today.year * 12 + today.month - 1 - back
    y, m = divmod(index, 12)
    return datetime.date(y, m + 1, min(d, today.day) if back == 0 else d).isoformat()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('D Checking','checking','9000.00')")
acct = cur.lastrowid
n = 0
def add(back, d, description, amount, category):
    global n
    n += 1
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,'user',?)", (acct, day(back, d), description, amount, category, f"d-{n}"))
for description, amount, category in [
    ('D Brake repair', '-1240.00', 'Car upkeep'), ('D Landlord', '-1100.00', 'Rent'), ('D Grocer', '-300.00', 'Groceries'), ('D Market', '-120.00', 'Groceries'),
    ('D Dinner', '-210.00', 'Dining Out'), ('D Power', '-135.00', 'Utilities'), ('D Camp', '-120.00', 'Kids activities and sports camps'),
    ('D Cinema', '-60.00', 'Entertainment'), ('D Clinic', '-45.00', 'Health'), ('D Stream', '-30.00', 'Subscriptions'), ('D Gift shop', '-25.00', 'Gifts'),
    ('D To savings', '-300.00', 'Transfer'), ('D Mystery', '-15.00', None), ('D Store refund', '40.00', 'Groceries'),
    ('D A very long merchant name that has to wrap inside the recent transactions list', '-18.00', 'Dining Out'),
]:
    add(0, 1, description, amount, category)
for description, amount, category in [
    ('D Landlord', '-1100.00', 'Rent'), ('D Grocer', '-500.00', 'Groceries'), ('D Dinner', '-150.00', 'Dining Out'),
    ('D Tyres', '-100.00', 'Car upkeep'), ('D Power', '-135.00', 'Utilities'), ('D Late shop', '-999.00', 'Gifts'),
]:
    add(1, 1 if description != 'D Late shop' else 28, description, amount, category)
for name, target, saved, color in [
    ('Holiday in the mountains with the whole family', '3000.00', '1200.00', '#2f6f9f'),
    ('Emergency fund', '5000.00', '5200.00', None),
    ('Rainy day', None, '75.00', None),
    ('Car', '20000.00', '150.00', '#b4552d'),
]:
    cur.execute("INSERT INTO buckets (name,target_amount,color) VALUES (?,?,?)", (name, target, color))
    cur.execute("INSERT INTO bucket_contributions (bucket_id,date,amount) VALUES (?,?,?)", (cur.lastrowid, day(0, 1), saved))
`);

const shots = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature395-");
fs.mkdirSync(shots, { recursive: true });
const app = await launchApp({ dbDir });
const b = app.browser;

const readSpending = () => b.execute(() => {
  const card = document.querySelector("[data-spending-so-far]");
  if (!card) return null;
  return {
    title: card.querySelector(".reports-section-title")?.textContent,
    sub: card.querySelector(".dashboard-spending-sub")?.textContent,
    rows: [...card.querySelectorAll(".category-bars tr")].map(tr => tr.textContent.replace(/\s+/g, " ").trim()),
    big: card.querySelector("[data-biggest-one-off]")?.textContent ?? null,
    text: card.innerText,
  };
});

// Real geometry for the three cards. Reports every problem as data, so a failure says what and where.
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
  for (const [name, selector] of [["spending", "[data-spending-so-far]"], ["goals", "[data-savings-goals]"], ["recent", '[data-widget-id="recent_transactions"] .card']]) {
    const card = document.querySelector(selector);
    if (!card) { issues.push({ kind: "card missing", name }); continue; }
    const box = card.getBoundingClientRect();
    // Clipped or cut-off text: a box whose content is wider than the box, or a text run that ends outside the card.
    for (const el of card.querySelectorAll("*")) {
      if (!visible(el) || el.closest("svg")) continue;
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && getComputedStyle(el).display !== "inline") issues.push({ kind: "content wider than its box", name, el: el.className || el.tagName, text: el.textContent.slice(0, 40), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      if (el.children.length === 0 && el.textContent.trim()) {
        const r = textRect(el);
        if (r.right > box.right + 0.5 || r.left < box.left - 0.5) issues.push({ kind: "text outside the card", name, text: el.textContent.slice(0, 40) });
      }
      const words = el.children.length === 0 ? splitWords(el) : [];
      if (words.length) issues.push({ kind: "word split across lines", name, text: el.textContent.slice(0, 60), words });
    }
    if (name === "spending") {
      for (const tr of card.querySelectorAll(".category-bars tr")) {
        const n = textRect(tr.querySelector(".category-bars-name"));
        const amount = tr.querySelector(".category-bars-amount").getBoundingClientRect();
        const noteEl = tr.querySelector(".category-bars-note");
        const note = noteEl ? textRect(noteEl) : null;
        const track = tr.querySelector(".category-bars-track").getBoundingClientRect();
        const label = tr.querySelector(".category-bars-name").textContent;
        const amountText = textRect(tr.querySelector(".category-bars-amount"));
        if (overlap(n, track)) issues.push({ kind: "name over its bar", label });
        if (overlap(amountText, track)) issues.push({ kind: "amount over its bar", label });
        if (note && overlap(note, track)) issues.push({ kind: "note over its bar", label });
        if (overlap(n, amountText)) issues.push({ kind: "name over its amount", label });
        if (note && overlap(note, amountText)) issues.push({ kind: "note over its amount", label });
        if (track.width < 40) issues.push({ kind: "bar too narrow to read", label, width: track.width });
        for (const fill of tr.querySelectorAll(".category-bars-fill, .category-bars-plan, .category-bars-over")) {
          const f = fill.getBoundingClientRect();
          if (f.right > track.right + 1 || f.left < track.left - 1) issues.push({ kind: "bar outside its track", label });
        }
        if (amount.right > box.right + 0.5) issues.push({ kind: "amount outside the card", label });
      }
    }
    if (name === "goals") {
      for (const goal of card.querySelectorAll(".dashboard-goal")) {
        const track = goal.querySelector(".progress-track")?.getBoundingClientRect();
        const line = goal.querySelector(".dashboard-goal-line").getBoundingClientRect();
        const label = goal.querySelector(".dashboard-goal-name").textContent;
        if (track && overlap(line, track)) issues.push({ kind: "goal text over its bar", label });
        const nm = textRect(goal.querySelector(".dashboard-goal-name"));
        const am = textRect(goal.querySelector(".dashboard-goal-amount"));
        if (overlap(nm, am)) issues.push({ kind: "goal name over its amount", label });
        const fill = goal.querySelector(".progress-fill")?.getBoundingClientRect();
        if (fill && track && (fill.right > track.right + 1 || fill.left < track.left - 1)) issues.push({ kind: "goal bar outside its track", label });
      }
    }
    if (name === "recent") {
      for (const row of card.querySelectorAll(".recent-transaction")) {
        const parts = [".recent-transaction-info > span:first-child", ".recent-transaction-detail", ".recent-transaction-category", ".amount-col"].map(s => [s, textRect(row.querySelector(s))]);
        for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (overlap(parts[i][1], parts[j][1])) issues.push({ kind: "recent transaction parts overlap", a: parts[i][0], b: parts[j][0], text: row.textContent.slice(0, 40) });
      }
    }
  }
  // Recent transactions and Savings goals share one row on a wide window, and stack on a narrow one.
  const pair = document.querySelector(".dashboard-pair-row");
  if (!pair) issues.push({ kind: "pair row missing" });
  else {
    const [one, two] = [...pair.children].map(c => c.getBoundingClientRect());
    const sideBySide = Math.abs(one.top - two.top) < 2;
    if (innerWidth >= 1200 && !sideBySide) issues.push({ kind: "recent transactions and goals should sit side by side", innerWidth });
    if (innerWidth < 1000 && sideBySide) issues.push({ kind: "recent transactions and goals should stack", innerWidth });
    if (sideBySide && (one.right > two.left + 0.5 || two.right > main.getBoundingClientRect().right + 0.5)) issues.push({ kind: "pair cards overlap or overflow" });
  }
  return issues;
});

const clickByText = (selector, text) => b.execute((sel, t) => { const el = [...document.querySelectorAll(sel)].find(e => e.textContent.includes(t)); if (!el) throw new Error("no " + sel + " with " + t); el.click(); }, selector, text);
const scrollTo = selector => b.execute(sel => document.querySelector(sel).scrollIntoView({ block: "start" }), selector);

try {
  await b.setWindowSize(1440, 1000);
  await (await b.$('.nav-item[aria-label="Dashboard"]')).click();
  await waitUntilOrDiagnose(b, async () => (await readSpending())?.rows.length === 8, { timeout: 15000, timeoutMsg: "the spending card shows seven rows and Everything else", extra: readSpending });

  // ---- Figures
  const s = await readSpending();
  const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  assert.equal(s.title, `Spending in ${month} so far`);
  assert.match(s.sub, /^[A-Z][a-z]{2} 1–\d+, largest first\. The change is against [A-Z][a-z]{2} 1–\d+\.$/);
  const row = name => s.rows.find(r => r.startsWith(name));
  assert.match(row("Car upkeep"), /\$1,240.*\$1,140/, "Car upkeep up $1,140 on last month's $100");
  assert.match(row("Rent"), /\$1,100.*same/);
  assert.match(row("Groceries"), /\$420.*\$80/, "Groceries down $80 (a refund is not netted off, as before)");
  assert.match(row("Dining Out"), /\$228.*\$78/, "Dining Out: 210 + 18 now against 150");
  assert.ok(row("Everything else (3)"), s.rows.join(" | "));
  assert.ok(s.text.includes("spent"), s.text);
  assert.match(s.big, /Biggest one-off cost: D Brake repair, \$1,240 on .+\(Car upkeep\)\./);
  assert.ok(!s.rows.some(r => r.startsWith("Transfer")), "a Transfer is not a spending category");
  console.log("spending card:", s.rows.join(" | "));

  // ---- Clicking a category opens that category's transactions for the month (today's donut behavior).
  await clickByText('[data-spending-so-far] .category-bars-select', 'Groceries');
  const dialog = await b.$("[data-category-spend-detail]");
  await dialog.waitForExist({ timeout: 10000 });
  await waitUntilOrDiagnose(b, async () => (await dialog.getText()).includes("D Grocer"), { timeout: 10000, timeoutMsg: "the Groceries transactions are listed" });
  await (await b.$("[data-category-spend-detail] .modal-actions button")).click();
  await dialog.waitForExist({ timeout: 5000, reverse: true });

  // ---- Everything else opens the folded rows, and Show fewer folds them again.
  await clickByText('[data-spending-so-far] .category-bars-select', 'Everything else');
  await waitUntilOrDiagnose(b, async () => (await readSpending()).rows.length === 10, { timeout: 5000, timeoutMsg: "all ten categories show", extra: readSpending });
  await clickByText("[data-spending-so-far] button", "Show fewer");
  await waitUntilOrDiagnose(b, async () => (await readSpending()).rows.length === 8, { timeout: 5000, timeoutMsg: "back to eight rows", extra: readSpending });

  // ---- Savings goals
  const goals = await b.execute(() => [...document.querySelectorAll("[data-savings-goals] .dashboard-goal")].map(g => g.innerText.replace(/\s+/g, " ").trim()));
  assert.equal(goals.length, 4);
  assert.ok(goals.some(g => g.includes("Holiday in the mountains with the whole family") && g.includes("$1,200 of $3,000")), goals.join(" | "));
  assert.ok(goals.some(g => g.includes("Emergency fund") && g.includes("$5,200 of $5,000")), goals.join(" | "));
  assert.ok(goals.some(g => g.includes("Rainy day") && g.includes("$75") && !g.includes(" of ")), goals.join(" | "));
  assert.equal(await b.execute(() => document.querySelectorAll("[data-savings-goals] .progress-track").length), 3, "no bar for a goal with no target");
  await clickByText("[data-savings-goals] button", "All goals");
  await waitUntilOrDiagnose(b, async () => (await b.$$(".bucket-card")).length > 0, { timeout: 10000, timeoutMsg: "All goals opens the Goals page" });
  await (await b.$('.nav-item[aria-label="Dashboard"]')).click();
  await (await b.$("[data-spending-so-far]")).waitForExist({ timeout: 10000 });

  // ---- Layout and screenshots: three styles, light and dark, 1440 / 1180 / 720.
  for (const [style, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await b.setWindowSize(1440, 1000);
    await chooseStyle(b, style, palette);
    for (const theme of ["light", "dark"]) {
      await b.setWindowSize(1440, 1000);
      await b.execute(t => [...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find(el => el.textContent.trim().toLowerCase() === t).click(), theme);
      await waitUntilOrDiagnose(b, () => b.execute(t => document.documentElement.dataset.theme === t, theme), { timeoutMsg: `apply ${theme}` });
      await (await b.$('.nav-item[aria-label="Dashboard"]')).click();
      await waitUntilOrDiagnose(b, async () => (await readSpending())?.rows.length === 8, { timeout: 10000, timeoutMsg: `${style} ${theme}: spending card loaded` });
      await dismissStatusMessages(b);
      await b.executeAsync(done => document.fonts.ready.then(() => done()));
      for (const width of [1440, 1180, 720]) {
        await b.setWindowSize(width, width === 720 ? 900 : 1000);
        await waitUntilOrDiagnose(b, async () => (await layoutIssues()).length === 0, { timeout: 5000, timeoutMsg: `${style} ${theme} ${width}px layout`, extra: layoutIssues });
        if (width === 1180) continue;
        await scrollTo("[data-spending-so-far]");
        await b.saveScreenshot(path.join(shots, `dashboard-spending-${palette}-${theme}-${width}.png`));
        await scrollTo(".dashboard-pair-row");
        await b.saveScreenshot(path.join(shots, `dashboard-pair-${palette}-${theme}-${width}.png`));
        if (width === 720) {
          await scrollTo("[data-savings-goals]");
          await b.saveScreenshot(path.join(shots, `dashboard-goals-${palette}-${theme}-${width}.png`));
        }
      }
    }
  }

  // ---- Hide amounts: every figure on both cards masked, change notes included.
  await b.setWindowSize(1440, 1000);
  await (await b.$("[data-privacy-toggle]")).click();
  await waitUntilOrDiagnose(b, () => b.execute(() => ![...document.querySelectorAll("[data-spending-so-far], [data-savings-goals]")].some(c => /\$\s?[\d,]+/.test(c.textContent))), { timeout: 5000, timeoutMsg: "both cards' figures are masked" });
  assert.equal(await b.execute(() => [...document.querySelectorAll("[data-spending-so-far] *, [data-savings-goals] *")].some(el => el.getAttributeNames().some(a => /\$\s?\d/.test(el.getAttribute(a) ?? "")))), false, "no amount in any attribute");
  await scrollTo("[data-spending-so-far]");
  await b.saveScreenshot(path.join(shots, "dashboard-spending-hidden-amounts.png"));
  await scrollTo(".dashboard-pair-row");
  await b.saveScreenshot(path.join(shots, "dashboard-pair-hidden-amounts.png"));
  await (await b.$("[data-privacy-toggle]")).click();

  console.log(`screenshots: ${shots}`);
  console.log("FEATURE 395 PASSED: Spending in <month> so far (change against the same days, fold, biggest one-off, category click), Savings goals, and Recent transactions beside it lay out without clipping, overlap or split words in three styles, light and dark, at 1440, 1180 and 720; Hide amounts masks both cards.");
} finally { await app.close(); }
