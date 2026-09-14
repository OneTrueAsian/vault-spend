// E2E smoke test for the Settings tab's data-file section: confirms the
// current data file location renders correctly, end to end through the
// real `get_data_file_location` command, and that "Export a copy…" is
// wired up alongside "Move data file…".
//
// Both actions open a native OS dialog (a folder picker, a save-file
// dialog), which — same as the CSV/OFX/QIF import file picker — WebDriver
// can't drive (see e2e/lib/seed.mjs's docstring on why CSV import fixtures
// are seeded directly rather than through the UI). That side of each
// feature is covered instead by unit tests: `backup_to_copies_every_row_to_a_new_file`
// and `config.rs`'s `resolve_db_path`/`write_db_location_config` for
// relocating, the same `backup_to` test for exporting (`export_database`
// is a thin passthrough to it), and `looks_like_a_vault_spend_database`'s
// own tests for the "Use existing file…" validation this card's sibling
// Profiles card also relies on (see feature34_use_existing_data_file.mjs).
//
// Run with: node e2e/feature16_relocate_data_file.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);

const app = await launchApp({ dbDir });
try {
  const settingsNav = await app.browser.$("button*=Settings");
  await settingsNav.click();

  const settingsCard = await app.browser.$(
    "//div[contains(@class,'card')][.//span[text()='Data file']]",
  );
  await settingsCard.waitForExist({ timeout: 10000 });

  await app.browser.waitUntil(
    async () => (await settingsCard.getText()).includes("vaultspend.db"),
    { timeout: 10000, timeoutMsg: "expected the data file location to finish loading" },
  );

  const cardText = await settingsCard.getText();
  console.log("settings card:", cardText);
  if (!cardText.includes(dbDir)) {
    throw new Error(`expected the displayed path to be under the test dbDir (${dbDir}), got:\n${cardText}`);
  }
  if (!cardText.includes("Move data file")) {
    throw new Error(`expected a "Move data file…" action, got:\n${cardText}`);
  }
  if (!cardText.includes("Export a copy")) {
    throw new Error(`expected an "Export a copy…" action, got:\n${cardText}`);
  }
  if (!cardText.toLowerCase().includes("doesn't change what vault spend is using now")) {
    throw new Error(`expected explainer copy distinguishing export from relocate, got:\n${cardText}`);
  }
  console.log('"Export a copy…" renders alongside "Move data file…" with its own explainer');

  console.log("FEATURE 16 E2E TEST PASSED");
} finally {
  await app.close();
}
