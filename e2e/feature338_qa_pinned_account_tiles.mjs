// UAT-026 (remaining place): pinned account tiles ("account:<id>" widgets) for a very long unbroken name, a zero balance and a negative balance at 1280/960/720.
// Pinned through the real gestures: Layout menu > Customize > + Add widget > "Choose Account" > Add > Done.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose, chooseMenuOption } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const TOKEN = "QA" + "Unbroken".repeat(10);
const LONG = "QA Extraordinarily Long Joint Household Checking Account Name For Everyday Spending And Bills";
const PINS = [[TOKEN, '$0.00'], [LONG, '$250.00'], ['QA Overdrawn', '-$125.50']];
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('${TOKEN}','savings','0.00')")
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('${LONG}','checking','250.00')")
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Overdrawn','checking','-125.50')")
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const tiles = () => b.execute(() => [...document.querySelectorAll('[data-widget-id^="account:"]')].map(w => {
  const tile = w.querySelector('.stat') ?? w;
  const t = tile.getBoundingClientRect();
  const lines = [];
  for (const el of tile.querySelectorAll('.stat-label, .stat-value, .stat-delta')) { const r = document.createRange(); r.selectNodeContents(el); for (const x of r.getClientRects()) lines.push({ left: x.left, right: x.right }); }
  return { name: tile.querySelector('.stat-label')?.textContent, value: tile.querySelector('.stat-value')?.textContent, tile: { left: t.left, right: t.right }, lines, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
}));
try {
  await b.setWindowSize(1280, 900);
  await chooseMenuOption(await b.$('.layout-select-toggle'), { label: 'Customize' });
  for (const [name] of PINS) {
    await b.execute(() => document.querySelector('.main')?.scrollTo(0, 0));
    await (await (await b.$('.dashboard-toolbar')).$('button*=Add widget')).click();
    await (await b.$('//ul[contains(@class,"category-manage-list")]//li[.//span[text()="Account"]]//button[@aria-label="Choose Account"]')).waitForDisplayed({ timeout: 5000 });
    await chooseMenuOption(await b.$('button[aria-label="Choose Account"]'), { label: name });
    await (await b.$('//li[.//span[text()="Account"]]//button[text()="Add"]')).click();
    await (await (await b.$('.modal-actions')).$('button=Done')).click();
  }
  for (const width of [1280, 960, 720]) {
    await b.setWindowSize(width, 900);
    await waitUntilOrDiagnose(b, async () => (await tiles()).length === 3, { timeout: 10000, timeoutMsg: `${width}px: three pinned account tiles` });
    const found = await tiles();
    for (const [name, value] of PINS) {
      const t = found.find(x => x.name === name);
      assert.ok(t, `${width}px: tile for ${name.slice(0, 24)} in ${JSON.stringify(found.map(x => x.name))}`);
      assert.equal(t.value, value, `${width}px: ${name.slice(0, 24)}`);
      for (const line of t.lines) assert.ok(line.left >= t.tile.left - 1 && line.right <= t.tile.right + 1, `${width}px: "${name.slice(0, 24)}" text stays inside its tile ${JSON.stringify({ line, tile: t.tile })}`);
    }
    assert.ok(found[0].pageOverflow <= 1, `${width}px: no sideways page scroll (${found[0].pageOverflow}px)`);
  }
  console.log('FEATURE 338 PASSED: pinned account tiles keep long, unbroken, zero and negative values inside their tiles at 1280/960/720.');
} finally { await app.close(); }
