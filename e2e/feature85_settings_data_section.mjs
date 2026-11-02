// E2E test: Settings' Data group has one clearly named card per task: Data file, Automatic backups,
// Second copy, Backup history and Setup data — not one large card with sub-headings.
//
// Each block keeps all its actions, fields and descriptions, including the
// second backup folder field, and they still work from their new home.
//
// Run with: node e2e/feature85_settings_data_section.mjs

import { launchApp, openSettingsGroup } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);

const app = await launchApp({ dbDir });
const { browser } = app;

async function goTo(label) {
  for (const b of await browser.$$("nav button")) {
    if ((await b.getText()).trim() === label) {
      await b.click();
      await browser.pause(600);
      return;
    }
  }
  throw new Error(`no nav button "${label}"`);
}

try {
  await browser.setWindowSize(1440, 1400);
  await goTo("Settings");
  await openSettingsGroup(browser, "data");

  // ---- one clearly named card per task; no single large "Data" card and no repeated sub-headings
  const titles = await browser.execute(() => [...document.querySelectorAll('[data-settings-panel="data"] .card > .card-head .reports-section-title')].map((t) => t.textContent.trim()));
  console.log("card titles:", titles.join(" | "));
  const wanted = ["Data file", "Automatic backups", "Second copy", "Backup history", "Setup data"];
  if (titles.slice(0, 5).join("|") !== wanted.join("|")) throw new Error(`the Data group should start with ${wanted.join(", ")} in that order, got: ${titles.join(", ")}`);
  if (titles.includes("Data")) throw new Error(`there should be no single "Data" card (titles: ${titles.join(", ")})`);
  if (await browser.execute(() => document.querySelectorAll('[data-settings-panel="data"] .data-subhead').length)) throw new Error("the Data cards should not repeat their title as a sub-heading");
  const card = await browser.$('[data-settings-panel="data"]');

  // ---- every existing action, field and description is still there
  const text = await card.getText();
  for (const expected of [
    "Copy path",
    "Move data file",
    "Export a copy",
    "Use existing file",
    "Saves a full copy of your data",
    "backs up once a day",
    "Back up now",
    "Browse",
    "Start copying",
    "Setting up from scratch?",
    "Download setup template",
    "Import setup data",
  ]) {
    if (!text.includes(expected)) throw new Error(`the Data group should still contain "${expected}", got:
${text}`);
  }
  if (!(await card.$("[data-backup-copy] input[aria-label='Second backup folder']").isExisting())) throw new Error("the second backup folder field should be in the Second copy card");
  if (!(await card.$("[data-setup-data]").isExisting())) throw new Error("the setup-data card should keep its data-setup-data marker");

  // ---- a long path wraps inside its card at a narrow width, and Copy path reports beside its button
  await browser.setWindowSize(760, 1000);
  await browser.pause(400);
  const fits = await browser.execute(() => {
    const box = document.querySelector("[data-data-file] .path-box").getBoundingClientRect();
    const cardBox = document.querySelector("[data-data-file]").getBoundingClientRect();
    return box.right <= cardBox.right + 1 && box.left >= cardBox.left - 1;
  });
  if (!fits) throw new Error("the data file path must stay inside its card");
  await browser.setWindowSize(1440, 1400);
  await (await card.$("button=Copy path")).click();
  await browser.waitUntil(async () => (await browser.execute(() => document.querySelector("[data-data-file] [role='status']").textContent)).length > 0, { timeout: 10000, timeoutMsg: "Copy path should say whether it worked, beside the button" });

  // ---- the moved controls still work
  // (The app takes its own backup at launch, so there is already one listed.)
  const backupRows = () => browser.execute(() => document.querySelectorAll("[data-backups] table tbody tr").length);
  const before = await backupRows();
  if (before < 1) throw new Error("the backup list should show the backup made at launch");
  await (await card.$("button=Back up now")).click();
  await browser.waitUntil(async () => /Backup created/i.test(await (await browser.$(".toast-stack .status")).getText()), {
    timeout: 15000,
    timeoutMsg: "Back up now, from the Automatic backups card, should still make a backup",
  });
  await browser.waitUntil(async () => (await backupRows()) > before, { timeout: 10000, timeoutMsg: "the new backup should be listed" });
  const beside = await browser.execute(() => {
    const card = document.querySelector("[data-setting-card=\"backups\"]");
    const status = card.querySelector("[role=\"status\"]");
    const button = [...card.querySelectorAll("button")].find((b) => b.textContent === "Back up now");
    return { text: status.textContent, sameRow: Math.abs(status.getBoundingClientRect().top - button.getBoundingClientRect().top) < 40 };
  });
  if (!/Backup created/i.test(beside.text) || !beside.sameRow) throw new Error(`the Back up now result should appear beside its button, got ${JSON.stringify(beside)}`);

  // ---- on a wide window, Automatic backups and Second copy sit side by side; narrower, they stack
  await browser.setWindowSize(1700, 1000);
  await browser.pause(400);
  const pair = () => browser.execute(() => {
    const a = document.querySelector("[data-setting-card=\"backups\"]").getBoundingClientRect();
    const b = document.querySelector("[data-backup-copy]").getBoundingClientRect();
    return { sideBySide: Math.abs(a.top - b.top) < 4 && b.left > a.right - 1, stacked: b.top >= a.bottom - 1 };
  });
  if (!(await pair()).sideBySide) throw new Error("Automatic backups and Second copy should sit side by side in a wide window");
  await browser.setWindowSize(1100, 1000);
  await browser.pause(400);
  if (!(await pair()).stacked) throw new Error("Automatic backups and Second copy should stack in a narrower window");
  await browser.setWindowSize(1440, 1400);
  const restore = await card.$("button=Restore");
  if (!(await restore.isExisting())) throw new Error("the backup list should offer Restore");

  console.log("FEATURE 85 E2E TEST PASSED");
} finally {
  await app.close?.();
}
