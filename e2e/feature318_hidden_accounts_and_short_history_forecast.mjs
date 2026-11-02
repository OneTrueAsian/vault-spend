// QA remediation (2026-10-27, owner-approved): hiding accounts and the short-history forecast, in the real app.
//
//   QA-GAP-001: Hide in an account's menu moves it to a collapsed "Hidden accounts" section, its balance still counts
//   in the totals (and the page says so), Add transaction no longer offers it, Unhide brings it back, and the
//   choice is saved.
//   QA-FUNC-003: with under 14 days of transactions the Cash Flow forecast leaves everyday spending out and says so, and the
//   Dashboard runway card says there is not enough history yet. The Dashboard totals also say they include a hidden account.
//   One purchase of 45.00 today, cash 967.00 in total (checking 1,000.00 less the purchase, and a savings account with
//   12.00), and a 35.00 bill due in 20 days: the lowest balance is 932.00 (967.00 less the bill), not a huge overdraft.
//
// Run with: node e2e/run-all.mjs --spec=318

import assert from "node:assert/strict";
import { chooseRowAction, launchApp, menuOptionLabels, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
checking = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Old Savings', 'savings', '12.00')")
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, 'QQ ONLY PURCHASE', '-45.00', 'Groceries', ?)",
            (checking, today.isoformat(), f'{checking}|{today.isoformat()}|qq only purchase|-45.00'))
for name in ['QQ Visible Debt', 'QQ Hidden Debt', 'QQ Other Hidden Debt']:
    cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES (?, 'loan', '0.00')", (name,))
savings = cur.execute("SELECT id FROM accounts WHERE name='Old Savings'").fetchone()[0]
cur.execute("INSERT INTO transactions (account_id,date,description,amount,category,fingerprint) VALUES (?,?,'QQ HIDDEN ORIGIN','0.00','Groceries',?)",(savings,today.isoformat(),f'{savings}|{today.isoformat()}|qq hidden origin|0.00'))
due = (today + datetime.timedelta(days=20)).isoformat()
cur.execute("INSERT INTO recurring (merchant, category, amount, cadence, anchor_date, account_id) VALUES ('QQ Phone Bill', 'Bills', '-35.00', 'monthly', ?, ?)", (due, checking))
`);

const app = await launchApp({ dbDir });
const { browser } = app;

async function invoke(command, args = {}) {
  const result = await browser.executeAsync(
    (command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then((ok) => done({ ok }), (e) => done({ error: String(e) })),
    command,
    args,
  );
  if (result.error) throw new Error(`${command} failed: ${result.error}`);
  return result.ok;
}
async function nav(label) {
  for (const b of await browser.$$("nav button")) if ((await b.getText()).trim() === label) return b.click();
  throw new Error(`no nav button ${label}`);
}

// RowFieldDropdown portals its menu to document.body; MenuSelect's parent-local helper does not apply.
async function rowOptionLabels(trigger) {
  await trigger.click();
  try {
    await browser.waitUntil(async () => (await trigger.getAttribute("aria-expanded")) === "true", {timeout:5000,timeoutMsg:"the row menu opens"});
    const id = await trigger.getAttribute("aria-controls");
    const menu = await browser.$('//*[@id="' + id + '"]');
    await menu.waitForDisplayed({timeout:5000});
    return await browser.execute(el => [...el.querySelectorAll('[role="menuitemradio"]')].map(item => item.innerText.replace(/\s*✓\s*$/, "").trim()), menu);
  } finally {
    await browser.keys("Escape");
    await browser.waitUntil(async () => (await trigger.getAttribute("aria-expanded")) !== "true", {timeout:5000,timeoutMsg:"the row menu closes"});
  }
}

const pageText = () => browser.execute(() => document.body.innerText);
const tileValues = () => browser.execute(() => [...document.querySelectorAll(".stats .stat")].map((t) => t.innerText.replace(/\s+/g, " ").trim()));

try {
  await browser.setWindowSize(1280, 900);

  // Hide
  await nav("Accounts");
  const savings = (await invoke("list_accounts")).find((a) => a.name === "Old Savings");
  const rowMenu = `.account-card[data-account-id="${savings.id}"] [data-row-menu]`;
  await browser.$(rowMenu).waitForExist({ timeout: 15000 });
  const before = await tileValues();
  assert.match(before.join(" | "), /\$967\.00/, "both accounts are in the totals before hiding");

  await chooseRowAction(browser, rowMenu, "Hide");
  await waitUntilOrDiagnose(browser, async () => !(await browser.$(rowMenu).isExisting()), { timeout: 8000, timeoutMsg: "the hidden account leaves the main list" });
  assert.equal((await invoke("list_accounts")).find((a) => a.id === savings.id).hidden, true, "the choice is saved");
  const toggle = await browser.$("button.hidden-accounts-toggle");
  assert.match(await toggle.getText(), /Hidden accounts \(1\)/);
  assert.equal(await toggle.getAttribute("aria-expanded"), "false", "the section starts collapsed");
  assert.deepEqual(await tileValues(), before, "hiding changes no total");
  assert.match(await pageText(), /Includes 1 hidden account/);

  // Dashboard: the totals say they include it, and the runway card explains why it has no figure yet
  await nav("Dashboard");
  await browser.$("[data-runway-waiting]").waitForDisplayed({ timeout: 15000 });
  assert.match(await pageText(), /Includes 1 hidden account\./);
  assert.match(await browser.$("[data-runway-waiting]").getText(), /Not enough history yet\. Cash runway shows once you have 2 weeks of transactions\./);

  // Add transaction no longer offers it
  await nav("Transactions");
  await (await browser.$("button=Add transaction")).click();
  const picker = await browser.$("//*[@role='dialog']//button[starts-with(@aria-label,'Account')]");
  await picker.waitForDisplayed({ timeout: 8000 });
  assert.deepEqual(await menuOptionLabels(picker), ["Checking", "QQ Hidden Debt", "QQ Other Hidden Debt", "QQ Visible Debt"], "the hidden savings account is omitted; the three debt fixtures are still visible at this point");
  await browser.keys("Escape");
  await waitUntilOrDiagnose(browser, async () => !(await browser.$("[role='dialog']").isExisting()), { timeout: 5000, timeoutMsg: "the dialog closes" });

  // Forecast: not enough history
  await nav("Cash Flow");
  await (await browser.$("//button[normalize-space()='Forecast']")).click();
  await browser.$("[data-forecast-lowest]").waitForDisplayed({ timeout: 15000 });
  const forecastText = await pageText();
  assert.match(forecastText, /Not enough history yet\. Everyday spending is left out until you have 2 weeks of transactions/);
  assert.match(await browser.$("[data-forecast-lowest]").getText(), /\$932\.00/, "967.00 less the 35.00 bill, with the hidden account's 12.00 still counted");

  // Unhide
  await nav("Accounts");
  await (await browser.$("button.hidden-accounts-toggle")).click();
  await browser.$(rowMenu).waitForExist({ timeout: 8000 });
  await chooseRowAction(browser, rowMenu, "Unhide");
  await waitUntilOrDiagnose(browser, async () => !(await browser.$("button.hidden-accounts-toggle").isExisting()), { timeout: 8000, timeoutMsg: "the section goes away once nothing is hidden" });
  assert.equal((await invoke("list_accounts")).find((a) => a.id === savings.id).hidden, false);
  assert.ok(await browser.$(rowMenu).isExisting(), "the account is back in the main list");
  assert.deepEqual(await tileValues(), before, "totals are the same throughout");


  // Owner extension: destination changes exclude hidden alternatives, but retain the current selection.
  for (const name of ["QQ Hidden Debt", "QQ Other Hidden Debt", "Old Savings"]) {
    const account = (await invoke("list_accounts")).find(a => a.name === name);
    await chooseRowAction(browser, '.account-card[data-account-id="' + account.id + '"] [data-row-menu]', "Hide");
    await waitUntilOrDiagnose(browser, async () => (await invoke("list_accounts")).find(a => a.id === account.id).hidden, {timeout:8000,timeoutMsg:"the destination fixture is hidden through its account action"});
  }
  await nav("Transactions");
  const origin = await browser.$('//tr[@data-payment-row][contains(.,"QQ HIDDEN ORIGIN")]');
  await origin.waitForExist({timeout:10000});
  const accountPicker = await origin.$('[aria-label^="Account for"]');
  const originChoices = await rowOptionLabels(accountPicker);
  assert.ok(originChoices.includes("Old Savings"), "the transaction's existing hidden account remains selectable");
  assert.ok(!originChoices.includes("QQ Hidden Debt") && !originChoices.includes("QQ Other Hidden Debt"), "unrelated hidden accounts are omitted");
  const purchase = await browser.$('//tr[@data-payment-row][contains(.,"QQ ONLY PURCHASE")]');
  const purchaseChoices = await rowOptionLabels(await purchase.$('[aria-label^="Account for"]'));
  assert.ok(!purchaseChoices.includes("Old Savings"), "a different transaction cannot move into a hidden account");
  await chooseRowAction(browser, async () => purchase.$('[data-row-menu]'), "Apply to a debt");
  const debtPicker = () => purchase.$('[aria-label^="Debt account to apply"]');
  await (await debtPicker()).waitForDisplayed({timeout:5000});
  assert.deepEqual(await rowOptionLabels(await debtPicker()), ["QQ Visible Debt"], "a new debt application only offers visible debts");
  assert.match(await (await debtPicker()).getText(), /QQ Visible Debt/, "the default is visible");
  await nav("Accounts");
  const currentDebt = (await invoke("list_accounts")).find(a => a.name === "QQ Visible Debt");
  await chooseRowAction(browser, '.account-card[data-account-id="' + currentDebt.id + '"] [data-row-menu]', "Hide");
  await waitUntilOrDiagnose(browser, async () => (await invoke("list_accounts")).find(a => a.id === currentDebt.id).hidden, {timeout:8000,timeoutMsg:"the selected debt becomes hidden"});
  await nav("Transactions");
  assert.deepEqual(await rowOptionLabels(await debtPicker()), ["QQ Visible Debt"], "an already selected hidden debt remains available, while other hidden debts stay absent");
  await (await purchase.$('button=Cancel')).click();

  console.log("FEATURE 318 E2E TEST PASSED");
} finally {
  await app.close();
}
