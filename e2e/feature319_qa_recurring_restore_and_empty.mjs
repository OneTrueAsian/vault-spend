// Owner-requested QA Batch A: real UI actions on disposable synthetic fixtures.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp, waitUntilOrDiagnose, dismissStatusMessages } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { displayDate } from "./lib/dates.mjs";

const shots = process.env.VS_QA_COMPLETION_SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });
const shot = async (b, name) => { if (shots) await b.saveScreenshot(path.join(shots, `feature319-${name}.png`)); };
async function nav(b, label) { const el = await b.$(`.nav-item[aria-label="${label}"]`); await el.click(); }
async function text(b) { return b.execute(() => document.querySelector('[role="main"]')?.innerText ?? ""); }

// Empty graph is checked separately: no data is fabricated for the purpose of getting a visible axis.
let app = await launchApp();
try {
  const b = app.browser;
  await nav(b, "Cash Flow");
  await waitUntilOrDiagnose(b, async () => (await text(b)).includes("No income or spending in this period."), { timeout: 10000, timeoutMsg: "empty cash flow explains that there is no activity" });
  assert.equal(await b.$(".chart-bar").isExisting(), false);
  assert.ok(!(await text(b)).includes("Click a bar"));
  await shot(b, "empty-cash-flow");
} finally { await app.close(); }

const dbDir = await seedFixture(`
import datetime
today = datetime.date.today()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Checking','checking','1000.00')")
account = cur.lastrowid
cur.execute("INSERT INTO recurring(merchant,amount,cadence,anchor_date,account_id) VALUES('QA Month End','-10.00','monthly',?,?)",(today.replace(month=1,day=31).isoformat(),account))
for i in [1,2]:
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,'Groceries','user',?)",(account,today.isoformat(),f'QA Delete {i}',f'-{i}.00',f'qa-delete-{i}'))
`);
app = await launchApp({ dbDir });
try {
  const b = app.browser;
  await b.setWindowSize(1280, 900);
  await nav(b, "Recurring");
  const row = () => b.$('//table[contains(@class,"ledger")]//tr[contains(.,"QA Month End")]');
  await (await row()).waitForDisplayed({ timeout: 10000 });
  const today = new Date();
  let year = today.getFullYear(), month = today.getMonth();
  let due = new Date(year, month, Math.min(31, new Date(year, month + 1, 0).getDate()));
  if (due.getDate() < today.getDate()) { month++; due = new Date(year, month, Math.min(31, new Date(year, month + 1, 0).getDate())); }
  const dueIso = `${due.getFullYear()}-${String(due.getMonth()+1).padStart(2,"0")}-${String(due.getDate()).padStart(2,"0")}`;
  assert.ok((await (await row()).getText()).includes(displayDate(dueIso)), "monthly next due recovers its anchor day after short months");
  await b.execute(() => { window.__qaBackgroundErrors = []; new MutationObserver(() => { const s = document.querySelector('.status')?.textContent ?? ''; if (/A newer data load|profile session has closed/.test(s)) window.__qaBackgroundErrors.push(s); }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
  await (await (await row()).$("button=Edit")).click();
  await b.$("input.amount-edit-input").setValue("-12.34");
  await b.$("button=Save").click();
  await waitUntilOrDiagnose(b, async () => (await (await row()).getText()).includes("$12.34"), { timeout: 10000, timeoutMsg: "edited recurring amount is read back" });
  assert.deepEqual(await b.execute(() => window.__qaBackgroundErrors), [], "background read retirement is not reported as a failed save");
  await shot(b, "recurring-edit");

  await nav(b, "Settings");
  await b.$("button=Back up now").click();
  await waitUntilOrDiagnose(b, async () => (await b.$(".status").getText()).includes("Backup created"), { timeout: 10000, timeoutMsg: "manual backup has completed" });
  const backup = await b.$("[data-backups] tbody tr");
  const name = await (await backup.$(".backup-file-label")).getText();
  assert.match(name, /\.db$/);
  await (await backup.$("button=Restore")).click();
  const warning = await backup.$(".backup-restore-warning");
  await warning.waitForDisplayed({ timeout: 5000 });
  const warningText = await warning.getText();
  assert.ok(warningText.includes(name)); assert.ok(warningText.includes("Replace your current data")); assert.ok(warningText.includes("backed up first"));
  await warning.scrollIntoView({block:"center",inline:"nearest"});
  const visibleWarning=await b.execute(el=>{
    const box=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);
    return {top:box.top,bottom:box.bottom,height:innerHeight,clipped:[...range.getClientRects()].some(r=>r.left<box.left-1||r.right>box.right+1)};
  },warning);
  assert.ok(visibleWarning.top>=0&&visibleWarning.bottom<=visibleWarning.height&&!visibleWarning.clipped,"the complete warning is readable inside its cell and viewport");
  await shot(b, "restore-warning");
  await (await backup.$("button=Cancel")).click();
  assert.equal(await b.$(".backup-restore-warning").isExisting(), false);

  await nav(b, "Transactions"); await dismissStatusMessages(b);
  const deleteRow = () => b.$('//tr[@data-payment-row][contains(.,"QA Delete 1")]');
  await (await deleteRow()).waitForDisplayed({ timeout: 10000 });
  await (await (await deleteRow()).$('input[type="checkbox"]')).click();
  await b.$("button=Delete selected").click(); await b.$("button=Delete 1").click();
  await waitUntilOrDiagnose(b, () => b.execute(() => document.body.innerText.includes("Deleted 1 transaction.")), { timeout: 10000, timeoutMsg: "deletion toast uses singular transaction" });
  assert.equal(await (await deleteRow()).isExisting(), false);
  await b.$("button=Undo").click();
  await waitUntilOrDiagnose(b, () => b.execute(() => document.body.innerText.includes("Restored 1 transaction.")), { timeout: 10000, timeoutMsg: "undo toast uses singular transaction" });
  await (await deleteRow()).waitForDisplayed({ timeout: 10000 });
  await shot(b, "undo-wording");
  console.log("FEATURE 319 PASSED: empty graph, anchor date, edited amount/no stale toast, identified restore/cancel, delete/undo wording.");
} finally { await app.close(); }
