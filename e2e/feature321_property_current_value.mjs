// Owner decision 2026-10-27: current valuations only; history is deliberately excluded.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today=datetime.date.today().isoformat()
cur.execute("INSERT INTO family_members(name) VALUES('QA Owner')")
member=cur.lastrowid
cur.execute("INSERT INTO accounts(name,account_type,starting_balance,member_id) VALUES('QA Checking','checking','1000.00',?)",(member,))
cur.execute("INSERT INTO assets(name,asset_type,value,valued_on,member_id) VALUES('QA Property','real_estate','100.00',?,?)",(today,member))
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const nav = async label => { await (await b.$(`.nav-item[aria-label="${label}"]`)).click(); };
const worth = () => b.$('[data-widget-id="stat_net_worth"] .stat-value').getText();
const trend = () => b.execute(() => {
  const heading = [...document.querySelectorAll('.reports-section-title')].find(e => e.textContent === 'Net worth trend');
  if (!heading) return null;
  const card = heading.closest('.card');
  return { axes: [...card.querySelectorAll('.axis-label')].map(e => e.textContent), points: card.querySelector('polyline')?.getAttribute('points') };
});
const householdWorth = () => b.execute(() => {
  const heading = [...document.querySelectorAll('h2')].find(e => e.textContent === 'Net worth by person');
  return heading?.closest('.card')?.innerText ?? '';
});
try {
  await b.setWindowSize(1280, 900);
  await waitUntilOrDiagnose(b, async () => await worth() === '$1,100.00', {timeout:10000, timeoutMsg:'current property is included in net-worth headline'});
  const before = await trend();
  assert.ok(before?.axes.length && before.points, 'the actual historical chart is present');
  await nav('Household');
  await waitUntilOrDiagnose(b, async () => (await householdWorth()).includes('$1,100.00'), {timeout:10000, timeoutMsg:'Household includes the assigned current property value'});
  await nav('Accounts');
  const property = () => b.$('.account-card[data-asset-id]');
  await (await property()).waitForDisplayed({timeout:10000});
  assert.equal(await (await (await property()).$('button.bal')).getText(), '$100.00');
  await (await (await property()).$('button.bal')).click();
  const input = await b.$('input[aria-label="Value of QA Property"]');
  await input.waitForDisplayed({timeout:5000});
  // The editor auto-focuses and commits on blur. setValue's clear/type sequence
  // can blur and destroy it in WebView2; use the actual focused input's keys.
  await waitUntilOrDiagnose(b, () => b.execute(() => document.activeElement?.getAttribute('aria-label') === 'Value of QA Property'), {timeout:5000, timeoutMsg:'property value editor owns keyboard focus'});
  await b.keys(['Control', 'a']);
  await b.keys('250.00');
  await b.keys('Enter');
  await waitUntilOrDiagnose(b, async () => await (await (await property()).$('button.bal')).getText() === '$250.00', {timeout:10000, timeoutMsg:'Accounts reads back the edited current value'});
  await nav('Dashboard');
  await waitUntilOrDiagnose(b, async () => await worth() === '$1,250.00', {timeout:10000, timeoutMsg:'Dashboard headline updates after the edit'});
  assert.deepEqual(await trend(), before, 'editing today\'s property does not rewrite historical chart points or amounts');
  assert.ok((await b.$('body').getText()).includes('does not include property and valuables'));
  await nav('Household');
  await waitUntilOrDiagnose(b, async () => (await householdWorth()).includes('$1,250.00'), {timeout:10000, timeoutMsg:'Household updates after editing current property'});
  const text = await householdWorth();
  assert.ok(text.includes('QA Owner'));
  assert.ok(!text.includes('$1,100.00'));
  console.log('FEATURE 321 PASSED: current property edit updates Accounts, current Dashboard net worth and Household; historical trend stays unchanged.');
} finally { await app.close(); }
