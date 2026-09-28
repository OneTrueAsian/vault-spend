// E2E test for the Dashboard stat cards' new "What changed" breakdown:
// clicking a tile (e.g. Debt) must not just show the current per-account
// balances, it must also say which account actually moved over the same
// trailing window the tile's own sparkline/delta covers — and leave out
// any account that didn't move at all.
//
// Seeds two loans over the same trailing-months window feature36 uses:
// one growing from $5,000 to $8,000 owed (a real $3,000 increase), one
// flat the whole time at $10,000. Only the growing one should show up
// under "What changed", with an up arrow (growing debt is bad).
//
// Run with: node e2e/feature42_dashboard_whats_changed.mjs

import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

function loanResetsFixture(name, varName, balances) {
  const periods = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  const rows = periods.map((period, i) => `("${period}", "${period}-28", "${balances[i].toFixed(2)}")`).join(", ");
  return `
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('${name}', 'loan', '${balances[0].toFixed(2)}')")
${varName}_id = cur.lastrowid
for period, reset_date, balance in [${rows}]:
    cur.execute(
        "INSERT INTO balance_resets (account_id, period, reset_date, balance) VALUES (?, ?, ?, ?)",
        (${varName}_id, period, reset_date, balance),
    )
`;
}

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '4000.00')")
${loanResetsFixture("Auto Loan", "auto_loan", [5000, 6000, 6500, 7000, 8000])}
${loanResetsFixture("Mortgage", "mortgage", [10000, 10000, 10000, 10000, 10000])}
`);

const app = await launchApp({ dbDir });
try {
  const stats = await app.browser.$$(".stat");
  const debtTile = stats[2];
  await debtTile.waitForExist({ timeout: 10000 });
  await debtTile.click();

  const panel = await app.browser.$(".stat-detail-panel");
  await panel.waitForExist({ timeout: 5000 });
  // The panel is drawn from data the app loads after its shell appears, so it can open first with "No
  // accounts contribute to this yet." — wait for the breakdown instead of reading it once.
  const panelTextNow = async () => (await app.browser.$(".stat-detail-panel").getText());
  await waitUntilOrDiagnose(app.browser, async () => (await panelTextNow()).includes("What changed"), {
    timeout: 15000,
    timeoutMsg: 'expected a "What changed" section in the Debt panel',
    extra: async () => ({ panel: (await panelTextNow()).replace(/\s+/g, " ").slice(0, 200) }),
  });
  const panelText = await panelTextNow();
  console.log("debt detail panel:", panelText);

  if (!panelText.includes("What changed")) {
    throw new Error(`expected a "What changed" section: ${panelText}`);
  }
  if (!panelText.includes("Auto Loan") || !panelText.includes("▲") || !panelText.includes("3,000.00")) {
    throw new Error(`expected Auto Loan's $3,000 increase to be called out: ${panelText}`);
  }
  // The flat Mortgage should only appear once (under "What makes up Debt"),
  // never a second time paired with a change arrow.
  const mortgageMentions = panelText.split("Mortgage").length - 1;
  if (mortgageMentions !== 1) {
    throw new Error(`expected Mortgage (unchanged) to appear once, not under "What changed": ${panelText}`);
  }

  console.log("FEATURE 42 E2E TEST PASSED");
} finally {
  await app.close();
}
