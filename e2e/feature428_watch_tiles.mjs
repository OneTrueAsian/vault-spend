// VS-46: watch tiles. Pinned through the real gestures (Layout > Customize > + Add widget > Pin a specific item), a
// category, a tag, a typed store and a saved filter each show this month's spending so far against a usual month, the
// average of the last 3 full months (owner decision 22 Nov 2026). The saved filter's own dates, years ago, are ignored.
// Corner Cafe: 30, 60 and 90 on the 1st of the last 3 months (usual 60.00) and 12.50 on the 1st of this one.
// Then: every tile's text stays inside it in Default, Futuristic and Retro, light and dark, at 1280 and 720, and the
// store tile's link opens Transactions on this month's Corner Cafe row only.
// Run with: node e2e/feature428_watch_tiles.mjs [--keep-screens]
import assert from "node:assert/strict";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose, chooseMenuOption, chooseStyle, dismissStatusMessages } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";
import { isoDaysFromNow } from "./lib/dates.mjs";

const SAVED = [{ name: "Cafe trips", searchText: "", filterCategory: "Coffee", filterAccountIds: "all", filterMemberIds: "all", filterFrom: isoDaysFromNow(-3650), filterTo: isoDaysFromNow(-3300), filterTag: "all" }];
const dbDir = await seedFixture(`
import datetime
today=datetime.date.today()
def first(back):
    y,m=today.year,today.month-back
    while m<=0:
        m+=12; y-=1
    return datetime.date(y,m,1)
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Checking','checking','1000.00')")
acct=cur.lastrowid
for c in ['Coffee','Groceries']:
    cur.execute("INSERT OR IGNORE INTO categories(name) VALUES(?)",(c,))
for back,amount in [(3,'-30.00'),(2,'-60.00'),(1,'-90.00'),(0,'-12.50')]:
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,'Coffee','user',?)",(acct,first(back).isoformat(),'Corner Cafe #12',amount,f'cafe{back}'))
    cur.execute("INSERT INTO transaction_tags(transaction_id,tag) VALUES(?,'treat')",(cur.lastrowid,))
cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,'Fresh Mart','-200.00','Groceries','user','grocer')",(acct,first(0).isoformat()))
cur.execute("INSERT INTO profile_ui_state(key,value) VALUES('saved_filters',?)",(${JSON.stringify(JSON.stringify(SAVED))},))
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const shots = makeTempDir("vaultspend-vs46-shots-");
const WATCHES = ["watch:category:Coffee", "watch:tag:treat", "watch:filter:Cafe trips", "watch:store:corner cafe"];

const tiles = () => b.execute(() => [...document.querySelectorAll('[data-widget-id^="watch:"]')].map(w => {
  const tile = w.querySelector("[data-watch-tile]");
  if (!tile) return { id: w.dataset.widgetId, missingTile: true };
  const t = tile.getBoundingClientRect();
  const lines = [];
  for (const el of tile.querySelectorAll(".stat-label, .stat-value, .stat-delta, .category-link")) {
    const r = document.createRange(); r.selectNodeContents(el);
    for (const x of r.getClientRects()) if (x.width > 0) lines.push({ text: el.textContent.slice(0, 30), left: x.left, right: x.right, top: x.top, bottom: x.bottom });
  }
  return {
    id: w.dataset.widgetId,
    name: tile.querySelector(".stat-label")?.textContent,
    value: tile.querySelector(".stat-value")?.textContent,
    usual: tile.querySelector("[data-watch-usual]")?.textContent,
    tile: { left: t.left, right: t.right, top: t.top, bottom: t.bottom },
    lines,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}));

try {
  await b.setWindowSize(1280, 900);
  await chooseMenuOption(await b.$(".layout-select-toggle"), { label: "Customize" });
  await b.execute(() => document.querySelector(".main")?.scrollTo(0, 0));
  await (await (await b.$(".dashboard-toolbar")).$("button*=Add widget")).click();
  const row = label => `//ul[contains(@class,"category-manage-list")]//li[.//span[text()="${label}"]]`;
  for (const [label, option] of [["Category", "Coffee"], ["Tag", "treat"], ["Saved filter", "Cafe trips"]]) {
    await (await b.$(`${row(label)}//button[@aria-label="Choose ${label}"]`)).waitForDisplayed({ timeout: 5000 });
    await chooseMenuOption(await b.$(`button[aria-label="Choose ${label}"]`), { label: option });
    await (await b.$(`${row(label)}//button[text()="Add"]`)).click();
  }
  await (await b.$('input[aria-label="Store name to watch"]')).setValue("corner cafe");
  await (await b.$(`${row("Store")}//button[text()="Add"]`)).click();
  await (await (await b.$(".modal-actions")).$("button=Done")).click();
  await chooseMenuOption(await b.$(".layout-select-toggle"), { label: "Done customizing" });

  for (const [style, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await chooseStyle(b, style, palette);
    for (const theme of ["light", "dark"]) {
      await b.execute(t => [...document.querySelectorAll('.theme-toggle[aria-label="Theme"] button')].find(el => el.textContent.trim().toLowerCase() === t).click(), theme);
      await waitUntilOrDiagnose(b, () => b.execute(t => document.documentElement.dataset.theme === t, theme), { timeoutMsg: `apply ${theme}` });
      await (await b.$('.nav-item[aria-label="Dashboard"]')).click();
      for (const width of [1280, 720]) {
        await b.setWindowSize(width, 900);
        const what = `${style} ${theme} ${width}px`;
        try {
          await waitUntilOrDiagnose(b, async () => {
            const found = await tiles();
            return found.length === 4 && found.every(t => t.value === "$12.50" && t.usual === "Usual month: $60.00");
          }, { timeout: 10000, timeoutMsg: `${what}: four watch tiles at $12.50 against a usual $60.00` });
        } catch (error) { error.message += " ACTUAL " + JSON.stringify((await tiles()).map(t => [t.id, t.value, t.usual])); throw error; }
        const found = await tiles();
        assert.deepEqual(found.map(t => t.id), WATCHES, `${what}: tiles in the order they were pinned`);
        for (const t of found) {
          for (const line of t.lines) {
            assert.ok(line.left >= t.tile.left - 1 && line.right <= t.tile.right + 1 && line.top >= t.tile.top - 1 && line.bottom <= t.tile.bottom + 1,
              `${what}: "${line.text}" stays inside the ${t.id} tile ${JSON.stringify({ line, tile: t.tile })}`);
          }
        }
        assert.ok(found[0].pageOverflow <= 1, `${what}: no sideways page scroll (${found[0].pageOverflow}px)`);
        if (width === 1280) {
          await dismissStatusMessages(b);
          await b.execute(() => document.querySelector('[data-widget-id^="watch:"]')?.scrollIntoView({ block: "center" }));
          await b.executeAsync(done => document.fonts.ready.then(() => requestAnimationFrame(() => done(true))));
          await b.saveScreenshot(path.join(shots, `${palette}-${theme}-watch-tiles.png`));
        }
      }
      await b.setWindowSize(1280, 900);
    }
  }

  // The store tile's link: Transactions, this month, Corner Cafe only.
  await b.execute(() => document.querySelector('[data-widget-id="watch:store:corner cafe"] .clickable-row').click());
  const ledger = () => b.execute(() => [...document.querySelectorAll(".ledger-table-scroll tbody tr")].map(tr => tr.textContent));
  try {
    await waitUntilOrDiagnose(b, async () => { const rows = await ledger(); return rows.length === 1 && rows[0].includes("Corner Cafe #12") && rows[0].includes("12.50"); },
      { timeout: 10000, timeoutMsg: "See this month's transactions shows only this month's Corner Cafe row" });
  } catch (error) { error.message += " ACTUAL " + JSON.stringify(await ledger()); throw error; }
  console.log(`FEATURE 428 PASSED: category, tag, store and saved-filter watch tiles show this month against a usual month, stay inside their tiles in every style and theme, and link to the matching transactions. Screenshots: ${shots}`);
} finally { await app.close(); }
