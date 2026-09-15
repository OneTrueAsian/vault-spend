// E2E smoke test for year-over-year cash flow comparison: seeds income in
// the current month and the same month last year, checks "Compare to last
// year" on the Cash Flow tab, and confirms the chart switches to the YoY
// legend/title.
//
// Run with: node e2e/feature6_yoy_cashflow.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const today = new Date();
const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-05`;
const lastYearMonth = `${today.getFullYear() - 1}-${String(today.getMonth() + 1).padStart(2, "0")}-05`;

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "${thisMonth}", "Employer Inc", "5000.00", "Income", f"{checking_id}|${thisMonth}|employer inc|5000.00"),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, ?, ?, ?, ?)",
    (checking_id, "${lastYearMonth}", "Employer Inc", "4000.00", "Income", f"{checking_id}|${lastYearMonth}|employer inc|4000.00"),
)
`);

const app = await launchApp({ dbDir });
try {
  const cashFlowNav = await app.browser.$("button*=Cash Flow");
  await cashFlowNav.click();

  const title = await app.browser.$(".reports-section-title");
  await title.waitForExist({ timeout: 10000 });
  console.log("initial title:", await title.getText());

  // Defaults to the shorter 3-month preset — a newer account's chart
  // shouldn't open to mostly-empty months out of the box (6 is still one
  // click away for anyone with a longer history).
  const threeMonthsBtn = await app.browser.$("button=3 months");
  if (!(await threeMonthsBtn.getAttribute("class")).includes("tab-btn-active")) {
    throw new Error("expected Cash Flow to default to the 3-month range");
  }
  console.log("Cash Flow defaults to the 3-month range");

  const checkbox = await app.browser.$(".compare-last-year-toggle input");
  await checkbox.click();

  await app.browser.waitUntil(
    async () => (await app.browser.$(".reports-section-title").getText()).includes("this year vs"),
    { timeout: 10000, timeoutMsg: "expected the title to switch to the YoY comparison" },
  );
  console.log("YoY title:", await app.browser.$(".reports-section-title").getText());

  const legendItems = await app.browser.$$(".chart-legend-item");
  const legendTexts = [];
  for (const el of legendItems) legendTexts.push(await el.getText());
  console.log("legend:", legendTexts);
  if (!legendTexts.includes("This year") || !legendTexts.includes("Last year")) {
    throw new Error(`expected "This year"/"Last year" legend, got ${JSON.stringify(legendTexts)}`);
  }

  console.log("FEATURE 6 E2E TEST PASSED");
} finally {
  await app.close();
}
