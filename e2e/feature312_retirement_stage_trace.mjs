import assert from "node:assert/strict";
import fs from "node:fs";
import { launchApp } from "./harness.mjs";
import { seedRetirementProfile, askHelpers, QUESTION } from "./lib/askRetirement.mjs";
import { invoke } from "./lib/change-password.mjs";
import { enableProtectionThroughUI, waitForProtectionSetupCompletion } from "./lib/protection.mjs";

// Required kept compiled regression for the diagnostic boundary; normal profile files are never opened.
const evidence = { flows: [] };
const envBefore = process.env.VAULTSPEND_STAGE_TRACE;
delete process.env.VAULTSPEND_STAGE_TRACE;
const denied = await launchApp({ dbDir: await seedRetirementProfile() });
try {
  await denied.browser.waitUntil(async () => denied.browser.execute(() => !!window.__vaultspendStageTrace), { timeout: 5000, timeoutMsg: "debug fixture stage bridge missing" });
  const result = await denied.browser.executeAsync(done => window.__vaultspendStageTrace.begin(1).then(() => done("unexpected"), () => done("denied")));
  assert.equal(result, "denied", "debug fixture alone is not opt-in"); evidence.noOptIn = result;
} finally { await denied.close(); }

process.env.VAULTSPEND_STAGE_TRACE = "1";
const app = await launchApp({ dbDir: await seedRetirementProfile() }), b = app.browser, h = askHelpers(b);
const stage = async (method, ...args) => b.executeAsync((method, args, done) => window.__vaultspendStageTrace[method](...args).then(value => done({ value }), () => done({ error: "diagnostic refused" })), method, args);
try {
  await b.$('.nav-item[data-tab="settings"]').click();
  await enableProtectionThroughUI(b, "stage trace fixture password");
  await waitForProtectionSetupCompletion(b);
  await b.waitUntil(async () => (await b.$('.page').getText()).includes('Password protection: On'), { timeout: 15000 });
  await h.openDashboard();
  await b.waitUntil(async () => b.execute(() => !!window.__vaultspendStageTrace), { timeout: 5000 });
  const getRoster = async () => {
    const context = (await invoke(b, "get_transaction_context")).ok;
    const result = await invoke(b, "get_ask_vault_retirement_accounts", { expectedGeneration: context.generation, expectedSessionRevision: context.sessionRevision, request: { contractVersion: 1, expectedRevision: null } });
    assert.ok(result.ok, result.error); return result.ok;
  };
  const before = await getRoster();
  for (const [sample, amount] of [[1, 50], [2, 100]]) {
    assert.ok(!((await stage("begin", sample)).error));
    await h.ask(QUESTION().replace("$50", `$${amount}`));
    await h.waitText("Use my saved plan", "review");
    await h.clickButton("Use my saved plan"); await h.waitText("Illustrative balance", "result");
    const text = await h.text(); await h.closeDialog();
    const drained = await stage("drain"); assert.ok(drained.value, drained.error);
    const problems = await b.execute(trace => window.__vaultspendStageTrace.problems(trace.js, trace.native, "flow"), drained.value);
    assert.deepEqual(problems, []); assert.equal(drained.value.js.sample, sample);
    assert.equal(drained.value.native.sample, sample);
    const encoded = JSON.stringify(drained.value);
    assert.ok(!encoded.includes("M5 IRA") && !encoded.includes("extra $") && !encoded.includes("accountId"), "trace never retains financial inputs");
    evidence.flows.push({ sample, text, trace: drained.value });
  }
  assert.notEqual(evidence.flows[0].text, evidence.flows[1].text, "editing the extra amount changes the displayed calculation");
  assert.deepEqual((await getRoster()).revision, before.revision, "trace control does not write financial data");
  assert.ok(!(await stage("begin", 3)).error);
  await h.ask(QUESTION()); await h.waitText("Use my saved plan", "review before lock");
  assert.equal((await invoke(b, "debug_apply_system_session_event", { event: "locked" })).ok, true);
  await b.$('[data-profile-lock-screen]').waitForExist({ timeout: 10000 });
  assert.ok((await stage("drain")).error, "locked/retired session cannot drain prior trace");
  const body = await b.execute(() => document.body.textContent);
  assert.ok(!body.includes("Illustrative balance"), "locking retires the result"); evidence.lockRetirement = true;
  console.log("M5 DEBUG STAGE TRACE: denied without opt-in; complete correlated stages; edited input changes output; revision unchanged; lock denies drain");
  if (process.env.VS_STAGE_EVIDENCE) fs.writeFileSync(process.env.VS_STAGE_EVIDENCE, JSON.stringify(evidence, null, 2));
} finally {
  await app.close();
  if (envBefore === undefined) delete process.env.VAULTSPEND_STAGE_TRACE; else process.env.VAULTSPEND_STAGE_TRACE = envBefore;
}
