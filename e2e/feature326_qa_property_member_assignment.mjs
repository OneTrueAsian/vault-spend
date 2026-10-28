// UAT-143: assign property to a family member through the actual row-menu gesture and read it back in Household (current values only).
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose, chooseRowAction } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today=datetime.date.today().isoformat()
cur.execute("INSERT INTO family_members(name) VALUES('QA Alex')")
cur.execute("INSERT INTO family_members(name) VALUES('QA Blair')")
cur.execute("INSERT INTO assets(name,asset_type,value,valued_on) VALUES('QA Property','real_estate','100.00',?)",(today,))
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const nav = async label => { await (await b.$(`.nav-item[aria-label="${label}"]`)).click(); };
const people = () => b.execute(() => {
  const heading = [...document.querySelectorAll('h2')].find(e => e.textContent === 'Net worth by person');
  return Object.fromEntries([...(heading?.closest('.card')?.querySelectorAll('li') ?? [])].map(li => [li.children[0].textContent, li.children[1].textContent]));
});
const assign = async name => {
  await nav('Accounts');
  await (await b.$('.account-card[data-asset-id]')).waitForDisplayed({ timeout: 10000 });
  await chooseRowAction(b, '.account-card[data-asset-id] [data-row-menu]', `Belongs to ${name}`);
};
const expectPeople = async (expected, why) => {
  await nav('Household');
  await waitUntilOrDiagnose(b, async () => {
    const p = await people();
    return Object.entries(expected).every(([k, v]) => p[k] === v) && Object.entries(p).every(([k, v]) => k in expected || v === '$0.00');
  }, { timeout: 10000, timeoutMsg: why });
};
try {
  await b.setWindowSize(1280, 900);
  await expectPeople({ Unassigned: '$100.00' }, 'an unassigned property is counted under Unassigned');
  await assign('QA Alex');
  await expectPeople({ 'QA Alex': '$100.00' }, 'assigning to Alex moves the 100 to Alex only');
  await nav('Accounts');
  assert.ok((await (await b.$('.account-card[data-asset-id]')).getText()).includes('QA Alex'), 'the property row names its member');
  await assign('QA Blair');
  await expectPeople({ 'QA Blair': '$100.00' }, 'assigning to Blair replaces Alex (one member per property)');
  await assign('QA Blair');
  await expectPeople({ Unassigned: '$100.00' }, 'toggling the checked member off returns the value to Unassigned');
  console.log('FEATURE 326 PASSED: property member assignment via the row menu: Unassigned -> Alex -> Blair -> Unassigned, Household readback each step.');
} finally { await app.close(); }
