// The real monthly "Show all" table must stay readable, including in a narrow window.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { askHelpers } from "./lib/askRetirement.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";
import { dateInMonth } from "./lib/dates.mjs";

const dates = Array.from({ length: 6 }, (_, i) => dateInMonth(i - 6, 1));
const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts(name, account_type, starting_balance) VALUES('Checking', 'checking', '10000.00')")
account = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories(name) VALUES('Utilities')")
for date in ${JSON.stringify(dates)}:
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,'-100.00','Utilities','user',?)",
                (account, date, 'Utility payment', f'show-all-{date}'))
`);
const shots = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature386-");
fs.mkdirSync(shots, { recursive: true });
const app = await launchApp({ dbDir });
const b = app.browser, h = askHelpers(b);
async function checkRowColors(selector) {
  const colors = await b.execute(selector => {
    const table = document.querySelector(selector), row = table.tBodies[0].rows[0];
    return [...row.cells].map(cell => {
      const css = getComputedStyle(cell);
      return { background: css.backgroundColor, color: css.color, shadow: css.boxShadow };
    });
  }, selector);
  assert.equal(colors[0].background, colors[1].background, `${selector}: row heading and amount use the same background`);
  assert.equal(colors[0].color, colors[2].color, `${selector}: row heading uses body text color`);
  assert.equal(colors[0].shadow, "none", `${selector}: row heading is not raised like a column heading`);
  await (await b.$(`${selector} tbody tr`)).moveTo();
  const hovered = await b.execute(selector => {
    const row = document.querySelector(selector).tBodies[0].rows[0];
    const sample = document.createElement("span");
    sample.style.backgroundColor = "var(--surface-hover)"; row.appendChild(sample);
    const expected = getComputedStyle(sample).backgroundColor; sample.remove();
    return { hover: row.matches(":hover"), expected, backgrounds: [...row.cells].map(cell => getComputedStyle(cell).backgroundColor) };
  }, selector);
  assert.ok(hovered.hover, "The real pointer reaches the row");
  assert.ok(hovered.backgrounds.every(color => color === hovered.expected), `${selector}: whole row uses theme hover color: ${JSON.stringify(hovered)}`);
  await (await b.$(".ledger-qa-card input")).moveTo();
}
try {
  for (const [style, palette, theme] of [
    ["Default", "transparent", "Light"], ["Default", "transparent", "Dark"],
    ["Retro", "retro", "Light"], ["Retro", "retro", "Dark"],
    ["Futuristic", "futuristic", "Light"], ["Futuristic", "futuristic", "Dark"],
  ]) {
    await chooseStyle(b, style, palette);
    await (await b.$(`//div[contains(@class,'appearance-theme')]//button[normalize-space()='${theme}']`)).click();
    await h.openDashboard();
    await h.ask(`average monthly utilities from ${dates[0]} to ${dateInMonth(-1, 28)}`);
    const show = await b.$("button=Show all 6");
    await show.waitForClickable({ timeout: 10000 });
    await (await b.$(".ledger-qa-card .ledger-qa-breakdown")).scrollIntoView();
    await (await b.$(".ledger-qa-card input")).moveTo();
    await checkRowColors(".ledger-qa-card .ledger-qa-breakdown");
    await b.saveScreenshot(path.join(shots, `${palette}-${theme.toLowerCase()}-inline.png`));
    await show.click();
    await b.$(".modal-panel .ledger-qa-breakdown").waitForExist({ timeout: 5000 });
    await b.waitUntil(() => b.execute(() => getComputedStyle(document.querySelector(".modal-panel")).transform === "none"), { timeout: 5000 });
    await checkRowColors(".modal-panel .ledger-qa-breakdown");
    for (const width of [1280, 960, 720]) {
      await b.setWindowSize(width, 800);
      const g = await b.execute(() => {
        const panel = document.querySelector(".modal-panel"), table = panel.querySelector("table");
        const scroll = table.parentElement, body = panel.querySelector(".modal-body");
        const headers = [...table.tHead.rows[0].cells].map(cell => {
          const range = document.createRange(); range.selectNodeContents(cell);
          return { textRight: range.getBoundingClientRect().right, right: cell.getBoundingClientRect().right };
        });
        const close = panel.querySelector(".modal-footer button").getBoundingClientRect();
        return { panelWidth: panel.getBoundingClientRect().width, headers, rows: table.tBodies[0].rows.length,
          detailWidth: table.tBodies[0].rows[0].cells[2].getBoundingClientRect().width,
          tableWidth: table.getBoundingClientRect().width, scrollWidth: scroll.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
          panelOverflow: panel.scrollWidth - panel.clientWidth, bodyOverflow: body.scrollWidth - body.clientWidth,
          closeVisible: close.top >= 0 && close.bottom <= innerHeight };
      });
      assert.equal(g.rows, 6, "All six months are shown");
      assert.ok(g.headers.every(header => header.textRight <= header.right + 1), `${style}/${width}: header text overlaps the next column: ${JSON.stringify(g)}`);
      assert.ok(g.detailWidth >= 240, `${style}/${width}: details need readable line lengths: ${JSON.stringify(g)}`);
      assert.ok(g.pageOverflow <= 1 && g.panelOverflow <= 1 && g.bodyOverflow <= 1 && g.closeVisible, `${style}/${width}: panel and Close stay within the viewport: ${JSON.stringify(g)}`);
      assert.ok(g.panelWidth >= 640 && g.tableWidth <= g.scrollWidth + 1, `${style}/${width}: use the available dialog width without horizontal scrolling`);
      await b.saveScreenshot(path.join(shots, `${palette}-${theme.toLowerCase()}-${width}.png`));
    }
    await b.keys("Escape");
    await b.$(".modal-panel").waitForExist({ reverse: true, timeout: 5000 });
    await b.setWindowSize(1280, 800);
  }
  console.log(`PASS feature386: inline and Show all row colors in six themes; dialog at 1280/960/720px; screenshots: ${shots}`);
} finally { await app.close(); }
