// Reproduces the six 2026-09-29 owner-reported Transactions usability issues
// against the current build, as one fixture plus independent checks. Each
// check is wrapped so the first missing feature does not stop the others
// from being collected and reported — read the whole summary at the end,
// not just the first line.
//
// This is Task 1 of vault-spend-transactions-usability-implementation-plan-2026-09-29.md
// (E:\misc\Programming\Claude\). Every check below is expected to be RED
// against the current build; Tasks 2, 4, 5 and 6 turn them GREEN one at a
// time as each fix lands — this file is updated in place as that happens,
// not left permanently failing.
//
// Run with: node e2e/run-all.mjs --spec=134

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const SHOT_DIR = path.join(os.tmpdir(), "vault-feature134-shots");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const LONG_ACCOUNT = "Household checking \u2014 annual expenses and reimbursements";
const LONG_CATEGORY = "Home maintenance and unexpected repairs";
const LONG_TAG = "a".repeat(80);
// Non-ASCII via \uXXXX escapes rather than literal bytes, so this survives
// Node -> python -c argv on Windows without an encoding round-trip: café,
// résumé, an em dash.
const NON_ASCII_DESC = "Caf\\u00e9 R\\u00e9sum\\u00e9 \\u2014 imported vendor";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
def days_ago(n): return (today - datetime.timedelta(days=n)).isoformat()

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES (?, 'checking', '5000.00')", ("${LONG_ACCOUNT}",))
checking = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('High-Yield Savings', 'savings', '2000.00')")
savings = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Backup Savings', 'savings', '500.00')")
backup_savings = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Home Loan', 'loan', '250000.00')")
loan = cur.lastrowid

cur.execute("INSERT INTO family_members (name) VALUES ('Alexandria Montgomery-Whitfield')")
member = cur.lastrowid

def add(account_id, date, desc, amount, category, n, member_id=None):
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint, member_id) VALUES (?, ?, ?, ?, ?, 'user', ?, ?)",
        (account_id, date, desc, amount, category, f"f134-{n}", member_id),
    )
    return cur.lastrowid

# Two ordinary possible-transfer pairs.
add(checking, days_ago(0), "Move to savings", "-500.00", "Savings Goal", 1)
add(savings, days_ago(0), "Deposit from checking", "500.00", "Savings Goal", 2)
add(checking, days_ago(1), "Sent to brother", "-75.00", "Gifts", 3)
add(savings, days_ago(1), "Brother paid me back", "75.00", "Gifts", 4)

# One outgoing leg with two plausible incoming legs (ambiguous match).
out3 = add(checking, days_ago(0), "Emergency transfer", "-300.00", "${LONG_CATEGORY}", 5)
add(savings, days_ago(0), "From checking A", "300.00", "${LONG_CATEGORY}", 6)
add(backup_savings, days_ago(0), "From checking B", "300.00", "${LONG_CATEGORY}", 7)

# Nonmatching transactions: large amounts, one with a member assigned.
add(checking, days_ago(0), "Green Leaf Grocers", "-1234.78", "Groceries", 8)
add(checking, days_ago(0), "Payroll Deposit", "9876.54", "Income", 9, member)

# An existing linked pair — already reviewed, must not be suggested again.
linked_out = add(checking, days_ago(3), "Existing transfer out", "-200.00", "Transfer", 10)
linked_in = add(savings, days_ago(3), "Existing transfer in", "200.00", "Transfer", 11)
cur.execute("INSERT INTO transfer_links (out_transaction_id, in_transaction_id, auto, reviewed) VALUES (?, ?, 0, 1)", (linked_out, linked_in))

# A split row.
split_tx = add(checking, days_ago(0), "Costco run", "-150.00", None, 12)
cur.execute("INSERT INTO transaction_splits (transaction_id, category, amount) VALUES (?, 'Groceries', '-100.00')", (split_tx,))
cur.execute("INSERT INTO transaction_splits (transaction_id, category, amount) VALUES (?, 'Household', '-50.00')", (split_tx,))

# A debt row: a mortgage payment already applied to the loan account.
debt_source = add(checking, days_ago(2), "Mortgage payment", "-1800.00", "${LONG_CATEGORY}", 13)
debt_generated = add(loan, days_ago(2), "Mortgage payment applied", "-1800.00", "Transfer", 14)
cur.execute(
    "INSERT INTO debt_payments (source_transaction_id, debt_account_id, generated_transaction_id, amount, date) VALUES (?, ?, ?, '1800.00', ?)",
    (debt_source, loan, debt_generated, days_ago(2)),
)

# Tags, including an unbroken 80-char tag, and non-ASCII text.
tagged = add(checking, days_ago(0), "${NON_ASCII_DESC}", "-42.00", "Dining", 15)
cur.execute("INSERT INTO transaction_tags (transaction_id, tag) VALUES (?, 'reimbursable')", (tagged,))
cur.execute("INSERT INTO transaction_tags (transaction_id, tag) VALUES (?, 'work')", (tagged,))
cur.execute("INSERT INTO transaction_tags (transaction_id, tag) VALUES (?, '${LONG_TAG}')", (tagged,))
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

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`[feature134] PASS: ${name}`);
  } catch (e) {
    failures.push({ name, error: e.message });
    console.log(`[feature134] FAIL (expected for now): ${name} \u2014 ${e.message}`);
  }
}

try {
  await browser.setWindowSize(1440, 1000);
  await nav("Transactions");
  await (await browser.$("table.ledger")).waitForExist({ timeout: 10000 });

  // Issue 1 — possible transfers cannot be cleared: real functional check
  // (not just presence) once Task 2 lands. Fixture has 3 suggested pairs
  // (2 ordinary + 1 from the ambiguous "Emergency transfer" trio); dismiss
  // one and confirm the chip's count actually drops, then close and reopen
  // to prove it's really gone, not just hidden by unmounting.
  await check("dismissing a transfer pair really removes it, not just Not now", async () => {
    const chip = await browser.$("button.transfer-suggestion");
    await chip.waitForExist({ timeout: 10000 });
    const before = await chip.getText();
    await chip.click();
    const dialog = await browser.$("[role='dialog']");
    await dialog.waitForExist({ timeout: 10000 });
    const dismissButtons = await dialog.$$(".transfer-review-dismiss");
    assert.ok(dismissButtons.length > 0, "expected a Dismiss action in the transfer review dialog, found none (only Not now / Link)");
    await dismissButtons[0].click();
    await browser.waitUntil(
      async () => (await dialog.$$(".transfer-review-dismiss")).length === dismissButtons.length - 1,
      { timeout: 5000, timeoutMsg: "the dismissed pair should disappear from the open dialog" },
    );
    const closeBtn = await dialog.$("button=Not now");
    if (await closeBtn.isExisting()) await closeBtn.click();
    else await (await dialog.$("button=Close")).click();
    await browser.waitUntil(
      async () => {
        const chipNow = await browser.$("button.transfer-suggestion");
        return !(await chipNow.isExisting()) || (await chipNow.getText()) !== before;
      },
      { timeout: 5000, timeoutMsg: "the suggestion count must actually decrease after dismissing, not revert" },
    );
  });

  // Issue 2 — no way to add notes to a transaction.
  await check("a transaction row offers a notes action", async () => {
    const notesButtons = await browser.$$("button*=note");
    assert.ok(notesButtons.length > 0, "expected an Add note / Edit note action on a transaction row, found none");
  });

  // Issue 3 — category filter is a bare native <select>, unlike its
  // popover siblings (AccountFilterDropdown / MemberFilterDropdown).
  await check("category filter matches the popover pattern of its siblings", async () => {
    const trigger = await browser.$(".category-filter-toggle");
    assert.ok(await trigger.isExisting(), "expected a .category-filter-toggle popover trigger like the account/member filters, found none (still a native <select>)");
  });

  // Issue 4 — dropdown menus are translucent in the Transparent theme
  // (measured composited alpha, not just the CSS token string).
  await check("account filter panel is opaque in the Transparent theme", async () => {
    await browser.execute(() => {
      document.documentElement.dataset.palette = "transparent";
    });
    await browser.pause(200);
    // Scoped to .ledger-filters: AccountDestinationDropdown reuses the same
    // "account-filter-panel" class elsewhere in the DOM for shared styling,
    // and an unscoped query can match that unrelated panel instead.
    const trigger = await browser.$(".ledger-filters .account-filter-toggle");
    await trigger.click();
    const panel = await browser.$(".ledger-filters .account-filter-panel");
    await panel.waitForDisplayed({ timeout: 5000 });
    const alpha = await browser.execute(() => {
      const el = document.querySelector(".ledger-filters .account-filter-panel");
      const css = getComputedStyle(el);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = css.backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data[3];
    });
    await trigger.click();
    await browser.execute(() => {
      document.documentElement.dataset.palette = "classic";
    });
    assert.equal(alpha, 255, `account filter panel must be opaque in the Transparent theme, measured composited alpha ${alpha}/255`);
  });

  // Issue 5 — long account/category names are clipped in the row's native
  // selects (measured against the text the select would actually need).
  await check("long account name is not clipped in the row's account select", async () => {
    const { needed, rendered } = await browser.execute(() => {
      const el = [...document.querySelectorAll("select")].find((s) => s.getAttribute("aria-label") === 'Account for "Green Leaf Grocers"');
      if (!el) return { missing: true };
      const opt = el.options[el.selectedIndex];
      const css = getComputedStyle(el);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      ctx.font = `${css.fontSize} ${css.fontFamily}`;
      return { needed: ctx.measureText(opt.textContent).width, rendered: el.getBoundingClientRect().width };
    });
    assert.ok(needed !== undefined, "expected to find the account select for Green Leaf Grocers");
    assert.ok(rendered >= needed, `account select is ${Math.round(rendered)}px but needs ~${Math.round(needed)}px to show "${LONG_ACCOUNT}" without clipping`);
  });

  // Issue 6 — the ledger table needs its own sideways scrollbar at a normal
  // desktop window size.
  await check("ledger table fits without its own sideways scrollbar at 1440x1000", async () => {
    const overflow = await browser.execute(() => {
      const el = document.querySelector(".ledger-table-scroll");
      return el.scrollWidth - el.clientWidth;
    });
    assert.ok(overflow <= 1, `Transactions table overflows by ${overflow}px at 1440x1000`);
  });

  // Screenshot sweep: 3 viewports x 2 densities, with a menu open, for
  // visual review alongside the assertions above.
  const viewports = [
    [1440, 1000],
    [1280, 900],
    [960, 900],
  ];
  for (const [w, h] of viewports) {
    await browser.setWindowSize(w, h);
    const actualViewport = await browser.execute(() => ({ innerWidth: window.innerWidth, innerHeight: window.innerHeight }));
    const outerSize = await browser.getWindowSize();
    console.log(`[feature134] requested ${w}x${h} -> viewport ${actualViewport.innerWidth}x${actualViewport.innerHeight}, outer window ${outerSize.width}x${outerSize.height}`);
    for (const density of ["Compact", "Comfortable"]) {
      const densityBtn = await browser.$(`button=${density}`);
      if (await densityBtn.isExisting()) await densityBtn.click();
      await browser.pause(150);
      const trigger = await browser.$(".ledger-filters .account-filter-toggle");
      if (await trigger.isExisting()) {
        await trigger.click();
        await browser.pause(150);
      }
      const file = path.join(SHOT_DIR, `w${w}h${h}-${density.toLowerCase()}.png`);
      await browser.saveScreenshot(file);
      console.log(`[feature134] screenshot: ${file}`);
      if (await trigger.isExisting()) await trigger.click();
    }
  }
  console.log(`[feature134] screenshots saved under ${SHOT_DIR}`);
} finally {
  await app.close();
}

console.log(`FEATURE 134: ${failures.length} of 6 checks currently fail (expected until Tasks 2/4/5/6 land):`);
for (const f of failures) console.log(` - ${f.name}: ${f.error}`);
if (failures.length === 0) {
  console.log("FEATURE 134 E2E TEST PASSED");
} else {
  process.exitCode = 1;
}
