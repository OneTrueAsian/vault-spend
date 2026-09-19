// E2E regression test for a UAT finding: with rows selected on the
// Transactions tab in a half-width window, the bulk-actions bar ("Delete
// selected", "Link as transfer", "Clear selection", ...) ran off the right
// edge of the window instead of wrapping onto a second line, forcing a
// horizontal scroll to reach them.
//
// Run with: node e2e/feature68_bulk_bar_wraps_at_half_window.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '5000.00')")
checking = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('High-Yield Savings', 'savings', '1000.00')")
savings = cur.lastrowid
def add(acct, desc, amount, n):
    cur.execute(
        "INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?, ?, ?, ?, 'Groceries', 'user', ?)",
        (acct, today.isoformat(), desc, amount, f"fp-{n}"),
    )
# A plausible transfer pair, so "Link as transfer" appears once both are ticked.
add(checking, "Move to savings", "-500.00", 1)
add(savings, "Deposit from checking", "500.00", 2)
add(checking, "Green Leaf Grocers", "-80.00", 3)
`);

const app = await launchApp({ dbDir });
const { browser } = app;
async function nav(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) return b.click();
  }
  throw new Error(`no nav button "${label}"`);
}
try {
  await browser.setWindowSize(1440, 1000);
  await nav("Transactions");
  await (await browser.$("table.ledger")).waitForExist({ timeout: 10000 });
  for (const desc of ["Move to savings", "Deposit from checking"]) {
    const box = await browser.$(`//tr[td[contains(.,'${desc}')]]//input[@type='checkbox']`);
    await box.waitForExist({ timeout: 10000 });
    await box.click();
  }
  const bar = await browser.$(".bulk-actions-bar");
  await bar.waitForExist({ timeout: 10000 });
  await (await browser.$("button=Link as transfer")).waitForExist({ timeout: 10000 });

  // Full width, a typical half-screen width, and the app's own default width.
  for (const width of [1280, 960, 800]) {
    await browser.setWindowSize(width, 1000);
    await browser.pause(400);
    const report = await browser.execute(() => {
      const viewport = document.documentElement.clientWidth;
      const bar = document.querySelector(".bulk-actions-bar");
      const offenders = [...bar.querySelectorAll("button, select, input")]
        .map((el) => ({ text: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30), right: Math.round(el.getBoundingClientRect().right) }))
        .filter((c) => c.right > viewport);
      const main = document.querySelector(".main");
      return { viewport, offenders, barOverflow: bar.scrollWidth > bar.clientWidth + 1, pageOverflow: main.scrollWidth > main.clientWidth + 1 };
    });
    console.log(`width ${width}:`, JSON.stringify(report));
    if (report.offenders.length > 0) {
      throw new Error(`at ${width}px the bulk bar's controls run off the right edge: ${JSON.stringify(report.offenders)}`);
    }
    if (report.barOverflow) throw new Error(`at ${width}px the bulk bar itself scrolls sideways instead of wrapping`);
    if (report.pageOverflow) throw new Error(`at ${width}px selecting rows made the whole page scroll sideways`);
    for (const label of ["Delete selected", "Link as transfer", "Clear selection"]) {
      const inView = await browser.execute((text) => {
        const button = [...document.querySelectorAll(".bulk-actions-bar button")].find((b) => b.textContent.trim() === text);
        if (!button) return false;
        const r = button.getBoundingClientRect();
        return r.left >= 0 && r.right <= document.documentElement.clientWidth;
      }, label);
      if (!inView) throw new Error(`at ${width}px "${label}" is not fully inside the window (a horizontal scroll would be needed)`);
    }
  }

  console.log("FEATURE 68 E2E TEST PASSED");
} finally {
  await app.close();
}
