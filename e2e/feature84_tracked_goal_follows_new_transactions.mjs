// E2E test: a goal that follows an account's balance moves as soon as a
// transaction is added to that account — no restart, no revisiting the goal.
//
// Found in Phase 2 UAT: with "Progress follows this account's balance" on, the
// account's own balance updated after "Add transaction…" but the goal card on
// Goals kept showing the old figure, because the goals list was only read at
// launch and after goal edits.
//
// Run with: node e2e/feature84_tracked_goal_follows_new_transactions.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('High-Yield Savings', 'savings', '1000.00')")
savings = cur.lastrowid
cur.execute("INSERT INTO buckets (name, target_amount, account_id, tracks_account) VALUES ('Down Payment', '5000.00', ?, 1)", (savings,))
`);

const app = await launchApp({ dbDir });
const { browser } = app;

async function goTo(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) {
      await b.click();
      await browser.pause(600);
      return;
    }
  }
  throw new Error(`no nav button "${label}"`);
}
const goalText = async () => {
  const card = await browser.$("//div[contains(@class,'bucket-card')][.//*[normalize-space()='Down Payment']]");
  await card.waitForExist({ timeout: 10000 });
  return (await card.getText()).replace(/\s+/g, " ");
};

try {
  await goTo("Goals");
  const before = await goalText();
  console.log("before:", before);
  if (!before.includes("$1,000.00 of $5,000.00")) throw new Error(`the goal should start at the account's $1,000.00: ${before}`);

  // Add a $100 deposit to that account from the Transactions tab.
  await goTo("Transactions");
  await (await browser.$("button*=Add transaction")).click();
  const dialog = await browser.$("//h2[contains(@class,'modal-title')][text()='Add transaction']");
  await dialog.waitForExist({ timeout: 10000 });
  const panel = await browser.$("div[role='dialog']");
  await (await panel.$("input[placeholder='e.g. \"Coffee shop\"']")).setValue("Test deposit");
  await (await panel.$("input[placeholder='Negative = money out']")).setValue("100.00");
  await (await panel.$("button=Add transaction")).click();
  await dialog.waitForExist({ timeout: 5000, reverse: true });

  await goTo("Goals");
  await browser.waitUntil(async () => (await goalText()).includes("$1,100.00 of $5,000.00"), {
    timeout: 10000,
    timeoutMsg: `the goal should follow the account to $1,100.00 after the deposit, but reads: ${await goalText()}`,
  });
  console.log("after:", await goalText());

  console.log("FEATURE 84 E2E TEST PASSED");
} finally {
  await app.close?.();
}
