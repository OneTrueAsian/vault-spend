// Task 10: account rows, independent controls and themed action menus. UAT s7.1: laid out as in the UI
// mockup, one card per group (its name and total on top) holding a row per account, the biggest first,
// and Property and valuables as the last such group.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp, chooseStyle, chooseRowAction, withFocusRetry, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";
const shots = process.env.VS_T10_SHOTS ?? makeTempDir("vault-task10-shots-");
fs.mkdirSync(shots, { recursive: true });
const dbDir = await seedFixture(`
for i, kind in enumerate(['checking', 'savings', 'checking', 'credit', 'credit', 'loan', 'loan', 'investment', 'investment', 'other']):
    name = 'Long family account name that remains readable at narrow widths' if i == 2 else f'Family account {i+1}'
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES (?,?,?)", (name, kind, str(1200 + i * 120)))
# Property rows: an unknown stored type ("property") shows capitalised.
cur.execute("INSERT INTO assets (name, asset_type, value, valued_on) VALUES ('2022 Family car', 'vehicle', '24500.00', date('now')), ('Our House', 'property', '415000.00', date('now'))")
`);
const app = await launchApp({ dbDir }); const browser = app.browser;
async function accounts() {
  await browser.$('.nav-item[data-tab=accounts]').click();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => !!document.querySelector('.account-card, [data-account-back]')), { timeoutMsg: 'Accounts navigation has rendered' });
  const back = await browser.$('[data-account-back]');
  if (await back.isExisting()) await back.click();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => document.querySelectorAll('.account-card[data-account-id]').length === 10), { timeoutMsg: 'All account rows should load' });
}
try {
  await accounts();
  await waitUntilOrDiagnose(browser, () => browser.execute(() => [...document.querySelectorAll("[data-property-assets] .account-name-detail-static")].some((d) => d.textContent.startsWith("Property · updated "))), { timeoutMsg: "an unknown stored property type shows capitalised" });
  // The mockup's layout: each group is one card headed by its name and total; debts read as an amount owed;
  // the totals' labels sit above their figures; the biggest balance comes first in a group.
  let layout = null;
  await waitUntilOrDiagnose(browser, async () => {
    layout = await browser.execute(() => ({
      heads: [...document.querySelectorAll('.account-group > .account-group-head')].map((h) => [h.querySelector('h2').textContent, h.querySelector('.account-group-total').textContent]),
      tiles: [...document.querySelectorAll('.stats .stat')].map((t) => t.firstElementChild.textContent),
      sub: document.querySelector('.view-sub')?.textContent,
      firstLoan: [...document.querySelectorAll('.account-group')].find((g) => g.querySelector('h2').textContent === 'Loans')?.querySelector('.account-card-open')?.textContent,
    }));
    return layout.heads.length === 6;
  }, { timeoutMsg: 'every group should be a card with a header', extra: () => layout });
  const names = layout.heads.map(([n]) => n).join(' | ');
  if (names !== 'Cash | Credit cards | Loans | Investments | Other assets | Property and valuables') throw new Error(`group cards in order: ${names}`);
  if (!layout.heads.filter(([n]) => n === 'Credit cards' || n === 'Loans').every(([, total]) => / owed$/.test(total))) throw new Error(`debt groups total what is owed: ${JSON.stringify(layout.heads)}`);
  if (layout.tiles.join(' | ') !== 'What you own | What you owe | Net worth') throw new Error(`tile labels come first: ${layout.tiles}`);
  if (layout.sub !== '10 accounts and 2 things you own') throw new Error(`the page says what it holds: ${layout.sub}`);
  if (layout.firstLoan !== 'Family account 7') throw new Error(`the bigger loan comes first: ${layout.firstLoan}`);
  for (const [name, palette] of [['Default','transparent'],['Futuristic','futuristic'],['Retro','retro']]) {
    await browser.setWindowSize(1440, 1000); await chooseStyle(browser, name, palette);
    for (const theme of ['light','dark']) {
      await browser.execute(t => [...document.querySelectorAll('.theme-toggle button')].find(b => b.textContent === t).click(), theme === 'light' ? 'Light' : 'Dark');
      await accounts();
      for (const width of [1440,1280,800]) {
        await browser.setWindowSize(width, 1000);
        await browser.executeAsync(done => document.fonts.ready.then(() => done()));
        await waitUntilOrDiagnose(browser, () => browser.execute(w => innerWidth <= w && innerWidth >= w - 40, width), { timeoutMsg: 'Requested viewport has applied' });
        await waitUntilOrDiagnose(browser, () => browser.execute(() => {
          const groups = [...document.querySelectorAll('.account-cards')];
          return groups.length > 0 && groups.every(group => {
            const rows = [...group.querySelectorAll('.account-card')];
            const first = rows[0].getBoundingClientRect();
            const right = rows[0].querySelector('.bal').getBoundingClientRect().right;
            return rows.every(row => {
              const rect = row.getBoundingClientRect();
              const detail = row.querySelector('.account-name-detail-static').textContent;
              return rect.right <= document.documentElement.clientWidth + 1 && Math.abs(rect.left-first.left) < 1 && Math.abs(rect.width-first.width) < 1 && Math.abs(row.querySelector('.bal').getBoundingClientRect().right-right) < 1 &&
                !/\b(checking|savings|loan|investment|credit)\b/.test(detail) && row.scrollWidth <= row.clientWidth + 1 && [...row.querySelectorAll('button.amount-editable')].every(button => {
                  const target = button.getBoundingClientRect();
                  return target.height >= 28 && target.width >= 28;
                });
            });
          }) && document.documentElement.scrollWidth <= innerWidth + 1;
        }), { timeoutMsg: `${palette}/${theme}/${width}: rows and balances align without overflow` });
        // Property and valuables: its two rows have their own ⋯ menu, like the account rows.
        await waitUntilOrDiagnose(browser, () => browser.execute(() => {
          const rows = [...document.querySelectorAll("[data-property-assets] .account-card")];
          return rows.length === 2 && rows.every((r) => !!r.querySelector("[data-row-menu]"));
        }), { timeoutMsg: `${palette}/${theme}/${width}: property rows each have a ⋯ menu` });
      }
      await browser.saveScreenshot(path.join(shots, `${palette}-${theme}-800.png`));
      const row = '.account-card[data-account-id="1"]';
      await withFocusRetry(browser, async () => {
        await browser.$(`${row} .bal`).click();
        const input = await browser.$(`${row} .amount-edit-input`);
        await input.waitForDisplayed({ timeout: 5000 });
        await input.click();
        await browser.keys('Escape');
        await waitUntilOrDiagnose(browser, async () => !(await browser.$(`${row} .amount-edit-input`).isExisting()), { timeoutMsg: 'Escape closes only the balance editor' });
      });
      await chooseRowAction(browser, `${row} [data-row-menu]`, 'Edit…');
      await browser.$('.modal-panel').waitForDisplayed({ timeout: 5000 });
      await browser.$("//div[contains(@class,'modal-panel')]//button[normalize-space()='Cancel']").click();
      await browser.setWindowSize(1440,1000);
      await browser.$(row).click();
      await browser.$('[data-account-detail="1"]').waitForDisplayed({ timeout: 5000 });
      await accounts();
      await browser.$(`${row} .account-card-open`).click();
      await browser.$('[data-account-detail="1"]').waitForDisplayed({ timeout: 5000 });
    }
  }
  console.log(`Task 10 screenshots: ${shots}`);
} finally { await app.close(); }
