// E2E test for the Budget tab's keyboard-accessible reordering (U-6 from the
// performance/UI review) — an alternative to the drag handle. Since 1.3.0 it
// lives in each row's ⋯ settings menu ("Move up" / "Move down"). Seeds two
// Flexible categories, chooses "Move down" on the first, and confirms the
// on-screen row order actually swapped.
//
// Run with: node e2e/feature46_budget_reorder_buttons.mjs

import { chooseRowAction, launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
period = datetime.date.today().strftime("%Y-%m")
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", (period,))
cur.execute("INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES ('Groceries', ?, '400.00', 'flexible')", (period,))
cur.execute("INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES ('Dining Out', ?, '150.00', 'flexible')", (period,))
`);

const app = await launchApp({ dbDir });
try {
  const budgetNav = await app.browser.$("button*=Budget");
  await budgetNav.click();

  async function currentOrder() {
    const rows = await app.browser.$$(".cat-row");
    const names = [];
    for (const row of rows) {
      names.push(await (await row.$(".category-link")).getText());
    }
    return names;
  }

  // `$$` snapshots the DOM immediately (no retry/wait, unlike `$` +
  // `waitForExist`) — wait for the first row to actually exist before
  // reading the full order, or this can race the Budget tab's own async
  // actuals fetch and see zero rows.
  await (await app.browser.$(".cat-row")).waitForExist({ timeout: 10000 });
  // No custom order has ever been saved, so the default is whatever order
  // `list_budgets` itself returns (alphabetical by category) — not
  // asserted here since that's an implementation detail of a different
  // module; only that *some* known order exists to reorder away from.
  const orderBefore = await currentOrder();
  console.log("order before:", orderBefore);
  if (orderBefore.length !== 2 || !orderBefore.includes("Groceries") || !orderBefore.includes("Dining Out")) {
    throw new Error(`expected exactly Groceries and Dining Out, got: ${orderBefore}`);
  }
  const [firstCategory, secondCategory] = orderBefore;

  // The first row's "Move up" is there but disabled; "Move down" moves it.
  await chooseRowAction(app.browser, async () => (await app.browser.$(".cat-row")).$("[data-row-menu]"), "Move down");

  await app.browser.waitUntil(
    async () => {
      const order = await currentOrder();
      return order[0] === secondCategory;
    },
    { timeout: 5000, timeoutMsg: `expected "${secondCategory}" to move to the first row after choosing Move down` },
  );

  const orderAfter = await currentOrder();
  console.log("order after:", orderAfter);
  if (orderAfter[0] !== secondCategory || orderAfter[1] !== firstCategory) {
    throw new Error(`expected the order to swap to "${secondCategory}" then "${firstCategory}", got: ${orderAfter}`);
  }

  console.log("FEATURE 46 E2E TEST PASSED");
} finally {
  await app.close();
}
