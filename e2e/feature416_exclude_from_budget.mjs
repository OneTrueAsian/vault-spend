// Exclude from budget (1.3.4): Settings > Feature toggles switch, the row menu item, the "Not in budget" tag, the selection bar
// buttons, and what the mark changes. Fixture, this month: Medical planned 500.00 with one 300.00 purchase ("X Hospital") and
// one 40.00 purchase ("X Pharmacy"); a 50.00 transfer ("X Move") and a paycheck. Marking the hospital bill takes Medical spent
// from 340.00 to 40.00 and left from 160.00 to 460.00; Reports still counts all 340.00 of spending (the transfer is not spending).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, openSettingsGroup, waitUntilOrDiagnose, dismissStatusMessages, withFocusRetry } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth, monthFromNow } from "./lib/dates.mjs";
import { waitForBudgetRow } from "./lib/budgetRows.mjs";
import { makeTempDir } from "./lib/tempDir.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('X Checking', 'checking', '5000.00')")
a = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)", ("${monthFromNow(0)}",))
cur.execute("INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES ('Medical', ?, '500.00', 'flexible')", ("${monthFromNow(0)}",))
for description, amount, category in [
    ("X Hospital", "-300.00", "Medical"), ("X Pharmacy", "-40.00", "Medical"),
    ("X Move", "-50.00", "Transfer"), ("X Pay", "2000.00", "Salary"),
]:
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,'user',?)", (a, "${dateInMonth(0, 1)}", description, amount, category, "x-" + description))
`);

const shots = process.env.VS_SCREENS_DIR ?? makeTempDir("vaultspend-feature416-");
fs.mkdirSync(shots, { recursive: true });
const app = await launchApp({ dbDir });
const b = app.browser;
const shot = name => b.saveScreenshot(path.join(shots, `feature416_${name}.png`));
const nav = async label => { await (await b.$(`.nav-item[aria-label="${label}"]`)).click(); };
const toggle = () => b.$("[data-feature-toggle='budget_exclusion_enabled'] input");

const setSwitch = async on => {
  await nav("Settings");
  await openSettingsGroup(b, "features");
  const box = await toggle(); await box.waitForExist({ timeout: 10000 });
  if ((await box.isSelected()) !== on) await box.click();
  await waitUntilOrDiagnose(b, async () => (await (await toggle()).isSelected()) === on, { timeout: 5000, timeoutMsg: `the switch reads ${on ? "on" : "off"}` });
};
const txRow = description => b.$(`//tr[@data-payment-row][contains(.,"${description}")]`);
const openTransactions = async description => {
  await nav("Transactions");
  const row = await txRow(description); await row.waitForExist({ timeout: 10000 });
  return row;
};
const rowItems = () => b.execute(() => [...document.querySelectorAll(".row-menu-panel [role^='menuitem']")].map(x => x.textContent.trim()));
const openRowMenu = async description => {
  await withFocusRetry(b, async () => {
    if ((await rowItems()).length === 0) await (await (await txRow(description)).$("[data-row-menu]")).click();
    await b.waitUntil(async () => (await rowItems()).length > 0, { timeout: 3000, timeoutMsg: `${description}'s menu never opened` });
  });
};
const chooseItem = async label => {
  await withFocusRetry(b, async () => {
    await b.execute(l => [...document.querySelectorAll(".row-menu-panel [role^='menuitem']")].find(x => x.textContent.trim() === l)?.click(), label);
  });
  await waitUntilOrDiagnose(b, async () => (await rowItems()).length === 0, { timeout: 5000, timeoutMsg: "the row menu closes" });
};
const hasTag = description => b.execute(d => {
  const row = [...document.querySelectorAll("tr[data-payment-row]")].find(r => r.textContent.includes(d));
  return row ? [...row.querySelectorAll(".tag-pill")].some(p => p.textContent.trim() === "Not in budget") : null;
}, description);
const waitTag = (description, expected) => waitUntilOrDiagnose(b, async () => (await hasTag(description)) === expected, { timeout: 10000, timeoutMsg: `${description} ${expected ? "shows" : "has no"} Not in budget tag`, extra: () => hasTag(description) });
const medical = (spent, left) => waitForBudgetRow(b, "Medical", r => r.spent === spent && r.left === left, { timeoutMsg: `Medical must show ${spent} spent and ${left} left` });
const reportsSpending = async () => {
  await nav("Reports");
  await b.$("[data-summary-spending]").waitForExist({ timeout: 10000 });
  await b.$('[data-range-preset="current_month"]').click();
  await waitUntilOrDiagnose(b, async () => (await b.$("[data-summary-spending]").getText()).trim().startsWith("$"), { timeout: 10000, timeoutMsg: "Reports spending shows" });
  return (await b.$("[data-summary-spending]").getText()).trim();
};
const bodyText = () => b.execute(() => document.body.innerText);

try {
  await b.setWindowSize(1280, 1000);

  // ---- Off by default: no menu item, no bulk buttons.
  await openTransactions("X Hospital");
  await openRowMenu("X Hospital");
  assert.ok(!(await rowItems()).includes("Exclude from budget"), "off by default: no row menu item");
  await b.keys("Escape");

  // ---- Turn the switch on.
  await setSwitch(true);
  await shot("1_settings_switch_on");

  // ---- Row menu: item sits before Delete; none on the transfer.
  await openTransactions("X Hospital");
  await openRowMenu("X Hospital");
  const items = await rowItems();
  assert.ok(items.includes("Exclude from budget"), "menu offers Exclude from budget: " + items);
  assert.ok(items.indexOf("Exclude from budget") < items.indexOf("Delete"), "item is placed before Delete: " + items);
  await shot("2_row_menu_item");
  await b.keys("Escape");
  await openRowMenu("X Move");
  assert.ok(!(await rowItems()).some(i => /budget/i.test(i)), "transfers are not offered the item");
  await b.keys("Escape");

  // ---- Reports before marking.
  const spendingBefore = await reportsSpending();
  assert.equal(spendingBefore, "$340.00", "Reports counts both Medical purchases (the transfer is not spending)");
  await nav("Budget");
  await medical("$340.00", "$160.00");

  // ---- Mark the hospital bill.
  await openTransactions("X Hospital");
  await openRowMenu("X Hospital");
  await chooseItem("Exclude from budget");
  await waitTag("X Hospital", true);
  assert.equal(await hasTag("X Pharmacy"), false, "only the marked row is tagged");
  await openRowMenu("X Hospital");
  assert.ok((await rowItems()).includes("Include in budget"), "a marked row offers Include in budget");
  await b.keys("Escape");
  await shot("3_not_in_budget_tag");

  // ---- Budget leaves it out; Reports still counts it.
  await nav("Budget");
  await medical("$40.00", "$460.00");
  await shot("4_budget_medical");
  assert.equal(await reportsSpending(), spendingBefore, "Reports still counts the marked purchase");
  await shot("5_reports_medical");

  // ---- Selection bar: the purchase (marked) and the transfer, Include in budget -> transfers skipped.
  await openTransactions("X Hospital");
  await dismissStatusMessages(b);
  for (const d of ["X Hospital", "X Move"]) await (await (await txRow(d)).$("input[type='checkbox']")).click();
  const bulk = label => b.execute(l => [...document.querySelectorAll("button.modal-secondary")].find(x => x.textContent.trim() === l)?.textContent ?? null, label);
  await waitUntilOrDiagnose(b, async () => (await bulk("Include in budget")) !== null && (await bulk("Exclude from budget")) !== null, { timeout: 5000, timeoutMsg: "the selection bar offers both buttons" });
  await b.execute(() => [...document.querySelectorAll("button.modal-secondary")].find(x => x.textContent.trim() === "Include in budget").click());
  await waitUntilOrDiagnose(b, async () => (await bodyText()).includes("Transfers are already left out of your budget, so they were skipped."), { timeout: 10000, timeoutMsg: "the status mentions skipped transfers", extra: bodyText });
  await waitTag("X Hospital", false);
  await shot("6_skipped_transfers_status");
  await nav("Budget");
  await medical("$340.00", "$160.00");

  // ---- Mark it again, then switch off: tag gone and the full amount counts. On again: excluded again.
  await openTransactions("X Hospital");
  await openRowMenu("X Hospital");
  await chooseItem("Exclude from budget");
  await waitTag("X Hospital", true);
  await setSwitch(false);
  await openTransactions("X Hospital");
  await waitTag("X Hospital", false);
  await nav("Budget");
  await medical("$340.00", "$160.00");
  await setSwitch(true);
  await openTransactions("X Hospital");
  await waitTag("X Hospital", true);
  await nav("Budget");
  await medical("$40.00", "$460.00");

  console.log("FEATURE 416 PASSED: Exclude from budget marks, tags, bulk-skips transfers, leaves Budget only, and follows the switch.");
} finally { await app.close(); }
