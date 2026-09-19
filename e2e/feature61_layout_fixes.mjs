// E2E test for Phase 1 item 14a — five small layout problems found in a
// visual review of the whole app at a desktop-size window:
//   1. Recurring's stat row orphaned a redundant fifth "Active items" card
//      onto a second row (it repeated the subtitle's own count).
//   2. Budget category names were truncated ("Subscri…") because the alert
//      badge, sparkline and the cryptic "Cap" toggle shared the name's row.
//   3. Transactions dates wrapped at their hyphens ("2026-" / "09-18").
//   4. The Transactions header's account control was labeled "Account" and
//      read like a filter; it's really where imports/new transactions start.
//   5. Household's empty state sent you to another tab instead of offering
//      the action right there.
//
// Run with: node e2e/feature61_layout_fixes.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
period = today.strftime("%Y-%m")

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
checking_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, ?, 'Streaming Bundle', '-72.48', 'Subscriptions', 'user', 'fp-subs')",
    (checking_id, today.isoformat()),
)
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", (period,))
cur.execute("INSERT OR REPLACE INTO budgets (category, period, monthly_amount, budget_group) VALUES ('Subscriptions', ?, '75.00', 'fixed')", (period,))
cur.execute("INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id) VALUES ('Streaming Bundle', 'Subscriptions', '-15.49', 'monthly', ?, ?)", (today.isoformat(), checking_id))
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  const buttons = await browser.$$("nav button");
  for (const b of buttons) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
try {
  await browser.setWindowSize(1440, 1000);
  await browser.pause(800);

  // 1. Recurring: exactly the four money cards, no orphaned fifth.
  await nav("Recurring");
  await (await browser.$(".stats")).waitForExist({ timeout: 10000 });
  const statCount = await browser.execute(() => document.querySelectorAll(".stats .stat").length);
  if (statCount !== 4) throw new Error(`expected 4 Recurring stat cards, found ${statCount}`);
  const tops = await browser.execute(() => [...document.querySelectorAll(".stats .stat")].map((el) => Math.round(el.getBoundingClientRect().top)));
  if (new Set(tops).size !== 1) throw new Error(`Recurring stat cards wrapped onto multiple rows: ${JSON.stringify(tops)}`);

  // 2. Budget: the full name is readable and the toggle says what it does.
  await nav("Budget");
  const name = await browser.$("//span[contains(@class,'category-link') and normalize-space()='Subscriptions']");
  await name.waitForExist({ timeout: 10000 });
  const truncated = await browser.execute((el) => el.scrollWidth > el.clientWidth, name);
  if (truncated) throw new Error("the Subscriptions category name is still truncated with its badge showing");
  const rowText = await (await name.parentElement().parentElement().parentElement()).getText();
  if (!rowText.includes("Warn at 90%")) throw new Error(`expected the toggle to read "Warn at 90%", got:\n${rowText}`);
  if (/\bCap\b/.test(rowText)) throw new Error(`the cryptic "Cap" label should be gone, got:\n${rowText}`);

  // 3 + 4. Transactions: a single-line date, and an honest account label.
  await nav("Transactions");
  const date = await browser.$(".date-cell");
  await date.waitForExist({ timeout: 10000 });
  const lineCount = await browser.execute((el) => el.getClientRects().length, date);
  if (lineCount !== 1) throw new Error(`the date wrapped onto ${lineCount} lines`);
  const label = await (await browser.$(".import-controls-label")).getText();
  if (label.trim() !== "Add to") throw new Error(`expected the account control's label to be "Add to", got "${label}"`);

  // 5. Household: the empty state offers the action itself.
  await nav("Household");
  const addButton = await browser.$("button*=Add family member");
  await addButton.waitForExist({ timeout: 10000 });
  await addButton.click();
  // The dialog animates open, so its text is empty for the first few
  // frames — wait for it rather than reading it the instant it exists.
  const dialog = await browser.$("[role='dialog']");
  await dialog.waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => /Manage family members/i.test(await dialog.getText()), {
    timeout: 10000,
    timeoutMsg: "expected the Manage family members dialog to open from Household's empty state",
  });

  console.log("FEATURE 61 E2E TEST PASSED");
} finally {
  await app.close();
}
