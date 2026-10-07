// Task 9: chart coordinates, labels and plot use the card's full pixel width.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, chooseStyle, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
const shots = process.env.VS_T9_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), "vault-task9-shots-"));
fs.mkdirSync(shots, { recursive: true });
const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Chart checking', 'checking', '250000.00')")
account = cur.lastrowid
for back in range(12):
    year, month = divmod(today.year * 12 + today.month - 1 - back, 12)
    date = datetime.date(year, month + 1, 1).isoformat()
    for name, amount, category in [('Pay', '19000.00', 'Income'), ('Food', '-6000.00', 'Groceries')]:
        cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)", (account, date, name, amount, category, 'user', f't9-{back}-{name}'))
`);
const app = await launchApp({ dbDir });
const browser = app.browser;
async function geometry(selector, count) {
  await waitUntilOrDiagnose(browser, async () => browser.execute((sel, expected) => {
    const charts = [...document.querySelectorAll(sel)];
    return charts.length >= expected && charts.every(svg => {
      const card = svg.closest('.card');
      if (!card) return false;
      const css = getComputedStyle(card);
      const content = card.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const rect = svg.getBoundingClientRect();
      const logical = svg.viewBox.baseVal.width;
      return rect.width >= content * .9 && Math.abs(logical - rect.width) <= 1 &&
        rect.width <= content + 1 && document.documentElement.scrollWidth <= innerWidth + 1 &&
        [...svg.querySelectorAll('text.axis-label')].every(label => {
          const bounds = label.getBBox();
          return bounds.x >= -1 && bounds.x + bounds.width <= logical + 1;
        });
    });
  }, selector, count), { timeoutMsg: `Charts must draw at the card width: ${selector}`, timeout: 12000 });
  console.log(await browser.execute(sel => [...document.querySelectorAll(sel)].map(svg => ({ width: svg.getBoundingClientRect().width, viewBox: svg.getAttribute('viewBox') })), selector));
}
async function cashFlowTab(name) {
  await waitUntilOrDiagnose(browser, () => browser.execute(wanted =>
    [...document.querySelectorAll('.reports-view .tabs button')].some(button => button.textContent.trim() === wanted), name),
    { timeoutMsg: `Cash Flow should render the ${name} tab` });
  await browser.execute(wanted => [...document.querySelectorAll('.reports-view .tabs button')].find(button => button.textContent.trim() === wanted).click(), name);
}
try {
  for (const [label, palette] of [['Default', 'transparent'], ['Futuristic', 'futuristic'], ['Retro', 'retro']]) {
    await chooseStyle(browser, label, palette);
    for (const theme of ['light', 'dark']) {
      await browser.execute(label => [...document.querySelectorAll('.theme-toggle button')].find(button => button.textContent === label).click(), theme === 'light' ? 'Light' : 'Dark');
      await waitUntilOrDiagnose(browser, () => browser.execute(t => document.documentElement.dataset.theme === t, theme), { timeoutMsg: `Apply ${theme}` });
      await browser.$('.nav-item[data-tab=cashflow]').click();
      await cashFlowTab('Overview');
      for (const width of [1440, 1280, 800]) {
        await browser.setWindowSize(width, 1000);
        await geometry('.reports-view .chart-fit > svg', 1);
      }
      await browser.setWindowSize(1440, 1000);
      await geometry('.reports-view .chart-fit > svg', 1);
      await browser.saveScreenshot(path.join(shots, `${palette}-${theme}-cashflow.png`));
      await cashFlowTab('Forecast');
      for (const width of [1440, 1280, 800]) {
        await browser.setWindowSize(width, 1000);
        await geometry('.reports-view .chart-fit > svg', 1);
      }
      await browser.setWindowSize(1440, 1000);
      await geometry('.reports-view .chart-fit > svg', 1);
      await browser.saveScreenshot(path.join(shots, `${palette}-${theme}-forecast.png`));
      await browser.$('.nav-item[data-tab=accounts]').click();
      const back = await browser.$('[data-account-back]');
      if (await back.isExisting()) await back.click();
      const details = await browser.$('[data-account-details]');
      await details.waitForDisplayed({ timeout: 10000 });
      await details.click();
      for (const width of [1440, 1280, 800]) {
        await browser.setWindowSize(width, 1000);
        await geometry('[data-account-detail] .chart-fit > svg', 1);
      }
      await browser.saveScreenshot(path.join(shots, `${palette}-${theme}-account-800.png`));
      await browser.setWindowSize(1440, 1000);
    }
  }
  console.log(`Task 9 six-theme, three-width screenshots: ${shots}`);
} finally { await app.close(); }
