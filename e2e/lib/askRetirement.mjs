// Shared steps for the Ask the Vault retirement specs (feature305, feature306): a seeded profile, and the question,
// dialog and focus helpers they both use.
import assert from "node:assert/strict";
import { seedFixture } from "./seed.mjs";
import { invoke } from "./change-password.mjs";
import { withAskReady } from "./askReady.mjs";

export const YEAR = new Date().getFullYear() + 30;
export const QUESTION = (name = "M5 IRA") => `How much would an extra $50 a month into ${name} until January ${YEAR} add?`;
export const QUESTION_NO_ACCOUNT = "extra $50 a month for retirement";
/** A real question the calculator refuses after consent (the corpus case m5c-027): a typed 100% return to October 2100 gives a balance too large to hold exactly. */
export const QUESTION_REFUSED = (name = "M5 IRA") => `extra $100 a month into ${name} until October 2100 at 100%`;
/** The same refusal reached without typing a return: the account's own stored plan return is 100%, so nothing typed in the question can be what is carried into a recovery. */
export const QUESTION_REFUSED_STORED = (name = "Roth IRA") => `How much would an extra $100 a month into ${name} until October 2100 add?`;
export const REFUSAL_MESSAGE = "I couldn't calculate a balance accurately with these details. Choose \"Change the details\" to revise them.";
export const LONG_NAME = "M5 Long Name Investment Account for retirement savings with a very long label that keeps going past the usual width of a button or a menu";
export const NEAR_NAME_A = "M5 Brokerage";
export const NEAR_NAME_B = "M5 Brokerage 2";

/** One profile with every account shape the screens need: a full plan, no saved return, no recorded value, no contribution basis, long and near-duplicate names. */
export function seedRetirementProfile(extraPython = "") {
  return seedFixture(String.raw`
def investment(name, holdings=None, plan=None):
    cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES(?,'investment','0')", (name,))
    account = cur.lastrowid
    if holdings:
        cur.execute("INSERT INTO holdings(account_id,symbol,name,shares,price,cost_basis) VALUES(?,?,?,?,?,'0')", (account, name[:4].upper().replace(' ', 'X'), 'fixture', holdings[0], holdings[1]))
    if plan:
        cur.execute("INSERT INTO investment_plans(account_id,monthly_contribution,annual_return_pct) VALUES(?,?,?)", (account, plan[0], plan[1]))
    return account
investment('M5 IRA', ('100', '100'), ('200', '7'))
investment('M5 No Plan', ('50', '100'), None)
investment('M5 No Value')
investment('M5 No Contribution', ('20', '100'), (None, '7'))
investment(${JSON.stringify(LONG_NAME)}, ('10', '100'), ('100', '5'))
investment(${JSON.stringify(NEAR_NAME_A)}, ('10', '100'), ('100', '5'))
investment(${JSON.stringify(NEAR_NAME_B)}, ('10', '100'), ('100', '5'))
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('M5 Checking','checking','1000')")
cur.execute("UPDATE app_settings SET inflation_pct='3' WHERE id=1")
${extraPython}
`);
}

/** Two investment accounts for the numeric-refusal specs: "Roth IRA" ($10,000, saved plan return 100%, so a question to October 2100 is refused) and "Brokerage" ($25,000, saved plan 7%); $200 a month planned in both. */
export function seedRefusalProfile() {
  return seedFixture(String.raw`
for name, shares, plan, pct in (("Roth IRA", "100", "200", "100"), ("Brokerage", "250", "200", "7")):
    cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES(?,'investment','0')", (name,))
    account = cur.lastrowid
    cur.execute("INSERT INTO holdings(account_id,symbol,name,shares,price,cost_basis) VALUES(?,?,?,?,?,'0')", (account, name[:3].upper(), 'fixture', shares, '100'))
    cur.execute("INSERT INTO investment_plans(account_id,monthly_contribution,annual_return_pct) VALUES(?,?,?)", (account, plan, pct))
cur.execute("UPDATE app_settings SET inflation_pct='3' WHERE id=1")
`);
}

/** Every time the question field held something other than the intended text after typing (see ask). Empty on a clean run. */
export const typingMismatches = [];

export function askHelpers(b) {
  const dialog = () => b.$('[role="dialog"]');
  const dialogOpen = () => dialog().isExisting();
  const text = async () => (await dialog()).getText();
  const openDashboard = async () => {
    await (await b.$(".nav-item[data-tab=dashboard]")).click();
    await (await b.$(".ledger-qa-card input")).waitForExist({ timeout: 10000 });
  };
  async function ask(question) {
    await withAskReady(b, async () => {});
    const input = await b.$(".ledger-qa-card input");
    await input.click();
    await b.execute(el => { el.select(); }, input);
    await input.setValue(question);
    // Intermittent failures of the same question (a refusal, or no dialog at all) fit text that arrived damaged. The field must hold exactly what was meant; a mismatch
    // is typed again and counted, so it is visible in the output instead of looking like a product refusal.
    for (let attempt = 1; (await input.getValue()) !== question; attempt++) {
      typingMismatches.push({ question, got: await input.getValue(), attempt });
      console.log(`[askRetirement] the field held "${typingMismatches.at(-1).got}" instead of the question (attempt ${attempt}); typing it again`);
      assert.ok(attempt < 3, `the question could not be typed intact: "${await input.getValue()}"`);
      await b.execute(el => { el.select(); }, input); await input.setValue(question);
    }
    await withAskReady(b, async () => {
      assert.equal(await (await b.$(".ledger-qa-card input")).getValue(), question, "the current ready card must retain the intended question");
      await (await (await b.$(".ledger-qa-card")).$("button=Ask")).click();
    });
  }
  async function waitText(fragment, label, timeout = 10000) {
    try {
      await b.waitUntil(async () => (await dialogOpen()) && (await text()).includes(fragment), { timeout });
    } catch {
      // Read at the moment of failure: a message built before waiting would describe the screen as it was before the wait began.
      throw new Error(`${label}: the dialog should say "${fragment}"; it says "${(await dialogOpen()) ? await text() : "(no dialog)"}"`);
    }
  }
  async function clickButton(label) {
    const button = await (await dialog()).$(`button=${label}`);
    await button.waitForExist({ timeout: 8000, timeoutMsg: `no "${label}" button in: ${await text()}` });
    await button.click();
  }
  async function closeDialog() {
    await clickButton("Close");
    await b.waitUntil(async () => !(await dialogOpen()), { timeout: 5000, timeoutMsg: "Close should end the flow" });
  }
  const focusOnQuestion = () => b.execute(() => document.activeElement === document.querySelector(".ledger-qa-card input"));
  const accountId = async name => (await invoke(b, "list_accounts")).ok.find(a => a.name === name).id;
  /** Written through the bridge directly, so the app's own code never sees it: only the native revision can reveal it. */
  const bridgeWrite = (command, args) => invoke(b, command, args);
  /** Written through the app's own invoke (a debug build exposes it), so it is announced like any write the app makes itself. */
  async function inAppWrite(command, args) {
    const result = await b.executeAsync((command, args, done) => {
      const hook = window.__vaultspendDebug;
      if (!hook) return done({ error: "this build has no debug hook (build with `tauri build --debug`)" });
      hook.invoke(command, args).then(v => done({ ok: v ?? null }), e => done({ error: String(e) }));
    }, command, args);
    assert.ok(!result.error, result.error);
    return result.ok;
  }
  const planArgs = async (name, returnPct) => ({ accountId: await accountId(name), monthlyContribution: "200", annualReturnPct: returnPct, withdrawMonth: null, withdrawYears: null, inflationPct: null });
  async function toResult(name = "M5 IRA") {
    await ask(QUESTION(name)); await waitText("Use my saved plan", "review");
    await clickButton("Use my saved plan"); await waitText("Illustrative balance at", "result");
  }
  return { dialog, dialogOpen, text, openDashboard, ask, waitText, clickButton, closeDialog, focusOnQuestion, accountId, bridgeWrite, inAppWrite, planArgs, toResult };
}
