// E2E test for Task 6 of the Transactions usability plan — the ledger uses
// available window width, its row account/category/member editors are the
// new RowFieldDropdown (not a native <select> that can't wrap), and narrow
// windows fold those editors into a per-row Details panel that stays fully
// editable and keeps an accessible way to change sort even once a
// sortable column's own header has moved out of view.
//
// Run with: node e2e/feature136_ledger_layout_widen.mjs

import assert from "node:assert/strict";
import { launchApp, chooseMenuOption, menuSelectValue, pickFromMenu } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
def days_ago(n): return (today - datetime.timedelta(days=n)).isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
checking = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Savings', 'savings', '1000.00')")
savings = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Home Loan', 'loan', '250000.00')")
loan = cur.lastrowid
cur.execute("INSERT INTO family_members (name) VALUES ('Alex')")

def add(account_id, date, desc, amount, category, n):
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, ?, ?, ?, ?, 'user', ?)",
        (account_id, date, desc, amount, category, f"fp136-{n}"),
    )
    return cur.lastrowid

add(checking, days_ago(0), "Grocery Run", "-60.00", "Groceries", 1)
add(checking, days_ago(1), "Coffee Shop", "-4.50", "Dining Out", 2)
add(savings, days_ago(2), "Interest", "5.00", "Income", 3)

# A debt payment already applied — its "→ Home Loan (…) Undo" badge once
# overlapped the Actions column (found by a UAT screenshot) at a normal
# desktop width.
debt_source = add(checking, days_ago(3), "Mortgage Payment", "-1800.00", "Housing", 4)
debt_generated = add(loan, days_ago(3), "Mortgage payment applied", "-1800.00", "Transfer", 5)
cur.execute(
    "INSERT INTO debt_payments (source_transaction_id, debt_account_id, generated_transaction_id, amount, date) VALUES (?, ?, ?, '1800.00', ?)",
    (debt_source, loan, debt_generated, days_ago(3)),
)
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
  // The ledger is wider than every other tab's 1180px cap, but deliberately
  // stops at 1298px (.page-ledger) rather than stretching across the window.
  assert.ok(pageWidth > 1180 && pageWidth <= 1298.5, `expected the ledger page to be wider than the old 1180px cap but held to 1298px at 1920px, measured ${pageWidth}px`);
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
  // The ledger may cut the label off with an ellipsis, so the full name must be on hover.
  const tooltipMatchesLabel = await accountTrigger.execute((el) => el.title !== "" && el.title === el.querySelector("span").textContent);
  assert.ok(tooltipMatchesLabel, "expected the row's account button to carry its full name as a tooltip");
  await pickFromMenu(browser, async () => accountTrigger, "//button[@role='menuitemradio'][.//span[normalize-space()='Savings']]");
  await browser.waitUntil(
    async () => (await (await rowFor("Grocery Run")).$('[aria-label*="Account for"]')).getText().then((t) => t.includes("Savings")),
    { timeout: 10000, timeoutMsg: "expected picking Savings from the row's account editor to actually move the transaction" },
  );
  console.log("row account editor: RowFieldDropdown, and picking an option saves it");

  // ---- 2b. The category editor's "Uncategorized" placeholder is not a
  //          real, pickable choice — a regression found by code review:
  //          the native <select> it replaced had it as `<option disabled>`,
  //          and picking it would set category="" (not NULL), register a
  //          blank category, and save a rule sending this merchant to "".
  const coffeeRowForCategory = await rowFor("Coffee Shop");
  const categoryTriggerWide = await coffeeRowForCategory.$('[aria-label*="Category for"]');
  await categoryTriggerWide.click();
  const uncategorizedOption = await browser.$("//button[@role='menuitemradio'][.//span[normalize-space()='Uncategorized']]");
  await uncategorizedOption.waitForExist({ timeout: 5000 });
  assert.equal(await uncategorizedOption.getAttribute("aria-disabled"), "true", "expected the Uncategorized placeholder to be marked disabled");
  // Disabled must also *look* disabled — a screenshot found it reading as
  // plain, ordinary (clickable-looking) text otherwise, with no visual
  // cue that clicking it does nothing.
  const disabledColors = await browser.execute(() => {
    const opt = [...document.querySelectorAll("[role='menuitemradio']")].find((b) => b.textContent.includes("Uncategorized"));
    const other = [...document.querySelectorAll("[role='menuitemradio']")].find((b) => !b.getAttribute("aria-disabled") && b.textContent.trim() !== "");
    return { disabled: getComputedStyle(opt).color, ordinary: getComputedStyle(other).color };
  });
  assert.notEqual(disabledColors.disabled, disabledColors.ordinary, `expected the disabled placeholder to read visually distinct from an ordinary option, got the same color ${disabledColors.disabled} for both`);
  const categoryBefore = await categoryTriggerWide.getText();
  await uncategorizedOption.click();
  await browser.pause(300);
  assert.equal(await categoryTriggerWide.getText(), categoryBefore, "clicking the disabled Uncategorized placeholder must not change the row's category");
  await browser.keys("Escape");
  console.log("category editor: the Uncategorized placeholder is disabled, not a pickable choice");

  // ---- 2c. A row menu escapes the ledger's own scrolling container -------
  // .ledger-table-scroll sets overflow-x: auto, which per the CSS spec also
  // clips vertically once either axis is non-visible — a menu absolutely
  // positioned inside that subtree gets cut off wherever the table itself
  // ends, even though the real browser window has room below it (found by
  // code review, reproduced against the real compiled app).
  const categoryTriggerForClip = await (await rowFor("Coffee Shop")).$('[aria-label*="Category for"]');
  await categoryTriggerForClip.click();
  const clipGeometry = await browser.execute(() => {
    const scroller = document.querySelector(".ledger-table-scroll");
    const panel = document.querySelector(".row-field-panel");
    return {
      panelParentIsBody: panel.parentElement === document.body,
      panelFullyOnscreen: panel.getBoundingClientRect().bottom <= window.innerHeight && panel.getBoundingClientRect().top >= 0,
      clippedByScroller: panel.getBoundingClientRect().bottom > scroller.getBoundingClientRect().bottom + 4,
    };
  });
  assert.ok(clipGeometry.panelParentIsBody, "expected the row menu to portal to document.body, escaping the scroller's clipping");
  assert.ok(clipGeometry.panelFullyOnscreen, "expected the row menu to be fully within the real browser window");
  assert.ok(clipGeometry.clippedByScroller, "expected this fixture to actually extend past the scroller's own bottom edge — otherwise this check isn't exercising the bug it's named for");
  await browser.keys("Escape");
  console.log("row menu escapes the ledger's own scroll container:", JSON.stringify(clipGeometry));

  // ---- 2d. An already-applied debt badge doesn't overlap the row's actions
  // Found by a UAT screenshot, not any assertion: .debt-applied-badge's
  // "Undo" button once overlapped the Actions column's Delete button at
  // 1440px. The badge now sits under the description and the actions are
  // one ⋯ menu; the two still must not overlap.
  await browser.setWindowSize(1440, 1000);
  await browser.pause(300);
  const mortgageRow = await rowFor("Mortgage Payment");
  await mortgageRow.scrollIntoView({ block: "center" });
  const overlapGeometry = await browser.execute(() => {
    const rows = [...document.querySelectorAll("tr")];
    const row = rows.find((r) => r.textContent.includes("Mortgage Payment"));
    const undoBtn = [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === "Undo");
    const deleteBtn = row.querySelector("[data-row-menu]");
    const a = undoBtn.getBoundingClientRect();
    const b = deleteBtn.getBoundingClientRect();
    const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return { overlaps, undoRect: { left: a.left, right: a.right }, menuRect: { left: b.left, right: b.right } };
  });
  assert.ok(!overlapGeometry.overlaps, `expected the debt-applied Undo button not to overlap the row's ⋯ menu, got: ${JSON.stringify(overlapGeometry)}`);
  console.log("debt-applied badge doesn't overlap the row's ⋯ menu:", JSON.stringify(overlapGeometry));

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
  for (const label of ["account", "member", "category", "sorted by"]) {
    assert.ok(panelText.includes(label), `expected the Details panel to label its ${label} field`);
  }

  // Edit the category from inside the open Details panel.
  const categoryTrigger = await detailsPanel.$('[aria-label*="Category for"]');
  assert.ok(await categoryTrigger.isExisting(), "expected the category editor inside the Details panel");
  await pickFromMenu(browser, async () => categoryTrigger, "//button[@role='menuitemradio'][.//span[normalize-space()='Groceries']]");
  await browser.waitUntil(
    async () => (await browser.$(".ledger-details-row").getText()).includes("Groceries"),
    { timeout: 10000, timeoutMsg: "expected editing the category from inside Details to save" },
  );
  console.log("narrow layout: Details panel opens, labels every moved field, and stays editable");

  // ---- 4. An accessible Sort by control covers a column whose header has
  //         moved into Details, and reordering actually works -----------
  const sortBy = await browser.$("button[aria-label^='Sort by']");
  await sortBy.waitForExist({ timeout: 10000, timeoutMsg: "expected a Sort by control once column headers move into Details" });
  await chooseMenuOption(sortBy, { value: "account" });
  await browser.waitUntil(
    async () => (await menuSelectValue(sortBy)) === "account",
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
