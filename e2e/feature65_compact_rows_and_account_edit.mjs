// E2E test for Phase 1 item 14b:
//   - Transactions rows are compact by default, with a Comfortable/Compact
//     toggle that remembers the choice.
//   - Account cards no longer carry always-visible type/member dropdowns and
//     a Delete button; an Edit dialog holds type, institution, last four and
//     (behind a second step) deleting the account.
//
// Run with: node e2e/feature65_compact_rows_and_account_edit.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance, institution, mask) VALUES ('Test Checking', 'checking', '1000.00', 'Chase', '4821')")
acct = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Disposable Savings', 'savings', '50.00')")
for n, (desc, amount) in enumerate([("Green Leaf Grocers", "-30.00"), ("Ferrywood Coffee", "-4.50")]):
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, ?, ?, ?, 'Groceries', 'user', ?)",
        (acct, today.isoformat(), desc, amount, f"fp-{n}"),
    )
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
async function firstRowHeight() {
  return browser.execute(() => Math.round(document.querySelector("table.ledger tbody tr").getBoundingClientRect().height));
}
function accountCard(name) {
  return browser.$(
    `//div[contains(concat(' ', normalize-space(@class), ' '), ' account-card ')][.//div[contains(@class,'account-name-cell')][text()='${name}']]`,
  );
}
try {
  await browser.setWindowSize(1440, 1000);

  // ---- Transactions density
  await nav("Transactions");
  const table = await browser.$("table.ledger");
  await table.waitForExist({ timeout: 10000 });
  if (!(await table.getAttribute("class")).includes("ledger-compact")) throw new Error("rows should be compact by default");
  const compactHeight = await firstRowHeight();

  await (await browser.$("button=Comfortable")).click();
  await browser.waitUntil(async () => !(await table.getAttribute("class")).includes("ledger-compact"), { timeout: 5000 });
  const comfortableHeight = await firstRowHeight();
  console.log(`row height: compact ${compactHeight}px, comfortable ${comfortableHeight}px`);
  if (!(compactHeight < comfortableHeight)) {
    throw new Error(`compact rows (${compactHeight}px) should be shorter than comfortable ones (${comfortableHeight}px)`);
  }

  // The choice sticks across navigation.
  await nav("Dashboard");
  await nav("Transactions");
  const table2 = await browser.$("table.ledger");
  await table2.waitForExist({ timeout: 10000 });
  if ((await table2.getAttribute("class")).includes("ledger-compact")) throw new Error("the Comfortable choice should be remembered");
  await (await browser.$("button=Compact")).click();

  // ---- Accounts: no always-visible dropdowns / Delete; Edit dialog instead
  await nav("Accounts");
  const card = await accountCard("Test Checking");
  await card.waitForExist({ timeout: 10000 });
  const cardSelects = await card.$$("select");
  if (cardSelects.length !== 0) throw new Error(`the account card should have no dropdowns, found ${cardSelects.length}`);
  const cardText = await card.getText();
  console.log("card:", cardText.replace(/\n/g, " | "));
  if (/\bDelete\b/.test(cardText)) throw new Error("the account card should not show a Delete button any more");
  if (!cardText.includes("Chase") || !cardText.includes("4821") || !cardText.includes("Checking")) {
    throw new Error(`expected the card's detail line to show institution, last four and type, got:\n${cardText}`);
  }

  await (await card.$("button=Edit")).click();
  const dialog = await browser.$("[role='dialog']");
  await dialog.waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => /Edit Test Checking/.test(await dialog.getText()), { timeout: 10000 });
  await (await dialog.$("//label[contains(.,'Institution')]//input")).setValue("Ally");
  await (await dialog.$("//label[contains(.,'Account type')]//select")).selectByVisibleText("Savings");
  await (await dialog.$("button=Save changes")).click();
  await browser.waitUntil(
    async () => {
      const t = await (await accountCard("Test Checking")).getText();
      return t.includes("Ally") && t.includes("Savings") && !t.includes("Chase");
    },
    { timeout: 10000, timeoutMsg: "the card should show the edited institution and type" },
  );

  // ---- Delete needs an explicit second step inside the dialog
  const disposable = await accountCard("Disposable Savings");
  await (await disposable.$("button=Edit")).click();
  const dialog2 = await browser.$("[role='dialog']");
  await browser.waitUntil(async () => /Edit Disposable Savings/.test(await dialog2.getText()), { timeout: 10000 });
  await (await dialog2.$("button=Delete account…")).click();
  await (await dialog2.$("button=Delete account")).click();
  await browser.waitUntil(
    async () => (await browser.$$("//div[@class='account-name-cell'][text()='Disposable Savings']")).length === 0,
    { timeout: 10000, timeoutMsg: "the deleted account should be gone" },
  );

  console.log("FEATURE 65 E2E TEST PASSED");
} finally {
  await app.close();
}
