// E2E regression test for the Dashboard's Debt stat tile: its change line must
// color green with a down arrow when the amount actually owed shrank over the
// trailing window, and red with an up arrow when it grew — never the
// inverse. The amount itself stays neutral either way (UI review s4: red only
// for what needs you; owing money is not by itself a problem), and only a
// growing debt gets the warning icon. Two real bugs motivated this:
//   1. The tile used to turn red any time there was *any* debt at all,
//      regardless of trend, even while it was being paid down.
//   2. After fixing that, the sparkline/arrow still pointed the wrong way:
//      they tracked the raw net-worth contribution (negative-signed, so it
//      rises toward $0 as debt shrinks), producing an "up" arrow for a
//      loan that was actually being paid off — backwards from what a
//      person means by "my debt is going down."
// This seeds one loan trending down and, separately, one trending up, and
// checks the tile's value class, change line and icon in both directions.
//
// Run with: node e2e/feature36_debt_trend_color.mjs

import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { monthFromNow } from "./lib/dates.mjs";

/** The debt tile's value class, arrow text, arrow class and icon, read together in one go. */
async function readDebtTile(browser) {
  return browser.execute(() => {
    const tile = document.querySelector('[data-stat="debt"]');
    const value = tile?.querySelector(".stat-value");
    const delta = tile?.querySelector(".stat-delta");
    return {
      tileClass: tile?.getAttribute("class") ?? null,
      valueClass: value?.getAttribute("class") ?? null,
      deltaText: delta?.textContent?.trim() ?? null,
      deltaClass: delta?.getAttribute("class") ?? null,
      icon: tile?.querySelector("[data-debt-icon]")?.getAttribute("data-debt-icon") ?? null,
    };
  });
}

async function checkDebtTile(dbDir, { expectArrow, expectIcon, label }) {
  const app = await launchApp({ dbDir });
  try {
    const expectDeltaClass = expectArrow === "▼" ? "up" : "down";
    // The tile appears before the six-month history behind it has loaded (the dashboard loads it
    // separately), with no arrow at all, so wait for the arrow and the icon together.
    const settled = (t) =>
      (t.deltaText ?? "").startsWith(expectArrow) && (t.deltaClass ?? "").split(" ").includes(expectDeltaClass) && t.icon === expectIcon;
    let last = null;
    await waitUntilOrDiagnose(
      app.browser,
      async () => {
        last = await readDebtTile(app.browser);
        return settled(last);
      },
      {
        timeout: 15000,
        timeoutMsg: `[${label}] the debt tile never showed a ${expectArrow} "${expectDeltaClass}" change line with the "${expectIcon}" icon`,
        extra: () => last,
      },
    );
    // Only the change line is coloured: the amount and the tile stay neutral.
    if (last.valueClass !== "stat-value") throw new Error(`[${label}] the debt amount should be plain "stat-value", got "${last.valueClass}"`);
    const tileClasses = (last.tileClass ?? "").split(" ");
    if (!tileClasses.includes("tint-neutral") || tileClasses.includes("tint-red")) {
      throw new Error(`[${label}] the debt tile should use the neutral tint, got "${last.tileClass}"`);
    }
    console.log(`[${label}] OK — value class "${last.valueClass}", delta "${last.deltaText}" (${last.deltaClass}), icon ${last.icon}`);
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

// Paid down from $20,000 to $8,500 — debt trending DOWN: green ▼ change line, plain debt icon.
const payingDownDb = await seedFixture(loanResetsFixture([20000, 17000, 14000, 11000, 8500]));
await checkDebtTile(payingDownDb, { expectArrow: "▼", expectIcon: "debt", label: "paying down" });

// Grew from $5,000 to $16,000 — debt trending UP: red ▲ change line and the warning icon.
const growingDb = await seedFixture(loanResetsFixture([5000, 8000, 11000, 13500, 16000]));
await checkDebtTile(growingDb, { expectArrow: "▲", expectIcon: "warning", label: "growing" });

console.log("FEATURE 36 E2E TEST PASSED");
