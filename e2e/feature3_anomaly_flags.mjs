// E2E smoke test for anomaly flags: seeds a same-amount, similarly-named
// duplicate pair (different accounts, one day apart) and confirms the
// Ledger shows a duplicate badge.
//
// Run with: node e2e/feature3_anomaly_flags.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking_id = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Savings', 'savings', '500.00')")
savings_id = cur.lastrowid
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, fingerprint) VALUES (?, ?, ?, ?, ?)",
    (checking_id, "${dateInMonth(-2, 5)}", "Netflix 4471", "-15.99", f"{checking_id}|${dateInMonth(-2, 5)}|netflix 4471|-15.99"),
)
cur.execute(
    "INSERT INTO transactions (account_id, date, description, amount, fingerprint) VALUES (?, ?, ?, ?, ?)",
    (savings_id, "${dateInMonth(-2, 6)}", "Netflix 8823", "-15.99", f"{savings_id}|${dateInMonth(-2, 6)}|netflix 8823|-15.99"),
)
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();

  const badge = await app.browser.$(".anomaly-duplicate");
  await badge.waitForExist({ timeout: 10000 });
  // The badge is a focusable button whose reason is linked text, not a hover-only title (QA M6).
  const reasonId = await badge.getAttribute("aria-describedby");
  const title = await app.browser.execute((id) => document.getElementById(id)?.textContent ?? "", reasonId);
  console.log("duplicate badge reason:", title);
  if (!title.includes("duplicate")) throw new Error(`expected the reason to mention "duplicate", got "${title}"`);
  if ((await badge.getTagName()) !== "button") throw new Error("expected the badge to be a button keyboard users can reach");

  const allBadges = await app.browser.$$(".anomaly-duplicate");
  console.log("duplicate badge count:", allBadges.length);
  if (allBadges.length !== 2) throw new Error(`expected both sides of the pair flagged, got ${allBadges.length}`);

  console.log("FEATURE 3 E2E TEST PASSED");
} finally {
  await app.close();
}
