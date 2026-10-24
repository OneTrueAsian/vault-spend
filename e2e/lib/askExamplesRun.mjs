import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp } from "../harness.mjs";
import { askHelpers } from "./askRetirement.mjs";
import { seedFixture } from "./seed.mjs";
import { ADAPTED_M5C_022, advertisedStrings, buildExpectations, buildWorld, missingEntityProblems, money } from "./askExamples.mjs";

// M6 Task 7 (D-6; CG-01, EX-01 to EX-04, CG-22): runs the advertised Ask the Vault strings in the compiled app on a seeded profile. Sharded ("ledger", "more", "safety") to stay under the
// suite's 60-second spec ceiling. Expected outcomes come from lib/askExamples.mjs, worked from the seed rows and never from the app.
const world = buildWorld();

export function seedExamplesProfile() {
  const q = JSON.stringify;
  return seedFixture(`
import json
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '6000.00')"); checking = cur.lastrowid
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Car Loan', 'loan', '8500.00')")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Roth IRA', 'investment', '0')"); roth = cur.lastrowid
cur.execute("INSERT INTO holdings(account_id,symbol,name,shares,price,cost_basis) VALUES(?,'ROTH','fixture','250','100','0')", (roth,))
cur.execute("INSERT INTO investment_plans(account_id,monthly_contribution,annual_return_pct) VALUES(?,'200','7')", (roth,))
cur.execute("UPDATE app_settings SET inflation_pct='3' WHERE id=1")
members = {}
for name in ('Sam', 'Robin'):
    cur.execute("INSERT INTO family_members (name) VALUES (?)", (name,)); members[name] = cur.lastrowid
for name in ('Dining Out', 'Groceries', 'Rent', 'Income'):
    cur.execute("INSERT OR IGNORE INTO categories (name) VALUES (?)", (name,))
rows = json.loads(${q(q(world.rows))})
for i, r in enumerate(rows):
    cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint, member_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (checking, r['date'], r['description'], '%.2f' % r['amount'], r['category'], 'examples_%d' % i, members.get(r['member'])))
for b in ${q(world.bills)}:
    cur.execute("INSERT INTO recurring (merchant, amount, cadence, anchor_date, account_id) VALUES (?, ?, 'monthly', ?, ?)", (b['merchant'], '%.2f' % b['amount'], b['date'], checking))
cur.execute("INSERT INTO buckets (name, target_amount, color) VALUES ('Vacation Fund', '3000.00', '#8A5FB0')"); vacation = cur.lastrowid
cur.execute("INSERT INTO bucket_contributions (bucket_id, date, amount) VALUES (?, ?, '1500.00')", (vacation, ${q(world.rows[4].date)}))
`);
}
/** A profile that holds none of the names the examples use. */
const seedEmptyNamesProfile = () => seedFixture(`
cur.execute("DELETE FROM categories")
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Everyday Checking', 'checking', '100.00')"); checking = cur.lastrowid
cur.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Misc')")
cur.execute("INSERT INTO transactions (account_id, date, description, amount, category, fingerprint) VALUES (?, ?, 'Hardware', '-10.00', 'Misc', 'empty_1')", (checking, ${JSON.stringify(world.rows[4].date)}))
`);

const cardText = b => b.execute(() => document.querySelector(".ledger-qa-card")?.innerText ?? "");
const dialogText = b => b.execute(() => document.querySelector('[role="dialog"]')?.innerText ?? "");

export async function runAskExamples(shard) {
  const strings = advertisedStrings(), E = buildExpectations(world), failures = [], reached = [];
  const keep = { ledger: strings.ledger, more: [...strings.more, ...strings.suggestions], safety: [] }[shard];
  assert.ok(keep, `unknown shard ${shard}`);
  const dbDir = await seedExamplesProfile();
  const app = await launchApp({ dbDir });
  const b = app.browser, h = askHelpers(b);
  const closeAll = async () => { for (let i = 0; i < 4 && (await h.dialogOpen()); i++) { await b.keys("Escape"); await b.pause(250); } };
  async function outcome(text, expectation, label = text) {
    await h.ask(text);
    const read = async () => (expectation.kind === "scenario" ? ((await h.dialogOpen()) ? await dialogText(b) : "") : await cardText(b));
    let problems = ["no outcome yet"], seen = "";
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) { seen = await read(); problems = expectation.problems(seen); if (problems.length === 0) break; await b.pause(300); }
    const shots=process.env.VS_TASK7_SHOTS;
    if(shots){fs.mkdirSync(shots,{recursive:true});await b.saveScreenshot(path.join(shots,`${shard}-${reached.length+failures.length}-${label.replace(/[^a-z0-9]/gi,"_").slice(0,60)}.png`));}
    if (problems.length) failures.push(`${label}: ${problems.join("; ")} | saw: ${seen.replace(/\s+/g, " ").slice(0, 260)}`);
    else reached.push(label);
    if (expectation.kind === "scenario") await closeAll();
  }
  try {
    await h.openDashboard();
    for (const text of keep) await outcome(text, E[text]);

    if (shard === "safety") {
      await outcome("how much did I spend on dining out in July", E["how much did I spend on dining out in July"], "input edit before: July Dining $95.00");
      await outcome("how much did I spend on groceries last month", E["how much did I spend on groceries last month"], "input edit after: last-month Groceries $338.50");
      // Editing an input changes the relevant output: one more July dining purchase of $5.00 moves the July total from $95.00 to $100.00 and the count from 2 to 3.
      const july = world.rows[0].date;
      await h.bridgeWrite("create_manual_transaction", { accountId: await h.accountId("Everyday Checking"), date: july, description: "EDIT PROOF", amount: "-5.00", category: "Dining Out", memberId: null, notes: null });
      await b.refresh(); await h.openDashboard();
      const edited = buildExpectations({ ...world, rows: [...world.rows, { date: july, description: "EDIT PROOF", amount: -5, category: "Dining Out", member: null }], checkingBalance: world.checkingBalance - 5, spend: f => [...world.rows, { date: july, description: "EDIT PROOF", amount: -5, category: "Dining Out", member: null }].filter(r => r.amount < 0 && (f ?? (() => true))(r)) });
      await outcome("how much did I spend on dining out in July", edited["how much did I spend on dining out in July"], "edit proof: July dining out after adding $5.00");
      // The adapted m5c-022 question (owner-approved zero-month adaptation): reaches the review with no early result.
      await b.refresh(); await h.openDashboard();
      await outcome(ADAPTED_M5C_022(), { kind: "scenario", problems: text => (["Use my saved plan", "Check these details", "A few details to confirm", "Nothing has been calculated yet"].some(x => text.includes(x)) ? [] : ["expected a review or choices screen"]).concat(text.includes("Illustrative balance at") ? ["a result appeared before the review"] : []) }, "adapted m5c-022");
    }
  } finally { await app.close(); }

  if (shard === "safety") {
    // Safe missing-entity outcomes: on a profile that holds none of the named things, no figure is shown for them.
    const emptyApp = await launchApp({ dbDir: await seedEmptyNamesProfile() });
    const eb = emptyApp.browser, eh = askHelpers(eb);
    try {
      await eh.openDashboard();
      for (const text of ["how much did I spend on dining out in July", "how much did I spend at Whole Foods", "how much did I spend at Costco last month", "everything except rent last month", "average purchase on groceries last month", "how much did I spend on groceries last month", "groceries last month without Costco"]) {
        await eb.refresh(); await eh.openDashboard(); await eh.ask(text);
        await eb.waitUntil(async () => (await eb.$(".ledger-qa-card .ledger-qa-answer, .ledger-qa-card .ledger-qa-hint, .ledger-qa-card .ledger-qa-clarify, .ledger-qa-card .ledger-qa-banner-error")).isExisting(), { timeout: 10000, timeoutMsg: `${text}: no outcome on a profile without those names` });
        const seen = await cardText(eb), problems = missingEntityProblems(seen);
        if (problems.length) failures.push(`missing entity "${text}": ${problems.join("; ")}`); else reached.push(`missing entity: ${text}`);
      }
    } finally { await emptyApp.close(); }
  }
  console.log(`[examples:${shard}] reached ${reached.length}: ${reached.join(" | ")}`);
   const expected = shard === "safety" ? 4 + 7 : keep.length;
  assert.equal(reached.length + failures.length, expected, "every planned string must produce either a pass or a recorded failure");
  assert.deepEqual(failures, [], `${failures.length} example problem(s):\n${failures.join("\n")}`);
  console.log(`ASK EXAMPLES PASSED (${shard}: ${reached.length}); sample amount check ${money(world.checkingBalance)}`);
}
