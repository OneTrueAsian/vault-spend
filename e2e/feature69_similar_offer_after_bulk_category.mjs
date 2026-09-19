// E2E regression test for a UAT finding: changing a category with the
// Transactions tab's bulk "Set category to…" control saves a rule (same as
// the row dropdown) but never offered to apply it to the other, identical
// transactions the way the row dropdown does ("N similar transactions could
// use it too" + an Apply button). Also covers several merchants at once.
//
// Run with: node e2e/feature69_similar_offer_after_bulk_category.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '1000.00')")
acct = cur.lastrowid
def add(desc, amount, n, days_ago):
    d = (today - datetime.timedelta(days=days_ago)).isoformat()
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, ?, ?, ?, NULL, NULL, ?)",
        (acct, d, desc, amount, f"fp-{n}"),
    )
# Two merchants, three identical uncategorized rows each.
for i in range(3):
    add("Corner Cart", f"-{3 + i / 10:.2f}", i, i)
    add("Lunch Truck", f"-{9 + i / 10:.2f}", 10 + i, i)
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
const selectCount = (value) =>
  browser.execute((v) => [...document.querySelectorAll("table.ledger select")].filter((s) => s.value === v).length, value);
async function tick(desc) {
  const box = await browser.$(`(//tr[td[contains(.,'${desc}')]]//input[@type='checkbox'])[1]`);
  await box.waitForExist({ timeout: 10000 });
  await box.click();
}
try {
  await browser.setWindowSize(1440, 1000);
  await nav("Transactions");
  await (await browser.$("table.ledger")).waitForExist({ timeout: 10000 });

  // ---- one merchant, via the bulk bar
  await tick("Corner Cart");
  const bulkSelect = await browser.$(".bulk-actions-bar select[aria-label='Set category to…']");
  await bulkSelect.waitForExist({ timeout: 10000 });
  await bulkSelect.selectByVisibleText("Entertainment");
  const toast = await browser.$(".toast-stack");
  await browser.waitUntil(async () => /Saved a rule: "Corner Cart" → Entertainment\. 2 similar transactions could use it too\./.test(await toast.getText()), {
    timeout: 10000,
    timeoutMsg: "expected the offer to apply the new Corner Cart rule to the 2 identical uncategorized rows",
  });
  await (await toast.$("button*=Apply to 2")).click();
  await browser.waitUntil(async () => (await selectCount("Entertainment")) === 3, { timeout: 10000, timeoutMsg: "all three Corner Cart rows should be Entertainment" });

  // ---- two merchants at once. Corner Cart's other two rows are now rule-sourced
  // (from the Apply above), so they are eligible again; Lunch Truck's two are
  // still uncategorized: 2 + 2 = 4 similar transactions.
  await tick("Lunch Truck");
  await tick("Corner Cart");
  await (await browser.$(".bulk-actions-bar select[aria-label='Set category to…']")).selectByVisibleText("Dining Out");
  await browser.waitUntil(async () => /Saved rules for 2 merchants → Dining Out\. 4 similar transactions could use them too\./.test(await toast.getText()), {
    timeout: 10000,
    timeoutMsg: "expected one combined offer for the two merchants covering 4 similar transactions",
  });
  await (await toast.$("button*=Apply to 4")).click();
  await browser.waitUntil(async () => (await selectCount("Dining Out")) === 6, {
    timeout: 10000,
    timeoutMsg: "all six rows (both merchants) should now be Dining Out",
  });

  console.log("FEATURE 69 E2E TEST PASSED");
} finally {
  await app.close();
}
