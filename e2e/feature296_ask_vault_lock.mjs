import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { seedHouseholdDatabase } from "./household-demo.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";
import { invoke } from "./lib/change-password.mjs";

// Ask the Vault must leave nothing behind when the profile locks: not the question, not the answer,
// not the purchases dialog. A late reply from the native side must not reappear after unlocking either.
const QUESTION = "how much did I spend on groceries last month";
const PASSWORD = "ask the vault lock password";

const dbDir = freshTestDbDir();
await seedHouseholdDatabase(dbDir);
const app = await launchApp({ dbDir });
const b = app.browser;
try {
  await b.$("button*=Settings").click();
  await enableProtectionThroughUI(b, PASSWORD);
  await b.waitUntil(async () => (await b.$(".page").getText()).includes("Password protection: On"), { timeout: 10000 });

  const openDashboard = async () => {
    await (await b.$(".nav-item[data-tab=dashboard]")).click();
    await (await b.$(".ledger-qa-card input")).waitForExist({ timeout: 10000 });
  };
  await openDashboard();

  const input = await b.$(".ledger-qa-card input");
  await input.click();
  await input.addValue(QUESTION);
  await (await (await b.$(".ledger-qa-card")).$("button=Ask")).click();
  const answer = await b.$(".ledger-qa-answer");
  await answer.waitForExist({ timeout: 8000 });
  const answerText = await answer.getText();
  assert.ok(/You spent \$[\d,]+\.\d\d on Groceries/.test(answerText), `expected a groceries answer, got "${answerText}"`);
  const amount = answerText.match(/\$[\d,]+\.\d\d/)[0];

  // Nothing about the question or its answer is written to the browser's own storage, the address or the title.
  const leaked = await b.execute(async (question, amount) => {
    const found = [];
    const look = (where, text) => { if (text && (text.includes(question) || text.includes(amount))) found.push(where); };
    for (const store of [localStorage, sessionStorage]) for (let i = 0; i < store.length; i++) look(store === localStorage ? "localStorage" : "sessionStorage", store.key(i) + "=" + store.getItem(store.key(i)));
    look("address", location.href);
    look("title", document.title);
    if (indexedDB.databases) for (const d of await indexedDB.databases()) look("indexedDB name", d.name ?? "");
    return found;
  }, QUESTION, amount);
  assert.deepEqual(leaked, [], "the question and answer must not be stored anywhere in the browser");

  // Names for assistive technology, and the keyboard returns to where it was after the dialog closes.
  const access = await b.execute(() => {
    const card = document.querySelector(".ledger-qa-card");
    const input = card.querySelector("input");
    return {
      inputName: input.getAttribute("aria-label") || input.labels?.[0]?.textContent || "",
      announces: !!card.querySelector("[aria-live='polite']"),
      unnamed: [...card.querySelectorAll("button")].filter((x) => !(x.getAttribute("aria-label") || x.textContent).trim()).length,
    };
  });
  assert.ok(access.inputName.trim().length > 0, "the question box needs a name");
  assert.equal(access.announces, true, "answers must be announced politely");
  assert.equal(access.unnamed, 0, "every button needs a name");
  await (await b.$("button*=View ")).click();
  await (await b.$("[role='dialog']")).waitForExist({ timeout: 5000 });
  await b.keys("Escape");
  await b.waitUntil(async () => !(await (await b.$("[role='dialog']")).isExisting()), { timeout: 5000, timeoutMsg: "Escape should close the purchases dialog" });
  const focused = await b.execute(() => document.activeElement?.textContent?.trim() ?? "");
  assert.ok(focused.startsWith("View"), `focus should return to the View button, was "${focused}"`);

  // Leave the purchases dialog open, then lock the way the workstation does.
  await (await b.$("button*=View ")).click();
  await (await b.$("[role='dialog']")).waitForExist({ timeout: 5000 });
  assert.equal((await invoke(b, "debug_apply_system_session_event", { event: "locked" })).ok, true);
  await b.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  const lockedText = await b.execute(() => document.body.innerText);
  assert.ok(!lockedText.includes(amount), "the locked screen must not show the answer");
  assert.ok(!lockedText.includes("groceries"), "the locked screen must not show the question");
  assert.equal(await b.$(".ledger-qa-card").isExisting(), false, "the card must be gone while locked");
  assert.equal(await b.$("[role='dialog']").isExisting(), false, "the purchases dialog must be gone while locked");

  await b.$("#password-form-field").setValue(PASSWORD);
  await b.$("button=Unlock").click();
  await b.$(".brand-word").waitForExist({ timeout: 10000 });
  await openDashboard();
  assert.equal(await (await b.$(".ledger-qa-card input")).getValue(), "", "the question box must start empty after unlocking");
  assert.equal(await b.$(".ledger-qa-answer").isExisting(), false, "no answer may reappear after unlocking");
  assert.equal(await b.$("[role='dialog']").isExisting(), false, "no dialog may reappear after unlocking");
  console.log("FEATURE 296 E2E TEST PASSED");
} finally {
  await app.close();
}
