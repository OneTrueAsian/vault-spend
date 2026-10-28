// Ask the Vault M4 savings target (README "Ask the Vault spending previews", first paragraphs):
//   UAT-173 monthly and total targets, UAT-176 history and manual inputs, UAT-177 year choice and partial months, UAT-179 allocation / rounding / maximum / shortfall.
// Fixture: three full months before this one with Groceries 300, Dining Out 90, Shopping 60 (usual months 300 / 90 / 60), records covering all three months.
// Expected allocations are worked by hand in the comments (the preview shares the target in proportion to each category's room, rounding to whole cents).
import assert from "node:assert/strict";
import { launchApp, chooseMenuOption, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { askHelpers } from "./lib/askRetirement.mjs";
import { monthlyEquivalent, monthsLeftInYear } from "./lib/savingsTargetMonths.mjs";

// The part-month scenarios depend on the day this runs: whole months left in the year, and this month's remaining days (today included).
const left = monthsLeftInYear(new Date());
if (left.whole < 1) throw new Error("feature348 needs at least one whole month left in the year (in December the app offers no whole-month choice: 'There is no whole month in this range.'), so this scenario cannot run");
const usd = c => `$${c / 100n}.${String(c % 100n).padStart(2, "0")}`;
const split = (months, ...cases) => cases.map(([name, allocated, usual]) => { const e = monthlyEquivalent(allocated, usual, months); return [name, usd(allocated), usd(e.cut), usd(e.limit)]; });
const CATEGORIES = [["Dining Out", 4000n, 9000n], ["Groceries", 13333n, 30000n], ["Shopping", 2667n, 6000n]];

const dbDir = await seedFixture(`
import datetime
today=datetime.date.today()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('QA Checking','checking','10000.00')")
account=cur.lastrowid
def month(back,day):
    index=today.year*12+today.month-1-back;y,m=divmod(index,12)
    return datetime.date(y,m+1,day).isoformat()
for name,amount in [('Groceries','-300.00'),('Dining Out','-90.00'),('Shopping','-60.00')]:
    cur.execute('INSERT OR IGNORE INTO categories(name) VALUES(?)',(name,))
    for back in [3,2,1]:
        cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,'user',?)",(account,month(back,15),name+' spend',amount,name,f'{name}-{back}'))
for back,day in [(4,1),(0,1)]:
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,'QA Coverage','0.00','Groceries','user',?)",(account,month(back,day),f'coverage-{back}'))
`);
const app = await launchApp({ dbDir });
const b = app.browser, h = askHelpers(b);
const radio = async text => (await (await h.dialog()).$(`label*=${text}`)).click();
const rows = () => b.execute(() => [...document.querySelectorAll(".cut-preview-results tbody tr")].map(r => [...r.cells].map(c => c.innerText.trim())));
const heads = () => b.execute(() => [...document.querySelectorAll(".cut-preview-results thead th")].map(c => c.innerText.trim()));
async function choose(names) {
  for (const n of names) await b.$(`input[aria-label="Select ${n}"]`).click();
}
async function toReview(question, names, { confirmDefault = true, range = "The whole of" } = {}) {
  await h.ask(question);
  await h.waitText("Choose up to 20 categories", "choices");
  await choose(names);
  if (confirmDefault) for (const n of names) await h.clickButton(`Allow up to 100% with floor $0 for ${n}`);
  await radio(range);
}
try {
  await b.setWindowSize(1280, 1200);
  await h.openDashboard();

  // --- UAT-173 / UAT-179: a monthly target shared in proportion to each category's room ------------------------------------------------------------
  // Room 300 + 90 + 60 = 450. Target 100.00: 66.666.. / 20.00 / 13.333.. -> 66.66, 20.00, 13.33 and one spare cent goes to the largest remainder (Groceries): 66.67 / 20.00 / 13.33.
  await toReview("Where can I cut back to save $100 a month?", ["Dining Out", "Groceries", "Shopping"]);
  await h.clickButton("Review the details"); await h.waitText("Check every detail", "review");
  let t = await h.text();
  for (const n of ["Groceries", "Dining Out", "Shopping"]) assert.ok(t.includes(n), t);
  await h.clickButton("Show the preview"); await h.waitText("Your savings target preview", "result");
  assert.deepEqual(await rows(), [["Dining Out", "$20.00", "$20.00", "$70.00"], ["Groceries", "$66.67", "$66.67", "$233.33"], ["Shopping", "$13.33", "$13.33", "$46.67"]]);
  t = await h.text();
  for (const needle of ["Goal: $100.00 per month", "Achievable: $100.00 per month", "Maximum: $450.00 per month", "Shortfall: $0.00 per month", "$1,200.00 across the selected dates", "Cuts are spread in proportion to allowed capacity, respecting each floor and maximum cut."]) assert.ok(t.includes(needle), `${needle}: ${t}`);
  await h.closeDialog();

  // A maximum in dollars (not percent) and a floor: Groceries may be cut at most $20 a month, Dining Out may not go below $80 (room 10).
  // Room 20 + 10 + 60 = 90. Target 50.00: 11.11 / 5.55.. / 33.33 -> 1111, 555, 3333 cents and the spare cent goes to Dining Out (largest remainder): 11.11 / 5.56 / 33.33.
  await h.ask("Where can I cut back to save $50 a month?"); await h.waitText("Choose up to 20 categories", "choices");
  await choose(["Dining Out", "Groceries", "Shopping"]);
  await chooseMenuOption(await b.$('button[aria-label="Groceries maximum cut unit"]'), { label: "Dollars per month" });
  await b.$('input[aria-label="Groceries maximum cut"]').setValue("20");
  await b.$('input[aria-label="Groceries monthly floor"]').setValue("0");
  await chooseMenuOption(await b.$('button[aria-label="Dining Out maximum cut unit"]'), { label: "Percent of usual month" });
  await b.$('input[aria-label="Dining Out maximum cut"]').setValue("100");
  await b.$('input[aria-label="Dining Out monthly floor"]').setValue("80");
  await h.clickButton("Allow up to 100% with floor $0 for Shopping");
  await radio("The whole of"); await h.clickButton("Review the details"); await h.waitText("Check every detail", "review");
  await h.clickButton("Show the preview"); await h.waitText("Your savings target preview", "result");
  assert.deepEqual(await rows(), [["Dining Out", "$5.56", "$5.56", "$84.44"], ["Groceries", "$11.11", "$11.11", "$288.89"], ["Shopping", "$33.33", "$33.33", "$26.67"]]);
  t = await h.text();
  assert.ok(t.includes("Maximum: $90.00 per month") && t.includes("Goal: $50.00 per month") && t.includes("Shortfall: $0.00 per month"), "the dollar maximum (20) and the floor (80, room 10) set the room to 20 + 10 + 60: " + t);
  await h.closeDialog();

  // A target above the room: everything possible is cut and the shortfall is shown (Groceries 20 + Dining Out 10 + Shopping 60 = 90).
  await h.ask("Where can I cut back to save $100 a month?"); await h.waitText("Choose up to 20 categories", "choices");
  await choose(["Dining Out", "Groceries", "Shopping"]);
  await chooseMenuOption(await b.$('button[aria-label="Groceries maximum cut unit"]'), { label: "Dollars per month" });
  await b.$('input[aria-label="Groceries maximum cut"]').setValue("20"); await b.$('input[aria-label="Groceries monthly floor"]').setValue("0");
  await chooseMenuOption(await b.$('button[aria-label="Dining Out maximum cut unit"]'), { label: "Percent of usual month" });
  await b.$('input[aria-label="Dining Out maximum cut"]').setValue("100"); await b.$('input[aria-label="Dining Out monthly floor"]').setValue("80");
  await h.clickButton("Allow up to 100% with floor $0 for Shopping");
  await radio("The whole of"); await h.clickButton("Review the details"); await h.waitText("Check every detail", "review");
  await h.clickButton("Show the preview"); await h.waitText("Your savings target preview", "result");
  assert.deepEqual(await rows(), [["Dining Out", "$10.00", "$10.00", "$80.00"], ["Groceries", "$20.00", "$20.00", "$280.00"], ["Shopping", "$60.00", "$60.00", "$0.00"]]);
  t = await h.text();
  assert.ok(t.includes("Achievable: $90.00 per month") && t.includes("Maximum: $90.00 per month") && t.includes("Shortfall: $10.00 per month"), t);
  await h.closeDialog();

  // --- UAT-173 / UAT-177: a total over the chosen dates, and how the part month is counted --------------------------------------------------------
  await h.ask("Save $200 in total this year"); await h.waitText("Choose up to 20 categories", "choices");
  assert.equal(await b.execute(() => [...document.querySelectorAll('[role="dialog"] input[type=radio]')].map(r => r.checked)).then(x => x.slice(0, 2).join()), "false,true", "a total over these dates is already the reading of 'in total'");
  await choose(["Dining Out", "Groceries", "Shopping"]);
  for (const n of ["Dining Out", "Groceries", "Shopping"]) await h.clickButton(`Allow up to 100% with floor $0 for ${n}`);
  await radio("From now until");
  await h.waitText("How should I count part months?", "part month asked");
  t = await h.text();
  
  await radio("Count only whole months");
  await h.clickButton("Review the details"); await h.waitText("Check every detail", "review");
  await h.clickButton("Show the preview"); await h.waitText("Your savings target preview", "result");
  // Whole months only: the months after this one in the year (computed from the calendar; 2 on 27 October 2026). Room 600 + 180 + 120 = 900 over these dates; target 200 -> 133.33.. / 40.00 / 26.66.. and the spare cent goes to Shopping (largest remainder).
  assert.deepEqual(await heads(), ["Category", "Allocated over these dates", "Approx. monthly cut", "Approx. monthly limit"]);
  assert.deepEqual(await rows(), split({ num: BigInt(left.whole), den: 1n }, ...CATEGORIES));
  t = await h.text();
  for (const needle of ["Goal: $200.00 over these dates", "Maximum: $900.00 over these dates", "Shortfall: $0.00 over these dates", "$200.00 across the selected dates", `(${left.whole} month`, "Monthly equivalents and limits are rounded to cents. Use the allocated over these dates amounts"]) assert.ok(t.includes(needle), `${needle}: ${t}`);
  // The history each category's usual month rests on is available in the result.
  const detail = await b.execute(() => document.querySelector('[role="dialog"]').textContent);
  for (const needle of ["$300.00", "$90.00", "$60.00"]) assert.ok(detail.includes(needle), `the category details show ${needle}`);
  await h.clickButton("Change the details"); await h.waitText("Choose up to 20 categories", "edit");
  assert.equal(await b.$(".cut-preview-results").isExisting(), false, "the old result is retired while the details are edited");
  // The same target with the part month counted by the day: whole months + remaining days of this month / days in the month (2 + 5/31 = 67/31 on 27 October 2026); the allocation keeps its ratio, the monthly equivalents shrink.
  await h.closeDialog();
  await h.ask("Save $200 in total this year"); await h.waitText("Choose up to 20 categories", "choices");
  await choose(["Dining Out", "Groceries", "Shopping"]);
  for (const n of ["Dining Out", "Groceries", "Shopping"]) await h.clickButton(`Allow up to 100% with floor $0 for ${n}`);
  await radio("From now until"); await h.waitText("How should I count part months?", "part month asked again");
  await radio("Count the part month by the day");
  await h.clickButton("Review the details"); await h.waitText("Check every detail", "review");
  await h.clickButton("Show the preview"); await h.waitText("Your savings target preview", "result by the day");
  assert.deepEqual(await rows(), split({ num: BigInt(left.whole * left.daysInMonth + left.partDays), den: BigInt(left.daysInMonth) }, ...CATEGORIES));
  await h.closeDialog();
  // The whole year as a what-if counts 12 months: 200 / 12 = 16.67 a month in total.
  await h.ask("Save $200 in total this year"); await h.waitText("Choose up to 20 categories", "choices");
  await choose(["Dining Out", "Groceries", "Shopping"]);
  for (const n of ["Dining Out", "Groceries", "Shopping"]) await h.clickButton(`Allow up to 100% with floor $0 for ${n}`);
  await radio("The whole of"); await h.clickButton("Review the details"); await h.waitText("Check every detail", "review");
  await h.clickButton("Show the preview"); await h.waitText("Your savings target preview", "whole year");
  assert.deepEqual(await rows(), [["Dining Out", "$40.00", "$3.33", "$86.67"], ["Groceries", "$133.33", "$11.11", "$288.89"], ["Shopping", "$26.67", "$2.22", "$57.78"]]);
  assert.ok((await h.text()).includes("(12 months)"));
  await h.closeDialog();
  // A category with nothing recorded cannot be given a usual month by the app: the person types one or removes the category.
  await h.ask("Where can I cut back to save $100 a month?"); await h.waitText("Choose up to 20 categories", "choices");
  await choose(["Entertainment", "Groceries"]);
  await h.clickButton("Allow up to 100% with floor $0 for Entertainment"); await h.clickButton("Allow up to 100% with floor $0 for Groceries");
  await radio("The whole of"); await h.clickButton("Review the details"); await h.waitText("Check every detail", "review");
  t = await h.text();
  assert.ok(t.includes("No complete months. Enter your own usual month or remove this category; missing records do not become $0.") && t.includes("Usual month from 3 recorded months: $300.00 (rounded)."), t);
  assert.equal(await (await h.dialog()).$("button=Show the preview").isEnabled(), false, "a category with no records blocks the preview until the person decides");
  // Their own usual month for Entertainment: room 300 + 40 = 340. Target 100.00 -> 88.23.5 / 11.76.47 -> 8823 and 1176 cents, the spare cent to Groceries (larger remainder): 88.24 / 11.76.
  await b.$('input[aria-label="Entertainment usual month"]').setValue("40");
  await h.clickButton("Show the preview"); await h.waitText("Your savings target preview", "result with a typed month");
  assert.deepEqual(await rows(), [["Entertainment", "$11.76", "$11.76", "$28.24"], ["Groceries", "$88.24", "$88.24", "$211.76"]]);
  await h.clickButton("Change the details"); await h.waitText("Choose up to 20 categories", "edit");
  await h.clickButton("Review the details"); await h.waitText("Check every detail", "review again");
  await h.clickButton("Remove Entertainment");
  await h.waitText("Choose up to 20 categories", "removing a category goes back to the choices");
  assert.equal(await b.$('input[aria-label="Entertainment monthly floor"]').isExisting(), false, "the removed category is no longer selected");
  await h.clickButton("Review the details"); await h.waitText("Check every detail", "review without it");
  assert.ok(!(await h.text()).includes("The last three full months of Entertainment"));
  await h.clickButton("Show the preview"); await h.waitText("Your savings target preview", "result without it");
  assert.deepEqual(await rows(), [["Groceries", "$100.00", "$100.00", "$200.00"]]);
  await h.closeDialog();
  // A tie: two categories with the same room and one cent to share. The cent goes to the name that sorts first (Business Expense), whatever order they were picked in.
  await h.ask("Where can I cut back to save $0.01 a month?"); await h.waitText("Choose up to 20 categories", "choices");
  await choose(["Entertainment", "Business Expense"]);
  await h.clickButton("Allow up to 100% with floor $0 for Entertainment"); await h.clickButton("Allow up to 100% with floor $0 for Business Expense");
  await radio("The whole of"); await h.clickButton("Review the details"); await h.waitText("Check every detail", "review");
  await b.$('input[aria-label="Entertainment usual month"]').setValue("50"); await b.$('input[aria-label="Business Expense usual month"]').setValue("50");
  await h.clickButton("Show the preview"); await h.waitText("Your savings target preview", "tie result");
  assert.deepEqual(await rows(), [["Business Expense", "$0.01", "$0.01", "$49.99"], ["Entertainment", "$0.00", "$0.00", "$50.00"]]);
  await h.closeDialog();
  console.log("FEATURE 348 PASSED: monthly and total targets, proportional allocation with cent remainders, dollar maximums and floors, shortfall, part-month counting and the whole-year what-if.");
} finally { await app.close(); }
