// E2E test for Phase 3 item 11 (Sankey diagram + daily-spend heatmap):
//   - the Reports tab gets an income -> spending Sankey diagram (biggest
//     categories, "Other" for the rest, "Left over"/"Shortfall" depending
//     on which side wins) and a calendar-style daily-spending heatmap;
//   - both follow the selected range, and have an accessible, Privacy-mode
//     -safe text alternative (a visually-hidden table of exact figures)
//     alongside the decorative SVG/grid.
//
// UNVERIFIED: this spec has not been run. It needs a Windows desktop with
// tauri-driver, which this development environment doesn't have. It was
// written to the same pattern as feature81_reports_hub.mjs and reviewed by
// hand, but never actually executed — see PHASE3_HANDOFF.md.
//
// Run with: node e2e/feature89_sankey_and_heatmap.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()

def month_start(back):
    total = today.year * 12 + today.month - 1 - back
    y, m = divmod(total, 12)
    return datetime.date(y, m + 1, 1)

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid

def tx(back, day, desc, amount, category):
    d = (month_start(back) + datetime.timedelta(days=day)).isoformat()
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, amount, category, "user", f"{acct}|{d}|{desc.lower()}|{amount}"))

# This month only (the 'last month' preset below isolates it): income 3000,
# spending 1200 rent + 450 groceries + 100 dining = 1750, leaving 1250 over.
tx(0, 1, "Paycheck", "3000.00", "Income")
tx(0, 2, "Landlord", "-1200.00", "Rent")
tx(0, 5, "Grocers", "-450.00", "Groceries")
tx(0, 8, "Ferry Cafe", "-100.00", "Dining Out")
# A transfer between the household's own accounts — must not show up as
# spending in either the Sankey or the heatmap.
tx(0, 10, "To Savings", "-500.00", "Transfer")
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}

try {
  await browser.setWindowSize(1440, 1400);
  await nav("Reports");
  await browser.$("[data-reports-hub]").waitForExist({ timeout: 10000 });

  // last_6 is the default preset, but income/spending are seeded this month
  // only — switch to "Last month" isn't right either (that's the prior
  // month). Use "Year to date" so this month's data is definitely in range
  // regardless of which day of the month the suite runs on.
  await (await browser.$("[data-range-preset='year_to_date']")).click();
  await browser.$("[data-report-sankey]").waitForExist({ timeout: 10000 });
  await browser.$("[data-report-heatmap]").waitForExist({ timeout: 10000 });

  // --- Sankey: nodes present, transfer excluded, exact figures accessible ---
  await browser.waitUntil(
    async () => {
      const text = await (await browser.$("[data-report-sankey]")).getText();
      return text.includes("Rent") && text.includes("Groceries");
    },
    { timeout: 10000, timeoutMsg: "the Sankey diagram should list Rent and Groceries" },
  );
  const sankeyText = await (await browser.$("[data-report-sankey]")).getText();
  if (sankeyText.includes("Transfer")) throw new Error("a Transfer-categorized transaction should never appear in the Sankey");
  if (!sankeyText.includes("$1,200.00")) throw new Error(`Rent should show as $1,200.00 in the hidden summary table: ${sankeyText}`);
  if (!sankeyText.includes("Left over")) throw new Error("income exceeded spending this month, so a 'Left over' flow should appear");

  // The SVG itself carries no dollar figure in its aria-label (privacy: a
  // screen reader shouldn't announce a real number while amounts are
  // hidden) — the exact figures live only in the visually-hidden table.
  const svgAriaLabel = await (await browser.$("[data-report-sankey] svg")).getAttribute("aria-label");
  if (/\$\d/.test(svgAriaLabel)) throw new Error(`the Sankey svg's aria-label shouldn't contain a dollar figure: "${svgAriaLabel}"`);

  // --- Heatmap: a day with spending is focusable and reports its total ---
  const days = await browser.$$("[data-heatmap-day]");
  if (days.length === 0) throw new Error("the heatmap should render at least one in-range day button");

  // Find the specific day the $1,200 Rent transaction landed on and hover it.
  const heatmapCard = await browser.$("[data-report-heatmap]");
  const dayButtons = await heatmapCard.$$("[data-heatmap-day]");
  let rentButton = null;
  for (const b of dayButtons) {
    const dateAttr = await b.getAttribute("data-heatmap-day");
    if (dateAttr && dateAttr.endsWith("-03")) {
      // month_start(0) is day 1 of this month; +2 days (timedelta(days=2)) = the 3rd.
      rentButton = b;
      break;
    }
  }
  if (!rentButton) throw new Error("couldn't find the heatmap cell for the day Rent posted");
  await rentButton.moveTo();
  await browser.waitUntil(
    async () => {
      const status = await (await browser.$("[data-heatmap-status]")).getText();
      return status.includes("$1,200.00");
    },
    { timeout: 5000, timeoutMsg: "hovering the Rent day should show its $1,200.00 total in the live status line" },
  );

  // --- No sideways page scroll at narrow widths (960px, 800px) ---
  for (const width of [960, 800]) {
    await browser.setWindowSize(width, 1000);
    const overflowing = await browser.execute(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (overflowing) throw new Error(`the page scrolls sideways at ${width}px wide`);
  }
  await browser.setWindowSize(1440, 1400);

  // --- Empty state: a range with nothing in it ---
  await (await browser.$("[data-range-preset='last_month']")).click();
  await browser.waitUntil(
    async () => (await (await browser.$("[data-report-sankey]")).getText()).includes("No income or spending in this range."),
    { timeout: 10000, timeoutMsg: "the Sankey should show an empty state for a range with no data" },
  );
  const heatmapEmptyText = await (await browser.$("[data-report-heatmap]")).getText();
  if (!heatmapEmptyText.includes("No spending in this range.")) throw new Error("the heatmap should show an empty state too");

  console.log("FEATURE 89 E2E TEST PASSED");
} finally {
  await app.close();
}
