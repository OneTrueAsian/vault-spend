// Privacy and state safety of Reports > Comparisons in the real compiled app:
//   - "Hide amounts" masks the person's figures, the public benchmark amounts, the details dialog and the
//     bar geometry, while the age group and the source stay readable;
//   - a call made under a stale profile generation is refused and cannot save;
//   - restoring a backup brings the saved setup back and invalidates the old generation;
//   - a protected profile keeps its setup in the encrypted database, shows nothing while locked, and
//     comes back after unlocking.
//
// Run with: node e2e/feature146_comparisons_privacy.mjs
import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";
import { enableProtectionThroughUI } from "./lib/protection.mjs";
import { baseSetup, invoke, nav, openReportsTab, setupSnippet, waitForCards } from "./lib/comparisons.mjs";

const today = new Date();
const TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
const PASSWORD = "correct horse battery staple";

const setup = baseSetup(TODAY, {
  people: [{ person: { kind: "owner" }, age: { age: { kind: "exact", age: 42 }, confirmedOn: TODAY }, inHousehold: true }],
  balanceConfirmations: [{ metric: "savings", confirmedOn: TODAY }],
});
const fixture = `
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '8000.00')")
${setupSnippet(setup)}
`;

const hasMoney = (text) => /\$\s?\d/.test(text);

async function pageText(browser) {
  return (await browser.$("[data-comparisons-page]")).getText();
}

// ---------------------------------------------------------------------------------- unprotected profile
let app = await launchApp({ dbDir: await seedFixture(fixture) });
try {
  const { browser } = app;
  await browser.setWindowSize(1440, 1400);
  await openReportsTab(browser, "comparisons");
  await waitForCards(browser);
  await browser.waitUntil(async () => hasMoney(await pageText(browser)), { timeout: 20000, timeoutMsg: "amounts should show before hiding" });
  const visibleText = await pageText(browser);
  assert.ok(visibleText.includes("$100,000"), `the typed income is shown: ${visibleText.slice(0, 300)}`);

  // Hide amounts: figures, public benchmark amounts and bars go; age group and source stay.
  await (await browser.$("[data-privacy-toggle]")).click();
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.getAttribute("data-privacy"))) === "on", { timeout: 5000 });
  await browser.waitUntil(async () => !hasMoney(await pageText(browser)), { timeout: 10000, timeoutMsg: `amounts should be hidden: ${await pageText(browser)}` });
  const masked = await pageText(browser);
  assert.ok(masked.includes("••••"));
  assert.ok(masked.includes("ages 40–44"), "the age group is not a financial amount and stays readable");
  assert.ok(masked.includes("U.S. Census Bureau"), "the source stays readable");
  const bars = await browser.execute(() =>
    [...document.querySelectorAll("[data-comparisons-page] .cmp-fill")].map((f) => f.getBoundingClientRect().width / f.parentElement.getBoundingClientRect().width),
  );
  assert.ok(bars.length >= 2, "bars exist");
  for (const ratio of bars) assert.ok(Math.abs(ratio - 0.5) < 0.02, `a hidden bar is a neutral half-width, not its true length (got ${ratio})`);
  const labelled = await browser.execute(() =>
    [...document.querySelectorAll("[data-comparisons-page] [aria-label], [data-comparisons-page] [title]")].map((e) => (e.getAttribute("aria-label") ?? "") + (e.getAttribute("title") ?? "")).join(" "),
  );
  assert.ok(!hasMoney(labelled), `no amount is placed in a label or tooltip: ${labelled}`);

  // The details dialog is masked too.
  await (await (await browser.$("[data-comparisons-page] [data-metric='income']")).$(".cmp-explore")).click();
  const details = await browser.$("[data-cmp-details='income']");
  await details.waitForExist({ timeout: 10000 });
  await browser.waitUntil(async () => (await details.getText()).trim() !== "", { timeout: 10000 });
  await browser.waitUntil(async () => !hasMoney(await details.getText()), { timeout: 10000, timeoutMsg: `details amounts should be hidden: ${await details.getText()}` });
  assert.ok((await details.getText()).includes("Households by age of householder"), "non-financial details stay visible");
  await (await browser.$(".modal-panel .modal-secondary")).click();

  await (await browser.$("[data-privacy-toggle]")).click();
  await browser.waitUntil(async () => hasMoney(await pageText(browser)), { timeout: 10000, timeoutMsg: "amounts return when unhidden" });

  // ---- a stale profile generation is refused, for reads and for saves ---------------------------------
  const generation = (await invoke(browser, "get_current_generation")).ok;
  const current = await invoke(browser, "get_financial_comparisons", { expectedGeneration: generation });
  assert.equal(current.ok?.configured, true, JSON.stringify(current));
  const staleRead = await invoke(browser, "get_financial_comparisons", { expectedGeneration: generation + 1 });
  assert.match(staleRead.error ?? "", /active profile changed/, "a read under another generation is refused");
  const before = await invoke(browser, "get_comparison_setup", { expectedGeneration: generation });
  const revisionBefore = before.ok.revision;
  const changed = JSON.parse(JSON.stringify(before.ok.setup));
  changed.people[0].age.age = { kind: "exact", age: 99 };
  const staleSave = await invoke(browser, "save_comparison_setup", { expectedGeneration: generation + 1, expectedRevision: revisionBefore, setup: changed });
  assert.match(staleSave.error ?? "", /active profile changed/, "a save under another generation is refused");
  assert.equal((await invoke(browser, "get_comparison_setup", { expectedGeneration: generation })).ok.revision, revisionBefore, "the refused save changed nothing");

  // A save against an old revision is a conflict response, not a silent overwrite.
  const first = await invoke(browser, "save_comparison_setup", { expectedGeneration: generation, expectedRevision: revisionBefore, setup: changed });
  assert.equal(first.ok?.status, "saved", JSON.stringify(first));
  const second = await invoke(browser, "save_comparison_setup", { expectedGeneration: generation, expectedRevision: revisionBefore, setup: before.ok.setup });
  assert.equal(second.ok?.status, "conflict", "the stale revision loses");
  assert.equal(second.ok.currentRevision, revisionBefore + 1);

  // ---- backup, change, restore: the setup comes back and the old generation is dead -------------------------
  const backup = await invoke(browser, "create_backup_now");
  assert.ok(backup.ok?.filename, JSON.stringify(backup));
  const restored = await invoke(browser, "restore_backup", { filename: backup.ok.filename, password: null, expectedGeneration: generation });
  assert.equal(restored.error, undefined, `restore failed: ${restored.error}`);
  const after = await invoke(browser, "get_current_generation");
  assert.ok(after.ok > generation, "restoring bumps the generation");
  const oldRead = await invoke(browser, "get_financial_comparisons", { expectedGeneration: generation });
  assert.match(oldRead.error ?? "", /active profile changed/, "a reply prepared before the restore can no longer land");
  const restoredSetup = await invoke(browser, "get_comparison_setup", { expectedGeneration: after.ok });
  assert.equal(restoredSetup.ok.setup.people[0].age.age.age, 99, "the backup carried the setup exactly as it was when taken");
} finally {
  await app.close();
}

// ------------------------------------------------------------------------------------ protected profile
app = await launchApp({ dbDir: await seedFixture(fixture) });
try {
  const { browser } = app;
  await browser.setWindowSize(1440, 1400);
  await nav(browser, "Settings");
  await enableProtectionThroughUI(browser, PASSWORD);
  await browser.waitUntil(async () => (await browser.$(".page").getText()).includes("Password protection: On"), { timeout: 30000, timeoutMsg: "protection should turn on" });

  // The setup travelled into the encrypted database.
  await openReportsTab(browser, "comparisons");
  await waitForCards(browser);
  await browser.waitUntil(async () => (await pageText(browser)).includes("$100,000"), { timeout: 20000, timeoutMsg: "the protected profile still compares" });

  // Locking removes every comparison from the page and from the backend.
  await (await browser.$(".profile-switcher-toggle")).click();
  await (await browser.$("[data-profile-switcher-lock]")).click();
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 15000 });
  assert.equal((await browser.$$("[data-comparisons-page]")).length, 0, "no comparison data remains in the page while locked");
  assert.ok(!hasMoney(await browser.execute(() => document.body.innerText)), "no amount is on screen while locked");
  const refused = await invoke(browser, "get_financial_comparisons", { expectedGeneration: 1 });
  assert.ok(refused.error?.startsWith("PROFILE_LOCKED"), `a locked profile refuses comparisons: ${JSON.stringify(refused)}`);
  const refusedSave = await invoke(browser, "save_comparison_setup", { expectedGeneration: 1, expectedRevision: 1, setup: {} });
  assert.ok(refusedSave.error?.startsWith("PROFILE_LOCKED") || /invalid|missing|unknown/i.test(refusedSave.error ?? ""), `a locked profile refuses saves: ${JSON.stringify(refusedSave)}`);

  // Unlocking brings it back, starting from Overview.
  await (await browser.$("#password-form-field")).setValue(PASSWORD);
  await (await browser.$("button[type='submit']")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 30000 });
  await nav(browser, "Reports");
  await browser.$("[data-reports-hub]").waitForExist({ timeout: 20000 });
  assert.equal(await (await browser.$("[data-reports-tab='overview']")).getAttribute("aria-selected"), "true");
  await (await browser.$("[data-reports-tab='comparisons']")).click();
  await browser.waitUntil(async () => (await pageText(browser)).includes("$100,000"), { timeout: 20000, timeoutMsg: "comparisons return after unlocking" });

  console.log("FEATURE 146 E2E TEST PASSED");
} finally {
  await app.close();
}
