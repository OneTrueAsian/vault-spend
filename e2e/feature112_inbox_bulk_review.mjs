import assert from "node:assert/strict";
import { launchApp, pickFromMenu, reclaimWindowFocus } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000')")
acct = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Savings', 'savings', '1000')")
for days, desc, amount, category, source, confidence in [
    (1, 'Unknown One', '-10', None, None, None),
    (2, 'Unknown Two', '-20', None, None, None),
    (3, 'Bakery', '-12', 'Dining Out', 'classifier', 0.5),
    (4, 'Netflix', '-15.49', 'Subscriptions', 'user', None),
    (5, 'Netflix', '-15.49', 'Subscriptions', 'user', None),
]:
    day = (today - datetime.timedelta(days=days)).isoformat()
    cur.execute("INSERT INTO transactions (account_id,date,description,amount,category,category_source,confidence,fingerprint) VALUES (?,?,?,?,?,?,?,?)", (acct,day,desc,amount,category,source,confidence,f'{day}|{desc}'))
`);

async function transactions(b) {
  for (const button of await b.$$("nav button")) {
    if ((await button.getText()).trim() === "Transactions") { await button.click(); break; }
  }
  await b.$("#ledger-account-select").waitForExist({ timeout: 10000 });
}
let app = await launchApp({ dbDir });
try {
  const b = app.browser;
  await b.setWindowSize(960, 900);
  await transactions(b);
  // Opens the Add-to menu and measures it. The menu is dismissed by blur by design, so if another
  // spec's window takes OS foreground mid-way (the parallel runner does this constantly — see
  // reclaimWindowFocus) it closes and this reports `missing`. The caller retries ONLY when the
  // window actually lost focus; a menu missing in a focused window is a real failure.
  async function openAndMeasureAddToMenu() {
    await reclaimWindowFocus(b);
    await (await b.$("#ledger-account-select")).click();
    await b.$('[role="menu"][aria-label="Add to account"]').waitForExist({ timeout: 5000 }).catch(() => {});
    // :hover stops applying once another window takes OS foreground, so a timeout here in an unfocused
    // window is the same focus loss as a closed menu: report it as `missing` for the caller to retry.
    let hoverSettled = true;
    await b.waitUntil(async () => b.execute(() => {
      const reference = document.createElement('span');
      reference.style.background = 'var(--surface-2)';
      document.body.append(reference);
      const expected = getComputedStyle(reference).backgroundColor;
      reference.remove();
      return getComputedStyle(document.querySelector('#ledger-account-select')).backgroundColor === expected;
    }), { timeout: 5000, timeoutMsg: 'Add to hover should use the themed field surface, not the primary-action fill' }).catch(async (error) => {
      if (await b.execute(() => document.hasFocus())) throw error;
      hoverSettled = false;
    });
    if (!hoverSettled) return { missing: true, hasFocus: false };
    return b.execute(() => {
      const panel = document.querySelector('.account-destination-panel');
      if (!panel) return { missing: true, menuStillOpen: Boolean(document.querySelector('[role="menu"]')), hasFocus: document.hasFocus(), active: document.activeElement?.id || document.activeElement?.tagName };
      const rect = panel.getBoundingClientRect();
      return { radius: getComputedStyle(panel).borderRadius, left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight };
    });
  }
  for (const palette of ["classic", "futuristic", "transparent"]) {
    for (const theme of ["light", "dark"]) {
      await b.execute((palette, theme) => { document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = theme; }, palette, theme);
      let geometry;
      for (let attempt = 0; attempt < 3; attempt++) {
        geometry = await openAndMeasureAddToMenu();
        if (!geometry.missing || geometry.hasFocus) break;
      }
      assert.ok(!geometry.missing, `the Add-to menu closed before it could be measured (${palette}/${theme}: ${JSON.stringify(geometry)})`);
      assert.equal(geometry.radius, "10px");
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && geometry.bottom <= geometry.height);
      await b.keys("Escape");
      assert.ok(await b.execute(() => document.activeElement.id === 'ledger-account-select'));
    }
  }
  await (await b.$("#ledger-account-select")).click();
  await b.keys(["Home"]);
  await b.keys(["ArrowDown"]);
  await b.keys("Enter");
  assert.ok((await b.$("#ledger-account-select").getText()).includes("Savings"));
  await (await b.$("button*=Add transaction")).click();
  await b.$('.modal-field .menu-select-toggle').waitForExist({ timeout: 5000 });
  assert.ok(await b.execute(() => [...document.querySelectorAll('.modal-panel .menu-select-toggle')].some((el) => el.textContent.replace('\u25be', '').trim() === 'Savings')));
  await b.keys("Escape");
  // Closing a modal hands focus back to its opener one tick after it unmounts.
  // Opening the dropdown before that lands means the restore steals focus from
  // the menu and its blur handler closes it, so wait for the hand-back first.
  await b.waitUntil(
    async () => b.execute(() => !document.querySelector(".modal-panel") && document.activeElement?.textContent?.startsWith("Add transaction")),
    { timeout: 5000, timeoutMsg: "focus should return to the Add transaction button once its modal closes" },
  );
  await pickFromMenu(b, "#ledger-account-select", ".account-destination-new");
  await b.$(".modal-panel").waitForExist({ timeout: 5000 });
  await b.waitUntil(async () => (await b.$('.modal-panel').getText()).includes('New account'), { timeout: 5000 });
  await b.keys("Escape");

  await (await b.$("[data-inbox-open]")).click();
  await b.$("[data-inbox-bulk]").waitForExist({ timeout: 5000 });
  assert.equal((await b.$$("[data-inbox-row]")).length, 5);
  for (const palette of ['classic', 'futuristic', 'transparent']) for (const theme of ['light', 'dark']) {
    await b.execute((palette, theme) => { document.documentElement.dataset.palette = palette; document.documentElement.dataset.theme = theme; }, palette, theme);
    await (await b.$('[data-inbox-row] .inbox-category-trigger')).click();
    const style = await b.execute(() => {
      const menu = document.querySelector('.inbox-category-menu');
      const r = menu.getBoundingClientRect();
      return { topLayer: menu.matches(':popover-open'), radius: getComputedStyle(menu).borderRadius,
        visible: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
        nativeSelects: document.querySelectorAll('[data-inbox-list] select, [data-inbox-bulk] select').length };
    });
    assert.deepEqual(style, { topLayer: true, radius: '10px', visible: true, nativeSelects: 0 });
    await b.keys('Escape');
    assert.equal(await b.$('.inbox-category-menu').isExisting(), false);
    assert.ok(await b.$('[data-inbox-list]').isExisting(), 'Escape must leave the inbox open');
    assert.ok(await b.execute(() => document.activeElement.classList.contains('inbox-category-trigger')));
  }

  await (await b.$('[aria-label^="Select Unknown One on"]')).click();
  await (await b.$('[aria-label^="Select Unknown Two on"]')).click();
  assert.equal(await b.$('[data-inbox-review-selected]').isEnabled(), false);
  await (await b.$('button[aria-label="Category for selected transactions"]')).click();
  await (await (await b.$('.inbox-category-menu')).$('button*=Groceries')).click();
  await (await b.$('[data-inbox-review-selected]')).click();
  await b.waitUntil(async () => (await b.$$('[data-inbox-state="done"]')).length === 2, { timeout: 10000 });
  assert.equal((await b.$$('[data-inbox-state="open"]')).length, 3);
  await (await b.$('[data-inbox-close]')).click();
  await b.$('.modal-panel').waitForExist({ reverse: true, timeout: 10000 });
  await b.waitUntil(async () => (await b.$('[data-inbox-open]').getText()).includes('(3)'), { timeout: 10000 });
  await (await b.$('[data-inbox-open]')).click();
  await b.$('[data-inbox-bulk]').waitForExist({ timeout: 5000 });
  await (await b.$('[aria-label="Select all remaining transactions"]')).click();
  await (await b.$('[data-inbox-review-selected]')).click();
  await b.waitUntil(async () => (await b.$('[data-inbox-summary]').getText()).includes('All 3 reviewed'), { timeout: 10000 });
  await (await b.$('[data-inbox-close]')).click();
  await b.$('[data-inbox-open]').waitForExist({ reverse: true, timeout: 10000 });
} finally { await app.close(); }

// Restart verifies category corrections and flag dismissals were persisted.
app = await launchApp({ dbDir });
try {
  const b = app.browser;
  await transactions(b);
  await b.$('.ledger').waitForExist({ timeout: 10000 });
  assert.equal(await b.$('[data-inbox-open]').isExisting(), false);
  const text = await b.$('.ledger').getText();
  assert.equal((text.match(/Netflix/g) ?? []).length, 2, 'bulk review keeps both possible duplicates');
  assert.ok(text.includes('Unknown One') && text.includes('Unknown Two'));
} finally { await app.close(); }
console.log('FEATURE 112 E2E TEST PASSED');
