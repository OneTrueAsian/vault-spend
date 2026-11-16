// VS-31 step 2 (A): the Accounts page's "What you own and owe" bar and its key, above the grouped cards.
// Native geometry at 1440, 1180 and 720px in three styles, light and dark: no page-level sideways scroll, no
// segment label clipped or cut short (a label too long for its segment is hidden whole, the key names it), no
// overlapping text, every segment inside its track, the key inside the card with no word split across lines, and
// the bar agreeing with the three tiles to the cent.
// Fixture: cash 2,100.00 (checking 1,200 + savings 900) plus a hidden savings account of 500.00 (hidden accounts
// count, as in the tiles); investments 40,000.00; property 60,000.00 (one asset); owed 16,675.46 (a card with
// 1,341.93 charged, and a loan of 15,333.53). Own is 102,600.00 and Owe 16,675.46, so Cash and savings is far too
// narrow for a label while Investments and Property are not, and the Owe segment is the borderline one.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle, dismissStatusMessages, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today().isoformat()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('A Checking','checking','1200.00')")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('A Rainy day','savings','900.00')")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance, hidden) VALUES ('A Hidden savings','savings','500.00',1)")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('A Brokerage','investment','40000.00')")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('A Visa','credit','12000.00')")
visa = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('A Car loan','loan','15333.53')")
cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,'user',?)", (visa, today, 'A Charge', '-1341.93', 'Shopping', 'a-1'))
cur.execute("INSERT INTO assets (name, asset_type, value, valued_on) VALUES ('A House', 'real_estate', '60000.00', date('now'))")
`);

const shots = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature397-");
fs.mkdirSync(shots, { recursive: true });
const app = await launchApp({ dbDir });
const b = app.browser;

const readBar = () => b.execute(() => {
  const card = document.querySelector("[data-own-owe]");
  if (!card) return null;
  return {
    rows: [...card.querySelectorAll(".segment-bar-row")].map(r => [r.querySelector(".segment-bar-label")?.textContent, r.querySelector(".segment-bar-total")?.textContent]),
    key: [...card.querySelectorAll("[data-own-owe-key] li")].map(li => li.textContent.replace(/\s+/g, " ").trim()),
    net: card.querySelector("[data-own-owe-net]")?.textContent ?? null,
    tiles: [...document.querySelectorAll(".stats .stat .stat-value")].map(e => e.textContent),
    named: [...card.querySelectorAll(".segment-bar-seg-text:not(.is-cut) .segment-bar-seg-name")].map(e => e.textContent),
    cut: [...card.querySelectorAll(".segment-bar-seg-text.is-cut .segment-bar-seg-name")].map(e => e.textContent),
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
  const card = document.querySelector("[data-own-owe]");
  if (!card) return [{ kind: "card missing" }];
  const box = card.getBoundingClientRect();
  for (const el of card.querySelectorAll("*")) {
    if (!visible(el) || el.closest("svg")) continue;
    // A label hidden whole (is-cut) is allowed to overflow its own box; every visible label must fit it.
    if (el.closest(".segment-bar-seg-text.is-cut")) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && getComputedStyle(el).display !== "inline") issues.push({ kind: "content wider than its box", el: el.className || el.tagName, text: el.textContent.slice(0, 40), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    if (el.children.length === 0 && el.textContent.trim()) {
      const r = textRect(el);
      if (r.right > box.right + 0.5 || r.left < box.left - 0.5) issues.push({ kind: "text outside the card", text: el.textContent.slice(0, 40) });
      const words = splitWords(el);
      if (words.length) issues.push({ kind: "word split across lines", text: el.textContent.slice(0, 60), words });
    }
  }
  // A visible segment label must fit inside its own segment and not touch another label.
  const labels = [...card.querySelectorAll(".segment-bar-seg-text:not(.is-cut)")];
  for (const t of labels) {
    const seg = t.closest(".segment-bar-seg").getBoundingClientRect();
    const r = textRect(t);
    if (r.right > seg.right + 0.5 || r.left < seg.left - 0.5) issues.push({ kind: "segment label cut short", text: t.textContent });
  }
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (overlap(textRect(labels[i]), textRect(labels[j]))) issues.push({ kind: "segment labels overlap", a: labels[i].textContent, b: labels[j].textContent });
  for (const row of card.querySelectorAll(".segment-bar-row")) {
    const track = row.querySelector(".segment-bar-track").getBoundingClientRect();
    const total = textRect(row.querySelector(".segment-bar-total"));
    const label = row.querySelector(".segment-bar-label");
    if (overlap(total, track)) issues.push({ kind: "row total over its bar" });
    if (label && overlap(textRect(label), track)) issues.push({ kind: "row label over its bar" });
    for (const seg of row.querySelectorAll(".segment-bar-seg")) {
      const s = seg.getBoundingClientRect();
      if (s.right > track.right + 1 || s.left < track.left - 1) issues.push({ kind: "segment outside its bar" });
    }
  }
  for (const li of card.querySelectorAll("[data-own-owe-key] li")) {
    if (li.getBoundingClientRect().right > box.right + 0.5) issues.push({ kind: "key item outside the card", text: li.textContent });
  }
  // The three tiles keep fitting too.
  for (const tile of document.querySelectorAll(".stats .stat")) {
    if (tile.scrollWidth > tile.clientWidth + 1) issues.push({ kind: "tile content wider than the tile", text: tile.textContent.slice(0, 40) });
  }
  return issues;
});

const scrollTo = selector => b.execute(sel => document.querySelector(sel).scrollIntoView({ block: "start" }), selector);

try {
  await b.setWindowSize(1440, 1000);
  await b.execute(() => document.querySelector(".nav-item[data-tab=accounts]").click());
  await waitUntilOrDiagnose(b, async () => (await readBar())?.key.length === 4, { timeout: 15000, timeoutMsg: "the own and owe card shows four kinds", extra: readBar });

  // ---- Figures: the bar agrees with the tiles to the cent, and the key names every kind.
  const bar = await readBar();
  assert.deepEqual(bar.rows, [["Own", "$102,600.00"], ["Owe", "$16,675.46"]]);
  assert.equal(bar.tiles[0], "$102,600.00", "What you own");
  assert.equal(bar.tiles[1], "$16,675.46", "What you owe");
  assert.equal(bar.tiles[2], "$85,924.54", "Net worth");
  assert.equal(bar.net, "Net worth $85,924.54");
  assert.deepEqual(bar.key, ["Investments and other $40,000.00", "Cash and savings $2,600.00", "Property and valuables $60,000.00", "Cards and loans $16,675.46"]);
  console.log("own and owe:", JSON.stringify(bar));

  // ---- The tiles keep opening their detail panel.
  await b.execute(() => document.querySelectorAll(".stats .stat")[1].click());
  await waitUntilOrDiagnose(b, () => b.execute(() => document.body.innerText.includes("A Car loan")), { timeout: 5000, timeoutMsg: "the What you owe tile opens its detail" });
  await b.execute(() => document.querySelectorAll(".stats .stat")[1].click());

  // ---- Layout and screenshots: three styles, light and dark, 1440 / 1180 / 720.
  for (const [style, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await b.setWindowSize(1440, 1000);
    await chooseStyle(b, style, palette);
    for (const theme of ["light", "dark"]) {
      await b.setWindowSize(1440, 1000);
      await b.execute(t => [...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find(el => el.textContent.trim().toLowerCase() === t).click(), theme);
      await waitUntilOrDiagnose(b, () => b.execute(t => document.documentElement.dataset.theme === t, theme), { timeoutMsg: `apply ${theme}` });
      await b.execute(() => document.querySelector(".nav-item[data-tab=accounts]").click());
      await waitUntilOrDiagnose(b, async () => (await readBar())?.key.length === 4, { timeout: 10000, timeoutMsg: `${style} ${theme}: own and owe loaded` });
      await dismissStatusMessages(b);
      await b.executeAsync(done => document.fonts.ready.then(() => done()));
      for (const width of [1440, 1180, 720]) {
        await b.setWindowSize(width, width === 720 ? 900 : 1000);
        await waitUntilOrDiagnose(b, async () => (await layoutIssues()).length === 0, { timeout: 5000, timeoutMsg: `${style} ${theme} ${width}px layout`, extra: layoutIssues });
        if (width === 1180) continue;
        await b.execute(() => document.querySelector(".main").scrollTo(0, 0));
        await b.saveScreenshot(path.join(shots, `accounts-own-owe-${palette}-${theme}-${width}.png`));
      }
    }
  }

  // ---- Hide amounts: every figure on the card masked, with none in an attribute.
  await b.setWindowSize(1440, 1000);
  await b.execute(() => document.querySelector(".main").scrollTo(0, 0));
  await (await b.$("[data-privacy-toggle]")).click();
  await waitUntilOrDiagnose(b, () => b.execute(() => !/\$\s?[\d,]+/.test(document.querySelector("[data-own-owe]").textContent)), { timeout: 5000, timeoutMsg: "the card's figures are masked" });
  assert.equal(await b.execute(() => [...document.querySelectorAll("[data-own-owe], [data-own-owe] *")].some(el => el.getAttributeNames().some(a => /\$\s?\d/.test(el.getAttribute(a) ?? "")))), false, "no amount in any attribute");
  await b.saveScreenshot(path.join(shots, "accounts-own-owe-hidden-amounts.png"));
  await (await b.$("[data-privacy-toggle]")).click();

  console.log(`screenshots: ${shots}`);
  console.log("FEATURE 397 PASSED: What you own and owe agrees with the tiles to the cent (hidden accounts counted), names every kind in its key, never cuts a segment label short or lets text overlap, and fits in three styles, light and dark, at 1440, 1180 and 720; Hide amounts masks it.");
} finally { await app.close(); }
