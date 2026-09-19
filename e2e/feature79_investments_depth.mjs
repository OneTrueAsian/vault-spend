// E2E test for Phase 2 item 12 (Investments depth):
//   - a "Portfolio value over time" chart built from daily snapshots (today's is
//     recorded at launch);
//   - each holding shows its % of the portfolio;
//   - a target allocation per asset class with drift ("+10.0 pts over") and a
//     warning when the targets don't add up to 100%;
//   - the projection calculator can save its result as a Goal.
//
// Run with: node e2e/feature79_investments_depth.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Brokerage', 'investment', '0.00')")
acct = cur.lastrowid
cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?,?,?,?,?,?,?)",
            (acct, "VTI", "Vanguard Total Stock Market", "10", "700.00", "6000.00", "US Stocks"))
cur.execute("INSERT INTO holdings (account_id, symbol, name, shares, price, cost_basis, asset_class) VALUES (?,?,?,?,?,?,?)",
            (acct, "BND", "Vanguard Total Bond Market", "30", "100.00", "3100.00", "Bonds"))
for days_ago, value in ((5, "9200.00"), (4, "9350.00"), (3, "9500.00"), (2, "9700.00"), (1, "9900.00")):
    cur.execute("INSERT INTO portfolio_snapshots (date, value) VALUES (?, ?)", ((today - datetime.timedelta(days=days_ago)).isoformat(), value))
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
async function setTarget(assetClass, value) {
  const input = await browser.$(`[data-target-input='${assetClass}']`);
  await input.waitForExist({ timeout: 10000 });
  await input.setValue(value);
}
async function saveTargets() {
  await (await browser.$("[data-save-targets]")).click();
}
const driftCell = (assetClass) => browser.$(`[data-drift='${assetClass}']`);

try {
  await browser.setWindowSize(1440, 1400);
  await nav("Investments");

  // --- value over time ---------------------------------------------------------
  const history = await browser.$("[data-portfolio-history]");
  await history.waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => Number(await history.getAttribute("data-portfolio-history")) === 6, {
    timeout: 10000,
    timeoutMsg: "five seeded days plus today's launch-time snapshot should make six points",
  });
  if (!(await history.$("svg").isExisting())) throw new Error("the history card should draw a chart");

  // --- % of portfolio -----------------------------------------------------------
  const vtiShare = await (await browser.$("[data-holding-share='VTI']")).getText();
  const bndShare = await (await browser.$("[data-holding-share='BND']")).getText();
  console.log("shares:", vtiShare, bndShare);
  if (vtiShare !== "70.0%" || bndShare !== "30.0%") throw new Error(`holdings should be 70.0% / 30.0% of the portfolio, got ${vtiShare} / ${bndShare}`);

  // --- targets and drift ---------------------------------------------------------
  await setTarget("US Stocks", "60");
  await setTarget("Bonds", "40");
  await saveTargets();
  await browser.waitUntil(async () => (await driftCell("US Stocks").getAttribute("data-drift-status")) === "over", { timeout: 10000, timeoutMsg: "US Stocks at 70% vs a 60% target is over" });
  const stocks = await (await driftCell("US Stocks")).getText();
  const bonds = await (await driftCell("Bonds")).getText();
  console.log("drift:", stocks, "|", bonds);
  if (!stocks.includes("+10.0 pts over")) throw new Error(`expected "+10.0 pts over", got ${stocks}`);
  if (!bonds.includes("-10.0 pts under") || (await driftCell("Bonds").getAttribute("data-drift-status")) !== "under") throw new Error(`expected "-10.0 pts under", got ${bonds}`);
  if (!(await (await browser.$("[data-target-total]")).getText()).includes("add up to 100%.")) throw new Error("60 + 40 should read as 100%");

  // On target: no drift to speak of.
  await setTarget("US Stocks", "70");
  await setTarget("Bonds", "30");
  await saveTargets();
  await browser.waitUntil(async () => (await driftCell("US Stocks").getAttribute("data-drift-status")) === "ok", { timeout: 10000, timeoutMsg: "matching the mix should read as fine" });

  // Targets that don't add up.
  await setTarget("Bonds", "20");
  const totalText = await (await browser.$("[data-target-total]")).getText();
  if (!totalText.includes("add up to 90%") || !totalText.includes("should total 100%")) throw new Error(`expected a 90% warning, got: ${totalText}`);
  await saveTargets();

  // --- save the projection as a goal ------------------------------------------------
  await (await browser.$("[data-projection-save-as-goal]")).click();
  const name = await browser.$("[data-projection-goal-name]");
  await name.waitForExist({ timeout: 5000 });
  if ((await name.getValue()) !== "Investment goal") throw new Error("the goal name should default to Investment goal");
  await name.setValue("Retirement nest egg");
  await (await browser.$("[data-projection-goal-save]")).click();
  await nav("Goals");
  const card = await browser.$("//div[contains(@class,'bucket-card')][.//h3[contains(normalize-space(.), 'Retirement nest egg')]]");
  await card.waitForExist({ timeout: 10000, timeoutMsg: "the saved projection should appear as a goal" });
  const cardText = await card.getText();
  console.log("goal card:", cardText.replace(/\s+/g, " "));
  if (!/of \$[\d,]+\.\d{2}/.test(cardText)) throw new Error(`the goal should carry the projected balance as its target:\n${cardText}`);

  console.log("FEATURE 79 E2E TEST PASSED");
} finally {
  await app.close();
}
