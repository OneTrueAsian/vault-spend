// E2E smoke test for the Settings tab's bulk setup-data import/export
// buttons, now that "Holdings" is a 5th section on that template
// (core/src/setup_import.rs, src-tauri/src/commands.rs's
// preview_setup_import/commit_setup_import, src/App.tsx's
// pendingSetupImport review screen).
//
// "Download setup template…" and "Import setup data…" both go through a
// native OS file dialog (save/open respectively), which — same as
// `relocate_data_file`'s folder picker (see feature16_relocate_data_file.mjs's
// own doc comment) — WebDriver cannot drive. There was no E2E coverage of
// this flow at all before Holdings was added, and that's still true now:
// this just confirms the entry points render correctly. The actual
// parsing/apply logic (the part that matters) is covered by
// core/src/setup_import.rs's and core/src/store.rs's own unit tests —
// notably `apply_setup_import_creates_holdings_linked_by_account_name`,
// `a_holdings_unknown_account_is_skipped_entirely_not_created_without_one`,
// and `a_blank_holding_name_defaults_to_the_symbol`.
//
// Run with: node e2e/feature31_bulk_holdings_import.mjs

import { launchApp } from "./harness.mjs";

const app = await launchApp();
try {
  const settingsNav = await app.browser.$("button*=Settings");
  await settingsNav.click();

  const downloadBtn = await app.browser.$("button*=Download setup template");
  await downloadBtn.waitForExist({ timeout: 10000 });
  const importBtn = await app.browser.$("button*=Import setup data");
  await importBtn.waitForExist({ timeout: 5000 });
  console.log("both bulk setup-data buttons render on the Settings tab");

  console.log("FEATURE 31 E2E TEST PASSED");
} finally {
  await app.close();
}
