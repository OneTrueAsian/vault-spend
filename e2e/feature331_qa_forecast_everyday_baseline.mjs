// UAT-127: forecast with enough history. Everyday net is the trailing average of non-recurring activity: -100 (20 days ago, earliest) and -200 (10 days ago)
// over 20 elapsed days = -15.00 per day. Opening 1000 - 300 = 700. Bills as in feature330 (+29,+30,+31,...). Day-N balance = 700 - 15N - bills due by N.
// 30 days: 700-450-3 = 247.00; 60 days: 700-900-31 = -231.00; 90 days: 700-1350-255 = -905.00; the lowest point is always the last day because the baseline keeps falling.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const OFFSETS = [[29, 1], [30, 2], [31, 4], [59, 8], [60, 16], [61, 32], [89, 64], [90, 128], [91, 256]];
const dbDir = await seedFixture(`
import datetime
today=datetime.date.today()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Checking','checking','1000.00')")
acct=cur.lastrowid
for days_ago,amount in [(20,'-100.00'),(10,'-200.00')]:
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,'Groceries','user',?)",(acct,(today-datetime.timedelta(days=days_ago)).isoformat(),f'QA Everyday {days_ago}',amount,f'everyday{days_ago}'))
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
const expected = { 30: [247, 30], 60: [-231, 60], 90: [-905, 90] };
try {
  await b.setWindowSize(1280, 900);
  await (await b.$('.nav-item[aria-label="Cash Flow"]')).click();
  await clickTab('Forecast');
  for (const days of [30, 60, 90]) {
    await clickTab(`${days} days`);
    const [balance, lastDay] = expected[days];
    const lowest = `Lowest balance: ${balance < 0 ? "-" : ""}$${Math.abs(balance).toFixed(2)} on ${display(lastDay)}`;
    try { await waitUntilOrDiagnose(b, async () => (await readForecast()).lowest === lowest, { timeout: 10000, timeoutMsg: `${days} days: ${lowest}` }); } catch (error) { error.message += ' ACTUAL ' + JSON.stringify(await readForecast()); throw error; }
    const { events } = await readForecast();
    const inside = OFFSETS.filter(([d]) => d <= days);
    assert.deepEqual(events.map(e => e[0]), inside.map(([d]) => `QA Bill ${d}`), `${days} days: bills on day ${days} are in, on day ${days + 1} are out`);
    assert.deepEqual(events.map(e => e[1]), inside.map(([, a]) => `-$${a}.00`));
  }
  console.log('FEATURE 331 PASSED: forecast with history combines the -15.00 daily everyday baseline with dated bills: 247.00 / -231.00 / -905.00 at the window ends.');
} finally { await app.close(); }
