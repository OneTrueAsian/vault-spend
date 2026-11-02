// Settings is a Quick settings tab plus five groups shown one at a time, with search.
//   Quick settings opens first with Mobile, Password and Backup; an entry takes the person to the setting and never runs it.
//   A star beside any setting adds it to Quick settings and × removes it. Search finds a setting and jumps to it.
//   The last tab is remembered. "Manage profiles" opens Profiles & security. Each profile keeps its own Quick settings.
//
// Run with: node e2e/feature365_settings_groups_search_quick_settings.mjs

import assert from "node:assert/strict";
import { launchApp, openSettingsGroup, waitUntilOrDiagnose } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);
const app = await launchApp({ dbDir });
const { browser: b } = app;

const settingsNav = () => b.$(".nav-item[data-tab=settings]");
const groupButton = (name) => b.$(`//*[@aria-label="Settings groups"]//button[normalize-space(translate(., "★", ""))="${name}"]`);
const quickIds = () => b.execute(() => [...document.querySelectorAll('[data-settings-panel="quick"] [data-quick-entry]')].map((e) => e.getAttribute("data-quick-entry")));
const panelShown = (id) => b.execute((x) => document.querySelector(`[data-settings-panel="${x}"]`)?.hidden === false, id);
const current = () => b.execute(() => document.querySelector('[aria-label="Settings groups"] [aria-current="true"]')?.textContent.replace("★", "").trim() ?? null);
const backupRows = () => b.execute(() => document.querySelectorAll("[data-backups] table tbody tr").length);
const sidebarName = () => b.$(".profile-switcher-name").getText();

async function waitFor(condition, msg, timeout = 10000) {
  await waitUntilOrDiagnose(b, condition, { timeout, timeoutMsg: msg });
}

try {
  await b.setWindowSize(1440, 1200);
  await (await settingsNav()).click();

  // ---- opens on Quick settings with the three defaults
  await waitFor(async () => (await quickIds()).length === 3, "Quick settings should list its three starting entries");
  assert.deepEqual(await quickIds(), ["mobile-snapshots", "password-protection", "backups"]);
  assert.equal(await current(), "Quick settings", "the first tab shown is Quick settings");

  // ---- an entry takes the person to the setting and does not run it
  await waitFor(async () => (await backupRows()) >= 1, "the backup list should show the backup made at launch");
  const rowsBefore = await backupRows();
  await (await b.$('[data-quick-entry="backups"] [data-quick-go]')).click();
  await waitFor(async () => await panelShown("data"), "Backup should open the Data group");
  await waitFor(async () => b.execute(() => document.activeElement?.getAttribute("data-setting-card") === "backups"), "the Automatic backups card should take focus");
  assert.equal(await b.execute(() => document.querySelector('[data-setting-card="backups"]').classList.contains("settings-flash")), true, "the setting is highlighted for a moment");
  await b.pause(1500);
  assert.equal(await backupRows(), rowsBefore, "going to Backups must not make a backup");

  // ---- star a setting, see it in Quick settings, remove it with ×
  await openSettingsGroup(b, "display");
  await (await b.$('[aria-label="Add Light or dark to Quick settings"]')).click();
  await waitFor(async () => (await b.$('[aria-label="Remove Light or dark from Quick settings"]').isExisting()), "the star should now read Remove");
  await (await groupButton("Quick settings")).click();
  await waitFor(async () => (await quickIds()).includes("theme"), "Light or dark should be in Quick settings");
  await (await b.$('[aria-label="Remove Light or dark from Quick settings"]')).click();
  await waitFor(async () => !(await quickIds()).includes("theme"), "× should remove it");

  // ---- add from the picker
  await (await b.$("[data-quick-add-open]")).click();
  await (await b.$('input[aria-label="Search for a setting to add"]')).setValue("rollover");
  await (await b.$('[data-quick-add="rollover-unspent"]')).click();
  await waitFor(async () => (await quickIds()).includes("rollover-unspent"), "the picker should add Rollover unspent");
  await (await b.$("[data-quick-done]")).click();

  // ---- search finds a setting and jumps to it
  await (await b.$('input[aria-label="Search settings"]')).setValue("password");
  const results = await b.$('[role="region"][aria-label="Search results"]');
  await results.waitForExist({ timeout: 5000 });
  assert.ok((await results.getText()).includes("Profiles & security"), "a result names the category the setting lives in");
  await (await results.$("button")).click();
  await waitFor(async () => await panelShown("profiles"), "choosing a result opens its group");
  assert.equal(await b.$('input[aria-label="Search settings"]').getValue(), "", "the search box is cleared after a jump");

  // ---- the last tab is remembered when Settings is left and reopened
  await (await groupButton("Data")).click();
  await (await b.$(".nav-item[data-tab=dashboard]")).click();
  await (await settingsNav()).click();
  await waitFor(async () => (await current()) === "Data", "Settings should reopen on the tab that was last used");

  // ---- "manage profiles" opens Profiles & security, even from another tab
  await (await groupButton("Display")).click();
  await (await b.$(".profile-switcher-toggle")).click();
  await (await b.$(".profile-switcher-manage")).click();
  await waitFor(async () => (await current()) === "Profiles & security", "manage profiles should open Profiles & security");

  // ---- each profile keeps its own Quick settings
  const firstName = await sidebarName();
  await b.$(".profile-create-form input").waitForExist({ timeout: 10000 });
  await (await b.$(".profile-create-form input")).setValue("Second Profile");
  await (await b.$('.profile-create-form button[type="submit"]')).click();
  await waitFor(async () => (await sidebarName()) === "Second Profile", "creating a profile switches to it", 15000);
  await openSettingsGroup(b, "quick");
  await waitFor(async () => (await quickIds()).length === 3, "a new profile starts with the three defaults");
  assert.deepEqual(await quickIds(), ["mobile-snapshots", "password-protection", "backups"], "the new profile does not inherit the first profile's list");
  await openSettingsGroup(b, "features");
  await (await b.$('[aria-label="Add Apply to Debt to Quick settings"]')).click();
  await openSettingsGroup(b, "quick");
  await waitFor(async () => (await quickIds()).includes("apply-to-debt"), "the second profile's list gets the new entry");

  await openSettingsGroup(b, "profiles");
  await (await (await b.$(`//tr[td[contains(normalize-space(.), "${firstName}")]]`)).$("button=Switch")).click();
  await waitFor(async () => (await sidebarName()) === firstName, "switching back to the first profile", 15000);
  await openSettingsGroup(b, "quick");
  await waitFor(async () => (await quickIds()).length >= 3, "the first profile's list loads");
  const first = await quickIds();
  assert.ok(first.includes("rollover-unspent") && !first.includes("apply-to-debt"), "the first profile keeps its own list: " + first.join(", "));

  console.log("FEATURE 365 E2E TEST PASSED");
} finally {
  await app.close?.();
}
