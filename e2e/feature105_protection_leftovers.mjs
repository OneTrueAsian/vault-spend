// E2E coverage for the leftover-plaintext-files banner (Phase C, Task 9): after converting a
// profile, Settings offers to delete the original plaintext database and its backups; "Keep for
// now" is a session-local dismissal, not a persisted one (it reappears on the next launch); "Delete
// plaintext copies now" actually removes the files, and once nothing is left the banner is gone for
// good.
//
// Run with: node e2e/feature105_protection_leftovers.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dismissFirstLaunchDialogs, launchApp } from "./harness.mjs";
import { enableProtectionThroughUI, seedPopulatedProfile } from "./lib/protection.mjs";
import { freshTestDbDir } from "./lib/seed.mjs";

const PASSWORD = "correct horse battery staple";
const REGION = "[role='region'][aria-label='Leftover plaintext files']";

const testDbDir = freshTestDbDir();
await seedPopulatedProfile(testDbDir);

let app = await launchApp({ dbDir: testDbDir });
try {
  const { browser } = app;
  await (await browser.$("button*=Settings")).click();
  await enableProtectionThroughUI(browser, PASSWORD);
  await browser.waitUntil(async () => (await browser.$(".page").getText()).includes("Password protection: On"), {
    timeout: 10000,
    timeoutMsg: "expected Password protection: On after finishing setup",
  });

  const region = await browser.$(REGION);
  await region.waitForExist({ timeout: 10000, timeoutMsg: "the leftovers banner should appear once conversion finishes" });
  const regionText = await region.getText();
  assert.match(regionText, /vaultspend\.db/, `expected the original database's path, got:\n${regionText}`);
  assert.match(regionText, /vaultspend-20260918-090000\.db/, `expected the first backup's path, got:\n${regionText}`);
  assert.match(regionText, /vaultspend-20260919-090000\.db/, `expected the second backup's path, got:\n${regionText}`);

  await (await browser.$("button=Keep for now")).click();
  await browser.waitUntil(async () => !(await browser.$(REGION).isExisting()), {
    timeout: 5000,
    timeoutMsg: "Keep for now should dismiss the banner",
  });
} finally {
  await app.close();
}

// Keep for now is session-local, not persisted: relaunching, unlocking and reopening Settings shows
// the banner again — nothing was actually deleted.
app = await launchApp({ dbDir: testDbDir, ready: "[data-profile-selector]" });
try {
  const { browser } = app;
  await (await browser.$("[data-profile-option]")).click();
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  await (await browser.$("#password-form-field")).setValue(PASSWORD);
  await (await browser.$("button[type='submit']")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await dismissFirstLaunchDialogs(browser);
  await (await browser.$("button*=Settings")).click();

  const region = await browser.$(REGION);
  await region.waitForExist({ timeout: 10000, timeoutMsg: "Keep for now must not persist — the banner should reappear on the next launch" });

  await (await browser.$("button=Delete plaintext copies now")).click();
  await browser.waitUntil(async () => !(await browser.$(REGION).isExisting()), {
    timeout: 10000,
    timeoutMsg: "the banner should disappear once every leftover is actually deleted",
  });
} finally {
  await app.close();
}

assert.ok(!fs.existsSync(path.join(testDbDir, "vaultspend.db")), "the plaintext original should actually be deleted from disk");
assert.ok(!fs.existsSync(path.join(testDbDir, "backups", "vaultspend-20260918-090000.db")), "the first plaintext backup should be deleted");
assert.ok(!fs.existsSync(path.join(testDbDir, "backups", "vaultspend-20260919-090000.db")), "the second plaintext backup should be deleted");

// A third launch: the banner is gone for good now, not just dismissed.
app = await launchApp({ dbDir: testDbDir, ready: "[data-profile-selector]" });
try {
  const { browser } = app;
  await (await browser.$("[data-profile-option]")).click();
  await browser.$("[data-profile-lock-screen]").waitForExist({ timeout: 10000 });
  await (await browser.$("#password-form-field")).setValue(PASSWORD);
  await (await browser.$("button[type='submit']")).click();
  await browser.$(".brand-word").waitForExist({ timeout: 10000 });
  await dismissFirstLaunchDialogs(browser);
  await (await browser.$("button*=Settings")).click();
  await (await browser.$("[data-data-file]")).waitForExist({ timeout: 10000 }); // Settings has fully rendered
  assert.ok(!(await browser.$(REGION).isExisting()), "with nothing left to delete, the banner must not appear at all");
} finally {
  await app.close();
}

console.log("FEATURE 105 E2E TEST PASSED");
