// E2E smoke test for "Use existing file" in Settings → Profiles — the
// counterpart to feature16_relocate_data_file.mjs's "Move data file":
// picking the file itself opens a native OS file picker, which WebDriver
// can't drive (same limitation feature16 documents). That side — the
// backend registering the picked path and hot-swapping to it — is covered
// instead by src-tauri/src/profiles.rs's `add_existing_profile` unit tests.
// This test just confirms the button renders and is wired up.
//
// Run with: node e2e/feature34_use_existing_data_file.mjs

import { launchApp, openSettingsGroup } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);

const app = await launchApp({ dbDir });
try {
  const settingsNav = await app.browser.$("button*=Settings");
  await settingsNav.click();
  await openSettingsGroup(app.browser, "profiles");

  const profilesCard = await app.browser.$("//div[contains(@class,'card')][.//*[contains(@class,'reports-section-title')][text()='Profiles']]");
  await profilesCard.waitForExist({ timeout: 10000 });

  const useExistingBtn = await profilesCard.$("button*=Use existing file");
  await useExistingBtn.waitForExist({ timeout: 10000 });
  console.log('"Use existing file" button renders in the Profiles card');

  const cardText = await profilesCard.getText();
  if (!cardText.toLowerCase().includes("moving to a new computer")) {
    throw new Error(`expected explainer copy about moving to a new computer, got:\n${cardText}`);
  }
  console.log("explainer copy present");

  console.log("FEATURE 34 E2E TEST PASSED");
} finally {
  await app.close();
}
