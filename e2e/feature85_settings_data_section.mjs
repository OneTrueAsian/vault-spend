// E2E test: Settings has ONE "Data" section holding the data file, the backups
// and the setup-data tools — not three separate cards.
//
// Each block keeps all its actions, fields and descriptions, including the
// second backup folder field, and they still work from their new home.
//
// Run with: node e2e/feature85_settings_data_section.mjs

import { launchApp } from "./harness.mjs";
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

  // ---- one card titled "Data"; no standalone Data file / Backups / Setup data cards
  const titles = await browser.execute(() => [...document.querySelectorAll(".card .reports-section-title")].map((t) => t.textContent.trim()));
  console.log("card titles:", titles.join(" | "));
  if (titles.filter((t) => t === "Data").length !== 1) throw new Error(`expected exactly one "Data" card, got: ${titles.join(", ")}`);
  for (const gone of ["Data file", "Backups", "Setup data"]) {
    if (titles.includes(gone)) throw new Error(`"${gone}" should no longer be a standalone section heading (titles: ${titles.join(", ")})`);
  }

  // ---- the three blocks live inside it, in order
  const card = await browser.$("//div[contains(@class,'card')][.//span[contains(@class,'reports-section-title')][normalize-space()='Data']]");
  await card.waitForExist({ timeout: 10000 });
  const subheads = await card.$$("h3.data-subhead");
  const subheadTexts = [];
  for (const h of subheads) subheadTexts.push((await h.getText()).trim());
  if (subheadTexts.join("|") !== "Data file|Backups|Setup data") {
    throw new Error(`the Data card should hold Data file, Backups and Setup data in that order, got: ${subheadTexts.join(" | ")}`);
  }

  // ---- every existing action, field and description is still there
  const text = await card.getText();
  for (const expected of [
    "Data file location",
    "Move data file…",
    "Export a copy…",
    "Use existing file…",
    "Saves a full copy of your data",
    "Vault Spend backs up automatically once a day",
    "Back up now",
    "Second copy",
    "Browse…",
    "Start copying",
    "Setting up from scratch?",
    "Download setup template…",
    "Import setup data…",
  ]) {
    if (!text.includes(expected)) throw new Error(`the Data card should still contain "${expected}", got:\n${text}`);
  }
  if (!(await card.$("input[aria-label='Second backup folder']").isExisting())) throw new Error("the second backup folder field should be in the Data card");
  if (!(await card.$("[data-setup-data]").isExisting())) throw new Error("the setup-data block should keep its data-setup-data marker inside the Data card");

  // ---- the moved controls still work
  // (The app takes its own backup at launch, so there is already one listed.)
  const backupRows = () => browser.execute(() => document.querySelectorAll("[data-backups] table tbody tr").length);
  const before = await backupRows();
  if (before < 1) throw new Error("the backup list should show the backup made at launch");
  await (await card.$("button=Back up now")).click();
  await browser.waitUntil(async () => /Backup created/i.test(await (await browser.$(".toast-stack .status")).getText()), {
    timeout: 15000,
    timeoutMsg: "Back up now, from the Data card, should still make a backup",
  });
  await browser.waitUntil(async () => (await backupRows()) > before, { timeout: 10000, timeoutMsg: "the new backup should be listed" });
  const restore = await card.$("button=Restore");
  if (!(await restore.isExisting())) throw new Error("the backup list should offer Restore");

  console.log("FEATURE 85 E2E TEST PASSED");
} finally {
  await app.close?.();
}
