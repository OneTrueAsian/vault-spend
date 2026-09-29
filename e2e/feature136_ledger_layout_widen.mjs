// E2E test for Task 6 of the Transactions usability plan — the ledger uses
// available window width, its row account/category/member editors are the
// new RowFieldDropdown (not a native <select> that can't wrap), and narrow
// windows fold those editors into a per-row Details panel that stays fully
// editable and keeps an accessible way to change sort even once a
// sortable column's own header has moved out of view.
//
// Run with: node e2e/feature136_ledger_layout_widen.mjs

import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
def days_ago(n): return (today - datetime.timedelta(days=n)).isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
checking = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Savings', 'savings', '1000.00')")
savings = cur.lastrowid
cur.execute("INSERT INTO family_members (name) VALUES ('Alex')")

def add(account_id, date, desc, amount, category, n):
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, ?, ?, ?, ?, 'user', ?)",
        (account_id, date, desc, amount, category, f"fp136-{n}"),
    )

add(checking, days_ago(0), "Grocery Run", "-60.00", "Groceries", 1)
add(checking, days_ago(1), "Coffee Shop", "-4.50", "Dining Out", 2)
add(savings, days_ago(2), "Interest", "5.00", "Income", 3)
`);

const app = await launchApp({ dbDir });
const { browser } = app;

async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) {
      await b.click();
      return;
    }
  }
  throw new Error(`no nav button "${label}"`);
}

const rowFor = (description) => browser.$(`//tr[td[contains(.,'${description}')]]`);

try {
  await nav("Transactions");
  await (await browser.$("table.ledger")).waitForExist({ timeout: 10000 });

  // ---- 1. Wide layout uses newly available space at 1920px -------------
  await browser.setWindowSize(1920, 1000);
  await browser.pause(200);
  const pageWidth = await browser.execute(() => document.querySelector(".page")?.getBoundingClientRect().width);
  assert.ok(pageWidth > 1300, `expected the ledger page to use the extra width at 1920px, measured ${pageWidth}px (was capped at 1180px before)`);
  const wideOverflow = await browser.execute(() => {
    const el = document.querySelector(".ledger-table-scroll");
    return el.scrollWidth - el.clientWidth;
  });
  assert.ok(wideOverflow <= 1, `expected no sideways table scroll at 1920px, got ${wideOverflow}px`);
  console.log(`wide layout: page is ${Math.round(pageWidth)}px at a 1920px window, table fits without scrolling`);

  // ---- 2. Row account/category/member editors are the real popover, not
  //         a native <select>, and editing one actually saves -----------
  const groceryRow = await rowFor("Grocery Run");
  const accountTrigger = await groceryRow.$('[aria-label*="Account for"]');
  assert.ok(await accountTrigger.isExisting(), "expected a RowFieldDropdown trigger for the row's account, not a native select");
  await accountTrigger.click();
  const savingsOption = await browser.$("//button[@role='menuitemradio'][.//span[normalize-space()='Savings']]");
  await savingsOption.waitForExist({ timeout: 5000 });
  await savingsOption.click();
  await browser.waitUntil(
    async () => (await (await rowFor("Grocery Run")).$('[aria-label*="Account for"]')).getText().then((t) => t.includes("Savings")),
    { timeout: 10000, timeoutMsg: "expected picking Savings from the row's account editor to actually move the transaction" },
  );
  console.log("row account editor: RowFieldDropdown, and picking an option saves it");

  // ---- 3. Narrow layout: Details panel appears, fields still editable --
  await browser.setWindowSize(800, 900);
  await browser.pause(300);
  const narrowOverflow = await browser.execute(() => {
    const main = document.querySelector(".main");
    return main.scrollWidth - main.clientWidth;
  });
  assert.ok(narrowOverflow <= 1, `expected no sideways page scroll at 800px, got ${narrowOverflow}px`);

  const coffeeRow = await rowFor("Coffee Shop");
  assert.ok(!(await coffeeRow.$(".category-col").isExisting()), "expected the Category column itself to be gone in narrow layout");
  const detailsBtn = await coffeeRow.$("button=Details");
  await detailsBtn.waitForExist({ timeout: 10000, timeoutMsg: "expected a Details toggle on the row in narrow layout" });
  await detailsBtn.click();
  const detailsPanel = await browser.$(".ledger-details-row");
  await detailsPanel.waitForExist({ timeout: 5000, timeoutMsg: "expected the Details panel to open" });
  // The label text renders uppercase (CSS text-transform), which getText()
  // reflects (it reports the rendered, not literal DOM, text) — compare
  // case-insensitively.
  const panelText = (await detailsPanel.getText()).toLowerCase();
  for (const label of ["account", "member", "category", "source"]) {
    assert.ok(panelText.includes(label), `expected the Details panel to label its ${label} field`);
  }

  // Edit the category from inside the open Details panel.
  const categoryTrigger = await detailsPanel.$('[aria-label*="Category for"]');
  assert.ok(await categoryTrigger.isExisting(), "expected the category editor inside the Details panel");
  await categoryTrigger.click();
  const groceriesOption = await browser.$("//button[@role='menuitemradio'][.//span[normalize-space()='Groceries']]");
  await groceriesOption.waitForExist({ timeout: 5000 });
  await groceriesOption.click();
  await browser.waitUntil(
    async () => (await browser.$(".ledger-details-row").getText()).includes("Groceries"),
    { timeout: 10000, timeoutMsg: "expected editing the category from inside Details to save" },
  );
  console.log("narrow layout: Details panel opens, labels every moved field, and stays editable");

  // ---- 4. An accessible Sort by control covers a column whose header has
  //         moved into Details, and reordering actually works -----------
  const sortBy = await browser.$("select[aria-label='Sort by']");
  await sortBy.waitForExist({ timeout: 10000, timeoutMsg: "expected a Sort by control once column headers move into Details" });
  await sortBy.selectByAttribute("value", "account");
  await browser.waitUntil(
    async () => (await sortBy.getValue()) === "account",
    { timeout: 5000, timeoutMsg: "expected the Sort by control to hold Account after selecting it" },
  );
  const firstRowDescriptionByAccount = await browser.execute(() => document.querySelector("table.ledger tbody tr td:nth-child(3)")?.textContent);
  assert.ok(firstRowDescriptionByAccount, "expected the ledger to still show rows after sorting by a column whose header is hidden");
  console.log("narrow layout: Sort by control covers a hidden column's header and reorders the ledger");

  // ---- 5. Selection survives a resize between wide and narrow layouts --
  await browser.setWindowSize(1920, 1000);
  await browser.pause(200);
  const interestCheckbox = await (await rowFor("Interest")).$("input[type=checkbox]");
  await interestCheckbox.click();
  assert.ok(await interestCheckbox.isSelected(), "expected the row to be selected before resizing");
  await browser.setWindowSize(800, 900);
  await browser.pause(300);
  const interestCheckboxNarrow = await (await rowFor("Interest")).$("input[type=checkbox]");
  assert.ok(await interestCheckboxNarrow.isSelected(), "expected the selection to survive resizing into narrow layout");
  console.log("selection survives a resize between wide and narrow layouts");

  console.log("FEATURE 136 E2E TEST PASSED");
} finally {
  await app.close();
}
