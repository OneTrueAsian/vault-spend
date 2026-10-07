// E2E smoke test for the Investments tab's goal projection calculator:
// seeds one investment holding worth $10,000, confirms the calculator
// pre-fills the starting balance from it, then confirms changing the
// inputs recomputes the projection (deterministic total-contributed figure,
// plus a sanity check that growth outpaces contributions at a positive
// assumed return).
//
// Run with: node e2e/feature8_goal_projection.mjs

import { launchApp, chooseMenuOption, withFocusRetry } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Brokerage', 'investment', '0.00')")
brokerage_id = cur.lastrowid
cur.execute(
    "INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?, ?, ?, ?, ?, ?, ?)",
    (brokerage_id, "VTI", "Vanguard Total Stock Market", "10", "1000.00", "8000.00", "US Stocks"),
)
`);

const app = await launchApp({ dbDir });
try {
  const investmentsNav = await app.browser.$("button*=Investments");
  await investmentsNav.click();

  const startingBalanceInput = await app.browser.$(
    "//label[span[text()='Starting balance']]/input",
  );
  await startingBalanceInput.waitForExist({ timeout: 10000 });
  const startingValue = await startingBalanceInput.getValue();
  console.log("starting balance prefill:", startingValue);
  if (startingValue !== "10000.00") throw new Error(`expected prefill "10000.00", got "${startingValue}"`);

  const goalCard = await app.browser.$(
    "//div[contains(@class,'card')][.//span[text()='Goal projection']]",
  );
  await goalCard.waitForExist({ timeout: 10000 });
  const beforeText = await goalCard.getText();
  console.log("goal projection card (default inputs):", beforeText);
  // .stat-label is uppercased via CSS text-transform, so getText() (which
  // reflects rendered text) returns "PROJECTED IN 20 YEARS" — compare
  // case-insensitively rather than against the JSX source casing.
  if (!/projected in 20 years/i.test(beforeText)) {
    throw new Error(`expected default "Projected in 20 years" label, got:\n${beforeText}`);
  }

  const contributionInput = await app.browser.$("//label[span[text()='Monthly contribution']]/input");
  const yearsSelect = await app.browser.$("//label[span[text()='Time horizon']]//button[contains(@class,'menu-select-toggle')]");
  await withFocusRetry(app.browser, async () => {
    await contributionInput.setValue("1000");
    await chooseMenuOption(yearsSelect, { value: "10" });
    await app.browser.waitUntil(async () => /projected in 10 years/i.test(await goalCard.getText()), {
      timeout: 5000,
      timeoutMsg: "choosing a 10-year horizon should update the projection",
    });
  });

  const afterText = await goalCard.getText();
  console.log("goal projection card (after edit):", afterText);
  if (!/projected in 10 years/i.test(afterText)) {
    throw new Error(`expected "Projected in 10 years" after changing the horizon, got:\n${afterText}`);
  }
  // Deterministic regardless of the assumed-return math: $10,000 starting +
  // $1,000/mo * 12 * 10yr = $130,000.00 total contributed.
  if (!afterText.includes("$130,000.00")) {
    throw new Error(`expected total contributed "$130,000.00", got:\n${afterText}`);
  }

  const finalMatch = afterText.match(/\$([\d,]+\.\d{2})\s*\nPROJECTED IN 10 YEARS/i);
  if (!finalMatch) throw new Error(`could not find projected-balance figure in:\n${afterText}`);
  const finalBalance = parseFloat(finalMatch[1].replace(/,/g, ""));
  if (!(finalBalance > 130000)) {
    throw new Error(`expected projected balance to exceed total contributed ($130,000) at a positive return, got ${finalBalance}`);
  }

  console.log("FEATURE 8 E2E TEST PASSED");
} finally {
  await app.close();
}
