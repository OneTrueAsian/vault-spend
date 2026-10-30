import assert from "node:assert/strict";
import fs from "node:fs";
import { launchApp, reclaimWindowFocus, openSettingsGroup } from "./harness.mjs";
import { askHelpers, QUESTION_REFUSED_STORED, REFUSAL_MESSAGE, seedRefusalProfile } from "./lib/askRetirement.mjs";

// M5 numeric-refusal lifecycle and privacy in the compiled app (task item 2). The refused ("needs attention") card and the choices that "Change the details" reopens must retire like any other
// state when the data changes, when the profile changes and when a reply arrives late, and the whole refusal-and-recovery flow must stay local, read-only and unrecorded.
// Evidence classes, kept apart: REAL IN-APP WRITE (the app's own invoke, via the debug build's hook), REAL PROFILE SWITCH (the production switcher), SYNTHETIC FOCUS (a dispatched
// focus event after a write the app could not see; real OS focus is feature307), PRIVACY (every request the page makes and every native command it invokes).
const SHOTS = process.env.VS_M5_SHOTS;
const dbDir = await seedRefusalProfile();
const app = await launchApp({ dbDir });
const b = app.browser, h = askHelpers(b);
const evidence = {};
const shoot = async name => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await b.saveScreenshot(`${SHOTS}/feature310-${name}.png`); } };
const clickPrimary = async () => { const buttons = await (await h.dialog()).$$(".modal-actions button"); const last = buttons[buttons.length - 1]; await last.waitForEnabled({ timeout: 8000 }); await last.click(); };
const chooseOption = text => b.execute(t => { const label = [...document.querySelectorAll('[role="dialog"] label.scenario-option')].find(l => l.textContent.trim() === t); if (!label) throw new Error(`no option "${t}"`); label.querySelector("input").click(); }, text);
const setAmount = async value => { const input = await b.$('//div[@role="dialog"]//label[span[text()="Extra amount (dollars)"]]//input'); await input.click(); await input.setValue(value); };
const toBlocked = async () => {
  await h.ask(QUESTION_REFUSED_STORED("Roth IRA")); await h.waitText("Use my saved plan", "review of the question the calculator will refuse");
  await clickPrimary(); await h.waitText("A few details need attention", "numeric refusal");
};
const toRecoveryChoices = async () => { await toBlocked(); await h.clickButton("Change the details"); await h.waitText("Nothing has been calculated yet", "recovery choices"); };
const toRecoveryMonth = async () => {
  await toRecoveryChoices(); await chooseOption("Brokerage"); await setAmount("100"); await chooseOption("Every month");
  await h.clickButton("Continue"); await h.waitText("Retirement month", "the month card, after the new account was read");
};

try {
  await h.openDashboard(); await reclaimWindowFocus(b);
  // Record every request the page makes (fetch, XHR, beacons, sockets) from now on.
  await b.execute(() => {
    window.__m5Requests = [];
    const note = url => window.__m5Requests.push(String(url));
    const realFetch = window.fetch.bind(window); window.fetch = (input, init) => { note(input instanceof Request ? input.url : input); return realFetch(input, init); };
    const open = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (method, url) { note(url); return open.apply(this, arguments); };
    const beacon = navigator.sendBeacon?.bind(navigator); if (beacon) navigator.sendBeacon = (url, data) => { note(url); return beacon(url, data); };
    const Socket = window.WebSocket; window.WebSocket = function (url, protocols) { note(url); return new Socket(url, protocols); }; window.WebSocket.prototype = Socket.prototype;
  });

  // ---- REAL IN-APP WRITE retires the refused card, the reopened choices and the month card at once; the refusal does not come back. -----------------------------------------
  assert.ok(await b.execute(() => typeof window.__vaultspendDebug?.invoke === "function"), "the debug build exposes the app's own invoke");
  const states = [["refused card", toBlocked], ["reopened choices", toRecoveryChoices], ["month card of the recovery", toRecoveryMonth]];
  for (const [index, [state, enter]] of states.entries()) {
    await enter(); const before = await h.text();
    await h.inAppWrite("set_investment_plan", await h.planArgs("Brokerage", String(4 + index)));
    await h.waitText("Your details changed", `${state}: retired by an in-app write`);
    const after = await h.text();
    assert.ok(!after.includes(REFUSAL_MESSAGE) && !after.includes("Illustrative balance") && after !== before, `${state}: nothing from the old state stays: ${after}`);
    await shoot(`in-app-write-${state.replace(/[^a-z]+/g, "-")}`);
    await h.closeDialog();
    assert.ok(await h.focusOnQuestion(), `${state}: focus returns to the question after closing`);
  }
  evidence.inAppWrite = "REAL: the refused card, the reopened choices and the recovery's month card each retired through the app's own invoke";

  // A write that cannot change the illustration leaves the refused card alone.
  await toBlocked();
  await h.inAppWrite("set_profile_ui_state", { key: "m5-refusal-probe", value: "1" }).catch(() => null);
  assert.ok((await h.text()).includes(REFUSAL_MESSAGE), "an unrelated write leaves the refused card alone");
  await h.closeDialog();

  // ---- SYNTHETIC FOCUS after a write the app's own code never saw: only revalidation can reveal it, and it retires the recovery. ----------------------------------------------
  await toRecoveryChoices();
  await h.bridgeWrite("set_investment_plan", await h.planArgs("Brokerage", "3"));
  await b.execute(() => window.dispatchEvent(new Event("focus")));
  await h.waitText("Your details changed", "reopened choices: retired when the window is revalidated");
  await h.closeDialog();
  evidence.revalidation = "SYNTHETIC: a dispatched focus event revalidated the reopened choices after an unseen write (real OS focus is feature307)";

  // ---- REAL PROFILE SWITCH with the refused card mounted. -----------------------------------------------------------------------------------------------------------------
  await b.execute(() => document.querySelector('.nav-item[data-tab="settings"]').click());
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
  await toBlocked();
  await b.execute(() => document.querySelector(".profile-switcher-toggle").click());
  await b.execute(() => [...document.querySelectorAll(".profile-switcher-option")].find(o => o.textContent.includes("M5 Other")).click());
  await b.waitUntil(async () => (await b.$(".profile-switcher-name").getText()) === "M5 Other", { timeout: 10000 });
  await b.$(".ledger-qa-card input").waitForExist({ timeout: 10000 });
  assert.equal(await b.$(".ledger-qa-card input").getValue(), "", "the other profile starts with an empty question");
  assert.ok(!(await h.dialogOpen()), "no dialog in the other profile");
  assert.ok(!(await b.execute(message => document.body.textContent.includes(message), REFUSAL_MESSAGE)), "no refusal text in the other profile");
  await b.execute(() => document.querySelector(".profile-switcher-toggle").click());
  await b.execute(() => [...document.querySelectorAll(".profile-switcher-option")].find(o => o.textContent.includes("Default")).click());
  await b.waitUntil(async () => (await b.$(".profile-switcher-name").getText()) === "Default", { timeout: 10000 });
  await b.$(".ledger-qa-card input").waitForExist({ timeout: 10000 });
  assert.ok(!(await h.dialogOpen()), "nothing returns after switching back");
  assert.equal(await b.$(".ledger-qa-card input").getValue(), "", "the question is not remembered");
  evidence.profileSwitch = "REAL: production switcher with the refused card mounted; other profile empty; nothing resurrected on return";

  // ---- PRIVACY over one complete flow: refusal, recovery, result. ---------------------------------------------------------------------------------------------------------
  await b.execute(() => { window.__m5Requests.length = 0; });
  await toBlocked(); await h.clickButton("Change the details"); await h.waitText("Nothing has been calculated yet", "recovery choices");
  await chooseOption("Brokerage"); await setAmount("100"); await chooseOption("Every month"); await h.clickButton("Continue"); await h.waitText("Retirement month", "month card");
  await b.execute(() => { const d = new Date(), v = `${d.getFullYear() + 1}-${String(d.getMonth() + 1).padStart(2, "0")}`; const input = document.querySelector('[role="dialog"] [data-date-field="month"] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await h.clickButton("Continue"); await h.waitText("Use my saved plan", "review"); await clickPrimary(); await h.waitText("Illustrative balance at", "result");
  const audit = await b.execute(async marker => {
    const stored = [];
    for (const store of [localStorage, sessionStorage]) for (let i = 0; i < store.length; i++) { const v = store.key(i) + "=" + store.getItem(store.key(i)); if (v.includes(marker) || v.includes("Roth IRA") || v.includes("Brokerage")) stored.push("storage"); }
    if (indexedDB.databases) for (const d of await indexedDB.databases()) if ((d.name ?? "").includes("Roth")) stored.push("indexedDB");
    if (location.href.includes("Roth") || document.title.includes("Roth")) stored.push("address-or-title");
    return { stored, requests: window.__m5Requests };
  }, "extra $100 a month");
  assert.deepEqual(audit.stored, [], "nothing persisted");
  const commands = new Set(), foreign = [];
  for (const url of audit.requests) {
    let parsed; try { parsed = new URL(url, "http://tauri.localhost/"); } catch { foreign.push(url); continue; }
    const local = parsed.hostname === "ipc.localhost" || parsed.protocol === "ipc:" || parsed.hostname === "tauri.localhost" || parsed.hostname === "localhost" || parsed.protocol === "tauri:" || parsed.protocol === "data:" || parsed.protocol === "blob:";
    if (!local) foreign.push(url); else if (parsed.hostname === "ipc.localhost" || parsed.protocol === "ipc:") commands.add(parsed.pathname.replace(/^\//, ""));
  }
  assert.deepEqual(foreign, [], "no request left the computer");
  assert.ok(commands.has("get_ask_vault_retirement_accounts") && commands.has("get_ask_vault_retirement_context"), "the flow read through the native commands");
  assert.deepEqual([...commands].filter(c => /^(set_|update_|create_|delete_|add_|remove_|import_|commit_|apply_|save_|switch_)/.test(c)), [], "a refusal-and-recovery flow invokes no write command");
  evidence.privacy = { requests: audit.requests.length, nativeCommands: [...commands].sort() };
  await h.closeDialog();

  fs.writeFileSync(process.env.VS_M5_EVIDENCE_310 ?? `${process.env.TEMP ?? "."}/feature310-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log("FEATURE 310 M5 NUMERIC-REFUSAL LIFECYCLE AND PRIVACY PASSED");
  console.log(JSON.stringify(evidence));
} finally { await app.close(); }
