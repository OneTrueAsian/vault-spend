// Create a brand-new protected profile through the real profile-selector UI. The backend returns
// to the selector after registration, so this proves the new entry is visibly protected and that
// choosing it opens the lock screen.
// Run with: node e2e/run-all.mjs --spec=117

import assert from "node:assert/strict";
import { launchApp } from "./harness.mjs";
import { seedProfiles } from "./lib/protection.mjs";

const PASSWORD = "correct horse battery staple";
const testDbDir = await seedProfiles([
  { name: "Alex" },
  { name: "Blair" },
]);
const app = await launchApp({ dbDir: testDbDir, ready: "[data-profile-selector]" });

try {
  const { browser } = app;
  await browser.$("[data-profile-selector]").waitForExist({ timeout: 10000 });
  await (await browser.$("[data-add-profile]")).click();
  await (await browser.$(".profile-card-new-form input:not([type='checkbox'])")).setValue("Jamie");
  await (await browser.$("[data-protect-new-profile]")).click();
  await (await browser.$(".profile-card-new-form button[type='submit']")).click();

  await browser.$("#protection-setup-password").waitForExist({ timeout: 5000 });
  await (await browser.$("#protection-setup-password")).setValue(PASSWORD);
  await (await browser.$("#protection-setup-confirm")).setValue(PASSWORD);
  await (await browser.$("button=Continue")).click();

  const recoveryEl = await browser.$(".protection-setup-key");
  await recoveryEl.waitForExist({ timeout: 15000 });
  const recoveryDisplay = (await recoveryEl.getText()).trim();
  await (await browser.$("button=I've saved it")).click();
  const label0 = await browser.$("label[for='protection-setup-answer-0']");
  await label0.waitForExist({ timeout: 5000 });
  const label1 = await browser.$("label[for='protection-setup-answer-1']");
  const group0 = Number((await label0.getText()).match(/\d+/)[0]) - 1;
  const group1 = Number((await label1.getText()).match(/\d+/)[0]) - 1;
  const groups = recoveryDisplay.split("-");
  await (await browser.$("#protection-setup-answer-0")).setValue(groups[group0]);
  await (await browser.$("#protection-setup-answer-1")).setValue(groups[group1]);
  await (await browser.$("button=Finish")).click();

  await browser.$(".protection-setup").waitForExist({ reverse: true, timeout: 15000 });
  await browser.waitUntil(
    () => browser.execute(() => [...document.querySelectorAll("[data-profile-option]")].some((card) => card.textContent.includes("Jamie"))),
    { timeout: 15000, timeoutMsg: "the completed protected profile never appeared in the selector" },
  );
  const jamieCard = await browser.$$("[data-profile-option]").then(async (cards) => {
    for (const card of cards) if ((await card.getText()).includes("Jamie")) return card;
    return null;
  });
  assert.ok(jamieCard, "the protected profile should appear in the profile selector");
  assert.ok(await jamieCard.$('[aria-label="Password protected"]').isExisting(), "the new profile should show its lock indicator");

  const profiles = await browser.executeAsync((done) => {
    window.__TAURI_INTERNALS__.invoke("list_profiles").then((value) => done(value), (error) => done({ error: String(error) }));
  });
  const jamie = profiles.find((profile) => profile.name === "Jamie");
  assert.equal(jamie?.is_password_protected, true);

  await jamieCard.click();
  await browser.$("[data-profile-lock-screen] #password-form-field").waitForExist({ timeout: 5000 });
} finally {
  await app.close();
}

console.log("FEATURE 117 E2E TEST PASSED");
