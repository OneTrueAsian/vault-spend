import assert from "node:assert/strict";
import fs from "node:fs";
import { launchApp, openSettingsGroup } from "./harness.mjs";
import { invoke } from "./lib/change-password.mjs";
import { askHelpers, QUESTION, QUESTION_NO_ACCOUNT, seedRetirementProfile } from "./lib/askRetirement.mjs";

// M5 lifecycle and privacy acceptance in the compiled app. Evidence classes are kept apart in the output:
//   REAL IN-APP WRITE   a write made through the app's own invoke (the debug build's hook) retires every open state at once;
//   (real OS focus changes are in feature307: a spec that deliberately takes OS foreground cannot share a parallel run with other windows)
//   REAL PROFILE SWITCH the production profile switcher handler, with the dialog mounted (a DOM click bypasses overlay hit-testing, not app logic);
//   PRIVACY             every request the page makes during the flow, and every native command it invokes.
const SHOTS = process.env.VS_M5_SHOTS;
const dbDir = await seedRetirementProfile();
const app = await launchApp({ dbDir });
const b = app.browser;
const h = askHelpers(b);
const evidence = {};
const shoot = async name => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await b.saveScreenshot(`${SHOTS}/feature306-${name}.png`); } };

try {
  await h.openDashboard();

  // Record every request the page makes (fetch, XHR, beacons, sockets) and every native command it invokes, from now on.
  await b.execute(() => {
    window.__m5Requests = []; window.__m5Blur = 0; window.__m5Focus = 0;
    const note = url => window.__m5Requests.push(String(url));
    const realFetch = window.fetch.bind(window); window.fetch = (input, init) => { note(input instanceof Request ? input.url : input); return realFetch(input, init); };
    const open = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (method, url) { note(url); return open.apply(this, arguments); };
    const beacon = navigator.sendBeacon?.bind(navigator); if (beacon) navigator.sendBeacon = (url, data) => { note(url); return beacon(url, data); };
    const Socket = window.WebSocket; window.WebSocket = function (url, protocols) { note(url); return new Socket(url, protocols); }; window.WebSocket.prototype = Socket.prototype;
    window.addEventListener("blur", () => window.__m5Blur++); window.addEventListener("focus", () => window.__m5Focus++);
  });

  // ---- COMPILED: a named account whose question gives no month is read first; its saved month is offered as an unselected, one-click candidate. ----------------
  const savedYear = new Date().getFullYear() + 30;
  await h.bridgeWrite("set_investment_plan", { ...(await h.planArgs("M5 IRA", "7")), withdrawMonth: `${savedYear}-06` });
  await h.ask("How much would an extra $50 a month into M5 IRA add?");
  await h.waitText(`Use June ${savedYear}, from your plan`, "the saved month is offered as a candidate");
  const candidate = await b.execute(() => ({ primaryDisabled: [...document.querySelectorAll('[role="dialog"] .modal-actions button')].pop()?.disabled === true, monthFilled: [...document.querySelectorAll('[role="dialog"] input[type="month"]')].some(i => i.value !== "") }));
  assert.equal(candidate.monthFilled, false, "the saved month is not selected for the person");
  assert.equal(candidate.primaryDisabled, true, "nothing can continue until a month is chosen");
  await shoot("saved-month-candidate");
  await h.closeDialog();
  await h.bridgeWrite("set_investment_plan", await h.planArgs("M5 IRA", "7")); // the plan as the other sections expect it (no saved month)
  evidence.savedMonthCandidate = "COMPILED: named account, month missing: the saved month is an unselected one-click candidate and nothing continues until a month is chosen";

  // ---- COMPILED: a saved month beyond the supported range stays saved evidence: the account still reads, nothing is offered, the limit is explained. ----------------
  await h.bridgeWrite("set_investment_plan", { ...(await h.planArgs("M5 IRA", "7")), withdrawMonth: "2101-01" });
  await h.ask("How much would an extra $50 a month into M5 IRA add?");
  await h.waitText("Your plan has a saved retirement month of January 2101", "the limit is explained");
  const limited = await b.execute(() => {
    const d = document.querySelector('[role="dialog"]'), month = d.querySelector('input[type="month"]');
    return { text: d.textContent, candidateButton: [...d.querySelectorAll("button")].some(x => /from your plan/.test(x.textContent)), max: month?.getAttribute("max") ?? null, filled: month?.value ?? null, primaryDisabled: [...d.querySelectorAll(".modal-actions button")].pop()?.disabled === true };
  });
  assert.ok(limited.text.includes("December 2100"), "the supported limit is named");
  assert.equal(limited.candidateButton, false, "the saved month is not offered");
  assert.equal(limited.max, "2100-12", "the month field stops at the limit"); assert.equal(limited.filled, "", "nothing is chosen for the person");
  assert.equal(limited.primaryDisabled, true, "nothing continues until a supported month is chosen");
  await shoot("saved-month-beyond-limit-choices");
  await h.closeDialog();
  await h.ask(`How much would an extra $50 a month into M5 IRA until January ${savedYear} add?`);
  await h.waitText("Use my saved plan", "the review still opens");
  assert.match(await h.text(), /Month in your plan[\s\S]*January 2101[\s\S]*later than this illustration can calculate/, "the review labels the saved month as evidence beyond the limit");
  await shoot("saved-month-beyond-limit-review");
  await h.closeDialog();
  await h.bridgeWrite("set_investment_plan", await h.planArgs("M5 IRA", "7"));
  evidence.savedMonthBeyondLimit = "COMPILED: a saved month of January 2101 is kept as evidence; the choices card explains the December 2100 limit, offers no candidate and picks nothing; the review labels it later than can be calculated";

  // ---- REAL IN-APP WRITE: each open state is retired at once; the old figures do not come back. ------------------------------------------------------------
  assert.ok(await b.execute(() => typeof window.__vaultspendDebug?.invoke === "function"), "the debug build exposes the app's own invoke");
  const states = [
    ["choices", async () => { await h.ask(QUESTION_NO_ACCOUNT); await h.waitText("Nothing has been calculated yet", "choices"); }],
    ["review", async () => { await h.ask(QUESTION()); await h.waitText("Use my saved plan", "review"); }],
    ["result", async () => { await h.toResult(); }],
    ["explore", async () => { await h.toResult(); await h.clickButton("Explore other returns"); await h.waitText("Show these returns", "explore"); }],
    ["deposits-only", async () => {
      await h.ask(QUESTION("M5 No Value")); await h.waitText("M5 No Value", "review without a recorded value");
      await h.clickButton("Show extra deposits with no investment growth"); await h.waitText("growth forecast was made", "deposits only");
    }],
  ];
  for (const [state, enter] of states) {
    await enter();
    const before = await h.text();
    await h.inAppWrite("set_investment_plan", await h.planArgs("M5 IRA", String(4 + states.findIndex(s => s[0] === state))));
    await h.waitText("Your details changed", `${state}: retired by an in-app write`);
    const after = await h.text();
    assert.ok(!after.includes("Illustrative balance") && !after.includes("Show these returns") && after !== before, `${state}: nothing from the old state stays`);
    await shoot(`in-app-write-${state}`);
    await h.closeDialog();
    assert.ok(await h.focusOnQuestion(), `${state}: focus returns to the question after closing`);
  }
  evidence.inAppWrite = "REAL: retired choices, review, result, explore and deposits-only through the app's own invoke";

  // A write that cannot change the illustration does not close it.
  await h.toResult();
  await h.inAppWrite("set_profile_ui_state", { key: "m5-lifecycle-probe", value: "1" }).catch(() => null);
  assert.ok((await h.text()).includes("Illustrative balance"), "an unrelated write leaves the result alone");
  await h.closeDialog();

  // ---- REAL PROFILE SWITCH with the result mounted. -----------------------------------------------------------------------------------------------------
  await h.toResult();
  await b.execute(() => document.querySelector('.nav-item[data-tab="settings"]').click()); // a DOM click: the open dialog's overlay covers the sidebar
  await openSettingsGroup(b, "profiles");
  await b.$(".profile-create-form input").waitForExist({ timeout: 10000 });
  await b.$(".profile-create-form input").setValue("M5 Other");
  await b.$('.profile-create-form button[type="submit"]').click();
  await b.waitUntil(async () => (await b.$(".profile-switcher-name").getText()) === "M5 Other", { timeout: 10000 });
  await b.$('.nav-item[data-tab="settings"]').click();
  await openSettingsGroup(b, "profiles");
  await b.$("//tr[td[contains(.,'Default')]]//button[text()='Switch']").waitForExist({ timeout: 10000 });
  await b.$("//tr[td[contains(.,'Default')]]//button[text()='Switch']").click();
  await b.$(".ledger-qa-card input").waitForExist({ timeout: 10000 });
  await h.toResult(); // a result open in the original profile
  await b.execute(() => document.querySelector(".profile-switcher-toggle").click());
  await b.execute(() => [...document.querySelectorAll(".profile-switcher-option")].find(o => o.textContent.includes("M5 Other")).click());
  await b.waitUntil(async () => (await b.$(".profile-switcher-name").getText()) === "M5 Other", { timeout: 10000 });
  await b.$(".ledger-qa-card input").waitForExist({ timeout: 10000 });
  assert.equal(await b.$(".ledger-qa-card input").getValue(), "", "the other profile starts with an empty question");
  assert.ok(!(await h.dialogOpen()), "no dialog in the other profile");
  assert.ok(!(await b.execute(() => document.body.textContent.includes("Illustrative balance"))), "no figure in the other profile");
  await h.ask(QUESTION()); // the other profile has no investment account at all
  await b.waitUntil(async () => (await h.dialogOpen()) && /investment account/i.test(await h.text()), { timeout: 10000, timeoutMsg: "the other profile answers from its own (empty) accounts" });
  await h.closeDialog();
  await b.execute(() => document.querySelector(".profile-switcher-toggle").click());
  await b.execute(() => [...document.querySelectorAll(".profile-switcher-option")].find(o => o.textContent.includes("Default")).click());
  await b.waitUntil(async () => (await b.$(".profile-switcher-name").getText()) === "Default", { timeout: 10000 });
  await b.$(".ledger-qa-card input").waitForExist({ timeout: 10000 });
  assert.ok(!(await h.dialogOpen()), "nothing returns after switching back");
  assert.ok(!(await b.execute(() => document.body.textContent.includes("Illustrative balance"))), "no old figure after switching back");
  assert.equal(await b.$(".ledger-qa-card input").getValue(), "", "the question is not remembered");
  evidence.profileSwitch = "REAL: production switcher handler with the result mounted; other profile empty; nothing resurrected on return";

  // ---- PRIVACY: nothing left the computer, nothing was written, nothing was stored. ------------------------------------------------------------------------
  // Only the requests of one complete question-to-result flow are audited here (the earlier sections wrote and switched profiles on purpose).
  await b.execute(() => { window.__m5Requests.length = 0; });
  await h.toResult();
  const audit = await b.execute(async question => {
    const stored = [];
    for (const store of [localStorage, sessionStorage]) for (let i = 0; i < store.length; i++) { const v = store.key(i) + "=" + store.getItem(store.key(i)); if (v.includes(question) || v.includes("M5 IRA")) stored.push("storage"); }
    if (indexedDB.databases) for (const d of await indexedDB.databases()) if ((d.name ?? "").includes("M5")) stored.push("indexedDB");
    if (location.href.includes("M5") || document.title.includes("M5")) stored.push("address-or-title");
    return { stored, requests: window.__m5Requests };
  }, "extra $50 a month");
  assert.deepEqual(audit.stored, [], "nothing persisted");
  const commands = new Set(); const foreign = [];
  for (const url of audit.requests) {
    let parsed; try { parsed = new URL(url, "http://tauri.localhost/"); } catch { foreign.push(url); continue; }
    const local = parsed.hostname === "ipc.localhost" || parsed.protocol === "ipc:" || parsed.hostname === "tauri.localhost" || parsed.hostname === "localhost" || parsed.protocol === "tauri:" || parsed.protocol === "data:" || parsed.protocol === "blob:";
    if (!local) foreign.push(url); else if (parsed.hostname === "ipc.localhost" || parsed.protocol === "ipc:") commands.add(parsed.pathname.replace(/^\//, ""));
  }
  assert.deepEqual(foreign, [], "no request left the computer");
  const writes = [...commands].filter(c => !/^(get_|list_|plugin:)/.test(c) && !["investment_accumulation", "account_value_history", "dashboard_insights", "net_worth_history", "portfolio_history", "spending_this_month", "average_monthly_spend", "cash_flow_forecast", "bill_aware_forecast", "budget_alerts_for_month", "recurring_totals", "recurring_matches"].includes(c));
  evidence.privacy = { requests: audit.requests.length, nativeCommands: [...commands].sort(), commandsOutsideReadOnlyPatterns: writes };
  assert.ok(commands.has("get_ask_vault_retirement_accounts") && commands.has("get_ask_vault_retirement_context"), "the flow did read through the native commands");
  assert.deepEqual([...commands].filter(c => /^(set_|update_|create_|delete_|add_|remove_|import_|commit_|apply_|save_|switch_)/.test(c)), [], "one question-to-result flow invokes no write command");
  await h.closeDialog();

  fs.writeFileSync(process.env.VS_M5_EVIDENCE ?? `${process.env.TEMP ?? "."}/feature306-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log("FEATURE 306 M5 LIFECYCLE AND PRIVACY PASSED");
  console.log(JSON.stringify(evidence));
} finally { await app.close(); }
