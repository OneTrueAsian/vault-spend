import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { launchApp } from "./harness.mjs";
import { invoke } from "./lib/change-password.mjs";
import { askHelpers, seedRetirementProfile } from "./lib/askRetirement.mjs";

// Real compiled checks for O2 saved evidence and O3 fixture-only exposure. All databases come from managed throwaway seeds.
const dbDir = await seedRetirementProfile();
const outsideDir = await seedRetirementProfile();
const app = await launchApp({ dbDir }), b = app.browser, h = askHelpers(b);
const evidence = {};
try {
  await h.openDashboard();
  await b.waitUntil(() => b.execute(() => typeof window.__vaultspendDebug?.invoke === "function"), { timeout: 5000, timeoutMsg: "a valid disposable fixture gets the narrow debug hook" });
  const denied = await b.executeAsync(done => {
    window.__vaultspendDebug.invoke("delete_account", { id: 1 }).then(() => done(false), () => done(true));
  });
  assert.equal(denied, true, "the hook is not an arbitrary command invoker");
  const year = new Date().getFullYear() + 30;
  await h.bridgeWrite("set_investment_plan", { ...(await h.planArgs("M5 IRA", "7")), withdrawMonth: "2101-01" });
  await h.ask("extra $50 a month into M5 IRA");
  await h.waitText("2100", "out-of-range saved month is explained, not a failed account read");
  const state = await b.execute(() => {
    const d = document.querySelector('[role="dialog"]');
    return { text: d.textContent, month: d.querySelector('input[type="month"]')?.value, buttons: [...d.querySelectorAll("button")].map(x => x.textContent), disabled: [...d.querySelectorAll(".modal-actions button")].at(-1)?.disabled };
  });
  assert.ok(state.text.includes("2101"), "the saved evidence is retained visibly");
  assert.equal(state.month, "", "the unsupported month is never prefilled");
  assert.equal(state.disabled, true, "nothing can continue until a valid month is chosen");
  assert.ok(!state.buttons.some(text => /Use.*2101/.test(text)), "the saved month is not offered as a candidate");
  const month = await b.$('[role="dialog"] input[type="month"]');
  await b.execute((el, value) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); }, month, `${year}-06`);
  await b.waitUntil(() => b.$('[role="dialog"] .modal-actions button:last-child').isEnabled(), { timeout: 5000, timeoutMsg: "a supported replacement month enables Continue" });
  await h.clickButton("Continue"); await h.waitText("Use my saved plan", "other account evidence stays usable");
  assert.ok(!(await h.text()).includes("Illustrative balance at"), "a replacement month is not consent");
  await h.clickButton("Use my saved plan"); await h.waitText("Illustrative balance at", "replacement month in result");
  assert.ok((await h.text()).includes(`June ${year}`));
  if (process.env.VS_M5_SHOTS) { fs.mkdirSync(process.env.VS_M5_SHOTS, { recursive: true }); await b.saveScreenshot(path.join(process.env.VS_M5_SHOTS, "feature308-supported-month.png")); }
  await h.closeDialog();
  evidence.savedMonth = "COMPILED: 2101-01 remains evidence, is never selectable, supported replacement reaches fresh review and consent";

  // Reuse the real profile-import path to leave the fixture's managed root, without touching any owner's data.
  const origin = (await invoke(b, "get_transaction_context")).ok;
  const adopted = await invoke(b, "add_existing_profile", { name: "M5 External Test Fixture", dbPath: path.join(outsideDir, "vaultspend.db"), password: null, expectedGeneration: origin.generation });
  assert.ok(adopted.ok, JSON.stringify(adopted));
  const guard = await invoke(b, "debug_retirement_fixture_allowed");
  assert.equal(guard.ok, false, "native fixture permission is revoked for an external active profile");
  const revoked = await b.executeAsync(done => {
    window.__vaultspendDebug.invoke("set_investment_plan", { accountId: 1 }).then(() => done(false), () => done(true));
  });
  assert.equal(revoked, true, "a retained hook cannot write after the active database leaves the fixture root");
  evidence.hook = "COMPILED: arbitrary operation denied; native guard revokes after external disposable-profile adoption; retained hook refuses write";
  if (process.env.VS_M5_EVIDENCE) fs.writeFileSync(process.env.VS_M5_EVIDENCE, JSON.stringify(evidence, null, 2));
  console.log("FEATURE 308 M5 SAVED-MONTH AND FIXTURE BOUNDARIES PASSED", JSON.stringify(evidence));
} finally { await app.close(); }
