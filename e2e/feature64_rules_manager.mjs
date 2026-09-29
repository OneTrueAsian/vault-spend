// E2E test for Phase 1 item 2 — the categorization rules manager.
//   - Settings lists every rule (the built-in starters are now real, deletable
//     rows) with how many transactions each touches.
//   - Adding a rule previews how many existing transactions it would change and
//     can apply itself to them; transactions the user categorized by hand are
//     never touched.
//   - Deleting a rule removes it.
//   - Fixing one transaction's category offers to apply the rule it just
//     taught the app to the other identical ones.
//
// Run with: node e2e/feature64_rules_manager.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
acct = cur.lastrowid

def add(desc, amount, category, source, n):
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (acct, today.isoformat(), desc, amount, category, source, f"fp-{n}"),
    )

# Three uncategorized, one the user set to Groceries by hand -> rule preview: 4 match, 3 would change.
add("Ferrywood Coffee #1", "-4.00", None, None, 1)
add("Ferrywood Coffee #2", "-4.50", None, None, 2)
add("Ferrywood Coffee #3", "-5.00", None, None, 3)
add("Ferrywood Coffee #4", "-6.00", "Groceries", "user", 4)
add("Green Leaf Grocers", "-30.00", "Groceries", "user", 5)
# For the "apply to similar" toast: three identical, uncategorized.
add("Corner Cart", "-3.00", None, None, 6)
add("Corner Cart", "-3.10", None, None, 7)
add("Corner Cart", "-3.20", None, None, 8)
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
async function selectCount(value) {
  return browser.execute((v) => [...document.querySelectorAll("table.ledger select")].filter((s) => s.value === v).length, value);
}
try {
  await browser.setWindowSize(1440, 1000);

  // 1. The starter rules are real rows now.
  await nav("Settings");
  const card = await browser.$("#categorization-rules");
  await card.waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => (await card.getText()).includes("payroll"), { timeout: 10000, timeoutMsg: "starter rules should be listed" });
  const listText = await card.getText();
  if (!listText.includes("grocer")) throw new Error(`expected the starter "grocer" rule, got:\n${listText}`);

  // 2. Add a rule; preview counts 4 matches / 3 changes and the user's own choice is protected.
  await (await card.$("button=Add rule…")).click();
  const dialog = await browser.$("[role='dialog']");
  await dialog.waitForExist({ timeout: 10000 });
  await (await dialog.$("input[placeholder*='Ferrywood']")).setValue("ferrywood coffee");
  await (await dialog.$("input[list]")).setValue("Dining Out");
  const preview = await dialog.$("[data-rule-preview='ready']");
  await preview.waitForExist({ timeout: 10000 });
  const previewText = await preview.getText();
  console.log("preview:", previewText);
  if (!previewText.includes("4 existing transactions contain this text") || !previewText.includes("3 would be re-categorized")) {
    throw new Error(`unexpected rule preview: ${previewText}`);
  }
  await (await dialog.$("button=Save rule")).click();
  await browser.waitUntil(async () => /re-categorized 3 transactions/.test(await (await browser.$(".toast-stack")).getText()), {
    timeout: 10000,
    timeoutMsg: "expected the confirmation that 3 transactions were re-categorized",
  });

  await nav("Transactions");
  await (await browser.$("table.ledger")).waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => (await selectCount("Dining Out")) === 3, { timeout: 10000, timeoutMsg: "the 3 uncategorized Ferrywood rows should now be Dining Out" });
  if ((await selectCount("Groceries")) !== 2) throw new Error("the user's own Groceries choices must be left alone");

  // 3. Fix one Corner Cart -> the toast offers the other two.
  // The row also has Account and Member dropdowns — pick the one that offers categories.
  const cartSelect = await browser.$("//tr[td[contains(.,'Corner Cart')]]//select[option[normalize-space()='Groceries']]");
  await cartSelect.selectByVisibleText("Entertainment");
  const toast = await browser.$(".toast-stack");
  await browser.waitUntil(async () => /2 similar transactions could use it too/.test(await toast.getText()), {
    timeout: 10000,
    timeoutMsg: "expected the offer to apply the new rule to the 2 identical transactions",
  });
  await (await toast.$("button*=Apply to 2")).click();
  await browser.waitUntil(async () => (await selectCount("Entertainment")) === 3, {
    timeout: 10000,
    timeoutMsg: "all three Corner Cart rows should now be Entertainment",
  });

  // 4. Delete a rule.
  await nav("Settings");
  const card2 = await browser.$("#categorization-rules");
  await card2.waitForExist({ timeout: 10000 });
  await (await card2.$("input[type='search']")).setValue("payroll");
  const row = await card2.$("//tr[td[normalize-space()='payroll']]");
  await row.waitForExist({ timeout: 10000 });
  await (await row.$("button=Delete")).click();
  await (await row.$("button=Delete")).click(); // the confirm button
  await browser.waitUntil(async () => (await card2.$$("//tr[td[normalize-space()='payroll']]")).length === 0, {
    timeout: 10000,
    timeoutMsg: "the payroll rule should be gone",
  });

  console.log("FEATURE 64 E2E TEST PASSED");
} finally {
  await app.close();
}
