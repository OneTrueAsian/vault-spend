// Checkboxes are 20% larger than the browser default (13px -> 15.6px) so they are easier to click:
//   - the selection checkboxes on Transactions, the Settings toggles and a dialog's labelled rows all measure 15.6px square;
//   - the box still lines up with its label text, and clicking the label still ticks it;
//   - nothing scrolls sideways at the normal window size or at the smallest supported one (720px wide).
// Set VS_SCREENS_DIR to keep screenshots.
//
// Run with: node e2e/feature369_checkbox_size.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, openSettingsGroup, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const SIZE = 15.6;
const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()

def month_start(back):
    y, m = today.year, today.month - back
    while m <= 0:
        m += 12
        y -= 1
    return datetime.date(y, m, 1)

cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '5000.00')")
acct = cur.lastrowid

def spend(back, day, desc, amount, category):
    d = (month_start(back) + datetime.timedelta(days=day)).isoformat()
    fp = f"{acct}|{d}|{desc.lower()}|-{amount}"
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)",
                (acct, d, desc, "-" + amount, category, "user", fp))

for back, groceries in ((3, "300.00"), (2, "450.00"), (1, "600.00")):
    spend(back, 8, f"Grocers {back}", groceries, "Groceries")
    spend(back, 10, f"Cafe {back}", "100.00", "Dining Out")
`);
const shotsDir = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature369-");
fs.mkdirSync(shotsDir, { recursive: true });

const app = await launchApp({ dbDir });
const { browser: b } = app;

async function nav(label) {
  for (const button of await b.$$("nav button")) {
    if ((await button.getText()).trim() === label) return button.click();
  }
  throw new Error(`no nav button "${label}"`);
}

/** Every checkbox on screen: its size, whether it sits in a label (and where that label's text is), and whether it is hidden. */
const checkboxes = (scope) =>
  b.execute((sel) => [...document.querySelectorAll(`${sel} input[type="checkbox"]`)].filter((el) => el.offsetParent !== null).map((el) => {
    const r = el.getBoundingClientRect();
    const label = el.closest("label");
    let text = null;
    if (label) {
      const range = document.createRange();
      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent.trim()) { range.selectNodeContents(node); const t = range.getBoundingClientRect(); text = { top: t.top, bottom: t.bottom }; break; }
      }
    }
    return { tall: !!el.closest(".ledger-filters"), width: r.width, height: r.height, centerY: (r.top + r.bottom) / 2, left: r.left, right: r.right, text, name: el.getAttribute("aria-label") ?? label?.textContent.trim().slice(0, 40) ?? "" };
  }), scope);

const noSideScroll = (where) =>
  b.execute(() => {
    const main = document.querySelector(".main");
    return { doc: document.documentElement.scrollWidth - innerWidth, main: main ? main.scrollWidth - main.clientWidth : 0 };
  }).then(({ doc, main }) => assert.ok(doc <= 1 && main <= 1, `${where}: nothing should scroll sideways (page ${doc}px, content ${main}px)`));

async function check(where, scope, { atLeast = 1 } = {}) {
  let boxes = [];
  await waitUntilOrDiagnose(b, async () => (boxes = await checkboxes(scope)).length >= atLeast, { timeoutMsg: `${where}: expected checkboxes in ${scope}`, extra: () => String(boxes.length) });
  for (const box of boxes) {
    // The filter bar already gives every input a 36px minimum height: its boxes keep that taller hit area.
    const heightOk = box.tall ? box.height >= SIZE - 0.2 : Math.abs(box.height - SIZE) < 0.2;
    assert.ok(Math.abs(box.width - SIZE) < 0.2 && heightOk, `${where}: "${box.name}" should be ${SIZE}px wide and ${box.tall ? "at least" : ""} ${SIZE}px high, is ${box.width}x${box.height}`);
    if (box.text) {
      const textCenter = (box.text.top + box.text.bottom) / 2;
      assert.ok(Math.abs(box.centerY - textCenter) <= 3, `${where}: "${box.name}" should line up with its text (${box.centerY} vs ${textCenter})`);
    }
  }
  await noSideScroll(where);
  // The box must fit its cell: a table cell that holds a checkbox must not spill past its own edge.
  const spilling = await b.execute((sel) => [...document.querySelectorAll(`${sel} :is(th, td)`)].filter((cell) => cell.querySelector('input[type="checkbox"]') && cell.scrollWidth > cell.clientWidth + 1).length, scope);
  assert.equal(spilling, 0, `${where}: a checkbox column is too narrow for its box`);
  return boxes;
}
const shot = (name) => b.saveScreenshot(path.join(shotsDir, `${name}.png`));

async function everyScreen(sizeName) {
  // Transactions: the Select all box and each row's box
  await nav("Transactions");
  await b.$("[aria-label='Select all matching transactions']").waitForExist({ timeout: 10000 });
  const ledger = await check(`${sizeName} Transactions`, ".ledger", { atLeast: 7 });
  assert.equal(ledger.length >= 7, true);
  const first = await b.$(".ledger tbody tr .select-col input[type='checkbox']");
  await first.click();
  await waitUntilOrDiagnose(b, async () => await first.isSelected(), { timeoutMsg: "a row's box should tick" });
  await shot(`${sizeName}-transactions`);
  await first.click();

  // The account filter's group boxes
  const filter = await b.$("//button[contains(@class,'account-filter-toggle') and contains(., 'ccount')]");
  await filter.click();
  await check(`${sizeName} Accounts filter`, ".account-filter-panel", { atLeast: 1 });
  await shot(`${sizeName}-account-filter`);
  await b.keys("Escape");

  // Settings toggles
  await openSettingsGroup(b, "features");
  await check(`${sizeName} Settings`, ".settings-content", { atLeast: 3 });
  await shot(`${sizeName}-settings`);

  // A dialog: the budget suggestions, whose label rows tick when the label is clicked
  await nav("Budget");
  const suggest = await b.$("//button[contains(normalize-space(.), 'Suggest from 3-month average')]");
  await suggest.waitForClickable({ timeout: 10000 });
  await suggest.click();
  const row = await b.$("label[data-suggest-row='Groceries']");
  await row.waitForExist({ timeout: 10000 });
  await b.waitUntil(async () => (await row.getText()).trim() !== "", { timeout: 5000 });
  await check(`${sizeName} dialog`, "div[role='dialog']", { atLeast: 2 });
  const box = await row.$("input");
  const before = await box.isSelected();
  const text = await row.$("span");
  await text.click();
  await waitUntilOrDiagnose(b, async () => (await box.isSelected()) !== before, { timeoutMsg: "clicking the label's text should toggle its checkbox" });
  await shot(`${sizeName}-dialog`);
  await (await b.$("//div[@role='dialog']//button[contains(., 'Not now') or contains(., 'Close')]")).click();
  await b.waitUntil(async () => !(await b.$("div[role='dialog']").isExisting()), { timeout: 5000 });
}

try {
  await b.setWindowSize(1280, 800);
  await everyScreen("normal");
  await b.setWindowSize(720, 520);
  await everyScreen("small");
  console.log(`PASS feature369 (screenshots in ${shotsDir})`);
} finally {
  await app.close();
}
