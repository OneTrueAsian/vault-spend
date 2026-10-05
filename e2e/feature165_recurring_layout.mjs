// The Recurring list stays readable at full width and in a half-width window (UI review,
// 2026-10-04). It reused the Transactions table's fixed column plan without that table's column
// widths, so its seven columns were forced equal: the three status buttons ran under Edit
// ("CancEditl") at 1440px, and at 800px merchant and account names printed over each other.
//
// For every row, at 1440px and 800px: no two of its cells' contents overlap, the status buttons
// and Edit / Delete don't overlap, and the page doesn't scroll sideways.
//
// Run with: node e2e/run-all.mjs --spec=165

import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today().isoformat()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Joint Checking', 'checking', '1000.00')")
acct = cur.lastrowid
for merchant, amount in [("Comcast Internet", "-79.99"), ("Verizon Wireless", "-142.00"), ("RIVERSIDE HOSPITAL PAYROLL", "1650.00"), ("Spotify Family", "-16.99")]:
    cur.execute("INSERT INTO recurring (merchant, amount, cadence, anchor_date, account_id) VALUES (?, ?, 'monthly', ?, ?)", (merchant, amount, today, acct))
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

try {
  for (const [width, height] of [
    [1440, 1000],
    [800, 900],
  ]) {
    await browser.setWindowSize(width, height);
    for (const b of await browser.$$("nav button")) if ((await b.getText()).trim() === "Recurring") await b.click();
    await waitUntilOrDiagnose(browser, async () => (await browser.$$("table[data-recurring-table] tbody tr")).length === 4, {
      timeoutMsg: "the Recurring list should show the four seeded items",
    });
    await browser.pause(400);
    const found = await overlaps();
    if (found.length) fail(`at ${width}px, parts of Recurring rows overlap:\n  ${found.join("\n  ")}`);
    const sideways = await browser.execute(() => document.documentElement.scrollWidth > window.innerWidth);
    if (sideways) fail(`at ${width}px the page scrolls sideways`);
    console.log(`${width}px: no overlaps`);
  }
  console.log("FEATURE 165 E2E TEST PASSED");
} finally {
  await app.close();
}
