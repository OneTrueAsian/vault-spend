import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { chooseStyle, launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { invoke } from "./lib/change-password.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";

// M5 acceptance in the compiled app: the Ask card takes a question about extra money into one investment account through
// choices, a review of the saved plan, a re-read bound to the reviewed revision, and a result. It must retire itself on an
// in-app write, on a window focus that finds a change, on a silent change before consent, and on lock; it must never persist
// the question, never write anything, and stay readable in every style.
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const YEAR = new Date().getFullYear() + 30;
const QUESTION = `How much would an extra $50 a month into M5 IRA until January ${YEAR} add?`;
const PASSWORD = "m5 retirement flow password";

const dbDir = await seedFixture(String.raw`
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('M5 IRA','investment','0')")
ira = cur.lastrowid
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('M5 Other','investment','0')")
cur.execute("INSERT INTO accounts(name,account_type,starting_balance) VALUES('M5 Checking','checking','1000')")
cur.execute("INSERT INTO holdings(account_id,symbol,name,shares,price,cost_basis) VALUES(?,'FAKE','fixture','100','100','0')",(ira,))
cur.execute("INSERT INTO investment_plans(account_id,monthly_contribution,annual_return_pct) VALUES(?,'200','7')",(ira,))
cur.execute("UPDATE app_settings SET inflation_pct='3' WHERE id=1")
`);
const app = await launchApp({ dbDir });
const b = app.browser;
const failures = [];
const text = async () => (await (await b.$('[role="dialog"]')).getText());
const dialogOpen = () => b.$('[role="dialog"]').isExisting();
async function openDashboard() {
  await (await b.$(".nav-item[data-tab=dashboard]")).click();
  await (await b.$(".ledger-qa-card input")).waitForExist({ timeout: 10000 });
}
async function ask(question) {
  const input = await b.$(".ledger-qa-card input");
  await input.click();
  await b.execute(el => { el.select(); }, input);
  await input.setValue(question);
  // The field must hold exactly what was meant (see lib/askRetirement.mjs): damaged text would look like a product refusal. A mismatch is typed again and printed.
  for (let attempt = 1; (await input.getValue()) !== question; attempt++) {
    console.log(`[feature304] the field held "${await input.getValue()}" instead of the question (attempt ${attempt}); typing it again`);
    assert.ok(attempt < 3, `the question could not be typed intact: "${await input.getValue()}"`);
    await b.execute(el => { el.select(); }, input); await input.setValue(question);
  }
  await (await (await b.$(".ledger-qa-card")).$("button=Ask")).click();
}
async function waitText(fragment, label, timeout = 10000) {
  try { await b.waitUntil(async () => (await dialogOpen()) && (await text()).includes(fragment), { timeout }); }
  catch { throw new Error(`${label}: the dialog should say "${fragment}"; it says "${(await dialogOpen()) ? await text() : "(no dialog)"}"`); }
}
async function clickButton(label) {
  const button = await (await b.$('[role="dialog"]')).$(`button=${label}`);
  await button.waitForExist({ timeout: 8000, timeoutMsg: `no "${label}" button` });
  await button.click();
}
const accountId = async () => (await invoke(b, "list_accounts")).ok.find(a => a.name === "M5 IRA").id;
const planArgs = async (returnPct) => ({ accountId: await accountId(), monthlyContribution: "200", annualReturnPct: returnPct, withdrawMonth: null, withdrawYears: null, inflationPct: null });
/** Written through the bridge directly, so the app's own code never sees it: only the native revision can reveal it. */
const silentWrite = (command, args) => invoke(b, command, args);
const focusWindow = () => b.execute(() => window.dispatchEvent(new Event("focus")));
async function closeAndCheckFocus() {
  await clickButton("Close");
  await b.waitUntil(async () => !(await dialogOpen()), { timeout: 5000, timeoutMsg: "Close should end the flow" });
  const focused = await b.execute(() => document.activeElement === document.querySelector(".ledger-qa-card input"));
  assert.ok(focused, "after closing, focus returns to the question field");
}
async function toResult() {
  await ask(QUESTION);
  await waitText("M5 IRA", "review");
  assert.ok(!(await text()).includes("Illustrative balance"), "nothing is calculated before consent");
  await clickButton("Use my saved plan");
  await waitText("Illustrative balance at", "result");
}

try {
  await openDashboard();

  // 1. Question -> review -> consent -> result, with the date the question gave.
  await toResult();
  const result = await text();
  assert.ok(result.includes(`January ${YEAR}`), `the result names the retirement month: ${result}`);
  assert.ok(!/expected (range|return)|guarantee|probab|worst|best case/i.test(result), "no forecast wording");
  assert.ok(await b.execute(() => document.activeElement && document.querySelector('[role="dialog"]').contains(document.activeElement)), "focus is inside the dialog");

  // 2. Nothing about the question or the result is kept by the browser.
  const leaked = await b.execute(async (question) => {
    const found = [];
    const look = (where, value) => { if (value && (value.includes(question) || value.includes("M5 IRA"))) found.push(where); };
    for (const store of [localStorage, sessionStorage]) for (let i = 0; i < store.length; i++) look("storage", store.key(i) + "=" + store.getItem(store.key(i)));
    look("address", location.href); look("title", document.title);
    if (indexedDB.databases) for (const d of await indexedDB.databases()) look("indexedDB", d.name ?? "");
    return found;
  }, QUESTION);
  assert.deepEqual(leaked, [], "nothing is persisted");
  // Changing the details asks for the account again, and drops the result at once.
  await clickButton("Change the details");
  await waitText("Nothing has been calculated yet", "choices after Change the details");
  const again = await text();
  assert.ok(again.includes("M5 IRA") && again.includes("M5 Other") && !again.includes("Illustrative balance"), `the account is asked again and the result is gone: ${again}`);
  await closeAndCheckFocus();

  // 3. A change made outside the app's own code (the notification is covered by unit tests: Tauri's bridge cannot be driven from here without bypassing it) is caught when the window regains focus.
  await toResult();
  assert.ok((await silentWrite("set_investment_plan", await planArgs("5"))).ok !== undefined);
  await focusWindow();
  await waitText("Your details changed", "stale after focus");
  await closeAndCheckFocus();

  // 4. A change before consent is caught by the re-read; nothing is calculated.
  await ask(QUESTION); await waitText("M5 IRA", "review again");
  assert.ok((await silentWrite("set_investment_plan", await planArgs("4"))).ok !== undefined);
  await clickButton("Use my saved plan");
  await waitText("Your details changed", "stale at consent");
  assert.ok(!(await text()).includes("Illustrative balance"), "no figure after a failed re-read");
  await closeAndCheckFocus();

  // 5. Restart after a stale card asks the same question against the live plan.
  await ask(QUESTION); await waitText("M5 IRA", "review");
  await silentWrite("set_investment_plan", await planArgs("3"));
  await focusWindow(); await waitText("Your details changed", "stale");
  await clickButton("Try again"); await waitText("Use my saved plan", "fresh review after Try again");
  await clickButton("Use my saved plan"); await waitText("Illustrative balance at", "result after restart");
  await closeAndCheckFocus();

  // 6. A question without an account asks which one; the roster is the native one.
  await ask("extra $50 a month for retirement");
  await waitText("Nothing has been calculated yet", "choices");
  const choices = await text();
  assert.ok(choices.includes("M5 IRA") && choices.includes("M5 Other") && !choices.includes("M5 Checking"), `only investment accounts are offered: ${choices}`);
  await clickButton("Close");

  // 6b. M6 (owner decision D-S3-01): "Save ..." into a named investment account asks whether the money is extra, reads nothing, and Yes enters this same flow.
  await ask(`Save $50 a month into M5 IRA until January ${YEAR}`);
  const clarifyBox = await b.$(".ledger-qa-clarify");
  await clarifyBox.waitForExist({ timeout: 8000, timeoutMsg: "a plain save phrase into an investment account should ask whether the money is extra" });
  const clarifyText = await clarifyBox.getText();
  assert.ok(clarifyText.includes("Do you mean adding an extra $50 a month to this account?"), `the owner's question is asked: ${clarifyText}`);
  assert.ok(!(await dialogOpen()), "no dialog and nothing calculated before the answer");
  await (await clarifyBox.$("button=Yes, add an extra $50 a month")).click();
  await waitText("M5 IRA", "review after answering Yes");
  assert.ok(!(await text()).includes("Illustrative balance"), "nothing is calculated before consent");
  assert.equal(await b.execute(() => document.querySelector(".ledger-qa-card input").value), `Extra $50 a month into M5 IRA until January ${YEAR}`, "the answer asks the same question with only the lead-in replaced");
  await clickButton("Close");

  // 7. Routing: an ordinary spending question is not taken by the retirement flow.
  await ask("how much did I spend on groceries last month");
  await b.waitUntil(async () => !(await dialogOpen()), { timeout: 8000 });
  assert.ok(!(await (await b.$(".ledger-qa-card")).getText()).includes("Illustrative balance"));

  // 8. Every style, light and dark: the review and the result read well (Axe, WCAG A and AA) and fit the window.
  for (const [label, palette] of [["Default", "transparent"], ["Futuristic", "futuristic"], ["Retro", "retro"]]) {
    await chooseStyle(b, label, palette);
    for (const mode of ["light", "dark"]) {
      await b.execute(m => { const group = document.querySelector('.theme-toggle[aria-label="Theme"]'); [...group.querySelectorAll("button")].find(x => x.textContent.trim().toLowerCase() === m).click(); }, mode);
      await openDashboard();
      await ask(QUESTION); await waitText("Use my saved plan", `${label}/${mode} review`);
      for (const [state, advance] of [["review", async () => clickButton("Use my saved plan")], ["result", null]]) {
        // Let colour transitions finish (a button appearing under a resting pointer is mid-hover for a moment) before measuring contrast.
        await (await b.$("body")).moveTo({ xOffset: 2, yOffset: 2 }); await b.pause(600);
        await b.execute(AXE);
        const nodes = await b.executeAsync((done) => window.axe.run({ include: [['[role="dialog"]']] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })
          .then(r => done(r.violations.flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(" ")} — ${n.any[0]?.data?.fgColor ?? ""} on ${n.any[0]?.data?.bgColor ?? ""} at ${n.any[0]?.data?.contrastRatio ?? ""}`))))
          .catch(e => done([`axe failed: ${String(e)}`])));
        for (const n of nodes) failures.push(`${label}/${mode} ${state}: ${n}`);
        const fit = await b.execute(() => { const d = document.querySelector('[role="dialog"]'); const r = d.getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1, overflowX: d.scrollWidth > d.clientWidth + 1 }; });
        if (!fit.inside || fit.overflowX) failures.push(`${label}/${mode} ${state}: the dialog does not fit the window ${JSON.stringify(fit)}`);
        if (advance) { await advance(); await waitText("Illustrative balance at", `${label}/${mode} result`); }
      }
      await clickButton("Close");
    }
  }
  await chooseStyle(b, "Default", "transparent");
  assert.deepEqual(failures, [], `style, contrast and fit problems:\n${failures.join("\n")}`);

  // 9. Locking removes everything: no dialog, no figures, no question after unlocking.
  await (await b.$("button*=Settings")).click();
  await enableProtectionThroughUI(b, PASSWORD);
  await b.waitUntil(async () => (await b.$(".page").getText()).includes("Password protection: On"), { timeout: 15000 });
  await openDashboard();
  await toResult();
  assert.equal((await invoke(b, "debug_apply_system_session_event", { event: "locked" })).ok, true);
  await b.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  assert.ok(!(await b.execute(() => document.body.textContent.includes("Illustrative balance"))), "no figure on the lock screen");
  await b.$("#password-form-field").setValue(PASSWORD); await b.$("button=Unlock").click();
  await b.$(".brand-word").waitForExist({ timeout: 10000 });
  await openDashboard();
  assert.ok(!(await dialogOpen()), "no dialog after unlocking");
  assert.ok(!(await b.execute(() => document.body.textContent.includes("Illustrative balance"))), "no figure after unlocking");
  assert.equal(await b.execute(() => document.querySelector(".ledger-qa-card input").value), "", "the question is gone");

  console.log("FEATURE 304 M5 COMPILED QUESTION-TO-RESULT FLOW PASSED");
} finally { await app.close(); }
