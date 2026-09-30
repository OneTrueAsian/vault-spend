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
    // Every pair starts ticked; untick all but the first so "Dismiss N selected"
    // dismisses exactly one. There is deliberately no per-row Dismiss button.
    assert.equal((await dialog.$$(".transfer-review-dismiss")).length, 0, "the per-row Dismiss button was removed");
    const rows = await dialog.$$(".transfer-review-row");
    assert.ok(rows.length > 1, `expected several suggested pairs in the fixture, found ${rows.length}`);
    for (const row of rows.slice(1)) await (await row.$("input[type=checkbox]")).click();
    const dismissSelected = await dialog.$("[data-dismiss-selected]");
    assert.match(await dismissSelected.getText(), /Dismiss 1 selected/, "only the first pair should be selected");
    await dismissSelected.click();
    await browser.waitUntil(
      async () => (await dialog.$$(".transfer-review-row")).length === rows.length - 1,
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

  // Issue 2 — no way to add notes to a transaction: real functional check
  // (not just presence) once Task 4 lands — add one through the real
  // "+ Add note" button and confirm it actually saved, not just that a
  // button with the word "note" exists somewhere on the page.
  await check("a transaction row offers a notes action", async () => {
    const row = await browser.$("//tr[td[contains(.,'Green Leaf Grocers')]]");
    const addBtn = await row.$("button[aria-label*='Add note for']");
    assert.ok(await addBtn.isExisting(), "expected an Add note action on the Green Leaf Grocers row, found none");
    await addBtn.click();
    const dialogHeading = await browser.$("//h2[contains(@class,'modal-title')][contains(text(),'Note for')]");
    await dialogHeading.waitForExist({ timeout: 5000, timeoutMsg: "expected the note dialog to open" });
    const panel = await browser.$(".modal-panel");
    await (await panel.$("textarea")).setValue("Price looked off, double-check receipt");
    await (await panel.$("button=Save")).click();
    await panel.waitForExist({ timeout: 5000, reverse: true });
    await browser.waitUntil(
      async () => (await (await browser.$("//tr[td[contains(.,'Green Leaf Grocers')]]")).getText()).includes("Price looked off"),
      { timeout: 5000, timeoutMsg: "expected the saved note to preview on the row, not just close the dialog" },
    );
  });

  // Issue 3 — category filter is a bare native <select>, unlike its
  // popover siblings (AccountFilterDropdown / MemberFilterDropdown).
  await check("category filter matches the popover pattern of its siblings", async () => {
    const trigger = await browser.$(".category-filter-toggle");
    assert.ok(await trigger.isExisting(), "expected a .category-filter-toggle popover trigger like the account/member filters, found none (still a native <select>)");
  });

  // Issue 4 — dropdown menus are translucent in the Transparent theme
  // (measured composited alpha, not just the CSS token string). Checked
  // across all 6 palette/mode combinations, and both distinct Transactions
  // toolbar popovers (account filter, category filter) that share the
  // `.account-filter-panel` CSS class the fix targets — not just one.
  const PALETTES = [null, "futuristic", "transparent"];
  const MODES = ["light", "dark"];
  await check("every Transactions toolbar menu panel is opaque across every palette/mode combination", async () => {
    const combosFailing = [];
    for (const palette of PALETTES) {
      for (const mode of MODES) {
        await browser.execute(
          (p, m) => {
            if (p) document.documentElement.dataset.palette = p;
            else delete document.documentElement.dataset.palette;
            document.documentElement.dataset.theme = m;
          },
          palette,
          mode,
        );
        await browser.pause(150);
        // Scoped selectors: CategoryFilterDropdown's trigger also carries the
        // shared `account-filter-toggle` class, so an unqualified query for
        // "the account filter toggle" can resolve to the wrong one.
        for (const [name, triggerSelector] of [
          ["account filter", ".ledger-filters .account-filter-toggle:not(.category-filter-toggle)"],
          ["category filter", ".ledger-filters .category-filter-toggle"],
        ]) {
          const trigger = await browser.$(triggerSelector);
          await trigger.click();
          const panel = await browser.$(".ledger-filters .account-filter-panel");
          await panel.waitForDisplayed({ timeout: 5000 });
          const alpha = await browser.execute((sel) => {
            const el = document.querySelector(sel);
            const css = getComputedStyle(el);
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = css.backgroundColor;
            ctx.fillRect(0, 0, 1, 1);
            return ctx.getImageData(0, 0, 1, 1).data[3];
          }, ".ledger-filters .account-filter-panel");
          await trigger.click();
          if (alpha !== 255) combosFailing.push(`${name} panel, palette=${palette ?? "classic"} theme=${mode}: alpha ${alpha}/255`);
        }
      }
    }
    await browser.execute(() => {
      delete document.documentElement.dataset.palette;
      delete document.documentElement.dataset.theme;
    });
    assert.deepEqual(combosFailing, [], `expected every combination opaque, found:\n${combosFailing.join("\n")}`);
  });

  // Issue 5 — long account/category names used to be clipped in the row's
  // native <select> (a fixed pixel width with no wrapping possible in any
  // engine). Task 6 replaced it with RowFieldDropdown, a custom trigger
  // that wraps its label across lines instead — so the real check now is
  // "the full name is present and not clipped horizontally or vertically",
  // not "the box is wide enough for one unbroken line".
  await check("long account name is not clipped in the row's account select", async () => {
    const result = await browser.execute((longAccount) => {
      const el = document.querySelector('[aria-label=\'Account for "Green Leaf Grocers"\']');
      if (!el) return { missing: true };
      const css = getComputedStyle(el);
      return {
        text: el.textContent,
        fullTextPresent: el.textContent.includes(longAccount),
        noEllipsis: !(css.textOverflow === "ellipsis" && css.overflow === "hidden"),
        noHorizontalClip: el.scrollWidth <= el.clientWidth + 1,
        noVerticalClip: el.scrollHeight <= el.clientHeight + 1,
      };
    }, LONG_ACCOUNT);
    assert.ok(!result.missing, "expected to find the account editor trigger for Green Leaf Grocers");
    assert.ok(result.fullTextPresent, `expected the full account name in the trigger, got: "${result.text}"`);
    assert.ok(result.noEllipsis, "the account editor trigger must not CSS-ellipsize its label");
    assert.ok(result.noHorizontalClip, "the account editor trigger clips its label horizontally");
    assert.ok(result.noVerticalClip, "the account editor trigger clips its label vertically (wrapped text taller than the box)");
  });

  // Issue 6 — the ledger table needs its own sideways scrollbar at a normal
  // desktop window size. Extended (still one check) to every width the plan
  // names, including its narrowest (800x900, below the narrow-layout
  // breakpoint), and the page itself, not just the table (which already
  // has its own scroll escape hatch — .main overflowing sideways would
  // drag the whole app with it).
  await check("ledger table fits without its own sideways scrollbar at 1440x1000", async () => {
    const widths = [1440, 1280, 960, 800];
    const failures = [];
    for (const w of widths) {
      await browser.setWindowSize(w, 900);
      await browser.pause(150);
      const geometry = await browser.execute(() => {
        const main = document.querySelector(".main");
        const table = document.querySelector(".ledger-table-scroll");
        return {
          pageOverflow: main.scrollWidth - main.clientWidth,
          tableOverflow: table.scrollWidth - table.clientWidth,
        };
      });
      if (geometry.pageOverflow > 1) failures.push(`page overflows by ${geometry.pageOverflow}px at ${w}x900`);
      if (geometry.tableOverflow > 1) failures.push(`table overflows by ${geometry.tableOverflow}px at ${w}x900`);
    }
    assert.deepEqual(failures, [], `expected no sideways scrolling at any named width, found:\n${failures.join("\n")}`);
  });

  // Screenshot sweep: 4 viewports x 2 densities, with a menu open, for
  // visual review alongside the assertions above.
  const viewports = [
    [1440, 1000],
    [1280, 900],
    [960, 900],
    [800, 900],
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
