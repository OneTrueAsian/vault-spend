// Ask the Vault M5 extra money into an investment account (README "Ask the Vault: extra money into an investment account"):
//   UAT-184 dates, UAT-185 the saved month is only an offer, UAT-187 returns the person confirms, UAT-191 today's dollars.
// Figures are checked against an independent calculation: deposits at the end of each month, a monthly rate of the yearly return / 12,
// balances shown to the nearest $1,000; today's dollars divide by (1 + inflation) ^ (months / 12). M5 IRA: recorded value $10,000, saved plan $200 a month at 7%, inflation 3%.
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose } from "./harness.mjs";
import { askHelpers, seedRetirementProfile, YEAR } from "./lib/askRetirement.mjs";

const dbDir = await seedRetirementProfile();
const app = await launchApp({ dbDir });
const b = app.browser, h = askHelpers(b);
const now = new Date();
const monthsTo = (year, month) => (year - now.getFullYear()) * 12 + (month - (now.getMonth() + 1));
const fv = (start, monthly, yearlyPct, n) => { const r = yearlyPct / 100 / 12; let bal = start; for (let i = 0; i < n; i++) { bal *= 1 + r; bal += monthly; } return bal; };
const today = (v, n, inflation = 3) => v / Math.pow(1 + inflation / 100, n / 12);
const money = s => Number(s.replace(/[$,]/g, ""));
/** The three figures of one assumption row of the result, as numbers. */
const row = async label => {
  const text = await b.execute(l => [...document.querySelectorAll('[role="dialog"] tr')].map(r => r.textContent.replace(/\s+/g, " ").trim()).find(t => t.startsWith(l)) ?? null, label);
  assert.ok(text, `a result row "${label}"`);
  const m = [...text.matchAll(/\$[\d,]+/g)].map(x => money(x[0]));
  assert.equal(m.length, 3, text);
  return { without: m[0], withExtra: m[1], difference: m[2] };
};
const near = (shown, exact, tolerance, what) => assert.ok(Math.abs(shown - exact) <= tolerance, `${what}: shown ${shown}, independent ${Math.round(exact)}`);
const setMonth = value => b.execute(v => {
  const el = document.querySelector('[role="dialog"] input[type=month]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
}, value);
const radio = async text => (await (await h.dialog()).$(`label*=${text}`)).click();
const n = monthsTo(YEAR, 1);
try {
  await b.setWindowSize(1280, 1300);
  await h.openDashboard();

  // --- UAT-184: the retirement month -----------------------------------------------------------------------------------------------------------
  await h.ask("Extra $50 a month into M5 IRA until January " + YEAR);
  await h.waitText("Use your saved plan?", "review");
  let t = await h.text();
  assert.ok(t.includes(`January ${YEAR} (${n} months from now)`), `a month in the question is read and counted: ${t}`);
  await h.clickButton("Close");
  await h.ask("Extra $50 a month into M5 IRA");
  await h.waitText("Which month do you plan to stop adding?", "the missing month is asked");
  assert.ok(!(await h.text()).includes("Illustrative balance"), "nothing is calculated without a month");
  await h.clickButton("Continue");
  await b.pause(500);
  assert.ok((await h.text()).includes("Which month do you plan to stop adding?"), "Continue without a month stays on the question");
  const earlier = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  await setMonth(`${earlier.getFullYear()}-${String(earlier.getMonth() + 1).padStart(2, "0")}`);
  await h.waitText("Choose a retirement month from this month on, within the next 100 years.", "a past month is refused");
  await setMonth(`${now.getFullYear() + 101}-01`);
  await h.waitText("Choose a retirement month from this month on, within the next 100 years.", "beyond 100 years is refused");
  await setMonth(`${YEAR}-03`);
  await h.clickButton("Continue"); await h.waitText("Use your saved plan?", "review with the typed month");
  t = await h.text();
  assert.ok(t.includes(`March ${YEAR} (${monthsTo(YEAR, 3)} months from now)`), `the typed month is counted: ${t}`);
  await h.clickButton("Close");

  // --- UAT-185: a saved month is offered, never chosen ------------------------------------------------------------------------------------------
  await h.bridgeWrite("set_investment_plan", { ...(await h.planArgs("M5 IRA", "7")), withdrawMonth: `${YEAR}-06` });
  await h.ask("Extra $50 a month into M5 IRA");
  await b.pause(1200);
  await h.waitText(`Use June ${YEAR}, from your plan`, "the saved month is offered");
  assert.ok(!(await h.text()).includes("Illustrative balance") && !(await h.text()).includes("Use your saved plan?"), "an offered month is not taken for the person");
  await h.clickButton(`Use June ${YEAR}, from your plan`);
  await h.waitText("Jun " + YEAR, "the offer fills the month field");
  assert.ok(!(await h.text()).includes("Use your saved plan?"), "taking the offer still needs Continue");
  await h.clickButton("Continue");
  await h.waitText("Use your saved plan?", "review once the offer is accepted");
  const nJune = monthsTo(YEAR, 6);
  assert.ok((await h.text()).includes(`June ${YEAR} (${nJune} months from now)`), await h.text());
  await h.clickButton("Close");
  await h.bridgeWrite("set_investment_plan", await h.planArgs("M5 IRA", "7")); // back to a plan without a saved month

  // --- UAT-187 / UAT-191: the confirmed plan return, in future dollars and in today's dollars -----------------------------------------------------------
  const start = 10000, current = 200, extra = 50;
  await h.ask("Extra $50 a month into M5 IRA until January " + YEAR);
  await h.waitText("Use your saved plan?", "review");
  t = await h.text();
  for (const needle of ["$10,000 (recorded)", "$50 each month, starting today", "$200 each month (saved in your plan)", "7% a year (saved in your plan)", "3% a year (saved)", "Future dollars (not adjusted for inflation)"]) assert.ok(t.includes(needle), `the review shows ${needle}: ${t}`);
  assert.ok(!t.includes("Illustrative balance"), "nothing is calculated until the plan is confirmed");
  await h.clickButton("Use my saved plan"); await h.waitText("Illustrative balance at", "result");
  t = await h.text();
  assert.ok(t.includes("Shown in future dollars, not adjusted for inflation.") && t.includes(`Illustrative balance at January ${YEAR}`), t);
  let none = await row("No investment growth");
  near(none.without, start + current * n, 500, "no growth, without the extra"); near(none.withExtra, start + (current + extra) * n, 500, "no growth, with the extra"); near(none.difference, extra * n, 500, "no growth, difference");
  let grown = await row("Using your confirmed plan return");
  near(grown.without, fv(start, current, 7, n), 500, "7%, without"); near(grown.withExtra, fv(start, current + extra, 7, n), 500, "7%, with"); near(grown.difference, fv(start, current + extra, 7, n) - fv(start, current, 7, n), 500, "7%, difference");
  assert.ok(t.includes(`Extra deposits: $${(extra * n).toLocaleString("en-US")}.00 in total (exact, before any growth).`), `exact extra deposits: ${t}`);
  // Other returns are the person's own choices, labelled as such.
  await h.clickButton("Explore other returns");
  await h.waitText("These are rates you choose.", "explore");
  const inputs = async () => (await h.dialog()).$$("input");
  const [lowIn, midIn, highIn] = await inputs();
  assert.deepEqual([await lowIn.getValue(), await midIn.getValue(), await highIn.getValue()], ["4", "7", "10"], "the other rates start around the confirmed one");
  await lowIn.setValue("4"); await highIn.setValue("10");
  await h.clickButton("Show these returns");
  await b.pause(1000);
  assert.ok((await h.text()).includes("Other returns, based on the rates you entered"), "the explored rates are labelled as the person's own");
  for (const pct of [4, 7, 10]) {
    const r = await row(`At ${pct}% a year`);
    near(r.without, fv(start, current, pct, n), 500, `${pct}%, without`); near(r.withExtra, fv(start, current + extra, pct, n), 500, `${pct}%, with`);
    near(r.difference, fv(start, current + extra, pct, n) - fv(start, current, pct, n), 500, `${pct}%, difference`);
  }
  await h.clickButton("Close");

  // Today's dollars, using the inflation the person confirms (3% saved in this profile).
  await h.ask("Extra $50 a month into M5 IRA until January " + YEAR);
  await h.waitText("Use your saved plan?", "review");
  await radio("Today's dollars");
  await h.clickButton("Use my saved plan"); await h.waitText("Illustrative balance at", "result in today's dollars");
  t = await h.text();
  assert.ok(t.includes("Shown in today's dollars, using 3% inflation a year for both figures."), t);
  none = await row("No investment growth");
  near(none.without, today(start + current * n, n), 500, "today's dollars, no growth, without"); near(none.withExtra, today(start + (current + extra) * n, n), 500, "today's dollars, no growth, with");
  near(none.difference, today(extra * n, n), 500, "today's dollars, no growth, difference");
  grown = await row("Using your confirmed plan return");
  near(grown.without, today(fv(start, current, 7, n), n), 500, "today's dollars, 7%, without"); near(grown.withExtra, today(fv(start, current + extra, 7, n), n), 500, "today's dollars, 7%, with");
  assert.ok(t.includes(`Extra deposits: $${(extra * n).toLocaleString("en-US")}.00 in total (exact, before any growth).`), "the exact deposits are never inflation-adjusted: " + t);
  await h.clickButton("Close");

  // --- UAT-187: no saved return: nothing is chosen for the person; deposits only, or a return they type ----------------------------------------------------
  await h.ask("Extra $50 a month into M5 No Plan until January " + YEAR);
  await h.waitText("What would you like to see?", "no saved return");
  t = await h.text();
  assert.ok(t.includes("No saved return was found, and I haven't picked one for you.") && t.includes("7% a year is the app's starting value, not a return you chose") && t.includes("No recorded amount. Enter your own, even if it is $0."), t);
  const addNow = async v => (await (await h.dialog()).$("label*=Amount you add now")).$("input").then(i => i.setValue(v)).catch(async () => (await (await h.dialog()).$$("input[type=text]"))[0].setValue(v));
  await h.clickButton("Show the balance with no investment growth");
  await b.pause(500);
  assert.ok(!(await h.text()).includes("Illustrative balance"), "the amount added now must be entered first: " + (await h.text()).slice(-250));
  await addNow("0");
  await h.clickButton("Show the balance with no investment growth"); await h.waitText("Illustrative balance at", "deposits only");
  t = await h.text();
  assert.ok(!t.includes("confirmed plan return") && !t.includes("a year ("), "no return is shown that the person did not choose: " + t);
  none = await row("No investment growth");
  near(none.without, 5000, 500, "No Plan, no growth, without the extra"); near(none.withExtra, 5000 + extra * n, 500, "No Plan, no growth, with the extra");
  await h.clickButton("Close");
  await h.ask("Extra $50 a month into M5 No Plan until January " + YEAR);
  await h.waitText("What would you like to see?", "no saved return, asked again");
  await addNow("0");
  await h.clickButton("Choose a return assumption");
  await (await h.dialog()).$("label*=Return you choose").then(l => l.$("input")).then(i => i.setValue("5")).catch(async () => (await (await h.dialog()).$$("input[type=text]")).at(-1).setValue("5"));
  await h.clickButton("Use this return"); await h.waitText("Illustrative balance at", "own return result");
  t = await h.text();
  assert.ok(t.includes("Using your confirmed plan return (5% a year)"), "the return the person typed is the one used: " + t);
  grown = await row("Using your confirmed plan return");
  near(grown.without, fv(5000, 0, 5, n), 500, "typed 5%, without"); near(grown.withExtra, fv(5000, extra, 5, n), 500, "typed 5%, with");
  console.log("FEATURE 349 PASSED: retirement month (typed, offered, refused), the saved month as an offer only, confirmed and typed returns and today's dollars against an independent calculation.");
} finally { await app.close(); }
