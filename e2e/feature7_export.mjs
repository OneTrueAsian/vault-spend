// E2E smoke test for CSV/PDF export: confirms the export buttons exist on
// both Ledger and Reports and are enabled.
//
// NOTE: clicking these buttons opens a native OS save/print dialog, which
// WebDriver has no cross-platform API to interact with (unlike an
// in-page <input type=file>, this is a real Win32 common dialog) — the
// same limitation this app's CSV *import* already has (see
// e2e/lib/seed.mjs's sqlite-based fixture seeding, which exists precisely
// to route around it). Actually clicking Export/Print here would hang the
// dialog open with nothing able to dismiss it, so this test deliberately
// only checks presence/wiring, never clicks through.
//
// Run with: node e2e/feature7_export.mjs

import { launchApp } from "./harness.mjs";
import { seedFixture } from "./lib/seed.mjs";

const dbDir = await seedFixture(`
cur.execute("INSERT INTO accounts (name, account_type, starting_balance) VALUES ('Checking', 'checking', '1000.00')")
`);

const app = await launchApp({ dbDir });
try {
  const ledgerNav = await app.browser.$("button*=Transactions");
  await ledgerNav.click();
  // Export CSV lives behind the toolbar's "More" menu now (Phase 3
  // decluttering) — open it first.
  const moreMenuToggle = await app.browser.$(".more-menu button");
  await moreMenuToggle.waitForExist({ timeout: 10000 });
  await moreMenuToggle.click();
  const ledgerExport = await app.browser.$("button*=Export CSV");
  await ledgerExport.waitForExist({ timeout: 10000 });
  if (!(await ledgerExport.isEnabled())) throw new Error("Ledger Export CSV button is disabled");
  console.log("Ledger export button OK");

  const reportsNav = await app.browser.$("button*=Reports");
  await reportsNav.click();
  const reportsExport = await app.browser.$("button*=Export CSV");
  await reportsExport.waitForExist({ timeout: 10000 });
  if (!(await reportsExport.isEnabled())) throw new Error("Reports Export CSV button is disabled");
  const printButton = await app.browser.$("button*=Print");
  await printButton.waitForExist({ timeout: 5000 });
  if (!(await printButton.isEnabled())) throw new Error("Print/Save as PDF button is disabled");
  console.log("Reports export + print buttons OK");

  console.log("FEATURE 7 E2E TEST PASSED (presence/wiring only — see note above)");
} finally {
  await app.close();
}
