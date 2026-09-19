// E2E regression test for the Dashboard's Debt stat tile: it must color
// green with a down arrow when the amount actually owed shrank over the
// trailing window, and red with an up arrow when it grew — never the
// inverse. Two real bugs motivated this:
//   1. The tile used to turn red any time there was *any* debt at all,
//      regardless of trend, even while it was being paid down.
//   2. After fixing that, the sparkline/arrow still pointed the wrong way:
//      they tracked the raw net-worth contribution (negative-signed, so it
//      rises toward $0 as debt shrinks), producing an "up" arrow for a
//      loan that was actually being paid off — backwards from what a
//      person means by "my debt is going down."
// This seeds one loan trending down and, separately, one trending up, and
// checks the tile's styling class and arrow glyph in both directions.
//
// Run with: node e2e/feature36_debt_trend_color.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

async function checkDebtTile(dbDir, { expectClass, expectArrow, label }) {
  const app = await launchApp({ dbDir });
  try {
    const stats = await app.browser.$$(".stat");
    const debtTile = stats[2];
    await debtTile.waitForExist({ timeout: 10000 });

    const value = await debtTile.$(".stat-value");
    // The tile exists before the report behind it has loaded; wait for the colour to settle.
    await app.browser
      .waitUntil(async () => (await value.getAttribute("class")).includes(expectClass), { timeout: 10000 })
      .catch(() => {});
    const valueClass = await value.getAttribute("class");
    if (!valueClass.includes(expectClass)) {
      throw new Error(`[${label}] expected debt value class to include "${expectClass}", got "${valueClass}"`);
    }

    const delta = await debtTile.$(".stat-delta");
    const deltaText = await delta.getText();
    if (!deltaText.startsWith(expectArrow)) {
      throw new Error(`[${label}] expected debt delta to start with "${expectArrow}", got "${deltaText}"`);
    }
    const deltaClass = await delta.getAttribute("class");
    const expectDeltaClass = expectArrow === "▼" ? "up" : "down";
    if (!deltaClass.includes(expectDeltaClass)) {
      throw new Error(`[${label}] expected debt delta class to include "${expectDeltaClass}", got "${deltaClass}"`);
    }
    console.log(`[${label}] OK — value class "${valueClass}", delta "${deltaText}"`);
  } finally {
    await app.close();
  }
}

function loanResetsFixture(balances) {
  const periods = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  const rows = periods
    .map((period, i) => `("${period}", "${period}-28", "${balances[i].toFixed(2)}")`)
    .join(", ");
  return `
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '4000.00')")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Loan', 'loan', '${balances[0].toFixed(2)}')")
loan_id = cur.lastrowid
for period, reset_date, balance in [${rows}]:
    cur.execute(
        "INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?, ?, ?, ?)",
        (loan_id, period, reset_date, balance),
    )
`;
}

// Paid down from $20,000 to $8,500 — debt trending DOWN, must be green/▼.
const payingDownDb = await seedFixture(loanResetsFixture([20000, 17000, 14000, 11000, 8500]));
await checkDebtTile(payingDownDb, { expectClass: "report-good", expectArrow: "▼", label: "paying down" });

// Grew from $5,000 to $16,000 — debt trending UP, must be red/▲.
const growingDb = await seedFixture(loanResetsFixture([5000, 8000, 11000, 13500, 16000]));
await checkDebtTile(growingDb, { expectClass: "report-over-budget", expectArrow: "▲", label: "growing" });

console.log("FEATURE 36 E2E TEST PASSED");
