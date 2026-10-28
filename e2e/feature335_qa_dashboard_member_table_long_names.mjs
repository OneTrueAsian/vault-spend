// UAT-026 (remaining Dashboard place that prints names): the pinned "Net worth by member" table with a long unbroken member name, a zero total and a negative total at 1280/960/720.
// Alex-like members: long unbroken name owns a 0.00 account; a spaced long name owns 250.00; QA Overdrawn owns -125.50. Pinned through the real "Pin to Dashboard" button on Reports.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const TOKEN = "QA" + "Unbroken".repeat(10);
const LONG = "QA Extraordinarily Long Family Member Name For The Household Table";
const dbDir = await seedFixture(`
for name,balance in [('${TOKEN}','0.00'),('${LONG}','250.00'),('QA Overdrawn','-125.50')]:
    cur.execute('INSERT INTO family_members(name) VALUES(?)',(name,))
    member=cur.lastrowid
    cur.execute("INSERT INTO accounts(name,account_type,starting_balance,member_id) VALUES(?,'checking',?,?)",('Acct '+name[:12],balance,member))
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const read = () => b.execute(() => {
  const card = [...document.querySelectorAll(".card")].find(c => c.querySelector("table") && [...c.querySelectorAll("th")].some(th => th.textContent === "Net Worth") && [...c.querySelectorAll("th")].some(th => th.textContent === "Member"));
  if (!card) return null;
  const c = card.getBoundingClientRect();
  const rows = [...card.querySelectorAll("tbody tr")].map(tr => {
    const lines = [];
    for (const td of tr.cells) { const r = document.createRange(); r.selectNodeContents(td); for (const x of r.getClientRects()) lines.push({ left: x.left, right: x.right }); }
    return { name: tr.cells[0].textContent, amount: tr.cells[1].textContent, lines };
  });
  return { card: { left: c.left, right: c.right }, rows, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
try {
  await b.setWindowSize(1280, 900);
  await (await b.$('.nav-item[aria-label="Reports"]')).click();
  const pin = await b.$("//div[contains(@class,'card')][.//h2[contains(.,'Net Worth by Member')]]//button[contains(.,'Pin')]");
  await pin.waitForDisplayed({ timeout: 10000 });
  await pin.click();
  await (await b.$('.nav-item[aria-label="Dashboard"]')).click();
  for (const width of [1280, 960, 720]) {
    await b.setWindowSize(width, 900);
    await waitUntilOrDiagnose(b, async () => (await read())?.rows.length === 3, { timeout: 10000, timeoutMsg: `${width}px: the pinned member table shows three members` });
    const { card, rows, pageOverflow } = await read();
    const by = Object.fromEntries(rows.map(r => [r.name, r]));
    assert.equal(by[LONG]?.amount, "$250.00", `${width}px`);
    assert.equal(by[TOKEN]?.amount, "$0.00", `${width}px: zero total`);
    assert.equal(by["QA Overdrawn"]?.amount, "-$125.50", `${width}px: negative total`);
    for (const row of rows) for (const line of row.lines) assert.ok(line.left >= card.left - 1 && line.right <= card.right + 1, `${width}px: "${row.name.slice(0, 24)}" stays inside its card ${JSON.stringify({ line, card })}`);
    assert.ok(pageOverflow <= 1, `${width}px: no sideways page scroll (${pageOverflow}px)`);
  }
  // The same long member name on the other pages that print it, at the narrowest width (still 720px here).
  const contained = () => b.execute(token => {
    const out = [];
    const walker = document.createTreeWalker(document.querySelector('[role="main"]') ?? document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.includes(token)) continue;
      const card = n.parentElement.closest('.card, .account-card') ?? document.querySelector('[role="main"]');
      const c = card.getBoundingClientRect(), r = document.createRange(); r.selectNodeContents(n);
      for (const x of r.getClientRects()) out.push({ where: card.className, over: Math.round((x.right - c.right) * 10) / 10 });
    }
    return { out, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  }, TOKEN);
  for (const page of ['Household', 'Reports', 'Accounts']) {
    await (await b.$(`.nav-item[aria-label="${page}"]`)).click();
    await waitUntilOrDiagnose(b, async () => (await contained()).out.length > 0, { timeout: 10000, timeoutMsg: `${page}: the long member name is shown` });
    const { out, pageOverflow } = await contained();
    for (const hit of out) assert.ok(hit.over <= 1, `${page}: the long member name runs ${hit.over}px past its ${hit.where}`);
    assert.ok(pageOverflow <= 1, `${page}: no sideways page scroll (${pageOverflow}px)`);
  }
  console.log("FEATURE 335 PASSED: member names keep long, unbroken, zero and negative values inside their cards on Dashboard (1280/960/720), Household, Reports and Accounts (720).");
} finally { await app.close(); }
