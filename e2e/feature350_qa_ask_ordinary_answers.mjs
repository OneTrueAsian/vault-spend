// Ask the Vault ordinary answers (README Dashboard "Ask the Vault"): UAT-155 totals and rankings, UAT-156 the things a question can filter on, UAT-159 a mistyped name,
// UAT-161 the dates a question can mean. Every expected figure is added up by hand from the fixture rows below, not read back from the app.
// Last month (L): Main Checking Groceries 120 + 80, Dining Out 45.50, Gas 60, Rent 900; Joint Card Dining Out 70; Main Checking Dining In 33.
// Two months ago (M): Joint Card Groceries 100; Main Checking Dining Out 30, Rent 900, Gas 55. This month (T): Groceries 25 on the 1st (so it is never later than today).
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { askHelpers } from "./lib/askRetirement.mjs";
import { yearToDateTop3 } from "./lib/yearToDateTop.mjs";

// [account, months back, day, description, amount, category]; the fixture below is built from this list and the year-to-date expectation is added up from it.
const ROWS = [
  ["a", 1, 5, "Corner Market", "-120.00", "Groceries"], ["a", 1, 9, "Pizza Place", "-45.50", "Dining Out"], ["a", 1, 12, "Corner Market", "-80.00", "Groceries"], ["a", 1, 20, "Shell Gas", "-60.00", "Gas"], ["a", 1, 1, "Landlord", "-900.00", "Rent"],
  ["c", 1, 14, "Bistro Nine", "-70.00", "Dining Out"], ["c", 2, 6, "Corner Market", "-100.00", "Groceries"], ["a", 2, 10, "Pizza Place", "-30.00", "Dining Out"], ["a", 2, 1, "Landlord", "-900.00", "Rent"], ["a", 2, 22, "Shell Gas", "-55.00", "Gas"],
  ["a", 0, 1, "Corner Market", "-25.00", "Groceries"], ["a", 1, 16, "Deli Home", "-33.00", "Dining In"],
];
const dbDir = await seedFixture(`
import datetime
today=datetime.date.today()
def month(back,day):
    index=today.year*12+today.month-1-back;y,m=divmod(index,12)
    return datetime.date(y,m+1,day).isoformat()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('Main Checking','checking','5000.00')")
a=cur.lastrowid
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('Joint Card','credit','0')")
c=cur.lastrowid
for cat in ['Groceries','Dining Out','Dining In','Gas','Rent']:
    cur.execute('INSERT OR IGNORE INTO categories(name) VALUES(?)',(cat,))
rows=${JSON.stringify(ROWS)}
for key,back,day,desc,amt,cat in rows:
    acct=a if key=="a" else c
    d=month(back,day)
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,'user',?)",(acct,d,desc,amt,cat,f'{acct}|{d}|{desc}|{amt}'))
`);
const app = await launchApp({ dbDir });
const b = app.browser, h = askHelpers(b);
const now = new Date();
const monthOf = back => new Date(now.getFullYear(), now.getMonth() - back, 1);
const longName = d => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
const mName = d => d.toLocaleDateString("en-US", { month: "long" });
const lastDay = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const L = monthOf(1), M = monthOf(2);
const card = () => b.execute(() => document.querySelector(".ledger-qa-card").innerText.replace(/\s+/g, " ").trim());
async function answer(question, must) {
  await h.ask(question);
  await waitUntilOrDiagnose(b, async () => (await card()).includes(must), { timeout: 15000, timeoutMsg: `"${question}" is answered with "${must}"`, extra: card });
  return card();
}
try {
  await b.setWindowSize(1280, 1200);
  await h.openDashboard();

  // --- UAT-155: totals and rankings -------------------------------------------------------------------------------------------------------------------
  let t = await answer("How much did I spend on Groceries last month?", "You spent $200.00 on Groceries");
  assert.ok(t.includes(`in ${longName(L)}.`) && t.includes("2 purchases"), t);
  t = await answer("How much did I spend last month?", "on everything");
  assert.ok(t.includes("You spent $1,308.50 on everything") && t.includes("7 purchases"), "120 + 45.50 + 80 + 60 + 900 + 70 + 33 = 1,308.50: " + t);
  t = await answer("What are my top 3 spending categories last month?", "Your top 3 spending categories");
  const order = [...t.matchAll(/(Rent|Groceries|Dining Out|Dining In|Gas) \$([\d,.]+) (\d) purchases?/g)].map(m => [m[1], m[2], m[3]]);
  assert.deepEqual(order, [["Rent", "900.00", "1"], ["Groceries", "200.00", "2"], ["Dining Out", "115.50", "2"]], "ranked by amount: Rent 900, Groceries 200, Dining Out 115.50: " + t);
  assert.ok(t.includes("3 of 5 categories"), t);
  t = await answer("my three biggest expenses last month", "Your 3 biggest purchases");
  assert.ok(t.indexOf("Landlord") < t.indexOf("Corner Market") && t.includes("$900.00") && t.includes("$120.00") && t.includes("$80.00"), "the three biggest single purchases: 900, 120, 80: " + t);

  // --- UAT-156: what a question can filter on ----------------------------------------------------------------------------------------------------------
  t = await answer("How much did I spend on Dining Out on Joint Card last month?", "You spent $70.00 on Dining Out from Joint Card");
  assert.ok(t.includes("1 purchase"), "category and account together: " + t);
  t = await answer("How much did I spend on Joint Card last month?", "on everything from Joint Card");
  assert.ok(t.includes("$70.00"), "an account on its own: " + t);
  t = await answer("dining out last month without Pizza Place", "excluding Pizza Place");
  assert.ok(t.includes("You spent $70.00 on Dining Out, excluding Pizza Place") && t.includes("1 purchase"), "a store left out: " + t);
  t = await answer("groceries last month without Corner Market", "No spending found on Groceries, excluding Corner Market");
  assert.ok(t.includes("0 purchases"), "leaving out the only store leaves nothing, and says so: " + t);
  t = await answer("Which merchant did I spend the most at last month?", "I don't understand \"merchant\" yet.");
  assert.ok(t.includes("Try a category name, a time period like \"last month\", or something like \"top 3\"."), "an unsupported kind of question is declined with examples: " + t);

  // --- UAT-159: mistyped names: a close single match is read and said aloud; several close matches are asked ------------------------------------------------
  t = await answer("How much did I spend on Groceris last month?", "I read “groceris” as “Groceries”.");
  assert.ok(t.includes("You spent $200.00 on Groceries"), "the typo is corrected out loud and answered: " + t);
  t = await answer("How much did I spend on Dinning last month?", "I couldn't find a category, account or store called \"dinning\". Did you mean one of these?");
  assert.ok(t.includes("Nothing has been added up yet.") && t.includes("Dining In") && t.includes("Dining Out"), "two close names are offered, not guessed: " + t);
  await (await (await b.$(".ledger-qa-card")).$("button=Dining In")).click();
  await waitUntilOrDiagnose(b, async () => (await card()).includes("You spent $33.00 on Dining In"), { timeout: 10000, timeoutMsg: "choosing one of the offered names answers with it", extra: card });
  t = await answer("How much did I spend on Xyzzy last month?", "I don't understand \"xyzzy\" yet.");
  assert.ok(!/\$\d/.test(t.split("Try something like")[0]), "an unknown word is never turned into a figure: " + t);

  // --- UAT-161: the dates a question can mean --------------------------------------------------------------------------------------------------------------
  t = await answer("groceries this month", "You spent $25.00 on Groceries");
  assert.ok(t.includes(`${longName(monthOf(0))} so far.`) && t.includes(`${mName(monthOf(0))} 1 to ${mName(monthOf(0))} ${now.getDate()}, ${now.getFullYear()}`), "this month runs to today: " + t);
  t = await answer(`How much did I spend on Groceries in ${mName(M)}?`, "You spent $100.00 on Groceries");
  assert.ok(t.includes(`${mName(M)} 1 to ${mName(M)} ${lastDay(M)}, ${M.getFullYear()}`), "a named month is that whole month: " + t);
  t = await answer(`How much did I spend on Rent from ${mName(L)} 1 to ${mName(L)} 15?`, "You spent $900.00 on Rent");
  assert.ok(t.includes(`${mName(L)} 1 to ${mName(L)} 15, ${L.getFullYear()}`), "an explicit range: " + t);
  t = await answer("How much did I spend on Groceries?", "Which time period should I use?");
  assert.ok(t.includes("Last month") && t.includes("This month so far") && t.includes("This year so far") && t.includes("Nothing has been added up yet."), "no period: it asks and adds nothing up: " + t);
  await (await (await b.$(".ledger-qa-card")).$("button=Last month")).click();
  await waitUntilOrDiagnose(b, async () => (await card()).includes("You spent $200.00 on Groceries"), { timeout: 10000, timeoutMsg: "choosing a period answers", extra: card });
  t = await answer("top 3 spending categories this year", "Your top 3 spending categories in " + now.getFullYear() + " so far");
  const yearOrder = [...t.matchAll(/(Rent|Groceries|Dining Out|Dining In|Gas) \$([\d,.]+)/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(yearOrder, yearToDateTop3(ROWS, now), "year to date, added up from the fixture rows that fall in this calendar year (on 27 October 2026: Rent 1,800; Groceries 120+80+100+25 = 325; Dining Out 45.50+70+30 = 145.50): " + t);
  t = await answer("How much did I spend last year?", "I don’t have records that go back that far.");
  assert.ok(t.includes("Your first recorded transaction is on"), "a period before the records is refused, not answered as $0: " + t);
  console.log("FEATURE 350 PASSED: totals, rankings, account/category/store filters, mistyped names and the dates a question can mean, against hand-added figures.");
} finally { await app.close(); }
