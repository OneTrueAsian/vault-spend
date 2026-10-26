import fs from "node:fs";
import { dateInMonth } from "./dates.mjs";

// M6 Task 7 (owner direction D-6; CG-01, EX-01 to EX-04; Open-Items G-4): the 25 strings the Ask the Vault card advertises, run in the compiled app on a seeded profile.
// The list is read from the card's own exported arrays (TRANSACTION_QA_EXAMPLES, MORE_EXAMPLES, SUGGESTIONS) so it cannot drift: a string added, removed or reworded
// without an expected outcome here fails the unit test. Every expected figure is worked from the seed rows below by plain filtering and addition (never from the app),
// and the unit test pins the hand-worked figures for a fixed date (2026-10-22), which match the frozen example map of the same shapes (exampleMap.ts).

const arrayLiteral = (source, name) => {
  const m = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\];`));
  if (!m) throw new Error(`could not find the exported array ${name}`);
  return [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(x => JSON.parse(`"${x[1]}"`));
};
export function advertisedStrings(root = ".") {
  const qa = fs.readFileSync(`${root}/src/transactionQa.ts`, "utf8"), card = fs.readFileSync(`${root}/src/AskVaultCard.tsx`, "utf8");
  return { ledger: arrayLiteral(qa, "TRANSACTION_QA_EXAMPLES"), more: arrayLiteral(card, "MORE_EXAMPLES"), suggestions: arrayLiteral(card, "SUGGESTIONS") };
}

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const money = n => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = n => Math.round(n * 100) / 100;

/** The seed, relative to `now`: nothing depends on a fixed calendar date, and every row is on or before today. */
export function buildWorld(now = new Date()) {
  const at = (offset, day) => dateInMonth(offset, day, now);
  const julyYear = now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1; // the most recent July that has begun (src/askVault/dates.ts bareMonthYear)
  const july = day => `${julyYear}-07-${String(day).padStart(2, "0")}`;
  const row = (date, description, amount, category, member) => ({ date, description, amount, category, member });
  const rows = [
    row(july(1), "SUSHI PLACE", -60, "Dining Out", "Sam"), row(july(2), "TACO TOWN", -35, "Dining Out", "Robin"),
    row(at(-4, 10), "WHOLE FOODS MARKET #12", -25, "Groceries", "Sam"), row(at(-2, 1), "SUSHI PLACE", -20, "Dining Out", "Sam"),
    row(at(-1, 1), "MAPLE COURT APARTMENTS", -1500, "Rent", null), row(at(-1, 3), "WHOLE FOODS MARKET #12", -80, "Groceries", "Sam"),
    row(at(-1, 5), "COSTCO WHSE", -120, "Groceries", "Sam"), row(at(-1, 12), "MEIJER #55", -22, "Groceries", "Robin"), row(at(-1, 14), "TARGET T-1204", -41, "Groceries", "Sam"),
    row(at(-1, 17), "WHOLE FOODS MARKET #12", -45.5, "Groceries", "Robin"), row(at(-1, 20), "COSTCO WHSE", -30, "Groceries", "Robin"), row(at(-1, 25), "SUSHI PLACE", -18, "Dining Out", "Sam"),
    row(at(0, 1), "COSTCO WHSE", -50, "Groceries", "Sam"), row(at(0, 1), "TACO TOWN", -25, "Dining Out", "Robin"), row(at(0, 1), "PAYCHECK", 3000, "Income", null),
  ];
  const monthKey = d => d.slice(0, 7), thisMonth = monthKey(iso(now)), lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15), lastMonth = monthKey(iso(lastMonthDate));
  const spend = (f = () => true) => rows.filter(r => r.amount < 0 && f(r));
  const sum = list => round2(list.reduce((s, r) => s + Math.abs(r.amount), 0));
  const inLast = r => monthKey(r.date) === lastMonth, inThis = r => monthKey(r.date) === thisMonth, inYear = r => r.date.startsWith(String(now.getFullYear()));
  const label = key => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  const nextBill = (days) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days); return d; };
  const bills = [{ merchant: "Netflix", amount: -15, date: iso(nextBill(3)) }, { merchant: "Gym", amount: -45, date: iso(nextBill(10)) }];
  return { now, rows, spend, sum, inLast, inThis, inYear, thisMonth, lastMonth, julyYear, label, bills, startingChecking: 6000, loan: 8500, investment: 25000, vacation: { saved: 1500, target: 3000 },
    checkingBalance: round2(6000 + rows.reduce((s, r) => s + r.amount, 0)) };
}

const shortDate = iso => { const [, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${d}`; };
const purchases = n => `${n} purchase${n === 1 ? "" : "s"}`;
const compact = s => s.replace(/\s+/g, "");
const has = (...needles) => text => needles.filter(n => !compact(text).includes(compact(n))).map(n => `missing "${n}"`);
const hasAll = (...checks) => text => checks.flatMap(c => c(text));
const absent = (...needles) => text => needles.filter(n => text.includes(n)).map(n => `must not contain "${n}"`);

/** Expected outcome per advertised string, keyed by the exact text: { kind, problems(text) -> string[] } */
export function buildExpectations(w) {
  const dining = w.spend(r => r.category === "Dining Out"), groc = w.spend(r => r.category === "Groceries");
  const julyDining = dining.filter(r => r.date.startsWith(`${w.julyYear}-07`));
  const wf = w.spend(r => r.description.startsWith("WHOLE FOODS")), costco = w.spend(r => r.description.startsWith("COSTCO"));
  const lastAll = w.spend(w.inLast), lastNoRent = lastAll.filter(r => r.category !== "Rent"), lastGroc = groc.filter(w.inLast), lastCostco = costco.filter(w.inLast);
  const thisMonthSpend = w.spend(w.inThis), yearSpend = w.spend(w.inYear);
  const income = w.rows.filter(r => r.amount > 0 && w.inThis(r)).reduce((s, r) => s + r.amount, 0);
  const rate = Math.round(((income - w.sum(thisMonthSpend)) / income) * 100);
  const byCat = Object.entries(yearSpend.reduce((m, r) => ({ ...m, [r.category]: [...(m[r.category] ?? []), r] }), {})).map(([c, l]) => [c, w.sum(l), l.length]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const biggest = [...lastAll].sort((a, b) => a.amount - b.amount).slice(0, 3);
  const member = name => w.sum(lastAll.filter(r => r.member === name));
  const avg = Math.round((w.sum(lastGroc) / lastGroc.length) * 100 + 1e-9) / 100;
  const net = round2(w.checkingBalance + w.investment - w.loan);
  const bill = [...w.bills].sort((a, b) => a.date.localeCompare(b.date))[0];
  const earliest=w.rows.map(r=>r.date).sort()[0],windowStart=new Date(w.now.getFullYear(),w.now.getMonth(),w.now.getDate()-90);
  const from=iso(windowStart)>earliest?iso(windowStart):earliest;
  const days=Math.max(1,Math.round((Date.UTC(w.now.getFullYear(),w.now.getMonth(),w.now.getDate())-Date.parse(from+"T00:00:00Z"))/86400000));
  const monthly=w.sum(w.spend(r=>r.date>=from&&r.date<=iso(w.now)))*30/days;
  const answer = (...checks) => ({ kind: "answer", problems: hasAll(...checks) });
  const scenario = (kind, ...headings) => ({ kind, headings, problems: text => (headings.some(h => text.includes(h)) ? [] : [`expected one of ${headings.map(h => `"${h}"`).join(" / ")}`]).concat(absent("Illustrative balance at", "You would save", "would add")(text)) });
  const E = {
    "how much did I spend on dining out in July": answer(has(money(w.sum(julyDining)), "Dining Out", purchases(julyDining.length), `July ${w.julyYear}`)),
    "how much did I spend at Whole Foods": answer(has(money(w.sum(wf)), "Whole Foods", purchases(wf.length), "since your records begin")),
    "what's my runway if rent goes up by $200": answer(has(`runway is ${(w.checkingBalance/monthly).toFixed(1)} months`, `goes up by $200.00/mo`, `drop to ${(w.checkingBalance/(monthly+200)).toFixed(1)} months`)),
    "how much do I have in checking": answer(has(`You have ${money(w.checkingBalance)} in checking.`)),
    "what's my net worth": answer(has(`Your net worth is ${money(net)}.`)),
    "what's my total debt": answer(has(`You owe ${money(w.loan)} in total.`)),
    "how much do I owe on car loan": answer(has(`You owe ${money(w.loan)} on Car Loan.`)),
    "how much are my subscriptions": answer(has(`about ${money(60)}/mo, across 2 recurring bills`)),
    "when is my next bill due": answer(has(`Your next bill is ${bill.merchant} for -${money(Math.abs(bill.amount))} on ${shortDate(bill.date)}.`)),
    "how much have I saved toward vacation": answer(has(`Vacation Fund has ${money(w.vacation.saved)} saved of its ${money(w.vacation.target)} target (50%).`)),
    "what's my savings rate this month": answer(has(`Your savings rate for this month is ${rate}% (${money(income)} income, ${money(w.sum(thisMonthSpend))} spent).`)),
    "compare this month to last month": answer(has(`You spent ${money(w.sum(thisMonthSpend))} in ${w.label(w.thisMonth)} so far and ${money(w.sum(lastAll))} in ${w.label(w.lastMonth)}.`)),
    "how much did I spend at Costco last month": answer(has(`You spent ${money(w.sum(lastCostco))} at Costco in ${w.label(w.lastMonth)}.`, purchases(lastCostco.length))),
    "everything except rent last month": answer(has(`You spent ${money(w.sum(lastNoRent))} on everything, excluding Rent, in ${w.label(w.lastMonth)}.`, purchases(lastNoRent.length))),
    "spending by month this year": answer(has(`You spent ${money(w.sum(yearSpend))} on everything in ${w.now.getFullYear()} so far.`, purchases(yearSpend.length))),
    "average purchase on groceries last month": answer(has(`You averaged ${money(avg)} per purchase on Groceries in ${w.label(w.lastMonth)}.`)),
    "what did each family member spend last month": answer(has(`You spent ${money(w.sum(lastAll))} on everything in ${w.label(w.lastMonth)}.`, `Not assigned to anyone${money(1500)}`, `Sam${money(member("Sam"))}`, `Robin${money(member("Robin"))}`)),
    "Where can I cut back to save $200 a month?": scenario("scenario", "Where would you like to cut back?", "Check these details", "Nothing has been calculated yet"),
    "Save $200 in total this year": scenario("scenario", "Where would you like to cut back?", "Check these details", "Nothing has been calculated yet"),
    "Extra $50 a month into Roth IRA until January 2056": scenario("scenario", "Use my saved plan", "Check these details", "A few details to confirm", "Nothing has been calculated yet"),
    "What if I cut Groceries by $50 a month?": scenario("scenario", "Check these details", "Where would you like to cut back?", "Nothing has been calculated yet"),
    "how much did I spend on groceries last month": answer(has(`You spent ${money(w.sum(lastGroc))} on Groceries in ${w.label(w.lastMonth)}.`, purchases(lastGroc.length))),
    "top 3 spending categories this year": answer(has(...byCat.map(([c, amount, n]) => `${c}${money(amount)}${purchases(n)}`))),
    "my three biggest expenses last month": answer(has(...biggest.map(r => `${r.description}${money(Math.abs(r.amount))}`))),
    "groceries last month without Costco": answer(has(money(w.sum(lastGroc) - w.sum(lastCostco)), purchases(lastGroc.length - lastCostco.length))),
  };
  return E;
}

/** Outcome class for a safe missing-entity run: no financial figure for an entity that does not exist. */
export function missingEntityProblems(text) {
  const problems = [];
  if (!/couldn.t find|no (?:matching |recorded )?(?:categor|store|merchant|account)|don.t (?:have|recognize)|not (?:found|in your)|which (?:categor|store)|try (?:a|the|an) (?:recorded|exact|category|store)/i.test(text)) problems.push("no explicit missing-entity guidance or relevant choice was shown");
  if (/\$\d[\d,]*\.\d\d/.test(text)) problems.push(`a figure was shown for something that is not in the profile: "${text.slice(0, 120)}"`);
  return problems;
}

/** The adapted m5c-022 question (compiledRetirementCase in src/askVault/retirementCompiledCorpus.ts): the frozen September 2026 month replaced by the app's current month. A unit test keeps the two equal. */
export const ADAPTED_M5C_022 = (now = new Date()) => `a one-time $500 deposit to my Roth IRA now, retiring ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
