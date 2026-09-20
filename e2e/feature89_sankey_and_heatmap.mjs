// E2E test for Phase 3 item 11 (Sankey diagram + daily-spend heatmap):
//   - the Reports tab gets an income -> spending Sankey diagram (biggest
//     categories, "Other" for the rest, "Left over"/"Shortfall" depending
//     on which side wins) and a calendar-style daily-spending heatmap;
//   - both follow the selected range, exclude transfers, and have an
//     accessible, Privacy-mode-safe text alternative (a visually-hidden
//     table of exact figures) alongside the decorative SVG/grid;
//   - every Sankey label is fully inside the drawing, readable and clear of
//     its neighbours at full, half and narrower window widths (they used to
//     fall outside the SVG box, leaving unlabelled bars);
//   - Privacy mode masks the figures in both, including the heatmap's live
//     day readout;
//   - a range where spending beats income draws the "Shortfall" shape;
//   - both show a plain empty state on a profile with nothing in it.
//
// The data sits in LAST month (always a complete month in the past, always
// inside the "Last month" preset) so the spec gives the same answer on any
// day of the month — the heatmap only ever shows days up to today.
//
// Run with: node e2e/feature89_sankey_and_heatmap.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const isoDay = (day) => `${lastMonth.getFullYear()}-${pad(lastMonth.getMonth() + 1)}-${pad(day)}`;

// Last month's rows, as python: `income` is the paycheck; spending is fixed.
const fixture = (income) => `
import datetime
today = datetime.date.today()

def month_start(back):
    total = today.year * 12 + today.month - 1 - back
    y, m = divmod(total, 12)
    return datetime.date(y, m + 1, 1)

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid

def tx(day, desc, amount, category):
    d = (month_start(1) + datetime.timedelta(days=day - 1)).isoformat()
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, amount, category, "user", f"{acct}|{d}|{desc.lower()}|{amount}"))

tx(1, "Paycheck", "${income}", "Income")
tx(2, "Landlord", "-1200.00", "Rent")
tx(5, "Grocers", "-450.00", "Groceries")
tx(8, "Ferry Cafe", "-100.00", "Dining Out")
# A transfer between the household's own accounts — must not show up as
# spending in either the Sankey or the heatmap.
tx(10, "To Savings", "-500.00", "Transfer")
`;

// Spending is 1200 + 450 + 100 = 1750. Income 3000 leaves 1250 over; income
// 1000 is a 750 shortfall.
const dbDir = await seedFixture(fixture("3000.00"));

/** Opens Reports on the "Last month" range in a fresh app window. */
async function openReports(browser) {
  await browser.setWindowSize(1440, 1400);
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === "Reports") {
      await b.click();
      break;
    }
  }
  await browser.$("[data-reports-hub]").waitForExist({ timeout: 10000 });
  await (await browser.$("[data-range-preset='last_month']")).click();
  await browser.$("[data-report-sankey]").waitForExist({ timeout: 10000 });
  await browser.$("[data-report-heatmap]").waitForExist({ timeout: 10000 });
}

/** Every Sankey label is fully inside the drawing, legible, and clear of its
 * neighbours. (Half-window widths used to push the labels outside the SVG
 * box, leaving unlabelled bars; thin bars used to stack their labels.) */
async function assertSankeyLabels(browser, width, minLabels) {
  const report = await browser.execute(() => {
    const svg = document.querySelector("[data-report-sankey] svg");
    const box = svg.getBoundingClientRect();
    const texts = [...svg.querySelectorAll("text")].map((t) => {
      const r = t.getBoundingClientRect();
      return { t: t.textContent.replace(/\s+/g, " ").trim(), l: r.left - box.left, r: r.right - box.left, top: r.top - box.top, bottom: r.bottom - box.top };
    });
    const clipped = texts.filter((t) => t.l < -0.5 || t.r > box.width + 0.5 || t.top < -0.5 || t.bottom > box.height + 0.5).map((t) => t.t);
    const overlaps = [];
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i];
        const b = texts[j];
        const across = Math.min(a.r, b.r) - Math.max(a.l, b.l);
        const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (across > 1 && down > 1) overlaps.push(`${a.t} / ${b.t}`);
      }
    }
    const shortest = Math.min(...texts.map((t) => t.bottom - t.top));
    return { count: texts.length, clipped, overlaps, shortest };
  });
  if (report.count < minLabels) throw new Error(`the Sankey should label every flow at ${width}px (got ${report.count} labels)`);
  if (report.clipped.length) throw new Error(`Sankey labels fall outside the drawing at ${width}px: ${report.clipped.join(", ")}`);
  if (report.overlaps.length) throw new Error(`Sankey labels overlap at ${width}px: ${report.overlaps.join(", ")}`);
  if (report.shortest < 9) throw new Error(`Sankey labels are too small to read at ${width}px (${report.shortest.toFixed(1)}px tall)`);
}

// ===== Main profile: income beats spending =====
const app = await launchApp({ dbDir });
const { browser } = app;
try {
  await openReports(browser);

  // --- Sankey: nodes present, transfer excluded, exact figures accessible ---
  await browser.waitUntil(
    async () => {
      const text = await (await browser.$("[data-report-sankey]")).getText();
      return text.includes("Rent") && text.includes("Groceries");
    },
    { timeout: 10000, timeoutMsg: "the Sankey diagram should list Rent and Groceries" },
  );
  const sankeyText = await (await browser.$("[data-report-sankey]")).getText();
  if (sankeyText.includes("Transfer")) throw new Error(`a Transfer-categorized transaction should never appear in the Sankey: ${sankeyText}`);
  for (const figure of ["$3,000.00", "$1,200.00", "$450.00", "$100.00", "$1,250.00"]) {
    if (!sankeyText.includes(figure)) throw new Error(`the Sankey should show ${figure}: ${sankeyText}`);
  }
  if (!sankeyText.includes("Left over")) throw new Error("income exceeded spending, so a 'Left over' flow should appear");
  if (sankeyText.includes("Shortfall")) throw new Error("income exceeded spending, so there should be no 'Shortfall' flow");

  // The SVG itself carries no dollar figure in its aria-label (privacy: a
  // screen reader shouldn't announce a real number while amounts are
  // hidden) — the exact figures live in real, maskable DOM text instead.
  const svgAriaLabel = await (await browser.$("[data-report-sankey] svg")).getAttribute("aria-label");
  if (/\$\d/.test(svgAriaLabel)) throw new Error(`the Sankey svg's aria-label shouldn't contain a dollar figure: "${svgAriaLabel}"`);

  // --- Heatmap: a day with spending reports its total; a transfer day doesn't ---
  const heatmapCard = await browser.$("[data-report-heatmap]");
  const cellFor = async (day) => {
    const cell = await heatmapCard.$(`[data-heatmap-day='${isoDay(day)}']`);
    if (!(await cell.isExisting())) throw new Error(`no heatmap cell for ${isoDay(day)}`);
    return cell;
  };
  const statusText = async () => (await (await browser.$("[data-heatmap-status]")).getText()).trim();

  await (await cellFor(2)).moveTo();
  await browser.waitUntil(async () => (await statusText()).includes("$1,200.00"), {
    timeout: 5000,
    timeoutMsg: `hovering the Rent day should show its $1,200.00 total in the live status line (got "${await statusText()}")`,
  });
  await (await cellFor(5)).moveTo();
  await browser.waitUntil(async () => (await statusText()).includes("$450.00"), {
    timeout: 5000,
    timeoutMsg: `hovering the Groceries day should show $450.00 (got "${await statusText()}")`,
  });
  // The $500 transfer day is not spending.
  await (await cellFor(10)).moveTo();
  await browser.waitUntil(async () => (await statusText()).includes("$0.00"), {
    timeout: 5000,
    timeoutMsg: `the day of the transfer should read $0.00 (got "${await statusText()}")`,
  });

  // Keyboard: focusing a day (Tab lands on it) reads out the same total.
  await browser.execute((sel) => document.querySelector(sel).focus(), `[data-heatmap-day='${isoDay(8)}']`);
  await browser.waitUntil(async () => (await statusText()).includes("$100.00"), {
    timeout: 5000,
    timeoutMsg: `focusing the Dining Out day should show $100.00 (got "${await statusText()}")`,
  });

  // --- Labels: full width, then the half-window widths, with no sideways page scroll ---
  await assertSankeyLabels(browser, 1440, 5);
  for (const width of [960, 800]) {
    await browser.setWindowSize(width, 1000);
    await browser.pause(400);
    await assertSankeyLabels(browser, width, 5);
    const overflow = await browser.execute(() => {
      const main = document.querySelector(".main");
      return {
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        main: main ? main.scrollWidth - main.clientWidth : 0,
      };
    });
    if (overflow.doc > 1 || overflow.main > 1) throw new Error(`the page scrolls sideways at ${width}px wide: ${JSON.stringify(overflow)}`);
  }

  // --- A year of heatmap is wider than a half-width card: it opens on the newest weeks ---
  // (Left alone it opened on the oldest, empty weeks and hid recent spending off to the right.)
  await (await browser.$("[data-range-preset='last_12']")).click();
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const frame = document.querySelector("[data-report-heatmap] .table-scroll");
        return !!frame && frame.scrollWidth > frame.clientWidth + 20;
      }),
    { timeout: 10000, timeoutMsg: "twelve months of heatmap should be wider than the half-width card" },
  );
  const scrolledToNewest = await browser.execute(() => {
    const frame = document.querySelector("[data-report-heatmap] .table-scroll");
    return frame.scrollLeft + frame.clientWidth >= frame.scrollWidth - 2;
  });
  if (!scrolledToNewest) throw new Error("the wide heatmap should open scrolled to the newest weeks, not the oldest");
  await (await browser.$("[data-range-preset='last_month']")).click();
  await browser.setWindowSize(1440, 1400);

  // --- Privacy mode: the diagram's labels and the heatmap readout are masked ---
  const noAmounts = (text) => !/\$\s?\d/.test(text);
  await (await browser.$("[data-privacy-toggle]")).click();
  await browser.waitUntil(async () => noAmounts(await (await browser.$("[data-report-sankey]")).getText()), {
    timeout: 5000,
    timeoutMsg: "Privacy mode should mask every dollar figure in the Sankey",
  });
  const maskedSvgText = await browser.execute(() => document.querySelector("[data-report-sankey] svg").textContent);
  if (/\$\s?\d/.test(maskedSvgText)) throw new Error(`the Sankey's drawn labels still show an amount under Privacy mode: ${maskedSvgText}`);
  await (await cellFor(2)).moveTo();
  await browser.waitUntil(async () => (await statusText()).includes("••••"), {
    timeout: 5000,
    timeoutMsg: `the heatmap readout should be masked under Privacy mode (got "${await statusText()}")`,
  });
  if (!noAmounts(await statusText())) throw new Error(`the heatmap readout leaks an amount under Privacy mode: "${await statusText()}"`);
  const maskedHeatmapText = await browser.execute(() => document.querySelector("[data-report-heatmap]").textContent);
  if (/\$\s?\d/.test(maskedHeatmapText)) throw new Error("the heatmap's hidden day table still shows an amount under Privacy mode");
  await (await browser.$("[data-privacy-toggle]")).click();
  await browser.waitUntil(async () => (await (await browser.$("[data-report-sankey]")).getText()).includes("$3,000.00"), {
    timeout: 5000,
    timeoutMsg: "turning Privacy mode off should bring the figures back",
  });
} finally {
  await app.close();
}

// ===== A range where spending beats income: the Shortfall shape =====
const shortDir = await seedFixture(fixture("1000.00"));
const shortApp = await launchApp({ dbDir: shortDir });
try {
  const b = shortApp.browser;
  await openReports(b);
  await b.waitUntil(async () => (await (await b.$("[data-report-sankey]")).getText()).includes("Shortfall"), {
    timeout: 10000,
    timeoutMsg: "spending beat income, so the Sankey should draw a Shortfall flow",
  });
  const text = await (await b.$("[data-report-sankey]")).getText();
  for (const label of ["Income", "Total spending", "Rent", "Groceries", "Dining Out"]) {
    if (!text.includes(label)) throw new Error(`the shortfall diagram should include ${label}: ${text}`);
  }
  if (text.includes("Left over")) throw new Error("there is nothing left over in a shortfall");
  // Shortfall = 1750 spent - 1000 income = 750; the middle bar carries the full 1750.
  for (const figure of ["$1,000.00", "$750.00", "$1,750.00"]) {
    if (!text.includes(figure)) throw new Error(`the shortfall diagram should show ${figure}: ${text}`);
  }
  await assertSankeyLabels(b, 1440, 6);
  for (const width of [960, 800]) {
    await b.setWindowSize(width, 1000);
    await b.pause(400);
    await assertSankeyLabels(b, width, 6);
  }
} finally {
  await shortApp.close();
}

// ===== Empty state: a profile with nothing in it =====
const emptyDir = await seedFixture("pass");
const emptyApp = await launchApp({ dbDir: emptyDir });
try {
  const b = emptyApp.browser;
  await b.setWindowSize(1440, 1400);
  for (const btn of await b.$$("nav button")) {
    if ((await btn.getText()).trim() === "Reports") {
      await btn.click();
      break;
    }
  }
  await b.$("[data-reports-hub]").waitForExist({ timeout: 10000 });
  await b.waitUntil(
    async () => (await (await b.$("[data-report-sankey]")).getText()).includes("No income or spending in this range."),
    { timeout: 10000, timeoutMsg: "the Sankey should show an empty state for a profile with no data" },
  );
  const heatmapEmptyText = await (await b.$("[data-report-heatmap]")).getText();
  if (!heatmapEmptyText.includes("No spending in this range.")) throw new Error(`the heatmap should show an empty state too: ${heatmapEmptyText}`);
} finally {
  await emptyApp.close();
}

console.log("FEATURE 89 E2E TEST PASSED");
