// E2E test: the month-end review dialog's layout, and that the review and the
// Ctrl+K palette open in the visible middle of the window.
//
//   - Close sits at the top right of the dialog header; the footer holds only
//     Back and Next, with Back directly to the left of Next;
//   - Back is disabled on the first step; the last step's button finishes the
//     review; navigation behaves as before;
//   - the header and footer stay on screen in a small window while the review
//     content scrolls between them;
//   - both overlays open centred in the window (not against the scrolled page)
//     at several window sizes and scroll positions, under the Transparent style
//     whose glass effect used to push them to the bottom.
//
// Run with: node e2e/feature87_month_review_layout.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime, calendar
today = datetime.date.today()

def month_start(back):
    total = today.year * 12 + today.month - 1 - back
    y, m = divmod(total, 12)
    return datetime.date(y, m + 1, 1)

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid

def tx(back, day, desc, amount, category):
    d = (month_start(back) + datetime.timedelta(days=day)).isoformat()
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, amount, category, "user" if category else None, f"{acct}|{d}|{desc.lower()}|{amount}"))

tx(2, 4, "Paycheck", "2800.00", "Income")
tx(2, 5, "Landlord", "-1200.00", "Rent")
tx(1, 4, "Paycheck", "3000.00", "Income")
tx(1, 5, "Landlord", "-1200.00", "Rent")
# Enough over-budget categories that the review's second step needs room.
for i, (category, amount, budget) in enumerate((("Groceries", "450.00", "400.00"), ("Dining Out", "260.00", "100.00"), ("Shopping", "300.00", "100.00"),
                                              ("Gas", "180.00", "100.00"), ("Utilities", "220.00", "100.00"), ("Travel", "500.00", "100.00"),
                                              ("Gifts", "150.00", "50.00"), ("Health", "200.00", "50.00"))):
    tx(1, 8 + i, f"{category} spend", "-" + amount, category)

period = month_start(1).strftime("%Y-%m")
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", (period,))
for category, amount, group in (("Income", "3000.00", "income"), ("Rent", "1200.00", "fixed"), ("Groceries", "400.00", "flexible"), ("Dining Out", "100.00", "flexible"),
                                ("Shopping", "100.00", "flexible"), ("Gas", "100.00", "flexible"), ("Utilities", "100.00", "flexible"), ("Travel", "100.00", "flexible"),
                                ("Gifts", "50.00", "flexible"), ("Health", "50.00", "flexible")):
    cur.execute("INSERT OR REPLACE INTO budgets (category, period, monthly_amount, budget_group) VALUES (?, ?, ?, ?)", (category, period, amount, group))
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
const rectOf = (selector) =>
  browser.execute((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), height: Math.round(r.height) };
  }, selector);
const buttonRect = (scope, text) =>
  browser.execute(
    (sel, label) => {
      const btn = [...document.querySelectorAll(`${sel} button`)].find((b) => b.textContent.trim() === label);
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), disabled: btn.disabled };
    },
    scope,
    text,
  );
const buttonLabels = (scope) => browser.execute((sel) => [...document.querySelectorAll(`${sel} button`)].map((b) => b.textContent.trim()), scope);
const viewportHeight = () => browser.execute(() => window.innerHeight);

function assertCentred(where, panel, overlay, vh) {
  if (!panel) throw new Error(`${where}: no dialog panel`);
  if (Math.abs(overlay.height - vh) > 2) throw new Error(`${where}: the backdrop is ${overlay.height}px tall in a ${vh}px window`);
  if (panel.top < 0 || panel.bottom > vh) throw new Error(`${where}: the dialog sits at ${panel.top}–${panel.bottom}px in a ${vh}px window`);
  const middle = (panel.top + panel.bottom) / 2;
  if (Math.abs(middle - vh / 2) > 30) throw new Error(`${where}: the dialog's middle is at ${Math.round(middle)}px, the window's is ${vh / 2}px`);
}

try {
  await browser.setWindowSize(1280, 800);
  await browser.pause(800);

  // The Transparent style is the one that used to misplace dialogs.
  await goTo("Settings");
  await browser.execute(() => {
    const row = [...document.querySelectorAll(".feature-toggle-row")].find((r) => r.textContent.includes("Transparent"));
    row.querySelector("input").click();
  });
  await browser.pause(400);

  // ---- layout of the review dialog ---------------------------------------------
  await goTo("Budget");
  await (await browser.$("button[aria-label='Previous month']")).click();
  await browser.pause(700);
  await (await browser.$("//button[normalize-space()='Month-end review']")).click();
  await (await browser.$("[data-review-step='summary']")).waitForExist({ timeout: 10000 });
  await browser.pause(500);

  const panel = await rectOf(".modal-panel");
  const close = await buttonRect(".modal-header", "Close");
  if (!close) throw new Error("Close should be in the dialog header");
  if (close.right < panel.right - 40 || close.top > panel.top + 60) {
    throw new Error(`Close should sit at the header's top right: button ${close.left}–${close.right} × ${close.top}, dialog right edge ${panel.right}, top ${panel.top}`);
  }
  const footerLabels = await buttonLabels(".modal-footer");
  if (footerLabels.join("|") !== "Back|Next") throw new Error(`the footer should hold only Back and Next, got: ${footerLabels.join(", ")}`);
  const back = await buttonRect(".modal-footer", "Back");
  const next = await buttonRect(".modal-footer", "Next");
  if (next.left - back.right < 0 || next.left - back.right > 16) throw new Error(`Back should sit directly left of Next, gap is ${next.left - back.right}px`);
  if (next.right < panel.right - 40) throw new Error(`Next should be at the footer's right edge (button right ${next.right}, dialog right ${panel.right})`);
  if (!back.disabled) throw new Error("Back should be disabled on the first step");
  console.log(`layout OK: Close ${close.left}–${close.right}, Back ${back.left}–${back.right}, Next ${next.left}–${next.right}, dialog right ${panel.right}`);

  // ---- navigation still works, through to the completion action ---------------------
  for (const step of ["over_budget", "uncategorized", "goals"]) {
    await (await browser.$("[data-review-next]")).click();
    await (await browser.$(`[data-review-step='${step}']`)).waitForExist({ timeout: 5000, timeoutMsg: `Next should reach the ${step} step` });
  }
  const last = await buttonLabels(".modal-footer");
  if (last.join("|") !== "Back|Finish review") throw new Error(`the last step's footer should be Back and Finish review, got: ${last.join(", ")}`);
  await (await browser.$("//div[contains(@class,'modal-footer')]//button[normalize-space()='Back']")).click();
  await (await browser.$("[data-review-step='uncategorized']")).waitForExist({ timeout: 5000, timeoutMsg: "Back should return to the previous step" });
  await (await browser.$("[data-review-next]")).click();
  await (await browser.$("[data-review-finish]")).click();
  await browser.$(".modal-panel").waitForExist({ timeout: 5000, reverse: true });
  await browser.waitUntil(async () => /review finished/i.test(await (await browser.$(".toast-stack .status")).getText()), { timeout: 5000, timeoutMsg: "Finish review should confirm" });

  // Close (header) dismisses it without finishing.
  await (await browser.$("//button[normalize-space()='Month-end review']")).click();
  await (await browser.$("[data-review-step='summary']")).waitForExist({ timeout: 10000 });
  await (await browser.$("//div[contains(@class,'modal-header')]//button[normalize-space()='Close']")).click();
  await browser.$(".modal-panel").waitForExist({ timeout: 5000, reverse: true });

  // ---- centred at several sizes and scroll positions, header and footer always reachable ----
  for (const [w, h] of [[1280, 800], [900, 560], [700, 420]]) {
    await browser.setWindowSize(w, h);
    await browser.pause(700);
    const vh = await viewportHeight();
    for (const scroll of [0, 100000]) {
      await browser.execute((y) => {
        const m = document.querySelector(".main");
        if (m) m.scrollTop = y;
      }, scroll);
      await browser.pause(300);

      // The month-end review
      await (await browser.$("//button[normalize-space()='Month-end review']")).click();
      await (await browser.$("[data-review-step='summary']")).waitForExist({ timeout: 10000 });
      await browser.pause(450);
      let boxes = await browser.execute(() => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) }; };
        return { panel: r(document.querySelector(".modal-panel")), overlay: r(document.querySelector(".modal-overlay")), footer: r(document.querySelector(".modal-footer")), header: r(document.querySelector(".modal-header")) };
      });
      const where = `review at ${w}x${h}, page scrolled ${scroll === 0 ? "to the top" : "to the bottom"}`;
      const tall = boxes.panel.height >= vh - 44;
      if (tall) {
        if (boxes.panel.top < 0 || boxes.panel.bottom > vh) throw new Error(`${where}: a tall dialog must still fit the window (${boxes.panel.top}–${boxes.panel.bottom} of ${vh})`);
      } else {
        assertCentred(where, boxes.panel, boxes.overlay, vh);
      }
      if (boxes.header.top < 0 || boxes.footer.bottom > vh) throw new Error(`${where}: header/footer must stay on screen (header top ${boxes.header.top}, footer bottom ${boxes.footer.bottom} of ${vh})`);
      // Content that overflows scrolls BETWEEN the header and footer.
      await (await browser.$("[data-review-next]")).click();
      await (await browser.$("[data-review-step='over_budget']")).waitForExist({ timeout: 5000 });
      await browser.execute(() => { const b = document.querySelector(".modal-body"); if (b) b.scrollTop = b.scrollHeight; });
      await browser.pause(200);
      boxes = await browser.execute(() => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
        return { footer: r(document.querySelector(".modal-footer")), header: r(document.querySelector(".modal-header")) };
      });
      if (boxes.header.top < 0 || boxes.footer.bottom > vh) throw new Error(`${where}, content scrolled: header/footer left the window`);
      if (!(await buttonRect(".modal-footer", "Next")) || !(await buttonRect(".modal-header", "Close"))) throw new Error(`${where}: Next and Close must stay reachable`);
      await browser.keys("Escape");
      await browser.$(".modal-panel").waitForExist({ timeout: 5000, reverse: true });

      // The command palette
      await browser.execute(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await browser.keys(["Control", "k"]);
      await (await browser.$(".modal-panel")).waitForExist({ timeout: 5000 });
      await browser.pause(450);
      boxes = await browser.execute(() => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) }; };
        return { panel: r(document.querySelector(".modal-panel")), overlay: r(document.querySelector(".modal-overlay")) };
      });
      const palWhere = `palette at ${w}x${h}, page scrolled ${scroll === 0 ? "to the top" : "to the bottom"}`;
      if (boxes.panel.height >= vh - 44) {
        if (boxes.panel.top < 0 || boxes.panel.bottom > vh) throw new Error(`${palWhere}: a tall dialog must still fit the window`);
      } else {
        assertCentred(palWhere, boxes.panel, boxes.overlay, vh);
      }
      await browser.keys("Escape");
      await browser.$(".modal-panel").waitForExist({ timeout: 5000, reverse: true });
    }
    console.log(`${w}x${h}: review and palette centred, header/footer reachable — OK`);
  }

  console.log("FEATURE 87 E2E TEST PASSED");
} finally {
  await app.close?.();
}
