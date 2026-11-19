// Ask the Vault "Where can I save money?" (README Dashboard "Ask the Vault"): the real app answers an open cut-back question from the profile's
// own records, offers a what-if, and a what-if it can't answer suggests questions it can. Every expected figure is added up by hand from the rows below.
// Four full months back (4, 3, 2, 1): Groceries 500 each; Dining Out 200, 200, 200 then 400 last month; Rent 1500 each (a Fixed budget line).
// This month: Dining Out 150 on the 1st against a $100 Flexible budget line.
// Expected: over budget Dining Out $150.00, $50.00 over its $100.00; higher than usual last month Dining Out $400.00, about $200.00 usually;
// biggest flexible Groceries $500.00 then Dining Out $266.67 ((200 + 200 + 400) / 3); Rent never listed. Groceries what-if: a tenth of $500 is $50.
// Run with: npm run e2e -- --spec=420
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { askHelpers } from "./lib/askRetirement.mjs";

const dbDir = await seedFixture(`
import datetime
today=datetime.date.today()
def month(back,day):
    index=today.year*12+today.month-1-back;y,m=divmod(index,12)
    return datetime.date(y,m+1,day).isoformat()
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('Main Checking','checking','9000.00')")
a=cur.lastrowid
for cat in ['Groceries','Dining Out','Rent']:
    cur.execute('INSERT OR IGNORE INTO categories(name) VALUES(?)',(cat,))
rows=[]
for back in [4,3,2,1]:
    rows += [(back,3,'Corner Market','-500.00','Groceries'),(back,1,'Landlord','-1500.00','Rent'),(back,9,'Pizza Place','-400.00' if back==1 else '-200.00','Dining Out')]
rows.append((0,1,'Pizza Place','-150.00','Dining Out'))
for back,day,desc,amt,cat in rows:
    d=month(back,day)
    cur.execute("INSERT INTO transactions(account_id,date,description,amount,category,category_source,fingerprint) VALUES(?,?,?,?,?,'user',?)",(a,d,desc,amt,cat,f'{a}|{d}|{desc}|{amt}'))
period=today.strftime("%Y-%m")
cur.execute("INSERT OR IGNORE INTO budget_periods (period) VALUES (?)",(period,))
for category,amount,group in [('Dining Out','100.00','flexible'),('Rent','1500.00','fixed')]:
    cur.execute("INSERT INTO budgets (category, period, monthly_amount, budget_group) VALUES (?, ?, ?, ?)",(category,period,amount,group))
`);

const now = new Date();
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString("en-US", { month: "long" });
const app = await launchApp({ dbDir });
const b = app.browser, h = askHelpers(b);
const shot = name => b.saveScreenshot(path.join(os.tmpdir(), `vault-ask-cut-back-${name}.png`));
async function answer() {
  const el = await b.$("[data-cut-back]");
  await el.waitForExist({ timeout: 15000, timeoutMsg: "the cut-back answer should appear" });
  return el;
}
async function rows(section) {
  const el = await (await answer()).$(`[data-cut-back-section="${section}"]`);
  if (!(await el.isExisting())) return null;
  return b.execute(node => [...node.querySelectorAll("li")].map(li => [...li.querySelectorAll("span")].map(s => s.textContent.trim())), el);
}

try {
  await h.openDashboard();

  // 1. The everyday wording the owner tried first is answered, with the three groups of facts and the fixed bill left out.
  await h.ask("where can i cut back on my spending?");
  assert.match(await (await answer()).getText(), /Places you could look, from your own records/);
  assert.deepEqual(await rows("over-budget"), [["Dining Out", "$150.00", "$50.00 over its $100.00 budget so far"]]);
  assert.deepEqual(await rows("above-usual"), [["Dining Out", "$400.00", `About $200.00 in a usual month (${new Date(now.getFullYear(), now.getMonth() - 4, 1).toLocaleDateString("en-US", { month: "long" })} to ${new Date(now.getFullYear(), now.getMonth() - 2, 1).toLocaleDateString("en-US", { month: "long" })})`]]);
  assert.match(await (await (await answer()).$('[data-cut-back-section="above-usual"] h3')).getText(), new RegExp(`Higher than usual in ${lastMonth}`));
  const biggest = await rows("biggest");
  assert.deepEqual(biggest.map(r => r.slice(0, 2)), [["Groceries", "$500.00"], ["Dining Out", "$266.67"]]);
  assert.ok(!(await (await answer()).getText()).includes("Rent"), "a Fixed bill is never suggested");
  await (await answer()).scrollIntoView({ block: "start" });
  await shot("answer");

  // 2. Try a what-if fills the box with an editable question, and asking it opens the existing spending what-if.
  await (await (await answer()).$('[data-cut-back-section="biggest"] li button')).click();
  assert.equal(await (await b.$(".ledger-qa-card input")).getValue(), "What if I cut Groceries by $50 a month?");
  await (await (await b.$(".ledger-qa-card")).$("button=Ask")).click();
  await b.waitUntil(() => h.dialogOpen(), { timeout: 10000, timeoutMsg: "the what-if should open" });
  assert.equal(await b.$("[data-cut-back]").isExisting(), false, "the answer gives way to the what-if");
  await h.closeDialog();

  // 3. A what-if it can't answer suggests questions it can, and choosing one asks it.
  await h.ask("Help me save $50 on Dining Out at Costco each month");
  const tries = await b.$("[data-try-instead]");
  await tries.waitForExist({ timeout: 10000, timeoutMsg: "the refusal should suggest other questions" });
  assert.deepEqual(await b.execute(node => [...node.querySelectorAll("button")].map(x => x.textContent), tries),
    ["Where can I save money in my budget?", "What can I cut back on?", "What if I cut Groceries by $50 a month?"]);
  await shot("try-instead");
  await (await tries.$("button=What can I cut back on?")).click();
  await answer();
  assert.equal(await h.dialogOpen(), false, "choosing a suggestion closes the refusal");
  assert.equal(await (await b.$(".ledger-qa-card input")).getValue(), "What can I cut back on?");
} finally {
  await app.close();
}
console.log("FEATURE 420 E2E TEST PASSED");
