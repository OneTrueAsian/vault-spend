// UAT-026: Dashboard with a very long name, a no-space long name, a zero balance and a negative balance at 720/960/1280.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const LONG = "QA Extraordinarily Long Joint Household Checking Account Name For Everyday Spending And Bills";
const TOKEN = "QA" + "Unbroken".repeat(10);
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('${LONG}','checking','250.00')")
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('${TOKEN}','savings','0.00')")
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Overdrawn','checking','-125.50')")
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const read = () => b.execute(() => {
  const panel = document.querySelector('.stat-detail-panel');
  const p = panel.getBoundingClientRect();
  const rows = [...panel.querySelectorAll(':scope > div[style*="space-between"]')].map(row => {
    const [nameEl, amountEl] = row.children;
    const lines = el => { const r = document.createRange(); r.selectNodeContents(el); return [...r.getClientRects()].map(x => ({ left: x.left, right: x.right })); };
    return { name: nameEl.textContent, amount: amountEl.textContent, flagged: amountEl.classList.contains('report-over-budget'), lines: [...lines(nameEl), ...lines(amountEl)] };
  });
  return { panel: { left: p.left, right: p.right }, rows, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
try {
  for (const width of [1280, 960, 720]) {
    await b.setWindowSize(width, 900);
    await waitUntilOrDiagnose(b, async () => await b.$('[data-widget-id="stat_net_worth"] .stat-value').getText() === '$124.50', { timeout: 10000, timeoutMsg: `${width}px: net worth is 250.00 + 0.00 - 125.50` });
    if (!(await b.$('.stat-detail-panel').isExisting())) await b.$('[data-widget-id="stat_net_worth"] button, button[data-widget-id="stat_net_worth"]').click();
    await b.$('.stat-detail-panel').waitForDisplayed({ timeout: 10000 });
    const { panel, rows, pageOverflow } = await read();
    const by = Object.fromEntries(rows.map(r => [r.name, r]));
    assert.equal(rows.length, 3, `${width}px: three accounts listed`);
    assert.equal(by[LONG]?.amount, '$250.00', `${width}px: long name shown in full with its amount`);
    assert.equal(by[TOKEN]?.amount, '$0.00', `${width}px: zero balance shows $0.00`);
    assert.equal(by[TOKEN]?.flagged, false, `${width}px: zero is not flagged as overdrawn`);
    assert.equal(by['QA Overdrawn']?.amount, '-$125.50', `${width}px: negative balance shows its sign`);
    assert.equal(by['QA Overdrawn']?.flagged, true, `${width}px: only the negative balance is flagged`);
    for (const row of rows) for (const line of row.lines) assert.ok(line.left >= panel.left - 1 && line.right <= panel.right + 1, `${width}px: "${row.name.slice(0, 30)}" stays inside its card: ${JSON.stringify({ line, panel })}`);
    assert.ok(pageOverflow <= 1, `${width}px: no sideways page scroll (${pageOverflow}px)`);
  }
  console.log('FEATURE 327 PASSED: long, unbroken, zero and negative account names/values contained at 1280/960/720.');
} finally { await app.close(); }
