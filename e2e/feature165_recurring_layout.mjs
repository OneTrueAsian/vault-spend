// The Recurring list stays readable at full width and in a half-width window (UI review,
// 2026-10-04). It reused the Transactions table's fixed column plan without that table's column
// widths, so its seven columns were forced equal: the three status buttons ran under Edit
// ("CancEditl") at 1440px, and at 800px merchant and account names printed over each other.
//
// In the Default, Futuristic and Retro styles, for every row, at 1440, 1400, 1280, 1241 (the
// narrowest table), 1240 (the widest card layout) and 800px: no two of its cells' contents
// overlap, the status buttons and Edit / Delete don't overlap, the page doesn't scroll sideways,
// and the table fits inside its own box (Futuristic's table once scrolled inside it at 1120px).
// Wherever the list is a table, cadence labels ("Every 2 weeks") and "Due soon" stay on one line.
// From 1400px, account names ("Joint Checking") and "Iron Works Gym" do too, and at 1440px in
// Default every merchant name does. A name longer than the 14rem name column ("RIVERSIDE HOSPITAL
// PAYROLL" at 1400px, or in Futuristic's wider capitals) may wrap.
//
// Run with: node e2e/run-all.mjs --spec=165

import { launchApp, chooseStyle, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today().isoformat()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Joint Checking', 'checking', '1000.00')")
acct = cur.lastrowid
for merchant, amount, cadence in [("Comcast Internet", "-79.99", "monthly"), ("Verizon Wireless", "-142.00", "monthly"), ("RIVERSIDE HOSPITAL PAYROLL", "1650.00", "biweekly"), ("Spotify Family", "-16.99", "monthly"), ("Iron Works Gym", "-45.00", "annual")]:
    cur.execute("INSERT INTO recurring (merchant, amount, cadence, anchor_date, account_id) VALUES (?, ?, ?, ?, ?)", (merchant, amount, cadence, today, acct))
`);

const app = await launchApp({ dbDir });
const { browser } = app;

function fail(message) {
  throw new Error(message);
}

/** Pairs of overlapping boxes in each Recurring row: cell contents against each other, and every
 * button against every other button. Boxes are the elements' own client rects, so text that spills
 * out of a too-narrow cell is measured where it is drawn. */
const overlaps = () =>
  browser.execute(() => {
    const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const contentBox = (td) => {
      const range = document.createRange();
      range.selectNodeContents(td);
      return range.getBoundingClientRect();
    };
    const found = [];
    for (const tr of document.querySelectorAll("table[data-recurring-table] tbody tr")) {
      const name = tr.querySelector(".account-name-cell")?.textContent ?? "?";
      const cells = [...tr.children].map((td) => ({ label: td.getAttribute("data-label") ?? td.className, box: contentBox(td) }));
      for (let i = 0; i < cells.length; i++)
        for (let j = i + 1; j < cells.length; j++)
          if (cells[i].box.width > 0 && cells[j].box.width > 0 && hit(cells[i].box, cells[j].box)) found.push(`${name}: ${cells[i].label} / ${cells[j].label}`);
      const buttons = [...tr.querySelectorAll("button")].map((b) => ({ label: b.textContent.trim(), box: b.getBoundingClientRect() }));
      for (let i = 0; i < buttons.length; i++)
        for (let j = i + 1; j < buttons.length; j++) if (hit(buttons[i].box, buttons[j].box)) found.push(`${name}: ${buttons[i].label} / ${buttons[j].label} buttons`);
    }
    return found;
  });

/** Text in each Recurring row that runs onto a second line: the cadence and "Due soon" labels,
 * plus the account name when `account` is set and merchant names when `merchants` is "all" or
 * names that one merchant. Lines are counted from the text's own line boxes, so this measures what
 * is drawn, not the cell's height. */
const wrappedText = ({ account, merchants }) =>
  browser.execute(
    (account, merchants) => {
      const lines = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
      };
      const found = [];
      for (const tr of document.querySelectorAll("table[data-recurring-table] tbody tr")) {
        const parts = [tr.querySelector('td[data-label="Cadence"] .confidence-badge'), tr.querySelector('td[data-label="Next due"] .budget-alert-badge')];
        if (account) parts.push(tr.querySelector('td[data-label="Account"]'));
        const merchant = tr.querySelector(".account-name-cell");
        if (merchants === "all" || merchant?.textContent.trim() === merchants) parts.push(merchant);
        for (const el of parts) if (el && lines(el) > 1) found.push(el.textContent.trim());
      }
      return found;
    },
    account,
    merchants,
  );

/** Whether the list is drawn as a table (not the narrow card layout), and if so whether the table
 * is wider than the box it scrolls in. */
const tableFit = () =>
  browser.execute(() => {
    const table = document.querySelector("table[data-recurring-table]");
    const isTable = getComputedStyle(table.querySelector("thead")).display !== "none";
    const box = table.parentElement;
    return { isTable, table: Math.round(table.getBoundingClientRect().width), box: box.clientWidth };
  });

try {
  for (const [style, palette] of [
    ["Default", "transparent"],
    ["Futuristic", "futuristic"],
    ["Retro", "retro"],
  ]) {
    await browser.setWindowSize(1440, 1000);
    await chooseStyle(browser, style, palette);
    for (const [width, height] of [
      [1440, 1000],
      [1400, 900],
      [1280, 900],
      [1241, 900],
      [1240, 900],
      [800, 900],
    ]) {
      await browser.setWindowSize(width, height);
      for (const b of await browser.$$("nav button")) if ((await b.getText()).trim() === "Recurring") await b.click();
      await waitUntilOrDiagnose(browser, async () => (await browser.$$("table[data-recurring-table] tbody tr")).length === 5, {
        timeoutMsg: "the Recurring list should show the five seeded items",
      });
      await browser.pause(400);
      const found = await overlaps();
      if (found.length) fail(`${palette} at ${width}px, parts of Recurring rows overlap:\n  ${found.join("\n  ")}`);
      const sideways = await browser.execute(() => document.documentElement.scrollWidth > window.innerWidth);
      if (sideways) fail(`${palette} at ${width}px the page scrolls sideways`);
      const fit = await tableFit();
      if (fit.isTable !== width > 1240) fail(`${palette} at ${width}px the list should be ${width > 1240 ? "a table" : "cards"}`);
      if (fit.isTable && fit.table > fit.box + 1) fail(`${palette} at ${width}px the table (${fit.table}px) is wider than its box (${fit.box}px)`);
      if (fit.isTable) {
        const wide = width >= 1400;
        const merchants = !wide ? null : width === 1440 && palette === "transparent" ? "all" : "Iron Works Gym";
        const wrapped = await wrappedText({ account: wide, merchants });
        if (wrapped.length) fail(`${palette} at ${width}px this text wraps onto a second line: ${wrapped.join(", ")}`);
      }
      console.log(`${palette} ${width}px: no overlaps`);
    }
  }
  console.log("FEATURE 165 E2E TEST PASSED");
} finally {
  await app.close();
}
