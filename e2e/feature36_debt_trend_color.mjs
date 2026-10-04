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

import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { monthFromNow } from "./lib/dates.mjs";

/** The debt tile's colour class, arrow text and arrow class, read together in one go. */
async function readDebtTile(browser) {
  return browser.execute(() => {
    const tile = document.querySelector('[data-stat="debt"]');
    const value = tile?.querySelector(".stat-value");
    const delta = tile?.querySelector(".stat-delta");
    return {
      valueClass: value?.getAttribute("class") ?? null,
      deltaText: delta?.textContent?.trim() ?? null,
      deltaClass: delta?.getAttribute("class") ?? null,
    };
  });
}

async function checkDebtTile(dbDir, { expectClass, expectArrow, label }) {
  const app = await launchApp({ dbDir });
  try {
    const expectDeltaClass = expectArrow === "▼" ? "up" : "down";
    const settled = (t) =>
      (t.valueClass ?? "").split(" ").includes(expectClass) &&
      (t.deltaText ?? "").startsWith(expectArrow) &&
      (t.deltaClass ?? "").split(" ").includes(expectDeltaClass);
    // The tile appears before the six-month history behind it has loaded (the dashboard loads it
    // separately), showing any debt in red with no arrow at all. That placeholder alone already
    // matches the "growing" case's colour, so wait for the colour and the arrow together.
    let last = null;
    await waitUntilOrDiagnose(
      app.browser,
      async () => {
        last = await readDebtTile(app.browser);
        return settled(last);
      },
      { timeout: 15000, timeoutMsg: `[${label}] the debt tile never showed "${expectClass}" with a ${expectArrow} arrow`, extra: () => last },
    );
    console.log(`[${label}] OK — value class "${last.valueClass}", delta "${last.deltaText}"`);
  } finally {
    await app.close();
  }
}

function loanResetsFixture(balances) {
  // The five months before this one: the Dashboard/Accounts delta spans the trailing 6 months ending now, so a fixed
  // calendar would slide out of the window as time passes.
  const periods = [-5, -4, -3, -2, -1].map((offset) => monthFromNow(offset));
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
