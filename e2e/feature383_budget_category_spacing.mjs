// The Budget category drilldown reserves room for its checkboxes and dates, including at 720px.
// Set VS_SCREENS_DIR to retain the compiled-app screenshots.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, chooseStyle } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
period = today.strftime("%Y-%m")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '1000.00')")
acct = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", (period,))
cur.execute("INSERT OR REPLACE INTO budgets (category, period, monthly_amount, budget_group) VALUES ('Income', ?, '3000.00', 'income')", (period,))
for day, desc in ((1, 'DEPOSIT LEMONADE INSURANCE'), (9, 'Deposit by Check Mobile Chk Dep'), (28, 'Deposit ' + 'W' * 70)):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, ?, ?, '100.00', 'Income', 'user', ?)",
                (acct, today.replace(day=day).isoformat(), desc, f'spacing-{day}'))
`);
const shotsDir = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature383-");
fs.mkdirSync(shotsDir, { recursive: true });
const app = await launchApp({ dbDir });
const { browser: b } = app;
const table = ".modal-table-scroll .ledger";

async function checkSpacing(label) {
  const geometry = await b.execute((selector) => {
    const table = document.querySelector(selector);
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const textRect = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return rect(range);
    };
    return {
      rows: [...table.rows].map((row) => ({
        box: rect(row.cells[0].querySelector("input")),
        cell: rect(row.cells[0]),
        date: textRect(row.cells[1]),
        dateCell: rect(row.cells[1]),
        descriptionCell: rect(row.cells[2]),
        dateSpills: row.cells[1].scrollWidth > row.cells[1].clientWidth + 1,
      })),
      panelOverflow: document.querySelector(".modal-panel").scrollWidth - document.querySelector(".modal-panel").clientWidth,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
    };
  }, table);
  assert.equal(geometry.rows.length, 4, `${label}: header and three transactions`);
  for (const row of geometry.rows) {
    assert.ok(row.box.left >= row.cell.left && row.box.right <= row.cell.right, `${label}: checkbox stays in its column: ${JSON.stringify(row)}`);
    assert.ok(row.date.left - row.box.right >= 12, `${label}: checkbox has at least 12px before date: ${JSON.stringify(row)}`);
    assert.ok(!row.dateSpills && row.date.right <= row.descriptionCell.left, `${label}: date stays out of description`);
    assert.ok(Math.abs((row.box.top + row.box.bottom - row.date.top - row.date.bottom) / 2) <= 3, `${label}: checkbox and date align vertically`);
  }
  assert.ok(geometry.panelOverflow <= 1 && geometry.pageOverflow <= 1, `${label}: only the table may scroll horizontally`);
  console.log(`${label}: ${JSON.stringify(geometry)}`);
  await b.saveScreenshot(path.join(shotsDir, `${label}.png`));
}

try {
  for (const [style, palette, theme] of [
    ["Default", "transparent", "Dark"], ["Retro", "retro", "Dark"], ["Futuristic", "futuristic", "Dark"],
    ["Default", "transparent", "Light"], ["Retro", "retro", "Light"], ["Futuristic", "futuristic", "Light"],
  ]) {
    await chooseStyle(b, style, palette);
    await (await b.$(`//div[contains(@class,'appearance-theme')]//button[normalize-space()='${theme}']`)).click();
    await (await b.$("nav button[aria-label='Budget']")).click();
    const category = await b.$("//span[contains(@class,'category-link') and normalize-space()='Income']");
    await category.waitForClickable({ timeout: 10000 });
    await category.click();
    await b.$(`${table} tbody tr`).waitForExist({ timeout: 10000 });
    // Wait for the dialog's entrance transform to settle before measuring pixel gaps.
    await b.waitUntil(() => b.execute(() => getComputedStyle(document.querySelector(".modal-panel")).transform === "none"), { timeout: 5000 });
    for (const width of [1280, 720]) {
      await b.setWindowSize(width, 800);
      await checkSpacing(`${palette}-${theme.toLowerCase()}-${width}`);
      const selectAll = await b.$(`${table} thead input`);
      await selectAll.click();
      assert.equal((await b.$$(`${table} tbody input:checked`)).length, 3, "Select all still works");
      await selectAll.click();
      assert.equal((await b.$$(`${table} tbody input:checked`)).length, 0, "Select all clears selection");
    }
    await b.keys("Escape");
    await b.$(".modal-panel").waitForExist({ reverse: true, timeout: 5000 });
  }
  console.log(`PASS feature383 (screenshots in ${shotsDir})`);
} finally {
  await app.close();
}
