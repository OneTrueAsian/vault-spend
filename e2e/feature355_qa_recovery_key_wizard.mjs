// UAT-010 recording the recovery key (ProtectionSetupDialog: step 1 password, step 2 save the key, step 3 prove it was written down).
// The wizard must refuse a short or mismatched password, show the key once, ask for two named groups of it, refuse wrong groups in plain words without turning protection on,
// and only turn protection on when both groups are right. Cancelling at step 2 or 3 leaves the profile unprotected. The key that was shown is the one that works (feature116 uses it to recover).
import assert from "node:assert/strict";
import { launchApp, waitUntilOrDiagnose, openSettingsGroup } from "./harness.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { seedPopulatedProfile } from "./lib/protection.mjs";

const dir = freshTestDbDir();
await seedPopulatedProfile(dir);
const app = await launchApp({ dbDir: dir });
const { browser: b } = app;
async function invoke(command, args = {}) {
  const r = await b.executeAsync((command, args, done) => window.__TAURI_INTERNALS__.invoke(command, args).then(ok => done({ ok }), e => done({ error: String(e?.message ?? e) })), command, args);
  if (r.error) throw new Error(`${command} failed: ${r.error}`);
  return r.ok;
}
const protectedNow = async () => (await invoke("list_profiles")).find(p => p.is_active).is_password_protected;
const dialog = () => b.execute(() => document.querySelector("[role='dialog']")?.innerText ?? "");
const startWizard = async () => {
  const turnOn = await b.$("button=Turn on password protection");
  await turnOn.waitForExist({ timeout: 10000 });
  await turnOn.click();
  await b.$("#protection-setup-password").waitForExist({ timeout: 5000 });
};
const type = async (id, value) => { await b.$(id).setValue(value); };
try {
  await b.setWindowSize(1280, 1100);
  await (await b.$("button*=Settings")).click();
  await openSettingsGroup(b, "profiles");

  // --- step 1: the password -------------------------------------------------------------------------------------------------------------------------------------
  await startWizard();
  assert.ok((await dialog()).includes("Step 1 of 3"), await dialog());
  const next = () => b.$("//div[@role='dialog']//button[normalize-space()='Continue']");
  assert.equal(await (await next()).isEnabled(), false, "nothing typed: Continue is off");
  await type("#protection-setup-password", "short");
  await type("#protection-setup-confirm", "short");
  assert.equal(await (await next()).isEnabled(), false, "under 8 characters: Continue stays off");
  await type("#protection-setup-password", "long enough 1");
  await type("#protection-setup-confirm", "long enough 2");
  assert.ok((await dialog()).includes("Passwords do not match."), "a mismatch is said in words: " + (await dialog()));
  assert.equal(await (await next()).isEnabled(), false);
  await type("#protection-setup-confirm", "long enough 1");
  await waitUntilOrDiagnose(b, async () => await (await next()).isEnabled(), { timeout: 5000, timeoutMsg: "matching 8+ character passwords turn Continue on" });

  // --- step 2: the key is shown, and the person must say they saved it ------------------------------------------------------------------------------------
  await (await next()).click();
  const keyEl = await b.$(".modal-panel .path-box");
  await keyEl.waitForExist({ timeout: 15000 });
  const key = (await keyEl.getText()).trim();
  assert.match(key, /^[A-Za-z0-9]{4,}(-[A-Za-z0-9]{4,}){3,}$/, "the recovery key is a few groups of letters and digits: " + key);
  assert.ok((await dialog()).includes("Step 2 of 3") && /only way|forget your password/i.test(await dialog()), "it says why the key matters: " + (await dialog()));
  // Backing out here leaves the profile as it was.
  await (await b.$("//div[@role='dialog']//button[normalize-space()='Cancel']")).click();
  await waitUntilOrDiagnose(b, async () => !(await b.$("[role='dialog']").isExisting()), { timeout: 10000, timeoutMsg: "Cancel closes the wizard" });
  assert.equal(await protectedNow(), false, "cancelling at step 2 turns nothing on");

  // --- step 3: wrong groups are refused in plain words; right ones finish ----------------------------------------------------------------------------------
  await startWizard();
  await type("#protection-setup-password", "long enough 1"); await type("#protection-setup-confirm", "long enough 1");
  await (await next()).click();
  const keyEl2 = await b.$(".modal-panel .path-box"); await keyEl2.waitForExist({ timeout: 15000 });
  const key2 = (await keyEl2.getText()).trim();
  assert.notEqual(key2, key, "each run of the wizard makes a new key");
  await (await b.$("button=I've saved it")).click();
  const label0 = await b.$("label[for='protection-setup-answer-0']"); await label0.waitForExist({ timeout: 5000 });
  let texts = [];
  await waitUntilOrDiagnose(b, async () => (texts = [await label0.getText(), await (await b.$("label[for='protection-setup-answer-1']")).getText()]).every(t => /\d/.test(t)), { timeout: 5000, timeoutMsg: "both group numbers are named" });
  const groups = key2.split("-");
  const idx = texts.map(t => Number(t.match(/\d+/)[0]) - 1);
  assert.notEqual(idx[0], idx[1], "two different groups are asked");
  await type("#protection-setup-answer-0", "WRONG"); await type("#protection-setup-answer-1", "WRONG");
  await (await b.$("button=Finish")).click();
  await waitUntilOrDiagnose(b, async () => /didn.t match|doesn.t match|not match|incorrect|wrong|try again/i.test(await dialog()), { timeout: 15000, timeoutMsg: "wrong groups are refused in words", extra: dialog });
  const refusal = await dialog();
  assert.ok(!/panic|argon|0x[0-9a-f]+|\.rs:|token/i.test(refusal), "no technical wording: " + refusal);
  assert.equal(await protectedNow(), false, "a wrong answer turns nothing on");
  await type("#protection-setup-answer-0", groups[idx[0]]); await type("#protection-setup-answer-1", groups[idx[1]]);
  await (await b.$("button=Finish")).click();
  await waitUntilOrDiagnose(b, protectedNow, { timeout: 60000, timeoutMsg: "the right groups turn protection on" });
  assert.equal(await protectedNow(), true);
  console.log("FEATURE 355 PASSED: short and mismatched passwords, the key shown once and each time new, cancel leaves nothing on, wrong groups refused, right groups finish.");
} finally { await app.close(); }
