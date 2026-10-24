import assert from "node:assert/strict";
import fs from "node:fs";
import { launchApp, reclaimWindowFocus } from "./harness.mjs";
import { askHelpers, QUESTION_REFUSED, QUESTION_REFUSED_STORED, REFUSAL_MESSAGE, seedRefusalProfile } from "./lib/askRetirement.mjs";

// M5 numeric-refusal recovery in the compiled app (task item 2). A real question that the calculator refuses after consent (the corpus case m5c-027: a typed 100% return to
// October 2100) reaches the "A few details need attention" card. Its "Change the details" must reopen the choices for account, amount, cadence and month
// (Content-Flow.md:50; Requirements-Checklist.md:150), and the revised terms must reach the calculator: every balance the screen then shows is compared with a closed-form
// calculation made here, independently of the app, using the display rounding rule of src/askVault/retirementScenarioMath.ts:68 (nearest 1,000 from 10,000, nearest 100 from
// 1,000, else nearest 10). Editing the amount or the cadence and asking again must move the shown figures as that calculation says. Evidence class: COMPILED (real app, real calculator).
const SHOTS = process.env.VS_M5_SHOTS;
const dbDir = await seedRefusalProfile();
const app = await launchApp({ dbDir });
const b = app.browser, h = askHelpers(b);
const evidence = {};
const shoot = async name => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await b.saveScreenshot(`${SHOTS}/feature309-${name}.png`); } };

// ---- The independent calculation (not the app's code): closed-form growth, and the documented display rounding. ---------------------------------------------------
const step = x => (Math.abs(x) >= 10000 ? 1000 : Math.abs(x) >= 1000 ? 100 : 10);
const rounded = x => Math.round(x / step(x)) * step(x);
const money = x => `$${rounded(x).toLocaleString("en-US")}`;
const balance = (value, monthly, pct, months, once = 0) => { const i = pct / 1200, f = (1 + i) ** months, annuity = i === 0 ? months : (f - 1) / i; return (value + once) * f + monthly * annuity; };
/** What the result must show for Brokerage ($25,000; $200 a month planned; stored 7%) after `n` months with an extra. */
function expectedFigures({ monthly = 0, once = 0, n, pct = 7 }) {
  const V = 25000, C = 200;
  const noGrowthWithout = V + n * C, noGrowthWith = V + n * (C + monthly) + once, planWithout = balance(V, C, pct, n), planWith = balance(V, C + monthly, pct, n, once);
  // The differences are rounded on their own (the app rounds the exact difference, not the difference of rounded figures).
  return { noGrowthWithout, noGrowthWith, planWithout, planWith, noGrowthDifference: noGrowthWith - noGrowthWithout, planDifference: planWith - planWithout };
}

const clickPrimary = async () => { const buttons = await (await h.dialog()).$$(".modal-actions button"); const last = buttons[buttons.length - 1]; await last.waitForEnabled({ timeout: 8000 }); await last.click(); };
const chooseOption = text => b.execute(t => { const label = [...document.querySelectorAll('[role="dialog"] label.scenario-option')].find(l => l.textContent.trim() === t); if (!label) throw new Error(`no option "${t}"`); label.querySelector("input").click(); }, text);
const setAmount = async value => { const input = await b.$('//div[@role="dialog"]//label[span[text()="Extra amount (dollars)"]]//input'); await input.click(); await input.setValue(value); };
const setMonth = value => b.execute(v => { const input = document.querySelector('[role="dialog"] input[type=month]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); }, value);
const nextYearSameMonth = async () => b.execute(() => { const d = new Date(); return `${d.getFullYear() + 1}-${String(d.getMonth() + 1).padStart(2, "0")}`; });

/** Every figure in `expected` must be on the screen: balances as "$N", differences as "$N more" (or "less than $10 more"). */
function assertShown(text, expected, what) {
  for (const [key, x] of Object.entries(expected)) {
    const wanted = key.endsWith("Difference") ? (rounded(x) === 0 ? "less than $10 more" : `${money(x)} more`) : money(x);
    assert.ok(text.includes(wanted), `${what}: ${key} should show "${wanted}" (exact ${x.toFixed(4)}); the result says: ${text}`);
  }
}

/** Refuse, then recover by the real controls: Change the details, account, amount, cadence, month, review, consent. Returns the result text. */
async function recover({ amount, cadence, month, reviewReady = "Use my saved plan", reviewMustSay = [] }) {
  await h.clickButton("Change the details"); await h.waitText("Nothing has been calculated yet", "Change the details reopens the choices");
  await chooseOption("Brokerage"); await setAmount(amount); await chooseOption(cadence === "once" ? "Just once" : "Every month");
  await h.clickButton("Continue"); await h.waitText("Retirement month", "the month is asked once the account is known");
  await setMonth(month); await h.clickButton("Continue"); await h.waitText(reviewReady, "a fresh review of the revised terms");
  const review = await h.text();
  assert.ok(review.includes("Brokerage") && !review.includes("Roth IRA"), `the review is for the new account only: ${review}`);
  for (const fragment of reviewMustSay) assert.ok(review.includes(fragment), `the review must say "${fragment}" before consent: ${review}`);
  await clickPrimary(); await h.waitText("Illustrative balance at", "the result of the revised terms");
  return h.text();
}

try {
  await h.openDashboard();
  await reclaimWindowFocus(b);

  // ---- 1. A real numeric refusal: clear wording, no balance, the card's controls. -------------------------------------------------------------------------------
  // The Roth IRA's own saved plan return is 100% and the question types no return, so nothing typed can be what carries into the recovery below.
  await h.ask(QUESTION_REFUSED_STORED("Roth IRA")); await h.waitText("Use my saved plan", "review of the question the calculator will refuse");
  await clickPrimary(); await h.waitText("A few details need attention", "numeric refusal");
  const refused = await h.text();
  assert.ok(refused.includes(REFUSAL_MESSAGE), `the refusal says why: ${refused}`);
  assert.ok(!/Illustrative balance|\$\d[\d,]{4,}/i.test(refused), `no balance is fabricated for a refused calculation: ${refused}`);
  assert.ok(refused.includes("Nothing was calculated"), "the card says nothing was calculated");
  const controls = await b.execute(() => [...document.querySelectorAll('[role="dialog"] button')].map(x => x.textContent.trim()));
  assert.deepEqual(controls, ["Close", "Change the details"], "the card offers Close and Change the details");
  assert.ok(await b.execute(() => !!document.querySelector('[role="dialog"] [role="alert"]')), "the refusal is announced as an alert");
  await shoot("refused"); evidence.refusal = "REAL: a stored 100% plan return to October 2100 refused after consent; wording present, no balance, Close and Change the details offered";

  // ---- 2. Recovery with revised terms: Brokerage, $100 every month, 12 months. Every figure on the result is the independent calculation's. -----------------------------
  const month = await nextYearSameMonth();
  const first = await recover({ amount: "100", cadence: "monthly", month });
  const a = expectedFigures({ monthly: 100, n: 12 });
  assertShown(first, a, "$100 a month for 12 months");
  assert.ok(first.includes("Extra deposits: $1,200.00"), `the exact extra deposits (12 x $100) are shown: ${first}`);
  assert.ok(first.includes("Brokerage") && !first.includes("Roth IRA"), "nothing from the refused account is on the result");
  await shoot("recovered-100-monthly");

  // ---- 3. Edit the amount: $300 every month. The shown figures must move exactly as the independent calculation says (and differ from the $100 figures). ----------------------
  const triple = await recover({ amount: "300", cadence: "monthly", month });
  const t = expectedFigures({ monthly: 300, n: 12 });
  assertShown(triple, t, "$300 a month for 12 months");
  assert.ok(triple.includes("Extra deposits: $3,600.00"), "the exact extra deposits follow the edited amount (12 x $300)");
  assert.notEqual(money(a.planWith), money(t.planWith), "the two edits are distinguishable on the screen");
  assert.ok(!triple.includes("Extra deposits: $1,200.00"), "the earlier edit's exact deposits are not shown after the amount was edited");
  await shoot("recovered-300-monthly");

  // ---- 4. Edit the cadence: one $500 deposit now instead. ---------------------------------------------------------------------------------------------------------------
  const once = await recover({ amount: "500", cadence: "once", month });
  const o = expectedFigures({ once: 500, n: 12 });
  assertShown(once, o, "one $500 deposit");
  assert.ok(once.includes("Extra deposits: $500.00"), "the exact extra deposits are the one deposit");
  evidence.recovery = { monthly100: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, money(v)])), monthly300: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, money(v)])), once500: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, money(v)])) };

  // ---- 5. Another month: 24 months, not 12. -------------------------------------------------------------------------------------------------------------------------
  const longer = await b.execute(() => { const d = new Date(); return `${d.getFullYear() + 2}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const two = await recover({ amount: "100", cadence: "monthly", month: longer });
  const l = expectedFigures({ monthly: 100, n: 24 });
  assertShown(two, l, "$100 a month for 24 months");
  assert.ok(two.includes("Extra deposits: $2,400.00"), "24 months of $100");

  // ---- 6. The corpus question itself (a TYPED 100% return). "Change the details" re-asks account, amount, cadence and month; what the question itself said (the return) is kept, as it
  // always was for an edited result. The review must therefore say 100% before consent, and the figures must follow it. (Flagged for the owner in the report.)
  await h.closeDialog();
  await h.ask(QUESTION_REFUSED("Roth IRA")); await h.waitText("Retirement month", "review of the typed-return question");
  await clickPrimary(); await h.waitText("A few details need attention", "numeric refusal of the typed 100% return");
  const typed = await recover({ amount: "100", cadence: "monthly", month, reviewReady: "Retirement month", reviewMustSay: ["100%"] });
  assertShown(typed, expectedFigures({ monthly: 100, n: 12, pct: 100 }), "$100 a month for 12 months at the typed 100%");
  assert.ok(typed.includes("100% a year"), `the result states the return it used: ${typed}`);
  evidence.typedReturn = "the typed 100% is kept across Change the details, stated on the review before consent, and the figures follow it";
  await h.closeDialog();

  fs.writeFileSync(process.env.VS_M5_EVIDENCE_309 ?? `${process.env.TEMP ?? "."}/feature309-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log("FEATURE 309 M5 NUMERIC-REFUSAL RECOVERY PASSED");
  console.log(JSON.stringify(evidence));
} finally { await app.close(); }
