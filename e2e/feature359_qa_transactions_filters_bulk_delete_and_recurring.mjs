// UAT-053 single-row delete, UAT-057 date / account / category / member filters and their combinations, UAT-061 bulk category / member / delete, UAT-108 recurring delete (Cancel keeps, confirm removes),
// UAT-109 recurring due dates for a month-end monthly anchor and a leap-day yearly anchor. Real gestures on a disposable fixture; every expected total or date is worked out here from the fixture.
// Rows (last month = L, this month = T): QQ One -10 Groceries Checking day 3 L; QQ Two -20 Dining Out Checking day 10 L; QQ Three -30 Groceries Card day 17 L; QQ Four -40 Gas Checking day 1 T.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose, dismissStatusMessages } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { dateInMonth } from "./lib/dates.mjs";
import { setDateInput } from "./lib/statementUi.mjs";

const dim = (y, m) => new Date(y, m + 1, 0).getDate(); // m is 0-based
const thisYear = new Date().getFullYear();
const isLeap = y => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
let leapYear = thisYear - 1; while (!isLeap(leapYear)) leapYear--;
const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('QQ Checking', 'checking', '1000.00')")
a = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('QQ Card', 'credit', '0.00')")
c = cur.lastrowid
cur.execute("INSERT INTO family_members (name) VALUES ('Alex')")
cur.execute("INSERT INTO family_members (name) VALUES ('Blair')")
for acct,d,desc,amt,cat in ((a,"${dateInMonth(-1, 3)}","QQ One","-10.00","Groceries"),(a,"${dateInMonth(-1, 10)}","QQ Two","-20.00","Dining Out"),(c,"${dateInMonth(-1, 17)}","QQ Three","-30.00","Groceries"),(a,"${dateInMonth(0, 1)}","QQ Four","-40.00","Gas")):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, category_source, fingerprint) VALUES (?,?,?,?,?,?,?)", (acct,d,desc,amt,cat,"user",f"{acct}|{d}|{desc}|{amt}"))
cur.execute("INSERT INTO recurring(merchant,amount,cadence,anchor_date,account_id) VALUES('QQ Month End','-10.00','monthly','${thisYear - 1}-08-31',?)",(a,))
cur.execute("INSERT INTO recurring(merchant,amount,cadence,anchor_date,account_id) VALUES('QQ Leap Day','-50.00','annual','${leapYear}-02-29',?)",(a,))
cur.execute("INSERT INTO recurring(merchant,amount,cadence,anchor_date,account_id) VALUES('QQ Keep Me','-5.00','monthly','${thisYear - 1}-01-15',?)",(a,))
`);
const app = await launchApp({ dbDir });
const { browser: b } = app;
async function invoke(command, args = {}) {
  const r = await b.executeAsync((command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then(ok => done({ ok }), e => done({ error: String(e?.message ?? e) })), command, args);
  if (r.error) throw new Error(`${command} failed: ${r.error}`);
  return r.ok;
}
const nav = async label => { await (await b.$(`.nav-item[aria-label="${label}"]`)).click(); };
const ledger = () => b.$(".ledger-table-scroll").getText();
const rowOf = name => b.$(`//tr[@data-payment-row][contains(.,"${name}")]`);
const shown = async names => { const t = await ledger(); return names.filter(n => t.includes(n)); };
const waitShown = (expected, what) => waitUntilOrDiagnose(b, async () => JSON.stringify(await shown(["QQ One", "QQ Two", "QQ Three", "QQ Four"])) === JSON.stringify(expected), { timeout: 10000, timeoutMsg: what, extra: ledger });
try {
  await b.setWindowSize(1440, 1100);
  await nav("Transactions");
  await b.$(".ledger-table-scroll").waitForExist({ timeout: 15000 });
  await dismissStatusMessages(b);

  // --- UAT-057: filters, one at a time and together --------------------------------------------------------------------------------------------------------------
  const ALL = ["QQ One", "QQ Two", "QQ Three", "QQ Four"].sort();
  await waitUntilOrDiagnose(b, async () => (await shown(ALL)).length === 4, { timeout: 10000, timeoutMsg: "all four rows show", extra: ledger });
  // Date range: last month only, then this month only, then an empty range.
  const openMore = async () => { const t = await b.$("//button[contains(normalize-space(.), 'More filters') or contains(normalize-space(.), 'filter active') or contains(normalize-space(.), 'filters active')]"); await t.click(); };
  await openMore();
  await setDateInput(b, 'input[aria-label="From date"]', dateInMonth(-1, 1));
  await setDateInput(b, 'input[aria-label="To date"]', dateInMonth(-1, 28));
  await waitShown(["QQ One", "QQ Two", "QQ Three"], "last month's date range hides this month's row");
  await setDateInput(b, 'input[aria-label="From date"]', dateInMonth(-1, 10));
  await setDateInput(b, 'input[aria-label="To date"]', dateInMonth(-1, 10));
  await waitShown(["QQ Two"], "a one-day range (both ends inclusive) shows just that day");
  await setDateInput(b, 'input[aria-label="From date"]', dateInMonth(-1, 11));
  await setDateInput(b, 'input[aria-label="To date"]', dateInMonth(-1, 16));
  await waitShown([], "a range with no rows shows none");
  // Account + date together, then the category filter.
  await setDateInput(b, 'input[aria-label="From date"]', dateInMonth(-1, 1));
  await setDateInput(b, 'input[aria-label="To date"]', dateInMonth(-1, 28));
  await b.keys("Escape");
  await (await b.$("button*=All accounts")).click();
  await (await b.$("//label[contains(@class,'account-filter-option')][contains(.,'QQ Card')]/input[@type='checkbox']")).click();
  await waitShown(["QQ One", "QQ Two"], "date range AND account: the card's row is hidden");
  await (await b.$("//label[contains(@class,'account-filter-option')][contains(.,'QQ Card')]/input[@type='checkbox']")).click();
  await b.keys("Escape");
  await (await b.$(".ledger-filters .category-filter-toggle")).click();
  await (await (await b.$(".ledger-filters .category-filter-panel")).$(".//button[.//span[normalize-space()='Groceries']]")).click();
  await waitShown(["QQ One", "QQ Three"], "date range AND category: only Groceries rows of last month");
  await b.keys("Escape");

  // --- UAT-061: bulk category, member and delete -------------------------------------------------------------------------------------------------------------------
  const pick = async name => (await (await rowOf(name)).$('input[type="checkbox"]')).click();
  await pick("QQ One"); await pick("QQ Three");
  await (await b.$("button*=Set category to")).click();
  await (await b.$("//*[self::button or @role='menuitem' or @role='option'][normalize-space()='Dining Out']")).click();
  await waitUntilOrDiagnose(b, async () => { const tx = await invoke("list_transactions"); return ["QQ One", "QQ Three"].every(n => tx.find(t => t.description === n).category === "Dining Out"); }, { timeout: 10000, timeoutMsg: "bulk category set changes both selected rows" });
  assert.equal((await invoke("list_transactions")).find(t => t.description === "QQ Two").category, "Dining Out");
  assert.equal((await invoke("list_transactions")).find(t => t.description === "QQ Four").category, "Gas", "unselected rows keep theirs");
  // Bulk member: the two rows picked above are still selected only if the selection survived the change; select again from a clean page.
  await (await b.$("button=Clear selection")).click().catch(() => {});
  await (await b.$("//button[contains(normalize-space(.), 'filters active') or contains(normalize-space(.), 'filter active')]")).click();
  await (await b.$("button=Clear all")).click();
  await b.keys("Escape");
  await (await b.$(".ledger-filters .category-filter-toggle")).click();
  await (await b.$(".ledger-filters .category-filter-panel")).$(".//button[.//span[normalize-space()='All categories']]").then(x => x.click()).catch(() => {});
  await b.keys("Escape");
  await waitUntilOrDiagnose(b, async () => (await shown(ALL)).length === 4, { timeout: 10000, timeoutMsg: "clearing the filters brings every row back", extra: ledger });
  await pick("QQ Two"); await pick("QQ Four");
  await (await b.$("button*=Set member to")).click();
  await (await b.$("//*[self::button or @role='menuitem' or @role='option'][normalize-space()='Alex']")).click();
  await waitUntilOrDiagnose(b, async () => (await invoke("list_transactions")).filter(t => t.member_name === "Alex").length === 2, { timeout: 10000, timeoutMsg: "bulk member set gives both selected rows to Alex" });
  const members = Object.fromEntries((await invoke("list_transactions")).map(t => [t.description, t.member_name ?? null]));
  assert.deepEqual(members, { "QQ One": null, "QQ Two": "Alex", "QQ Three": null, "QQ Four": "Alex" }, "only the selected rows changed: " + JSON.stringify(members));
  // Member filter with a date range: Alex's rows in last month are just QQ Two.
  await (await b.$("//button[contains(@class,'account-filter-toggle')][contains(.,'members')]")).click();
  const alexBox = await b.$("//label[contains(@class,'account-filter-option')][normalize-space()='Alex']//input");
  await alexBox.click(); await alexBox.click(); // untick, then tick Alex alone (the first click unticks the only-ticked default)
  await waitShown(["QQ Two", "QQ Four"], "the member filter shows only Alex's rows");
  await b.keys("Escape");
  await (await b.$("//button[contains(normalize-space(.), 'More filters')]")).click();
  await setDateInput(b, 'input[aria-label="From date"]', dateInMonth(-1, 1));
  await setDateInput(b, 'input[aria-label="To date"]', dateInMonth(-1, 28));
  await waitShown(["QQ Two"], "member AND date range: Alex's last-month row only");
  await (await b.$("button=Clear all")).click();
  await b.keys("Escape");
  await (await b.$("//button[contains(@class,'account-filter-toggle')][contains(.,'member') or contains(.,'Alex')]")).click();
  await (await b.$("button=Select all")).click();
  await b.keys("Escape");
  await waitUntilOrDiagnose(b, async () => (await shown(ALL)).length === 4, { timeout: 10000, timeoutMsg: "every row is back", extra: ledger });

  // --- UAT-053: delete one row from its own menu --------------------------------------------------------------------------------------------------------------
  const openMenu = async name => { await (await (await rowOf(name)).$("[data-row-menu]")).click(); };
  const menuItem = async label => b.$(`//*[contains(@class,'row-menu-panel')]//*[@role='menuitem'][normalize-space()='${label}']`);
  await openMenu("QQ Three");
  await (await menuItem("Delete")).click();
  const promptText = (await (await rowOf("QQ Three")).getText()).split(String.fromCharCode(10)).join(" ");
  assert.ok(promptText.includes("Deleting this will decrease QQ Card's amount owed by $30.00."), "a card charge's delete prompt speaks of the amount owed: " + promptText);
  await (await (await rowOf("QQ Three")).$("button=Cancel")).click();
  assert.equal((await invoke("list_transactions")).some(t => t.description === "QQ Three"), true, "Cancel keeps the row");
  assert.ok(!(await (await rowOf("QQ Three")).getText()).includes("Deleting this will"), "and the prompt goes away");
  await openMenu("QQ Three"); await (await menuItem("Delete")).click();
  await (await (await rowOf("QQ Three")).$("button=Delete")).click();
  await waitUntilOrDiagnose(b, async () => !(await invoke("list_transactions")).some(t => t.description === "QQ Three"), { timeout: 10000, timeoutMsg: "Delete removes the row" });
  await b.pause(500);
  assert.equal(await b.$("button=Undo").isExisting(), false, "a single-row delete offers no Undo (only the bulk delete does)");
  assert.equal((await invoke("list_transactions")).length, 3, "only that row went");
  // The prompt on a checking account speaks of the balance.
  await openMenu("QQ Four"); await (await menuItem("Delete")).click();
  const checkingPrompt = (await (await rowOf("QQ Four")).getText()).split(String.fromCharCode(10)).join(" ");
  assert.ok(checkingPrompt.includes("Deleting this will increase QQ Checking's balance by $40.00."), checkingPrompt);
  await (await (await rowOf("QQ Four")).$("button=Cancel")).click();

  // --- UAT-061: bulk delete asks first, deletes both, and Undo brings both back ------------------------------------------------------------------------------------
  await pick("QQ One"); await pick("QQ Two");
  await (await b.$("button=Delete selected")).click();
  await (await b.$("button=Cancel")).click();
  assert.equal((await invoke("list_transactions")).length, 3, "Cancel on the bulk confirmation deletes nothing");
  await (await b.$("button=Delete selected")).click();
  await (await b.$("button=Delete 2")).click();
  await waitUntilOrDiagnose(b, () => b.execute(() => document.body.innerText.includes("Deleted 2 transactions.")), { timeout: 10000, timeoutMsg: "the bulk delete says how many went" });
  assert.deepEqual((await invoke("list_transactions")).map(t => t.description), ["QQ Four"]);
  await (await b.$("button=Undo")).click();
  await waitUntilOrDiagnose(b, () => b.execute(() => document.body.innerText.includes("Restored 2 transactions.")), { timeout: 10000, timeoutMsg: "Undo says how many came back" });
  assert.deepEqual((await invoke("list_transactions")).map(t => t.description).sort(), ["QQ Four", "QQ One", "QQ Two"]);

  // --- UAT-108 / UAT-109: recurring ----------------------------------------------------------------------------------------------------------------------------------------------
  await nav("Recurring");
  const rrow = name => b.$(`//table[contains(@class,"ledger")]//tr[contains(.,"${name}")]`);
  await (await rrow("QQ Keep Me")).waitForDisplayed({ timeout: 10000 });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const longDate = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  // Month-end monthly anchor (31st): the next due is the first month whose clamped day is not before today.
  let due;
  for (let k = 0; ; k++) { const y = today.getFullYear(), m = today.getMonth() + k; due = new Date(y, m, Math.min(31, dim(y, m))); if (due >= today) break; }
  const monthEnd = await (await rrow("QQ Month End")).getText();
  assert.ok(monthEnd.includes(longDate(due)), `monthly from the 31st: next due ${longDate(due)} (clamped to the month's last day): ${monthEnd}`);
  // Leap-day yearly anchor: February 29 in a leap year, February 28 otherwise.
  let leap;
  for (let y = today.getFullYear(); ; y++) { leap = new Date(y, 1, Math.min(29, dim(y, 1))); if (leap >= today) break; }
  const leapRow = await (await rrow("QQ Leap Day")).getText();
  assert.ok(leapRow.includes(longDate(leap)), `yearly from Feb 29: next due ${longDate(leap)}: ${leapRow}`);
  // Delete asks first.
  await (await (await rrow("QQ Keep Me")).$("button=Delete")).click();
  await (await (await rrow("QQ Keep Me")).$("button=Cancel")).click();
  assert.equal((await invoke("list_recurring")).some(r => r.merchant === "QQ Keep Me"), true, "Cancel keeps the recurring item");
  await (await (await rrow("QQ Keep Me")).$("button=Delete")).click();
  await (await (await rrow("QQ Keep Me")).$("button=Delete")).click();
  await waitUntilOrDiagnose(b, async () => !(await invoke("list_recurring")).some(r => r.merchant === "QQ Keep Me"), { timeout: 10000, timeoutMsg: "confirming removes the recurring item" });
  assert.equal((await invoke("list_recurring")).length, 2, "the other two items stay");
  console.log("FEATURE 359 PASSED: filters and combinations, bulk category/member/delete with Undo, single delete prompts, recurring delete and month-end / leap-day due dates.");
} finally { await app.close(); }
