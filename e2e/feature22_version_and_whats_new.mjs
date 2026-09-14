// E2E smoke test for two additions: the app version shown in the sidebar
// above the theme toggle, and the "What's new" dialog that appears once
// per version (first install or update alike, tracked in localStorage).
//
// The "What's new" trigger is deliberately manufactured rather than relied
// on ambient first-run state: the harness's own welcome-dialog dismissal
// already writes to localStorage on every launch, so "is this truly a
// fresh install" isn't a reliable thing to assert on across repeated test
// runs. Instead, this seeds an old "last seen version" directly into
// localStorage and reloads, which is exactly the same code path a real
// update takes (installed version differs from what was last seen).
//
// Run with: node e2e/feature22_version_and_whats_new.mjs

import { launchApp } from "./harness.mjs";

const app = await launchApp();
try {
  const versionText = await app.browser.$(".sidebar-version");
  await versionText.waitForExist({ timeout: 10000 });
  const versionString = await versionText.getText();
  console.log("sidebar version:", versionString);
  if (!/^v\d+\.\d+\.\d+$/.test(versionString)) {
    throw new Error(`expected a "vX.Y.Z" version string, got "${versionString}"`);
  }

  // Manufacture the "just updated" precondition: pretend this viewer last
  // saw an old version, then reload so the app remounts and re-runs its
  // version check against that stale localStorage value.
  await app.browser.execute(() => {
    localStorage.setItem("vaultspend-last-seen-version", "0.0.1");
  });
  await app.browser.url("http://tauri.localhost/index.html");

  const dialogTitle = await app.browser.$("//h2[contains(@class,'modal-title')][starts-with(text(),\"What's new in\")]");
  await dialogTitle.waitForExist({ timeout: 10000 });
  const titleText = await dialogTitle.getText();
  console.log("what's new dialog title:", titleText);
  if (!titleText.includes(versionString.slice(1))) {
    throw new Error(`expected the dialog to name the current version (${versionString}), got "${titleText}"`);
  }

  const noteItems = await app.browser.$$(".modal-changelog-list li");
  if (noteItems.length === 0) throw new Error("expected at least one changelog bullet in the dialog");
  console.log(`dialog shows ${noteItems.length} changelog bullet(s)`);

  const gotItBtn = await app.browser.$("button=Got it");
  await gotItBtn.click();
  await dialogTitle.waitForExist({ timeout: 5000, reverse: true });

  // Reloading again must NOT bring it back — dismissing recorded this
  // version as seen.
  await app.browser.url("http://tauri.localhost/index.html");
  await app.browser.$(".sidebar-version").waitForExist({ timeout: 10000 });
  const stillGone = await app.browser.$("//h2[contains(@class,'modal-title')][starts-with(text(),\"What's new in\")]");
  if (await stillGone.isExisting()) {
    throw new Error("expected the What's New dialog to stay dismissed for the same version after a reload");
  }

  console.log("FEATURE 22 E2E TEST PASSED");
} finally {
  await app.close();
}
