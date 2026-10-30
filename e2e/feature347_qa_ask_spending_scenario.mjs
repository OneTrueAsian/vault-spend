// Ask the Vault M3 spending what-if (README "Ask the Vault spending previews", the fixed single-category what-if paragraph):
//   UAT-166 date choices, UAT-165 preserved draft, UAT-167 baseline/history/manual inputs, UAT-169 edit and reconfirm, UAT-171 stale lifecycle, UAT-172 safe refusal.
// Fixture: Groceries 300 / 320 / 280 in the three full months before this one (usual month 300.00), records covering all three months (a zero-amount row at each end).
// A second profile has records that start part-way through the oldest months, so the history is short.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose, openSettingsGroup } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { askHelpers } from "./lib/askRetirement.mjs";
import { invoke } from "./lib/change-password.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";
import { setDateInput } from "./lib/statementUi.mjs";
import { dateInMonth } from "./lib/dates.mjs";

const history = (coverageBacks, groceries) => `
import datetime
today=datetime.date.today()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Checking','checking','10000.00')")
account=cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories(name) VALUES('Groceries')")
def month(back,day):
    index=today.year*12+today.month-1-back;y,m=divmod(index,12)
    return datetime.date(y,m+1,day).isoformat()
for back,amt in ${groceries}:
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,'Grocer',?,'Groceries','user',?)",(account,month(back,15),amt,f'g-{back}'))
for back,day in ${coverageBacks}:
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,'QA Coverage','0.00','Groceries','user',?)",(account,month(back,day),f'coverage-{back}-{day}'))
`;
const full = await seedFixture(history("[(4,1),(0,1)]", "[(3,'-300.00'),(2,'-320.00'),(1,'-280.00')]"));
// Records start on the 20th of the oldest of the three months: only the two later months are fully covered... and the newest of those has no spending recorded.
const short = await seedFixture(history("[(3,20),(0,1)]", "[(2,'-320.00')]"));

const usd = n => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const daysIn = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const today = new Date();
const partDays = daysIn(today) - today.getDate() + 1;
const wholeMonths = 11 - today.getMonth(); // the months after this one through December
const monthYear = back => new Date(today.getFullYear(), today.getMonth() - back, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }); // the month `back` months before this one
const monthName = (d, n = 0) => new Date(d.getFullYear(), d.getMonth() + n, 1).toLocaleDateString("en-US", { month: "long" });

let app = await launchApp({ dbDir: full });
let b = app.browser, h = askHelpers(b);
const radio = async text => (await (await h.dialog()).$(`label*=${text}`)).click();
const change = async what => (await (await h.dialog()).$(`button[aria-label="${what}"]`)).click();
const tableTotal = () => b.execute(() => [...document.querySelectorAll('[role="dialog"] tr')].find(r => r.cells[0]?.textContent.trim() === "Total")?.cells[1]?.textContent.trim() ?? null);
const field = () => b.execute(() => document.querySelector(".ledger-qa-card input").value);
try {
  await b.setWindowSize(1280, 1100);
  await h.openDashboard();

  // --- UAT-166: the date choices -------------------------------------------------------------------------------------------------------
  await h.ask("What if I cut Groceries by $50 a month?");
  await h.waitText("Which dates should I use?", "date choices");
  let t = await h.text();
  for (const needle of ["From now until December 31", "The whole of " + today.getFullYear() + " as a what-if", "It includes months that have already passed.", "Dates I choose", "Up to 12 months, starting today or later."]) assert.ok(t.includes(needle), `date choices name "${needle}": ${t}`);
  assert.equal(await (await h.dialog()).$("button=Review the details").isEnabled(), false, "nothing is calculated, and the next step is unavailable, until a choice is made");
  // Own dates: each mistake is explained.
  await radio("Dates I choose");
  await setDateInput(b, 'input[aria-label="Schedule start"]', dateInMonth(-1, 5));
  await setDateInput(b, 'input[aria-label="Schedule end"]', dateInMonth(2, 5));
  // A date before today is refused by its own box, in words, and never reaches the dialog.
  await h.waitText("Choose a date on or after", "past start");
  await setDateInput(b, 'input[aria-label="Schedule start"]', dateInMonth(1, 5));
  await setDateInput(b, 'input[aria-label="Schedule end"]', dateInMonth(1, 3));
  await h.waitText("The end can't be before the start.", "end before start");
  await setDateInput(b, 'input[aria-label="Schedule end"]', dateInMonth(14, 5));
  await h.waitText("Choose dates within 12 months.", "beyond a year");
  assert.equal(await (await h.dialog()).$("button=Review the details").isEnabled(), false, "a refused range cannot be reviewed");
  await setDateInput(b, 'input[aria-label="Schedule end"]', dateInMonth(3, 20));
  await h.waitText("Your schedule starts part-way through", "part months asked");
  assert.ok((await h.text()).includes("(3 months)"), "valid own dates state how many months: " + (await h.text()));
  // From now: the current month is a part month and the person chooses how to count it.
  await radio("From now until");
  await h.waitText("Your schedule starts part-way through " + monthName(today), "from now asks about the part month");
  t = await h.text();
  assert.ok(t.includes("Count only whole months") && t.includes("Count the part month by the day"), t);
  assert.ok(t.includes(`${partDays} of ${daysIn(today)} days`), "the by-the-day wording shows the day count: " + t);
  // Whole months, then by the day: the result differs by exactly the part month.
  await radio("Count only whole months");
  await h.clickButton("Review the details"); await h.waitText("Check these details", "review");
  t = await h.text();
  assert.ok(t.includes("Not counted, whole months only"), t);

  // --- UAT-167: the history the usual month is built from -------------------------------------------------------------------------
  for (const row of [["Counted", 3]]) assert.equal((t.match(/Counted/g) ?? []).length, row[1], "all three full months are used: " + t);
  for (const needle of ["$300.00", "$320.00", "$280.00", "A usual month of Groceries: $300.00. That is the three months added up and divided by three."]) assert.ok(t.includes(needle), `history shows ${needle}: ${t}`);
  await h.clickButton("Show what I would save"); await h.waitText("What you would save", "result");
  t = await h.text();
  assert.deepEqual(await tableTotal(), usd(50 * wholeMonths), `whole months only: ${wholeMonths} months x $50: ${t}`);
  assert.ok(t.includes("Your Groceries limit would be $250.00 a month instead of a usual $300.00."), t);
  assert.ok(t.includes("Nothing in your data was changed."), t);

  // --- UAT-165 / UAT-169: Change brings the question back to the card; a new answer needs a new confirmation -------------------------
  await h.clickButton("Change the details");
  await waitUntilOrDiagnose(b, async () => !(await h.dialogOpen()) || (await h.text()).includes("Check these details") || (await h.text()).includes("Before I work this out"), { timeout: 8000, timeoutMsg: "Change the details leaves the result" });

  assert.equal(await field(), "What if I cut Groceries by $50 a month?", "the question is back in the card exactly as asked");
  // A new answer starts over from the date choices and must be confirmed again before anything is shown.
  await h.ask("What if I cut Groceries by $80 a month?");
  await h.waitText("Which dates should I use?", "the edited question asks again");
  assert.ok(!(await h.text()).includes("What you would save"), "no result before the new answers are confirmed");
  await radio("From now until"); await h.waitText("How should I count it?", "part month");
  await radio("Count the part month by the day");
  await h.clickButton("Review the details"); await h.waitText("Check these details", "review again");
  t = await h.text();
  assert.ok(t.includes("$80.00 every month") && !t.includes("$50.00 every month"), "the review shows the edited amount: " + t);
  assert.ok(t.includes("Counted by the day"), "the by-the-day choice is stated: " + t);
  await h.clickButton("Show what I would save"); await h.waitText("What you would save", "result by the day");
  t = await h.text();
  const byDay = await tableTotal();
  assert.equal(byDay, usd(Math.round(80 * (wholeMonths + partDays / daysIn(today)) * 100) / 100), "by the day: 80 x (whole months + part month), checked by hand");

  // --- UAT-171: data changed behind an open review is caught when the answer is asked for; nothing is kept as history -----------------------------
  await h.clickButton("Done");
  await h.ask("What if I cut Groceries by $50 a month?");
  await h.waitText("Which dates should I use?", "dates"); await radio("The whole of"); await h.clickButton("Review the details"); await h.waitText("Check these details", "review");
  const aTransaction = (await invoke(b, "list_transactions")).ok.find(x => x.description === "Grocer");
  await h.bridgeWrite("correct_category", { id: aTransaction.id, category: "Groceries" });
  await h.clickButton("Show what I would save");
  await b.pause(1500);
  assert.ok(await h.dialogOpen(), "the dialog explains instead of vanishing");
  t = await h.text();
  assert.ok(t.includes("Your details changed") && t.includes("This answer or preview is no longer shown. Ask again using your current details.") && t.includes("Nothing was saved or changed."), t);
  assert.ok(!t.includes("What you would save"), "no stale figure is shown");
  await h.clickButton("Close");
  const card0 = await b.execute(() => document.querySelector(".ledger-qa-card").innerText);
  assert.ok(!/What you would save|Month by month/.test(card0), "the card keeps no answer or history: " + card0);

  // --- UAT-172: what is refused, and how ---------------------------------------------------------------------------------------------------------
  const cardNote = () => b.execute(() => document.querySelector(".ledger-qa-card").innerText);
  await h.ask("What if I cut all my spending by $50 a month?");
  await waitUntilOrDiagnose(b, async () => (await cardNote()).includes("I couldn't find a close category"), { timeout: 10000, timeoutMsg: "an unknown category is asked again", extra: cardNote });
  assert.ok((await cardNote()).includes("Nothing has been calculated yet."), await cardNote());
  await h.ask("What if I cut Groceries by 10% once?");
  await h.waitText("Use one date and a fixed amount for a one-time cut. Nothing was calculated.", "percentage once");
  await h.clickButton("Close");
  await h.ask("What if I cut Groceries by $50 a month and invest it at 7%?");
  await h.waitText("This preview cannot apply changes, model investments or ignore conditions.", "investing is not part of this preview");
  assert.ok((await h.text()).includes("Nothing was calculated."));
  await h.clickButton("Close");
  await h.ask("What if I cut Groceries by $400 a month?");
  await h.waitText("Which dates should I use?", "dates");
  await radio("The whole of"); await h.clickButton("Review the details"); await h.waitText("Check these details", "review");
  await h.clickButton("Show what I would save");
  await h.waitText("That is more than you spend", "refused");
  t = await h.text();
  assert.ok(t.includes("$400.00 a month is more than a usual month of Groceries. I have not calculated a result."), t);
  assert.ok(!t.includes("What you would save") && !(await b.execute(() => !!document.querySelector('[role="dialog"] table.scenario-result, [role="dialog"] .cut-preview-results'))), "no result is shown");
  await h.clickButton("Close");
  await h.ask("What if I cut Groceries by 10% a month?");
  await h.waitText("Which dates should I use?", "dates"); await radio("The whole of"); await h.clickButton("Review the details"); await h.waitText("Check these details", "review");
  await h.clickButton("Show what I would save"); await h.waitText("What you would save", "percent result");
  assert.ok((await h.text()).includes("Your Groceries limit would be $270.00 a month instead of a usual $300.00."), "10% of a usual 300.00 month: " + (await h.text()));
  assert.equal(await tableTotal(), usd(30 * 12), "a whole-year what-if counts every month: 12 x $30");
  await h.clickButton("Done");

  // --- UAT-167: nothing recorded for a category: the person's own usual month, never invented ----------------------------------------------------
  await h.ask("What if I cut Rent by $50 a month?");
  await h.waitText("Which dates should I use?", "dates"); await radio("The whole of"); await h.clickButton("Review the details");
  await h.waitText("I cannot tell what a usual month is", "no records");
  t = await h.text();
  assert.ok(t.includes("None of the last three months has complete records for Rent. I have not calculated anything."), t);
  assert.equal((t.match(/Left out: no records/g) ?? []).length, 3, t);
  const usual = () => b.$('[role="dialog"] input');
  const useAmount = async () => (await h.dialog()).$("button=Use this amount");
  await (await useAmount()).click();
  await h.waitText("Enter an amount like 300 or 300.50.", "an empty usual month is explained");
  assert.ok(!(await h.text()).includes("What you would save"), "nothing is calculated from an empty month");
  await (await usual()).setValue("abc");
  await (await useAmount()).click();
  await h.waitText("Enter an amount like 300 or 300.50.", "a non-amount is explained");
  await (await usual()).setValue("200");
  await (await useAmount()).click();
  await h.waitText("What you would save", "result with the typed month");
  t = await h.text();
  assert.ok(t.includes("Your Rent limit would be $150.00 a month instead of a usual $200.00."), t);
  const worked = await b.execute(() => document.querySelector('[role="dialog"]').textContent);
  assert.ok(worked.includes("You entered $200.00 as a usual month of Rent. It was not checked against your records."), "the working states the number is the person's own: " + worked.slice(-600));
  assert.equal(await tableTotal(), usd(50 * 12));
  await h.clickButton("Done");
} finally { await app.close(); }

// --- UAT-167 (short history): only some of the last three months are covered by the records --------------------------------------------------
app = await launchApp({ dbDir: short });
b = app.browser; h = askHelpers(b);
try {
  await b.setWindowSize(1280, 1100);
  await h.openDashboard();
  await h.ask("What if I cut Groceries by $50 a month?");
  await h.waitText("Which dates should I use?", "dates"); await radio("The whole of"); await h.clickButton("Review the details"); await h.waitText("Check these details", "review");
  const t = await h.text();
  assert.ok(t.includes("Left out: records start part-way through"), "the oldest month is left out, not counted as $0.00: " + t);
  assert.ok(t.includes(monthYear(3) + " $0.00 Left out: records start part-way through") && t.includes(monthYear(2) + " $320.00 Counted") && t.includes(monthYear(1) + " $0.00 Left out: no records"), "only the covered month with spending counts: " + t);
  assert.ok(t.includes("A usual month of Groceries: $320.00, from 1 month."), t);
  assert.ok(t.includes("This average rests on less history, so it may be off.") && t.includes("Enter a usual month myself"), "short history is offered as a choice with its caveat: " + t);
  // Short history needs the person's explicit choice before anything is shown.
  await h.clickButton("Show what I would save");
  await b.pause(500);
  assert.ok(!(await h.text()).includes("What you would save"), "no result until a choice is made: " + (await h.text()).slice(-200));
  await radio("Use the 1 month I have");
  await h.clickButton("Show what I would save"); await h.waitText("What you would save", "result from one month");
  assert.ok((await h.text()).includes("Your Groceries limit would be $270.00 a month instead of a usual $320.00."), await h.text());
  const note = await b.execute(() => document.querySelector('[role="dialog"]').textContent);
  assert.ok(note.includes("1 month"), "the working says how many months it rests on: " + note.slice(-500));
  await h.clickButton("Change the details");
  await h.ask("What if I cut Groceries by $50 a month?");
  await h.waitText("Which dates should I use?", "dates"); await radio("The whole of"); await h.clickButton("Review the details"); await h.waitText("Check these details", "review");
  await radio("Enter a usual month myself");
  await (await (await h.dialog()).$("input:not([type=radio])")).setValue("400");
  await h.clickButton("Show what I would save"); await h.waitText("What you would save", "result from the typed month");
  assert.ok((await h.text()).includes("Your Groceries limit would be $350.00 a month instead of a usual $400.00."), await h.text());
  console.log("FEATURE 347 PASSED: date choices and their refusals, the preserved question, edit-and-reconfirm, stale details, refusals, and full, short and empty history.");
} finally { await app.close(); }

// --- UAT-171 (profile change): switching profile with a review open leaves nothing of it in the other profile ------------------------------------------------------
const other = await seedFixture(history("[(4,1),(0,1)]", "[(3,'-300.00'),(2,'-320.00'),(1,'-280.00')]"));
app = await launchApp({ dbDir: other });
b = app.browser; h = askHelpers(b);
try {
  await b.setWindowSize(1280, 1100);
  await h.openDashboard();
  await h.ask("What if I cut Groceries by $50 a month?");
  await h.waitText("Which dates should I use?", "dates"); await radio("The whole of"); await h.clickButton("Review the details"); await h.waitText("Check these details", "review");
  await b.execute(() => document.querySelector('.nav-item[data-tab="settings"]').click()); // a DOM click: the open dialog's overlay covers the sidebar
  await openSettingsGroup(b, "profiles");
  await b.$(".profile-create-form input").waitForExist({ timeout: 10000 });
  await b.$(".profile-create-form input").setValue("Other Profile");
  await b.$('.profile-create-form button[type="submit"]').click();
  await b.waitUntil(async () => (await b.$(".profile-switcher-name").getText()) === "Other Profile", { timeout: 10000 });
  assert.equal(await h.dialogOpen(), false, "the review did not follow the person into the other profile");
  await h.openDashboard();
  assert.equal(await field(), "", "the other profile starts with an empty question");
} finally { await app.close(); }

// --- UAT-171 (locking): locking the app removes an open review and the question; nothing comes back after unlocking ---------------------------------------------
const PASSWORD = "m3 spending scenario password";
const locked = await seedFixture(history("[(4,1),(0,1)]", "[(3,'-300.00'),(2,'-320.00'),(1,'-280.00')]"));
app = await launchApp({ dbDir: locked });
b = app.browser; h = askHelpers(b);
try {
  await b.setWindowSize(1280, 1100);
  await (await b.$("button*=Settings")).click();
  await openSettingsGroup(b, "profiles");
  await enableProtectionThroughUI(b, PASSWORD);
  await b.waitUntil(async () => (await b.$(".page").getText()).includes("Password protection: On"), { timeout: 15000 });
  await h.openDashboard();
  await h.ask("What if I cut Groceries by $50 a month?");
  await h.waitText("Which dates should I use?", "dates"); await radio("The whole of"); await h.clickButton("Review the details"); await h.waitText("Check these details", "review");
  assert.equal((await invoke(b, "debug_apply_system_session_event", { event: "locked" })).ok, true);
  await b.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  assert.ok(!(await b.execute(() => document.body.textContent.includes("Check these details") || document.body.textContent.includes("Groceries"))), "no review text on the lock screen");
  await b.$("#password-form-field").setValue(PASSWORD); await b.$("button=Unlock").click();
  await b.$(".brand-word").waitForExist({ timeout: 15000 });
  await h.openDashboard();
  assert.equal(await h.dialogOpen(), false, "no review after unlocking");
  assert.equal(await field(), "", "the question was not kept");
  console.log("FEATURE 347 LOCK PASSED: locking retires an open review and keeps no question.");
} finally { await app.close(); }
