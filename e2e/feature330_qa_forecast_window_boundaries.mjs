// UAT-127: Cash Flow 30/60/90-day forecast window boundaries. Annual bills sit at +29/+30/+31, +59/+60/+61 and +89/+90/+91 days from today.
// The window includes day N itself (bill_aware_forecast: date <= today + days) and excludes N+1. With no history the everyday baseline is 0.
// Amounts are powers of two so every subset has one sum: 30 days -> 1+2 = 3 (997.00 on day +30); 60 -> 1+2+4+8+16 = 31 (969.00 on +60); 90 -> 31+32+64+128 = 255 (745.00 on +90).
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const OFFSETS = [[29, 1], [30, 2], [31, 4], [59, 8], [60, 16], [61, 32], [89, 64], [90, 128], [91, 256]];
const dbDir = await seedFixture(`
import datetime
today=datetime.date.today()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Checking','checking','1000.00')")
acct=cur.lastrowid
for days,amount in ${JSON.stringify(OFFSETS)}:
    cur.execute("INSERT INTO recurring(merchant,category,amount,cadence,anchor_date,account_id) VALUES(?,NULL,?,'annual',?,?)",(f'QA Bill {days}','-%d.00'%amount,(today+datetime.timedelta(days=days)).isoformat(),acct))
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const display = offset => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  const text = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.getFullYear() === new Date().getFullYear() ? text : `${text}, ${d.getFullYear()}`;
};
const readForecast = () => b.execute(() => ({
  lowest: document.querySelector('[data-forecast-lowest]')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
  events: [...document.querySelectorAll('.forecast-events li')].map(li => [li.querySelector('.forecast-event-label').textContent, li.querySelector('.forecast-event-amount').textContent]),
}));
const clickTab = async label => {
  await waitUntilOrDiagnose(b, () => b.execute(l => !![...document.querySelectorAll('.tab-btn')].find(x => x.textContent.trim() === l), label), { timeout: 10000, timeoutMsg: `tab ${label} is shown` });
  await b.execute(l => [...document.querySelectorAll('.tab-btn')].find(x => x.textContent.trim() === l).click(), label);
};
const expected = { 30: [3, 30], 60: [31, 60], 90: [255, 90] };
try {
  await b.setWindowSize(1280, 900);
  await (await b.$('.nav-item[aria-label="Cash Flow"]')).click();
  await clickTab('Forecast');
  for (const days of [30, 60, 90]) {
    await clickTab(`${days} days`);
    const [spent, lastDay] = expected[days];
    const lowest = `Lowest balance: $${(1000 - spent).toFixed(2)} on ${display(lastDay)}`;
    try { await waitUntilOrDiagnose(b, async () => (await readForecast()).lowest === lowest, { timeout: 10000, timeoutMsg: `${days} days: ${lowest}` }); } catch (error) { error.message += ' ACTUAL ' + JSON.stringify(await readForecast()); throw error; }
    const { events } = await readForecast();
    const inside = OFFSETS.filter(([d]) => d <= days);
    assert.deepEqual(events.map(e => e[0]), inside.map(([d]) => `QA Bill ${d}`), `${days} days: bills on day ${days} are in, on day ${days + 1} are out`);
    assert.deepEqual(events.map(e => e[1]), inside.map(([, a]) => `-$${a}.00`));
  }
  console.log('FEATURE 330 PASSED: 30/60/90-day forecast windows include day N and exclude day N+1; lowest balance and dated events match hand sums.');
} finally { await app.close(); }
